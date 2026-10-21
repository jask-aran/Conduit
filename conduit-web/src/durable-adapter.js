import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { watchEvents } from "@earendil-works/pi-durable";
import { SessionRecords } from "./harnesses/session-records.js";
import { messageClose, messageOpen, toolClose, toolKind, toolOpen, toolSubject, turnSettle } from "./harnesses/transcript-ops.js";
import { applyTranscriptOps } from "./transcript-fold.js";
import { reduceActiveGeneration, snapshotActiveGeneration } from "./active-generation.js";
import { unsupported } from "./harnesses/unsupported.js";
import { ConduitIds, USER_ENTRY } from "./server/durable-runtime.js";

/**
 * Chats on Conduit's own runtime (pi-durable, see `server/durable-runtime.js`).
 *
 * pi-durable states everything as committed events on a conversation, and this
 * is the one place they become Conduit's vocabulary. Its record is the truth:
 * a reload folds its entries through the same op builders the live path uses,
 * so the two cannot describe a turn differently.
 *
 * Message identity is split by who knows it first. A prompt keeps the browser's
 * id, carried in its entry's data. An answer is named when it starts streaming,
 * which is before pi-durable has numbered its entry, so the name is written to
 * the conversation's `conduit.ids` document once the entry commits.
 */
export const DURABLE_CAPABILITIES = Object.freeze({
  history: "linear",
  fork: false,
  regenerate: false,
  steer: true,
  followUpQueue: true,
  cancel: true,
  compaction: true,
  thinkingLevels: true,
  modelSwitch: true,
  toolUse: true,
  approvals: false,
  permissionModes: false,
  usage: true,
  // The turn is folded as it is published, as Pi and the Test stream do, so a
  // reconnecting browser is restated the generation in progress.
  replay: true,
  attachments: false,
  interruptKeepsPartial: false,
});

const TOOL_KINDS = { bash: "command", read: "read", write: "edit", edit: "edit" };
const subjectOf = (name, args = {}) => toolSubject(name === "bash" ? args.command : args.path);
const STOP_REASONS = new Set(["stop", "toolUse", "length", "error", "aborted"]);

const failure = (message, code = "backend_unavailable", status = 409) => Object.assign(new Error(message), { code, status });
const textOf = (content) => (Array.isArray(content) ? content : [])
  .filter((part) => part?.type === "text").map((part) => part.text || "").join("");

/** An assistant message's blocks, in Conduit's names. */
function blocksOf(message) {
  return (message?.content || []).flatMap((part, contentIndex) => {
    if (part.type === "text") return [{ kind: "text", contentIndex, text: part.text || "" }];
    if (part.type === "thinking") return [{ kind: "thinking", contentIndex, text: part.thinking || "", redacted: Boolean(part.redacted) }];
    if (part.type === "toolCall") return [{ kind: "tool_call", contentIndex, toolCallId: part.id, name: part.name, input: part.arguments || {} }];
    return [];
  });
}

const stopReasonOf = (message) => (STOP_REASONS.has(message?.stopReason) ? message.stopReason : "stop");

function assistantClose(message, messageId, generationId = null) {
  const stopReason = stopReasonOf(message);
  return messageClose({ messageId, stopReason, interim: stopReason === "toolUse", generationId,
    blocks: blocksOf(message), keepsPartial: DURABLE_CAPABILITIES.interruptKeepsPartial,
    provider: message.provider || null, model: message.model || null,
    timestamp: message.timestamp ? new Date(message.timestamp).toISOString() : null,
    errorMessage: message.errorMessage || null });
}

/**
 * A conversation's entries as the ops that would have stated them live.
 *
 * `ids` maps entry ids to the names their answers were streamed under; an
 * answer the process died before naming is called after its entry. A prompt
 * is settled by what came after it: answered, cut off by a stop, or failed.
 */
export function entriesToOps(entries, ids = {}) {
  const ops = [];
  const calls = new Map();
  let prompt = null;
  let last = null;
  const settle = () => {
    if (!prompt) return;
    const outcome = last?.stopReason === "aborted" ? "interrupted" : last?.stopReason === "error" ? "failed" : "complete";
    ops.push(turnSettle({ promptId: prompt, outcome }));
    prompt = null;
  };
  for (const entry of entries) {
    if (entry.kind === USER_ENTRY) {
      settle();
      const data = entry.data || {};
      prompt = data.messageId || `u${entry.conversationId}-${entry.id}`;
      last = null;
      ops.push(messageOpen({ id: prompt, role: "user", content: data.text || textOf(entry.model?.[0]?.content),
        ...(data.timestamp ? { timestamp: data.timestamp } : {}) }));
    } else if (entry.kind === "pi.assistant") {
      const message = entry.model?.[0];
      if (!message) continue;
      const messageId = ids[entry.id] || `a${entry.conversationId}-${entry.id}`;
      ops.push(messageOpen({ id: messageId, role: "assistant", answers: prompt }));
      ops.push(assistantClose(message, messageId));
      for (const block of blocksOf(message)) {
        if (block.kind !== "tool_call") continue;
        calls.set(block.toolCallId, block);
        ops.push(toolOpen({ toolCallId: block.toolCallId, name: block.name, kind: toolKind(TOOL_KINDS, block.name),
          subject: subjectOf(block.name, block.input), input: block.input, messageId }));
      }
      last = message;
    } else if (entry.kind === "pi.tool-result") {
      const result = entry.model?.[0];
      if (!result || !calls.has(result.toolCallId)) continue;
      ops.push(toolClose({ toolCallId: result.toolCallId, output: textOf(result.content), isError: Boolean(result.isError),
        completedAt: result.timestamp ? new Date(result.timestamp).toISOString() : undefined }));
    }
  }
  settle();
  return ops;
}

export class DurableAdapter extends EventEmitter {
  constructor({ runtime, logs = null } = {}) {
    super();
    this.runtime = runtime;
    this.sessions = new SessionRecords({
      capabilities: DURABLE_CAPABILITIES,
      backend: { protocol: "native_api", implementation: "conduit-runtime", installationId: "conduit-runtime" },
      extras: (record) => ({ thinkingLevel: record.thinkingLevel }),
      logs,
    });
    this.records = this.sessions.records;
    this.byChatId = this.sessions.byChatId;
    Object.assign(this, unsupported(DURABLE_CAPABILITIES, { label: "Conduit runtime" }));
    // A store that exists may hold a turn the last process left running, and
    // it goes on now rather than when somebody next opens that chat.
    if (runtime?.exists()) {
      void runtime.open().then(() => this.reattach())
        .catch((error) => console.error("[conduit-runtime] could not open", error));
    }
  }

  get context() { return this.runtime.context; }

  /**
   * Take up again every chat with work in flight, so what a resumed turn says
   * reaches the chat's log and any page already open on it, rather than
   * waiting for somebody to open the chat.
   */
  async reattach() {
    const harness = this.runtime.harness;
    const { submissions } = await harness.inspect(this.context);
    for (const conversationId of new Set(submissions.map((submission) => submission.conversationId))) {
      const chatId = (await harness.snapshot(ConduitIds, conversationId, this.context))?.chatId;
      const conversation = chatId && !this.getByChatId(chatId) ? await harness.conversation(conversationId, this.context) : null;
      if (conversation) await this.start(conversation, { chatId }).catch((error) => console.warn("[conduit-runtime] could not reattach", chatId, error?.message || error));
    }
  }

  /** Which chat a conversation belongs to, kept beside it so a restart can find its way back. */
  async remember(conversation, chatId) {
    await conversation.commit(async (tx) => { (await tx.doc(ConduitIds, conversation.id)).chatId = chatId; }, this.context);
  }

  async launch(context, { model = "", thinkingLevel = "", forceModel = false } = {}) {
    const selected = (forceModel ? String(model).trim() : "") || String(context.chat.backend.model || "").trim();
    const level = (forceModel ? String(thinkingLevel).trim() : "")
      || String(context.chat.modelThinkingLevels?.[selected] || "").trim();
    const options = { chatId: context.chat.id, project: context.project, model: selected, thinkingLevel: level };
    const live = context.chat.backend.opaqueSession
      ? await this.restore(context.chat.backend.opaqueSession, options) : await this.create(options);
    return {
      live,
      mapping: {
        backend: { ...context.chat.backend, model: live.model, opaqueSession: String(live.conversationId) },
        ...(live.thinkingLevel ? { modelThinkingLevels: { ...(context.chat.modelThinkingLevels || {}), [live.model]: live.thinkingLevel } } : {}),
      },
      modelRecovery: null,
    };
  }

  async create(options) {
    const harness = await this.runtime.open();
    const fallback = await this.runtime.defaultModel();
    const spec = splitSpec(options.model) || (fallback && { provider: fallback.provider, modelId: fallback.modelId });
    const conversation = await harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
      ...(spec ? { model: spec } : {}),
      ...(options.thinkingLevel || fallback?.thinkingLevel ? { thinkingLevel: options.thinkingLevel || fallback.thinkingLevel } : {}),
      ...(options.project?.workingRoot ? { cwd: options.project.workingRoot } : {}),
    } }, this.context);
    await this.remember(conversation, options.chatId);
    return this.start(conversation, options);
  }

  async restore(opaqueSession, options) {
    const harness = await this.runtime.open();
    const conversation = await harness.conversation(Number(opaqueSession), this.context);
    if (!conversation) throw failure("This chat's conversation is missing from the Conduit runtime", "session_not_found", 404);
    if ((await harness.snapshot(ConduitIds, conversation.id, this.context))?.chatId !== options.chatId) {
      await this.remember(conversation, options.chatId);
    }
    const record = await this.start(conversation, options);
    const spec = splitSpec(options.model);
    if (spec && spec.modelId !== record.modelId) await this.setModel(record.id, options.model);
    return record;
  }

  async start(conversation, { chatId, project }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    const record = this.sessions.add({
      id: crypto.randomUUID(), chatId, projectId: project?.id || null, conversationId: conversation.id, conversation,
      status: "running", activity: "idle", active: false, stopping: false, generation: null, generationSeq: 0,
      clients: new Set(), events: [], hostUiRequests: [], activeGeneration: null,
      model: "", modelId: "", provider: "", thinkingLevel: "", contextWindow: 0,
      // What the turn in progress has named: its prompts by submission, the
      // answer being written, and the tools it has open.
      prompts: new Map(), turn: null, usage: null, queue: [],
      // Prompt text by message id, for the queue strip, and prompts placed
      // before the run that answers them has said it started.
      texts: new Map(), unopened: new Map(), closedEntries: new Set(),
    });
    await this.readAgent(record);
    const stream = await watchEvents(this.runtime.harness, conversation.id, this.context);
    record.scope.defer(() => stream.stop());
    // A run the last process left going is still going; this is where it is picked up.
    if (stream.snapshot.run) await this.resumeTurn(record, stream.snapshot);
    record.usage = stream.snapshot.usage;
    stream.start(async (events) => { for (const event of events) await this.translate(record, event); });
    return record;
  }

  async readAgent(record) {
    const agent = await record.conversation.agent(this.context);
    const model = agent.model;
    record.provider = model?.provider || "";
    record.modelId = model?.id || "";
    record.model = model ? `${model.provider}/${model.id}` : "";
    record.thinkingLevel = agent.thinkingLevel || "";
    record.contextWindow = model?.contextWindow || 0;
  }

  /** Which prompt each queued input is: the browser's id travels as the request id. */
  async promptIdsFor(record, inputs) {
    const harness = this.runtime.harness;
    const ids = [];
    for (const input of inputs || []) {
      if (record.prompts.has(input)) { ids.push(record.prompts.get(input)); continue; }
      const submission = await harness.submission(input, this.context);
      const id = (await submission?.status(this.context))?.requestId || `s${input}`;
      record.prompts.set(input, id);
      ids.push(id);
    }
    return ids;
  }

  /**
   * A run the last process was in the middle of: its prompts are looked up
   * again, the tools it had going are taken as open, and the turn is stated as
   * started, so a page attached now draws it as working.
   */
  async resumeTurn(record, snapshot) {
    const turn = this.beginTurn(record, snapshot.run.inputs);
    turn.prompts = await this.promptIdsFor(record, snapshot.run.inputs);
    turn.answers = turn.prompts.at(-1) || null;
    turn.opened = new Set(turn.prompts);
    for (const slot of snapshot.tools || []) {
      if (slot.callId && slot.status !== "done") turn.tools.set(slot.callId, { messageId: null, name: slot.name, input: {}, opened: true, output: slot.output || "" });
    }
    this.publish(record, { type: "status", generationId: turn.generationId, phase: "started", seq: ++record.generationSeq,
      status: "working", activity: "working", detail: null });
    this.publish(record, { type: "status", generationId: turn.generationId, phase: "running", seq: ++record.generationSeq,
      status: "working", activity: "working", detail: null });
  }

  beginTurn(record, inputs, generationId = crypto.randomUUID()) {
    record.active = true;
    record.activity = "working";
    record.generation = { id: generationId, closed: false, settled: false };
    record.turn = { generationId, inputs: [...(inputs || [])], prompts: [], answers: null, messageId: null, tools: new Map(), last: null };
    return record.turn;
  }

  async prompt(id, message, options = {}) {
    const record = this.get(id);
    if (!record) throw failure("No Conduit runtime session", "backend_unavailable", 404);
    if (record.active) throw failure("Conduit runtime session is busy", "generation_limit", 409);
    const messageId = options.clientUserMessageId || crypto.randomUUID();
    const turn = this.beginTurn(record, []);
    turn.prompts = [messageId];
    turn.answers = messageId;
    this.publish(record, messageOpen({ id: messageId, role: "user", generationId: turn.generationId,
      content: message, timestamp: new Date().toISOString() }));
    this.publish(record, { type: "status", generationId: turn.generationId, phase: "started", seq: ++record.generationSeq,
      status: "working", activity: "working", detail: null,
      ...(options.continuationBase ? { continuation: true, continuationBase: String(options.continuationBase) } : {}) });
    turn.opened = new Set([messageId]);
    await this.submit(record, message, messageId);
    return turn.generationId;
  }

  async submit(record, text, messageId, whenBusy) {
    const submission = await record.conversation.submit({
      type: "input", content: text, requestId: messageId, ...(whenBusy ? { whenBusy } : {}),
      entry: { kind: USER_ENTRY, data: { messageId, text, timestamp: new Date().toISOString() } },
    }, this.context);
    record.prompts.set(submission.id, messageId);
    record.texts.set(messageId, text);
    return submission;
  }

  /** One committed event, in Conduit's words. */
  async translate(record, event) {
    switch (event.type) {
      case "run_start": {
        const turn = record.turn?.inputs.length === 0 && record.active ? record.turn : this.beginTurn(record, event.inputs);
        turn.inputs = [...event.inputs];
        const prompts = await this.promptIdsFor(record, event.inputs);
        if (!turn.prompts.length) {
          turn.prompts = prompts;
          turn.answers = prompts.at(-1) || null;
          turn.opened ||= new Set();
          for (const promptId of prompts) {
            const data = record.unopened.get(promptId);
            if (!data || turn.opened.has(promptId)) continue;
            record.unopened.delete(promptId);
            turn.opened.add(promptId);
            this.publish(record, messageOpen({ id: promptId, role: "user", generationId: turn.generationId,
              content: data.text || "", ...(data.timestamp ? { timestamp: data.timestamp } : {}) }));
          }
          this.publish(record, { type: "status", generationId: turn.generationId, phase: "started", seq: ++record.generationSeq,
            status: "working", activity: "working", detail: null });
        }
        this.publish(record, { type: "status", generationId: turn.generationId, phase: "running", seq: ++record.generationSeq,
          status: "working", activity: "working", detail: null });
        break;
      }
      case "entry_appended":
        await this.placed(record, event.entry);
        break;
      case "message_start":
        if (event.message?.role === "assistant") this.openAnswer(record);
        break;
      case "message_update":
        this.paint(record, event.changes);
        break;
      case "message_end":
        await this.placed(record, event.entry);
        break;
      case "tool_execution_start": this.toolStarted(record, event); break;
      case "tool_execution_update": this.toolProgress(record, event); break;
      case "tool_execution_end": this.toolEnded(record, event); break;
      case "inbox_update": this.publishQueue(record, event.items); break;
      case "usage_changed":
        record.usage = event.usage;
        this.publishUsage(record);
        break;
      case "agent_changed":
        await this.readAgent(record);
        break;
      case "compaction_start":
        this.publish(record, { type: "compaction", generationId: record.generation?.id || null, active: true });
        break;
      case "compaction_end":
        this.publish(record, { type: "compaction", generationId: record.generation?.id || null, active: false,
          ...(event.error ? { error: event.error } : {}) });
        break;
      case "auto_retry_start":
        this.publish(record, { type: "retry", generationId: record.generation?.id || null, phase: "start",
          attempt: event.attempt, delayMs: Math.max(0, event.at - Date.now()), errorMessage: event.errorMessage });
        break;
      case "auto_retry_end":
        this.publish(record, { type: "retry", generationId: record.generation?.id || null, phase: "end", attempt: event.attempt });
        break;
      case "run_end": this.finish(record); break;
      case "submission": this.submissionChanged(record, event.record); break;
      default: break;
    }
  }

  /** A prompt entering the transcript mid-run is a steer or a follow-up the run took. */
  async placed(record, entry) {
    if (entry?.kind === USER_ENTRY) {
      const turn = record.turn;
      const messageId = entry.data?.messageId;
      if (!messageId || turn?.opened?.has(messageId)) return;
      // Placed before its run started: the run opens it (see run_start).
      if (!turn || !turn.inputs.length) { record.unopened.set(messageId, entry.data); return; }
      turn.opened ||= new Set();
      turn.opened.add(messageId);
      this.closeAnswer(record);
      // The prompt the turn moves on from is answered now.
      for (const promptId of turn.prompts) this.publish(record, turnSettle({ promptId, outcome: "complete", generationId: turn.generationId }));
      this.publish(record, messageOpen({ id: messageId, role: "user", generationId: turn.generationId,
        content: entry.data.text || "", ...(entry.data.timestamp ? { timestamp: entry.data.timestamp } : {}) }));
      turn.prompts = [messageId];
      turn.answers = messageId;
      return;
    }
    if (entry?.kind !== "pi.assistant" || record.closedEntries.has(entry.id)) return;
    const turn = record.turn;
    const message = entry.model?.[0];
    if (!turn || !message) return;
    record.closedEntries.add(entry.id);
    const messageId = turn.messageId || this.openAnswer(record);
    turn.messageId = null;
    turn.last = message;
    const blocks = blocksOf(message);
    this.publish(record, { type: "assistant_content", generationId: turn.generationId, phase: "final",
      seq: ++record.generationSeq, messageId, stopReason: stopReasonOf(message), errorMessage: message.errorMessage || null, blocks });
    this.publish(record, assistantClose(message, messageId, turn.generationId));
    for (const block of blocks) {
      if (block.kind !== "tool_call" || turn.tools.has(block.toolCallId)) continue;
      turn.tools.set(block.toolCallId, { messageId, name: block.name, input: block.input, opened: false });
    }
    await record.conversation.commit(async (tx) => {
      (await tx.doc(ConduitIds, record.conversationId)).messages[entry.id] = messageId;
    }, this.context).catch((error) => console.warn("[conduit-runtime] could not keep a message id", error?.message || error));
  }

  openAnswer(record) {
    const turn = record.turn;
    if (!turn) return null;
    if (turn.messageId) return turn.messageId;
    turn.messageId = `m_${crypto.randomUUID()}`;
    this.publish(record, messageOpen({ id: turn.messageId, role: "assistant", generationId: turn.generationId, answers: turn.answers }));
    this.publish(record, { type: "assistant_content", generationId: turn.generationId, phase: "start",
      seq: ++record.generationSeq, messageId: turn.messageId });
    return turn.messageId;
  }

  /** An answer still open when a steer lands is given up: nothing was committed into it. */
  closeAnswer(record) {
    const turn = record.turn;
    if (!turn?.messageId) return;
    this.publish(record, messageClose({ messageId: turn.messageId, stopReason: "toolUse", interim: true, generationId: turn.generationId, blocks: [] }));
    turn.messageId = null;
  }

  paint(record, changes = []) {
    const turn = record.turn;
    if (!turn) return;
    const messageId = turn.messageId || this.openAnswer(record);
    for (const change of changes) {
      const blockKind = change.type.startsWith("thinking") ? "thinking" : change.type.startsWith("toolcall") ? "tool_call" : "text";
      const delta = change.type.endsWith("_delta") ? change.delta
        : change.type.endsWith("_start") ? (change.block?.text || change.block?.thinking || "") : "";
      if (!delta) continue;
      this.publish(record, { type: "assistant_content", generationId: turn.generationId, phase: "delta",
        seq: ++record.generationSeq, messageId, contentIndex: change.contentIndex, blockKind, delta });
    }
  }

  toolStarted(record, event) {
    const turn = record.turn;
    if (!turn || event.parentToolCallId) return;
    const known = turn.tools.get(event.toolCallId) || { messageId: null, name: event.toolName, input: event.args };
    const kind = toolKind(TOOL_KINDS, event.toolName);
    const subject = subjectOf(event.toolName, event.args);
    turn.tools.set(event.toolCallId, { ...known, opened: true, output: "" });
    this.publish(record, toolOpen({ toolCallId: event.toolCallId, name: event.toolName, kind, subject, input: event.args,
      messageId: known.messageId, generationId: turn.generationId }));
    this.publish(record, { type: "tool_activity", phase: "start", generationId: turn.generationId, seq: ++record.generationSeq,
      toolCallId: event.toolCallId, name: event.toolName, kind, ...(subject ? { subject } : {}), input: event.args });
  }

  toolProgress(record, event) {
    const tool = record.turn?.tools.get(event.toolCallId);
    if (!tool || !event.output) return;
    if ("set" in event.output) tool.output = event.output.set;
    else tool.output = tool.output.slice(event.output.trimStart || 0) + (event.output.append || "");
    this.publish(record, { type: "tool_activity", phase: "update", generationId: record.turn.generationId, seq: ++record.generationSeq,
      toolCallId: event.toolCallId, name: event.toolName, output: tool.output });
  }

  toolEnded(record, event) {
    const turn = record.turn;
    const result = event.entry?.model?.[0];
    // A call the last process started ends here: its row was opened then, and closes now.
    const tool = turn?.tools.get(event.toolCallId) || (turn && result && !event.parentToolCallId ? { opened: true, output: "" } : null);
    if (!tool?.opened) return;
    const output = result ? textOf(result.content) : tool.output || "";
    const cancelled = record.stopping && !result;
    const isError = !cancelled && (result ? Boolean(result.isError) : true);
    tool.opened = false;
    this.publish(record, { type: "tool_activity", phase: "end", generationId: turn.generationId, seq: ++record.generationSeq,
      toolCallId: event.toolCallId, name: event.toolName, output, isError });
    this.publish(record, toolClose({ toolCallId: event.toolCallId, output, isError, cancelled, generationId: turn.generationId }));
  }

  finish(record) {
    const turn = record.turn;
    if (!turn) return;
    // A stop between commits leaves an answer named and never written.
    if (turn.messageId) {
      this.publish(record, messageClose({ messageId: turn.messageId, stopReason: record.stopping ? "aborted" : "error",
        generationId: turn.generationId, blocks: [] }));
      turn.messageId = null;
    }
    for (const [toolCallId, tool] of turn.tools) {
      if (tool.opened) this.publish(record, toolClose({ toolCallId, output: tool.output || "", cancelled: true, generationId: turn.generationId }));
    }
    const stopped = record.stopping || turn.last?.stopReason === "aborted";
    const outcome = stopped ? "interrupted" : turn.last?.stopReason === "error" || !turn.last ? "failed" : "complete";
    for (const promptId of turn.prompts) this.publish(record, turnSettle({ promptId, outcome, generationId: turn.generationId }));
    record.turn = null;
    record.active = false;
    record.stopping = false;
    record.activity = "idle";
    Object.assign(record.generation, { closed: true, settled: true });
    this.publish(record, { type: "status", generationId: turn.generationId, seq: ++record.generationSeq,
      phase: stopped ? "stopped" : "settled", status: "idle", activity: "idle", detail: null });
    this.publishUsage(record);
    this.emit("settled", { record, completed: outcome === "complete" });
  }

  /** A prompt refused before any run took it -- a model error before the first request, say. */
  submissionChanged(record, submission) {
    if (submission?.status !== "unanswered" || record.turn?.inputs.length) return;
    const turn = record.turn;
    if (!turn || !turn.prompts.includes(submission.requestId)) return;
    this.publish(record, { type: "error", generationId: turn.generationId, scope: "runtime", code: "backend_unavailable",
      message: submission.detail || submission.reason || "The Conduit runtime could not answer this prompt" });
    this.finish(record);
  }

  async cancel(id) {
    const record = this.get(id);
    if (!record?.active) return null;
    record.stopping = true;
    record.activity = "stopping";
    this.publish(record, { type: "status", generationId: record.generation?.id || null, phase: "stopping", seq: ++record.generationSeq,
      status: "stopping", activity: "stopping", detail: null });
    await record.conversation.abort(this.context);
    // A run that never started has no run_end to settle it.
    if (record.turn && !record.turn.inputs.length) this.finish(record);
    return null;
  }

  async queue(id, type, message, options = {}) {
    const record = this.get(id);
    if (!record) throw failure("No Conduit runtime session", "backend_unavailable", 404);
    const messageId = options.messageId || crypto.randomUUID();
    await this.submit(record, message, messageId, type === "steer" ? "steer" : "followUp");
    return { attachmentIdentity: { afterMessageId: messageId, ordinal: 0 } };
  }

  async clearQueue(id) {
    const record = this.get(id);
    if (!record) throw failure("No Conduit runtime session", "backend_unavailable", 404);
    const harness = this.runtime.harness;
    const steering = [];
    const followUp = [];
    const discardedMessageIds = [];
    for (const item of record.queue) {
      const submission = await harness.submission(item.id, this.context);
      await submission?.abort(this.context);
      const messageId = record.prompts.get(item.id);
      if (messageId) discardedMessageIds.push(messageId);
      (item.mode === "steer" ? steering : followUp).push(item.text || "");
    }
    return { steering, followUp, discardedAttachmentIdentities: [], discardedMessageIds };
  }

  async publishQueue(record, items) {
    record.queue = [];
    for (const item of items || []) {
      const [messageId] = await this.promptIdsFor(record, [item.id]);
      record.queue.push({ id: item.id, mode: item.mode, text: record.texts.get(messageId) || "" });
    }
    this.publish(record, { type: "queue_state", generationId: record.generation?.id || null, queue: this.queueView(record) });
  }

  queueView(record) {
    return { steering: record.queue.filter((item) => item.mode === "steer").map((item) => item.text),
      followUp: record.queue.filter((item) => item.mode !== "steer").map((item) => item.text) };
  }

  async close(id) {
    const record = this.get(id);
    if (!record) return null;
    this.sessions.remove(id);
    return null;
  }

  async listAvailableModels() {
    const models = await this.runtime.availableModels();
    return models.map((model) => {
      const levels = model.reasoning ? getSupportedThinkingLevels(model) : [];
      return { provider: model.provider, id: model.id, spec: `${model.provider}/${model.id}`, label: model.name || model.id,
        reasoning: Boolean(model.reasoning), thinkingLevels: levels, defaultThinkingLevel: levels.includes("medium") ? "medium" : levels[0] || "",
        contextWindow: model.contextWindow || null };
    });
  }

  listModels() { return this.listAvailableModels(); }
  listCommands() { return Promise.resolve([]); }
  listAvailableCommands() { return Promise.resolve([]); }

  async setModel(id, model) {
    const record = this.get(id);
    const spec = splitSpec(model);
    if (!record || !spec) return record?.model || "";
    await record.conversation.configure({ model: spec }, this.context);
    await this.readAgent(record);
    return record.model;
  }

  async setThinkingLevel(id, level) {
    const record = this.get(id);
    if (!record) return "";
    await record.conversation.configure({ thinkingLevel: String(level || "") || null }, this.context);
    await this.readAgent(record);
    return record.thinkingLevel;
  }

  async getModelState(id) {
    const record = this.get(id);
    return { model: record?.model || "", thinkingLevel: record?.thinkingLevel || "" };
  }

  async compact(id) {
    const record = this.get(id);
    if (!record) throw failure("No Conduit runtime session", "backend_unavailable", 404);
    const taskId = await record.conversation.compact(undefined, this.context);
    const { outcome } = (await this.runtime.harness.waitForTask(taskId, this.context)).state;
    return { compacted: outcome?.status === "completed" };
  }

  contextUsage(record) {
    const models = record?.usage?.models || {};
    const latest = record?.model ? models[record.model] : null;
    // What the next request will carry is roughly what the last one did: input, cache and its answer.
    const tokens = record?.lastContextTokens || (latest ? 0 : 0);
    const contextWindow = record?.contextWindow || 0;
    return { tokens, contextWindow, percentUsed: contextWindow ? Math.round((tokens / contextWindow) * 100) : 0,
      ...(latest ? { cost: latest.cost?.total || 0 } : {}) };
  }

  publishUsage(record) {
    const message = record.turn?.last;
    if (message?.usage) record.lastContextTokens = (message.usage.input || 0) + (message.usage.cacheRead || 0) + (message.usage.output || 0);
    this.publish(record, { type: "usage", generationId: record.generation?.id || null, contextUsage: this.contextUsage(record) });
  }

  async refreshContext(id) {
    const record = this.get(id);
    if (!record) return null;
    this.publishUsage(record);
    return this.contextUsage(record);
  }

  async readTranscript({ liveSessionId, opaqueSession }) {
    const record = liveSessionId ? this.get(liveSessionId) : null;
    const conversationId = record?.conversationId ?? Number(opaqueSession);
    if (!Number.isInteger(conversationId)) return { messages: [], tools: [], page: { before: null } };
    const harness = await this.runtime.open();
    const conversation = record?.conversation || await harness.conversation(conversationId, this.context);
    if (!conversation) return { messages: [], tools: [], page: { before: null } };
    const entries = [];
    let cursor;
    do {
      const page = await conversation.entries({ order: "ascending" }, 500, cursor, this.context);
      entries.push(...page.items);
      cursor = page.next;
    } while (cursor);
    const ids = (await harness.snapshot(ConduitIds, conversationId, this.context))?.messages || {};
    const { messages, tools } = applyTranscriptOps({}, entriesToOps(entries, ids));
    // An answer still being written is the live stream's, not the reload's.
    return { messages: messages.filter((message) => !message.streaming), tools, page: { before: null } };
  }

  async readHistory(options) {
    const { messages } = await this.readTranscript(options);
    let child = null;
    let leafId = null;
    for (const message of [...messages].reverse()) {
      const node = { entry: { id: message.id, parentId: null, timestamp: message.timestamp || null, type: "message",
        display: `${message.role}: ${String(message.content || "").replace(/\s+/g, " ").trim().slice(0, 240)}`,
        kind: message.role, hidden: false, forkable: false, regeneratable: false }, children: child ? [child] : [] };
      if (child) child.entry.parentId = node.entry.id;
      else leafId = node.entry.id;
      child = node;
    }
    return { mode: "linear", leafId, tree: child ? [child] : [] };
  }

  replay(id) {
    const record = this.get(id);
    return record?.activeGeneration
      ? { type: "generation_replay", generationId: record.activeGeneration.id,
        seq: record.activeGeneration.lastSeq, generation: snapshotActiveGeneration(record.activeGeneration) }
      : this.sessions.runtimeState(record);
  }

  attach(id, socket) {
    const replayed = this.sessions.attach(id, socket);
    const resume = this.replay(id);
    return resume?.type === "generation_replay" ? resume : replayed;
  }

  publish(record, event) {
    const stamped = this.sessions.publish(record, event);
    record.activeGeneration = reduceActiveGeneration(record.activeGeneration, stamped);
    return stamped;
  }

  view(record) {
    return { ...this.sessions.view(record), hostUiRequests: [], queue: this.queueView(record || { queue: [] }),
      contextUsage: this.contextUsage(record) };
  }

  getCapabilities() { return DURABLE_CAPABILITIES; }
  toClientEvent(event) { return event; }
  waitForSession() { return Promise.resolve(); }
  setFrameInterval(_id, socket, ms) { return this.sessions.setFrameInterval(socket, ms); }
  get(id) { return this.sessions.get(id); }
  getByChatId(chatId) { return this.sessions.getByChatId(chatId); }
  rawRecords() { return this.sessions.rawRecords(); }
  list() { return this.sessions.list(); }
  track(id, chatId) { return this.sessions.reassign(id, chatId); }
  stop(id) { void this.close(id); return Boolean(this.get(id)); }
  async shutdownResources() { await this.runtime.close(); }
}

/** `provider/model`, where the model id may itself contain slashes. */
function splitSpec(spec) {
  const value = String(spec || "").trim();
  const slash = value.indexOf("/");
  if (slash <= 0) return null;
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}
