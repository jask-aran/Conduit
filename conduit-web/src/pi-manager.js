import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { buildPiEnvironment, buildPiResourceArgs } from "../../scripts/pi-runtime.mjs";
import { mergeContinuation } from "./continuation.js";
import {
  applyActivityEvent,
  deriveCoarseActivity,
  isBlockingHostUi,
  normalizeHostUiRequest,
} from "./activity.js";
import {
  generationResumeEvent,
  reduceActiveGeneration,
} from "./active-generation.js";
import { createPiEventNormalizer } from "./pi-event-normalizer.js";

export function buildPiArgs({ sessionFile = null, model = "", thinkingLevel = "", models, template }) {
  const args = [
    "--mode", "rpc",
    ...buildPiResourceArgs(models ? { ...template, models } : template),
  ];
  if (sessionFile) args.push("--session", path.resolve(sessionFile));
  if (model.trim()) args.push("--model", model.trim());
  if (thinkingLevel.trim()) args.push("--thinking", thinkingLevel.trim());
  return args;
}

function emptyQueue() {
  return { steering: [], followUp: [] };
}

function emptyContextUsage() {
  return {
    tokens: null,
    contextWindow: null,
    percent: null,
    reportedAt: null,
    source: "unknown",
    lastRequestUsage: null,
  };
}

const TERMINAL_GENERATION_STATUSES = new Set(["stopped", "complete", "failed"]);

function socketIsOpen(socket) {
  return socket?.readyState === socket?.OPEN;
}

function socketBufferedAmount(socket) {
  const amount = Number(socket?.bufferedAmount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function deliveryDeltaKey(event) {
  if (event.type === "content_block_delta") {
    return `structured:${event.generationId}:${event.messageId}:${event.blockType}:${event.contentIndex}`;
  }
  if (event.type === "assistant_stream_delta") return `compat:text:${event.generationId}`;
  if (event.type === "message_update" && event.update?.type === "thinking_delta") return `compat:thinking:${event.generationId}`;
  return null;
}

function mergeDeliveryDelta(previous, next) {
  if (next.type === "content_block_delta") {
    return { ...next, delta: `${previous.delta || ""}${next.delta || ""}` };
  }
  if (next.type === "assistant_stream_delta") {
    return { ...next, delta: `${previous.delta || ""}${next.delta || ""}` };
  }
  return {
    ...next,
    update: {
      ...next.update,
      delta: `${previous.update?.delta || ""}${next.update?.delta || ""}`,
    },
  };
}

export class PiManager extends EventEmitter {
  constructor({
    command = "pi",
    agentDir,
    template,
    spawnImpl = spawn,
    maxLiveProcesses = 12,
    maxGeneratingProcesses = 2,
    idleProcessTtlMs = 120_000,
    reaperIntervalMs = 15_000,
    socketHighWaterMark = 256 * 1024,
    deliveryFlushMs = 16,
    socketRecoveryPollMs = 50,
    now = () => Date.now(),
  } = {}) {
    super();
    if (!agentDir) throw new Error("PiManager requires an isolated agent directory");
    this.command = command;
    this.spawnImpl = spawnImpl;
    this.agentDir = agentDir;
    this.template = template;
    this.processes = new Map();
    this.bySessionFile = new Map();
    this.requestSequence = 0;
    this.now = now;
    this.maxLiveProcesses = Math.max(1, Math.trunc(Number(maxLiveProcesses) || 12));
    this.maxGeneratingProcesses = Math.max(1, Math.trunc(Number(maxGeneratingProcesses) || 2));
    this.idleProcessTtlMs = Math.max(30_000, Math.trunc(Number(idleProcessTtlMs) || 120_000));
    this.socketHighWaterMark = Math.max(1024, Math.trunc(Number(socketHighWaterMark) || 256 * 1024));
    this.socketLowWaterMark = Math.floor(this.socketHighWaterMark / 2);
    this.deliveryFlushMs = Math.max(0, Math.trunc(Number(deliveryFlushMs) || 16));
    this.socketRecoveryPollMs = Math.max(10, Math.trunc(Number(socketRecoveryPollMs) || 50));
    this.capacityQueue = Promise.resolve();
    this.reaperTimer = null;
    if (reaperIntervalMs > 0) {
      this.reaperTimer = setInterval(() => {
        this.reapIdleProcesses().catch(() => {});
      }, reaperIntervalMs);
      this.reaperTimer.unref?.();
    }
  }

  /** Serialize capacity checks and creates so concurrent requests cannot overshoot the cap. */
  runExclusive(work) {
    const run = this.capacityQueue.then(work, work);
    this.capacityQueue = run.then(() => {}, () => {});
    return run;
  }

  configure({ maxLiveProcesses, maxGeneratingProcesses, idleProcessTtlMs } = {}) {
    if (maxLiveProcesses != null) this.maxLiveProcesses = Math.max(1, Math.trunc(Number(maxLiveProcesses) || 1));
    if (maxGeneratingProcesses != null) {
      this.maxGeneratingProcesses = Math.max(1, Math.trunc(Number(maxGeneratingProcesses) || 1));
    }
    if (idleProcessTtlMs != null) this.idleProcessTtlMs = Math.max(30_000, Math.trunc(Number(idleProcessTtlMs) || 30_000));
    return this.policy();
  }

  policy() {
    return {
      maxLiveProcesses: this.maxLiveProcesses,
      maxGeneratingProcesses: this.maxGeneratingProcesses,
      idleProcessTtlMs: this.idleProcessTtlMs,
      liveCount: this.liveRecords().length,
      generatingCount: this.generatingRecords().length,
    };
  }

  liveRecords() {
    return [...this.processes.values()].filter((record) => ["starting", "running"].includes(record.status));
  }

  /** True while a process holds an agent-loop slot (turn, compact, retry, host UI). */
  isGenerating(record) {
    if (!record || !["starting", "running"].includes(record.status)) return false;
    if (record.active || record.stopping || record.compacting || record.retrying) return true;
    if ((record.hostUiRequests || []).length) return true;
    if (record.generation && !record.generation.closed && !record.generation.settled) return true;
    return false;
  }

  generatingRecords() {
    return this.liveRecords().filter((record) => this.isGenerating(record));
  }

  /**
   * Hard limit on concurrent agent loops. Warm idle processes do not count.
   * A process that already holds a generating slot may continue (steer/retry path).
   */
  assertCanStartGeneration(record) {
    if (!record) throw new Error("Unknown live session");
    if (this.isGenerating(record)) return;
    const generatingCount = this.generatingRecords().length;
    if (generatingCount >= this.maxGeneratingProcesses) {
      const error = new Error(
        `Too many concurrent generations (max ${this.maxGeneratingProcesses}). Wait for another chat to finish.`,
      );
      error.code = "generation_limit";
      error.status = 429;
      error.maxGeneratingProcesses = this.maxGeneratingProcesses;
      error.generatingCount = generatingCount;
      throw error;
    }
  }

  isBusy(record) {
    if (!record) return false;
    // Bootstrapping is not idle: never reclaim a process before it is running.
    if (record.status === "starting") return true;
    if (this.isGenerating(record)) return true;
    const activity = record.activity || deriveCoarseActivity(record);
    return !["idle", "failed"].includes(activity);
  }

  isReclaimable(record, { ignoreClients = false } = {}) {
    // Only fully started idle processes are reclaimable; starting is busy.
    if (!record || record.status !== "running") return false;
    if (this.isBusy(record)) return false;
    if (!ignoreClients && record.clients.size > 0) return false;
    return true;
  }

  touchActivity(record) {
    if (!record) return;
    record.lastActivityAt = this.now();
    record.updatedAt = new Date(record.lastActivityAt).toISOString();
  }

  reclaimCandidates({ excludeChatId = null } = {}) {
    return this.liveRecords()
      .filter((record) => record.chatId !== excludeChatId && this.isReclaimable(record))
      .sort((left, right) => (left.lastClientAt || left.lastActivityAt || 0) - (right.lastClientAt || right.lastActivityAt || 0));
  }

  async ensureCapacity({ excludeChatId = null } = {}) {
    return this.runExclusive(() => this.ensureCapacityUnlocked({ excludeChatId }));
  }

  async ensureCapacityUnlocked({ excludeChatId = null } = {}) {
    while (this.liveRecords().filter((record) => record.chatId !== excludeChatId).length >= this.maxLiveProcesses) {
      const victim = this.reclaimCandidates({ excludeChatId })[0];
      if (!victim) {
        const error = new Error(`Too many live Pi processes (max ${this.maxLiveProcesses}). Wait for a chat to finish or free an idle agent.`);
        error.code = "live_process_limit";
        error.status = 429;
        throw error;
      }
      await this.stopAndWait(victim.id);
    }
  }

  /** Capacity check + create under one lock so concurrent POSTs cannot exceed the cap. */
  async createWithCapacity(options = {}) {
    return this.runExclusive(async () => {
      await this.ensureCapacityUnlocked({ excludeChatId: options.chatId || null });
      return this.create(options);
    });
  }

  /** Trim down to maxLiveProcesses after a settings change (idle unattached first). */
  async enforceLimit() {
    let stopped = 0;
    while (this.liveRecords().length > this.maxLiveProcesses) {
      const victim = this.reclaimCandidates()[0];
      if (!victim) break;
      await this.stopAndWait(victim.id);
      stopped += 1;
    }
    return stopped;
  }

  async reapIdleProcesses() {
    const cutoff = this.now() - this.idleProcessTtlMs;
    const victims = this.liveRecords().filter((record) => {
      if (!this.isReclaimable(record)) return false;
      const lastClient = record.lastClientAt ?? record.createdAtMs ?? 0;
      return lastClient <= cutoff;
    });
    for (const victim of victims) {
      await this.stopAndWait(victim.id);
    }
    return victims.length;
  }

  create({ project, chatId = null, sessionFile = null, model = "", thinkingLevel = "", models, template = null, launchSpec = null }) {
    if (chatId) {
      const existing = [...this.processes.values()].find((record) =>
        record.chatId === chatId && ["starting", "running"].includes(record.status));
      if (existing) {
        if (launchSpec?.runtime?.kind && existing.runtime?.kind && launchSpec.runtime.kind !== existing.runtime.kind) {
          const error = new Error("A different runtime already owns this chat process");
          error.code = "session_writer_conflict";
          throw error;
        }
        this.touchActivity(existing);
        return existing;
      }
    }
    const resolvedFile = launchSpec?.sessionFile
      ? path.resolve(launchSpec.sessionFile)
      : sessionFile ? path.resolve(sessionFile) : null;
    if (resolvedFile && this.bySessionFile.has(resolvedFile)) {
      const existingId = this.bySessionFile.get(resolvedFile);
      const existing = this.processes.get(existingId);
      if (existing && ["starting", "running"].includes(existing.status)) {
        if (chatId) existing.chatId = chatId;
        this.touchActivity(existing);
        return existing;
      }
      this.bySessionFile.delete(resolvedFile);
      this.processes.delete(existingId);
    }

    const liveOthers = this.liveRecords().filter((record) => record.chatId !== chatId);
    if (liveOthers.length >= this.maxLiveProcesses) {
      const error = new Error(`Too many live Pi processes (max ${this.maxLiveProcesses}). Wait for a chat to finish or free an idle agent.`);
      error.code = "live_process_limit";
      error.status = 429;
      throw error;
    }

    const id = resolvedFile
      ? crypto.createHash("sha256").update(resolvedFile).digest("hex").slice(0, 24)
      : crypto.randomUUID().replaceAll("-", "").slice(0, 24);

    const launchTemplate = launchSpec ? template : (template || this.template);
    if (!launchSpec && !launchTemplate) throw new Error("PiManager.create requires a template or launch specification");
    const args = launchSpec?.args || buildPiArgs({ sessionFile: resolvedFile, model, thinkingLevel, models, template: launchTemplate });
    const child = this.spawnImpl(launchSpec?.command || this.command, args, {
      cwd: launchSpec?.cwd || project.path,
      stdio: ["pipe", "pipe", "pipe"],
      env: launchSpec?.env || buildPiEnvironment(this.agentDir),
    });
    const createdAtMs = this.now();
    const record = {
      id,
      chatId,
      projectId: project.id,
      projectSlug: project.slug,
      cwd: launchSpec?.cwd || project.path,
      sessionDir: project.sessionsDir,
      sessionFile: resolvedFile,
      model: model.trim() || null,
      thinkingLevel: thinkingLevel.trim() || null,
      template: launchTemplate ? {
        id: launchTemplate.id,
        version: launchTemplate.version,
        label: launchTemplate.label || launchTemplate.id,
        posture: launchTemplate.posture || "",
        tools: [...(launchTemplate.tools || [])],
      } : null,
      runtime: launchSpec?.runtime || null,
      binaryVersion: launchSpec?.binaryVersion || launchSpec?.runtime?.binaryVersion || null,
      trustPosture: launchSpec?.trustPosture || "ignore_project_resources",
      child,
      status: "starting",
      active: false,
      activity: "starting",
      activityDetail: null,
      compacting: false,
      retrying: false,
      retry: null,
      hostUiRequests: [],
      queue: emptyQueue(),
      contextUsage: emptyContextUsage(),
      clients: new Set(),
      delivery: new Map(),
      events: [],
      createdAt: new Date(createdAtMs).toISOString(),
      createdAtMs,
      updatedAt: new Date(createdAtMs).toISOString(),
      lastActivityAt: createdAtMs,
      lastClientAt: createdAtMs,
      stdoutBuffer: "",
      stream: null,
      activeGeneration: null,
      generationNormalizer: null,
      generationSequence: 0,
      generation: null,
      stopping: false,
      pendingRequests: new Map(),
      statsTimer: null,
    };
    this.processes.set(id, record);
    if (resolvedFile) this.bySessionFile.set(resolvedFile, id);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(record, chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.publish(record, { type: "runtime_stderr", message: String(chunk) }));
    child.once("spawn", () => {
      record.status = "running";
      record.activity = deriveCoarseActivity(record);
      this.touchActivity(record);
      this.publishState(record);
      this.send(record.id, { type: "get_state" });
    });
    child.once("error", (error) => {
      record.status = "failed";
      record.active = false;
      record.activity = "failed";
      record.activityDetail = error.message;
      for (const pending of record.pendingRequests.values()) pending.reject(error);
      record.pendingRequests.clear();
      this.ingestGenerationEvent(record, { type: "runtime_error", message: error.message });
      this.publish(record, { type: "runtime_error", message: error.message });
      this.publishState(record);
    });
    child.once("exit", (code, signal) => {
      record.status = "stopped";
      record.active = false;
      record.stopping = false;
      record.activity = "idle";
      record.hostUiRequests = [];
      if (record.sessionFile) this.bySessionFile.delete(record.sessionFile);
      for (const pending of record.pendingRequests.values()) pending.reject(new Error("Pi process exited before replying"));
      record.pendingRequests.clear();
      if (record.statsTimer) clearTimeout(record.statsTimer);
      this.ingestGenerationEvent(record, {
        type: "runtime_exit",
        message: `Pi process exited (${signal || code || "unknown"})`,
      });
      this.publish(record, { type: "runtime_exit", code, signal });
      this.emit("process_removed", { id: record.id, chatId: record.chatId });
      this.processes.delete(record.id);
    });
    this.emit("process_changed", { record, reason: "created" });
    return record;
  }

  handleStdout(record, chunk) {
    record.stdoutBuffer += chunk;
    const lines = record.stdoutBuffer.split("\n");
    record.stdoutBuffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        this.captureSession(record, event);
        if (event.type === "response" && event.id && record.pendingRequests.has(event.id)) {
          const pending = record.pendingRequests.get(event.id);
          record.pendingRequests.delete(event.id);
          clearTimeout(pending.timer);
          if (event.success === false) pending.reject(Object.assign(new Error(event.error || event.message || "Pi RPC request failed"), { response: event }));
          else {
            this.ingestResponseData(record, event);
            pending.resolve(event);
          }
          continue;
        }
        if (event.type === "agent_start") {
          record.active = true;
          if (record.generation) record.generation.settled = false;
        }
        if (event.type === "agent_end") {
          record.active = false;
          if (record.generation && !event.willRetry) record.generation.settled = true;
        }
        if (event.type === "agent_settled") {
          record.active = false;
          if (record.generation) record.generation.settled = true;
        }

        this.ingestGenerationEvent(record, event);

        if (event.type === "extension_ui_request" && isBlockingHostUi(event)) {
          applyActivityEvent(record, event);
          this.publishGeneration(record, event);
          this.publishState(record);
          continue;
        }

        if (event.type === "message_start" && event.message?.role === "assistant") {
          if (record.generation?.closed) continue;
          record.stream = { chunks: [], generationId: record.generation?.id || null };
          applyActivityEvent(record, event);
          this.publishGeneration(record, event);
          continue;
        }
        const delta = event.assistantMessageEvent;
        if (event.type === "message_update" && delta?.type === "text_delta" && record.stream) {
          this.handleTextDelta(record, delta.delta || "");
          continue;
        }
        if (event.type === "message_end" && event.message?.role === "assistant") {
          this.captureLastRequestUsage(record, event.message);
          this.finishAssistantMessage(record, event);
          continue;
        }

        const activityChanged = applyActivityEvent(record, event);
        this.publishGeneration(record, event);
        if (activityChanged || ["agent_start", "agent_end", "queue_update", "compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end"].includes(event.type)) {
          record.activity = deriveCoarseActivity(record);
          this.publishState(record);
        }
        if (event.type === "agent_end" && record.status === "running") {
          this.send(record.id, { type: "get_state" });
          this.scheduleContextRefresh(record);
        }
        if (event.type === "compaction_end" && record.status === "running") {
          this.scheduleContextRefresh(record, { afterCompaction: true });
        }
      } catch {
        this.publish(record, { type: "runtime_stdout", message: line });
      }
    }
  }

  captureSession(record, event) {
    const sessionFile = event.sessionFile || event.data?.sessionFile || event.result?.sessionFile;
    const sessionId = event.sessionId || event.data?.sessionId || event.result?.sessionId;
    let associated = false;
    if (sessionFile) {
      const resolved = path.resolve(sessionFile);
      if (record.sessionFile && record.sessionFile !== resolved) this.bySessionFile.delete(record.sessionFile);
      if (record.sessionFile !== resolved) associated = true;
      record.sessionFile = resolved;
      this.bySessionFile.set(resolved, record.id);
    }
    if (sessionId) record.sessionId = sessionId;
    if (associated) this.emit("process_changed", { record, reason: "session_associated" });
  }

  ingestResponseData(record, event) {
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (event.command === "get_state") {
      if (data.sessionFile) this.captureSession(record, { sessionFile: data.sessionFile, sessionId: data.sessionId });
      if (data.isCompacting != null) record.compacting = Boolean(data.isCompacting);
      // Assign isStreaming directly — never OR with prior active, or idle never sticks.
      // Do not settle the generation from a polled snapshot: isStreaming can be false
      // during willRetry gaps and before the first token after prompt().
      if (data.isStreaming != null && !record.stopping) {
        record.active = Boolean(data.isStreaming);
      }
      if (data.model?.provider && data.model?.id) record.model = `${data.model.provider}/${data.model.id}`;
      if (data.thinkingLevel != null) record.thinkingLevel = data.thinkingLevel;
      record.activity = deriveCoarseActivity(record);
      this.emit("process_changed", { record, reason: "state" });
    }
    if (event.command === "get_session_stats" && data.contextUsage) {
      this.applyContextUsage(record, data.contextUsage, "pi-stats");
    }
  }

  captureLastRequestUsage(record, message) {
    const usage = message?.usage;
    if (!usage || typeof usage !== "object") return;
    record.contextUsage = {
      ...record.contextUsage,
      lastRequestUsage: {
        input: usage.input ?? usage.inputTokens ?? null,
        output: usage.output ?? usage.outputTokens ?? null,
        cacheRead: usage.cacheRead ?? usage.cachedInputTokens ?? null,
        cacheWrite: usage.cacheWrite ?? null,
        totalTokens: usage.totalTokens ?? null,
        cost: usage.cost || null,
      },
    };
  }

  applyContextUsage(record, usage, source = "pi-stats") {
    if (!usage || typeof usage !== "object") return;
    const tokens = usage.tokens == null ? null : Number(usage.tokens);
    const contextWindow = usage.contextWindow == null ? null : Number(usage.contextWindow);
    const percent = usage.percent == null ? null : Number(usage.percent);
    record.contextUsage = {
      ...record.contextUsage,
      tokens: Number.isFinite(tokens) ? tokens : null,
      contextWindow: Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null,
      percent: Number.isFinite(percent) ? percent : null,
      reportedAt: new Date().toISOString(),
      source,
    };
    this.publish(record, { type: "context_usage", contextUsage: record.contextUsage });
  }

  scheduleContextRefresh(record, { afterCompaction = false } = {}) {
    if (!["starting", "running"].includes(record.status)) return;
    if (afterCompaction) {
      record.contextUsage = {
        ...record.contextUsage,
        tokens: null,
        percent: null,
        reportedAt: new Date().toISOString(),
        source: "unknown",
      };
      this.publish(record, { type: "context_usage", contextUsage: record.contextUsage });
    }
    if (record.statsTimer) clearTimeout(record.statsTimer);
    record.statsTimer = setTimeout(() => {
      record.statsTimer = null;
      this.refreshContextUsage(record.id).catch(() => {});
    }, afterCompaction ? 50 : 100);
    record.statsTimer.unref?.();
  }

  async refreshContextUsage(id) {
    const record = this.processes.get(id);
    if (!record || !["starting", "running"].includes(record.status)) return null;
    try {
      const response = await this.request(id, { type: "get_session_stats" }, { timeout: 3000 });
      if (response?.data?.contextUsage) this.applyContextUsage(record, response.data.contextUsage, "pi-stats");
      return record.contextUsage;
    } catch {
      return null;
    }
  }

  handleTextDelta(record, delta) {
    const stream = record.stream;
    const generation = record.generation;
    stream.chunks.push(delta);
    this.publishGeneration(record, { type: "assistant_stream_delta", delta }, generation);
  }

  finishAssistantMessage(record, event) {
    const stream = record.stream;
    const generation = record.generation;
    const streamedContent = stream?.chunks.join("") || "";
    const content = Array.isArray(event.message.content)
      ? event.message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n")
      : String(event.message.content || streamedContent);
    const responseContent = content || streamedContent;
    const finalContent = generation?.continuationBase
      ? mergeContinuation(generation.continuationBase, responseContent)
      : responseContent;
    this.publishGeneration(record, {
      type: "assistant_stream_final",
      message: event.message,
      content: finalContent,
      usage: event.message?.usage || null,
    }, generation);
    record.stream = null;
  }

  beginActiveGeneration(record, generationId, continuation) {
    const previous = {
      activeGeneration: record.activeGeneration,
      generationNormalizer: record.generationNormalizer,
    };
    record.generationNormalizer = createPiEventNormalizer(generationId);
    const [started] = record.generationNormalizer.normalize({
      type: "generation_started",
      continuation,
    });
    record.activeGeneration = reduceActiveGeneration(null, started);
    return { previous, started };
  }

  restoreActiveGeneration(record, previous) {
    record.activeGeneration = previous.activeGeneration;
    record.generationNormalizer = previous.generationNormalizer;
  }

  ingestGenerationEvent(record, source, { allowClosed = false } = {}) {
    if (!record.generationNormalizer || !record.activeGeneration) return [];
    if (record.generation?.closed && !allowClosed) return [];
    const events = record.generationNormalizer.normalize(source);
    for (const event of events) {
      record.activeGeneration = reduceActiveGeneration(record.activeGeneration, event);
      this.publishTransient(record, event);
    }
    return events;
  }

  currentGenerationResume(record) {
    if (!record?.activeGeneration || TERMINAL_GENERATION_STATUSES.has(record.activeGeneration.status)) return null;
    return generationResumeEvent(record.activeGeneration);
  }

  send(id, value) {
    const record = this.processes.get(id);
    if (!record || !["starting", "running"].includes(record.status)) throw new Error("Pi session process is not running");
    const line = typeof value === "string" ? value : JSON.stringify(value);
    record.child.stdin.write(`${line}\n`);
    if (typeof value === "object" && value?.type === "prompt") {
      setTimeout(() => {
        if (record.status === "running") this.send(record.id, { type: "get_state" });
      }, 250);
    }
  }

  request(id, value, { timeout = 5000 } = {}) {
    const record = this.processes.get(id);
    if (!record || !["starting", "running"].includes(record.status)) return Promise.reject(new Error("Pi session process is not running"));
    const requestId = value.id || `conduit_${++this.requestSequence}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        record.pendingRequests.delete(requestId);
        const error = new Error(`Pi RPC ${value.type} timed out`);
        error.code = "rpc_timeout";
        reject(error);
      }, timeout);
      record.pendingRequests.set(requestId, { resolve, reject, timer });
      try { this.send(id, { ...value, id: requestId }); }
      catch (error) {
        clearTimeout(timer);
        record.pendingRequests.delete(requestId);
        reject(error);
      }
    });
  }

  async waitForSession(id, timeout = 5000) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    if (!record.sessionFile) await this.request(id, { type: "get_state" }, { timeout });
    if (!record.sessionFile) throw new Error("Pi did not report a session file");
    return record;
  }

  /** Persist a display name via the live writer's public RPC (do not dual-write JSONL). */
  async setSessionName(id, name) {
    await this.request(id, { type: "set_session_name", name: String(name || "").trim() });
  }

  async getAvailableModels(id) {
    const response = await this.request(id, { type: "get_available_models" });
    return Array.isArray(response.data?.models) ? response.data.models : [];
  }

  async getModelState(id) {
    const response = await this.request(id, { type: "get_state" });
    const record = this.processes.get(id);
    return { model: record?.model || null, thinkingLevel: record?.thinkingLevel || "", state: response.data || {} };
  }

  async setModel(id, spec) {
    const [provider, ...modelParts] = String(spec || "").split("/");
    const modelId = modelParts.join("/");
    if (!provider || !modelId) throw Object.assign(new Error("Invalid model specification"), { code: "invalid_model" });
    await this.request(id, { type: "set_model", provider, modelId });
    await this.request(id, { type: "get_state" });
    const record = this.processes.get(id);
    return { model: record?.model || null, thinkingLevel: record?.thinkingLevel || "" };
  }

  async setThinkingLevel(id, level) {
    await this.request(id, { type: "set_thinking_level", level });
    await this.request(id, { type: "get_state" });
    const record = this.processes.get(id);
    return { model: record?.model || null, thinkingLevel: record?.thinkingLevel || "" };
  }

  prompt(id, message, { continuationBase = "", streamingBehavior = null } = {}) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    if (record.stopping) throw Object.assign(new Error("Pi is still stopping the previous response"), { code: "generation_stopping" });
    // Steer/follow-up into an open turn keeps the existing generating slot.
    if (streamingBehavior !== "steer" && streamingBehavior !== "followUp") {
      this.assertCanStartGeneration(record);
    }
    const generationId = `g${++record.generationSequence}`;
    const previousGeneration = record.generation;
    const structured = this.beginActiveGeneration(record, generationId, Boolean(continuationBase));
    record.generation = { id: generationId, closed: false, settled: false, continuationBase };
    record.activity = "working";
    try {
      const payload = { type: "prompt", message };
      if (streamingBehavior === "steer" || streamingBehavior === "followUp") {
        payload.streamingBehavior = streamingBehavior;
      }
      this.send(id, payload);
    } catch (error) {
      record.generation = previousGeneration;
      this.restoreActiveGeneration(record, structured.previous);
      throw error;
    }
    this.publish(record, structured.started);
    this.publishState(record);
    return generationId;
  }

  async promptAccepted(id, message, { continuationBase = "", streamingBehavior = null } = {}) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    if (record.stopping) throw Object.assign(new Error("Pi is still stopping the previous response"), { code: "generation_stopping" });
    if (streamingBehavior !== "steer" && streamingBehavior !== "followUp") this.assertCanStartGeneration(record);
    const generationId = `g${++record.generationSequence}`;
    const previousGeneration = record.generation;
    const structured = this.beginActiveGeneration(record, generationId, Boolean(continuationBase));
    record.generation = { id: generationId, closed: false, settled: false, continuationBase };
    record.activity = "working";
    const payload = { type: "prompt", message };
    if (streamingBehavior === "steer" || streamingBehavior === "followUp") payload.streamingBehavior = streamingBehavior;
    try {
      await this.request(id, payload);
    } catch (error) {
      record.generation = previousGeneration;
      this.restoreActiveGeneration(record, structured.previous);
      record.activity = deriveCoarseActivity(record);
      this.publishState(record);
      throw error;
    }
    this.publish(record, structured.started);
    this.publishState(record);
    return generationId;
  }

  async queueAccepted(id, type, message) {
    if (!new Set(["steer", "follow_up"]).has(type)) throw new Error("Invalid queued prompt type");
    await this.request(id, { type, message });
  }

  async abortGeneration(id, generationId = null) {
    const record = this.processes.get(id);
    const generation = record?.generation;
    if (!record || !generation || (generationId && generation.id !== generationId)) return null;
    generation.closed = true;
    record.stopping = true;
    record.activity = "stopping";
    generation.partial = record.stream?.chunks.join("") || generation.partial || "";
    record.stream = null;
    this.ingestGenerationEvent(record, { type: "generation_stopping" }, { allowClosed: true });
    this.publishState(record);
    let processTerminated = false;
    try {
      await this.request(id, { type: "abort" }, { timeout: 250 });
    } catch {
      processTerminated = true;
      record.status = "stopped";
      record.active = false;
      record.child.kill("SIGKILL");
      if (record.sessionFile) this.bySessionFile.delete(record.sessionFile);
    }
    record.stopping = false;
    record.activity = processTerminated || record.status === "stopped" ? "idle" : deriveCoarseActivity(record);
    this.ingestGenerationEvent(record, {
      type: "generation_stopped",
      status: "stopped",
      processTerminated,
    }, { allowClosed: true });
    this.publishState(record);
    return { generationId: generation.id, processTerminated };
  }

  respondHostUi(id, response) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    const requestId = response.id || response.requestId;
    if (!requestId) throw Object.assign(new Error("Host UI response requires id"), { code: "host_ui_id_required" });
    const payload = { type: "extension_ui_response", id: requestId };
    if (response.cancelled || response.dismissed) payload.cancelled = true;
    else if (typeof response.confirmed === "boolean") payload.confirmed = response.confirmed;
    else if (response.value != null) payload.value = String(response.value);
    else throw Object.assign(new Error("Host UI response requires confirmed, value, or cancelled"), { code: "host_ui_response_invalid" });
    this.send(id, payload);
    record.hostUiRequests = record.hostUiRequests.filter((item) => item.id !== requestId);
    applyActivityEvent(record, { type: "extension_ui_resolved", requestId });
    record.activity = deriveCoarseActivity(record);
    this.publish(record, { type: "extension_ui_resolved", requestId });
    this.publishState(record);
  }

  async fork(id, entryId) {
    const response = await this.request(id, { type: "fork", entryId });
    if (response.data?.cancelled) throw Object.assign(new Error("Pi cancelled the fork"), { code: "fork_cancelled" });
    await this.request(id, { type: "get_state" });
    const record = this.processes.get(id);
    if (!record?.sessionFile) throw new Error("Pi did not report the forked session file");
    return { text: response.data?.text || "", sessionFile: record.sessionFile, sessionId: record.sessionId || null };
  }

  attach(id, socket) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    record.clients.add(socket);
    record.delivery.set(socket, { pending: new Map(), pendingOrder: [], structural: [], flushTimer: null, recoveryTimer: null, paused: false });
    record.lastClientAt = this.now();
    this.touchActivity(record);
    socket.once("close", () => {
      record.clients.delete(socket);
      this.clearDelivery(record, socket);
      record.lastClientAt = this.now();
      this.emit("process_changed", { record, reason: "client_detach" });
    });
    this.emit("process_changed", { record, reason: "client_attach" });
    return this.currentGenerationResume(record);
  }

  publish(record, event) {
    this.touchActivity(record);
    record.events.push(event);
    if (record.events.length > 500) record.events.splice(0, record.events.length - 500);
    this.deliver(record, event);
  }

  publishTransient(record, event) {
    this.touchActivity(record);
    this.deliver(record, event);
  }

  deliver(record, event) {
    for (const socket of record.clients) {
      this.deliverToClient(record, socket, event);
    }
    this.emit("event", { record, event });
  }

  clearDelivery(record, socket) {
    const state = record.delivery.get(socket);
    if (!state) return;
    if (state.flushTimer) clearTimeout(state.flushTimer);
    if (state.recoveryTimer) clearTimeout(state.recoveryTimer);
    record.delivery.delete(socket);
  }

  sendClientEvent(socket, event) {
    if (!socketIsOpen(socket)) return false;
    socket.send(JSON.stringify(event));
    return true;
  }

  pauseDelivery(record, socket, state) {
    state.paused = true;
    state.pending.clear();
    state.pendingOrder = [];
    if (state.flushTimer) clearTimeout(state.flushTimer);
    state.flushTimer = null;
    this.scheduleDeliveryRecovery(record, socket, state);
  }

  scheduleDeliveryRecovery(record, socket, state) {
    if (state.recoveryTimer) return;
    const recover = () => {
      state.recoveryTimer = null;
      if (!record.clients.has(socket) || !socketIsOpen(socket)) return this.clearDelivery(record, socket);
      if (socketBufferedAmount(socket) > this.socketLowWaterMark) {
        state.recoveryTimer = setTimeout(recover, this.socketRecoveryPollMs);
        state.recoveryTimer.unref?.();
        return;
      }
      state.paused = false;
      const resume = this.currentGenerationResume(record);
      if (resume && !this.sendClientEvent(socket, resume)) return;
      this.flushDelivery(record, socket, state);
    };
    state.recoveryTimer = setTimeout(recover, this.socketRecoveryPollMs);
    state.recoveryTimer.unref?.();
  }

  flushDelivery(record, socket, state = record.delivery.get(socket)) {
    if (!state || state.paused || !socketIsOpen(socket)) return;
    if (state.flushTimer) clearTimeout(state.flushTimer);
    state.flushTimer = null;
    if (socketBufferedAmount(socket) > this.socketHighWaterMark) return this.pauseDelivery(record, socket, state);
    const pending = state.pendingOrder.map((key) => state.pending.get(key)).filter(Boolean);
    state.pending.clear();
    state.pendingOrder = [];
    const queued = [...state.structural, ...pending];
    state.structural = [];
    for (let index = 0; index < queued.length; index += 1) {
      if (socketBufferedAmount(socket) > this.socketHighWaterMark) {
        state.structural.push(...queued.slice(index).filter((event) => !deliveryDeltaKey(event)));
        return this.pauseDelivery(record, socket, state);
      }
      if (!this.sendClientEvent(socket, queued[index])) return this.clearDelivery(record, socket);
    }
  }

  scheduleDeliveryFlush(record, socket, state) {
    if (state.flushTimer || state.paused) return;
    state.flushTimer = setTimeout(() => this.flushDelivery(record, socket, state), this.deliveryFlushMs);
    state.flushTimer.unref?.();
  }

  deliverToClient(record, socket, event) {
    const state = record.delivery.get(socket);
    if (!state || !socketIsOpen(socket)) return;
    const key = deliveryDeltaKey(event);
    if (state.paused) {
      if (!key) state.structural.push(event);
      return;
    }
    if (socketBufferedAmount(socket) > this.socketHighWaterMark) {
      if (!key) state.structural.push(event);
      this.pauseDelivery(record, socket, state);
      return;
    }
    if (key) {
      const previous = state.pending.get(key);
      if (previous) state.pending.set(key, mergeDeliveryDelta(previous, event));
      else {
        state.pending.set(key, event);
        state.pendingOrder.push(key);
      }
      this.scheduleDeliveryFlush(record, socket, state);
      return;
    }
    this.flushDelivery(record, socket, state);
    if (socketBufferedAmount(socket) > this.socketHighWaterMark) {
      state.structural.push(event);
      return this.pauseDelivery(record, socket, state);
    }
    this.sendClientEvent(socket, event);
  }

  publishGeneration(record, event, generation = record.generation) {
    if (generation?.closed) return false;
    this.publish(record, generation ? { ...event, generationId: generation.id } : event);
    return true;
  }

  publishState(record) {
    record.activity = deriveCoarseActivity(record);
    this.publish(record, { type: "runtime_state", session: this.view(record) });
    this.emit("process_changed", { record, reason: "state" });
  }

  stop(id) {
    const record = this.processes.get(id);
    if (!record || record.status === "stopped") return false;
    record.child.kill("SIGTERM");
    return true;
  }

  async stopAndWait(id) {
    const record = this.processes.get(id);
    if (!record || !["starting", "running"].includes(record.status)) return false;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => record.child.kill("SIGKILL"), 3000);
      timeout.unref();
      record.child.once("exit", () => {
        clearTimeout(timeout);
        resolve(true);
      });
      record.child.kill("SIGTERM");
    });
  }

  view(record) {
    const {
      child, clients, stdoutBuffer, events, stream, activeGeneration, generationNormalizer,
      pendingRequests, generation, statsTimer,
      cwd, sessionDir, createdAtMs, lastActivityAt, lastClientAt, ...safe
    } = record;
    return {
      id: safe.id,
      chatId: safe.chatId,
      projectId: safe.projectId,
      projectSlug: safe.projectSlug,
      sessionFile: safe.runtime?.kind === "native_pi" ? null : safe.sessionFile,
      sessionId: safe.runtime?.kind === "native_pi" ? null : safe.sessionId || null,
      model: safe.model,
      thinkingLevel: safe.thinkingLevel,
      template: safe.template || null,
      runtime: safe.runtime || null,
      binaryVersion: safe.binaryVersion || null,
      trustPosture: safe.trustPosture || null,
      status: safe.status,
      active: safe.active,
      activity: safe.activity || deriveCoarseActivity(record),
      activityDetail: safe.activityDetail || null,
      stopping: Boolean(safe.stopping),
      compacting: Boolean(safe.compacting),
      retrying: Boolean(safe.retrying),
      retry: safe.retry || null,
      hostUiRequests: [...(safe.hostUiRequests || [])],
      queue: safe.queue || emptyQueue(),
      contextUsage: safe.contextUsage || emptyContextUsage(),
      createdAt: safe.createdAt,
      updatedAt: safe.updatedAt,
      lastClientAt: lastClientAt || null,
      lastActivityAt: lastActivityAt || null,
      generation: generation
        ? { id: generation.id, closed: generation.closed, settled: Boolean(generation.settled) }
        : null,
      clientCount: clients.size,
    };
  }

  list() {
    return [...this.processes.values()]
      .filter((record) => record.status !== "stopped")
      .map((record) => this.view(record));
  }

  get(id) {
    return this.processes.get(id) || null;
  }

  getByChatId(chatId) {
    return [...this.processes.values()].find((record) => record.chatId === chatId
      && ["starting", "running"].includes(record.status)) || null;
  }
}
