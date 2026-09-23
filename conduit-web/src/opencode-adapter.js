import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
import { parseAttachmentEnvelope } from "./attachment-envelope.js";
import { SessionRecords } from "./harnesses/session-records.js";
import { messageClose, messageOpen, toolClose, toolOpen } from "./harnesses/transcript-ops.js";
import { unsupported } from "./harnesses/unsupported.js";

const execFile = promisify(execFileCallback);

export const OPENCODE_CAPABILITIES = Object.freeze({
  history: "linear",
  fork: false,
  regenerate: false,
  steer: false,
  followUpQueue: false,
  cancel: true,
  compaction: true,
  thinkingLevels: true,
  modelSwitch: true,
  toolUse: true,
  approvals: true,
  permissionModes: false,
  usage: true,
  replay: false,
  attachments: false,
  interruptKeepsPartial: false,
});

const failure = (message, code = "backend_unavailable", status = 409) =>
  Object.assign(new Error(message), { code, status });

const iso = (milliseconds) => Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
const modelSpec = (model) => model?.providerID && (model.id || model.modelID)
  ? `${model.providerID}/${model.id || model.modelID}` : "";
const splitModel = (spec, variant = "") => {
  const slash = String(spec || "").indexOf("/");
  return slash > 0 ? { providerID: spec.slice(0, slash), id: spec.slice(slash + 1), ...(variant ? { variant } : {}) } : null;
};
const stateRoot = () => process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
const contentText = (content) => (Array.isArray(content) ? content : [])
  .map((item) => item?.text || item?.content?.map?.((part) => part?.text || "").join("") || "").join("");
const STREAM_RETRY_LIMIT = 10;
// A stopped step is saved as finish "error" with an "aborted" error; it is a stop, not a failure.
const stopReasonOf = (row) => row.error?.type === "aborted" ? "aborted"
  : row.finish === "tool-calls" ? "toolUse" : row.finish || (row.time?.completed ? "stop" : null);
const errorOf = (row) => row.error?.type === "aborted" ? null : row.error?.message || null;
const toolOutput = (part) => contentText(part?.state?.content) || String(part?.state?.output || part?.state?.error || "");

export class OpenCodeAdapter extends EventEmitter {
  constructor({ command = "opencode2", logs = null } = {}) {
    super();
    this.command = command;
    this.connection = null;
    this.connectionStart = null;
    this.stream = null;
    this.sessions = new SessionRecords({
      capabilities: OPENCODE_CAPABILITIES,
      backend: { protocol: "native_api", implementation: "opencode", installationId: "host-opencode" },
      extras: (record) => ({ thinkingLevel: record.thinkingLevel }),
      logs,
    });
    this.records = this.sessions.records;
    this.byChatId = this.sessions.byChatId;
    Object.assign(this, unsupported(OPENCODE_CAPABILITIES, { label: "OpenCode" }));
  }

  async commandOutput(args) {
    try {
      const { stdout } = await execFile(this.command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
      return stdout.trim();
    } catch (cause) {
      throw failure(String(cause.stderr || cause.message || cause).trim());
    }
  }

  async connect() {
    if (this.connection) return this.connection;
    if (this.connectionStart) return this.connectionStart;
    this.connectionStart = (async () => {
      // `service status` prints `stopped` and succeeds when there is no service.
      const loopback = /^http:\/\/127\.0\.0\.1:\d+$/;
      let baseUrl = await this.commandOutput(["service", "status"]).catch(() => "");
      if (!loopback.test(baseUrl)) {
        await this.commandOutput(["service", "start"]);
        baseUrl = await this.commandOutput(["service", "status"]);
      }
      if (!loopback.test(baseUrl)) throw failure("OpenCode service did not report a loopback URL");
      const configRoot = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
      let password = process.env.OPENCODE_SERVER_PASSWORD || "";
      if (!password) {
        try { password = JSON.parse(await fs.readFile(path.join(configRoot, "opencode", "service.json"), "utf8")).password || ""; }
        catch (cause) { if (cause.code !== "ENOENT") throw cause; }
      }
      const headers = { accept: "application/json" };
      if (password) headers.authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`;
      this.connection = { baseUrl, headers };
      return this.connection;
    })();
    try { return await this.connectionStart; }
    finally { this.connectionStart = null; }
  }

  async request(method, route, { directory = "", query = {}, body } = {}) {
    const connection = await this.connect();
    const url = new URL(`/api${route}`, connection.baseUrl);
    if (directory) url.searchParams.set("directory", directory);
    for (const [key, value] of Object.entries(query)) if (value !== "" && value != null) url.searchParams.set(key, String(value));
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { ...connection.headers, ...(body === undefined ? {} : { "content-type": "application/json" }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      // The service may have stopped or moved; ask for it again next time.
      this.connection = null;
      throw failure(`OpenCode service is unreachable: ${cause.cause?.code || cause.message}`);
    }
    if (!response.ok) {
      const detail = (await response.text()).trim();
      if (response.status === 401) this.connection = null;
      throw failure(detail || `OpenCode returned HTTP ${response.status}`,
        response.status === 404 ? "backend_session_not_found" : "backend_unavailable", response.status);
    }
    if (response.status === 204) return null;
    const result = await response.json();
    return result?.data ?? result;
  }

  health() {
    return this.request("GET", "/info").then((info) => ({ configured: true, transportVersion: info.version || null }));
  }

  async launch(context, { model = "", thinkingLevel = "", forceModel = false } = {}) {
    const selectedModel = (forceModel ? String(model).trim() : "") || String(context.chat.backend.model || "").trim();
    const selectedThinkingLevel = (forceModel ? String(thinkingLevel).trim() : "")
      || String(context.chat.modelThinkingLevels?.[selectedModel] || "").trim();
    const options = { chatId: context.chat.id, project: context.project,
      model: selectedModel, thinkingLevel: selectedThinkingLevel };
    const live = context.chat.backend.opaqueSession
      ? await this.restore(context.chat.backend.opaqueSession, options) : await this.create(options);
    return { live, mapping: {
      backend: { ...context.chat.backend, model: live.model || selectedModel, opaqueSession: live.sessionId },
      ...(live.thinkingLevel ? { modelThinkingLevels: {
        ...(context.chat.modelThinkingLevels || {}), [live.model || selectedModel]: live.thinkingLevel,
      } } : {}),
    }, modelRecovery: null };
  }

  record({ chatId, project, session }) {
    const spec = modelSpec(session.model);
    return this.sessions.add({
      id: crypto.randomUUID(), chatId, projectId: project?.id || null,
      cwd: session.location?.directory || project?.workingRoot, sessionId: session.id,
      status: "running", ready: true, activity: "idle", active: false, stopping: false,
      model: spec, thinkingLevel: session.model?.variant || "", generation: null, generationSeq: 0,
      clients: new Set(), events: [], hostUiRequests: [], requests: new Map(),
      liveMessages: new Map(), promptStartedAt: 0,
    });
  }

  async create({ chatId, project, model = "", thinkingLevel = "" }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    const selected = splitModel(model, thinkingLevel);
    // The service ignores `?directory=` here; a session without a location
    // lands in the service's own directory.
    const session = await this.request("POST", "/session", {
      body: { location: { directory: project.workingRoot }, ...(selected ? { model: selected } : {}) },
    });
    return this.record({ chatId, project, session });
  }

  async restore(opaqueSession, { chatId, project, model = "", thinkingLevel = "" }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    const sessionId = typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId;
    if (!sessionId) throw failure("OpenCode session identity is missing");
    const session = await this.request("GET", `/session/${encodeURIComponent(sessionId)}`);
    const record = this.record({ chatId, project, session });
    if (model && model !== record.model) await this.setModel(record.id, model, thinkingLevel);
    return record;
  }

  async prompt(id, message, options = {}) {
    const record = this.get(id);
    if (!record?.sessionId) throw failure("OpenCode session is not ready");
    if (record.active) throw failure("OpenCode session is busy", "generation_limit", 409);
    const generationId = crypto.randomUUID();
    // OpenCode owns its message IDs. The API accepts exact-retry IDs only in
    // its own `msg_*` format, so Conduit's optimistic ID remains at the edge.
    const userMessageId = `msg_${crypto.randomUUID().replaceAll("-", "")}`;
    const clientUserMessageId = options.clientUserMessageId || userMessageId;
    record.active = true;
    record.activity = "working";
    record.stopping = false;
    record.generation = { id: generationId, closed: false, settled: false };
    record.promptStartedAt = Date.now();
    record.promptMessageId = userMessageId;
    record.answering = clientUserMessageId;
    record.liveMessages.clear();
    this.publish(record, messageOpen({ id: clientUserMessageId, role: "user", generationId,
      content: parseAttachmentEnvelope(message).message, timestamp: new Date().toISOString() }));
    this.publish(record, { type: "status", generationId, phase: "started", seq: ++record.generationSeq,
      status: "working", activity: "working", detail: null });
    try {
      // Listen before asking, so the turn's first events are not missed.
      await this.ensureStream();
      await this.request("POST", `/session/${encodeURIComponent(record.sessionId)}/prompt`, { body: {
        id: userMessageId, text: parseAttachmentEnvelope(message).message, files: [], agents: [],
      } });
      return { generationId, attachmentIdentity: { messageId: clientUserMessageId } };
    } catch (cause) {
      // "started" already went out, so the generation has to be settled too.
      this.settle(record, "failed");
      throw cause;
    }
  }

  /**
   * One `/api/event` stream serves every session, as it does for OpenCode's
   * own TUI. It opens before the first prompt and is reopened while a turn is
   * running; a turn that ran across the gap is caught up from saved messages.
   */
  ensureStream() {
    if (this.stream) return this.stream.ready;
    const stream = { controller: new AbortController(), ready: null };
    this.stream = stream;
    stream.ready = this.openStream(stream).catch((cause) => {
      if (this.stream === stream) this.stream = null;
      throw cause;
    });
    return stream.ready;
  }

  async openStream(stream) {
    const connection = await this.connect();
    let response;
    try {
      response = await fetch(new URL("/api/event", connection.baseUrl), {
        headers: { ...connection.headers, accept: "text/event-stream" }, signal: stream.controller.signal,
      });
    } catch (cause) {
      this.connection = null;
      throw failure(`OpenCode service is unreachable: ${cause.cause?.code || cause.message}`);
    }
    if (!response.ok || !response.body) {
      if (response.status === 401) this.connection = null;
      throw failure(`OpenCode event stream returned HTTP ${response.status}`);
    }
    void this.readStream(stream, response.body);
  }

  async readStream(stream, body) {
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for await (const chunk of body) {
        buffer += decoder.decode(chunk, { stream: true });
        for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;
          let event;
          try { event = JSON.parse(line.slice(5)); } catch { continue; }
          try { this.dispatch(event); }
          catch (cause) { console.warn(`OpenCode event ${event?.type} was not applied: ${cause.message}`); }
        }
      }
    } catch { /* the stream ended; recovered below unless it was closed on purpose */ }
    if (this.stream !== stream) return;
    this.stream = null;
    this.connection = null;
    void this.recoverStream();
  }

  async recoverStream(attempt = 1) {
    const active = this.rawRecords().filter((record) => record.active);
    if (!active.length || this.stream) return;
    try {
      await this.ensureStream();
      for (const record of active) void this.catchUp(record);
    } catch (cause) {
      if (attempt < STREAM_RETRY_LIMIT) {
        setTimeout(() => void this.recoverStream(attempt + 1), 1000).unref?.();
        return;
      }
      for (const record of active) {
        this.publish(record, { type: "error", generationId: record.generation?.id || null, scope: "runtime",
          error: { code: "backend_unavailable", message: cause.message || String(cause) } });
        this.settle(record, "failed");
      }
    }
  }

  /** Bring a running turn up to date from saved messages, after a gap in the stream. */
  async catchUp(record) {
    const rows = await this.messageRows(record.sessionId, { limit: 100 }).catch(() => null);
    if (!rows || !record.active) return;
    this.syncMessages(record, rows);
    void this.refreshRequests(record);
    const latest = rows[0];
    if (latest?.type === "idle" && Number(latest.time?.created || 0) >= record.promptStartedAt) {
      this.settle(record, latest.outcome || "succeeded");
    }
  }

  async refreshRequests(record) {
    // A failed read is unknown, not empty: treating it as empty would resolve
    // every pending prompt.
    const [permissions, forms] = await Promise.all(["permission", "form"].map((kind) =>
      this.request("GET", `/session/${encodeURIComponent(record.sessionId)}/${kind}`).catch(() => null)));
    if (permissions && forms && record.active) this.syncRequests(record, [...permissions, ...forms]);
  }

  dispatch(event) {
    const type = String(event?.type || "");
    const data = event?.data || {};
    // Prompt events are reread rather than decoded: the lists are the record.
    if (/^(permission|form)\./.test(type)) {
      for (const record of this.rawRecords()) if (record.active) void this.refreshRequests(record);
      return;
    }
    const record = data.sessionID ? this.rawRecords().find((item) => item.sessionId === data.sessionID) : null;
    if (!record?.active) return;
    if (type.startsWith("session.execution.") && type !== "session.execution.started") {
      const outcome = type.slice("session.execution.".length);
      if (outcome === "failed" && data.error) this.publish(record, { type: "error", generationId: record.generation?.id || null,
        scope: "runtime", error: { code: "backend_unavailable", message: data.error.message || String(data.error) } });
      void this.finishTurn(record, outcome);
      return;
    }
    if (!data.assistantMessageID) return;
    const state = this.liveMessage(record, data.assistantMessageID, event.created);
    if (state.closed) return;
    const [, part, phase] = type.split(".");
    if (part === "text" || part === "reasoning") {
      const index = this.blockIndex(state, `${part}:${data.ordinal ?? 0}`, part);
      const current = state.text.get(index) || "";
      const delta = phase === "delta" ? String(data.delta || "")
        : phase === "ended" && String(data.text || "").startsWith(current) ? String(data.text).slice(current.length) : "";
      if (delta) this.appendText(record, state, index, delta);
    } else if (part === "tool") {
      this.applyTool(record, state, type.slice("session.tool.".length), data);
    } else if (part === "step" && (phase === "ended" || phase === "failed")) {
      void this.closeFromSaved(record, state, data);
    }
  }

  /** The live state of an assistant message, opened on first sight. */
  liveMessage(record, id, created) {
    let state = record.liveMessages.get(id);
    if (state) return state;
    state = { id, row: null, text: new Map(), kinds: new Map(), tools: new Map(), indexes: new Map(), closed: false };
    record.liveMessages.set(id, state);
    this.publish(record, messageOpen({ id, role: "assistant", generationId: record.generation?.id || null,
      answers: record.answering || null, timestamp: iso(created) }));
    return state;
  }

  // Blocks are numbered in the order they start, which is the order of the
  // saved message's content, so a saved message restates the same indexes.
  blockIndex(state, key, kind) {
    if (!state.indexes.has(key)) {
      state.indexes.set(key, state.indexes.size);
      state.kinds.set(state.indexes.size - 1, kind);
    }
    return state.indexes.get(key);
  }

  appendText(record, state, index, delta) {
    state.text.set(index, (state.text.get(index) || "") + delta);
    this.publish(record, { type: "assistant_content", phase: "delta", generationId: record.generation?.id || null,
      seq: ++record.generationSeq, messageId: state.id, contentIndex: index,
      blockKind: state.kinds.get(index) === "reasoning" ? "thinking" : "text", delta });
  }

  applyTool(record, state, phase, data) {
    const generationId = record.generation?.id || null;
    let tool = state.tools.get(data.id);
    if (!tool) {
      this.blockIndex(state, `tool:${data.id}`, "tool");
      tool = { id: data.id, name: data.name || "tool", input: data.input ?? null, output: "", status: "running", closed: false };
      state.tools.set(tool.id, tool);
      this.publish(record, toolOpen({ toolCallId: tool.id, name: tool.name, input: tool.input, messageId: state.id, generationId }));
      this.publish(record, { type: "tool_activity", phase: "start", generationId, seq: ++record.generationSeq,
        toolCallId: tool.id, name: tool.name, input: tool.input });
    }
    if (tool.closed) return;
    if (phase === "called") tool.input = data.input ?? tool.input;
    const output = contentText(data.content) || (data.error ? String(data.error.message || data.error) : "");
    if (output) tool.output = output;
    const done = phase === "success" || phase === "failed";
    if (!done && phase !== "called" && phase !== "progress") return;
    this.publish(record, { type: "tool_activity", phase: done ? "end" : "update", generationId, seq: ++record.generationSeq,
      toolCallId: tool.id, name: tool.name, input: tool.input, output: tool.output, isError: phase === "failed" });
    if (!done) return;
    tool.closed = true;
    tool.status = phase === "failed" ? "error" : "completed";
    this.publish(record, toolClose({ toolCallId: tool.id, output: tool.output, isError: phase === "failed", generationId }));
  }

  /** Close a finished step from its saved message, which is the record. */
  async closeFromSaved(record, state, data) {
    const row = await this.request("GET",
      `/session/${encodeURIComponent(record.sessionId)}/message/${encodeURIComponent(state.id)}`).catch(() => null);
    if (state.closed || !record.active) return;
    if (row?.content) state.row = row;
    this.closeLiveMessage(record, state.row || this.rowFromState(state, data), state);
  }

  /** What the stream showed of a message, for when its saved copy cannot be read. */
  rowFromState(state, { finish = null } = {}) {
    const content = [...state.kinds.entries()].sort(([a], [b]) => a - b).map(([index, kind]) => {
      if (kind !== "tool") return { type: kind, text: state.text.get(index) || "" };
      const tool = [...state.tools.values()].find((item) => state.indexes.get(`tool:${item.id}`) === index);
      return { type: "tool", id: tool?.id, name: tool?.name, state: { input: tool?.input ?? null } };
    });
    return { id: state.id, content, finish, time: {} };
  }

  async finishTurn(record, outcome) {
    const rows = await this.messageRows(record.sessionId, { limit: 100 }).catch(() => null);
    if (!record.active) return;
    if (rows) this.syncMessages(record, rows);
    this.settle(record, outcome);
  }

  syncMessages(record, rows) {
    for (const row of [...rows].reverse()) {
      if (row.type !== "assistant" || Number(row.time?.created || 0) < record.promptStartedAt) continue;
      const state = this.liveMessage(record, row.id, row.time?.created);
      if (state.closed) continue;
      state.row = row;
      for (const [index, part] of (row.content || []).entries()) {
        if (["text", "reasoning"].includes(part.type)) {
          state.kinds.set(index, part.type);
          const previous = state.text.get(index) || "";
          const current = String(part.text || "");
          const delta = current.startsWith(previous) ? current.slice(previous.length) : current;
          state.text.set(index, current);
          if (delta) this.publish(record, { type: "assistant_content", phase: "delta",
            generationId: record.generation?.id || null, seq: ++record.generationSeq,
            messageId: row.id, contentIndex: index, blockKind: part.type === "reasoning" ? "thinking" : "text", delta });
          continue;
        }
        if (part.type !== "tool") continue;
        const toolId = part.id || part.callID;
        let tool = state.tools.get(toolId);
        if (!tool) {
          tool = { id: toolId, name: part.name || part.tool || "tool", input: part.state?.input ?? null,
            output: "", status: "", closed: false };
          state.tools.set(toolId, tool);
          this.publish(record, toolOpen({ toolCallId: tool.id, name: tool.name, input: tool.input,
            messageId: row.id, generationId: record.generation?.id || null }));
          this.publish(record, { type: "tool_activity", phase: "start", generationId: record.generation?.id || null,
            seq: ++record.generationSeq, toolCallId: tool.id, name: tool.name, input: tool.input });
        }
        // A catch-up rereads every row; only a change is news.
        const output = toolOutput(part);
        const status = String(part.state?.status || "");
        if (tool.closed || (output === tool.output && status === tool.status)) continue;
        tool.output = output;
        tool.status = status;
        const done = ["completed", "error"].includes(status);
        this.publish(record, { type: "tool_activity", phase: done ? "end" : "update",
          generationId: record.generation?.id || null, seq: ++record.generationSeq,
          toolCallId: tool.id, name: tool.name, input: tool.input, output: tool.output,
          isError: part.state?.status === "error" });
        if (done && !tool.closed) {
          tool.closed = true;
          this.publish(record, toolClose({ toolCallId: tool.id, output: tool.output,
            isError: part.state?.status === "error", generationId: record.generation?.id || null }));
        }
      }
      if (row.time?.completed && !state.closed) this.closeLiveMessage(record, row, state);
    }
  }

  closeLiveMessage(record, row, state, finalStopReason = null) {
    state.closed = true;
    const blocks = (row.content || []).flatMap((part, index) => {
      if (part.type === "text") return [{ kind: "text", contentIndex: index, text: part.text || "" }];
      if (part.type === "reasoning") return [{ kind: "thinking", contentIndex: index, text: part.text || "" }];
      if (part.type === "tool") return [{ kind: "tool_call", contentIndex: index,
        toolCallId: part.id || part.callID, name: part.name || part.tool || "tool", input: part.state?.input ?? null }];
      return [];
    });
    const stopReason = finalStopReason || stopReasonOf(row) || "stop";
    this.publish(record, { type: "assistant_content", phase: "final", generationId: record.generation?.id || null,
      seq: ++record.generationSeq, messageId: row.id, stopReason, errorMessage: errorOf(row), blocks,
      provider: row.model?.providerID || null, model: modelSpec(row.model) || null, timestamp: iso(row.time?.created) });
    this.publish(record, messageClose({ messageId: row.id, stopReason, blocks,
      interim: stopReason === "toolUse", generationId: record.generation?.id || null,
      provider: row.model?.providerID || null, model: modelSpec(row.model) || null,
      timestamp: iso(row.time?.created), errorMessage: errorOf(row) }));
  }

  syncRequests(record, requests) {
    const current = new Set();
    for (const request of requests) {
      if (request.sessionID && request.sessionID !== record.sessionId) continue;
      const id = request.id || request.requestID;
      if (!id) continue;
      current.add(id);
      if (record.requests.has(id)) continue;
      const isForm = Array.isArray(request.questions) || request.type === "form";
      const question = request.questions?.[0];
      const options = isForm ? (question?.options || []).map((item) => ({ id: item.label, label: item.label }))
        : [{ id: "once", label: "Allow once" }, { id: "always", label: "Always allow" }, { id: "reject", label: "Reject" }];
      const host = { id, kind: options.length ? "select" : "confirm",
        title: question?.header || request.action || request.permission || "OpenCode permission",
        message: question?.question || request.description || request.action || "Allow this action?",
        options, placeholder: "", prefill: "", timeoutMs: null, nativeKind: isForm ? "form" : "permission" };
      record.requests.set(id, host);
      record.hostUiRequests.push(host);
      record.activity = "waiting_for_user";
      this.publish(record, { type: "permission_request", generationId: record.generation?.id || null,
        requestId: id, ...host });
    }
    for (const id of record.requests.keys()) {
      if (current.has(id)) continue;
      record.requests.delete(id);
      record.hostUiRequests = record.hostUiRequests.filter((item) => item.id !== id);
      this.publish(record, { type: "permission_resolved", generationId: record.generation?.id || null, requestId: id });
    }
  }

  settle(record, outcome) {
    if (!record.generation || record.generation.settled) return;
    // An interrupted or failed turn leaves its last message and tools open;
    // OpenCode never completes them, so they are closed here.
    const stopReason = outcome === "succeeded" ? "stop" : outcome === "failed" ? "error" : "aborted";
    for (const state of record.liveMessages.values()) {
      for (const tool of state.tools.values()) {
        if (tool.closed) continue;
        tool.closed = true;
        this.publish(record, toolClose({ toolCallId: tool.id, output: tool.output,
          isError: stopReason !== "stop", generationId: record.generation?.id || null }));
      }
      if (!state.closed) this.closeLiveMessage(record, state.row || this.rowFromState(state), state, stopReason);
    }
    record.active = false;
    record.stopping = false;
    record.activity = outcome === "failed" ? "failed" : "idle";
    Object.assign(record.generation, { closed: true, settled: true });
    this.publish(record, { type: "status", generationId: record.generation.id, phase: "settled",
      seq: ++record.generationSeq, status: record.activity, activity: record.activity, detail: null });
    this.emit("settled", { record, completed: outcome === "succeeded" });
    void this.request("GET", `/session/${encodeURIComponent(record.sessionId)}`).then((session) => {
      if (session?.title) this.emit("changed", { record, reason: "named", name: session.title });
    }).catch(() => {});
  }

  async cancel(id) {
    const record = this.get(id);
    if (!record?.active) return false;
    record.stopping = true;
    record.activity = "stopping";
    await this.request("POST", `/session/${encodeURIComponent(record.sessionId)}/interrupt`, { body: {} });
    return true;
  }

  async respondHostUi(id, response) {
    const record = this.get(id);
    const requestId = String(response?.id || response?.requestId || "");
    const request = record?.requests.get(requestId);
    if (!request) throw failure("OpenCode request is no longer pending", "host_ui_request_missing", 404);
    const rejected = response.cancelled || response.dismissed || response.confirmed === false
      || String(response.value || "").toLowerCase() === "reject";
    if (request.nativeKind === "form") {
      const route = `/session/${encodeURIComponent(record.sessionId)}/form/${encodeURIComponent(requestId)}`;
      if (rejected) await this.request("POST", `${route}/reply`, { body: { response: { type: "rejected" } } });
      else await this.request("POST", `${route}/reply`, { body: { response: { answers: [[String(response.value || "")]] } } });
    } else {
      await this.request("POST", `/session/${encodeURIComponent(record.sessionId)}/permission/${encodeURIComponent(requestId)}/reply`, {
        body: { reply: rejected ? "reject" : String(response.value || "once") },
      });
    }
    record.requests.delete(requestId);
    record.hostUiRequests = record.hostUiRequests.filter((item) => item.id !== requestId);
    this.publish(record, { type: "permission_resolved", generationId: record.generation?.id || null, requestId });
    return null;
  }

  async close(id) {
    const record = this.get(id);
    if (!record) return false;
    record.status = "stopped";
    record.active = false;
    this.sessions.remove(id);
    this.emit("removed", { id, chatId: record.chatId });
    return true;
  }

  async shutdown() {
    const records = this.rawRecords();
    await Promise.all(records.map((record) => this.close(record.id)));
    const stream = this.stream;
    this.stream = null;
    stream?.controller.abort();
    // The background service belongs to OpenCode and may serve its TUI and
    // other clients. Conduit never stops it.
    return records.length;
  }

  async listThreads({ cwd, limit = 60 } = {}) {
    const sessions = await this.request("GET", "/session", {
      ...(cwd ? { directory: cwd } : {}), query: { limit, order: "desc", roots: true },
    });
    return (sessions || []).map((session) => ({
      id: session.id, title: session.title || "Untitled OpenCode session", preview: "",
      cwd: session.location?.directory || session.directory || "",
      createdAt: iso(session.time?.created), updatedAt: iso(session.time?.updated || session.time?.idle || session.time?.created),
      status: session.outcome || "unknown", source: "opencode", replayFidelity: "full",
    })).filter((session) => session.id && (!cwd || session.cwd === cwd)).slice(0, limit);
  }

  listSessions(options) { return this.listThreads(options); }

  async messageRows(sessionId, { limit = 100, cursor = "" } = {}) {
    return await this.request("GET", `/session/${encodeURIComponent(sessionId)}/message`, {
      query: { limit, order: "desc", cursor },
    }) || [];
  }

  static transcript(rows) {
    const messages = [];
    const tools = [];
    let lastUser = null;
    for (const row of [...rows].reverse()) {
      if (row.type === "user") {
        const content = contentText(row.content);
        messages.push({ id: row.id, role: "user", content, timestamp: iso(row.time?.created) });
        lastUser = row.id;
        continue;
      }
      if (row.type !== "assistant") continue;
      const blocks = (row.content || []).flatMap((part) => {
        if (part.type === "text") return [{ kind: "text", text: part.text || "" }];
        if (part.type === "reasoning") return [{ kind: "thinking", text: part.text || "" }];
        if (part.type === "tool") {
          const toolCallId = part.id || part.callID;
          const input = part.state?.input ?? null;
          tools.push({ toolCallId, name: part.name || part.tool || "tool", input,
            output: toolOutput(part), isError: part.state?.status === "error",
            done: ["completed", "error"].includes(part.state?.status) });
          return [{ kind: "tool_call", toolCallId, name: part.name || part.tool || "tool", input }];
        }
        return [];
      });
      const text = blocks.filter((block) => block.kind === "text").map((block) => block.text).join("\n");
      const stopReason = stopReasonOf(row);
      messages.push({ id: row.id, role: "assistant", content: text, blocks, answers: lastUser,
        stopReason, interim: stopReason === "toolUse", timestamp: iso(row.time?.created),
        provider: row.model?.providerID || null, model: modelSpec(row.model) || null,
        ...(errorOf(row) ? { errorMessage: errorOf(row) } : {}) });
    }
    return { messages, tools };
  }

  async readTranscript({ liveSessionId, opaqueSession }) {
    const record = liveSessionId ? this.get(liveSessionId) : null;
    const sessionId = record?.sessionId || (typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId);
    if (!sessionId) return { messages: [], tools: [], page: { before: null } };
    const rows = await this.messageRows(sessionId, { limit: 100 });
    return { ...OpenCodeAdapter.transcript(rows), page: { before: null } };
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

  /** The models starred in OpenCode's TUI, in its order; the API has no route for them. */
  async favouriteModels() {
    try {
      const state = JSON.parse(await fs.readFile(path.join(stateRoot(), "opencode", "model.json"), "utf8"));
      return (Array.isArray(state.favorite) ? state.favorite : []).map(modelSpec).filter(Boolean);
    } catch { return []; }
  }

  async listAvailableModels(cwd) {
    const [all, favourites] = await Promise.all([this.request("GET", "/model", { directory: cwd }), this.favouriteModels()]);
    // Favourites are the catalogue when there are any; otherwise every model.
    const models = favourites.length
      ? favourites.map((spec) => (all || []).find((model) => modelSpec(model) === spec)).filter(Boolean)
      : all;
    return (models || []).map((model) => {
      const spec = modelSpec(model);
      const thinkingLevels = (Array.isArray(model.variants) ? model.variants : []).map((variant) => variant?.id).filter(Boolean);
      return { provider: model.providerID || "opencode", id: model.id || model.modelID, spec,
        label: model.name || spec, reasoning: thinkingLevels.length > 0,
        thinkingLevels, defaultThinkingLevel: model.variant || thinkingLevels[0] || "" };
    }).filter((model) => model.spec);
  }

  listModels(id) { return this.listAvailableModels(this.get(id)?.cwd); }
  listCommands() { return Promise.resolve([]); }
  listAvailableCommands() { return Promise.resolve([]); }
  async setModel(id, model, thinkingLevel = "") {
    const record = this.get(id);
    const selected = splitModel(model, thinkingLevel || record?.thinkingLevel);
    if (!record || !selected) throw failure("OpenCode model is invalid", "invalid_model", 400);
    await this.request("POST", `/session/${encodeURIComponent(record.sessionId)}/model`, { body: { model: selected } });
    record.model = model;
    record.thinkingLevel = selected.variant || "";
    return model;
  }
  async setThinkingLevel(id, thinkingLevel) {
    const record = this.get(id);
    await this.setModel(id, record.model, thinkingLevel);
    return record.thinkingLevel;
  }
  async getModelState(id) { const record = this.get(id); return { model: record?.model || "", thinkingLevel: record?.thinkingLevel || "" }; }

  async refreshContext(id) {
    const record = this.get(id);
    if (!record) return null;
    const session = await this.request("GET", `/session/${encodeURIComponent(record.sessionId)}`);
    const tokens = session.tokens?.input || 0;
    const contextUsage = { tokens, contextWindow: null, percentUsed: null };
    this.publish(record, { type: "usage", generationId: record.generation?.id || null,
      contextUsage, sessionStats: { cost: session.cost || 0 }, cacheStats: null });
    return contextUsage;
  }

  async compact(id) {
    const record = this.get(id);
    if (!record) throw failure("OpenCode session is not running");
    await this.request("POST", `/session/${encodeURIComponent(record.sessionId)}/compact`, { body: {} });
    return { compacted: true };
  }

  getCapabilities() { return OPENCODE_CAPABILITIES; }
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
