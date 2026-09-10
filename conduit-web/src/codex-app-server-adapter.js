import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import os from "node:os";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { SessionRecords } from "./harnesses/session-records.js";
import { unsupported } from "./harnesses/unsupported.js";

export const CODEX_CAPABILITIES = Object.freeze({
  steer: false, followUpQueue: false, cancel: true, compaction: false,
  thinkingLevels: true, modelSwitch: true, toolUse: true, permissions: true,
  // `replay` means resuming a generation in progress, which Codex cannot do:
  // its `replay` returns the current runtime state, not a generation.
  usage: false, replay: false,
});

// Codex asks for approval with a JSON-RPC *request* - it carries an id and
// waits for a reply - so an unanswered one stalls the turn silently. Each entry
// maps one approval method onto Conduit's neutral permission prompt and back
// onto the decision vocabulary that method expects.
const APPROVAL_OPTIONS = Object.freeze(["Approve", "Approve for session", "Deny"]);
const APPROVAL_POLICIES = Object.freeze(["untrusted", "on-request", "never"]);
export const SANDBOX_MODES = Object.freeze(["read-only", "workspace-write", "danger-full-access"]);
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

// A long-running Codex thread holds hundreds of items, and the commands, edits
// and searches outnumber the conversation roughly five to one. Capping raw items
// would therefore drop the start of the conversation to keep recent tool noise,
// so the two are budgeted separately: the messages are the history worth having,
// and tool activity is trimmed to the recent end.
const REPLAY_PAGE_LIMIT = 20;
const REPLAY_MESSAGE_LIMIT = 500;
const REPLAY_TOOL_LIMIT = 200;
const REPLAY_OUTPUT_LIMIT = 1500;
const isMessage = (item) => item?.type === "userMessage" || item?.type === "agentMessage";
const textResult = (output) => typeof output === "string" ? output : JSON.stringify(output ?? "");
const truncate = (output) => {
  if (typeof output !== "string" || output.length <= REPLAY_OUTPUT_LIMIT) return output;
  return `${output.slice(0, REPLAY_OUTPUT_LIMIT)}\n… ${output.length - REPLAY_OUTPUT_LIMIT} more characters`;
};

export class CodexAppServerAdapter extends EventEmitter {
  constructor({ command = "codex", requestTimeoutMs = 15_000, discoveryIdleMs = 60_000 } = {}) {
    super();
    this.command = command;
    this.requestTimeoutMs = requestTimeoutMs;
    this.discoveryIdleMs = discoveryIdleMs;
    this.discoveryId = null;
    this.discoveryStart = null;
    this.discoveryTimer = null;
    this.sessions = new SessionRecords({
      capabilities: CODEX_CAPABILITIES,
      backend: { protocol: "native_api", implementation: "codex", installationId: "host-codex" },
    });
    // `start` indexes records directly; these are the store's own maps.
    this.records = this.sessions.records;
    this.byChatId = this.sessions.byChatId;
    Object.assign(this, unsupported(CODEX_CAPABILITIES, { label: "Codex" }));
  }

  async create({ chatId, project, model = "", thinkingLevel = "", approvalPolicy = "", sandbox = null }) {
    const record = await this.start({ chatId, cwd: project.workingRoot });
    const result = await this.request(record, "thread/start", {
      cwd: project.workingRoot,
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { effort: thinkingLevel } : {}),
      ...CodexAppServerAdapter.policy(approvalPolicy, sandbox),
    });
    record.sessionId = result.thread.id;
    record.model = result.model || model;
    record.thinkingLevel = result.thread?.reasoningEffort || thinkingLevel;
    return record;
  }

  async restore(opaqueSession, { chatId, project, model = "", thinkingLevel = "", approvalPolicy = "", sandbox = null }) {
    const record = await this.start({ chatId, cwd: project.workingRoot });
    const threadId = typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId;
    if (!threadId) throw error("Codex thread identity is missing");
    const result = await this.request(record, "thread/resume", {
      threadId, cwd: project.workingRoot,
      ...(model ? { model } : {}),
      ...(thinkingLevel ? { effort: thinkingLevel } : {}),
      ...CodexAppServerAdapter.policy(approvalPolicy, sandbox),
    });
    record.sessionId = result.thread?.id || threadId;
    record.model = model || result.model || result.thread?.model || "";
    record.thinkingLevel = thinkingLevel || result.thread?.reasoningEffort || "";
    record.history = await this.history(record, record.sessionId);
    return record;
  }

  /**
   * `thread/read` reports `historyMode: "paginated"` and an empty `turns` array
   * for every stored thread - the history lives behind `thread/items/list`, one
   * page of items at a time. This walks those pages so a resumed thread arrives
   * with the work in it, not just whatever the summary happened to carry.
   */
  async items(record, threadId) {
    const rows = [];
    let cursor = null;
    for (let page = 0; page < REPLAY_PAGE_LIMIT; page += 1) {
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

  /** The thread's stored history, trimmed to what the transcript will show. */
  async history(record, threadId) {
    try { return CodexAppServerAdapter.recent(await this.items(record, threadId)); }
    catch { return []; }
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
    let turnStart = 0;
    let interim = null;
    const closeTurn = () => {
      // Older threads carry no `phase`, so nothing would read as the answer.
      // The turn's last message without commands is the closest thing to one.
      const turn = messages.slice(turnStart);
      if (!turn.some((message) => message.role === "assistant" && message.stopReason === "stop")) {
        const answer = turn.findLast((message) => message.role === "assistant"
          && !message.blocks.some((block) => block.type === "toolCall"));
        if (answer) answer.stopReason = "stop";
      }
      turnStart = messages.length;
      interim = null;
    };
    for (const row of rows || []) {
      const item = row.item || {};
      if (row.turnId !== turnId) { closeTurn(); turnId = row.turnId; }
      if (item.type === "userMessage") {
        closeTurn();
        messages.push({ id: item.id, role: "user", content: CodexAppServerAdapter.itemText(item) });
        turnStart = messages.length;
        continue;
      }
      if (item.type === "agentMessage") {
        const text = CodexAppServerAdapter.itemText(item);
        const answer = item.phase === "final_answer";
        messages.push({ id: item.id || `assistant-${turnId}`, role: "assistant", content: text,
          blocks: [{ type: "text", text }], stopReason: answer ? "stop" : "toolUse" });
        interim = answer ? null : messages.at(-1);
        continue;
      }
      const activity = CodexAppServerAdapter.toolActivity(item);
      if (!activity) continue;
      if (!interim) {
        messages.push({ id: `assistant-${item.id}`, role: "assistant", content: "", blocks: [], stopReason: "toolUse" });
        interim = messages.at(-1);
      }
      interim.blocks.push({ type: "toolCall", id: item.id, name: activity.name, arguments: activity.input });
      tools.push({ id: item.id, name: activity.name, args: activity.input, done: true,
        result: textResult(truncate(activity.output)), isError: activity.isError });
    }
    closeTurn();
    return { messages, tools };
  }

  /** The transcript for a chat this adapter is running, for `/v0/sessions/:id`. */
  transcript(chatId) {
    const record = this.getByChatId(chatId);
    return record ? CodexAppServerAdapter.threadTranscript(record.history).messages : [];
  }

  /** The same history for an ephemeral thread, which has no chat to look up. */
  liveTranscript(id) {
    return CodexAppServerAdapter.threadTranscript(this.records.get(id)?.history);
  }

  /**
   * Codex user messages carry an array of content parts, agent messages a flat
   * string. Flattening here keeps both out of the transcript as "[object
   * Object]".
   */
  static itemText(item) {
    if (typeof item?.text === "string") return item.text;
    if (typeof item?.content === "string") return item.content;
    if (Array.isArray(item?.content)) {
      return item.content.map((part) => typeof part === "string" ? part : part?.text || "").join("");
    }
    return "";
  }

  async start({ chatId, cwd }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    const record = {
      id: crypto.randomUUID(), chatId, cwd, status: "starting", activity: "starting", adapterImplementation: "codex",
      active: false, stopping: false, sessionId: null, model: "", thinkingLevel: "", generation: null,
      clients: new Set(), events: [], pending: new Map(), approvals: new Map(),
      sequence: 0, eventSequence: 0, messageIds: new Set(),
    };
    const child = spawn(this.command, ["app-server", "--stdio"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    record.child = child;
    this.records.set(record.id, record);
    this.byChatId.set(chatId, record.id);
    readline.createInterface({ input: child.stdout }).on("line", (line) => this.receive(record, line));
    child.stderr.on("data", (data) => this.emit("diagnostic", { chatId, message: String(data) }));
    child.once("error", (cause) => this.fail(record, cause));
    child.once("exit", (code) => this.exit(record, code));
    await this.request(record, "initialize", { clientInfo: { name: "conduit", title: "Conduit", version: "0.2.0" } });
    this.write(record, { method: "initialized" });
    record.status = "running";
    record.activity = "idle";
    return record;
  }

  request(record, method, params) {
    const id = ++record.sequence;
    this.write(record, { id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        record.pending.delete(id);
        reject(error(`Codex app-server timed out during ${method}`, "rpc_timeout", 504));
      }, this.requestTimeoutMs);
      timer.unref?.();
      record.pending.set(id, { resolve, reject, timer });
    });
  }

  write(record, message) {
    if (!record.child?.stdin?.writable) throw error("Codex app-server is unavailable");
    record.child.stdin.write(`${JSON.stringify(message)}\n`);
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
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "start",
        sequence: ++record.eventSequence, messageId });
      record.turn = { id: turnId, messageId, blocks: [] };
    }
    record.turn.blocks.push({ kind: "tool_call", contentIndex: record.turn.blocks.length,
      id: toolCallId, toolCallId, name: activity.name, arguments: activity.input });
    this.publish(record, { type: "assistant_content", generationId: turnId, phase: "final",
      sequence: ++record.eventSequence, messageId: record.turn.messageId, stopReason: "toolUse",
      errorMessage: null, blocks: record.turn.blocks });
  }

  notification(record, method, params) {
    const turnId = params.turn?.id || params.turnId || record.generation?.id || null;
    if (method === "turn/started") {
      record.active = true;
      record.activity = "working";
      record.generation = { id: turnId, closed: false, settled: false };
      record.turn = null;
      this.publish(record, { type: "status", generationId: turnId, sequence: ++record.eventSequence, status: "working", activity: "working", detail: null });
    } else if (method === "item/agentMessage/delta") {
      const messageId = params.itemId || `assistant-${turnId}`;
      if (!record.messageIds.has(messageId)) {
        record.messageIds.add(messageId);
        this.publish(record, { type: "assistant_content", generationId: turnId, phase: "start",
          sequence: ++record.eventSequence, messageId });
      }
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "delta", sequence: ++record.eventSequence,
        messageId, contentIndex: 0, blockKind: "text", delta: params.delta || "" });
    } else if (method === "item/completed" && params.item?.type === "agentMessage") {
      const messageId = params.item.id || `assistant-${turnId}`;
      if (!record.messageIds.has(params.item.id)) this.publish(record, { type: "assistant_content", generationId: turnId,
        phase: "start", sequence: ++record.eventSequence, messageId });
      record.turn = { id: turnId, messageId, blocks: [{ kind: "text", contentIndex: 0, text: params.item.text || "" }] };
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "final", sequence: ++record.eventSequence,
        messageId, stopReason: "stop", errorMessage: null, blocks: record.turn.blocks });
    } else if (method === "item/started" || method === "item/completed") {
      const activity = CodexAppServerAdapter.toolActivity(params.item || {});
      if (!activity) return;
      if (method === "item/started") {
        this.publish(record, { type: "tool_activity", generationId: turnId, phase: "start", sequence: ++record.eventSequence,
          toolCallId: params.item.id, name: activity.name, input: activity.input });
        this.attachToolCall(record, turnId, params.item.id, activity);
      } else {
        this.publish(record, { type: "tool_activity", generationId: turnId, phase: "end", sequence: ++record.eventSequence,
          toolCallId: params.item.id, name: activity.name, output: truncate(activity.output), isError: activity.isError });
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
      record.active = false;
      record.stopping = false;
      record.activity = failed ? "failed" : "idle";
      if (record.generation) Object.assign(record.generation, { closed: true, settled: true });
      for (const [requestId, pending] of record.approvals) this.settleApproval(record, requestId, pending.generationId);
      this.publish(record, failed
        ? { type: "error", generationId: turnId, error: { code: "backend_unavailable", message: params.turn?.error?.message || "Codex turn failed" } }
        : { type: "status", generationId: turnId, sequence: ++record.eventSequence, status: "idle", activity: "idle", detail: "settled" });
      this.emit("settled", { record });
    }
  }

  /**
   * Codex takes images natively as `localImage` input items, so attached images
   * are sent as files rather than only as paths inside the envelope text. It has
   * no generic file variant, so anything else stays a path the model can read.
   */
  /**
   * Approval and sandbox policy for a thread. Omitted keys let Codex fall back
   * to the user's own `~/.codex/config.toml`, so Conduit only overrides what it
   * was actually asked to.
   *
   * `approvalPolicy` is untrusted | on-request | never; `sandbox` is
   * read-only | workspace-write | danger-full-access, or an object carrying
   * networkAccess and writableRoots.
   */
  static policy(approvalPolicy = "", sandbox = null) {
    return {
      ...(APPROVAL_POLICIES.includes(approvalPolicy) ? { approvalPolicy } : {}),
      ...(sandbox ? { sandbox: typeof sandbox === "string" ? { type: sandbox } : sandbox } : {}),
    };
  }

  static inputItems(message, attachments) {
    const images = (attachments || []).filter((item) => String(item?.type || "").startsWith("image/") && item.path);
    return [...images.map((item) => ({ type: "localImage", path: item.path })), { type: "text", text: message }];
  }

  async prompt(id, message, options) {
    const record = this.get(id);
    if (!record?.sessionId) throw error("Codex thread is not ready");
    const result = await this.request(record, "turn/start", {
      threadId: record.sessionId,
      input: CodexAppServerAdapter.inputItems(message, options?.attachments),
      ...(record.model ? { model: record.model } : {}),
      ...(record.thinkingLevel ? { effort: record.thinkingLevel } : {}),
    });
    this.publish(record, { type: "transcript_message", generationId: result.turn?.id || null,
      message: { id: crypto.randomUUID(), role: "user", content: message } });
    return result.turn?.id || record.generation?.id || null;
  }

  async cancel(id) {
    const record = this.get(id);
    if (!record?.generation?.id) return false;
    record.stopping = true;
    record.activity = "stopping";
    await this.request(record, "turn/interrupt", { threadId: record.sessionId, turnId: record.generation.id });
    return true;
  }

  async close(id) {
    const record = this.get(id);
    if (!record) return false;
    record.status = "stopped";
    record.child.kill("SIGTERM");
    if (record.ephemeral) {
      this.records.delete(record.id);
      this.byChatId.delete(record.chatId);
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
  waitForSession() { return Promise.resolve(); }
  replay(id) { return this.runtimeState(this.get(id)); }
  getCapabilities() { return CODEX_CAPABILITIES; }
  toClientEvent(event) { return event; }
  async listModels(id) {
    const record = id ? this.get(id) : [...this.records.values()][0];
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
  async discovery() {
    if (this.discoveryStart) return this.discoveryStart;
    const existing = this.discoveryId ? this.get(this.discoveryId) : null;
    if (existing && existing.status === "running") {
      this.holdDiscovery();
      return existing;
    }
    this.discoveryStart = (async () => {
      const record = await this.start({ chatId: `discovery-${crypto.randomUUID()}`, cwd: os.homedir() });
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
  publish(record, event) { return this.sessions.publish(record, event); }
  get(id) { return this.sessions.get(id); }
  getByChatId(chatId) { return this.sessions.getByChatId(chatId); }
  list() { return this.sessions.list(); }
  stop(id) { void this.close(id); return Boolean(this.get(id)); }
  fail(record, cause) { for (const pending of record.pending.values()) { clearTimeout(pending.timer); pending.reject(error(cause.message)); } record.pending.clear(); }
  exit(record, code) { if (record.status !== "stopped" && code) this.publish(record, { type: "error", generationId: record.generation?.id || null,
    error: { code: "backend_unavailable", message: `Codex app-server exited with ${code}` } }); record.status = "stopped"; record.active = false; }
}
