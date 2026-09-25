import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn, execFile as execFileCallback } from "node:child_process";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { parseAttachmentEnvelope } from "./attachment-envelope.js";
import { SessionRecords } from "./harnesses/session-records.js";
import { messageClose, messageOpen, toolClose, toolKind, toolOpen, toolSubject, turnSettle } from "./harnesses/transcript-ops.js";
import { unsupported } from "./harnesses/unsupported.js";

const execFile = promisify(execFileCallback);

// fx's tools, by what they do, as its saved history names them. Live, ACP
// states a kind of its own beside a name that may be only a title, so that is
// read when the name is not one of these.
const FX_TOOL_KINDS = Object.freeze({
  terminal: "command", shell: "command",
  read_file: "read", grep_files: "read", glob_files: "read", list_files: "read", file_info: "read", read_tool_result: "read",
  edit_file: "edit", write_file: "edit",
  web_search: "search", capability_search: "search",
  web_fetch: "fetch",
});
const ACP_TOOL_KINDS = Object.freeze({
  execute: "command", read: "read", edit: "edit", delete: "edit", move: "edit", search: "search", fetch: "fetch",
});
// What a call acted on: fx's tools share their field names, and a search's
// pattern says more than the directory it searched.
const subjectOf = (input) => input && typeof input === "object"
  ? toolSubject(["command", "pattern", "query", "url", "path"].map((field) => input[field]).find((value) => value != null)) ?? undefined
  : undefined;
const kindOf = (name, acpKind) => Object.hasOwn(FX_TOOL_KINDS, name)
  ? FX_TOOL_KINDS[name] : toolKind(ACP_TOOL_KINDS, acpKind);
// ACP's reasons a turn stopped, in Conduit's. A stopped turn is `cancelled` in
// ACP and `aborted` to everything that draws one.
const FX_STOP_REASONS = Object.freeze({
  end_turn: "stop", refusal: "stop", max_tokens: "length", max_turn_requests: "length",
  cancelled: "aborted", error: "error",
});
const OUTCOMES = Object.freeze({ aborted: "interrupted", error: "failed" });
// A turn waits on fx's saved copy of it to settle, so the read may not hang it.
const SESSION_READ_MS = 15_000;
// A saved result, as Conduit states a tool's ending. fx saves a failure as
// `failure`, and says nothing but the status to tell it from a success.
const resultState = (result) => ({ isError: !["success", "cancelled"].includes(result.status),
  cancelled: result.status === "cancelled" });

export const FX_CAPABILITIES = Object.freeze({
  history: "linear",
  fork: false,
  regenerate: false,
  steer: false,
  followUpQueue: false,
  cancel: true,
  compaction: false,
  thinkingLevels: true,
  modelSwitch: true,
  toolUse: true,
  approvals: true,
  permissionModes: true,
  usage: false,
  replay: false,
  attachments: false,
  interruptKeepsPartial: false,
});

const failure = (message, code = "backend_unavailable", status = 409) =>
  Object.assign(new Error(message), { code, status });

const outputText = (content) => (Array.isArray(content) ? content : [])
  .map((item) => item?.content?.text || item?.text || "").filter(Boolean).join("\n");

// fx saves a turn by its place in the history, with no id. The names Conduit
// streamed it under are kept beside the chat by that place, so the saved copy
// and the chat log name each message once.
// The chat store is loaded on use: it reaches this module through the harness list.
const turnIdsFile = async (project, chatId) => {
  const { chatDirectory } = await import("./chat-store.js");
  try { return path.join(chatDirectory(project, chatId), "fx-turn-ids.json"); } catch { return null; }
};
const readTurnIds = async (file) => {
  try { return file ? JSON.parse(await fs.readFile(file, "utf8")) : {}; } catch { return {}; }
};

class AcpClient {
  constructor(command, cwd, onNotification, onRequest, onExit = () => {}) {
    this.child = spawn(command, ["acp"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
    this.pending = new Map();
    this.nextId = 1;
    this.buffer = "";
    this.stderr = "";
    this.onNotification = onNotification;
    this.onRequest = onRequest;
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.read(chunk));
    this.child.stderr.on("data", (chunk) => { this.stderr = `${this.stderr}${chunk}`.slice(-8_192); });
    this.child.once("error", (cause) => this.fail(cause));
    // A write racing the child's exit fails with EPIPE on stdin; unheard, that
    // error would take the whole server down with it.
    this.child.stdin.on("error", (cause) => this.fail(cause));
    this.child.once("exit", (code, signal) => {
      const cause = failure(this.stderr.trim() || `fx ACP exited (${signal || code})`, "backend_unavailable");
      this.fail(cause);
      onExit(cause);
    });
  }

  read(chunk) {
    this.buffer += chunk;
    for (;;) {
      const newline = this.buffer.indexOf("\n");
      if (newline < 0) return;
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); }
      catch { this.fail(failure("fx ACP returned invalid JSON")); continue; }
      if (message.id != null && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        this.pending.delete(message.id);
        if (message.error) pending.reject(failure(message.error.message || "fx ACP request failed"));
        else pending.resolve(message.result);
      } else if (message.id != null && message.method) {
        this.onRequest(message);
      } else if (message.method) this.onNotification(message);
    }
  }

  write(message) {
    if (!this.child.stdin.writable) throw failure("fx ACP is not running");
    // fx 0.0.10 accepts one JSON-RPC object per CRLF-delimited line.
    this.child.stdin.write(`${JSON.stringify(message)}\r\n`);
  }

  request(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.write({ jsonrpc: "2.0", id, method, params }); }
      catch (cause) { this.pending.delete(id); reject(cause); }
    });
  }

  notify(method, params = {}) { this.write({ jsonrpc: "2.0", method, params }); }
  respond(id, result) { this.write({ jsonrpc: "2.0", id, result }); }

  fail(cause) {
    for (const pending of this.pending.values()) pending.reject(cause);
    this.pending.clear();
  }

  close() {
    if (this.child.exitCode == null && this.child.signalCode == null) this.child.kill("SIGTERM");
  }
}

export class FxAcpAdapter extends EventEmitter {
  constructor({ command = "fx", logs = null } = {}) {
    super();
    this.command = command;
    this.sessions = new SessionRecords({
      capabilities: FX_CAPABILITIES,
      backend: { protocol: "acp", implementation: "fx", installationId: "host-fx" },
      extras: (record) => ({ thinkingLevel: record.thinkingLevel, permissionMode: record.permissionMode }),
      logs,
    });
    this.records = this.sessions.records;
    this.byChatId = this.sessions.byChatId;
    Object.assign(this, unsupported(FX_CAPABILITIES, { label: "fx" }));
  }

  async run(args, options = {}) {
    try {
      const { stdout } = await execFile(this.command, args, {
        cwd: options.cwd, maxBuffer: 32 * 1024 * 1024, encoding: "utf8", timeout: options.timeout || 0,
      });
      return stdout;
    } catch (cause) {
      throw failure(String(cause.stderr || cause.message || cause).trim());
    }
  }

  async json(args, options) {
    const text = await this.run(args, options);
    try { return JSON.parse(text); }
    catch { throw failure("fx returned invalid JSON"); }
  }

  async launch(context, { model = "", thinkingLevel = "", forceModel = false } = {}) {
    const selectedModel = (forceModel ? String(model).trim() : "") || String(context.chat.backend.model || "").trim();
    const selectedThinkingLevel = (forceModel ? String(thinkingLevel).trim() : "")
      || String(context.chat.modelThinkingLevels?.[selectedModel] || "").trim();
    const options = {
      chatId: context.chat.id, project: context.project, model: selectedModel,
      thinkingLevel: selectedThinkingLevel,
      permissionMode: String(context.chat.backend.permissionMode || "").trim(),
    };
    const live = context.chat.backend.opaqueSession
      ? await this.restore(context.chat.backend.opaqueSession, options) : await this.create(options);
    return { live, mapping: {
      backend: { ...context.chat.backend, model: live.model || selectedModel, opaqueSession: live.sessionId },
      ...(live.thinkingLevel ? { modelThinkingLevels: {
        ...(context.chat.modelThinkingLevels || {}), [live.model || selectedModel]: live.thinkingLevel,
      } } : {}),
    }, modelRecovery: null };
  }

  async start({ chatId, project }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    const record = this.sessions.add({
      id: crypto.randomUUID(), chatId, projectId: project?.id || null,
      cwd: project?.workingRoot, sessionId: null, status: "starting", ready: false,
      activity: "starting", active: false, stopping: false, model: "", thinkingLevel: "",
      permissionMode: "", generation: null, generationSeq: 0, clients: new Set(), events: [],
      hostUiRequests: [], requests: new Map(), steps: [], tools: new Map(), loading: true,
    });
    record.client = new AcpClient(this.command, record.cwd,
      (message) => this.notification(record, message),
      (message) => this.requestFromAgent(record, message),
      (cause) => this.processExited(record, cause));
    record.turnIdsFile = await turnIdsFile(project, chatId);
    try {
      await record.client.request("initialize", {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "Conduit", version: "0.2.0" },
      });
      return record;
    } catch (cause) {
      await this.close(record.id);
      throw cause;
    }
  }

  applyConfig(record, result = {}) {
    record.configOptions = result.configOptions || [];
    record.modes = result.modes || null;
    const value = (id) => record.configOptions.find((item) => item.id === id)?.currentValue || "";
    record.model = value("model") || record.model;
    record.thinkingLevel = value("effort") || record.thinkingLevel;
    record.permissionMode = result.modes?.currentModeId || value("mode") || record.permissionMode;
    record.loading = false;
    record.ready = true;
    record.status = "running";
    record.activity = "idle";
    this.emit("changed", { record, reason: "ready" });
  }

  async configure(record, { model = "", thinkingLevel = "", permissionMode = "" } = {}) {
    for (const [configId, value] of [["model", model], ["effort", thinkingLevel]]) {
      if (!value) continue;
      await record.client.request("session/set_config_option", { sessionId: record.sessionId, configId, value });
      if (configId === "model") record.model = value;
      else record.thinkingLevel = value;
    }
    if (permissionMode) {
      await record.client.request("session/set_mode", { sessionId: record.sessionId, modeId: permissionMode });
      record.permissionMode = permissionMode;
    }
  }

  async create(options) {
    const record = await this.start(options);
    try {
      const result = await record.client.request("session/new", { cwd: record.cwd, mcpServers: [] });
      record.sessionId = result.sessionId;
      this.applyConfig(record, result);
      await this.configure(record, options);
      return record;
    } catch (cause) { await this.close(record.id); throw cause; }
  }

  async restore(opaqueSession, options) {
    const record = await this.start(options);
    const sessionId = typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId;
    if (!sessionId) { await this.close(record.id); throw failure("fx session identity is missing"); }
    record.sessionId = sessionId;
    try {
      const result = await record.client.request("session/load", { sessionId, cwd: record.cwd, mcpServers: [] });
      this.applyConfig(record, result);
      await this.configure(record, options);
      return record;
    } catch (cause) { await this.close(record.id); throw cause; }
  }

  /**
   * A step of the turn: what fx thought and said, then the tools it ran, until
   * it next thinks or speaks. Each is a message of its own, in the order it
   * happened, so the trace reads the way the turn went -- the shape fx saves
   * too, where each tool step keeps the words that came before it. The last
   * one, if it ran nothing, is the answer.
   */
  openStep(record) {
    // A step the turn has moved on from was work towards the answer, not it.
    const previous = record.steps.at(-1);
    if (previous) this.publish(record, { type: "assistant_content", phase: "final", generationId: record.generation?.id || null,
      seq: ++record.generationSeq, messageId: previous.id, stopReason: "toolUse", errorMessage: null, blocks: previous.blocks });
    const step = { id: crypto.randomUUID(), fxMessageId: undefined, blocks: [] };
    record.steps.push(step);
    this.publish(record, messageOpen({ id: step.id, role: "assistant", generationId: record.generation?.id || null,
      answers: record.answering || null, timestamp: new Date().toISOString() }));
    this.publish(record, { type: "assistant_content", phase: "start", generationId: record.generation?.id || null,
      seq: ++record.generationSeq, messageId: step.id });
    return step;
  }

  appendStepText(record, step, kind, delta) {
    let block = step.blocks.find((item) => item.kind === kind);
    if (!block) step.blocks.push(block = { kind, contentIndex: step.blocks.length, text: "" });
    block.text += delta;
    this.publish(record, { type: "assistant_content", phase: "delta", generationId: record.generation?.id || null,
      seq: ++record.generationSeq, messageId: step.id, contentIndex: block.contentIndex, blockKind: kind, delta });
  }

  /** Every step the turn took, finished: the answer as the answer, the rest as the work before it. */
  closeSteps(record, stopReason, answer, errorMessage = null) {
    const last = record.steps.at(-1);
    for (const step of record.steps) {
      const ending = step === answer || step === last;
      const reason = ending ? stopReason : "toolUse";
      const blocks = step.blocks;
      this.publish(record, { type: "assistant_content", phase: "final", generationId: record.generation.id,
        seq: ++record.generationSeq, messageId: step.id, stopReason: reason, errorMessage: ending ? errorMessage : null, blocks });
      this.publish(record, messageClose({ messageId: step.id, stopReason: reason, blocks, interim: step !== answer,
        generationId: record.generation.id, keepsPartial: FX_CAPABILITIES.interruptKeepsPartial,
        ...(step === answer ? { model: record.model || null } : {}), errorMessage: ending ? errorMessage : null }));
    }
  }

  notification(record, message) {
    if (message.method !== "session/update" || message.params?.sessionId !== record.sessionId) return;
    const update = message.params.update || {};
    if (update.sessionUpdate === "session_info_update") {
      if (update.title) this.emit("changed", { record, reason: "named", name: update.title });
      return;
    }
    if (record.loading || update.sessionUpdate === "user_message_chunk") return;
    const generationId = record.generation?.id || null;
    const current = record.steps.at(-1);
    if (update.sessionUpdate === "agent_thought_chunk") {
      const delta = outputText([update.content]);
      if (!delta) return;
      // Thinking starts a step, unless the one open has only thought so far.
      const step = current && current.blocks.every((block) => block.kind === "thinking") ? current : this.openStep(record);
      this.appendStepText(record, step, "thinking", delta);
      return;
    }
    if (update.sessionUpdate === "agent_message_chunk") {
      const delta = outputText([update.content]);
      if (!delta) return;
      // So does speaking, unless the open step has said and run nothing yet,
      // or this is the message it is already saying.
      const spoken = current?.blocks.some((block) => block.kind === "text");
      const ran = current?.blocks.some((block) => block.kind === "tool_call");
      const step = current && !ran && (!spoken || current.fxMessageId === update.messageId) ? current : this.openStep(record);
      step.fxMessageId = update.messageId;
      this.appendStepText(record, step, "text", delta);
      return;
    }
    if (update.sessionUpdate === "tool_call") {
      const step = current || this.openStep(record);
      const tool = { id: update.toolCallId, name: update.name || update.title || "tool",
        input: update.rawInput ?? null, output: "", closed: false, stepId: step.id, startedAt: new Date().toISOString() };
      tool.kind = kindOf(tool.name, update.kind);
      tool.subject = subjectOf(tool.input);
      record.tools.set(tool.id, tool);
      step.blocks.push({ kind: "tool_call", contentIndex: step.blocks.length, toolCallId: tool.id, name: tool.name, input: tool.input });
      this.publish(record, toolOpen({ toolCallId: tool.id, name: tool.name, kind: tool.kind, subject: tool.subject, input: tool.input,
        messageId: step.id, generationId, timestamp: tool.startedAt }));
      this.publish(record, { type: "tool_activity", phase: "start", generationId,
        seq: ++record.generationSeq, toolCallId: tool.id, name: tool.name, kind: tool.kind, subject: tool.subject, input: tool.input });
      // The turn being painted places a running tool by its block, so the
      // step says it is calling one now, not when the turn ends.
      this.publish(record, { type: "assistant_content", phase: "final", generationId, seq: ++record.generationSeq,
        messageId: step.id, stopReason: "toolUse", errorMessage: null, blocks: step.blocks });
      return;
    }
    if (update.sessionUpdate === "tool_call_update") {
      const tool = record.tools.get(update.toolCallId);
      if (!tool) return;
      tool.output = outputText(update.content);
      const done = ["completed", "failed"].includes(update.status);
      this.publish(record, { type: "tool_activity", phase: done ? "end" : "update", generationId,
        seq: ++record.generationSeq, toolCallId: tool.id, name: tool.name, input: tool.input,
        output: tool.output, isError: update.status === "failed" });
      if (done && !tool.closed) {
        tool.closed = true;
        tool.completedAt = new Date().toISOString();
        this.publish(record, toolClose({ toolCallId: tool.id, output: tool.output,
          isError: update.status === "failed", completedAt: tool.completedAt, generationId }));
      }
    }
  }

  requestFromAgent(record, message) {
    if (message.method !== "session/request_permission") {
      record.client.respond(message.id, {});
      return;
    }
    const params = message.params || {};
    const requestId = String(message.id);
    record.requests.set(requestId, message.id);
    const options = (params.options || []).map((item) => ({ id: item.optionId, label: item.name || item.optionId }));
    const request = { id: requestId, kind: "select", title: params.toolCall?.title || "fx permission",
      message: params.toolCall?.title || "Allow this tool call?", options, placeholder: "", prefill: "", timeoutMs: null };
    record.hostUiRequests.push(request);
    record.activity = "waiting_for_user";
    this.publish(record, { type: "permission_request", generationId: record.generation?.id || null,
      requestId, ...request });
  }

  async prompt(id, message, options = {}) {
    const record = this.get(id);
    if (!record?.sessionId || !record.ready) throw failure("fx session is not ready");
    if (record.active) throw failure("fx session is busy", "generation_limit", 409);
    const generationId = crypto.randomUUID();
    const userMessageId = options.clientUserMessageId || crypto.randomUUID();
    record.active = true;
    record.activity = "working";
    record.stopping = false;
    record.generation = { id: generationId, closed: false, settled: false };
    record.answering = userMessageId;
    record.promptText = parseAttachmentEnvelope(message).message;
    record.steps = [];
    record.tools.clear();
    // How long the saved history was before this turn, so a stopped turn can
    // tell whether fx saved it.
    record.historyBefore = this.json(["session", "--id", record.sessionId, "--json"], { timeout: SESSION_READ_MS })
      .then((data) => data.history?.length ?? null, () => null);
    this.publish(record, messageOpen({ id: userMessageId, role: "user", generationId,
      content: record.promptText, timestamp: new Date().toISOString() }));
    this.publish(record, { type: "status", generationId, phase: "started", seq: ++record.generationSeq,
      status: "working", activity: "working", detail: null });
    const request = record.client.request("session/prompt", {
      sessionId: record.sessionId,
      prompt: [{ type: "text", text: record.promptText }],
    });
    void request.then((result) => this.finish(record, result?.stopReason || "stop"), (cause) => this.failPrompt(record, cause));
    return { generationId, attachmentIdentity: { messageId: userMessageId } };
  }

  async finish(record, acpStopReason) {
    if (!record.active) return;
    let stopReason = FX_STOP_REASONS[acpStopReason] || "stop";
    const stopped = stopReason === "aborted" || stopReason === "error";
    let error = null;
    let saved = null;
    try {
      const data = await this.json(["session", "--id", record.sessionId, "--json"], { timeout: SESSION_READ_MS });
      if (!record.active) return;
      const history = data.history || [];
      const before = await record.historyBefore;
      // The latest saved turn is the reply; fx may store the prompt text
      // differently. A turn that stopped is this prompt's only if fx added it.
      if (!stopped || (Number.isInteger(before) && history.length > before)) {
        saved = { turn: history.at(-1), index: history.length - 1 };
      }
      if (!stopped && typeof saved?.turn?.assistant !== "string") throw failure("fx completed without a saved reply");
    } catch (cause) {
      if (!stopped) {
        error = cause;
        stopReason = "error";
        this.publish(record, { type: "error", generationId: record.generation?.id || null, scope: "runtime",
          error: { code: "backend_unavailable", message: cause.message || String(cause) } });
      }
    }
    // The answer is the last step if it ran nothing -- fx streamed it as it
    // wrote it -- in the words fx saved. A turn that ran a tool last and still
    // answered gets a step for the answer.
    const last = record.steps.at(-1);
    const ranNothing = Boolean(last) && !last.blocks.some((block) => block.kind === "tool_call");
    const spoke = ranNothing && last.blocks.some((block) => block.kind === "text" && block.text.trim());
    let answer = null;
    if (typeof saved?.turn?.assistant === "string" && !stopped && !error) {
      answer = ranNothing ? last : this.openStep(record);
      const text = answer.blocks.find((block) => block.kind === "text");
      if (text) text.text = saved.turn.assistant;
      else answer.blocks.push({ kind: "text", contentIndex: answer.blocks.length, text: saved.turn.assistant });
    } else if (spoke) answer = last;
    // An ended turn answers nothing more: its prompts end with it.
    this.cancelRequests(record);
    // What each tool returned, as fx saved it: ACP streams a preview, and a
    // failure is told from a success only in the saved record.
    const results = new Map((saved?.turn?.execution?.tool_steps || [])
      .flatMap((step) => step.tool_results || []).map((result) => [result.tool_call_id, result]));
    for (const tool of record.tools.values()) {
      const result = results.get(tool.id);
      if (result) {
        tool.closed = true;
        this.publish(record, toolClose({ toolCallId: tool.id, output: result.output ?? result.preview ?? tool.output,
          ...resultState(result), completedAt: tool.completedAt,
          generationId: record.generation.id }));
      } else if (!tool.closed) {
        // And the ones still running end with the turn.
        tool.closed = true;
        this.publish(record, toolClose({ toolCallId: tool.id, output: tool.output,
          isError: stopReason !== "aborted", cancelled: stopReason === "aborted", generationId: record.generation.id }));
      }
    }
    this.closeSteps(record, stopReason, answer, error?.message || null);
    const outcome = OUTCOMES[stopReason] || "complete";
    if (saved) await this.recordTurnIds(record, saved.index, answer, outcome);
    if (record.answering) {
      this.publish(record, turnSettle({ promptId: record.answering, generationId: record.generation.id, outcome }));
    }
    record.active = false;
    record.stopping = false;
    record.activity = stopReason === "error" ? "failed" : "idle";
    Object.assign(record.generation, { closed: true, settled: true });
    this.publish(record, { type: "status", generationId: record.generation.id, phase: "settled",
      seq: ++record.generationSeq, status: record.activity, activity: record.activity, detail: null });
    this.emit("settled", { record, completed: !stopped && !error });
  }

  failPrompt(record, cause) {
    if (!record.active) return;
    this.publish(record, { type: "error", generationId: record.generation?.id || null, scope: "runtime",
      error: { code: "backend_unavailable", message: cause.message || String(cause) } });
    void this.finish(record, "error");
  }

  async cancel(id) {
    const record = this.get(id);
    if (!record?.active) return false;
    record.stopping = true;
    record.activity = "stopping";
    record.client.notify("session/cancel", { sessionId: record.sessionId });
    // ACP has a cancelled turn's open permission requests answered `cancelled`.
    this.cancelRequests(record);
    return true;
  }

  cancelRequests(record) {
    for (const [requestId, rpcId] of record.requests) {
      try { record.client.respond(rpcId, { outcome: { outcome: "cancelled" } }); } catch { /* fx has gone. */ }
      this.resolveRequest(record, requestId);
    }
  }

  resolveRequest(record, requestId) {
    record.requests.delete(requestId);
    record.hostUiRequests = record.hostUiRequests.filter((item) => item.id !== requestId);
    record.activity = record.active ? "working" : "idle";
    this.publish(record, { type: "permission_resolved", generationId: record.generation?.id || null, requestId });
  }

  /**
   * The names this turn was streamed under, kept by its place in fx's history:
   * the prompt, the answer, the step each tool ran in and when it started and
   * finished -- which fx does not save -- and how the turn ended.
   */
  async recordTurnIds(record, index, answer, outcome) {
    if (!record.turnIdsFile || index < 0) return;
    const ids = await readTurnIds(record.turnIdsFile);
    ids[`${record.sessionId}:${index}`] = { user: record.answering, assistant: answer?.id, outcome,
      tools: Object.fromEntries([...record.tools.values()].map((tool) => [tool.id,
        { step: tool.stepId, at: tool.startedAt, ...(tool.completedAt ? { done: tool.completedAt } : {}) }])) };
    try {
      await fs.mkdir(path.dirname(record.turnIdsFile), { recursive: true });
      await fs.writeFile(record.turnIdsFile, JSON.stringify(ids));
    } catch (cause) { console.warn(`fx turn ids were not saved: ${cause.message}`); }
  }

  /** A process that exits on its own takes its session with it, so the next prompt starts a new one. */
  processExited(record, cause) {
    if (this.get(record.id) !== record) return;
    this.failPrompt(record, cause);
    record.ready = false;
    record.status = "stopped";
    this.sessions.remove(record.id);
    this.emit("removed", { id: record.id, chatId: record.chatId });
  }

  async respondHostUi(id, response) {
    const record = this.get(id);
    const requestId = String(response?.id || response?.requestId || "");
    const rpcId = record?.requests.get(requestId);
    if (rpcId == null) throw failure("fx permission request is no longer pending", "host_ui_request_missing", 404);
    const selected = response.cancelled || response.dismissed ? "reject_once"
      : String(response.value || response.optionId || "reject_once");
    record.client.respond(rpcId, { outcome: { outcome: "selected", optionId: selected } });
    this.resolveRequest(record, requestId);
    return null;
  }

  async close(id) {
    const record = this.get(id);
    if (!record) return false;
    try {
      if (record.sessionId) await Promise.race([
        record.client.request("session/close", { sessionId: record.sessionId }),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    } catch { /* The process is closed below. */ }
    record.client?.close();
    record.status = "stopped";
    record.active = false;
    this.sessions.remove(id);
    this.emit("removed", { id, chatId: record.chatId });
    return true;
  }

  async shutdown() {
    const records = this.rawRecords();
    await Promise.all(records.map((record) => this.close(record.id)));
    return records.length;
  }

  async listThreads({ cwd, limit = 60 } = {}) {
    const result = await this.json(["sessions", "--all", "--limit", String(Math.min(Math.max(limit, 1), 100)), "--json"]);
    return (result.sessions || []).map((session) => ({
      id: session.id, title: session.title || session.preview || "Untitled fx session",
      preview: session.preview || "", cwd: session.workspace_root || session.origin_workspace_root || "",
      createdAt: session.created_at_ms ? new Date(session.created_at_ms).toISOString() : null,
      updatedAt: session.updated_at_ms ? new Date(session.updated_at_ms).toISOString() : null,
      status: "unknown", source: "fx", replayFidelity: "full",
    })).filter((session) => session.id && (!cwd || session.cwd === cwd));
  }

  listSessions(options) { return this.listThreads(options); }

  /**
   * fx's saved history as a transcript, in the shape it was streamed in: each
   * step's words and the tools after them, then the answer. Steps fx saved
   * with no words of their own ran on from the step before, as they did live;
   * a step Conduit streamed is named what it was streamed as.
   */
  static transcript(data, turnIds = {}) {
    const messages = [];
    const tools = [];
    for (const [index, turn] of (data.history || []).entries()) {
      const streamed = turnIds[`${data.id}:${index}`] || {};
      const userId = streamed.user || `${data.id}:user:${index}`;
      const assistantId = streamed.assistant || `${data.id}:assistant:${index}`;
      const outcome = streamed.outcome || "complete";
      messages.push({ id: userId, role: "user", content: turn.user?.text || "", outcome });
      let step = null;
      for (const [stepIndex, saved] of (turn.execution?.tool_steps || []).entries()) {
        const said = typeof saved.assistant === "string" ? saved.assistant.trim() : "";
        const calls = saved.tool_calls || [];
        const streamedStep = calls.map((call) => streamed.tools?.[call.id]?.step).find(Boolean);
        if (!step || said || (streamedStep && streamedStep !== step.id)) {
          step = { id: streamedStep || `${data.id}:${index}:step:${stepIndex}`, role: "assistant", content: said,
            blocks: said ? [{ kind: "text", text: said }] : [], answers: userId, stopReason: "toolUse", interim: true };
          messages.push(step);
        }
        for (const call of calls) {
          let input = call.arguments_json || "";
          try { input = JSON.parse(input); } catch { /* Keep the native text. */ }
          step.blocks.push({ kind: "tool_call", toolCallId: call.id, name: call.name, input });
          const result = (saved.tool_results || []).find((item) => item.tool_call_id === call.id);
          // fx saves neither time: `created_at_ms` is when the turn was saved.
          const started = streamed.tools?.[call.id]?.at;
          const finished = streamed.tools?.[call.id]?.done;
          tools.push({ toolCallId: call.id, name: call.name, kind: kindOf(call.name), subject: subjectOf(input), input,
            output: result?.output || result?.preview || "", ...(result ? resultState(result) : { isError: false }),
            done: Boolean(result), ...(started ? { timestamp: started } : {}), ...(finished ? { completedAt: finished } : {}) });
        }
      }
      messages.push({ id: assistantId, role: "assistant", content: turn.assistant || "",
        blocks: [{ kind: "text", text: turn.assistant || "" }], answers: userId,
        stopReason: outcome === "interrupted" ? "aborted" : outcome === "failed" ? "error" : "stop", interim: false });
    }
    return { messages, tools };
  }

  async readTranscript({ liveSessionId, opaqueSession, chatId, project }) {
    const record = liveSessionId ? this.get(liveSessionId) : null;
    const sessionId = record?.sessionId || (typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId);
    if (!sessionId) return { messages: [], tools: [], page: { before: null } };
    const [data, turnIds] = await Promise.all([this.json(["session", "--id", sessionId, "--json"]),
      turnIdsFile(project, chatId).then((file) => readTurnIds(record?.turnIdsFile || file))]);
    return { ...FxAcpAdapter.transcript(data, turnIds), page: { before: null } };
  }

  async readHistory(options) {
    const { messages } = await this.readTranscript(options);
    let child = null;
    let leafId = null;
    for (const message of [...messages].reverse()) {
      const node = { entry: { id: message.id, parentId: null, timestamp: message.timestamp || null,
        type: "message", display: `${message.role}: ${String(message.content || "").replace(/\s+/g, " ").trim().slice(0, 240)}`,
        kind: message.role, hidden: false, forkable: false, regeneratable: false }, children: child ? [child] : [] };
      if (child) child.entry.parentId = node.entry.id;
      else leafId = node.entry.id;
      child = node;
    }
    return { mode: "linear", leafId, tree: child ? [child] : [] };
  }

  async listAvailableModels() {
    const result = await this.json(["models", "--json"]);
    return (result.models || []).map((model) => ({ provider: model.source || "fx", id: model.id,
      spec: model.id, label: model.id, reasoning: true,
      thinkingLevels: ["auto", "low", "medium", "high", "xhigh", "max"], defaultThinkingLevel: "auto" }));
  }

  listModels(id) {
    const record = this.get(id);
    if (record?.configOptions) {
      const models = record.configOptions.find((item) => item.id === "model")?.options || [];
      const efforts = record.configOptions.find((item) => item.id === "effort")?.options?.map((item) => item.value) || [];
      return Promise.resolve(models.map((model) => ({ provider: "fx", id: model.value, spec: model.value,
        label: model.name || model.value, reasoning: true, thinkingLevels: efforts, defaultThinkingLevel: "auto" })));
    }
    return this.listAvailableModels(record?.cwd);
  }

  listCommands() { return Promise.resolve([]); }
  listAvailableCommands() { return Promise.resolve([]); }
  async setModel(id, model) { const record = this.get(id); await this.configure(record, { model }); return record.model; }
  async setThinkingLevel(id, thinkingLevel) { const record = this.get(id); await this.configure(record, { thinkingLevel }); return record.thinkingLevel; }
  async getModelState(id) { const record = this.get(id); return { model: record?.model || "", thinkingLevel: record?.thinkingLevel || "" }; }

  permissionModes(record) {
    const modes = record?.modes?.availableModes || [
      { id: "code", name: "Code", description: "Write and modify code with fx permission review" },
      { id: "ask", name: "Ask", description: "Ask before making changes" },
    ];
    return modes.map((mode) => ({ id: mode.id, label: mode.name || mode.id, description: mode.description || "", allowed: true }));
  }

  listPermissionModes(id) { return Promise.resolve(this.permissionModes(this.get(id))); }
  listAvailablePermissionModes() { return Promise.resolve(this.permissionModes(null)); }
  // Handed the mode the routes chose, as Codex is, not its id.
  async setPermissionMode(id, mode) {
    const record = this.get(id);
    await this.configure(record, { permissionMode: mode?.id || String(mode || "") });
    return record.permissionMode;
  }

  getCapabilities() { return FX_CAPABILITIES; }
  toClientEvent(event) { return event; }
  waitForSession() { return Promise.resolve(); }
  replay(id) { return this.sessions.runtimeState(this.get(id)); }
  attach(id, socket) { return this.sessions.attach(id, socket); }
  setFrameInterval(_id, socket, ms) { return this.sessions.setFrameInterval(socket, ms); }
  view(record) { return { ...this.sessions.view(record), hostUiRequests: [...(record?.hostUiRequests || [])] }; }
  publish(record, event) { return this.sessions.publish(record, event); }
  get(id) { return this.sessions.get(id); }
  getByChatId(chatId) { return this.sessions.getByChatId(chatId); }
  rawRecords() { return this.sessions.rawRecords(); }
  list() { return this.sessions.list(); }
  track(id, chatId) { return this.sessions.reassign(id, chatId); }
}
