import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { parseAttachmentEnvelope } from "./attachment-envelope.js";
import { SessionRecords } from "./harnesses/session-records.js";
import { unsupported } from "./harnesses/unsupported.js";

export const CHATGPT_WEB_CAPABILITIES = Object.freeze({
  steer: false, followUpQueue: false, cancel: true, compaction: false,
  thinkingLevels: true, modelSwitch: true, toolUse: false, permissions: false,
  usage: false, replay: true,
});

const adapterError = (message, code = "backend_unavailable", status = 409, extra = {}) =>
  Object.assign(new Error(message), { code, status, ...extra });

export class ChatGptWebAdapter extends EventEmitter {
  constructor({ python, script, dataDir, requestTimeoutMs = 20_000 } = {}) {
    super();
    this.python = python;
    this.script = script;
    this.dataDir = dataDir;
    this.requestTimeoutMs = requestTimeoutMs;
    this.sessions = new SessionRecords({
      capabilities: CHATGPT_WEB_CAPABILITIES,
      backend: { protocol: "native_api", implementation: "chatgpt-web", installationId: "user-chatgpt-account" },
      extras: (record) => ({
        thinkingLevel: record.thinkingLevel, title: record.title || null,
        linkUrl: record.sessionId.conversationId ? `https://chatgpt.com/c/${record.sessionId.conversationId}` : null,
      }),
      // This backend has no server-side history to re-read, so its own journal
      // is the transcript: every published event is durable before broadcast.
      onPublish: (record, event) => this.appendJournal(record.chatId, event),
    });
    this.records = this.sessions.records;
    this.byChatId = this.sessions.byChatId;
    Object.assign(this, unsupported(CHATGPT_WEB_CAPABILITIES, { label: "ChatGPT Web" }));
    this.child = null;
    this.origin = "";
    this.starting = null;
  }

  async ensureSidecar() {
    if (this.origin && this.child && this.child.exitCode == null) return;
    if (this.starting) return this.starting;
    this.starting = new Promise((resolve, reject) => {
      const child = spawn(this.python, [this.script], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, CONDUIT_CHATGPT_WEB_PORT: "0",
          CONDUIT_CHATGPT_WEB_COOKIE_FILE: path.join(this.dataDir, "cookies.json") },
      });
      this.child = child;
      const timer = setTimeout(() => reject(adapterError("ChatGPT Web sidecar did not start", "rpc_timeout", 504)), this.requestTimeoutMs);
      timer.unref?.();
      readline.createInterface({ input: child.stdout }).on("line", (line) => {
        let event;
        try { event = JSON.parse(line); } catch { return; }
        if (event.event === "ready" && Number.isInteger(event.port)) {
          clearTimeout(timer);
          this.origin = `http://127.0.0.1:${event.port}`;
          resolve();
        }
      });
      child.stderr.on("data", (data) => this.emit("diagnostic", { message: String(data) }));
      child.once("error", (cause) => { clearTimeout(timer); reject(adapterError(cause.message)); });
      child.once("exit", (code) => {
        this.origin = "";
        this.child = null;
        if (code && this.starting) reject(adapterError(`ChatGPT Web sidecar exited with ${code}`));
        for (const record of this.records.values()) if (record.active) this.failGeneration(record, adapterError("ChatGPT Web sidecar stopped"));
      });
    }).finally(() => { this.starting = null; });
    return this.starting;
  }

  async request(endpoint, options = {}) {
    await this.ensureSidecar();
    const response = await fetch(this.origin + endpoint, options);
    const body = await response.json();
    if (!response.ok) throw adapterError(body.message || "ChatGPT Web request failed", body.error, response.status,
      body.retryAfterMs ? { retryAfterMs: body.retryAfterMs } : {});
    return body;
  }

  health() { return this.request("/health"); }
  setCredential(cookie) { return this.request("/credential", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cookie }) }); }
  removeCredential() { return this.request("/credential", { method: "DELETE" }); }

  create(options) { return this.start(null, options); }
  restore(opaqueSession, options) { return this.start(opaqueSession, options); }
  async start(opaqueSession, { chatId, model = "", thinkingLevel = "" }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    await this.ensureSidecar();
    const cursor = typeof opaqueSession === "object" && opaqueSession ? opaqueSession : {};
    const record = {
      id: crypto.randomUUID(), chatId, status: "running", activity: "idle", adapterImplementation: "chatgpt-web",
      active: false, stopping: false, sessionId: { conversationId: cursor.conversationId || "", parentMessageId: cursor.parentMessageId || "" },
      model: model || cursor.model || "", thinkingLevel: thinkingLevel || cursor.thinkingLevel || "medium",
      generation: null, clients: new Set(), events: [], eventSequence: 0,
      abortController: null,
    };
    record.events = this.readJournal(chatId);
    this.records.set(record.id, record);
    this.byChatId.set(chatId, record.id);
    return record;
  }

  async prompt(id, message) {
    const record = this.get(id);
    if (!record || record.active) throw adapterError("ChatGPT Web session is busy", "generation_limit", 409);
    if (!record.model) throw adapterError("Select a ChatGPT model before sending a message", "invalid_model", 400);
    const userMessage = parseAttachmentEnvelope(message).message;
    const generationId = crypto.randomUUID();
    const messageId = `assistant-${generationId}`;
    record.active = true;
    record.activity = "working";
    record.stopping = false;
    record.generation = { id: generationId, closed: false, settled: false };
    record.abortController = new AbortController();
    this.publish(record, { type: "transcript_message", generationId,
      message: { id: crypto.randomUUID(), role: "user", content: userMessage } });
    this.publish(record, { type: "status", generationId, sequence: ++record.eventSequence, status: "working", activity: "working", detail: null });
    this.publish(record, { type: "assistant_content", generationId, phase: "start", sequence: ++record.eventSequence, messageId });
    void this.runPrompt(record, { generationId, messageId, message: userMessage });
    return generationId;
  }

  async runPrompt(record, { generationId, messageId, message }) {
    let fullText = "";
    try {
      await this.ensureSidecar();
      const response = await fetch(this.origin + "/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        signal: record.abortController.signal,
        body: JSON.stringify({ message, ...record.sessionId, model: record.model, thinkingLevel: record.thinkingLevel }) });
      if (!response.ok || !response.body) throw adapterError("ChatGPT Web response failed", "backend_unavailable", response.status);
      const reader = readline.createInterface({ input: Readable.fromWeb(response.body) });
      for await (const line of reader) {
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === "delta") {
          fullText += event.text;
          this.publish(record, { type: "assistant_content", generationId, phase: "delta", sequence: ++record.eventSequence,
            messageId, contentIndex: 0, blockKind: "text", delta: event.text });
        } else if (event.type === "done") {
          record.sessionId = { conversationId: event.conversationId || record.sessionId.conversationId,
            parentMessageId: event.parentMessageId || record.sessionId.parentMessageId,
            model: record.model, thinkingLevel: record.thinkingLevel };
          record.title = String(event.title || "").trim() || record.title || "";
        } else if (event.type === "error") {
          throw adapterError(event.message || "ChatGPT Web response failed", event.error, event.status || 502,
            event.retryAfterMs ? { retryAfterMs: event.retryAfterMs } : {});
        }
      }
      this.publish(record, { type: "assistant_content", generationId, phase: "final", sequence: ++record.eventSequence,
        messageId, stopReason: record.stopping ? "aborted" : "stop", errorMessage: null,
        blocks: [{ kind: "text", contentIndex: 0, text: fullText }] });
      this.settle(record, record.stopping ? "stopped" : "settled");
    } catch (cause) {
      if (cause.name === "AbortError") {
        this.publish(record, { type: "assistant_content", generationId, phase: "final", sequence: ++record.eventSequence,
          messageId, stopReason: "aborted", errorMessage: null, blocks: [{ kind: "text", contentIndex: 0, text: fullText }] });
        this.settle(record, "stopped");
      } else this.failGeneration(record, cause);
    }
  }

  settle(record, detail) {
    record.active = false;
    record.stopping = false;
    record.activity = "idle";
    record.abortController = null;
    Object.assign(record.generation, { closed: true, settled: true });
    this.publish(record, { type: "status", generationId: record.generation.id, sequence: ++record.eventSequence,
      status: "idle", activity: "idle", detail });
    this.emit("settled", { record });
  }

  failGeneration(record, cause) {
    record.active = false;
    record.stopping = false;
    record.activity = "failed";
    record.abortController = null;
    if (record.generation) Object.assign(record.generation, { closed: true, settled: true });
    const code = ["auth_expired", "rate_limited", "backend_unavailable"].includes(cause.code) ? cause.code : "backend_unavailable";
    this.publish(record, { type: "error", generationId: record.generation?.id || null,
      error: { code, message: cause.message, ...(code === "rate_limited" ? { retryAfterMs: cause.retryAfterMs || 60_000 } : {}) } });
    this.emit("settled", { record });
  }

  async cancel(id) {
    const record = this.get(id);
    if (!record?.active) return false;
    record.stopping = true;
    record.activity = "stopping";
    this.publish(record, { type: "status", generationId: record.generation.id, sequence: ++record.eventSequence,
      status: "stopping", activity: "stopping", detail: null });
    record.abortController.abort();
    return true;
  }

  async close(id) {
    const record = this.get(id);
    if (!record) return false;
    record.abortController?.abort();
    record.status = "stopped";
    record.active = false;
    this.records.delete(id);
    this.byChatId.delete(record.chatId);
    return true;
  }

  async shutdown() {
    for (const record of [...this.records.values()]) await this.close(record.id);
    // `this.child?.exitCode` is undefined when no sidecar ever started, and
    // `undefined == null` is true - so the optional chain guarded the read and
    // the comparison threw it away, killing null on every ordinary shutdown.
    if (this.child && this.child.exitCode == null) this.child.kill("SIGTERM");
  }

  async listAvailableModels() {
    const result = await this.request("/models");
    return result.models.map((item) => ({ provider: "chatgpt-web", id: item.id, spec: item.id, label: item.label,
      reasoning: item.thinkingLevels.length > 0, thinkingLevels: item.thinkingLevels,
      defaultThinkingLevel: item.defaultThinkingLevel || item.thinkingLevels[0] || "" }));
  }
  listModels() { return this.listAvailableModels(); }
  async setModel(id, model) { const record = this.get(id); if (record) record.model = model; return model; }
  async setThinkingLevel(id, thinkingLevel) { const record = this.get(id); if (record) record.thinkingLevel = thinkingLevel; return thinkingLevel; }
  getModelState(id) { const record = this.get(id); return Promise.resolve({ model: record?.model || "", thinkingLevel: record?.thinkingLevel || "" }); }
  getCapabilities() { return CHATGPT_WEB_CAPABILITIES; }
  toClientEvent(event) { return event; }
  replay(id) { return this.runtimeState(this.get(id)); }
  waitForSession() { return Promise.resolve(); }
  attach(id, socket) { return this.sessions.attach(id, socket); }
  view(record) { return this.sessions.view(record); }
  runtimeState(record) { return this.sessions.runtimeState(record); }
  publish(record, event) { return this.sessions.publish(record, event); }
  journalPath(chatId) { return path.join(this.dataDir, "journals", `${chatId}.jsonl`); }
  appendJournal(chatId, event) { const file = this.journalPath(chatId); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.appendFileSync(file, JSON.stringify(event) + "\n", { mode: 0o600 }); }
  readJournal(chatId) { try { return fs.readFileSync(this.journalPath(chatId), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; } }
  transcript(chatId) {
    const messages = [];
    for (const event of this.readJournal(chatId)) {
      if (event.type === "transcript_message" && event.message?.role === "user") messages.push({
        ...event.message, content: parseAttachmentEnvelope(event.message.content).message,
      });
      if (event.type === "assistant_content" && event.phase === "final") messages.push({
        id: event.messageId, role: "assistant",
        content: (event.blocks || []).filter((block) => block.kind === "text").map((block) => block.text || "").join(""),
        stopped: event.stopReason === "aborted", stopReason: event.stopReason || null,
      });
    }
    return messages;
  }
  get(id) { return this.sessions.get(id); }
  getByChatId(chatId) { return this.sessions.getByChatId(chatId); }
  list() { return this.sessions.list(); }
  stop(id) { void this.close(id); return Boolean(this.get(id)); }
}
