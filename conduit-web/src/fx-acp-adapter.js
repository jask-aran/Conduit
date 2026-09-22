import crypto from "node:crypto";
import { spawn, execFile as execFileCallback } from "node:child_process";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { parseAttachmentEnvelope } from "./attachment-envelope.js";
import { SessionRecords } from "./harnesses/session-records.js";
import { messageClose, messageOpen, toolClose, toolOpen } from "./harnesses/transcript-ops.js";
import { unsupported } from "./harnesses/unsupported.js";

const execFile = promisify(execFileCallback);

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
  replay: true,
  attachments: false,
  interruptKeepsPartial: false,
});

const failure = (message, code = "backend_unavailable", status = 409) =>
  Object.assign(new Error(message), { code, status });

const outputText = (content) => (Array.isArray(content) ? content : [])
  .map((item) => item?.content?.text || item?.text || "").filter(Boolean).join("\n");

class AcpClient {
  constructor(command, cwd, onNotification, onRequest) {
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
    this.child.once("exit", (code, signal) => this.fail(failure(
      this.stderr.trim() || `fx ACP exited (${signal || code})`, "backend_unavailable")));
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
        cwd: options.cwd, maxBuffer: 32 * 1024 * 1024, encoding: "utf8",
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
      hostUiRequests: [], requests: new Map(), answer: null, tools: new Map(), loading: true,
    });
    record.client = new AcpClient(this.command, record.cwd,
      (message) => this.notification(record, message),
      (message) => this.requestFromAgent(record, message));
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

  ensureAnswer(record, messageId = "") {
    if (record.answer) return record.answer;
    const id = messageId || crypto.randomUUID();
    record.answer = { id, text: "", blocks: [], tools: new Set() };
    this.publish(record, messageOpen({ id, role: "assistant", generationId: record.generation?.id || null,
      answers: record.answering || null, timestamp: new Date().toISOString() }));
    return record.answer;
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
    if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") {
      const answer = this.ensureAnswer(record, update.messageId);
      const delta = String(update.content.text || "");
      answer.text += delta;
      this.publish(record, { type: "assistant_content", phase: "delta", generationId,
        seq: ++record.generationSeq, messageId: answer.id, contentIndex: 0, blockKind: "text", delta });
      return;
    }
    if (update.sessionUpdate === "tool_call") {
      const answer = this.ensureAnswer(record);
      const tool = { id: update.toolCallId, name: update.name || update.title || "tool",
        input: update.rawInput ?? null, output: "", closed: false };
      record.tools.set(tool.id, tool);
      answer.tools.add(tool.id);
      this.publish(record, toolOpen({ toolCallId: tool.id, name: tool.name, input: tool.input,
        messageId: answer.id, generationId }));
      this.publish(record, { type: "tool_activity", phase: "start", generationId,
        seq: ++record.generationSeq, toolCallId: tool.id, name: tool.name, input: tool.input });
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
        this.publish(record, toolClose({ toolCallId: tool.id, output: tool.output,
          isError: update.status === "failed", generationId }));
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
    record.answer = null;
    record.tools.clear();
    this.publish(record, messageOpen({ id: userMessageId, role: "user", generationId,
      content: parseAttachmentEnvelope(message).message, timestamp: new Date().toISOString() }));
    this.publish(record, { type: "status", generationId, phase: "started", seq: ++record.generationSeq,
      status: "working", activity: "working", detail: null });
    const request = record.client.request("session/prompt", {
      sessionId: record.sessionId,
      prompt: [{ type: "text", text: parseAttachmentEnvelope(message).message }],
    });
    void request.then((result) => this.finish(record, result?.stopReason || "stop"), (cause) => this.failPrompt(record, cause));
    return { generationId, attachmentIdentity: { messageId: userMessageId } };
  }

  finish(record, stopReason) {
    if (!record.active) return;
    const answer = record.answer;
    if (answer) {
      const toolBlocks = [...answer.tools].map((id) => record.tools.get(id)).filter(Boolean)
        .map((tool) => ({ kind: "tool_call", toolCallId: tool.id, name: tool.name, input: tool.input }));
      const blocks = [{ kind: "text", text: answer.text }, ...toolBlocks];
      this.publish(record, { type: "assistant_content", phase: "final", generationId: record.generation.id,
        seq: ++record.generationSeq, messageId: answer.id, stopReason, errorMessage: null, blocks });
      this.publish(record, messageClose({ messageId: answer.id, stopReason, blocks,
        generationId: record.generation.id, keepsPartial: false, model: record.model || null }));
    }
    record.active = false;
    record.stopping = false;
    record.activity = "idle";
    Object.assign(record.generation, { closed: true, settled: true });
    this.publish(record, { type: "status", generationId: record.generation.id, phase: "settled",
      seq: ++record.generationSeq, status: "idle", activity: "idle", detail: null });
    this.emit("settled", { record, completed: stopReason !== "cancelled" });
  }

  failPrompt(record, cause) {
    if (!record.active) return;
    this.publish(record, { type: "error", generationId: record.generation?.id || null, scope: "runtime",
      error: { code: "backend_unavailable", message: cause.message || String(cause) } });
    this.finish(record, "error");
  }

  async cancel(id) {
    const record = this.get(id);
    if (!record?.active) return false;
    record.stopping = true;
    record.activity = "stopping";
    record.client.notify("session/cancel", { sessionId: record.sessionId });
    return true;
  }

  async respondHostUi(id, response) {
    const record = this.get(id);
    const requestId = String(response?.id || response?.requestId || "");
    const rpcId = record?.requests.get(requestId);
    if (rpcId == null) throw failure("fx permission request is no longer pending", "host_ui_request_missing", 404);
    const selected = response.cancelled || response.dismissed ? "reject_once"
      : String(response.value || response.optionId || "reject_once");
    record.client.respond(rpcId, { outcome: { outcome: "selected", optionId: selected } });
    record.requests.delete(requestId);
    record.hostUiRequests = record.hostUiRequests.filter((item) => item.id !== requestId);
    record.activity = record.active ? "working" : "idle";
    this.publish(record, { type: "permission_resolved", generationId: record.generation?.id || null, requestId });
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

  static transcript(data) {
    const messages = [];
    const tools = [];
    for (const [index, turn] of (data.history || []).entries()) {
      const userId = `${data.id}:user:${index}`;
      const assistantId = `${data.id}:assistant:${index}`;
      messages.push({ id: userId, role: "user", content: turn.user?.text || "" });
      const blocks = [{ kind: "text", text: turn.assistant || "" }];
      for (const step of turn.execution?.tool_steps || []) {
        for (const call of step.tool_calls || []) {
          let input = call.arguments_json || "";
          try { input = JSON.parse(input); } catch { /* Keep the native text. */ }
          blocks.push({ kind: "tool_call", toolCallId: call.id, name: call.name, input });
          const result = (step.tool_results || []).find((item) => item.tool_call_id === call.id);
          tools.push({ toolCallId: call.id, name: call.name, input,
            output: result?.output || result?.preview || "", isError: result?.status === "failed", done: Boolean(result) });
        }
      }
      messages.push({ id: assistantId, role: "assistant", content: turn.assistant || "", blocks,
        answers: userId, stopReason: "stop", interim: false });
    }
    return { messages, tools };
  }

  async readTranscript({ liveSessionId, opaqueSession }) {
    const record = liveSessionId ? this.get(liveSessionId) : null;
    const sessionId = record?.sessionId || (typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId);
    if (!sessionId) return { messages: [], tools: [], page: { before: null } };
    const data = await this.json(["session", "--id", sessionId, "--json"]);
    return { ...FxAcpAdapter.transcript(data), page: { before: null } };
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
  async setPermissionMode(id, mode) { const record = this.get(id); await this.configure(record, { permissionMode: mode }); return mode; }

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
