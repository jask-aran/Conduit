import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { getSessionInfo, getSessionMessages, listSessions, query, resolveSettings } from "@anthropic-ai/claude-agent-sdk";
import { parseAttachmentEnvelope } from "./attachment-envelope.js";
import { answerTo, isDismissal, questionRequest } from "./harnesses/questions.js";
import { SessionRecords } from "./harnesses/session-records.js";
import { messageClose, messageOpen, toolClose, toolKind, toolOpen, toolSubject, turnSettle } from "./harnesses/transcript-ops.js";
import { unsupported } from "./harnesses/unsupported.js";

// Claude Code's tools, by what they do.
const CLAUDE_TOOL_KINDS = Object.freeze({
  Bash: "command", BashOutput: "command", KillShell: "command", PowerShell: "command",
  Read: "read", Glob: "read", Grep: "read", LS: "read", NotebookRead: "read",
  Edit: "edit", MultiEdit: "edit", Write: "edit", NotebookEdit: "edit",
  WebSearch: "search", WebFetch: "fetch",
});
// What a call acted on. A search's pattern says more than the directory it
// searched, and an agent's description more than anything else it was handed.
const subjectOf = (input) => input && typeof input === "object"
  ? toolSubject(["command", "pattern", "query", "url", "file_path", "notebook_path", "path", "description"]
    .map((field) => input[field]).find((value) => value != null)) ?? undefined
  : undefined;
// The API's reasons a message stopped, in Conduit's.
const STOP_REASONS = Object.freeze({
  end_turn: "stop", stop_sequence: "stop", refusal: "stop", pause_turn: "stop", tool_use: "toolUse",
  max_tokens: "length", model_context_window_exceeded: "length",
});
const OUTCOMES = Object.freeze({ aborted: "interrupted", error: "failed" });
// An interrupt the CLI never answers with a result still ends the turn.
const INTERRUPT_SETTLE_MS = 5_000;
const INTERRUPTED = /^\[Request interrupted by user/;

export const CLAUDE_CODE_CAPABILITIES = Object.freeze({
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

// Claude Code's own modes, as it names them. Bypass is offered because the
// query is started allowing it; choosing it is still the user's call, per chat.
const PERMISSION_MODES = Object.freeze([
  { id: "default", label: "Default", description: "Ask before anything your settings do not already allow" },
  { id: "auto", label: "Auto mode", description: "A classifier approves or blocks each action instead of asking" },
  { id: "acceptEdits", label: "Accept edits", description: "Apply file edits without asking; still ask for commands" },
  { id: "plan", label: "Plan mode", description: "Research and plan without changing anything" },
  { id: "bypassPermissions", label: "Bypass permissions", description: "Run every tool without asking" },
]);
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
const APPROVE = "Allow";
const APPROVE_SESSION = "Allow for session";
const DENY = "Deny";

const failure = (message, code = "backend_unavailable", status = 409) =>
  Object.assign(new Error(message), { code, status });

const outputText = (content) => typeof content === "string" ? content : (Array.isArray(content) ? content : [])
  .map((item) => (item?.type === "text" ? item.text : "")).filter(Boolean).join("\n");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Conduit names a prompt `m_<uuid>` and Claude Code keeps the uuid it is handed,
// so the saved session names the prompt what the browser already calls it.
const promptId = (uuid) => `m_${uuid}`;

/** The installed CLI, found on PATH as a shell would; the SDK wants a path. */
function resolveCommand(command) {
  if (!command) return undefined;
  if (command.includes(path.sep)) return command;
  for (const directory of String(process.env.PATH || "").split(path.delimiter)) {
    const candidate = path.join(directory, command);
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* keep looking */ }
  }
  return undefined;
}

/** What Claude Code's settings say for a folder: model, effort, the mode a session starts in. */
const settingsFor = (cwd) => resolveSettings({ cwd }).then((resolved) => resolved?.effective || {}, () => ({}));

// `default` is an alias for one of the other rows, so the catalogue leaves it
// out and lists each model once, under its own name.
const catalogueRows = (models) => models.filter((model) => model.value !== "default");

/** The row a model name means: its own, or the one an alias or a full id resolves to. */
const modelSpec = (models, name) => {
  const rows = catalogueRows(models);
  if (rows.some((model) => model.value === name)) return name;
  const resolved = models.find((model) => model.value === name)?.resolvedModel || name;
  return rows.find((model) => model.resolvedModel === resolved)?.value || rows[0]?.value || name;
};

const effortLevels = (model) => (model?.supportsEffort ? model.supportedEffortLevels || [] : []);

/** The effort Claude Code would run a model at: that model's setting, then the general one. */
const effortFor = (model, settings) => {
  const levels = effortLevels(model);
  const wanted = settings.modelSettings?.[model?.resolvedModel]?.effortLevel || settings.effortLevel;
  return levels.includes(wanted) ? wanted : levels.includes("high") ? "high" : levels[0] || "";
};

const catalogue = (models, settings) => catalogueRows(models).map((model) => ({
  provider: "anthropic", id: model.value, spec: model.value, label: model.displayName || model.value,
  reasoning: effortLevels(model).length > 0, thinkingLevels: effortLevels(model),
  defaultThinkingLevel: effortFor(model, settings),
}));

/**
 * The modes this folder allows, the one its settings start in first -- which
 * is the one a chat shows before it has chosen. Auto mode also needs a model
 * that can run it.
 */
const permissionModes = (settings, model = null) => {
  const starts = settings.permissions?.defaultMode || "default";
  const refused = (id) => (id === "auto" && (settings.disableAutoMode === "disable" || model?.supportsAutoMode === false))
    || (id === "bypassPermissions" && settings.permissions?.disableBypassPermissionsMode === "disable");
  const modes = PERMISSION_MODES.map((mode) => ({ ...mode, allowed: !refused(mode.id) }));
  return [...modes.filter((mode) => mode.id === starts), ...modes.filter((mode) => mode.id !== starts)];
};

/** The prompt stream a resident query reads: one message per Conduit prompt. */
class InputQueue {
  constructor() { this.items = []; this.waiting = null; this.done = false; }

  push(item) {
    if (this.done) throw failure("Claude Code is not running");
    if (this.waiting) { const resolve = this.waiting; this.waiting = null; resolve({ value: item, done: false }); }
    else this.items.push(item);
  }

  end() {
    this.done = true;
    if (this.waiting) { const resolve = this.waiting; this.waiting = null; resolve({ value: undefined, done: true }); }
  }

  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift(), done: false });
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => { this.waiting = resolve; });
      },
      return: () => { this.end(); return Promise.resolve({ value: undefined, done: true }); },
    };
  }
}

// AskUserQuestion, asked as one. Claude Code always lets the user type their
// own answer, and a note on a choice reaches the model as an annotation.
const askRequest = (id, input) => questionRequest({ id, title: "Claude has a question", notes: true,
  questions: (input.questions || []).map((question, index) => ({
    id: String(index), header: question.header || "", prompt: question.question || "",
    multiSelect: Boolean(question.multiSelect), required: true,
    options: (question.options || []).map((option, optionIndex) => ({
      id: String(optionIndex), label: option.label, description: option.description || "",
      ...(option.preview ? { preview: { format: "markdown", text: option.preview } } : {}),
    })),
    freeform: { placeholder: "Something else" },
  })) });

// Its reply is the chosen labels, comma-joined, keyed by the question's text.
const askAnswer = (pending, response) => {
  if (isDismissal(response)) return { behavior: "deny", message: "The user dismissed the question." };
  const answers = {};
  const annotations = {};
  pending.host.questions.forEach((question, index) => {
    const text = pending.input.questions?.[index]?.question || question.prompt;
    const { options, freeform, note } = answerTo(response, question);
    const labels = [...options.map((option) => option.label), ...(freeform ? [freeform] : [])];
    if (labels.length) answers[text] = labels.join(", ");
    if (note) annotations[text] = { notes: note };
  });
  return { behavior: "allow", updatedInput: { ...pending.input, answers,
    ...(Object.keys(annotations).length ? { annotations } : {}) } };
};

const approvalAnswer = (pending, response) => {
  const choice = isDismissal(response) ? DENY : String(response?.value ?? response?.optionId ?? DENY);
  if (choice === APPROVE) return { behavior: "allow", updatedInput: pending.input };
  if (choice === APPROVE_SESSION) {
    return { behavior: "allow", updatedInput: pending.input, updatedPermissions: pending.suggestions || [] };
  }
  return { behavior: "deny", message: "The user denied this tool call." };
};

export class ClaudeCodeAdapter extends EventEmitter {
  constructor({ command = "claude", logs = null } = {}) {
    super();
    // Unfound, the SDK runs the Claude Code it ships with; either reads the
    // user's ~/.claude configuration, credentials and sessions.
    this.executable = resolveCommand(command);
    this.sessions = new SessionRecords({
      capabilities: CLAUDE_CODE_CAPABILITIES,
      backend: { protocol: "native_api", implementation: "claude-code", installationId: "host-claude-code" },
      extras: (record) => ({ thinkingLevel: record.thinkingLevel, permissionMode: record.permissionMode }),
      logs,
    });
    this.records = this.sessions.records;
    this.byChatId = this.sessions.byChatId;
    Object.assign(this, unsupported(CLAUDE_CODE_CAPABILITIES, { label: "Claude Code" }));
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

  /**
   * One resident Claude Code per chat, reading prompts as they are sent.
   *
   * A new session is given its id up front, so the chat can keep it before a
   * word is written; a saved one is resumed by it.
   */
  async start({ chatId, project, model = "", thinkingLevel = "", permissionMode = "", sessionId, resume = false }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    const record = this.sessions.add({
      id: crypto.randomUUID(), chatId, projectId: project?.id || null,
      cwd: project?.workingRoot, sessionId, status: "starting", ready: false,
      activity: "starting", active: false, stopping: false, model, thinkingLevel, permissionMode,
      generation: null, generationSeq: 0, clients: new Set(), events: [], hostUiRequests: [],
      requests: new Map(), steps: new Map(), stepOrder: [], step: null, tools: new Map(),
      commands: [], models: [], settings: {}, stderr: "",
    });
    record.settings = await settingsFor(record.cwd);
    // Only what the chat chose is passed, and the rest is left to the user's
    // own Claude Code settings and read back once it is up. The starting mode is
    // the exception: an SDK session starts in `default` whatever the settings
    // say, so the mode they name is passed on the chat's behalf.
    const startMode = permissionMode || permissionModes(record.settings)
      .find((mode) => mode.id === record.settings.permissions?.defaultMode && mode.allowed)?.id || "";
    record.input = new InputQueue();
    record.query = query({ prompt: record.input, options: {
      cwd: record.cwd,
      ...(this.executable ? { pathToClaudeCodeExecutable: this.executable } : {}),
      ...(resume ? { resume: sessionId } : { sessionId }),
      ...(model ? { model } : {}),
      ...(EFFORT_LEVELS.has(thinkingLevel) ? { effort: thinkingLevel } : {}),
      ...(startMode ? { permissionMode: startMode } : {}),
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      thinking: { type: "adaptive", display: "summarized" },
      canUseTool: (toolName, input, options) => this.canUseTool(record, toolName, input, options),
      stderr: (data) => { record.stderr = `${record.stderr}${data}`.slice(-8_192); },
    } });
    void this.consume(record);
    try {
      const init = await record.query.initializationResult();
      record.models = init.models || [];
      record.commands = init.commands || [];
      record.model = modelSpec(record.models, model || record.settings.model || "default");
      record.thinkingLevel = EFFORT_LEVELS.has(thinkingLevel) ? thinkingLevel
        : effortFor(record.models.find((item) => item.value === record.model), record.settings);
      record.permissionMode = init.current_permission_mode || startMode || "default";
      record.ready = true;
      record.status = "running";
      record.activity = "idle";
      this.emit("changed", { record, reason: "ready" });
      return record;
    } catch (cause) {
      await this.close(record.id);
      throw failure(record.stderr.trim() || cause.message || String(cause));
    }
  }

  create(options) { return this.start({ ...options, sessionId: crypto.randomUUID() }); }

  async restore(opaqueSession, options) {
    const sessionId = typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId;
    if (!sessionId) throw failure("Claude Code session identity is missing");
    // A chat made and never prompted has an id and nothing saved under it yet.
    const saved = await getSessionInfo(sessionId).catch(() => undefined);
    return this.start({ ...options, sessionId, resume: Boolean(saved) });
  }

  async consume(record) {
    let cause = null;
    try {
      for await (const message of record.query) this.message(record, message);
    } catch (error) { cause = error; }
    this.processExited(record, failure(record.stderr.trim() || cause?.message || "Claude Code exited"));
  }

  /** Claude Code's stream, in Conduit's words. Subagents' own traffic stays inside their tool. */
  message(record, message) {
    if (message.type === "system" && message.subtype === "init") {
      record.sessionId = message.session_id || record.sessionId;
      record.permissionMode = message.permissionMode || record.permissionMode;
      return;
    }
    if (!record.active || message.parent_tool_use_id) return;
    if (message.type === "stream_event") this.streamEvent(record, message.event);
    else if (message.type === "assistant") this.assistantMessage(record, message);
    else if (message.type === "user") this.toolResults(record, message.message?.content);
    else if (message.type === "system" && message.subtype === "local_command_output") {
      const step = this.openStep(record, message.uuid);
      this.appendText(record, step, step.blocks.length, "text", message.content || "");
    } else if (message.type === "result") this.finish(record, message);
  }

  /**
   * A step of the turn is one message from the model: what it thought, said
   * and called, in the order it did. It is named by the API's own message id,
   * which the saved session keeps, so a reload names it the same.
   */
  openStep(record, messageId) {
    const existing = record.steps.get(messageId);
    if (existing) return existing;
    const generationId = record.generation?.id || null;
    // A step the turn has moved on from was work towards the answer, not it.
    const previous = record.step;
    if (previous) this.publish(record, { type: "assistant_content", phase: "final", generationId,
      seq: ++record.generationSeq, messageId: previous.id, stopReason: "toolUse", errorMessage: null, blocks: this.blocksOf(previous) });
    const step = { id: messageId, blocks: [], json: [], stopReason: null, model: null, streamed: false };
    record.steps.set(messageId, step);
    record.stepOrder.push(step);
    record.step = step;
    this.publish(record, messageOpen({ id: step.id, role: "assistant", generationId,
      answers: record.answering || null, timestamp: new Date().toISOString() }));
    this.publish(record, { type: "assistant_content", phase: "start", generationId,
      seq: ++record.generationSeq, messageId: step.id });
    return step;
  }

  blocksOf(step) {
    return step.blocks.filter((block) => block && !(block.kind === "thinking" && !block.text && !block.redacted));
  }

  appendText(record, step, index, kind, delta) {
    const block = step.blocks[index] ||= kind === "thinking"
      ? { kind, contentIndex: index, text: "", redacted: false } : { kind, contentIndex: index, text: "" };
    block.text += delta;
    if (!delta) return;
    this.publish(record, { type: "assistant_content", phase: "delta", generationId: record.generation?.id || null,
      seq: ++record.generationSeq, messageId: step.id, contentIndex: index, blockKind: kind, delta });
  }

  streamEvent(record, event) {
    if (event.type === "message_start") {
      this.openStep(record, event.message.id).model = event.message.model || null;
      return;
    }
    const step = record.step;
    if (!step) return;
    if (event.type === "content_block_start") {
      step.streamed = true;
      const block = event.content_block || {};
      if (block.type === "text") this.appendText(record, step, event.index, "text", block.text || "");
      else if (block.type === "thinking") this.appendText(record, step, event.index, "thinking", block.thinking || "");
      else if (block.type === "redacted_thinking") step.blocks[event.index] = { kind: "thinking", contentIndex: event.index, text: "", redacted: true };
      else if (block.type === "tool_use") {
        step.blocks[event.index] = { kind: "tool_call", contentIndex: event.index, toolCallId: block.id, name: block.name, input: {} };
        step.json[event.index] = "";
      }
    } else if (event.type === "content_block_delta") {
      const delta = event.delta || {};
      if (delta.type === "text_delta") this.appendText(record, step, event.index, "text", delta.text || "");
      else if (delta.type === "thinking_delta") this.appendText(record, step, event.index, "thinking", delta.thinking || "");
      else if (delta.type === "input_json_delta" && step.json[event.index] != null) step.json[event.index] += delta.partial_json || "";
    } else if (event.type === "content_block_stop") {
      const block = step.blocks[event.index];
      if (block?.kind !== "tool_call") return;
      try { block.input = JSON.parse(step.json[event.index] || "{}"); } catch { /* the assistant message restates it */ }
      this.openTool(record, step, block);
    } else if (event.type === "message_delta") {
      step.stopReason = event.delta?.stop_reason || step.stopReason;
    }
  }

  /**
   * The model's message as Claude Code settled it, one block at a time. It
   * restates what streamed; what did not stream -- a synthetic error reply, a
   * tool whose input never finished arriving -- is stated from here.
   */
  assistantMessage(record, message) {
    const content = Array.isArray(message.message?.content) ? message.message.content : [];
    const step = this.openStep(record, message.message?.id || message.uuid);
    step.model ||= message.message?.model || null;
    step.stopReason = message.message?.stop_reason || step.stopReason;
    for (const block of content) {
      if (block.type === "tool_use") {
        let call = step.blocks.find((item) => item?.toolCallId === block.id);
        if (!call) step.blocks.push(call = { kind: "tool_call", contentIndex: step.blocks.length, toolCallId: block.id, name: block.name, input: {} });
        call.input = block.input ?? call.input;
        this.openTool(record, step, call);
      } else if (block.type === "text" && !step.streamed && block.text) {
        this.appendText(record, step, step.blocks.length, "text", block.text);
      }
    }
  }

  openTool(record, step, block) {
    if (record.tools.has(block.toolCallId)) return;
    const generationId = record.generation?.id || null;
    const tool = { id: block.toolCallId, name: block.name || "tool", input: block.input ?? null, output: "",
      closed: false, stepId: step.id, startedAt: new Date().toISOString() };
    tool.kind = toolKind(CLAUDE_TOOL_KINDS, tool.name);
    tool.subject = subjectOf(tool.input);
    record.tools.set(tool.id, tool);
    this.publish(record, toolOpen({ toolCallId: tool.id, name: tool.name, kind: tool.kind, subject: tool.subject, input: tool.input,
      messageId: step.id, generationId, timestamp: tool.startedAt }));
    this.publish(record, { type: "tool_activity", phase: "start", generationId,
      seq: ++record.generationSeq, toolCallId: tool.id, name: tool.name, kind: tool.kind, subject: tool.subject, input: tool.input });
    // The turn being painted places a running tool by its block, so the step
    // says it is calling one now, not when the turn ends.
    this.publish(record, { type: "assistant_content", phase: "final", generationId, seq: ++record.generationSeq,
      messageId: step.id, stopReason: "toolUse", errorMessage: null, blocks: this.blocksOf(step) });
  }

  toolResults(record, content) {
    for (const block of Array.isArray(content) ? content : []) {
      if (block?.type !== "tool_result") continue;
      const tool = record.tools.get(block.tool_use_id);
      if (!tool || tool.closed) continue;
      this.closeTool(record, tool, outputText(block.content), Boolean(block.is_error));
    }
  }

  closeTool(record, tool, output, isError) {
    const generationId = record.generation?.id || null;
    // A tool the user's stop cut short comes back as an error; it was stopped.
    const cancelled = isError && record.stopping;
    tool.closed = true;
    tool.output = output;
    tool.completedAt = new Date().toISOString();
    this.publish(record, { type: "tool_activity", phase: "end", generationId,
      seq: ++record.generationSeq, toolCallId: tool.id, name: tool.name, input: tool.input, output, isError: isError && !cancelled });
    this.publish(record, toolClose({ toolCallId: tool.id, output, isError, cancelled, completedAt: tool.completedAt, generationId }));
  }

  /** Every step the turn took, finished: the answer as the answer, the rest as the work before it. */
  closeSteps(record, stopReason, answer, errorMessage = null) {
    const last = record.stepOrder.at(-1);
    for (const step of record.stepOrder) {
      const ending = step === answer || step === last;
      const reason = ending ? stopReason : "toolUse";
      const blocks = this.blocksOf(step);
      this.publish(record, { type: "assistant_content", phase: "final", generationId: record.generation.id,
        seq: ++record.generationSeq, messageId: step.id, stopReason: reason, errorMessage: ending ? errorMessage : null, blocks,
        provider: "anthropic", model: step.model || null });
      this.publish(record, messageClose({ messageId: step.id, stopReason: reason, blocks, interim: step !== answer,
        generationId: record.generation.id, keepsPartial: CLAUDE_CODE_CAPABILITIES.interruptKeepsPartial,
        ...(step === answer ? { provider: "anthropic", model: step.model || null } : {}), errorMessage: ending ? errorMessage : null }));
    }
  }

  canUseTool(record, toolName, input, { signal, suggestions, title, displayName, description, decisionReason, toolUseID } = {}) {
    const requestId = toolUseID || crypto.randomUUID();
    const host = toolName === "AskUserQuestion" ? askRequest(requestId, input) : {
      id: requestId, kind: "select", title: title || `Claude wants to use ${displayName || toolName}`,
      message: toolName === "ExitPlanMode" ? String(input?.plan || "")
        : description || decisionReason || subjectOf(input) || toolName,
      options: suggestions?.length ? [APPROVE, APPROVE_SESSION, DENY] : [APPROVE, DENY],
      placeholder: "", prefill: "", timeoutMs: null,
    };
    return new Promise((resolve) => {
      record.requests.set(requestId, { host, input, suggestions, resolve });
      record.hostUiRequests.push(host);
      record.activity = "waiting_for_user";
      this.publish(record, { type: "permission_request", generationId: record.generation?.id || null, requestId, ...host });
      signal?.addEventListener("abort", () => {
        if (!record.requests.has(requestId)) return;
        this.resolveRequest(record, requestId);
        resolve({ behavior: "deny", message: "The request was cancelled." });
      }, { once: true });
    });
  }

  async respondHostUi(id, response) {
    const record = this.get(id);
    const requestId = String(response?.id || response?.requestId || "");
    const pending = record?.requests.get(requestId);
    if (!pending) throw failure("Claude Code request is no longer pending", "host_ui_request_missing", 404);
    this.resolveRequest(record, requestId);
    pending.resolve(pending.host.kind === "question" ? askAnswer(pending, response) : approvalAnswer(pending, response));
    return null;
  }

  resolveRequest(record, requestId) {
    record.requests.delete(requestId);
    record.hostUiRequests = record.hostUiRequests.filter((item) => item.id !== requestId);
    record.activity = record.active ? "working" : "idle";
    this.publish(record, { type: "permission_resolved", generationId: record.generation?.id || null, requestId });
  }

  cancelRequests(record) {
    for (const [requestId, pending] of [...record.requests]) {
      this.resolveRequest(record, requestId);
      pending.resolve({ behavior: "deny", message: "The turn was stopped.", interrupt: true });
    }
  }

  async prompt(id, message, options = {}) {
    const record = this.get(id);
    if (!record?.ready) throw failure("Claude Code session is not ready");
    if (record.active) throw failure("Claude Code session is busy", "generation_limit", 409);
    const generationId = crypto.randomUUID();
    const bare = String(options.clientUserMessageId || "").replace(/^m_/, "");
    const uuid = UUID.test(bare) ? bare : crypto.randomUUID();
    const userMessageId = options.clientUserMessageId || promptId(uuid);
    record.active = true;
    record.activity = "working";
    record.stopping = false;
    record.generation = { id: generationId, closed: false, settled: false };
    record.answering = userMessageId;
    record.promptText = parseAttachmentEnvelope(message).message;
    record.steps = new Map();
    record.stepOrder = [];
    record.step = null;
    record.tools.clear();
    this.publish(record, messageOpen({ id: userMessageId, role: "user", generationId,
      content: record.promptText, timestamp: new Date().toISOString() }));
    this.publish(record, { type: "status", generationId, phase: "started", seq: ++record.generationSeq,
      status: "working", activity: "working", detail: null });
    try {
      record.input.push({ type: "user", uuid, session_id: record.sessionId, parent_tool_use_id: null,
        message: { role: "user", content: [{ type: "text", text: record.promptText }] } });
    } catch (cause) { this.failPrompt(record, cause); throw cause; }
    return { generationId, attachmentIdentity: { messageId: userMessageId } };
  }

  finish(record, result = {}) {
    if (!record.active) return;
    const stopped = record.stopping;
    const failed = !stopped && (result.is_error || (result.subtype && result.subtype !== "success"));
    const last = record.stepOrder.at(-1);
    const reason = STOP_REASONS[last?.stopReason || result.stop_reason];
    const stopReason = stopped ? "aborted" : failed ? "error" : reason && reason !== "toolUse" ? reason : "stop";
    const errorMessage = failed ? ((result.errors || []).join("\n") || result.result || "Claude Code failed") : null;
    if (failed) this.publish(record, { type: "error", generationId: record.generation?.id || null, scope: "runtime",
      error: { code: "backend_unavailable", message: errorMessage } });
    // An ended turn answers nothing more: its prompts end with it.
    this.cancelRequests(record);
    for (const tool of record.tools.values()) {
      if (!tool.closed) this.closeTool(record, tool, tool.output, true);
    }
    // The answer is the last step, if it called nothing and said something.
    const spoke = Boolean(last) && !last.blocks.some((block) => block?.kind === "tool_call")
      && last.blocks.some((block) => block?.kind === "text" && block.text.trim());
    this.closeSteps(record, stopReason, spoke ? last : null, errorMessage);
    const outcome = OUTCOMES[stopReason] || "complete";
    this.publish(record, turnSettle({ promptId: record.answering, generationId: record.generation.id, outcome }));
    record.active = false;
    record.stopping = false;
    record.activity = stopReason === "error" ? "failed" : "idle";
    Object.assign(record.generation, { closed: true, settled: true });
    this.publish(record, { type: "status", generationId: record.generation.id, phase: "settled",
      seq: ++record.generationSeq, status: record.activity, activity: record.activity, detail: null });
    this.emit("settled", { record, completed: !stopped && !failed });
  }

  failPrompt(record, cause) {
    this.finish(record, { subtype: "error_during_execution", is_error: true, errors: [cause.message || String(cause)] });
  }

  async cancel(id) {
    const record = this.get(id);
    if (!record?.active) return false;
    const generation = record.generation;
    record.stopping = true;
    record.activity = "stopping";
    this.cancelRequests(record);
    try { await record.query.interrupt(); } catch { /* settled below either way */ }
    setTimeout(() => { if (record.active && record.generation === generation) this.finish(record); }, INTERRUPT_SETTLE_MS).unref?.();
    return true;
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

  async close(id) {
    const record = this.get(id);
    if (!record) return false;
    // Removed first, so the stream ending below reads as asked for.
    this.sessions.remove(id);
    this.cancelRequests(record);
    record.status = "stopped";
    record.active = false;
    record.input?.end();
    try { record.query?.close(); } catch { /* already gone */ }
    this.emit("removed", { id, chatId: record.chatId });
    return true;
  }

  async shutdown() {
    const records = this.rawRecords();
    await Promise.all(records.map((record) => this.close(record.id)));
    return records.length;
  }

  async listThreads({ cwd, limit = 60 } = {}) {
    const sessions = await listSessions({ ...(cwd ? { dir: cwd } : {}), limit: Math.min(Math.max(limit, 1), 100) });
    const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
    return sessions.map((session) => ({
      id: session.sessionId, title: session.customTitle || session.summary || session.firstPrompt || "Untitled Claude Code session",
      preview: session.firstPrompt || "", cwd: session.cwd || "", branch: session.gitBranch || null,
      createdAt: iso(session.createdAt), updatedAt: iso(session.lastModified),
      status: "unknown", source: "claude-code", replayFidelity: "full",
    })).filter((session) => session.id && (!cwd || session.cwd === cwd));
  }

  listSessions(options) { return this.listThreads(options); }

  /**
   * A saved session as a transcript, in the shape it was streamed in: each
   * model message a step of its words and the tools it called, the last one
   * that called nothing the answer. Claude Code saves one entry per block, so
   * entries are gathered back into their message by the API's id.
   */
  static transcript(history) {
    const messages = [];
    const tools = [];
    const toolsById = new Map();
    let prompt = null;
    let step = null;
    for (const entry of history) {
      if (entry.parent_tool_use_id) continue;
      const content = entry.message?.content;
      if (entry.type === "user") {
        const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
        const results = blocks.filter((block) => block?.type === "tool_result");
        for (const result of results) {
          const tool = toolsById.get(result.tool_use_id);
          if (tool) Object.assign(tool, { output: outputText(result.content), isError: Boolean(result.is_error), done: true });
        }
        if (results.length) continue;
        const text = blocks.filter((block) => block?.type === "text").map((block) => block.text).join("\n");
        if (!text.trim()) continue;
        if (INTERRUPTED.test(text)) { if (prompt) prompt.outcome = "interrupted"; continue; }
        prompt = { id: promptId(entry.uuid), role: "user", content: text, outcome: "complete" };
        messages.push(prompt);
        step = null;
      } else if (entry.type === "assistant") {
        const id = entry.message?.id || entry.uuid;
        if (!step || step.id !== id) {
          step = { id, role: "assistant", content: "", blocks: [], answers: prompt?.id || null,
            stopReason: "toolUse", interim: true, provider: "anthropic", model: entry.message?.model || null };
          messages.push(step);
        }
        for (const block of Array.isArray(content) ? content : []) {
          if (block.type === "text" && block.text) {
            step.blocks.push({ kind: "text", text: block.text });
            step.content = step.content ? `${step.content}\n${block.text}` : block.text;
          } else if (block.type === "thinking" && block.thinking) {
            step.blocks.push({ kind: "thinking", text: block.thinking });
          } else if (block.type === "tool_use") {
            step.blocks.push({ kind: "tool_call", toolCallId: block.id, name: block.name, input: block.input });
            const tool = { toolCallId: block.id, name: block.name, kind: toolKind(CLAUDE_TOOL_KINDS, block.name),
              subject: subjectOf(block.input), input: block.input, output: "", isError: false, done: false };
            tools.push(tool);
            toolsById.set(block.id, tool);
          }
        }
      }
    }
    // Each prompt's last step, if it called nothing, is its answer.
    const byPrompt = new Map();
    for (const message of messages) if (message.role === "assistant") byPrompt.set(message.answers, message);
    for (const message of messages) {
      if (message.role !== "user") continue;
      const last = byPrompt.get(message.id);
      if (!last || last.blocks.some((block) => block.kind === "tool_call")) continue;
      last.interim = false;
      last.stopReason = message.outcome === "interrupted" ? "aborted" : "stop";
    }
    return { messages: messages.filter((message) => message.role === "user" || message.blocks.length), tools };
  }

  async readTranscript({ liveSessionId, opaqueSession }) {
    const record = liveSessionId ? this.get(liveSessionId) : null;
    const sessionId = record?.sessionId || (typeof opaqueSession === "string" ? opaqueSession : opaqueSession?.threadId);
    if (!sessionId) return { messages: [], tools: [], page: { before: null } };
    const history = await getSessionMessages(sessionId).catch(() => []);
    return { ...ClaudeCodeAdapter.transcript(history), page: { before: null } };
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

  /**
   * Models without a chat open: a throwaway Claude Code asked and closed. It
   * loads no settings, so no hook of the user's runs to answer a model list;
   * the settings that say which effort each model runs at are read directly.
   */
  async listAvailableModels(cwd) {
    const input = new InputQueue();
    const probe = query({ prompt: input, options: {
      cwd, persistSession: false, settingSources: [],
      ...(this.executable ? { pathToClaudeCodeExecutable: this.executable } : {}),
    } });
    try {
      const [init, settings] = await Promise.all([probe.initializationResult(), settingsFor(cwd)]);
      return catalogue(init.models || [], settings);
    } finally { input.end(); try { probe.close(); } catch { /* already gone */ } }
  }

  listModels(id) {
    const record = this.get(id);
    if (record?.models?.length) return Promise.resolve(catalogue(record.models, record.settings));
    return this.listAvailableModels(record?.cwd);
  }

  listCommands(id) {
    return Promise.resolve((this.get(id)?.commands || []).map((command) => ({
      name: command.name, description: command.description || "", source: "claude-code",
    })));
  }

  listAvailableCommands() { return Promise.resolve([]); }

  async setModel(id, model) {
    const record = this.get(id);
    if (!record) throw failure("Claude Code session is not running");
    await record.query.setModel(model || undefined);
    record.model = modelSpec(record.models, model || record.settings.model || "default");
    return record.model;
  }

  async setThinkingLevel(id, thinkingLevel) {
    const record = this.get(id);
    if (!record) throw failure("Claude Code session is not running");
    if (!EFFORT_LEVELS.has(thinkingLevel)) throw failure(`Claude Code has no effort level ${thinkingLevel}`, "invalid_request", 400);
    await record.query.applyFlagSettings({ effortLevel: thinkingLevel });
    record.thinkingLevel = thinkingLevel;
    return record.thinkingLevel;
  }

  async getModelState(id) {
    const record = this.get(id);
    return { model: record?.model || "", thinkingLevel: record?.thinkingLevel || "" };
  }

  listPermissionModes(id) {
    const record = this.get(id);
    return Promise.resolve(permissionModes(record?.settings || {}, record?.models.find((item) => item.value === record.model)));
  }

  async listAvailablePermissionModes(cwd) { return permissionModes(await settingsFor(cwd)); }
  // Handed the mode the routes chose, as Codex and fx are, not its id.
  async setPermissionMode(id, mode) {
    const record = this.get(id);
    if (!record) throw failure("Claude Code session is not running");
    const modeId = mode?.id || String(mode || "");
    await record.query.setPermissionMode(modeId);
    record.permissionMode = modeId;
    return record.permissionMode;
  }

  getCapabilities() { return CLAUDE_CODE_CAPABILITIES; }
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
