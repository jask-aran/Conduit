import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import { wasDiscarded } from "./abort-signature.js";
import { parseAttachmentEnvelope } from "./attachment-envelope.js";
import { SessionRecords } from "./harnesses/session-records.js";
import { messageClose, messageDrop, messageOpen, toolClose, toolOpen } from "./harnesses/transcript-ops.js";
import { unsupported } from "./harnesses/unsupported.js";

export const CODEX_CAPABILITIES = Object.freeze({
  history: "linear", fork: true, regenerate: true,
  steer: true, followUpQueue: true, cancel: true, compaction: true,
  // Codex does not persist a partial assistant message at all. Interrupting a
  // turn 300 characters into its answer leaves `thread/read` and
  // `thread/items/list` reporting that turn as `status: "interrupted"` holding
  // the prompt and an empty `reasoning` stub -- the text is gone. Codex does
  // keep the turn's completed items and injects a `<turn_aborted>` user marker
  // after them, so interrupting during tool use carries its work forward; it is
  // only the answer being written at that moment that is lost.
  thinkingLevels: true, modelSwitch: true, toolUse: true,
  approvals: true, permissionModes: true,
  // `replay` means resuming a generation in progress, which Codex cannot do:
  // its `replay` returns the current runtime state, not a generation.
  usage: false, replay: false,
  attachments: true,
  interruptKeepsPartial: false,
});

// Codex asks for approval with a JSON-RPC *request* - it carries an id and
// waits for a reply - so an unanswered one stalls the turn silently. Each entry
// maps one approval method onto Conduit's neutral permission prompt and back
// onto the decision vocabulary that method expects.
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
  // The pre-v2 spellings. An older app-server sends these for the same two
  // decisions under a different vocabulary.
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

const error = (message, code = "backend_unavailable", status = 409) => Object.assign(new Error(message), { code, status });
const waitForClose = (socket, timeoutMs = 2_000) => {
  if (!socket || socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    socket.once("close", () => { clearTimeout(timer); resolve(); });
  });
};

// A long-running Codex thread holds hundreds of items, and the commands, edits
// and searches outnumber the conversation roughly five to one. Capping raw items
// would therefore drop the start of the conversation to keep recent tool noise,
// so the two are budgeted separately: the messages are the history worth having,
// and tool activity is trimmed to the recent end.
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

export class CodexAppServerAdapter extends EventEmitter {
  constructor({ command = "codex", socketPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    "app-server-control", "app-server-control.sock"), requestTimeoutMs = 15_000, discoveryIdleMs = 60_000,
    logs = null } = {}) {
    super();
    this.command = command;
    this.socketPath = socketPath;
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

  startDaemon() {
    if (!this.daemonStart) {
      this.daemonStart = new Promise((resolve, reject) => {
        execFile(this.command, ["app-server", "daemon", "start"], (cause, _stdout, stderr) => {
          if (cause) reject(error(stderr.trim() || cause.message));
          else resolve();
        });
      }).finally(() => { this.daemonStart = null; });
    }
    return this.daemonStart;
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
      backend: { ...context.chat.backend, model: selectedModel, opaqueSession: live.sessionId },
      ...(selectedThinkingLevel ? { modelThinkingLevels: {
        ...(context.chat.modelThinkingLevels || {}), [selectedModel]: selectedThinkingLevel,
      } } : {}),
    }, modelRecovery: null };
  }

  async create({ chatId, project, model = "", thinkingLevel = "", permissionMode = "", permissionProfile = "", approvalPolicy = "", approvalsReviewer = "", serviceLevel = "", sandbox = null }) {
    const record = await this.start({ chatId, projectId: project.id, cwd: project.workingRoot });
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
      record.thinkingLevel = result.thread?.reasoningEffort || thinkingLevel;
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
    const record = await this.start({ chatId, projectId: project.id, cwd: project.workingRoot });
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

  /**
   * `thread/read` reports `historyMode: "paginated"` and an empty `turns` array
   * for every stored thread - the history lives behind `thread/items/list`, one
   * page of items at a time. This walks those pages so a resumed thread arrives
   * with the work in it, not just whatever the summary happened to carry.
   */
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

  /**
   * Codex records far more per turn than Conduit renders. Commands, file edits,
   * MCP calls and searches all become the tool activity the live stream already
   * publishes; reasoning items are always empty over this API, and compaction
   * markers have nothing to show.
   */
  static toolActivity(item) {
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
      return { name: "web search", input: item.query || "", output: item.results ?? "", isError: false };
    }
    if (item.type === "imageView") return { name: "view image", input: item.path || "", output: "", isError: false };
    return null;
  }

  /**
   * The rows worth keeping, in order: the most recent messages up to the
   * message budget, and the most recent tool items up to the smaller tool one.
   */
  static recent(rows) {
    let messages = 0;
    let tools = 0;
    const keep = new Set();
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const item = rows[index]?.item;
      if (isMessage(item)) {
        if (messages >= REPLAY_MESSAGE_LIMIT) continue;
        messages += 1;
      } else {
        if (tools >= REPLAY_TOOL_LIMIT || !CodexAppServerAdapter.toolActivity(item)) continue;
        tools += 1;
      }
      keep.add(index);
    }
    return rows.filter((_row, index) => keep.has(index));
  }

  /**
   * The stored history as a settled transcript, in Pi's shape.
   *
   * Conduit builds a turn out of the assistant messages that follow a user
   * message: the ones that ran tools, or that it marks `toolUse`, collapse into
   * the reasoning rollup, and the one after them is the answer. A Codex turn is
   * the same story told differently - commentary, commands, edits, then a final
   * answer - so it maps straight onto that rather than needing a shape of its
   * own. The commands hang off the message that ran them, which is how the
   * rollup finds them.
   */
  static threadTranscript(rows) {
    const messages = [];
    const tools = [];
    let turnId;
    let turnStatus;
    let turnStart = 0;
    let interim = null;
    // Read back, a thread says the same two things the socket said: which
    // prompt an answer answers, and whether a message is the answer or the turn
    // talking as it works. Without them the browser falls back to reading both
    // off the shape of the turn, which is the guessing a stated transcript
    // exists to remove.
    let answering = null;
    const closeTurn = () => {
      // Older threads carry no `phase`, so nothing would read as the answer.
      // The turn's last message without commands is the closest thing to one.
      const turn = messages.slice(turnStart);
      if (turnStatus === "interrupted") {
        const interrupted = turn.findLast((message) => message.role === "assistant");
        if (interrupted) {
          interrupted.stopReason = "aborted";
          // Whatever of an interrupted turn the thread did keep is still not
          // something Codex will send again, so a transcript read back from it
          // says so exactly as the live stream did.
          if (wasDiscarded(interrupted, { keepsPartial: CODEX_CAPABILITIES.interruptKeepsPartial })) {
            interrupted.discarded = true;
          }
        }
      } else if (!turn.some((message) => message.role === "assistant" && message.stopReason === "stop")) {
        const answer = turn.findLast((message) => message.role === "assistant"
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
        const text = itemPartsText(item.summary);
        if (!text) continue;
        messages.push({ id: item.id || `reasoning-${turnId}`, role: "assistant", content: text,
          blocks: [{ kind: "thinking", text }], stopReason: "toolUse", interim: true, answers: answering });
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
      tools.push({ id: item.id, name: activity.name, args: activity.input, done: true,
        result: textResult(truncate(activity.output)), isError: activity.isError });
    }
    closeTurn();
    return { messages, tools };
  }

  async readTranscript({ liveSessionId, chatId, opaqueSession, project, turns: turnLimit }) {
    const live = (liveSessionId ? this.get(liveSessionId) : null) || this.getByChatId(chatId);
    const threadId = live?.sessionId
      || (typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId);
    if (!threadId) return { messages: [], tools: [] };
    const transport = live || await this.discovery(project?.workingRoot);
    const result = await this.request(transport, "thread/read", { threadId, includeTurns: true });
    const allTurns = result?.thread?.turns || [];
    const turns = Number.isSafeInteger(turnLimit) && turnLimit > 0 ? allTurns.slice(-turnLimit) : allTurns;
    const rows = turns.flatMap((turn) => (turn.items || [])
      .map((item) => ({ turnId: turn.id, turnStatus: turn.status, item })));
    const transcriptRows = rows.length || result?.thread?.historyMode !== "paginated"
      ? rows
      : await this.items(transport, threadId,
        Number.isSafeInteger(turnLimit) && turnLimit > 0 ? Math.min(turnLimit, REPLAY_PAGE_LIMIT) : REPLAY_PAGE_LIMIT);
    return CodexAppServerAdapter.threadTranscript(CodexAppServerAdapter.recent(transcriptRows));
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

  /** Codex messages can carry a flat string or an array of content parts. */
  static itemText(item) {
    if (typeof item?.text === "string") return item.text;
    if (typeof item?.content === "string") return item.content;
    if (Array.isArray(item?.content)) {
      return item.content.map((part) => typeof part === "string" ? part : part?.text || "").join("");
    }
    return "";
  }

  async start({ chatId, projectId, cwd }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    const record = {
      id: crypto.randomUUID(), chatId, projectId, cwd, status: "starting", activity: "starting",
      active: false, stopping: false, sessionId: null, model: "", thinkingLevel: "", generation: null,
      clients: new Set(), events: [], pending: new Map(), approvals: new Map(),
      steering: [], followUp: [],
      permissionMode: "", permissionProfile: "", approvalPolicy: "", approvalsReviewer: "", serviceLevel: "",
      sequence: 0, eventSequence: 0, messageIds: new Set(),
      // Not able to answer until the app-server has finished its handshake.
      ready: false,
    };
    this.sessions.add(record);
    // Announce the process the moment it exists, as a native one does, so the
    // chat can show that its agent is coming up instead of showing nothing
    // until it is already there.
    this.emit("changed", { record, reason: "created" });
    try {
      // The daemon socket carries one JSON-RPC message per WebSocket text
      // frame. Rust's websocket endpoint rejects extension negotiation, so do
      // not offer per-message compression.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        record.socket = new WebSocket("ws://localhost/rpc", {
          perMessageDeflate: false,
          createConnection: () => net.connect(this.socketPath),
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
          await this.startDaemon();
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
      record.activity = "idle";
      record.ready = true;
      // The handshake is done: this is the moment the agent is warm, and the
      // one moment anyone can honestly say so.
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
    const id = ++record.sequence;
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
    // A message carrying BOTH an id and a method is a request from the server
    // and needs a reply. Treating it as a notification is what left approval
    // prompts unanswered and stalled the turn.
    if (message.id != null && message.method) return this.serverRequest(record, message);
    if (message.method) this.notification(record, message.method, message.params || {});
  }

  /**
   * Answer a request the app-server made of us. Every path here replies:
   * an approval becomes a permission prompt whose answer is written back, and
   * anything we do not understand is refused immediately rather than ignored,
   * so the turn fails loudly instead of hanging.
   */
  serverRequest(record, message) {
    const descriptor = APPROVALS[message.method];
    if (!descriptor) {
      this.write(record, { id: message.id, error: { code: -32601,
        message: `Conduit does not handle ${message.method}` } });
      return;
    }
    const params = message.params || {};
    const requestId = params.approvalId || params.itemId || params.callId || `approval-${message.id}`;
    const generationId = params.turnId || record.generation?.id || null;
    record.approvals.set(requestId, { requestId: message.id, decisions: descriptor.decisions, generationId });
    record.activity = "waiting_for_user";
    this.publish(record, {
      type: "permission_request", generationId, requestId, kind: "select",
      title: descriptor.title(params), message: descriptor.message(params),
      options: [...APPROVAL_OPTIONS], placeholder: "", prefill: "", timeoutMs: null,
    });
    this.publish(record, { type: "status", generationId, sequence: ++record.eventSequence,
      status: "working", activity: "waiting_for_user", detail: descriptor.title(params) });
  }

  /** Send the user's answer back to Codex and let the turn continue. */
  respondHostUi(id, response) {
    const record = this.get(id);
    if (!record) throw error("Codex session is not running");
    const requestId = response?.id;
    const pending = record.approvals.get(requestId);
    // Resolved already - answered in the Codex TUI, or a duplicate click.
    if (!pending) return null;
    record.approvals.delete(requestId);
    const decision = pending.decisions[approvalChoice(response)];
    this.write(record, { id: pending.requestId, result: { decision } });
    this.settleApproval(record, requestId, pending.generationId);
    return decision;
  }

  settleApproval(record, requestId, generationId) {
    record.approvals.delete(requestId);
    if (!record.approvals.size) record.activity = record.active ? "working" : "idle";
    this.publish(record, { type: "permission_resolved", generationId, requestId });
    this.publish(record, { type: "status", generationId, sequence: ++record.eventSequence,
      status: record.active ? "working" : "idle", activity: record.activity, detail: null });
  }

  /**
   * Whether this record's transcript is stated rather than inferred.
   *
   * It is the log that makes a statement worth anything: without one there is
   * no order to state a position in, and the browser would be told a place it
   * has no way to hold.
   */
  states(record) {
    return Boolean(this.sessions.logFor(record));
  }

  /**
   * Say that a message now exists, and where.
   *
   * Codex names its own items, so these ops carry Codex's names. What Codex
   * does not say is where a name belongs once a turn has been steered, queued
   * into or interrupted -- and that is what the browser was left working out
   * from ids, timestamps and the shape of the turn around a message.
   */
  openMessage(record, id, role, { answers = null, generationId = null, ...fields } = {}) {
    if (!id || !this.states(record)) return null;
    record.openMessages = record.openMessages || new Set();
    if (role === "assistant") record.openMessages.add(id);
    this.publish(record, messageOpen({ id, role, ...fields, generationId, answers }));
    return id;
  }

  /** And that it is finished -- with the reason it stopped, and what it says. */
  closeMessage(record, id, stopReason = null, { blocks = [], interim = false } = {}) {
    if (!id || !this.states(record)) return null;
    record.openMessages?.delete(id);
    this.publish(record, messageClose({
      messageId: id, stopReason,
      // Codex does not persist the answer it was writing when a turn was
      // interrupted: the thread reports that turn holding the prompt and an
      // empty reasoning stub. What the reader watched arrive is kept and
      // marked, which the op does from this one fact about the harness.
      keepsPartial: CODEX_CAPABILITIES.interruptKeepsPartial,
      // Whether this message is the answer or the turn talking as it works.
      // Codex says so itself, in the phase it gives the item; the browser is
      // told, rather than deciding it from what a later message went on to do.
      interim,
      blocks,
    }));
    return id;
  }

  /**
   * A carrier the turn has moved on from is finished with what it holds.
   *
   * Codex reports its commands beside the messages rather than inside them, so
   * a turn's commentary and the commands it ran share one row. When the turn
   * starts writing a different item, that row is done.
   */
  settleCarrier(record, nextMessageId) {
    const previous = record.turn;
    if (!previous || previous.messageId === nextMessageId) return;
    if (!record.openMessages?.has(previous.messageId)) return;
    this.closeMessage(record, previous.messageId, "toolUse", { blocks: previous.blocks || [], interim: true });
  }

  /**
   * Settle the rows a finished turn still holds open.
   *
   * A row is given up only when nothing was ever written into it: an answer
   * named and then cut off before its first token. One that was being written
   * keeps what it had, because an interrupted turn may never report the item
   * at all and dropping it would take away text the reader watched arrive.
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
   * Hang a running command off the turn's assistant message.
   *
   * Conduit decides what belongs in the reasoning rollup from the content
   * blocks: text followed by a tool call is interim work, text with nothing
   * after it is the answer. Codex reports its commands beside the messages
   * rather than inside them, so the adapter puts them where the rollup looks -
   * otherwise every commentary line renders as its own answer and the commands
   * never appear at all.
   */
  attachToolCall(record, turnId, toolCallId, activity) {
    if (!record.turn || record.turn.id !== turnId) {
      const messageId = `tools-${turnId}-${record.eventSequence}`;
      this.settleCarrier(record, messageId);
      this.openMessage(record, messageId, "assistant", { answers: record.answering || null, generationId: turnId });
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "start",
        sequence: ++record.eventSequence, messageId });
      record.turn = { id: turnId, messageId, blocks: [] };
    }
    record.turn.blocks.push({ kind: "tool_call", contentIndex: record.turn.blocks.length,
      id: toolCallId, toolCallId, name: activity.name, input: activity.input });
    this.publish(record, { type: "assistant_content", generationId: turnId, phase: "final",
      sequence: ++record.eventSequence, messageId: record.turn.messageId, stopReason: "toolUse",
      errorMessage: null, blocks: record.turn.blocks });
  }

  /**
   * Make the turn's carrier the message now being streamed, ready to take text.
   *
   * `item/completed` replaces this with what Codex says the message finally
   * held. Until then it is what the reader has seen, which is all an interrupt
   * leaves behind.
   */
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
      record.active = true;
      record.activity = "working";
      record.generation = { id: turnId, closed: false, settled: false };
      record.turn = null;
      this.publish(record, { type: "status", generationId: turnId, sequence: ++record.eventSequence, status: "working", activity: "working", detail: null });
    } else if (method === "item/started" && params.item?.type === "contextCompaction") {
      record.compacting = true;
      record.activity = "compacting";
      this.publish(record, { type: "compaction", generationId: turnId, active: true });
    } else if ((method === "item/completed" && params.item?.type === "contextCompaction") || method === "thread/compacted") {
      record.compacting = false;
      record.activity = record.active ? "working" : "idle";
      this.publish(record, { type: "compaction", generationId: turnId, active: false });
    } else if (method === "item/started" && params.item?.type === "userMessage") {
      const messageId = params.item.clientId || params.item.id;
      if (!messageId || record.messageIds.has(messageId)) return;
      record.messageIds.add(messageId);
      const steeringCount = record.steering.length;
      record.steering = record.steering.filter((item) => item.id !== messageId);
      if (record.steering.length !== steeringCount) this.publishQueue(record);
      // A steered or CLI-typed message reaches the transcript here, and an
      // answer that follows answers it rather than the prompt that opened the
      // turn: that prompt has been answered, and this is what Codex is
      // replying to now.
      record.answering = messageId;
      this.openMessage(record, messageId, "user", {
        content: CodexAppServerAdapter.itemText(params.item), timestamp: new Date().toISOString(),
      });
    } else if (method === "item/agentMessage/delta") {
      const messageId = params.itemId || `assistant-${turnId}`;
      if (!record.messageIds.has(messageId)) {
        record.messageIds.add(messageId);
        this.openMessage(record, messageId, "assistant", { answers: record.answering || null, generationId: turnId });
        this.publish(record, { type: "assistant_content", generationId: turnId, phase: "start",
          sequence: ++record.eventSequence, messageId });
      }
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "delta", sequence: ++record.eventSequence,
        messageId, contentIndex: 0, blockKind: "text", delta: params.delta || "" });
      // Hold what has been streamed so far. An interrupted answer is the one
      // case where Codex never reports the item at all -- the thread keeps the
      // prompt and an empty reasoning stub and nothing else -- so without this
      // the only copy of the text is the deltas, and the row was given up as
      // one that had never been written into. The reader watched it arrive.
      this.streamInto(record, turnId, messageId, "text");
      record.turn.blocks[0].text += params.delta || "";
    } else if (method === "item/reasoning/summaryTextDelta") {
      const messageId = params.itemId || `reasoning-${turnId}`;
      if (!record.messageIds.has(messageId)) {
        record.messageIds.add(messageId);
        this.openMessage(record, messageId, "assistant", { answers: record.answering || null, generationId: turnId });
        this.publish(record, { type: "assistant_content", generationId: turnId, phase: "start",
          sequence: ++record.eventSequence, messageId });
      }
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "delta",
        sequence: ++record.eventSequence, messageId, contentIndex: params.summaryIndex || 0,
        blockKind: "thinking", delta: params.delta || "" });
      this.streamInto(record, turnId, messageId, "thinking");
      record.turn.blocks[0].text += params.delta || "";
    } else if (method === "item/completed" && params.item?.type === "agentMessage") {
      const messageId = params.item.id || `assistant-${turnId}`;
      if (!record.messageIds.has(params.item.id)) {
        record.messageIds.add(messageId);
        this.openMessage(record, messageId, "assistant", { answers: record.answering || null, generationId: turnId });
        this.publish(record, { type: "assistant_content", generationId: turnId,
          phase: "start", sequence: ++record.eventSequence, messageId });
      }
      const text = CodexAppServerAdapter.itemText(params.item);
      const interim = params.item.phase !== "final_answer";
      this.settleCarrier(record, messageId);
      record.turn = { id: turnId, messageId, phase: params.item.phase || null,
        blocks: [{ kind: "text", contentIndex: 0, text }] };
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "final", sequence: ++record.eventSequence,
        messageId, stopReason: interim ? "toolUse" : "stop",
        errorMessage: null, blocks: record.turn.blocks });
    } else if (method === "item/completed" && params.item?.type === "reasoning") {
      const messageId = params.item.id || `reasoning-${turnId}`;
      const text = itemPartsText(params.item.summary);
      if (!record.messageIds.has(messageId)) {
        record.messageIds.add(messageId);
        this.openMessage(record, messageId, "assistant", { answers: record.answering || null, generationId: turnId });
        this.publish(record, { type: "assistant_content", generationId: turnId,
          phase: "start", sequence: ++record.eventSequence, messageId });
      }
      this.settleCarrier(record, messageId);
      record.turn = { id: turnId, messageId, blocks: text
        ? [{ kind: "thinking", contentIndex: 0, text, redacted: false }]
        : [] };
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "final",
        sequence: ++record.eventSequence, messageId, stopReason: "toolUse", errorMessage: null, blocks: record.turn.blocks });
    } else if (method === "item/started" || method === "item/completed") {
      const activity = CodexAppServerAdapter.toolActivity(params.item || {});
      if (!activity) return;
      if (method === "item/started") {
        this.publish(record, { type: "tool_activity", generationId: turnId, phase: "start", sequence: ++record.eventSequence,
          toolCallId: params.item.id, name: activity.name, input: activity.input });
        this.attachToolCall(record, turnId, params.item.id, activity);
        if (this.states(record)) {
          this.publish(record, toolOpen({ toolCallId: params.item.id, name: activity.name,
            input: activity.input, messageId: record.turn?.messageId || null, generationId: turnId }));
        }
      } else {
        this.publish(record, { type: "tool_activity", generationId: turnId, phase: "end", sequence: ++record.eventSequence,
          toolCallId: params.item.id, name: activity.name, output: truncate(activity.output), isError: activity.isError });
        if (this.states(record)) {
          this.publish(record, toolClose({ toolCallId: params.item.id, output: truncate(activity.output),
            isError: activity.isError, generationId: turnId }));
        }
      }
    } else if (method === "serverRequest/resolved") {
      // The prompt was answered somewhere else - the Codex TUI, or another
      // client on the same thread. Clear ours rather than leave it hanging.
      for (const [requestId, pending] of record.approvals) {
        if (params.requestId != null && pending.requestId !== params.requestId) continue;
        this.settleApproval(record, requestId, pending.generationId);
      }
    } else if (method === "turn/completed") {
      const failed = params.turn?.status === "failed";
      // Captured before the flag resets below: a turn the user stopped settles
      // the same way a finished one does, and only one of them is readable.
      const stopped = Boolean(record.stopping);
      record.active = false;
      record.stopping = false;
      record.compacting = false;
      record.activity = failed ? "failed" : "idle";
      if (record.generation) Object.assign(record.generation, { closed: true, settled: true });
      for (const [requestId, pending] of record.approvals) this.settleApproval(record, requestId, pending.generationId);
      // A turn nobody stopped, whose last message Codex never labelled, ends by
      // saying that message was the answer. A turn that was interrupted says no
      // such thing: what it had written is where it got to, not what it meant
      // to say, and calling it the answer would hide that it was cut off.
      // Codex reports an interrupt it was told about elsewhere -- its own TUI,
      // another client -- as the turn's status rather than through our stop.
      const interrupted = stopped || params.turn?.status === "interrupted";
      const promoted = !failed && !interrupted && record.turn?.phase == null && record.turn?.blocks?.some((block) => block.kind === "text")
        && !record.turn.blocks.some((block) => block.kind === "tool_call");
      if (promoted) {
        this.publish(record, { type: "assistant_content", generationId: turnId, phase: "final",
          sequence: ++record.eventSequence, messageId: record.turn.messageId, stopReason: "stop",
          errorMessage: null, blocks: record.turn.blocks });
        this.closeMessage(record, record.turn.messageId, "stop", { blocks: record.turn.blocks, interim: false });
      }
      // Whatever the turn still holds is settled with what it wrote, or given
      // up if it wrote nothing -- so an interrupt leaves no row waiting for a
      // message that is never coming.
      this.dropUnwrittenMessages(record, failed || interrupted ? "aborted" : "stop");
      record.answering = null;
      this.publish(record, failed
        ? { type: "error", generationId: turnId, error: { code: "backend_unavailable", message: params.turn?.error?.message || "Codex turn failed" } }
        : { type: "status", generationId: turnId, sequence: ++record.eventSequence, status: "idle", activity: "idle", detail: "settled" });
      this.emit("settled", { record, completed: !failed && !stopped });
      if (record.followUp.length) void this.flushFollowUp(record);
    }
  }

  /**
   * Take a message sent while a turn is running.
   *
   * Steering hands it to Codex immediately - `turn/steer` delivers as soon as
   * the running tool call settles, rather than after the whole turn. A
   * follow-up waits for the turn to finish, which Codex has no endpoint for, so
   * Conduit holds it and starts the next turn itself.
   */
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
        input: CodexAppServerAdapter.inputItems(userMessage, attachments),
      });
    } catch (cause) {
      record.steering = record.steering.filter((item) => item !== queued);
      this.publishQueue(record);
      throw cause;
    }
    return { queued: "steer", attachmentIdentity: { messageId: queued.id } };
  }

  /** Start the next turn from the messages that waited for this one to finish. */
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

  /** Take back whatever has not been handed to Codex yet. */
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

  /**
   * Approval and sandbox policy for a thread. Omitted keys let Codex fall back
   * to the user's own `~/.codex/config.toml`, so Conduit only overrides what it
   * was actually asked to.
   *
   * `approvalPolicy` is untrusted | on-request | never; `sandbox` is
   * read-only | workspace-write | danger-full-access, or an object carrying
   * networkAccess and writableRoots.
   */
  static policy(approvalPolicy = "", approvalsReviewer = "", sandbox = null) {
    return {
      ...(APPROVAL_POLICIES.includes(approvalPolicy) ? { approvalPolicy } : {}),
      ...(APPROVAL_REVIEWERS.includes(approvalsReviewer) ? { approvalsReviewer } : {}),
      ...(sandbox ? { sandbox: typeof sandbox === "string" ? { type: sandbox } : sandbox } : {}),
    };
  }

  static inputItems(message, attachments) {
    const images = (attachments || []).filter((item) => String(item?.type || "").startsWith("image/") && item.path);
    const files = (attachments || []).filter((item) => !String(item?.type || "").startsWith("image/") && item.path);
    const text = [parseAttachmentEnvelope(message).message,
      ...files.map((item) => `Attached file: ${item.path}`)].filter(Boolean).join("\n\n");
    return [...images.map((item) => ({ type: "localImage", path: item.path })), { type: "text", text }];
  }

  async prompt(id, message, options) {
    const record = this.get(id);
    if (!record?.sessionId) throw error("Codex thread is not ready");
    const clientUserMessageId = options?.clientUserMessageId || crypto.randomUUID();
    // Stated before it is sent, not after Codex echoes it back. The prompt is
    // the thing the next answer answers, so it has to be in the transcript
    // before the answer arrives -- otherwise the answer is placed against
    // whatever came before it, which is the previous turn.
    record.messageIds.add(clientUserMessageId);
    record.answering = clientUserMessageId;
    this.openMessage(record, clientUserMessageId, "user", {
      content: parseAttachmentEnvelope(message).message,
      timestamp: new Date().toISOString(),
    });
    let result;
    try {
      result = await this.request(record, "turn/start", {
        threadId: record.sessionId,
        clientUserMessageId,
        input: CodexAppServerAdapter.inputItems(message, options?.attachments),
        ...(record.model ? { model: record.model } : {}),
        ...(record.thinkingLevel ? { effort: record.thinkingLevel } : {}),
        ...(record.serviceLevel ? { serviceTier: record.serviceLevel } : {}),
        ...(record.permissionProfile ? { permissions: record.permissionProfile } : {}),
        ...CodexAppServerAdapter.policy(record.approvalPolicy, record.approvalsReviewer),
      });
    } catch (cause) {
      // A prompt Codex refused writes nothing, so the row stated for it goes
      // back rather than waiting for a turn that will never start.
      record.messageIds.delete(clientUserMessageId);
      record.answering = null;
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
    const turnId = generationId || record?.generation?.id;
    if (!record?.sessionId || !turnId) return false;
    record.stopping = true;
    record.activity = "stopping";
    try {
      await this.request(record, "turn/interrupt", { threadId: record.sessionId, turnId });
    } catch (cause) {
      record.stopping = false;
      record.activity = record.active ? "working" : "idle";
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
  async shutdown() {
    clearTimeout(this.discoveryTimer);
    this.discoveryId = null; const records = [...this.records.values()].filter((record) => record.status !== "stopped"); await Promise.all(records.map((record) => this.close(record.id))); return records.length; }

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
      opaqueSession: record.sessionId,
      sourceMessage: { id: entryId, text },
    };
  }
  waitForSession() { return Promise.resolve(); }
  replay(id) { return this.runtimeState(this.get(id)); }
  getCapabilities() { return CODEX_CAPABILITIES; }
  toClientEvent(event) { return event; }
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

  /**
   * List threads Codex knows about. Omitting `cwd` lists them machine-wide;
   * passing one uses Codex's own server-side filter. The client-side filter
   * stays as a guard against a future protocol that ignores the parameter.
   */
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

  /**
   * Discovery reads the global thread database, so one app-server serves every
   * lookup. Spawning per request costs seconds, which a dashboard that reloads
   * on focus cannot pay. The process retires once it has been idle.
   */
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
  view(record) { return this.sessions.view(record); }
  runtimeState(record) { return this.sessions.runtimeState(record); }
  publish(record, event) {
    const result = this.sessions.publish(record, event);
    if (event?.type === "status" || event?.type === "error") {
      this.emit("changed", { record, reason: event.type });
    }
    return result;
  }
  get(id) { return this.sessions.get(id); }
  getByChatId(chatId) { return this.sessions.getByChatId(chatId); }
  rawRecords() { return this.sessions.rawRecords(); }
  track(id, chatId) { return this.sessions.reassign(id, chatId); }
  list() { return this.sessions.list(); }
  stop(id) { void this.close(id); return Boolean(this.get(id)); }
  fail(record, cause) { for (const pending of record.pending.values()) { clearTimeout(pending.timer); pending.reject(error(cause.message)); } record.pending.clear(); }
  exit(record, code) {
    if (record.status === "stopped") return;
    if (code) this.publish(record, { type: "error", generationId: record.generation?.id || null,
      error: { code: "backend_unavailable", message: `Codex app-server exited with ${code}` } });
    record.status = "stopped";
    record.active = false;
    this.sessions.remove(record.id);
    this.emit("removed", { id: record.id, chatId: record.chatId });
  }
}
