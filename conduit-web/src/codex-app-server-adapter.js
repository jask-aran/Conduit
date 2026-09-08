import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import readline from "node:readline";

export const CODEX_CAPABILITIES = Object.freeze({
  steer: false, followUpQueue: false, cancel: true, compaction: false,
  thinkingLevels: false, modelSwitch: true, toolUse: true, permissions: false,
  usage: false, replay: true,
});

const error = (message, code = "backend_unavailable", status = 409) => Object.assign(new Error(message), { code, status });

export class CodexAppServerAdapter extends EventEmitter {
  constructor({ command = "codex", requestTimeoutMs = 15_000 } = {}) {
    super();
    this.command = command;
    this.requestTimeoutMs = requestTimeoutMs;
    this.records = new Map();
    this.byChatId = new Map();
  }

  async create({ chatId, project, model = "" }) {
    const record = await this.start({ chatId, cwd: project.workingRoot });
    const result = await this.request(record, "thread/start", { cwd: project.workingRoot, ...(model ? { model } : {}) });
    record.sessionId = result.thread.id;
    record.model = result.model || model;
    return record;
  }

  async restore(opaqueSession, { chatId, project, model = "" }) {
    const record = await this.start({ chatId, cwd: project.workingRoot });
    const threadId = typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId;
    if (!threadId) throw error("Codex thread identity is missing");
    const result = await this.request(record, "thread/resume", {
      threadId, cwd: project.workingRoot, ...(model ? { model } : {}),
    });
    record.sessionId = result.thread?.id || threadId;
    record.model = model || result.model || result.thread?.model || "";
    const restored = await this.request(record, "thread/read", { threadId: record.sessionId, includeTurns: true });
    this.hydrate(record, restored.thread);
    return record;
  }

  hydrate(record, thread) {
    for (const turn of thread?.turns || []) {
      const generationId = turn.id || crypto.randomUUID();
      this.notification(record, "turn/started", { turn: { id: generationId } });
      for (const item of turn.items || []) {
        if (item.type === "userMessage") this.publish(record, { type: "transcript_message", generationId,
          message: { id: item.id, role: "user", content: item.text || item.content || "" } });
        if (item.type === "agentMessage") {
          const messageId = item.id || `assistant-${generationId}`;
          this.publish(record, { type: "assistant_content", generationId, phase: "start", sequence: ++record.eventSequence, messageId });
          this.publish(record, { type: "assistant_content", generationId, phase: "final",
            sequence: ++record.eventSequence, messageId, stopReason: "stop", errorMessage: null,
            blocks: [{ kind: "text", contentIndex: 0, text: item.text || "" }] });
        }
      }
      this.notification(record, "turn/completed", { turn: { id: generationId, status: "completed" } });
    }
  }

  async start({ chatId, cwd }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    const record = {
      id: crypto.randomUUID(), chatId, cwd, status: "starting", activity: "starting", adapterImplementation: "codex",
      active: false, stopping: false, sessionId: null, model: "", generation: null,
      clients: new Set(), events: [], pending: new Map(), sequence: 0, eventSequence: 0, messageIds: new Set(),
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
    if (message.method) this.notification(record, message.method, message.params || {});
  }

  notification(record, method, params) {
    const turnId = params.turn?.id || params.turnId || record.generation?.id || null;
    if (method === "turn/started") {
      record.active = true;
      record.activity = "working";
      record.generation = { id: turnId, closed: false, settled: false };
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
    } else if (method === "item/started" && params.item?.type === "commandExecution") {
      this.publish(record, { type: "tool_activity", generationId: turnId, phase: "start", sequence: ++record.eventSequence,
        toolCallId: params.item.id, name: "command", input: params.item.command || params.item });
    } else if (method === "item/completed" && params.item?.type === "commandExecution") {
      this.publish(record, { type: "tool_activity", generationId: turnId, phase: "end", sequence: ++record.eventSequence,
        toolCallId: params.item.id, name: "command", output: params.item.aggregatedOutput || "", isError: params.item.status === "failed" });
    } else if (method === "item/completed" && params.item?.type === "agentMessage") {
      if (!record.messageIds.has(params.item.id)) this.publish(record, { type: "assistant_content", generationId: turnId,
        phase: "start", sequence: ++record.eventSequence, messageId: params.item.id });
      this.publish(record, { type: "assistant_content", generationId: turnId, phase: "final", sequence: ++record.eventSequence,
        messageId: params.item.id || `assistant-${turnId}`, stopReason: "stop", errorMessage: null,
        blocks: [{ kind: "text", contentIndex: 0, text: params.item.text || "" }] });
    } else if (method === "turn/completed") {
      const failed = params.turn?.status === "failed";
      record.active = false;
      record.stopping = false;
      record.activity = failed ? "failed" : "idle";
      if (record.generation) Object.assign(record.generation, { closed: true, settled: true });
      this.publish(record, failed
        ? { type: "error", generationId: turnId, error: { code: "backend_unavailable", message: params.turn?.error?.message || "Codex turn failed" } }
        : { type: "status", generationId: turnId, sequence: ++record.eventSequence, status: "idle", activity: "idle", detail: "settled" });
      this.emit("settled", { record });
    }
  }

  async prompt(id, message) {
    const record = this.get(id);
    if (!record?.sessionId) throw error("Codex thread is not ready");
    const result = await this.request(record, "turn/start", {
      threadId: record.sessionId,
      input: [{ type: "text", text: message }],
      ...(record.model ? { model: record.model } : {}),
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
    return true;
  }
  async shutdown() { const records = [...this.records.values()].filter((record) => record.status !== "stopped"); await Promise.all(records.map((record) => this.close(record.id))); return records.length; }

  respondHostUi() { throw error("Codex does not expose host UI requests", "unsupported_interaction", 400); }
  queue() { throw error("Codex does not support steering or follow-up queues", "unsupported_interaction", 400); }
  fork() { throw error("Codex history forks are not available in this slice", "unsupported_interaction", 400); }
  async setModel(id, model) {
    const record = this.get(id);
    if (!record) throw error("Codex app-server is unavailable");
    record.model = model;
    return model;
  }
  setThinkingLevel() { throw error("Codex thinking-level switching is not available", "unsupported_interaction", 400); }
  refreshContext() { return Promise.resolve(null); }
  sendPi() { throw error("Unsupported Codex command", "unsupported_interaction", 400); }
  waitForSession() { return Promise.resolve(); }
  replay(id) { return this.runtimeState(this.get(id)); }
  getCapabilities() { return CODEX_CAPABILITIES; }
  toClientEvent(event) { return event; }
  async listModels(id) {
    const record = id ? this.get(id) : [...this.records.values()][0];
    if (!record) return [];
    const result = await this.request(record, "model/list", {});
    return (result.data || []).filter((item) => !item.hidden).map((item) => ({
      provider: "openai", id: item.id, spec: item.id, label: item.displayName || item.id,
      reasoning: false, thinkingLevels: ["off"],
    }));
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
  getModelState(id) { const record = this.get(id); return Promise.resolve({ model: record?.model || "", thinkingLevel: "" }); }
  attach(id, socket) { const record = this.get(id); record.clients.add(socket); socket.once("close", () => record.clients.delete(socket));
    for (const event of record.events) if (socket.readyState === 1) socket.send(JSON.stringify(event)); return this.runtimeState(record); }
  view(record) { return { id: record.id, chatId: record.chatId, status: record.status, activity: record.activity, active: record.active,
    stopping: record.stopping, generation: record.generation, model: record.model, capabilities: CODEX_CAPABILITIES,
    backend: { protocol: "native_api", implementation: "codex", installationId: "host-codex" } }; }
  runtimeState(record) { return { type: "runtime_state", generationId: record?.generation?.id || null,
    lifecycle: record?.status === "stopped" ? "closed" : record?.status === "starting" ? "creating" : record?.active ? "working" : "idle",
    status: record?.stopping ? "stopping" : record?.activity === "failed" ? "failed" : record?.active ? "working" : "idle",
    activity: record?.activity || "idle", capabilities: CODEX_CAPABILITIES }; }
  publish(record, event) { record.events.push(event); for (const socket of record.clients) if (socket.readyState === 1) socket.send(JSON.stringify(event)); }
  get(id) { return this.records.get(id) || null; }
  getByChatId(chatId) { const id = this.byChatId.get(chatId); return id ? this.get(id) : null; }
  list() { return [...this.records.values()].map((record) => this.view(record)); }
  stop(id) { void this.close(id); return Boolean(this.get(id)); }
  fail(record, cause) { for (const pending of record.pending.values()) { clearTimeout(pending.timer); pending.reject(error(cause.message)); } record.pending.clear(); }
  exit(record, code) { if (record.status !== "stopped" && code) this.publish(record, { type: "error", generationId: record.generation?.id || null,
    error: { code: "backend_unavailable", message: `Codex app-server exited with ${code}` } }); record.status = "stopped"; record.active = false; }
}
