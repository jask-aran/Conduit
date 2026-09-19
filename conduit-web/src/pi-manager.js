import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { projectEnvironment } from "./project-environment.js";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { buildPiEnvironment, buildPiResourceArgs, resolvePiProcess } from "../../scripts/pi-runtime.mjs";
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
import { projectSessionEntries, readSessionPage } from "./session-store.js";
import { messageClose, messageDrop, messageOpen, toolClose, toolOpen } from "./harnesses/transcript-ops.js";
import { PI_CAPABILITIES } from "./pi-capabilities.js";
import { PiCommandCatalog } from "./pi-command-catalog.js";
import { ChatLogs, isLoggedEvent } from "./server/chat-log.js";
import { messageIsInterim } from "./active-generation.js";

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

function numericValue(value, fallback = null) {
  if (value == null) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeUsageCost(cost) {
  if (!cost || typeof cost !== "object") return null;
  return {
    input: numericValue(cost.input),
    output: numericValue(cost.output),
    cacheRead: numericValue(cost.cacheRead),
    cacheWrite: numericValue(cost.cacheWrite),
    total: numericValue(cost.total),
  };
}

function normalizeRequestUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return {
    input: numericValue(usage.input ?? usage.inputTokens),
    output: numericValue(usage.output ?? usage.outputTokens),
    cacheRead: numericValue(usage.cacheRead ?? usage.cachedInputTokens),
    cacheWrite: numericValue(usage.cacheWrite),
    cacheWrite1h: numericValue(usage.cacheWrite1h),
    reasoning: numericValue(usage.reasoning),
    totalTokens: numericValue(usage.totalTokens),
    cost: normalizeUsageCost(usage.cost),
  };
}

function normalizeSessionStats(stats) {
  if (!stats || typeof stats !== "object") return null;
  const tokens = stats.tokens && typeof stats.tokens === "object" ? stats.tokens : null;
  if (!tokens && stats.userMessages == null && stats.assistantMessages == null) return null;
  return {
    userMessages: numericValue(stats.userMessages, 0),
    assistantMessages: numericValue(stats.assistantMessages, 0),
    toolCalls: numericValue(stats.toolCalls, 0),
    toolResults: numericValue(stats.toolResults, 0),
    totalMessages: numericValue(stats.totalMessages, 0),
    tokens: {
      input: numericValue(tokens?.input, 0),
      output: numericValue(tokens?.output, 0),
      cacheRead: numericValue(tokens?.cacheRead, 0),
      cacheWrite: numericValue(tokens?.cacheWrite, 0),
      total: numericValue(tokens?.total, 0),
    },
    cost: numericValue(stats.cost, 0),
  };
}

function promptTokenParts(usage) {
  if (!usage || typeof usage !== "object") return null;
  const input = numericValue(usage.input ?? usage.inputTokens);
  if (input == null) return null;
  const cacheRead = numericValue(usage.cacheRead ?? usage.cachedInputTokens, 0);
  const cacheWrite = numericValue(usage.cacheWrite, 0);
  if (cacheRead == null || cacheWrite == null) return null;
  return {
    promptTokens: input + cacheRead + cacheWrite,
    cacheRead,
  };
}

function emptyCacheStats() {
  return {
    eligibleTokens: 0,
    cacheHits: 0,
    cacheMissedTokens: 0,
    eligibleRequests: 0,
    eligibleHitRate: null,
  };
}

function finishCacheStats(stats) {
  return {
    ...stats,
    eligibleHitRate: stats.eligibleTokens > 0 ? stats.cacheHits / stats.eligibleTokens : null,
  };
}

function cacheStatsFromEntries(entries) {
  let previousPromptTokens = null;
  const stats = emptyCacheStats();
  for (const entry of entries || []) {
    if (entry.type === "compaction" || entry.type === "branch_summary") {
      previousPromptTokens = null;
      continue;
    }
    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    const request = promptTokenParts(entry.message.usage);
    if (!request) continue;
    if (previousPromptTokens != null) {
      const eligibleTokens = Math.min(previousPromptTokens, request.promptTokens);
      const cacheHits = Math.min(request.cacheRead, eligibleTokens);
      stats.eligibleTokens += eligibleTokens;
      stats.cacheHits += cacheHits;
      stats.cacheMissedTokens += Math.max(0, eligibleTokens - cacheHits);
      stats.eligibleRequests += 1;
    }
    previousPromptTokens = request.promptTokens;
  }
  return {
    stats: stats.eligibleRequests > 0 ? finishCacheStats(stats) : null,
    previousPromptTokens,
  };
}

function restoreCacheStats(sessionFile, cwd) {
  if (!sessionFile) return { stats: null, previousPromptTokens: null };
  try {
    const session = SessionManager.open(sessionFile, path.dirname(sessionFile), cwd);
    return cacheStatsFromEntries(session.getEntries());
  } catch {
    return { stats: null, previousPromptTokens: null };
  }
}

function socketIsOpen(socket) {
  return socket?.readyState === socket?.OPEN;
}

function socketBufferedAmount(socket) {
  const amount = Number(socket?.bufferedAmount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

export function deliveryDeltaKey(event) {
  if (event.type === "content_block_delta") {
    return `structured:${event.generationId}:${event.messageId}:${event.blockKind}:${event.contentIndex}`;
  }
  return null;
}

export function mergeDeliveryDelta(previous, next) {
  if (next.type === "content_block_delta") {
    return { ...next, delta: `${previous.delta || ""}${next.delta || ""}` };
  }
  return next;
}

const RECONSTRUCTIBLE_DELIVERY_TYPES = new Set([
  "agent_start", "agent_end", "agent_settled", "runtime_exit", "runtime_error",
  "message_start", "message_update", "message_end",
  "tool_execution_start", "tool_execution_update", "tool_execution_end",
  "extension_ui_request", "extension_ui_resolved",
  "queue_update", "compaction_start", "compaction_end", "auto_retry_start", "auto_retry_end",
  "runtime_state", "context_usage", "session_checkpoint",
]);

function deliveryNotificationKey(event) {
  if (deliveryDeltaKey(event) || event.seq != null || RECONSTRUCTIBLE_DELIVERY_TYPES.has(event.type)) return null;
  if (["runtime_stdout", "runtime_stderr", "history_forked", "history_truncated"].includes(event.type)) return event.type;
  return `unknown:${event.type}`;
}

function deliveryEventBytes(event) {
  return Buffer.byteLength(JSON.stringify(event));
}

/**
 * Record the harness conversation verbatim, when asked.
 *
 * Off unless `CONDUIT_PI_TRACE` names a file. What the transcript ends up
 * looking like depends on the order Pi says things in, so a test that guesses
 * at that order proves nothing; this is how a real sequence is captured and
 * turned into one.
 */
function traceHarness(direction, chatId, line) {
  if (!process.env.CONDUIT_PI_TRACE) return;
  try {
    fsSync.appendFileSync(process.env.CONDUIT_PI_TRACE,
      `${JSON.stringify({ at: Date.now(), direction, chatId, line })}\n`);
  } catch { /* tracing never breaks a turn */ }
}

const ABORT_TERMINAL_EVENTS = new Set(["tool_execution_end", "message_end", "turn_end"]);
/** An answer slower than this is worth a line in the log; it is what a slow chat feels like. */
const SLOW_RPC_MS = 2_000;
/** How long a request will wait for a freshly spawned Pi to say anything at all. */
const BOOT_WAIT_MS = 20_000;

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
    deliveryMaxNotifications = 32,
    deliveryMaxNotificationBytes = 64 * 1024,
    now = () => Date.now(),
    serializeEvent = JSON.stringify,
    // The chat-level event order. Shared with the rest of the server, so a
    // client is caught up from the same numbers whoever published them.
    logs = new ChatLogs(),
  } = {}) {
    super();
    if (!agentDir) throw new Error("PiManager requires an isolated agent directory");
    this.command = command;
    this.spawnImpl = spawnImpl;
    this.agentDir = agentDir;
    this.template = template;
    this.commandCatalog = new PiCommandCatalog(agentDir);
    this.processes = new Map();
    this.logs = logs;
    this.byChatId = new Map();
    this.bySessionFile = new Map();
    this.requestSequence = 0;
    this.now = now;
    this.serializeEvent = serializeEvent;
    this.maxLiveProcesses = Math.max(1, Math.trunc(Number(maxLiveProcesses) || 12));
    this.maxGeneratingProcesses = Math.max(1, Math.trunc(Number(maxGeneratingProcesses) || 2));
    this.idleProcessTtlMs = Math.max(30_000, Math.trunc(Number(idleProcessTtlMs) || 120_000));
    this.socketHighWaterMark = Math.max(1024, Math.trunc(Number(socketHighWaterMark) || 256 * 1024));
    this.socketLowWaterMark = Math.floor(this.socketHighWaterMark / 2);
    this.deliveryFlushMs = Math.max(0, Math.trunc(Number(deliveryFlushMs) || 16));
    this.socketRecoveryPollMs = Math.max(10, Math.trunc(Number(socketRecoveryPollMs) || 50));
    this.deliveryMaxNotifications = Math.max(1, Math.trunc(Number(deliveryMaxNotifications) || 32));
    this.deliveryMaxNotificationBytes = Math.max(1024, Math.trunc(Number(deliveryMaxNotificationBytes) || 64 * 1024));
    this.capacityQueue = Promise.resolve();
    this.reaperTimer = null;
    if (reaperIntervalMs > 0) {
      this.reaperTimer = setInterval(() => {
        this.reapIdleProcesses().catch(() => {});
      }, reaperIntervalMs);
      this.reaperTimer.unref?.();
    }
  }

  listAvailableCommands({ cwd, template = this.template }) {
    return this.commandCatalog.list({ cwd, template });
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
    // Neither is a process somebody is waiting on an answer from. Its activity
    // says idle -- a model list is not a turn -- but stopping it answers the
    // question with "the agent process exited before replying", which is what a
    // chat opening at the moment the cap was hit, or the reaper's clock ran
    // out, looked like from the outside.
    if (record.pendingRequests?.size > 0) return true;
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

  /**
   * Mark the start of real conversation work.
   *
   * Distinct from touchActivity, which every published event moves -- an idle
   * Pi emits often enough on its own to hold lastActivityAt permanently within
   * a two-minute window, so nothing measured against it can ever time out.
   * This clock moves only when a turn begins, which is what "this chat is still
   * in use" actually means, and it is what the reaper judges an attached
   * process by.
   */
  touchTurn(record) {
    if (!record) return;
    record.lastTurnAt = this.now();
    this.touchActivity(record);
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
      if (!this.isReclaimable(record, { ignoreClients: true })) return false;
      // An attached client no longer keeps a process alive for ever, but the
      // clock that decides its fate has to change with it. lastClientAt stops
      // advancing the moment a client attaches, so judging an attached process
      // by it would reap a chat for nothing worse than being open on screen --
      // and lastActivityAt is no better in the other direction, because an idle
      // Pi emits often enough to keep resetting it. An attached process is
      // judged on when its last turn began; an unattached one is still measured
      // from when its last client left. A generating process is never a
      // candidate either way -- isReclaimable rejects anything isBusy.
      const idleSince = record.clients.size > 0
        ? record.lastTurnAt ?? record.createdAtMs ?? 0
        : record.lastClientAt ?? record.createdAtMs ?? 0;
      return idleSince <= cutoff;
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
        if (chatId && existing.chatId !== chatId) {
          if (this.byChatId.get(existing.chatId) === existing.id) this.byChatId.delete(existing.chatId);
          existing.chatId = chatId;
          this.byChatId.set(chatId, existing.id);
        }
        this.touchActivity(existing);
        return existing;
      }
      this.bySessionFile.delete(resolvedFile);
      this.processes.delete(existingId);
      if (this.byChatId.get(existing?.chatId) === existingId) this.byChatId.delete(existing.chatId);
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
    const processSpec = resolvePiProcess(launchSpec?.command || this.command, args);
    const restoredCache = restoreCacheStats(resolvedFile, launchSpec?.cwd || project.workingRoot);
    const child = this.spawnImpl(processSpec.command, processSpec.args, {
      cwd: launchSpec?.cwd || project.workingRoot,
      stdio: ["pipe", "pipe", "pipe"],
      env: projectEnvironment(project, launchSpec?.cwd || project.workingRoot, launchSpec?.env || buildPiEnvironment(this.agentDir)),
    });
    const createdAtMs = this.now();
    const record = {
      id,
      chatId,
      adapterImplementation: "conduit_pi",
      projectId: project.id,
      projectSlug: project.slug,
      cwd: launchSpec?.cwd || project.workingRoot,
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
      sessionStats: null,
      cacheStats: restoredCache.stats,
      cachePreviousPromptTokens: restoredCache.previousPromptTokens,
      clients: new Set(),
      delivery: new Map(),
      events: [],
      createdAt: new Date(createdAtMs).toISOString(),
      createdAtMs,
      updatedAt: new Date(createdAtMs).toISOString(),
      lastActivityAt: createdAtMs,
      lastClientAt: createdAtMs,
      lastTurnAt: createdAtMs,
      stdoutBuffer: "",
      activeGeneration: null,
      generationNormalizer: null,
      generationSequence: 0,
      generation: null,
      stopping: false,
      terminating: false,
      pendingRequests: new Map(),
      pendingQueuedPrompts: [],
      // Names claimed for queued messages, spent in order as Pi writes them.
      queuedMessageIds: [],
      statsTimer: null,
      // Pi is "running" the moment the OS spawns it, which is not the moment it
      // can answer. Restoring a large session takes it seconds, and an RPC sent
      // into that gap sat in its stdin while a five second clock ran out --
      // "Pi RPC get_available_models timed out" on exactly the chats with the
      // most history. This settles when Pi first speaks, and requests wait for
      // it rather than spending their budget on somebody else's boot.
      spoke: false,
      speaking: null,
      announceSpoke: null,
    };
    record.speaking = new Promise((resolve) => { record.announceSpoke = resolve; });
    this.processes.set(id, record);
    if (chatId) this.byChatId.set(chatId, id);
    if (resolvedFile) this.bySessionFile.set(resolvedFile, id);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (!record.spoke) {
        record.spoke = true;
        record.bootMs = this.now() - createdAtMs;
        record.announceSpoke?.();
        // Pi answering for the first time is what "warm" means, and it is the
        // only moment anyone can honestly say so. Everything watching this chat
        // -- the sidebar pill, the composer -- learns it from this one publish.
        record.activity = deriveCoarseActivity(record);
        this.touchActivity(record);
        this.publishState(record);
      }
      this.handleStdout(record, chunk);
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.publish(record, { type: "runtime_stderr", message: String(chunk) }));
    // A deliberate stop can race a best-effort RPC (for example, context stats
    // requested when a WebSocket attaches). Child stdin reports that as EPIPE
    // asynchronously; without a listener Node treats it as a process-fatal
    // unhandled stream error.
    child.stdin?.on?.("error", (error) => {
      if (record.stopping || record.status === "stopped") return;
      for (const pending of record.pendingRequests.values()) pending.reject(error);
      record.pendingRequests.clear();
      this.publish(record, { type: "runtime_error", message: error.message });
    });
    // Spawning is not readiness: the process is alive here, which is what
    // `status` reports, but Pi has not read its session yet and cannot answer.
    // `spoke` carries that second question, and activity answers from it.
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
      // Captured before the flags below reset it. A stop the server asked for
      // must not reach clients looking like a process that fell over: one is a
      // decision to honour, the other is a failure to recover from.
      const deliberate = record.terminating === true;
      record.status = "stopped";
      record.active = false;
      record.stopping = false;
      record.activity = "idle";
      record.hostUiRequests = [];
      if (record.sessionFile) this.bySessionFile.delete(record.sessionFile);
      for (const pending of record.pendingRequests.values()) pending.reject(new Error("The agent process exited before replying"));
      record.pendingRequests.clear();
      if (record.statsTimer) clearTimeout(record.statsTimer);
      // A deliberate stop is process lifecycle, not a failed model request.
      // Publishing a normalized generation failure first made the client
      // freeze a synthetic error turn and show a crash toast before the
      // deliberate runtime_exit arrived and detached it.
      if (!deliberate) {
        this.ingestGenerationEvent(record, {
          type: "runtime_exit",
          message: `Pi process exited (${signal || code || "unknown"})`,
        });
      }
      this.publish(record, { type: "runtime_exit", code, signal, deliberate });
      for (const socket of [...record.clients]) {
        socket.close?.(1012, "Pi process exited");
      }
      this.emit("process_removed", { id: record.id, chatId: record.chatId });
      this.processes.delete(record.id);
      if (this.byChatId.get(record.chatId) === record.id) this.byChatId.delete(record.chatId);
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
        traceHarness("in", record.chatId, line);
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

        if (event.type === "compaction_start" || event.type === "branch_summary") {
          record.cachePreviousPromptTokens = null;
        }

        // Pi runs a turn of its own when it takes a message off its queue: a
        // steer lands after the turn it was aimed at, and an abort makes it
        // take the next one immediately. Conduit never asked for that
        // generation, so without opening one here its events are discarded as
        // belonging to the closed generation, and the reply never arrives.
        if (event.type === "turn_start" && (!record.generation || (record.generation.closed && !record.stopping))) {
          this.beginQueuedGeneration(record);
        }

        this.ingestGenerationEvent(record, event);

        if (event.type === "extension_ui_request" && isBlockingHostUi(event)) {
          applyActivityEvent(record, event);
          this.publishGeneration(record, event);
          this.publishState(record);
          continue;
        }

        if (event.type === "message_start" && event.message?.role === "assistant") {
          applyActivityEvent(record, event);
          continue;
        }
        if (event.type === "message_update" && event.assistantMessageEvent) continue;
        if (event.type === "message_end" && event.message?.role === "assistant") {
          this.captureLastRequestUsage(record, event.message);
          // ingestGenerationEvent already published the normalized
          // assistant_message_completed event. Do not publish the raw Pi
          // message too: assistant settlement has one client protocol.
          continue;
        }
        if (["tool_execution_start", "tool_execution_update", "tool_execution_end"].includes(event.type)) {
          applyActivityEvent(record, event);
          this.publishState(record);
          continue;
        }

        const activityChanged = applyActivityEvent(record, event);
        if (["agent_start", "agent_end", "agent_settled", "runtime_exit"].includes(event.type)) {
          this.publishInternal(record, event);
        } else this.publishGeneration(record, event);
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
    if (event.command === "get_session_stats") {
      const stats = normalizeSessionStats(data);
      if (stats) record.sessionStats = stats;
      if (data.contextUsage) this.applyContextUsage(record, data.contextUsage, "pi-stats");
    }
  }

  captureLastRequestUsage(record, message) {
    const usage = message?.usage;
    if (!usage || typeof usage !== "object") return;
    const normalized = normalizeRequestUsage(usage);
    record.contextUsage = {
      ...record.contextUsage,
      lastRequestUsage: normalized,
    };
    this.captureCacheStats(record, normalized);
    this.publish(record, {
      type: "context_usage",
      contextUsage: record.contextUsage,
      sessionStats: record.sessionStats || null,
      cacheStats: record.cacheStats || null,
    });
  }

  captureCacheStats(record, usage) {
    const request = promptTokenParts(usage);
    if (!request) return;
    if (record.cachePreviousPromptTokens != null) {
      const eligibleTokens = Math.min(record.cachePreviousPromptTokens, request.promptTokens);
      const cacheHits = Math.min(request.cacheRead, eligibleTokens);
      const stats = record.cacheStats || emptyCacheStats();
      stats.eligibleTokens += eligibleTokens;
      stats.cacheHits += cacheHits;
      stats.cacheMissedTokens += Math.max(0, eligibleTokens - cacheHits);
      stats.eligibleRequests += 1;
      record.cacheStats = finishCacheStats(stats);
    }
    record.cachePreviousPromptTokens = request.promptTokens;
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
    this.publish(record, {
      type: "context_usage",
      contextUsage: record.contextUsage,
      sessionStats: record.sessionStats || null,
      cacheStats: record.cacheStats || null,
    });
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
      this.publish(record, {
        type: "context_usage",
        contextUsage: record.contextUsage,
        sessionStats: record.sessionStats || null,
        cacheStats: record.cacheStats || null,
      });
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
      const stats = normalizeSessionStats(response?.data);
      if (stats) record.sessionStats = stats;
      if (response?.data?.contextUsage) this.applyContextUsage(record, response.data.contextUsage, "pi-stats");
      return record.contextUsage;
    } catch {
      return null;
    }
  }

  compact(id) {
    return this.request(id, { type: "compact" }, { timeout: 120_000 });
  }

  beginActiveGeneration(record, generationId, continuationBase, claims = null) {
    // The single chokepoint every turn passes through: a fresh prompt, a steer
    // or follow-up, and a queued generation all begin here.
    this.touchTurn(record);
    const previous = {
      activeGeneration: record.activeGeneration,
      generationNormalizer: record.generationNormalizer,
    };
    record.generationNormalizer = createPiEventNormalizer(generationId, {
      claimMessageId: () => {
        // Every answer says which prompt it answers, so nothing downstream has
        // to work that out from where the row happens to sit.
        const answers = claims?.answersAfter || claims?.user || record.lastQueuedMessageId || null;
        if (claims?.assistant && !claims.assistantUsed) {
          claims.assistantUsed = true;
          this.openMessage(record, claims.assistant, "assistant", { answers });
          return claims.assistant;
        }
        // A turn writes more than one message whenever it calls a tool, and
        // each of those is an entry of its own. Naming only the first left the
        // rest streaming under a name invented for the stream and settling
        // under one derived from the entry -- the same message, twice, until
        // the page was reloaded.
        // Every further message a turn writes is named as it starts -- by the
        // turn's own claim function, or, for a turn Conduit never prompted, by
        // the chat's. Only a chat whose harness names its own messages falls
        // through to an id invented for this stream.
        const named = claims?.claimAnswer?.(claims.answersAfter)
          || record.claimMessage?.("assistant", claims?.answersAfter || null)
          || null;
        if (named) this.openMessage(record, named, "assistant", { answers });
        return named;
      },
    });
    const [started] = record.generationNormalizer.normalize({
      type: "generation_started",
      continuation: Boolean(continuationBase),
      continuationBase,
    });
    record.activeGeneration = reduceActiveGeneration(null, started);
    return { previous, started };
  }

  restoreActiveGeneration(record, previous) {
    record.activeGeneration = previous.activeGeneration;
    record.generationNormalizer = previous.generationNormalizer;
  }

  /**
   * Open a generation for a turn Pi started itself, from its own queue.
   *
   * Conduit did not prompt this turn, so it has no pair of names ready for it.
   * It can still name what the turn writes: the chat's ledger is reachable
   * through the claim function the stream left on the record, and the message
   * being answered is the queued one Pi has just taken. Without this the
   * answers to a follow-up streamed under ids invented for the stream and
   * settled under ids derived from Pi's entries -- the same message, twice.
   */
  beginQueuedGeneration(record) {
    record.pendingQueuedPrompts.shift();
    const generationId = `g${++record.generationSequence}`;
    const claims = record.claimAnswer
      ? { claimAnswer: record.claimAnswer, answersAfter: record.lastQueuedMessageId || null,
        userUsed: true, assistantUsed: true }
      : null;
    const structured = this.beginActiveGeneration(record, generationId, "", claims);
    record.generation = { id: generationId, closed: false, settled: false, continuationBase: "", claims };
    record.active = true;
    record.stopping = false;
    record.activity = "working";
    this.publishTransient(record, structured.started);
    this.publishState(record);
    return generationId;
  }

  ingestGenerationEvent(record, source, { allowClosed = false } = {}) {
    if (!record.generationNormalizer || !record.activeGeneration) return [];
    // A generation being aborted is closed to new work but still owns its own
    // ending. Pi reports the interrupted assistant message after the abort is
    // requested, and discarding it left the turn's text uncommitted - present
    // while streaming, gone the moment the next turn replaced it, back again
    // on reload. Only the terminal events pass: late deltas and a message that
    // starts after the abort are still content the user stopped.
    const finishing = record.generation?.aborting && ABORT_TERMINAL_EVENTS.has(source.type);
    if (record.generation?.closed && !allowClosed && !finishing) return [];
    const events = record.generationNormalizer.normalize(source);
    for (const event of events) {
      record.activeGeneration = reduceActiveGeneration(record.activeGeneration, event);
      this.publishTransient(record, event);
      // The turn's own statements about the transcript, made from the state
      // just reduced: what the message it finished says, and which of the rows
      // it named it never wrote into.
      if (event.type === "assistant_message_completed" && event.messageId) {
        this.closeMessage(record, event.messageId, event.stopReason || null);
      }
      // And what it ran. A tool used to reach the browser only as live
      // activity, which meant a reconnecting client replayed the chat's order
      // and got the messages back without the commands underneath them.
      if (event.type === "tool_execution_started" && this.logFor(record)) {
        this.publish(record, toolOpen({ toolCallId: event.toolCallId, name: event.name,
          input: event.arguments, generationId: record.generation?.id || null }));
      }
      if (event.type === "tool_execution_completed" && this.logFor(record)) {
        this.publish(record, toolClose({ toolCallId: event.toolCallId, output: event.result,
          isError: event.isError, generationId: record.generation?.id || null }));
      }
      if (["generation_stopped", "generation_settled", "generation_failed"].includes(event.type)) {
        this.dropUnwrittenMessages(record);
      }
    }
    return events;
  }

  /**
   * Project the transcript Pi has actually written, newest turns first.
   *
   * Pi's session file is the transcript; Conduit's live model is a
   * reconstruction of it from deltas, and the two drift. Reading gives the
   * caller the version that is true by construction, through the same
   * projection the initial load uses, so there is one reader rather than two.
   *
   * The project comes from the caller because the session file is validated
   * against it. Backends that own their own store ignore it.
   */
  async readTranscript(id, { project, turns = 1, characterLimit = 50_000 } = {}) {
    const record = this.processes.get(id);
    if (!record?.sessionFile || !project) return { messages: [] };
    const page = await readSessionPage(record.sessionFile, project, { turnLimit: turns, characterLimit });
    return projectSessionEntries(page.entries);
  }

  currentGenerationResume(record) {
    if (!record?.activeGeneration) return null;
    return generationResumeEvent(record.activeGeneration);
  }

  send(id, value) {
    const record = this.processes.get(id);
    if (!record || !["starting", "running"].includes(record.status)) throw new Error("Pi session process is not running");
    const line = typeof value === "string" ? value : JSON.stringify(value);
    traceHarness("out", record.chatId, line);
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
      const sentAt = this.now();
      const settle = (outcome, argument) => {
        const elapsed = this.now() - sentAt;
        if (elapsed > SLOW_RPC_MS) {
          console.warn("Slow Pi RPC", { type: value.type, ms: elapsed, bootMs: record.bootMs ?? null, chatId: record.chatId });
        }
        outcome(argument);
      };
      const entry = {
        resolve: (answer) => settle(resolve, answer),
        reject: (error) => settle(reject, error),
        timer: null,
      };
      const expire = () => {
        record.pendingRequests.delete(requestId);
        const error = new Error(`Pi RPC ${value.type} timed out`);
        error.code = "rpc_timeout";
        entry.reject(error);
      };
      // The request goes out now, but its clock starts when Pi is able to read
      // it. Pi is "running" the moment the OS spawns it, and restoring a large
      // session keeps it from its stdin for seconds -- long enough that a five
      // second budget was spent entirely on somebody else's boot, which is why
      // the chats with the most history were the ones that timed out. Until Pi
      // first speaks the request waits under a boot budget instead, so a
      // process that never speaks still fails rather than hanging.
      entry.timer = setTimeout(expire, record.spoke ? timeout : BOOT_WAIT_MS);
      if (!record.spoke && record.speaking) {
        record.speaking.then(() => {
          if (record.pendingRequests.get(requestId) !== entry) return;
          clearTimeout(entry.timer);
          entry.timer = setTimeout(expire, timeout);
        }, () => {});
      }
      record.pendingRequests.set(requestId, entry);
      try { this.send(id, { ...value, id: requestId }); }
      catch (error) {
        clearTimeout(entry.timer);
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

  async getCommands(id) {
    const response = await this.request(id, { type: "get_commands" });
    return Array.isArray(response.data?.commands) ? response.data.commands : [];
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

  async attachmentPrompt(message, attachments = []) {
    const images = [];
    const files = [];
    for (const attachment of attachments) {
      if (String(attachment.type || "").startsWith("image/") && attachment.type !== "image/svg+xml") {
        images.push({ type: "image", data: await fs.readFile(attachment.path, "base64"), mimeType: attachment.type });
      } else {
        files.push(`Attached file: ${attachment.path}`);
      }
    }
    return { message: [message, ...files].filter(Boolean).join("\n\n"), images };
  }

  prompt(id, message, { continuationBase = "", streamingBehavior = null, messageIds = null } = {}) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    if (record.stopping) throw Object.assign(new Error("Pi is still stopping the previous response"), { code: "generation_stopping" });
    // Steer/follow-up into an open turn keeps the existing generating slot.
    if (streamingBehavior !== "steer" && streamingBehavior !== "followUp") {
      this.assertCanStartGeneration(record);
    }
    const generationId = `g${++record.generationSequence}`;
    const claims = messageIds ? { ...messageIds, userUsed: false, assistantUsed: false } : null;
    const previousGeneration = record.generation;
    const structured = this.beginActiveGeneration(record, generationId, continuationBase, claims);
    const generation = { id: generationId, closed: false, settled: false, continuationBase, claims };
    record.generation = generation;
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
    this.publishTransient(record, structured.started);
    this.publishState(record);
    return generationId;
  }

  async promptAccepted(id, message, { continuationBase = "", streamingBehavior = null, attachments = [], messageIds = null } = {}) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    if (record.stopping) throw Object.assign(new Error("Pi is still stopping the previous response"), { code: "generation_stopping" });
    if (streamingBehavior !== "steer" && streamingBehavior !== "followUp") this.assertCanStartGeneration(record);
    const generationId = `g${++record.generationSequence}`;
    // A turn's ids belong to the turn: they live and die with the generation,
    // so nothing else can consume them. Pi emits user messages Conduit never
    // prompted -- a steer, a continuation, a queue it flushes itself -- and
    // taking claims as those went past handed the wrong id to the wrong message.
    const claims = messageIds ? { ...messageIds, userUsed: false, assistantUsed: false } : null;
    const previousGeneration = record.generation;
    const structured = this.beginActiveGeneration(record, generationId, continuationBase, claims);
    const generation = { id: generationId, closed: false, settled: false, continuationBase, claims };
    record.generation = generation;
    record.activity = "working";
    const afterMessageId = record.transcriptLeafId || null;
    const prepared = await this.attachmentPrompt(message, attachments);
    const payload = { type: "prompt", message: prepared.message };
    if (prepared.images.length) payload.images = prepared.images;
    if (streamingBehavior === "steer" || streamingBehavior === "followUp") payload.streamingBehavior = streamingBehavior;
    try {
      await this.request(id, payload);
    } catch (error) {
      // Pi rejects the pending prompt request when a concurrent abort succeeds.
      // That response confirms cancellation; it is not a failed user request.
      if (record.generation === generation && generation.aborting && /abort/i.test(error.message)) {
        return { generationId, attachmentIdentity: null };
      }
      record.generation = previousGeneration;
      this.restoreActiveGeneration(record, structured.previous);
      record.activity = deriveCoarseActivity(record);
      this.publishState(record);
      throw error;
    }
    this.publishTransient(record, structured.started);
    this.publishState(record);
    if (streamingBehavior === "steer" || streamingBehavior === "followUp") {
      const ordinal = record.attachmentQueueAnchor === afterMessageId ? record.attachmentQueueOrdinal : 0;
      record.attachmentQueueAnchor = afterMessageId;
      record.attachmentQueueOrdinal = ordinal + 1;
      const attachmentIdentity = { afterMessageId, ordinal };
      record.pendingQueuedPrompts.push({ type: streamingBehavior, message, attachmentIds: attachments.map((item) => item.id), attachmentIdentity });
      return { generationId, attachmentIdentity };
    }
    return { generationId, attachmentIdentity: { afterMessageId } };
  }

  async queueAccepted(id, type, message, { attachments = [], messageId = null } = {}) {
    if (!new Set(["steer", "follow_up"]).has(type)) throw new Error("Invalid queued prompt type");
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    const before = await this.request(id, { type: "get_entries" });
    const prepared = await this.attachmentPrompt(message, attachments);
    const payload = { type, message: prepared.message };
    if (prepared.images.length) payload.images = prepared.images;
    await this.request(id, payload);
    const afterMessageId = before.data?.leafId || null;
    const ordinal = record.attachmentQueueAnchor === afterMessageId ? record.attachmentQueueOrdinal : 0;
    record.attachmentQueueAnchor = afterMessageId;
    record.attachmentQueueOrdinal = ordinal + 1;
    const attachmentIdentity = { afterMessageId, ordinal };
    record.pendingQueuedPrompts.push({ type, message, messageId, attachmentIds: attachments.map((item) => item.id), attachmentIdentity });
    // Pi says nothing about which entry a queued message becomes; it simply
    // writes one when it takes it. The names wait here in the order they were
    // queued and are spent in that order as the user messages come back.
    if (messageId) record.queuedMessageIds.push(messageId);
    return { attachmentIdentity };
  }

  /**
   * Take the queued messages back off Pi, returning their text.
   *
   * Pi continues queued messages through an abort by design, so a client that
   * wants Esc behaviour - stop, and hand the text back to the composer - has to
   * clear the queue first. Documented in Pi's rpc.md.
   */
  async clearQueue(id) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    const response = await this.request(id, { type: "clear_queue" });
    const data = response?.data || {};
    const pending = record.pendingQueuedPrompts.splice(0);
    const queued = (type, fallback) => {
      const local = pending.filter((item) => item.type === type || (type === "follow_up" && item.type === "followUp"));
      return local.length ? local : fallback;
    };
    const discardedMessageIds = pending.map((item) => item.messageId).filter(Boolean);
    record.queuedMessageIds = record.queuedMessageIds.filter((id) => !discardedMessageIds.includes(id));
    return {
      steering: queued("steer", data.steering || []),
      followUp: queued("follow_up", data.followUp || []),
      discardedAttachmentIdentities: pending.map((item) => item.attachmentIdentity),
      discardedMessageIds,
    };
  }

  async abortGeneration(id, generationId = null) {
    const record = this.processes.get(id);
    const generation = record?.generation;
    if (!record || !generation || (generationId && generation.id !== generationId)) return null;
    generation.closed = true;
    // Stays set for the life of this generation. Pi reports the interrupted
    // assistant message between the abort request and its response, so a flag
    // cleared when the abort resolves loses the race by a millisecond. The
    // next turn replaces record.generation, which retires the flag with it.
    generation.aborting = true;
    record.stopping = true;
    record.activity = "stopping";
    this.ingestGenerationEvent(record, { type: "generation_stopping" }, { allowClosed: true });
    this.publishState(record);
    let processTerminated = false;
    try {
      // Pi resolves abort only once the session is genuinely idle. That is
      // usually milliseconds, but a queue left in place makes Pi deliver it and
      // run another model call inside the abort, which can take as long as any
      // turn. The budget covers that; SIGKILL stays for a process that has
      // actually wedged, not for one that is doing what it was asked.
      await this.request(id, { type: "abort" }, { timeout: 15_000 });
    } catch {
      processTerminated = true;
      record.status = "stopped";
      record.active = false;
      record.child.kill("SIGKILL");
      if (record.sessionFile) this.bySessionFile.delete(record.sessionFile);
    }
    if (!processTerminated && record.status === "running") {
      try {
        // Pi can acknowledge abort before its final agent event reaches this
        // process. Read its authoritative idle state before publishing Stop.
        const state = await this.request(id, { type: "get_state" }, { timeout: 3000 });
        if (state.data?.isStreaming != null) {
          record.active = Boolean(state.data.isStreaming);
          if (!record.active) generation.settled = true;
        }
      } catch {
        // The abort already succeeded. A later agent event can still settle
        // activity, so a failed repair read must not turn Stop into a failure.
      }
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

  async getHistoryTree(id) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    const response = await this.request(id, { type: "get_tree" });
    return this.#mergeHistoryFamily(record, response.data);
  }

  async readHistoryTree(opaqueSession, workingRoot) {
    if (typeof opaqueSession !== "string" || !opaqueSession) {
      throw Object.assign(new Error("This chat has no saved agent session"), { code: "history_unavailable", status: 409 });
    }
    const sessionFile = path.resolve(opaqueSession);
    const cwd = typeof workingRoot === "string" && workingRoot ? path.resolve(workingRoot) : path.dirname(sessionFile);
    const tree = SessionManager.open(sessionFile, path.dirname(sessionFile), cwd).getTree();
    const leaf = (() => {
      let nodes = tree;
      let node = null;
      while (nodes?.length) { node = nodes.at(-1); nodes = node.children; }
      return node?.entry?.id || null;
    })();
    return this.#mergeHistoryFamily({ sessionFile, sessionDir: path.dirname(sessionFile), cwd }, { leafId: leaf, tree });
  }

  async #mergeHistoryFamily(record, currentTree) {
    if (!record.sessionFile) return currentTree;

    const currentPath = path.resolve(record.sessionFile);
    const sessionDir = path.dirname(currentPath);
    const sessions = [];
    const directories = [sessionDir, path.resolve(record.sessionDir)];
    const loadedDirectories = new Set();
    while (directories.length) {
      const directory = directories.pop();
      if (loadedDirectories.has(directory)) continue;
      loadedDirectories.add(directory);
      const found = await SessionManager.list(record.cwd, directory);
      sessions.push(...found);
      for (const session of found) {
        if (session.parentSessionPath) directories.push(path.dirname(path.resolve(session.parentSessionPath)));
      }
    }
    const byPath = new Map(sessions.map((session) => [path.resolve(session.path), session]));
    let rootPath = currentPath;
    const visited = new Set();
    while (!visited.has(rootPath)) {
      visited.add(rootPath);
      const parent = byPath.get(rootPath)?.parentSessionPath;
      if (!parent) break;
      const parentPath = path.resolve(parent);
      if (!byPath.has(parentPath)) break;
      rootPath = parentPath;
    }

    const family = new Set([rootPath]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const session of sessions) {
        const sessionPath = path.resolve(session.path);
        const parentPath = session.parentSessionPath ? path.resolve(session.parentSessionPath) : null;
        if (parentPath && family.has(parentPath) && !family.has(sessionPath)) {
          family.add(sessionPath);
          changed = true;
        }
      }
    }

    const nodes = new Map();
    const collect = (tree) => {
      for (const node of tree || []) {
        const existing = nodes.get(node.entry.id);
        nodes.set(node.entry.id, existing ? { ...existing, ...node, children: [] } : { ...node, children: [] });
        collect(node.children);
      }
    };
    for (const sessionPath of family) {
      if (sessionPath === currentPath) continue;
      collect(SessionManager.open(sessionPath, path.dirname(sessionPath), record.cwd).getTree());
    }
    collect(currentTree?.tree);

    const roots = [];
    for (const node of nodes.values()) {
      const parent = node.entry.parentId ? nodes.get(node.entry.parentId) : null;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return { ...currentTree, tree: roots };
  }

  attach(id, socket) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    record.clients.add(socket);
    record.delivery.set(socket, {
      pending: new Map(), pendingOrder: [], notifications: new Map(), notificationOrder: [], notificationBytes: 0,
      flushTimer: null, recoveryTimer: null, paused: false,
    });
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
    // Pi streams a committed user message with no id of its own -- its ids live
    // on session entries, which do not exist yet. The prompt claimed one before
    // it was sent, so the browser learns the message's real identity here
    // rather than minting a placeholder it has to reconcile away later.
    if (event?.type === "message_end" && event.message?.role === "user") {
      const claims = record?.generation?.claims;
      if (claims?.user && !claims.userUsed) {
        claims.userUsed = true;
        event = { ...event, message: { ...event.message, id: claims.user } };
      } else if (record?.queuedMessageIds?.length || record?.claimMessage) {
        // A message off the queue, or one Conduit never sent at all -- typed
        // into the CLI of a thread driven from here. Either way this is the
        // first moment it has a place in the transcript, and the first moment
        // the log can state one, after whatever was said before it.
        const queued = record.queuedMessageIds?.length
          ? record.queuedMessageIds.shift()
          : record.claimMessage?.("user");
        if (!queued) return this.publishRaw(record, event);
        record.lastQueuedMessageId = queued;
        event = { ...event, message: { ...event.message, id: queued } };
        this.openMessage(record, queued, "user", {
          content: event.message.content, timestamp: event.message.timestamp,
        });
        // An answer this turn goes on to write follows the queued message, not
        // the prompt that opened the turn: that prompt has been answered, and
        // this is what the model is replying to now.
        if (claims) claims.answersAfter = queued;
      }
    }
    return this.publishRaw(record, event);
  }

  /** Publish without asking whose message it is; `publish` has already asked. */
  publishRaw(record, event) {
    const stamped = this.stampForLog(record, event);
    this.publishInternal(record, stamped);
    this.deliver(record, stamped);
  }

  /**
   * Give an event its place in the chat's order, if it has one to hold.
   *
   * Only events that change what the transcript says are numbered. A client can
   * then tell a hole from a quiet moment, and ask for what it missed instead of
   * reloading the page to find out.
   */
  stampForLog(record, event) {
    const log = this.logFor(record);
    return log && isLoggedEvent(event) ? log.stamp(event) : event;
  }

  /**
   * The order this record's events belong to.
   *
   * It is the chat's, not the process's, so a restarted or recycled Pi goes on
   * numbering where the last one stopped. A record with no chat -- a driven
   * thread, an ephemeral probe -- has no transcript to keep an order for.
   */
  logFor(record) {
    return record?.chatId ? this.logs.get(record.chatId) : null;
  }

  publishInternal(record, event) {
    this.touchActivity(record);
    record.events.push(event);
    if (record.events.length > 500) record.events.splice(0, record.events.length - 500);
    this.emit("event", { record, event });
  }

  publishTransient(record, event) {
    this.touchActivity(record);
    const stamped = this.stampForLog(record, event);
    this.deliver(record, stamped);
    this.emit("event", { record, event: stamped });
  }

  deliver(record, event) {
    for (const socket of record.clients) {
      this.deliverToClient(record, socket, event);
    }
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
    socket.send(this.serializeEvent(event));
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

  closeSlowClient(record, socket, state) {
    state.notifications.clear();
    state.notificationOrder = [];
    state.notificationBytes = 0;
    this.clearDelivery(record, socket);
    socket.close?.(1013, "Slow client delivery backlog exceeded");
  }

  queueDeliveryNotification(record, socket, state, event) {
    const key = deliveryNotificationKey(event);
    if (!key) return true;
    const bytes = deliveryEventBytes(event);
    const previous = state.notifications.get(key);
    const nextBytes = state.notificationBytes - (previous?.bytes || 0) + bytes;
    const nextItems = state.notificationOrder.length + (previous ? 0 : 1);
    if (nextItems > this.deliveryMaxNotifications || nextBytes > this.deliveryMaxNotificationBytes) {
      this.closeSlowClient(record, socket, state);
      return false;
    }
    if (!previous) state.notificationOrder.push(key);
    state.notifications.set(key, { event, bytes });
    state.notificationBytes = nextBytes;
    return true;
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
      if (!this.sendClientEvent(socket, { type: "runtime_state", session: this.view(record) })) return;
      if (record.lastCheckpoint && !this.sendClientEvent(socket, record.lastCheckpoint)) return;
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
    const notifications = state.notificationOrder.map((key) => state.notifications.get(key)?.event).filter(Boolean);
    state.notifications.clear();
    state.notificationOrder = [];
    state.notificationBytes = 0;
    const queued = [...notifications, ...pending];
    for (let index = 0; index < queued.length; index += 1) {
      if (socketBufferedAmount(socket) > this.socketHighWaterMark) {
        for (const pendingEvent of queued.slice(index)) {
          if (!this.queueDeliveryNotification(record, socket, state, pendingEvent)) return;
        }
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
      this.queueDeliveryNotification(record, socket, state, event);
      return;
    }
    if (socketBufferedAmount(socket) > this.socketHighWaterMark) {
      if (!this.queueDeliveryNotification(record, socket, state, event)) return;
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
      if (!this.queueDeliveryNotification(record, socket, state, event)) return;
      return this.pauseDelivery(record, socket, state);
    }
    this.sendClientEvent(socket, event);
  }

  /**
   * Say that a message now exists, and where.
   *
   * This is the moment a message is named -- the prompt as it is accepted, an
   * answer as the harness starts writing it -- and saying so here is what
   * removes the guesswork from the other end. The log decides the position; the
   * browser is told one, rather than working one out from ids and content.
   */
  openMessage(record, id, role, { answers = null, ...fields } = {}) {
    if (!id || !this.logFor(record)) return null;
    // A turn is answerable for every message it opens. One it names and never
    // writes -- an answer cancelled before its first token -- is dropped when
    // the turn ends, so no row is left holding a place for something that will
    // never arrive.
    if (role === "assistant" && record.generation) {
      record.generation.openMessages = record.generation.openMessages || new Set();
      record.generation.openMessages.add(id);
    }
    this.publish(record, messageOpen({ id, role, ...fields,
      // The turn that is writing it, so a row holding a place for an answer
      // that never arrives can be cleared along with the turn that named it.
      generationId: record.generation?.id || null,
      // The prompt this message answers, for an answer. A prompt answers
      // nothing and says so.
      answers }));
    return id;
  }

  /**
   * And that it is finished -- with the reason it stopped, and what it says.
   *
   * The text comes from the turn this process is running, not from the session
   * file, because the file is written on the harness's own schedule: a turn cut
   * off mid-sentence is on screen long before its entry exists on disk. Stating
   * it from here means the browser never has to assemble a final answer out of
   * the deltas it drew, and never has to decide whether to keep a row while it
   * waits to find out.
   */
  closeMessage(record, id, stopReason = null) {
    if (!id || !this.logFor(record)) return null;
    record.generation?.openMessages?.delete(id);
    const generation = record.activeGeneration;
    const written = generation?.assistantMessages?.find((message) => message.id === id) || null;
    const blocks = written?.blocks || [];
    this.publish(record, messageClose({
      messageId: id, stopReason,
      // Whether this message is an answer or the turn talking as it works. The
      // browser is told, rather than deciding it from the shape of the turn
      // around the message.
      interim: messageIsInterim(written),
      // Pi writes an interrupted message to its session file and then builds
      // the next request without it, so the text is real -- the reader watched
      // it arrive -- but the model will never see it again. Saying so is the
      // op's job; what is said here is only that Pi cannot keep a partial.
      keepsPartial: PI_CAPABILITIES.interruptKeepsPartial,
      // The generation already holds Conduit's blocks -- Pi's names were turned
      // into them as the deltas arrived -- so a close states what it has.
      blocks,
    }));
    return id;
  }

  /**
   * Settle the rows a finished turn still holds open.
   *
   * A row is given up only when nothing was ever written into it. One that was
   * being written when the turn ended is closed with what it had: the harness
   * may never report that message -- an abort can end a turn without one -- and
   * dropping it would take away text the user watched arrive.
   */
  dropUnwrittenMessages(record) {
    const open = record.generation?.openMessages;
    if (!open?.size) return;
    for (const id of [...open]) {
      const written = record.activeGeneration?.assistantMessages?.find((message) => message.id === id);
      if (written?.blocks?.length) this.closeMessage(record, id, written.stopReason || "aborted");
      else this.publish(record, messageDrop({ messageId: id }));
      open.delete(id);
    }
  }

  publishGeneration(record, event, generation = record.generation) {
    // Same exception as ingestGenerationEvent: a generation being aborted still
    // owns its ending, so its terminal events reach the browser.
    if (generation?.closed && !(generation.aborting && ABORT_TERMINAL_EVENTS.has(event.type))) return false;
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
    record.stopping = true;
    // Distinct from record.stopping, which also means "interrupting the current
    // turn". Only this one means the process itself is going away.
    record.terminating = true;
    // SIGTERM is the start of the exit, not the end of it: the record lives on
    // until the child actually goes, which can take long enough for someone to
    // click the chat in between. Until this announcement existed, everything in
    // that window still advertised the process as running, so a client would
    // attach to a corpse, get no process out of it, and have to ask twice.
    this.emit("process_removed", { id: record.id, chatId: record.chatId });
    record.child.kill("SIGTERM");
    return true;
  }

  async stopAndWait(id) {
    const record = this.processes.get(id);
    if (!record || !["starting", "running"].includes(record.status)) return false;
    record.stopping = true;
    record.terminating = true;
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

  async shutdown() {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
    const records = this.liveRecords();
    await Promise.all(records.map((record) => this.stopAndWait(record.id)));
    return records.length;
  }

  view(record) {
    const {
      child, clients, stdoutBuffer, events, stream, activeGeneration, generationNormalizer,
      pendingRequests, generation, statsTimer,
      cwd, sessionDir, createdAtMs, lastActivityAt, lastClientAt, lastTurnAt, ...safe
    } = record;
    return {
      id: safe.id,
      chatId: safe.chatId,
      projectId: safe.projectId,
      projectSlug: safe.projectSlug,
      sessionFile: safe.sessionFile,
      sessionId: safe.sessionId || null,
      model: safe.model,
      thinkingLevel: safe.thinkingLevel,
      template: safe.template || null,
      runtime: safe.runtime || null,
      binaryVersion: safe.binaryVersion || null,
      trustPosture: safe.trustPosture || null,
      status: safe.status,
      // Alive is not the same as able to answer; everything that shows a chat
      // as warm waits for this rather than for the spawn.
      ready: safe.spoke !== false,
      // Somebody is waiting on an answer from it, so it is not free to reclaim.
      waiting: record.pendingRequests?.size > 0,
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
      sessionStats: safe.sessionStats || null,
      cacheStats: safe.cacheStats || null,
      createdAt: safe.createdAt,
      updatedAt: safe.updatedAt,
      lastClientAt: lastClientAt || null,
      lastActivityAt: lastActivityAt || null,
      lastTurnAt: lastTurnAt || null,
      generation: generation
        ? { id: generation.id, closed: generation.closed, settled: Boolean(generation.settled) }
        : null,
      clientCount: clients.size,
    };
  }

  list() {
    return [...this.processes.values()]
      .filter((record) => !record.terminating && record.status !== "stopped")
      .map((record) => this.view(record));
  }

  get(id) {
    return this.processes.get(id) || null;
  }

  getByChatId(chatId) {
    const id = this.byChatId.get(chatId);
    const record = id ? this.processes.get(id) : null;
    return record && !record.terminating && ["starting", "running"].includes(record.status) ? record : null;
  }

  rawRecords() {
    return [...this.processes.values()].filter((record) => !record.terminating && record.status !== "stopped");
  }
}
