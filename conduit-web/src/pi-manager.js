import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { buildPiEnvironment, buildPiResourceArgs } from "../../scripts/pi-runtime.mjs";
import { mergeContinuation } from "./continuation.js";

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

export class PiManager extends EventEmitter {
  constructor({ command = "pi", agentDir, template, spawnImpl = spawn } = {}) {
    super();
    if (!agentDir) throw new Error("PiManager requires an isolated agent directory");
    this.command = command;
    this.spawnImpl = spawnImpl;
    this.agentDir = agentDir;
    this.template = template;
    this.processes = new Map();
    this.bySessionFile = new Map();
    this.requestSequence = 0;
  }

  create({ project, chatId = null, sessionFile = null, model = "", thinkingLevel = "", models }) {
    if (chatId) {
      const existing = [...this.processes.values()].find((record) =>
        record.chatId === chatId && ["starting", "running"].includes(record.status));
      if (existing) return existing;
    }
    const resolvedFile = sessionFile ? path.resolve(sessionFile) : null;
    if (resolvedFile && this.bySessionFile.has(resolvedFile)) {
      const existingId = this.bySessionFile.get(resolvedFile);
      const existing = this.processes.get(existingId);
      if (existing && ["starting", "running"].includes(existing.status)) {
        if (chatId) existing.chatId = chatId;
        return existing;
      }
      this.bySessionFile.delete(resolvedFile);
      this.processes.delete(existingId);
    }
    const id = resolvedFile
      ? crypto.createHash("sha256").update(resolvedFile).digest("hex").slice(0, 24)
      : crypto.randomUUID().replaceAll("-", "").slice(0, 24);

    const args = buildPiArgs({ sessionFile: resolvedFile, model, thinkingLevel, models, template: this.template });
    const child = this.spawnImpl(this.command, args, {
      cwd: project.path,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildPiEnvironment(this.agentDir),
    });
    const record = {
      id,
      chatId,
      projectId: project.id,
      projectSlug: project.slug,
      cwd: project.path,
      sessionDir: project.sessionsDir,
      sessionFile: resolvedFile,
      model: model.trim() || null,
      thinkingLevel: thinkingLevel.trim() || null,
      template: { id: this.template.id, version: this.template.version },
      child,
      status: "starting",
      active: false,
      clients: new Set(),
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stdoutBuffer: "",
      stream: null,
      generationSequence: 0,
      generation: null,
      stopping: false,
      pendingRequests: new Map(),
    };
    this.processes.set(id, record);
    if (resolvedFile) this.bySessionFile.set(resolvedFile, id);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(record, chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.publish(record, { type: "runtime_stderr", message: String(chunk) }));
    child.once("spawn", () => {
      record.status = "running";
      this.publishState(record);
      this.send(record.id, { type: "get_state" });
    });
    child.once("error", (error) => {
      record.status = "failed";
      for (const pending of record.pendingRequests.values()) pending.reject(error);
      record.pendingRequests.clear();
      this.publish(record, { type: "runtime_error", message: error.message });
      this.publishState(record);
    });
    child.once("exit", (code, signal) => {
      record.status = "stopped";
      if (record.sessionFile) this.bySessionFile.delete(record.sessionFile);
      for (const pending of record.pendingRequests.values()) pending.reject(new Error("Pi process exited before replying"));
      record.pendingRequests.clear();
      this.publish(record, { type: "runtime_exit", code, signal });
      this.publishState(record);
    });
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
          else pending.resolve(event);
        }
        if (event.type === "agent_start") record.active = true;
        if (event.type === "agent_end") record.active = false;
        if (event.type === "message_start" && event.message?.role === "assistant") {
          if (record.generation?.closed) continue;
          record.stream = { chunks: [], generationId: record.generation?.id || null };
          this.publishGeneration(record, event);
          continue;
        }
        const delta = event.assistantMessageEvent;
        if (event.type === "message_update" && delta?.type === "text_delta" && record.stream) {
          this.handleTextDelta(record, delta.delta || "");
          continue;
        }
        if (event.type === "message_end" && event.message?.role === "assistant") {
          this.finishAssistantMessage(record, event);
          continue;
        }
        this.publishGeneration(record, event);
        if (event.type === "agent_end" && record.status === "running") {
          this.send(record.id, { type: "get_state" });
        }
      } catch {
        this.publish(record, { type: "runtime_stdout", message: line });
      }
    }
  }

  captureSession(record, event) {
    const sessionFile = event.sessionFile || event.data?.sessionFile || event.result?.sessionFile;
    const sessionId = event.sessionId || event.data?.sessionId || event.result?.sessionId;
    if (sessionFile) {
      const resolved = path.resolve(sessionFile);
      if (record.sessionFile && record.sessionFile !== resolved) this.bySessionFile.delete(record.sessionFile);
      record.sessionFile = resolved;
      this.bySessionFile.set(resolved, record.id);
    }
    if (sessionId) record.sessionId = sessionId;
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
    this.publishGeneration(record, { type: "assistant_stream_final", message: event.message, content: finalContent }, generation);
    record.stream = null;
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

  prompt(id, message, { continuationBase = "" } = {}) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    if (record.stopping) throw Object.assign(new Error("Pi is still stopping the previous response"), { code: "generation_stopping" });
    const generationId = `g${++record.generationSequence}`;
    const previousGeneration = record.generation;
    record.generation = { id: generationId, closed: false, continuationBase };
    try {
      this.send(id, { type: "prompt", message });
    } catch (error) {
      record.generation = previousGeneration;
      throw error;
    }
    this.publish(record, { type: "generation_started", generationId, continuation: Boolean(continuationBase) });
    return generationId;
  }

  async abortGeneration(id, generationId = null) {
    const record = this.processes.get(id);
    const generation = record?.generation;
    if (!record || !generation || (generationId && generation.id !== generationId)) return null;
    generation.closed = true;
    record.stopping = true;
    generation.partial = record.stream?.chunks.join("") || generation.partial || "";
    record.stream = null;
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
    this.publish(record, { type: "generation_stopped", generationId: generation.id, status: "stopped", processTerminated });
    return { generationId: generation.id, processTerminated };
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
    socket.once("close", () => record.clients.delete(socket));
  }

  publish(record, event) {
    record.updatedAt = new Date().toISOString();
    record.events.push(event);
    if (record.events.length > 500) record.events.splice(0, record.events.length - 500);
    const payload = JSON.stringify(event);
    for (const socket of record.clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
    this.emit("event", { record, event });
  }

  publishGeneration(record, event, generation = record.generation) {
    if (generation?.closed) return false;
    this.publish(record, generation ? { ...event, generationId: generation.id } : event);
    return true;
  }

  publishState(record) {
    this.publish(record, { type: "runtime_state", session: this.view(record) });
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
    const { child, clients, stdoutBuffer, events, stream, pendingRequests, generation, ...safe } = record;
    return { ...safe, generation: generation ? { id: generation.id, closed: generation.closed } : null, clientCount: clients.size };
  }

  list() {
    return [...this.processes.values()].map((record) => this.view(record));
  }

  get(id) {
    return this.processes.get(id) || null;
  }
}
