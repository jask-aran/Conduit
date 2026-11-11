import { remoteNode } from "./place.js";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { wasDiscarded } from "./abort-signature.js";
import { parseAttachmentEnvelope } from "./attachment-envelope.js";
import { answerTo, isDismissal, questionRequest } from "./harnesses/questions.js";
import { SessionRecords } from "./harnesses/session-records.js";
import { beginTurn, endTurn, outcomeOf, turnEnded, turnStarted } from "./harnesses/turn.js";
import { ask as askHost, asked, hostsOf, take } from "./harnesses/host-requests.js";
import { messageClose, messageDrop, messageOpen, toolClose, toolKind, toolOpen, toolSubject, turnSettle } from "./harnesses/transcript-ops.js";
import { countCacheRequest, planWindowLabel, usageFromRequests } from "./cache-stats.js";
import { codexPlanUsage, declarePlan } from "./plan-usage.js";
import { unsupported } from "./harnesses/unsupported.js";
import { opaqueSessionOf } from "./nodes/remote-spawn.js";
import { placeProcesses } from "./nodes/place-processes.js";
import { attachmentForDevice, imageDataUrl } from "./nodes/device-attachments.js";

export const CODEX_CAPABILITIES = Object.freeze({
  history: "linear", fork: true, regenerate: true,
  steer: true, followUpQueue: true, cancel: true, compaction: true,
  thinkingLevels: true, modelSwitch: true, toolUse: true,
  approvals: true, permissionModes: true,
  // Codex's `replay` returns the current runtime state, not a generation in progress.
  usage: true, replay: false,
  attachments: true,
  interruptKeepsPartial: false,
});

// Codex reads files through commands, so there is no read of its own; an image it opens is one.
const CODEX_TOOL_KINDS = Object.freeze({
  commandExecution: "command", fileChange: "edit", webSearch: "search", imageView: "read",
});
const APPROVAL_OPTIONS = Object.freeze(["Approve", "Approve for session", "Deny"]);
const APPROVAL_POLICIES = Object.freeze(["untrusted", "on-request", "never"]);
const APPROVAL_REVIEWERS = Object.freeze(["user", "auto_review"]);
const BUILTIN_PERMISSION_MODES = Object.freeze([
  { id: "default", label: "Default permissions", description: "Runs commands in a sandbox", profile: ":workspace", approvalPolicy: "on-request", approvalsReviewer: "user" },
  { id: "auto-review", label: "Auto-review", description: "Reviews elevated requests automatically", profile: ":workspace", approvalPolicy: "on-request", approvalsReviewer: "auto_review" },
  { id: "read-only", label: "Read only", description: "Requires approval to edit files or run commands", profile: ":read-only", approvalPolicy: "on-request", approvalsReviewer: "user" },
  { id: "full-access", label: "Full access", description: "Full computer access (elevated risk)", profile: ":danger-full-access", approvalPolicy: "never", approvalsReviewer: "user" },
]);
const commandText = (params) => Array.isArray(params.command) ? params.command.join(" ") : params.command || "";
const APPROVALS = {
  "item/commandExecution/requestApproval": {
    title: () => "Run a command",
    message: (params) => [commandText(params), params.reason].filter(Boolean).join("\n\n") || "Codex wants to run a command.",
    decisions: { approve: "accept", session: "acceptForSession", deny: "decline" },
  },
  "item/fileChange/requestApproval": {
    title: () => "Apply a file change",
    message: (params) => [params.reason, params.grantRoot && `Grants write access to ${params.grantRoot}`]
      .filter(Boolean).join("\n\n") || "Codex wants to edit files in this folder.",
    decisions: { approve: "accept", session: "acceptForSession", deny: "decline" },
  },
  // An older app-server sends these for the same two decisions.
  execCommandApproval: {
    title: () => "Run a command",
    message: (params) => [commandText(params), params.reason].filter(Boolean).join("\n\n") || "Codex wants to run a command.",
    decisions: { approve: "approved", session: "approved_for_session", deny: "denied" },
  },
  applyPatchApproval: {
    title: () => "Apply a file change",
    message: (params) => params.reason || "Codex wants to edit files in this folder.",
    decisions: { approve: "approved", session: "approved_for_session", deny: "denied" },
  },
};

// A permission prompt fails closed: anything but an explicit approval denies.
const approvalChoice = (response) => {
  if (!response || response.cancelled) return "deny";
  if (response.confirmed === true) return "approve";
  if (response.confirmed === false) return "deny";
  const index = APPROVAL_OPTIONS.indexOf(String(response.value ?? ""));
  return ["approve", "session", "deny"][index] || "deny";
};

const USER_INPUT = "item/tool/requestUserInput";
const userInputRequest = (id, params) => questionRequest({ id, title: "Codex has a question",
  questions: (params.questions || []).map((question) => ({
    id: question.id, header: question.header || "", prompt: question.question || "", secret: Boolean(question.isSecret), required: true,
    options: (question.options || []).map((option, index) => ({ id: String(index), label: option.label, description: option.description || "" })),
    freeform: question.isOther || !question.options?.length ? { placeholder: "" } : false,
  })) });
const userInputAnswers = (host, response) => Object.fromEntries(isDismissal(response) ? [] : host.questions.map((question) => {
  const { options, freeform } = answerTo(response, question);
  return [question.id, { answers: [...options.map((option) => option.label), ...(freeform ? [freeform] : [])] }];
}));

const error = (message, code = "backend_unavailable", status = 409) => Object.assign(new Error(message), { code, status });
const waitForClose = (socket, timeoutMs = 2_000) => {
  if (!socket || socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    socket.once("close", () => { clearTimeout(timer); resolve(); });
  });
};

// Tool items outnumber messages roughly five to one, so capping raw items would drop the start of the conversation to
// keep recent tool noise: the two are budgeted separately.
const REPLAY_PAGE_LIMIT = 20;
const REPLAY_MESSAGE_LIMIT = 500;
const REPLAY_TOOL_LIMIT = 200;
const REPLAY_OUTPUT_LIMIT = 1500;
const isMessage = (item) => ["userMessage", "agentMessage", "reasoning"].includes(item?.type);
const textResult = (output) => typeof output === "string" ? output : JSON.stringify(output ?? "");
const itemPartsText = (parts) => (Array.isArray(parts) ? parts : [])
  .map((part) => typeof part === "string" ? part : part?.text || "").join("");
const truncate = (output) => {
  if (typeof output !== "string" || output.length <= REPLAY_OUTPUT_LIMIT) return output;
  return `${output.slice(0, REPLAY_OUTPUT_LIMIT)}\n… ${output.length - REPLAY_OUTPUT_LIMIT} more characters`;
};

/** A snapshot comes in camel case, or the rollout's snake case. */
function codexPlan(snapshot, previous = null) {
  if (!snapshot) return previous;
  const window = (id, value) => value && (value.usedPercent ?? value.used_percent) != null ? {
    id, label: planWindowLabel(value.windowDurationMins ?? value.window_minutes),
    usedPercent: value.usedPercent ?? value.used_percent,
    resetsAt: (value.resetsAt ?? value.resets_at) ? new Date((value.resetsAt ?? value.resets_at) * 1000).toISOString() : null,
  } : null;
  const windows = [window("primary", snapshot.primary), window("secondary", snapshot.secondary)].filter(Boolean);
  // A rolling update is sparse: what it leaves out stands.
  const merged = windows.length ? windows : previous?.windows || [];
  return merged.length ? { name: snapshot.planType ?? snapshot.plan_type ?? previous?.name ?? null, windows: merged } : previous;
}

export class CodexAppServerAdapter extends EventEmitter {
  runsOnDevices = true;

  /** Codex's plan windows are the account's, not a thread's. */
  static plan = { at: 0, value: null };

  constructor({ command = "codex", socketPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    "app-server-control", "app-server-control.sock"), requestTimeoutMs = 15_000, discoveryIdleMs = 60_000,
    logs = null, nodeHub = null } = {}) {
    super();
    this.command = command;
    this.socketPath = socketPath;
    this.nodeHub = nodeHub;
    this.requestTimeoutMs = requestTimeoutMs;
    this.discoveryIdleMs = discoveryIdleMs;
    this.discoveryId = null;
    this.discoveryStart = null;
    this.daemonStart = null;
    this.discoveryTimer = null;
    this.sessions = new SessionRecords({
      capabilities: CODEX_CAPABILITIES,
      backend: { protocol: "native_api", implementation: "codex", installationId: "host-codex" },
      extras: (record) => ({ sessionId: record.sessionId || null }),
      logs,
    });
    this.logs = logs;
    // `start` indexes records directly; these are the store's own maps.
    this.records = this.sessions.records;
    this.byChatId = this.sessions.byChatId;
    const unsupportedMethods = unsupported(CODEX_CAPABILITIES, { label: "Codex" });
    Object.assign(this, unsupportedMethods);
  }

  opaqueSessionOf(record) { return opaqueSessionOf(record); }

  processes(on) { return placeProcesses(this.nodeHub, on || {}); }

  startDaemon(record = null) {
    const key = record?.nodeId || "";
    this.daemonStarts ||= new Map();
    if (!this.daemonStarts.has(key)) {
      this.daemonStarts.set(key, this.processes(record).execFile("codex", this.command, ["app-server", "daemon", "start"])
        .then(() => {}, (cause) => { throw error(String(cause.stderr || cause.message).trim()); })
        .finally(() => this.daemonStarts.delete(key)));
    }
    return this.daemonStarts.get(key);
  }

  async launch(context, { model = "", thinkingLevel = "", forceModel = false }) {
    const selectedModel = (forceModel ? String(model).trim() : "") || String(context.chat.backend.model || "").trim();
    const selectedThinkingLevel = (forceModel ? String(thinkingLevel).trim() : "")
      || String(context.chat.modelThinkingLevels?.[selectedModel] || "").trim();
    const options = {
      chatId: context.chat.id, project: context.project, model: selectedModel,
      thinkingLevel: selectedThinkingLevel,
      permissionMode: String(context.chat.backend.permissionMode || "").trim(),
      permissionProfile: String(context.chat.backend.permissionProfile || "").trim(),
      approvalPolicy: String(context.chat.backend.approvalPolicy || "").trim(),
      approvalsReviewer: String(context.chat.backend.approvalsReviewer || "").trim(),
      serviceLevel: String(context.chat.backend.serviceLevel || "").trim(),
    };
    const live = context.chat.backend.opaqueSession
      ? await this.restore(context.chat.backend.opaqueSession, options) : await this.create(options);
    return { live, mapping: {
      backend: { ...context.chat.backend, model: selectedModel, opaqueSession: this.opaqueSessionOf(live) },
      ...(selectedThinkingLevel ? { modelThinkingLevels: {
        ...(context.chat.modelThinkingLevels || {}), [selectedModel]: selectedThinkingLevel,
      } } : {}),
    }, modelRecovery: null };
  }

  async create({ chatId, project, model = "", thinkingLevel = "", permissionMode = "", permissionProfile = "", approvalPolicy = "", approvalsReviewer = "", serviceLevel = "", sandbox = null }) {
    const record = await this.start({ chatId, projectId: project.id, cwd: project.workingRoot, nodeId: remoteNode(project), place: project.place });
    try {
      const result = await this.request(record, "thread/start", {
        cwd: project.workingRoot,
        ...(model ? { model } : {}),
        ...(thinkingLevel ? { effort: thinkingLevel } : {}),
        ...(serviceLevel ? { serviceTier: serviceLevel } : {}),
        ...(permissionProfile ? { permissions: permissionProfile } : {}),
        ...CodexAppServerAdapter.policy(approvalPolicy, approvalsReviewer, sandbox),
      });
      record.sessionId = result.thread.id;
      record.model = result.model || model;
      // Codex answers with its configured effort, not the one asked for; every turn sends the record's.
      record.thinkingLevel = thinkingLevel || result.reasoningEffort || result.thread?.reasoningEffort || "";
      // An omitted profile is meaningful: Codex must continue to resolve the
      // effective config instead of Conduit freezing its current result.
      record.permissionProfile = permissionProfile;
      record.permissionMode = permissionMode;
      record.approvalPolicy = approvalPolicy;
      record.approvalsReviewer = approvalsReviewer;
      record.serviceLevel = serviceLevel;
      this.emit("changed", { record, reason: "created" });
      return record;
    } catch (cause) {
      await this.close(record.id);
      throw cause;
    }
  }

  async restore(opaqueSession, { chatId, project, model = "", thinkingLevel = "", permissionMode = "", permissionProfile = "", approvalPolicy = "", approvalsReviewer = "", serviceLevel = "", sandbox = null }) {
    const record = await this.start({ chatId, projectId: project.id, cwd: project.workingRoot, nodeId: remoteNode(project), place: project.place });
    const threadId = typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId;
    if (!threadId) throw error("Codex thread identity is missing");
    try {
      const result = await this.request(record, "thread/resume", {
        threadId, cwd: project.workingRoot,
        ...(model ? { model } : {}),
        ...(thinkingLevel ? { effort: thinkingLevel } : {}),
        ...(serviceLevel ? { serviceTier: serviceLevel } : {}),
        ...(permissionProfile ? { permissions: permissionProfile } : {}),
        ...CodexAppServerAdapter.policy(approvalPolicy, approvalsReviewer, sandbox),
      });
      record.sessionId = result.thread?.id || threadId;
      record.model = model || result.model || result.thread?.model || "";
      record.thinkingLevel = thinkingLevel || result.thread?.reasoningEffort || "";
      record.permissionProfile = permissionProfile;
      record.permissionMode = permissionMode;
      record.approvalPolicy = approvalPolicy;
      record.approvalsReviewer = approvalsReviewer;
      record.serviceLevel = serviceLevel;
      this.emit("changed", { record, reason: "restored" });
      return record;
    } catch (cause) {
      await this.close(record.id);
      throw cause;
    }
  }

  /** `thread/read` reports an empty `turns` array for every stored thread: the history lives behind `thread/items/list`. */
  async items(record, threadId, pageLimit = REPLAY_PAGE_LIMIT) {
    const rows = [];
    let cursor = null;
    for (let page = 0; page < pageLimit; page += 1) {
      const result = await this.request(record, "thread/items/list", { threadId, limit: 100, ...(cursor ? { cursor } : {}) });
      rows.push(...(result?.data || []));
      if (!result?.nextCursor || result.nextCursor === cursor) break;
      cursor = result.nextCursor;
    }
    return rows;
  }

  static toolActivity(item) {
    const { kind: stated, subject: target, ...activity } = CodexAppServerAdapter.activityOf(item) || {};
    if (!activity.name) return null;
    const kind = stated || toolKind(CODEX_TOOL_KINDS, item.type);
    const subject = kind === "other" ? null : toolSubject(target ?? activity.input);
    return { ...activity, kind, ...(subject ? { subject } : {}) };
  }

  /**
   * Opening the pages a search found is reported with an action of `other` and no query, and the results it returns
   * are those pages, so they are what it acted on.
   */
  static webSearchTarget(item) {
    const action = item.action || {};
    if (action.type === "search") return { kind: "search", subject: action.queries?.length ? action.queries : action.query || item.query };
    if (action.type === "openPage") return { kind: "fetch", subject: action.url };
    if (action.type === "findInPage") {
      const page = toolSubject(action.url);
      return { kind: "search", subject: action.pattern && page ? `${action.pattern} in ${page}` : action.pattern || page };
    }
    const pages = (Array.isArray(item.results) ? item.results : []).map((result) => result?.url).filter(Boolean);
    if (!item.query && pages.length) return { kind: "fetch", subject: pages };
    return { kind: "search", subject: item.query };
  }

  static activityOf(item) {
    if (item.type === "commandExecution") {
      return { name: "command", input: item.command || "", output: item.aggregatedOutput || "", isError: item.status === "failed" };
    }
    if (item.type === "fileChange") {
      const changes = item.changes || [];
      return { name: "file change", input: changes.map((change) => change.path), isError: item.status === "failed",
        output: changes.map((change) => change.diff || "").join("\n") };
    }
    if (item.type === "mcpToolCall") {
      return { name: `${item.server || "mcp"}/${item.tool || "tool"}`, input: item.arguments ?? null,
        output: item.result ?? item.error ?? "", isError: item.status === "failed" };
    }
    if (item.type === "dynamicToolCall") {
      return { name: item.tool || "tool", input: item.arguments ?? null,
        output: item.contentItems ?? "", isError: item.success === false || item.status === "failed" };
    }
    if (item.type === "collabToolCall") {
      return { name: `collaboration/${item.tool || "tool"}`, input: item.prompt || "",
        output: item.agentStatus || "", isError: item.status === "failed" };
    }
    if (item.type === "webSearch") {
      return { name: "web search", input: item.query || "", output: item.results ?? "", isError: false,
        ...CodexAppServerAdapter.webSearchTarget(item) };
    }
    if (item.type === "imageView") return { name: "view image", input: item.path || "", output: "", isError: false };
    return null;
  }

  /** `before` is an index into the rows this read fetched, stable because a thread only grows at the end. */
  static recent(rows, { before = null } = {}) {
    const requested = Number.parseInt(before, 10);
    const end = Number.isInteger(requested) ? Math.max(0, Math.min(requested, rows.length)) : rows.length;
    let messages = 0;
    let tools = 0;
    const keep = new Set();
    let first = end;
    for (let index = end - 1; index >= 0; index -= 1) {
      const item = rows[index]?.item;
      if (isMessage(item)) {
        if (messages >= REPLAY_MESSAGE_LIMIT) continue;
        messages += 1;
      } else {
        if (tools >= REPLAY_TOOL_LIMIT || !CodexAppServerAdapter.toolActivity(item)) continue;
        tools += 1;
      }
      keep.add(index);
      first = index;
    }
    // Only rows that would draw something count, or the browser would be offered a page that turns out empty.
    const hasMore = rows.slice(0, first).some((row) => isMessage(row?.item)
      || CodexAppServerAdapter.toolActivity(row?.item));
    return { rows: rows.filter((_row, index) => keep.has(index)), page: { before: hasMore ? String(first) : null } };
  }

  /** The commands hang off the message that ran them, which is how the reasoning rollup finds them. */
  static threadTranscript(rows) {
    const messages = [];
    const tools = [];
    let turnId;
    let turnStatus;
    let turnStart = 0;
    let interim = null;
    let answering = null;
    const closeTurn = () => {
      // Older threads carry no `phase`; the turn's last message without commands is the closest thing to an answer.
      const turn = messages.slice(turnStart);
      // A turn still in progress has not ended, and the live stream will say when it does.
      const prompt = messages.find((message) => message.id === answering);
      const outcome = { completed: "complete", interrupted: "interrupted", failed: "failed" }[turnStatus];
      if (prompt && outcome && turn.some((message) => message.role === "assistant")) prompt.outcome = outcome;
      if (turnStatus === "interrupted") {
        const interrupted = turn.findLast((message) => message.role === "assistant");
        if (interrupted) {
          interrupted.stopReason = "aborted";
          // Read back, it says so exactly as the live stream did.
          if (wasDiscarded(interrupted, { keepsPartial: CODEX_CAPABILITIES.interruptKeepsPartial })) {
            interrupted.discarded = true;
          }
        }
      } else if (!turn.some((message) => message.role === "assistant" && message.stopReason === "stop")) {
        const answer = turn.findLast((message) => message.role === "assistant"
          && message.blocks.some((block) => block.kind === "text")
          && !message.blocks.some((block) => block.kind === "tool_call"));
        if (answer) { answer.stopReason = "stop"; answer.interim = false; }
      }
      turnStart = messages.length;
      interim = null;
    };
    for (const row of rows || []) {
      const item = row.item || {};
      if (row.turnId !== turnId) {
        closeTurn();
        turnId = row.turnId;
        turnStatus = row.turnStatus;
      }
      if (item.type === "userMessage") {
        closeTurn();
        messages.push({ id: item.clientId || item.id, role: "user", content: CodexAppServerAdapter.itemText(item) });
        answering = messages.at(-1).id;
        turnStart = messages.length;
        continue;
      }
      if (item.type === "agentMessage") {
        const text = CodexAppServerAdapter.itemText(item);
        const answer = item.phase === "final_answer";
        messages.push({ id: item.id || `assistant-${turnId}`, role: "assistant", content: text,
          blocks: [{ kind: "text", text }], stopReason: answer ? "stop" : "toolUse",
          interim: !answer, answers: answering });
        interim = answer ? null : messages.at(-1);
        continue;
      }
      if (item.type === "reasoning") {
        // Codex keeps only the provider's encrypted copy of reasoning with no summary.
        const text = itemPartsText(item.summary);
        messages.push({ id: item.id || `reasoning-${turnId}`, role: "assistant", content: "",
          blocks: [{ kind: "thinking", text, redacted: !text }], stopReason: "toolUse", interim: true, answers: answering });
        interim = messages.at(-1);
        continue;
      }
      const activity = CodexAppServerAdapter.toolActivity(item);
      if (!activity) continue;
      if (!interim) {
        messages.push({ id: `assistant-${item.id}`, role: "assistant", content: "", blocks: [],
          stopReason: "toolUse", interim: true, answers: answering });
        interim = messages.at(-1);
      }
      interim.blocks.push({ kind: "tool_call", toolCallId: item.id, name: activity.name, input: activity.input });
      const cancelled = row.turnStatus === "interrupted" && item.status === "inProgress";
      tools.push({ toolCallId: item.id, name: activity.name, kind: activity.kind, subject: activity.subject, input: activity.input, done: true,
        output: textResult(truncate(activity.output)), isError: activity.isError && !cancelled, ...(cancelled ? { cancelled } : {}) });
    }
    closeTurn();
    return { messages, tools };
  }

  refreshPlan(record) {
    if (Date.now() - CodexAppServerAdapter.plan.at < 60_000) return;
    CodexAppServerAdapter.plan.at = Date.now();
    void codexPlanUsage().then(async (polled) => polled
      || codexPlan((await this.request(record, "account/rateLimits/read", {}))?.rateLimits, CodexAppServerAdapter.plan.value)).then((plan) => {
      CodexAppServerAdapter.plan.value = plan || CodexAppServerAdapter.plan.value;
      if (!record.contextUsage) return;
      record.contextUsage = { ...record.contextUsage, plan: CodexAppServerAdapter.plan.value };
      this.publish(record, { type: "usage", generationId: record.generation?.id || null, contextUsage: record.contextUsage,
        sessionStats: record.sessionStats || null, cacheStats: record.cache?.stats || null });
    }).catch(() => {});
  }

  /** Codex's rollout file records every token_count it reported live; each new total is a request for the cache. */
  async contextFromHistory({ opaqueSession }) {
    const threadId = typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId;
    if (!threadId) return null;
    let text = null;
    text = await this.processes({ nodeId: opaqueSession?.nodeId }).read("codexRollout", threadId);
    if (!text) return null;
    const requests = [];
    let window = null;
    let model = null;
    let total = null;
    let plan = null;
    for (const line of text.split("\n")) {
      let entry;
      try { entry = line.trim() ? JSON.parse(line) : null; } catch { entry = null; }
      const payload = entry?.payload;
      if (entry?.type === "turn_context" && payload?.model) model = payload.model;
      if (payload?.type === "context_compacted") requests.push(null);
      const info = payload?.type === "token_count" ? payload.info : null;
      if (!info?.last_token_usage || info.total_token_usage?.total_tokens === total) continue;
      total = info.total_token_usage?.total_tokens;
      window = info.model_context_window || window;
      if (payload.rate_limits) plan = codexPlan(payload.rate_limits, plan);
      const last = info.last_token_usage;
      requests.push({ input: Math.max(0, last.input_tokens - last.cached_input_tokens), output: last.output_tokens,
        cacheRead: last.cached_input_tokens, cacheWrite: last.cache_write_input_tokens || 0, reasoning: last.reasoning_output_tokens });
    }
    return usageFromRequests(requests, { contextWindow: window, model, plan: await codexPlanUsage() || CodexAppServerAdapter.plan.value || plan });
  }

  async readTranscript({ liveSessionId, chatId, opaqueSession, project, turns: turnLimit, before = null }) {
    const live = (liveSessionId ? this.get(liveSessionId) : null) || this.getByChatId(chatId);
    const threadId = live?.sessionId
      || (typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId);
    if (!threadId) return { messages: [], tools: [], page: { before: null } };
    const device = !live && opaqueSession?.nodeId && project?.place
      ? await this.start({ chatId: `read-${crypto.randomUUID()}`, cwd: project.workingRoot, nodeId: opaqueSession.nodeId, place: project.place })
      : null;
    if (device) device.ephemeral = true;
    const transport = live || device || await this.discovery(project?.workingRoot);
    try {
      return await this.readThread(transport, threadId, { turnLimit, before });
    } finally {
      if (device) await this.close(device.id).catch(() => {});
    }
  }

  async readThread(transport, threadId, { turnLimit, before }) {
    const result = await this.request(transport, "thread/read", { threadId, includeTurns: true });
    const allTurns = result?.thread?.turns || [];
    const turns = Number.isSafeInteger(turnLimit) && turnLimit > 0 ? allTurns.slice(-turnLimit) : allTurns;
    const rows = turns.flatMap((turn) => (turn.items || [])
      .map((item) => ({ turnId: turn.id, turnStatus: turn.status, item })));
    const transcriptRows = rows.length || result?.thread?.historyMode !== "paginated"
      ? rows
      : await this.items(transport, threadId,
        Number.isSafeInteger(turnLimit) && turnLimit > 0 ? Math.min(turnLimit, REPLAY_PAGE_LIMIT) : REPLAY_PAGE_LIMIT);
    const window = CodexAppServerAdapter.recent(transcriptRows, { before });
    return { ...CodexAppServerAdapter.threadTranscript(window.rows), page: window.page };
  }
  async readHistory(options) {
    const { messages } = await this.readTranscript(options);
    let child = null;
    let leafId = null;
    for (const message of [...messages].reverse()) {
      if (!message.id) continue;
      const node = { entry: {
        id: message.id,
        parentId: null,
        timestamp: message.timestamp || null,
        type: "message",
        display: `${message.role}: ${String(message.content || "").replace(/\s+/g, " ").trim().slice(0, 240)}`,
        kind: message.role,
        hidden: false,
        forkable: message.role === "user",
        regeneratable: message.role === "user",
      }, children: child ? [child] : [] };
      if (child) child.entry.parentId = node.entry.id;
      else leafId = node.entry.id;
      child = node;
    }
    return { mode: "linear", leafId, tree: child ? [child] : [] };
  }

  static itemText(item) {
    if (typeof item?.text === "string") return item.text;
    if (typeof item?.content === "string") return item.content;
    if (Array.isArray(item?.content)) {
      return item.content.map((part) => typeof part === "string" ? part : part?.text || "").join("");
    }
    return "";
  }

  async start({ chatId, projectId, cwd, nodeId = null, place = null }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    this.processes({ nodeId }).require("codex", "Codex");
    const record = {
      id: crypto.randomUUID(), chatId, projectId, cwd, nodeId, place, status: "starting",
      active: false, stopping: false, sessionId: null, model: "", thinkingLevel: "", generation: null,
      clients: new Set(), events: [], pending: new Map(),
      steering: [], followUp: [],
      permissionMode: "", permissionProfile: "", approvalPolicy: "", approvalsReviewer: "", serviceLevel: "",
      // `rpcRequestId` matches a response back to its request, meaningful to nothing outside this file;
      // `generationSeq` orders a turn's events and goes on the wire as `seq`.
      rpcRequestId: 0, generationSeq: 0, messageIds: new Set(),
      ready: false,
    };
    this.sessions.add(record);
    record.scope.defer(() => this.fail(record, new Error("The Codex session closed")));
    // Announced the moment it exists, so the chat can show its agent coming up.
    this.emit("changed", { record, reason: "created" });
    try {
      // Rust's websocket endpoint rejects extension negotiation, so per-message compression is not offered.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        record.socket = new WebSocket("ws://localhost/rpc", {
          perMessageDeflate: false,
          createConnection: () => this.processes(record).connect({ harness: "codex", path: this.socketPath }),
        });
        try {
          await new Promise((resolve, reject) => {
            record.socket.once("open", resolve);
            record.socket.once("error", reject);
          });
          break;
        } catch (cause) {
          record.socket.terminate();
          if (attempt || !["ECONNREFUSED", "ENOENT"].includes(cause.code)) throw cause;
          await this.startDaemon(record);
        }
      }
      record.socket.on("message", (data) => this.receive(record, String(data)));
      record.socket.on("error", (cause) => this.fail(record, cause));
      record.socket.once("close", (code) => this.exit(record, code));
      await this.request(record, "initialize", {
        clientInfo: { name: "conduit", title: "Conduit", version: "0.2.0" },
        capabilities: { experimentalApi: true },
      });
      this.write(record, { method: "initialized" });
      record.status = "running";
      record.ready = true;
      this.emit("changed", { record, reason: "ready" });
      return record;
    } catch (cause) {
      record.status = "stopped";
      record.socket?.terminate();
      this.sessions.remove(record.id);
      throw cause;
    }
  }

  request(record, method, params) {
    const id = ++record.rpcRequestId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        record.pending.delete(id);
        reject(error(`Codex app-server timed out during ${method}`, "rpc_timeout", 504));
      }, this.requestTimeoutMs);
      timer.unref?.();
      record.pending.set(id, { resolve, reject, timer });
      try { this.write(record, { id, method, params }); }
      catch (cause) {
        clearTimeout(timer);
        record.pending.delete(id);
        reject(cause);
      }
    });
  }

  write(record, message) {
    if (record.socket?.readyState === WebSocket.OPEN) {
      record.socket.send(JSON.stringify(message));
      return;
    }
    // Kept for isolated protocol tests that provide a JSONL sink.
    if (record.child?.stdin?.writable) {
      record.child.stdin.write(`${JSON.stringify(message)}\n`);
      return;
    }
    throw error("Codex app-server is unavailable");
  }

  receive(record, line) {
    let message;
    try { message = JSON.parse(line); }
    catch { return; }
    if (message.id != null && !message.method) {
      const pending = record.pending.get(message.id);
      if (!pending) return;
      record.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(error(message.error.message || "Codex request failed"));
      else pending.resolve(message.result);
      return;
    }
    // A message carrying both an id and a method is a request from the server and needs a reply; unanswered, it stalls
    // the turn silently.
    if (message.id != null && message.method) return this.serverRequest(record, message);
    if (message.method) this.notification(record, message.method, message.params || {});
  }

  /** Every path here replies: anything not understood is refused at once, so the turn fails loudly instead of hanging. */
  serverRequest(record, message) {
    if (message.method === USER_INPUT) return this.userInput(record, message);
    const descriptor = APPROVALS[message.method];
    if (!descriptor) {
      this.write(record, { id: message.id, error: { code: -32601,
        message: `Conduit does not handle ${message.method}` } });
      return;
    }
    const params = message.params || {};
    const requestId = params.approvalId || params.itemId || params.callId || `approval-${message.id}`;
    const generationId = params.turnId || record.generation?.id || null;
    const host = { id: requestId, kind: "select", title: descriptor.title(params), message: descriptor.message(params),
      options: [...APPROVAL_OPTIONS], placeholder: "", prefill: "", timeoutMs: null };
    this.ask(record, host, { rpcId: message.id, decisions: descriptor.decisions, generationId });
  }

  userInput(record, message) {
    const params = message.params || {};
    const generationId = params.turnId || record.generation?.id || null;
    const host = userInputRequest(params.itemId || `question-${message.id}`, params);
    this.ask(record, host, { rpcId: message.id, generationId });
  }

  ask(record, host, held) {
    const { generationId } = held;
    this.publish(record, askHost(record, host.id, host, held));
    // What the session is busy with, not a transition the turn made, so not a `status` in the turn's sequence.
    this.publish(record, { type: "runtime_state", generationId, session: this.view(record) });
  }

  respondHostUi(id, response) {
    const record = this.get(id);
    if (!record) throw error("Codex session is not running");
    const requestId = response?.id;
    const pending = take(record, requestId);
    // Resolved already: answered in the Codex TUI, or a duplicate click.
    if (!pending) return null;
    if (pending.host.kind === "question") {
      this.write(record, { id: pending.rpcId, result: { answers: userInputAnswers(pending.host, response) } });
      this.settled(record, pending);
      return null;
    }
    const decision = pending.decisions[approvalChoice(response)];
    this.write(record, { id: pending.rpcId, result: { decision } });
    this.settled(record, pending);
    return decision;
  }

  settleApproval(record, requestId) {
    const pending = take(record, requestId);
    if (pending) this.settled(record, pending);
  }

  settled(record, pending) {
    this.publish(record, pending.event);
    this.publish(record, { type: "runtime_state", generationId: pending.generationId, session: this.view(record) });
  }

  /** Without a log there is no order to state a position in. */
  states(record) {
    return Boolean(this.sessions.logFor(record));
  }

  /** Codex does not say where a message belongs once a turn has been steered, queued into or interrupted; this does. */
  openMessage(record, id, role, { answers = null, generationId = null, ...fields } = {}) {
    if (!id || !this.states(record)) return null;
    record.openMessages = record.openMessages || new Set();
    if (role === "assistant") record.openMessages.add(id);
    this.publish(record, messageOpen({ id, role, ...fields, generationId, answers }));
    return id;
  }

  closeMessage(record, id, stopReason = null, { blocks = [], interim = false } = {}) {
    if (!id || !this.states(record)) return null;
    record.openMessages?.delete(id);
    this.publish(record, messageClose({
      messageId: id, stopReason,
      // Codex does not persist the answer it was writing when a turn was interrupted: the thread keeps the prompt and
      // an empty reasoning stub.
      keepsPartial: CODEX_CAPABILITIES.interruptKeepsPartial,
      interim,
      blocks,
      // The close is the statement the transcript keeps; Codex names no provider or write-time on the item.
      model: record.model || null,
    }));
    return id;
  }

  /** Codex reports commands beside the messages, so a turn's commentary and its commands share one row. */
  settleCarrier(record, nextMessageId) {
    const previous = record.turn;
    if (!previous || previous.messageId === nextMessageId) return;
    if (!record.openMessages?.has(previous.messageId)) return;
    this.closeMessage(record, previous.messageId, "toolUse", { blocks: previous.blocks || [], interim: true });
  }

  /**
   * A row is given up only when nothing was ever written into it. An interrupted turn may never report the item at all,
   * and dropping it would take away text the reader watched arrive.
   */
  dropUnwrittenMessages(record, stopReason = "aborted") {
    const open = record.openMessages;
    if (!open?.size) return;
    for (const id of [...open]) {
      const written = record.turn?.messageId === id ? record.turn : null;
      if (written?.blocks?.length) {
        const interim = written.phase !== "final_answer"
          && (written.phase != null || written.blocks.some((block) => block.kind === "tool_call") || !written.blocks.some((block) => block.kind === "text"));
        this.closeMessage(record, id, interim ? "toolUse" : stopReason, { blocks: written.blocks, interim });
      } else {
        this.publish(record, messageDrop({ messageId: id }));
        open.delete(id);
      }
    }
    open.clear();
  }

  /**
   * The reasoning rollup reads text followed by a tool call as interim work. Codex reports its commands beside the
   * messages, so they go where the rollup looks, or every commentary line renders as its own answer.
   */
  attachToolCall(record, turnId, toolCallId, activity) {
    if (!record.turn || record.turn.id !== turnId) {
      const messageId = `tools-${turnId}-${record.generationSeq}`;
      this.settleCarrier(record, messageId);
      this.openMessage(record, messageId, "assistant", { answers: record.answering || null, generationId: turnId });
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "start",
        seq: ++record.generationSeq, messageId });
      record.turn = { id: turnId, messageId, blocks: [] };
    }
    record.turn.blocks.push({ kind: "tool_call", contentIndex: record.turn.blocks.length,
      id: toolCallId, toolCallId, name: activity.name, input: activity.input });
    this.publish(record, { type: "assistant_content", generationId: turnId, phase: "final",
      seq: ++record.generationSeq, messageId: record.turn.messageId, stopReason: "toolUse",
      errorMessage: null, blocks: record.turn.blocks });
  }

  /** Until `item/completed` replaces it, this is what the reader has seen, which is all an interrupt leaves behind. */
  streamInto(record, turnId, messageId, kind) {
    if (record.turn?.messageId === messageId) return record.turn;
    this.settleCarrier(record, messageId);
    record.turn = { id: turnId, messageId, phase: null,
      blocks: [kind === "thinking"
        ? { kind: "thinking", contentIndex: 0, text: "", redacted: false }
        : { kind: "text", contentIndex: 0, text: "" }] };
    return record.turn;
  }

  notification(record, method, params) {
    const turnId = params.turn?.id || params.turnId || record.generation?.id || null;
    if (method === "thread/name/updated") {
      const name = typeof params.threadName === "string" ? params.threadName.trim() : "";
      if (name && (!params.threadId || params.threadId === record.sessionId)) {
        record.title = name;
        this.emit("changed", { record, reason: "named", name });
      }
    } else if (method === "turn/started") {
      const stopOwed = record.turnStarting && record.stopping;
      beginTurn(record, turnId, { stopping: Boolean(stopOwed) });
      record.turn = null;
      this.publish(record, turnStarted(record, turnId));
      if (stopOwed) void this.cancel(record.id, turnId).catch((cause) => {
        this.emit("diagnostic", { chatId: record.chatId, message: `Codex turn interrupt failed: ${cause.message}` });
      });
    } else if (method === "thread/tokenUsage/updated" && params.tokenUsage) {
      // OpenAI counts cached input inside input; Conduit's shape keeps them apart.
      const { last, total, modelContextWindow } = params.tokenUsage;
      const split = (usage) => ({ input: Math.max(0, usage.inputTokens - usage.cachedInputTokens), output: usage.outputTokens,
        cacheRead: usage.cachedInputTokens, cacheWrite: usage.cacheWriteInputTokens || 0, reasoning: usage.reasoningOutputTokens, totalTokens: usage.totalTokens });
      const window = modelContextWindow || null;
      record.contextUsage = { tokens: last.totalTokens, contextWindow: window, percent: window ? (last.totalTokens / window) * 100 : null,
        model: record.model || null, lastRequestUsage: split(last), compactions: record.compactions || 0,
        plan: CodexAppServerAdapter.plan.value };
      this.refreshPlan(record);
      if (record.compactions == null) {
        record.compactions = 0;
        void this.contextFromHistory({ opaqueSession: this.opaqueSessionOf(record) }).then((history) => {
          record.compactions += history?.contextUsage.compactions || 0;
        }).catch(() => {});
      }
      // Each request reports once, but its update can repeat; a new total is a new request.
      record.cache ||= { stats: null, previousPromptTokens: null };
      if (total.totalTokens !== record.cache.total) { record.cache.total = total.totalTokens; countCacheRequest(record.cache, split(last)); }
      const tokens = split(total);
      record.sessionStats = { ...(record.sessionStats || {}), tokens: { ...tokens, total: total.totalTokens }, cost: 0 };
      this.publish(record, { type: "usage", generationId: turnId, contextUsage: record.contextUsage, sessionStats: record.sessionStats, cacheStats: record.cache.stats || null });
    } else if (method === "item/started" && params.item?.type === "contextCompaction") {
      record.compacting = true;
      this.publish(record, { type: "compaction", generationId: turnId, active: true });
    } else if (method === "account/rateLimits/updated" && params.rateLimits) {
      CodexAppServerAdapter.plan = { at: Date.now(), value: declarePlan("codex", codexPlan(params.rateLimits, null)) };
      if (record.contextUsage) {
        record.contextUsage = { ...record.contextUsage, plan: CodexAppServerAdapter.plan.value };
        this.publish(record, { type: "usage", generationId: turnId, contextUsage: record.contextUsage, sessionStats: record.sessionStats || null, cacheStats: record.cache?.stats || null });
      }
    } else if ((method === "item/completed" && params.item?.type === "contextCompaction") || method === "thread/compacted") {
      if (record.compacting || method === "thread/compacted") record.compactions = (record.compactions || 0) + 1;
      record.compacting = false;
      this.publish(record, { type: "compaction", generationId: turnId, active: false });
    } else if (method === "item/started" && params.item?.type === "userMessage") {
      const messageId = params.item.clientId || params.item.id;
      if (!messageId || record.messageIds.has(messageId)) return;
      record.messageIds.add(messageId);
      const steeringCount = record.steering.length;
      record.steering = record.steering.filter((item) => item.id !== messageId);
      if (record.steering.length !== steeringCount) this.publishQueue(record);
      // An answer that follows a steered or CLI-typed message answers it, not the prompt that opened the turn.
      if (this.states(record) && record.answering && record.prompts?.has(record.answering)) {
        this.publish(record, turnSettle({ promptId: record.answering, outcome: "complete", generationId: turnId }));
        record.prompts.delete(record.answering);
      }
      record.answering = messageId;
      (record.prompts ||= new Set()).add(messageId);
      this.openMessage(record, messageId, "user", {
        content: CodexAppServerAdapter.itemText(params.item), timestamp: new Date().toISOString(),
      });
    } else if (method === "item/agentMessage/delta") {
      const messageId = params.itemId || `assistant-${turnId}`;
      if (!record.messageIds.has(messageId)) {
        record.messageIds.add(messageId);
        this.openMessage(record, messageId, "assistant", { answers: record.answering || null, generationId: turnId });
        this.publish(record, { type: "assistant_content", generationId: turnId, phase: "start",
          seq: ++record.generationSeq, messageId });
      }
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "delta", seq: ++record.generationSeq,
        messageId, contentIndex: 0, blockKind: "text", delta: params.delta || "" });
      // Codex never reports an interrupted answer's item, so the deltas are the only copy of its text.
      this.streamInto(record, turnId, messageId, "text");
      record.turn.blocks[0].text += params.delta || "";
    } else if (method === "item/reasoning/summaryTextDelta") {
      const messageId = params.itemId || `reasoning-${turnId}`;
      if (!record.messageIds.has(messageId)) {
        record.messageIds.add(messageId);
        this.openMessage(record, messageId, "assistant", { answers: record.answering || null, generationId: turnId });
        this.publish(record, { type: "assistant_content", generationId: turnId, phase: "start",
          seq: ++record.generationSeq, messageId });
      }
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "delta",
        seq: ++record.generationSeq, messageId, contentIndex: params.summaryIndex || 0,
        blockKind: "thinking", delta: params.delta || "" });
      this.streamInto(record, turnId, messageId, "thinking");
      record.turn.blocks[0].text += params.delta || "";
    } else if (method === "item/completed" && params.item?.type === "agentMessage") {
      const messageId = params.item.id || `assistant-${turnId}`;
      if (!record.messageIds.has(params.item.id)) {
        record.messageIds.add(messageId);
        this.openMessage(record, messageId, "assistant", { answers: record.answering || null, generationId: turnId });
        this.publish(record, { type: "assistant_content", generationId: turnId,
          phase: "start", seq: ++record.generationSeq, messageId });
      }
      const text = CodexAppServerAdapter.itemText(params.item);
      const interim = params.item.phase !== "final_answer";
      this.settleCarrier(record, messageId);
      record.turn = { id: turnId, messageId, phase: params.item.phase || null,
        blocks: [{ kind: "text", contentIndex: 0, text }] };
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "final", seq: ++record.generationSeq,
        messageId, stopReason: interim ? "toolUse" : "stop",
        errorMessage: null, blocks: record.turn.blocks });
    } else if (method === "item/completed" && params.item?.type === "reasoning") {
      const messageId = params.item.id || `reasoning-${turnId}`;
      const text = itemPartsText(params.item.summary);
      if (!record.messageIds.has(messageId)) {
        record.messageIds.add(messageId);
        this.openMessage(record, messageId, "assistant", { answers: record.answering || null, generationId: turnId });
        this.publish(record, { type: "assistant_content", generationId: turnId,
          phase: "start", seq: ++record.generationSeq, messageId });
      }
      this.settleCarrier(record, messageId);
      record.turn = { id: turnId, messageId, blocks: [{ kind: "thinking", contentIndex: 0, text, redacted: !text }] };
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "final",
        seq: ++record.generationSeq, messageId, stopReason: "toolUse", errorMessage: null, blocks: record.turn.blocks });
    } else if (method === "item/started" || method === "item/completed") {
      const activity = CodexAppServerAdapter.toolActivity(params.item || {});
      if (!activity) return;
      if (method === "item/started") {
        this.publish(record, { type: "tool_activity", generationId: turnId, phase: "start", seq: ++record.generationSeq,
          toolCallId: params.item.id, name: activity.name, kind: activity.kind, subject: activity.subject, input: activity.input });
        this.attachToolCall(record, turnId, params.item.id, activity);
        if (this.states(record)) {
          this.publish(record, toolOpen({ toolCallId: params.item.id, name: activity.name,
            kind: activity.kind, subject: activity.subject, input: activity.input, messageId: record.turn?.messageId || null, generationId: turnId }));
        }
      } else {
        // A search only says what it did once it has.
        this.publish(record, { type: "tool_activity", generationId: turnId, phase: "end", seq: ++record.generationSeq,
          toolCallId: params.item.id, name: activity.name, kind: activity.kind, subject: activity.subject,
          output: truncate(activity.output), isError: activity.isError });
        if (this.states(record)) {
          this.publish(record, toolClose({ toolCallId: params.item.id, output: truncate(activity.output),
            isError: activity.isError, cancelled: Boolean(activity.isError && record.stopping),
            kind: activity.kind, subject: activity.subject || null, generationId: turnId }));
        }
      }
    } else if (method === "serverRequest/resolved") {
      // Answered somewhere else: the Codex TUI, or another client on the same thread.
      for (const pending of asked(record)) {
        if (params.requestId != null && pending.rpcId !== params.requestId) continue;
        this.settleApproval(record, pending.id);
      }
    } else if (method === "turn/completed") {
      // The one exception to the harness's word standing: Codex ends a turn it was told to interrupt as "completed",
      // with what it had written so far, so its "completed" says nothing once a stop was asked for.
      const said = { completed: record.stopping ? null : "complete", interrupted: "interrupted", failed: "failed" }[params.turn?.status];
      const outcome = outcomeOf(said, record.stopping) || "complete";
      const failed = outcome === "failed";
      const interrupted = outcome === "interrupted";
      endTurn(record, outcome);
      record.compacting = false;
      for (const { id } of asked(record)) this.settleApproval(record, id);
      // An interrupted turn's last message is where it got to, not its answer: calling it one would hide the cut.
      const promoted = !failed && !interrupted && record.turn?.phase == null && record.turn?.blocks?.some((block) => block.kind === "text")
        && !record.turn.blocks.some((block) => block.kind === "tool_call");
      if (promoted) {
        this.publish(record, { type: "assistant_content", generationId: turnId, phase: "final",
          seq: ++record.generationSeq, messageId: record.turn.messageId, stopReason: "stop",
          errorMessage: null, blocks: record.turn.blocks });
        this.closeMessage(record, record.turn.messageId, "stop", { blocks: record.turn.blocks, interim: false });
      }
      this.dropUnwrittenMessages(record, failed || interrupted ? "aborted" : "stop");
      for (const promptId of this.states(record) ? record.prompts || [] : []) {
        this.publish(record, turnSettle({ promptId, generationId: turnId, outcome }));
      }
      record.prompts = new Set();
      record.answering = null;
      if (failed) this.publish(record, { type: "error", generationId: turnId, error: { code: "backend_unavailable", message: params.turn?.error?.message || "Codex turn failed" } });
      this.publish(record, turnEnded(record, outcome, turnId));
      this.emit("settled", { record, completed: outcome === "complete" });
      if (record.status !== "stopped" && record.followUp.length) void this.flushFollowUp(record);
    }
  }

  /** Codex has no endpoint for a follow-up, so Conduit holds it and starts the next turn itself. */
  async queue(id, type, message, { attachments = [] } = {}) {
    const record = this.get(id);
    if (!record) throw error("Codex session is not running");
    const userMessage = parseAttachmentEnvelope(message).message;
    if (!userMessage.trim()) throw error("Queued message is empty", "invalid_request", 400);
    const queued = { id: crypto.randomUUID(), message: userMessage, attachments };
    if (type === "follow_up") {
      record.followUp.push(queued);
      this.publishQueue(record);
      return { queued: "follow_up", attachmentIdentity: { messageId: queued.id } };
    }
    const turnId = record.generation?.id;
    if (!turnId) throw error("Codex is not running a turn to steer", "invalid_request", 409);
    record.steering.push(queued);
    this.publishQueue(record);
    try {
      await this.request(record, "turn/steer", {
        threadId: record.sessionId, expectedTurnId: turnId,
        clientUserMessageId: queued.id,
        input: await CodexAppServerAdapter.inputItems(userMessage, attachments, { onDevice: Boolean(record.nodeId) }),
      });
    } catch (cause) {
      record.steering = record.steering.filter((item) => item !== queued);
      this.publishQueue(record);
      throw cause;
    }
    return { queued: "steer", attachmentIdentity: { messageId: queued.id } };
  }

  async flushFollowUp(record) {
    const queued = record.followUp.shift();
    if (queued === undefined) return;
    this.publishQueue(record);
    try { await this.prompt(record.id, queued.message, { attachments: queued.attachments, clientUserMessageId: queued.id }); }
    catch (cause) {
      this.publish(record, { type: "error", generationId: record.generation?.id || null,
        error: { code: "backend_unavailable", message: cause?.message || "Queued message could not be sent" } });
    }
  }

  async clearQueue(id) {
    const record = this.get(id);
    if (!record) throw error("Codex session is not running");
    const taken = { steering: [...record.steering], followUp: [...record.followUp] };
    record.steering = [];
    record.followUp = [];
    this.publishQueue(record);
    return { ...taken, discardedAttachmentIdentities: [...taken.steering, ...taken.followUp]
      .map((item) => ({ messageId: item.id })).filter((identity) => identity.messageId) };
  }

  publishQueue(record) {
    const text = (item) => typeof item === "string" ? item : item.message;
    this.publish(record, { type: "queue_state", generationId: record.generation?.id || null,
      queue: { steering: record.steering.map(text), followUp: record.followUp.map(text) } });
  }

  /** Omitted keys let Codex fall back to the user's own `~/.codex/config.toml`. */
  static policy(approvalPolicy = "", approvalsReviewer = "", sandbox = null) {
    return {
      ...(APPROVAL_POLICIES.includes(approvalPolicy) ? { approvalPolicy } : {}),
      ...(APPROVAL_REVIEWERS.includes(approvalsReviewer) ? { approvalsReviewer } : {}),
      ...(sandbox ? { sandbox: typeof sandbox === "string" ? { type: sandbox } : sandbox } : {}),
    };
  }

  /** A device's Codex cannot open this server's paths. */
  static async inputItems(message, attachments, { onDevice = false } = {}) {
    const images = (attachments || []).filter((item) => String(item?.type || "").startsWith("image/") && item.path);
    const files = (attachments || []).filter((item) => !String(item?.type || "").startsWith("image/") && item.path);
    const text = [parseAttachmentEnvelope(message).message,
      ...(onDevice ? await Promise.all(files.map(attachmentForDevice)) : files.map((item) => `Attached file: ${item.path}`))]
      .filter(Boolean).join("\n\n");
    const pictures = onDevice
      ? await Promise.all(images.map(async (item) => ({ type: "image", url: await imageDataUrl(item) })))
      : images.map((item) => ({ type: "localImage", path: item.path }));
    return [...pictures, { type: "text", text }];
  }

  async prompt(id, message, options) {
    const record = this.get(id);
    if (!record?.sessionId) throw error("Codex thread is not ready");
    const clientUserMessageId = options?.clientUserMessageId || crypto.randomUUID();
    // Stated before it is sent, or the answer arriving first is placed against the previous turn.
    record.messageIds.add(clientUserMessageId);
    record.answering = clientUserMessageId;
    // The slot is held from turn/start until Codex says the turn started.
    record.turnStarting = true;
    record.generation = null;
    record.stopping = false;
    record.failed = false;
    const prompts = new Set([clientUserMessageId]);
    record.prompts = prompts;
    this.openMessage(record, clientUserMessageId, "user", {
      content: parseAttachmentEnvelope(message).message,
      timestamp: new Date().toISOString(),
    });
    let result;
    try {
      result = await this.request(record, "turn/start", {
        threadId: record.sessionId,
        clientUserMessageId,
        input: await CodexAppServerAdapter.inputItems(message, options?.attachments, { onDevice: Boolean(record.nodeId) }),
        ...(record.model ? { model: record.model } : {}),
        ...(record.thinkingLevel ? { effort: record.thinkingLevel } : {}),
        ...(record.serviceLevel ? { serviceTier: record.serviceLevel } : {}),
        ...(record.permissionProfile ? { permissions: record.permissionProfile } : {}),
        ...CodexAppServerAdapter.policy(record.approvalPolicy, record.approvalsReviewer),
      });
    } catch (cause) {
      // A late reply must not undo a started, settled or replacement turn.
      if (record.prompts !== prompts || !record.turnStarting) throw cause;
      // A prompt Codex refused writes nothing, so the row stated for it goes back.
      record.messageIds.delete(clientUserMessageId);
      record.answering = null;
      record.turnStarting = false;
      record.stopping = false;
      if (this.states(record)) {
        this.publish(record, messageDrop({ messageId: clientUserMessageId }));
      }
      throw cause;
    }
    return {
      generationId: result.turn?.id || record.generation?.id || null,
      attachmentIdentity: { messageId: clientUserMessageId },
    };
  }

  async cancel(id, generationId = null) {
    const record = this.get(id);
    if (!record?.sessionId || (!record.active && !record.turnStarting)) return false;
    const generation = record.generation;
    const turnId = record.turnStarting ? null : generation?.id;
    if (generationId && generationId !== turnId) return false;
    if (!record.turnStarting && !turnId) return false;
    record.stopping = true;
    // The starting turn has no id yet; turn/started sends its owed interrupt.
    if (record.turnStarting) return true;
    try {
      await this.request(record, "turn/interrupt", { threadId: record.sessionId, turnId });
    } catch (cause) {
      if (record.generation === generation) {
        record.stopping = false;
      }
      throw cause;
    }
    return true;
  }

  async close(id) {
    const record = this.get(id);
    if (!record) return false;
    try {
      if (record.sessionId && record.socket?.readyState === WebSocket.OPEN) {
        await this.request(record, "thread/unsubscribe", { threadId: record.sessionId });
      }
    } catch (cause) {
      this.emit("diagnostic", { chatId: record.chatId, message: `Codex thread unsubscribe failed: ${cause.message}` });
    } finally {
      record.status = "stopped";
      record.active = false;
      if (record.socket && record.socket.readyState !== WebSocket.CLOSED) record.socket.close();
      await waitForClose(record.socket);
      this.sessions.remove(id);
      this.emit("removed", { id, chatId: record.chatId });
    }
    return true;
  }
  shutdownResources() {
    clearTimeout(this.discoveryTimer);
    this.discoveryTimer = null;
    this.discoveryId = null;
  }

  async setModel(id, model) {
    const record = this.get(id);
    if (!record) throw error("Codex app-server is unavailable");
    record.model = model;
    return model;
  }
  async setThinkingLevel(id, thinkingLevel) {
    const record = this.get(id);
    if (!record) throw error("Codex app-server is unavailable");
    record.thinkingLevel = thinkingLevel;
    return thinkingLevel;
  }
  async setServiceLevel(id, serviceLevel) {
    const record = this.get(id);
    if (!record) throw error("Codex app-server is unavailable");
    record.serviceLevel = serviceLevel;
    return serviceLevel;
  }
  async compact(id) {
    const record = this.get(id);
    if (!record?.sessionId) throw error("Codex thread is not ready");
    return this.request(record, "thread/compact/start", { threadId: record.sessionId });
  }
  async setPermissionMode(id, mode) {
    const record = this.get(id);
    if (!record) throw error("Codex app-server is unavailable");
    record.permissionMode = mode.id;
    record.permissionProfile = mode.profile;
    record.approvalPolicy = mode.approvalPolicy;
    record.approvalsReviewer = mode.approvalsReviewer;
    return mode.id;
  }
  async listPermissionModes(id, cwd) {
    const record = id ? this.get(id) : null;
    if (!record) return [];
    const params = { ...(cwd ? { cwd } : {}) };
    const [catalogue, configResult, requirementsResult] = await Promise.all([
      this.request(record, "permissionProfile/list", params),
      this.request(record, "config/read", { ...params, includeLayers: false }),
      this.request(record, "configRequirements/read", {}),
    ]);
    const profiles = catalogue.data || [];
    const requirements = requirementsResult?.requirements || {};
    const allowedProfiles = requirements.allowedPermissionProfiles;
    const profileAllowed = (profile) => profile?.allowed !== false
      && (!allowedProfiles || allowedProfiles[profile.id] !== false);
    const allowedPolicies = requirements.allowedApprovalPolicies;
    const policyAllowed = (policy) => !Array.isArray(allowedPolicies) || allowedPolicies.some((value) => value === policy);
    const byId = new Map(profiles.map((profile) => [profile.id, profile]));
    const modes = BUILTIN_PERMISSION_MODES
      .filter((mode) => profileAllowed(byId.get(mode.profile)) && policyAllowed(mode.approvalPolicy))
      .map((mode) => ({ ...mode, allowed: true }));
    const config = configResult?.config || {};
    const configuredDefault = config.default_permissions || requirements.defaultPermissions || "";
    if (configuredDefault && profileAllowed(byId.get(configuredDefault))) {
      modes.push({ id: "custom", label: "Custom (config.toml)", description: "Uses the permissions defined in config.toml",
        profile: "", approvalPolicy: "", approvalsReviewer: "", allowed: true });
    }
    for (const profile of profiles) {
      if (profile.id.startsWith(":") || !profileAllowed(profile)) continue;
      modes.push({ id: `profile:${profile.id}`, label: profile.label || profile.id, description: profile.description || "",
        profile: profile.id, approvalPolicy: "", approvalsReviewer: "", allowed: true });
    }
    return modes;
  }
  async listAvailablePermissionModes(cwd) {
    const chatId = `permissions-${crypto.randomUUID()}`;
    let record = null;
    try {
      record = await this.start({ chatId, cwd });
      return await this.listPermissionModes(record.id, cwd);
    } finally {
      record ||= this.getByChatId(chatId);
      if (record) await this.close(record.id);
    }
  }
  async fork(id, historyTarget) {
    const entryId = historyTarget.nodeId;
    const record = this.get(id);
    if (!record?.sessionId) throw error("Codex thread is not ready");
    if (record.active || record.turnStarting) throw error("Codex session is busy", "generation_limit", 409);
    const sourceThreadId = record.sessionId;
    const read = await this.request(record, "thread/read", { threadId: sourceThreadId, includeTurns: true });
    const turns = read?.thread?.turns || [];
    const rows = turns.length || read?.thread?.historyMode !== "paginated"
      ? turns.flatMap((turn) => (turn.items || []).map((item) => ({ turnId: turn.id, item })))
      : await this.items(record, sourceThreadId);
    const target = rows.find((row) => row.item?.type === "userMessage"
      && [row.item.id, row.item.clientId].includes(entryId));
    if (!target?.turnId) throw error("Codex cannot find the selected message in its thread", "fork_target_missing", 409);
    const turnIds = [...new Set(rows.map((row) => row.turnId).filter(Boolean))];
    const targetIndex = turnIds.indexOf(target.turnId);
    const lastTurnId = targetIndex > 0 ? turnIds[targetIndex - 1] : null;
    const result = await this.request(record, "thread/fork", {
      threadId: sourceThreadId,
      ...(lastTurnId ? { lastTurnId } : {}),
      cwd: record.cwd,
      ...(record.model ? { model: record.model } : {}),
      ...(record.thinkingLevel ? { effort: record.thinkingLevel } : {}),
      ...(record.permissionProfile ? { permissions: record.permissionProfile } : {}),
      ...CodexAppServerAdapter.policy(record.approvalPolicy, record.approvalsReviewer),
    });
    record.sessionId = result.thread.id;
    if (!lastTurnId) {
      const reverted = await this.request(record, "thread/revert", {
        threadId: record.sessionId,
        beforeTurnId: target.turnId,
      });
      record.sessionId = reverted.thread?.id || record.sessionId;
    }
    record.model = result.model || record.model;
    record.thinkingLevel = result.reasoningEffort || record.thinkingLevel;
    record.permissionProfile = result.activePermissionProfile?.id || result.activePermissionProfile || record.permissionProfile;
    await this.request(record, "thread/unsubscribe", { threadId: sourceThreadId });
    this.emit("changed", { record, reason: "forked" });
    const text = CodexAppServerAdapter.itemText(target.item);
    return {
      text,
      sessionId: record.sessionId,
      opaqueSession: this.opaqueSessionOf(record),
      sourceMessage: { id: entryId, text },
    };
  }
  waitForSession() { return Promise.resolve(); }
  replay(id) { return this.runtimeState(this.get(id)); }
  getCapabilities() { return CODEX_CAPABILITIES; }
  async listModels(id) {
    const record = id ? this.get(id) : null;
    if (!record) return [];
    const result = await this.request(record, "model/list", {});
    return (result.data || []).filter((item) => !item.hidden).map((item) => {
      const thinkingLevels = (item.supportedReasoningEfforts || []).map((effort) => effort.reasoningEffort);
      return {
        provider: "openai", id: item.id, spec: item.id, label: item.displayName || item.id,
        reasoning: thinkingLevels.length > 0, thinkingLevels,
        defaultThinkingLevel: item.defaultReasoningEffort || thinkingLevels[0] || "",
      };
    });
  }
  listCommands() { return Promise.resolve([]); }
  listAvailableCommands() { return Promise.resolve([]); }
  async listAvailableModels(cwd) {
    const chatId = `catalog-${crypto.randomUUID()}`;
    let record = null;
    try {
      record = await this.start({ chatId, cwd });
      return await this.listModels(record.id);
    } finally {
      record ||= this.getByChatId(chatId);
      if (record) {
        await this.close(record.id);
        this.records.delete(record.id);
        this.byChatId.delete(chatId);
      }
    }
  }
  async listSessions({ cwd, limit = 50 } = {}) {
    if (!cwd) throw error("Codex session discovery requires a workspace", "session_cwd_mismatch", 400);
    return this.listThreads({ cwd, limit });
  }

  /** The client-side filter guards against a protocol that ignores `cwd`. */
  async listThreads({ cwd, limit = 60 } = {}) {
    const record = await this.discovery();
    const result = await this.request(record, "thread/list", {
      ...(cwd ? { cwd } : {}), limit, sortKey: "recency_at", sortDirection: "desc", useStateDbOnly: true,
    });
    return (result.data || []).map((thread) => ({
      id: thread.id,
      title: thread.name || thread.preview || "Untitled Codex session",
      preview: thread.preview || "",
      cwd: thread.cwd,
      branch: thread.gitInfo?.branch || null,
      originUrl: thread.gitInfo?.originUrl || null,
      createdAt: thread.createdAt || null,
      updatedAt: thread.recencyAt || thread.updatedAt || thread.createdAt || null,
      status: thread.status?.type || "unknown",
      source: thread.source?.type || thread.source || "unknown",
      replayFidelity: "full",
    })).filter((thread) => thread.id && (!cwd || thread.cwd === cwd));
  }

  /** Spawning per request costs seconds, which a dashboard that reloads on focus cannot pay. */
  async discovery(cwd = os.homedir()) {
    if (this.discoveryStart) return this.discoveryStart;
    const existing = this.discoveryId ? this.get(this.discoveryId) : null;
    if (existing && existing.status === "running") {
      this.holdDiscovery();
      return existing;
    }
    this.discoveryStart = (async () => {
      const record = await this.start({ chatId: `discovery-${crypto.randomUUID()}`, cwd });
      record.ephemeral = true;
      this.discoveryId = record.id;
      this.holdDiscovery();
      return record;
    })();
    try { return await this.discoveryStart; }
    finally { this.discoveryStart = null; }
  }

  holdDiscovery() {
    clearTimeout(this.discoveryTimer);
    this.discoveryTimer = setTimeout(() => void this.retireDiscovery(), this.discoveryIdleMs);
    this.discoveryTimer.unref?.();
  }

  async retireDiscovery() {
    clearTimeout(this.discoveryTimer);
    const id = this.discoveryId;
    this.discoveryId = null;
    if (id) await this.close(id);
  }
  getModelState(id) { const record = this.get(id); return Promise.resolve({
    model: record?.model || "", thinkingLevel: record?.thinkingLevel || "",
  }); }
  attach(id, socket) { return this.sessions.attach(id, socket); }
  setFrameInterval(id, socket, ms) { return this.sessions.setFrameInterval(socket, ms); }
  view(record) {
    return { ...this.sessions.view(record), hostUiRequests: hostsOf(record) };
  }
  runtimeState(record) { return this.sessions.runtimeState(record); }
  publish(record, event) {
    const result = this.sessions.publish(record, event);
    if (event?.type === "status" || event?.type === "error" || event?.type === "runtime_state") {
      this.emit("changed", { record, reason: event.type });
    }
    return result;
  }
  refreshContext(id) { return Promise.resolve(this.get(id)?.contextUsage || null); }
  get(id) { return this.sessions.get(id); }
  getByChatId(chatId) { return this.sessions.getByChatId(chatId); }
  rawRecords() { return this.sessions.rawRecords(); }
  track(id, chatId) { return this.sessions.reassign(id, chatId); }
  list() { return this.sessions.list(); }
  stop(id) { void this.close(id); return Boolean(this.get(id)); }
  fail(record, cause) { for (const pending of record.pending.values()) { clearTimeout(pending.timer); pending.reject(error(cause.message)); } record.pending.clear(); }
  exit(record, code) {
    if (record.status === "stopped") return;
    record.status = "stopped";
    if (record.active || record.turnStarting) {
      this.notification(record, "turn/completed", { turn: { id: record.generation?.id || null,
        status: "failed", error: { message: `Codex app-server exited with ${code}` } } });
    } else if (code) this.publish(record, { type: "error", generationId: record.generation?.id || null,
      error: { code: "backend_unavailable", message: `Codex app-server exited with ${code}` } });
    record.active = false;
    this.sessions.remove(record.id);
    this.emit("removed", { id: record.id, chatId: record.chatId });
  }
}
