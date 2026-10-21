import { remoteNode } from "./place.js";
import crypto from "node:crypto";
import { answerTo, isDismissal, questionRequest } from "./harnesses/questions.js";
import fs from "node:fs/promises";
import { attachmentForDevice } from "./nodes/device-attachments.js";
import { EventEmitter } from "node:events";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { watchEvents } from "@earendil-works/pi-durable";
import { SessionRecords } from "./harnesses/session-records.js";
import { messageClose, messageOpen, toolClose, toolKind, toolOpen, toolSubject, turnSettle } from "./harnesses/transcript-ops.js";
import { applyTranscriptOps } from "./transcript-fold.js";
import { reduceActiveGeneration, snapshotActiveGeneration } from "./active-generation.js";
import { unsupported } from "./harnesses/unsupported.js";
import { usageFromRequests } from "./cache-stats.js";
import { ConduitIds, ConduitWorkspace, USER_ENTRY } from "./server/durable-runtime.js";

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
  history: "tree",
  // Both are a fork of the conversation just before a prompt; the chat moves
  // to the fork and the old branch stays in the store.
  fork: true,
  regenerate: true,
  steer: true,
  followUpQueue: true,
  cancel: true,
  compaction: true,
  thinkingLevels: true,
  modelSwitch: true,
  toolUse: true,
  // The runtime asks questions (its ask_user tool) through the same card an approval uses.
  approvals: true,
  permissionModes: false,
  usage: true,
  // The turn is folded as it is published, as Pi and the Test stream do, so a
  // reconnecting browser is restated the generation in progress.
  replay: true,
  attachments: true,
  interruptKeepsPartial: false,
});

const TOOL_KINDS = {
  bash: "command", read: "read", write: "edit", edit: "edit", ask_user: "other",
  web_search: "search", source_check: "search", fetch_content: "fetch", get_search_content: "fetch",
};
const subjectOf = (name, args = {}) => toolSubject(
  name === "bash" ? args.command
    : name === "web_search" ? args.queries || args.query
      : name === "fetch_content" ? args.urls || args.url
        : name === "source_check" ? args.claim || args.query
          : args.path);
// pi-durable's default: past contextWindow minus this, the next request waits for a compaction.
const COMPACTION_RESERVE = 16384;
const STOP_REASONS = new Set(["stop", "toolUse", "length", "error", "aborted"]);

/** What the transcript keeps about an attachment. */
const attachmentSummary = (attachments = []) => attachments.map((item) => ({
  id: item.id, name: item.name || item.id, mimeType: item.mimeType || item.type || "application/octet-stream",
}));

/**
 * What the model is given for a prompt with attachments, as Conduit Pi gives
 * it: images as image input, any other file named by its path for the tools
 * to read. On a device the tools cannot reach this server's files, so a
 * text file is given inline and anything else is said to be out of reach.
 */
async function promptInput(message, attachments = [], { onDevice = false } = {}) {
  const images = [];
  const files = [];
  for (const attachment of attachments) {
    const type = String(attachment.mimeType || attachment.type || "");
    if (type.startsWith("image/") && type !== "image/svg+xml") {
      images.push({ type: "image", data: await fs.readFile(attachment.path, "base64"), mimeType: type });
    } else if (!onDevice) {
      files.push(`Attached file: ${attachment.path}`);
    } else {
      files.push(await attachmentForDevice(attachment));
    }
  }
  const text = [message, ...files].filter(Boolean).join("\n\n");
  return images.length ? [{ type: "text", text }, ...images] : text;
}

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

/** pi-durable writes a stopped call's result as an error; the reader's stop makes it cancelled. */
const abortedResult = (entry) => (entry?.data?.diagnostics || []).some((item) => item?.code === "aborted");

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
        ...(data.timestamp ? { timestamp: data.timestamp } : {}),
        ...(data.attachments?.length ? { attachments: data.attachments } : {}) }));
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
      const cancelled = abortedResult(entry);
      ops.push(toolClose({ toolCallId: result.toolCallId, output: textOf(result.content), isError: Boolean(result.isError) && !cancelled, cancelled,
        completedAt: result.timestamp ? new Date(result.timestamp).toISOString() : undefined }));
    }
  }
  settle();
  return ops;
}

export class DurableAdapter extends EventEmitter {
  // Starts its harness on a device for a device's workspace (live-session-launcher.js).
  runsOnDevices = true;

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
  async remember(conversation, chatId, workspace) {
    await conversation.commit(async (tx) => {
      (await tx.doc(ConduitIds, conversation.id)).chatId = chatId;
      // The device whose folder this conversation works in; none is this server.
      if (workspace !== undefined) Object.assign(await tx.doc(ConduitWorkspace, conversation.id), workspace || { nodeId: null, place: null });
    }, this.context);
  }

  async launch(context, { model = "", thinkingLevel = "", forceModel = false } = {}) {
    const selected = (forceModel ? String(model).trim() : "") || String(context.chat.backend.model || "").trim();
    const level = (forceModel ? String(thinkingLevel).trim() : "")
      || String(context.chat.modelThinkingLevels?.[selected] || "").trim();
    // The chat's profile is a Conduit template (Assistant when it names none).
    const options = { chatId: context.chat.id, project: context.project, model: selected, thinkingLevel: level,
      templateId: context.chat.templateId || context.chat.backend?.profileId || null,
      roaming: context.chat.backend?.roaming === true };
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
      ...await this.runtime.agentFor(options.templateId, { roaming: options.roaming }),
      ...(spec ? { model: spec } : {}),
      ...(options.thinkingLevel || fallback?.thinkingLevel ? { thinkingLevel: options.thinkingLevel || fallback.thinkingLevel } : {}),
      ...(options.project?.workingRoot ? { cwd: options.project.workingRoot } : {}),
    } }, this.context);
    await this.remember(conversation, options.chatId,
      remoteNode(options.project) ? { nodeId: remoteNode(options.project), place: options.project.place }
        : options.roaming ? { nodeId: null, place: null, roaming: true } : null);
    return this.start(conversation, options);
  }

  async restore(opaqueSession, options) {
    const harness = await this.runtime.open();
    const conversation = await harness.conversation(Number(opaqueSession), this.context);
    if (!conversation) throw failure("This chat's conversation is missing from the Conduit runtime", "session_not_found", 404);
    if ((await harness.snapshot(ConduitIds, conversation.id, this.context))?.chatId !== options.chatId) {
      await this.remember(conversation, options.chatId);
    }
    // The template as it is now: its tools, extensions and prompt (as edited in Settings).
    const roaming = options.roaming || Boolean((await harness.snapshot(ConduitWorkspace, conversation.id, this.context))?.roaming);
    await conversation.configure(await this.runtime.agentFor(options.templateId, { roaming }), this.context);
    // A conversation from before places learns its workspace's place.
    const workspace = await harness.snapshot(ConduitWorkspace, conversation.id, this.context);
    if (workspace?.nodeId && !workspace.place && options.project?.place) {
      await this.remember(conversation, options.chatId, { nodeId: remoteNode(options.project), place: options.project.place });
    }
    const record = await this.start(conversation, options);
    const spec = splitSpec(options.model);
    if (spec && spec.modelId !== record.modelId) await this.setModel(record.id, options.model);
    return record;
  }

  async start(conversation, { chatId, project, templateId = null }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    const record = this.sessions.add({
      id: crypto.randomUUID(), chatId, projectId: project?.id || null, nodeId: remoteNode(project), conversationId: conversation.id, conversation, templateId,
      status: "running", activity: "idle", active: false, stopping: false, generation: null, generationSeq: 0,
      clients: new Set(), events: [], hostUiRequests: [], activeGeneration: null,
      model: "", modelId: "", provider: "", thinkingLevel: "", contextWindow: 0,
      // What the turn in progress has named: its prompts by submission, the
      // answer being written, and the tools it has open.
      prompts: new Map(), turn: null, usage: null, queue: [],
      // Prompt text by message id, for the queue strip, and prompts placed
      // before the run that answers them has said it started.
      texts: new Map(), unopened: new Map(), closedEntries: new Set(),
      // How each queued prompt was sent: a steer joins the running turn, a
      // follow-up waits for the next one.
      modes: new Map(),
    });
    record.scope.defer(() => { record.stream?.stop(); record.unasked?.(); record.unwaited?.(); });
    await this.follow(record, conversation);
    return record;
  }

  /** Listen to a conversation: the chat's own, or the fork it has just moved to. */
  async follow(record, conversation) {
    await record.stream?.stop();
    record.conversation = conversation;
    record.conversationId = conversation.id;
    // What the server keeps as the chat's opaque session, on its first prompt
    // and at every checkpoint: the conversation it is on, a fork included.
    record.sessionId = String(conversation.id);
    await this.readAgent(record);
    record.unasked?.();
    record.unasked = this.runtime.answerFor(conversation.id, (request) => this.askUser(record, request));
    record.unwaited?.();
    record.unwaited = this.runtime.waitFor(conversation.id, (device) => this.waitingForDevice(record, device));
    const stream = await watchEvents(this.runtime.harness, conversation.id, this.context);
    record.stream = stream;
    // A run the last process left going is still going; this is where it is picked up.
    if (stream.snapshot.run) await this.resumeTurn(record, stream.snapshot);
    record.usage = stream.snapshot.usage;
    void this.publishUsage(record);
    stream.start(async (events) => {
      // A stream left behind by a fork says nothing more about this chat.
      if (record.stream !== stream) return;
      for (const event of events) await this.translate(record, event);
    });
  }

  /** Every entry of a conversation, oldest first. */
  async entries(conversation) {
    const entries = [];
    let cursor;
    do {
      const page = await conversation.entries({ order: "ascending" }, 500, cursor, this.context);
      entries.push(...page.items);
      cursor = page.next;
    } while (cursor);
    return entries;
  }

  /**
   * Cut the chat's history just before a prompt (plan decision 16).
   *
   * pi-durable forks keep the parent's entries up to the one given, so the fork
   * is taken at the entry before the prompt; a prompt with nothing before it
   * starts a new conversation with the same agent. Either way the chat moves to
   * the new conversation, and the prompt's text is handed back so a regenerate
   * can ask it again. The old branch stays in the store, untouched.
   */
  async fork(id, { nodeId } = {}) {
    const record = this.get(id);
    if (!record) throw failure("No Conduit runtime session", "backend_unavailable", 404);
    if (record.active) throw failure("Stop the running turn before editing history", "generation_limit", 409);
    const harness = this.runtime.harness;
    const branches = await this.branchesOf(record.conversationId);
    // The prompt is on the chat's branch, or on one it left (picked in the history tree).
    let base = null;
    let entries = [];
    let index = -1;
    for (const conversationId of [record.conversationId, ...[...branches].reverse()]) {
      base = conversationId === record.conversationId ? record.conversation : await harness.conversation(conversationId, this.context);
      entries = base ? await this.entries(base) : [];
      index = entries.findIndex((entry) => entry.kind === USER_ENTRY && entry.data?.messageId === nodeId);
      if (index >= 0) break;
    }
    if (index < 0) throw failure("No such prompt in this chat", "entry_not_found", 404);
    const source = entries[index];
    const agent = await base.agent(this.context);
    const fork = index > 0
      ? await base.fork(entries[index - 1].id, { ownership: { kind: "ownerless" } }, this.context)
      : await harness.createConversation({ ownership: { kind: "ownerless" }, agent: {
        ...(agent.model ? { model: agent.model } : {}),
        ...(agent.thinkingLevel ? { thinkingLevel: agent.thinkingLevel } : {}),
        ...(agent.cwd ? { cwd: agent.cwd } : {}),
      } }, this.context);
    // A fork copies the workspace with its other documents; a new conversation is told it.
    await this.remember(fork, record.chatId, index > 0 ? undefined
      : (await harness.snapshot(ConduitWorkspace, record.conversationId, this.context)) || null);
    await fork.commit(async (tx) => {
      const ids = await tx.doc(ConduitIds, fork.id);
      // A fresh conversation does not carry the documents a fork copies.
      if (index === 0) ids.messages = { ...((await harness.snapshot(ConduitIds, base.id, this.context))?.messages || {}) };
      ids.branches = [...branches.filter((branch) => branch !== record.conversationId), record.conversationId];
    }, this.context);
    await this.follow(record, fork);
    const text = source.data?.text || textOf(source.model?.[0]?.content);
    return { opaqueSession: String(fork.id), text, sourceMessage: { id: nodeId, text } };
  }

  async readAgent(record) {
    const agent = await record.conversation.agent(this.context);
    const model = agent.model;
    record.provider = model?.provider || "";
    record.modelId = model?.modelId || "";
    record.model = model ? `${model.provider}/${model.modelId}` : "";
    record.thinkingLevel = agent.thinkingLevel || "";
    record.contextWindow = (model && this.runtime.models?.getModel(model.provider, model.modelId)?.contextWindow) || 0;
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
      content: message, timestamp: new Date().toISOString(),
      ...(options.attachments?.length ? { attachments: attachmentSummary(options.attachments) } : {}) }));
    this.publish(record, { type: "status", generationId: turn.generationId, phase: "started", seq: ++record.generationSeq,
      status: "working", activity: "working", detail: null,
      ...(options.continuationBase ? { continuation: true, continuationBase: String(options.continuationBase) } : {}) });
    turn.opened = new Set([messageId]);
    try {
      await this.submit(record, message, messageId, undefined, options.attachments);
    } catch (cause) {
      // The turn was announced; one that never reached the conversation ends failed, not busy forever.
      this.publish(record, { type: "error", generationId: turn.generationId, scope: "runtime",
        error: { code: cause?.code || "backend_unavailable", message: cause?.message || String(cause) } });
      this.finish(record);
      throw cause;
    }
    // Conduit finds a prompt's attachments by the message they were sent with.
    return { generationId: turn.generationId, attachmentIdentity: { messageId } };
  }

  async submit(record, text, messageId, whenBusy, attachments = []) {
    const summary = attachmentSummary(attachments);
    const submission = await record.conversation.submit({
      type: "input", content: await promptInput(this.expandSkill(record, text), attachments, { onDevice: Boolean(record.nodeId) }), requestId: messageId, ...(whenBusy ? { whenBusy } : {}),
      entry: { kind: USER_ENTRY, data: { messageId, text, timestamp: new Date().toISOString(),
        ...(summary.length ? { attachments: summary } : {}) } },
    }, this.context);
    record.prompts.set(submission.id, messageId);
    record.texts.set(messageId, text);
    if (whenBusy) record.modes.set(messageId, whenBusy);
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
              content: data.text || "", ...(data.timestamp ? { timestamp: data.timestamp } : {}),
              ...(data.attachments?.length ? { attachments: data.attachments } : {}) }));
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
        this.publish(record, { type: "retry", generationId: record.generation?.id || null, active: true,
          retry: { attempt: event.attempt, delayMs: Math.max(0, event.at - Date.now()), errorMessage: event.errorMessage || null } });
        break;
      case "auto_retry_end":
        this.publish(record, { type: "retry", generationId: record.generation?.id || null, active: false });
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
      // Placed before its run started, or a follow-up placed as the run ends:
      // the run that answers it opens it (see run_start).
      if (!turn || !turn.inputs.length || record.modes.get(messageId) === "followUp") { record.unopened.set(messageId, entry.data); return; }
      turn.opened ||= new Set();
      turn.opened.add(messageId);
      this.closeAnswer(record);
      // The prompt the turn moves on from is answered now.
      for (const promptId of turn.prompts) this.publish(record, turnSettle({ promptId, outcome: "complete", generationId: turn.generationId }));
      this.publish(record, messageOpen({ id: messageId, role: "user", generationId: turn.generationId,
        content: entry.data.text || "", ...(entry.data.timestamp ? { timestamp: entry.data.timestamp } : {}),
        ...(entry.data.attachments?.length ? { attachments: entry.data.attachments } : {}) }));
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
    const cancelled = (record.stopping && !result) || abortedResult(event.entry);
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
    // A question the turn was waiting on goes with it.
    for (const request of [...record.hostUiRequests]) this.settleAsk(record, request.id, { id: request.id, cancelled: true });
    for (const promptId of turn.prompts) this.publish(record, turnSettle({ promptId, outcome, generationId: turn.generationId }));
    record.turn = null;
    record.active = false;
    record.stopping = false;
    record.activity = "idle";
    Object.assign(record.generation, { closed: true, settled: true });
    this.publish(record, { type: "status", generationId: turn.generationId, seq: ++record.generationSeq,
      phase: stopped ? "stopped" : "settled", status: "idle", activity: "idle", detail: null });
    void this.publishUsage(record);
    this.emit("settled", { record, completed: outcome === "complete" });
  }

  /**
   * The turn's next step runs on a device that is offline (plan decision 8):
   * the chat says which, as a retry with nothing to count, until it is back,
   * and offers to go on without it (decision 21) on the card a question uses.
   */
  waitingForDevice(record, device) {
    if (record.waitingFor === device.id) return;
    record.waitingFor = device.id;
    record.waitingForName = device.name;
    this.publish(record, { type: "retry", generationId: record.generation?.id || null, active: true, retry: { waitingFor: device.name } });
    const done = () => {
      if (record.waitingFor !== device.id) return;
      record.waitingFor = null;
      this.publish(record, { type: "retry", generationId: record.generation?.id || null, active: false });
    };
    const request = questionRequest({
      id: `device-${device.id}-${crypto.randomUUID()}`, title: `${device.name} is offline`,
      questions: [{ id: "q1", header: "", multiSelect: false,
        prompt: `The next step runs on ${device.name}. Wait for it to come back, or go on without it?`,
        options: [
          { id: "wait", label: "Keep waiting", description: "" },
          { id: "without", label: `Continue without ${device.name}`, description: "The agent is told it is unavailable and carries on." },
        ] }],
    });
    void this.askUser(record, request).then((response) => {
      if (!response || response.cancelled || response.withdrawn || isDismissal(response)) return;
      if (!answerTo(response, request.questions[0]).options.some((option) => option.id === "without")) return;
      this.runtime.excuse(record.conversationId, device);
      done();
    });
    this.runtime.nodeHub?.once(`online:${device.id}`, () => {
      // Back: the card is moot.
      this.settleAsk(record, request.id, { id: request.id, withdrawn: true });
      done();
    });
  }

  /** Put a question card up and wait for the answer (see the runtime's ask_user tool). */
  askUser(record, request) {
    return new Promise((resolve) => {
      record.asks ||= new Map();
      record.asks.set(request.id, resolve);
      record.hostUiRequests = [...record.hostUiRequests.filter((item) => item.id !== request.id), request];
      record.activity = "waiting_for_user";
      this.publish(record, { type: "permission_request", generationId: record.generation?.id || null, requestId: request.id, ...request });
    });
  }

  async respondHostUi(id, response) {
    const record = this.get(id);
    if (!record) throw failure("No Conduit runtime session", "backend_unavailable", 404);
    const requestId = response?.id || response?.requestId;
    if (!requestId) throw failure("Host UI response requires id", "host_ui_id_required", 400);
    this.settleAsk(record, requestId, response);
    return null;
  }

  settleAsk(record, requestId, response) {
    const resolve = record.asks?.get(requestId);
    record.asks?.delete(requestId);
    if (!record.hostUiRequests.some((item) => item.id === requestId)) return;
    record.hostUiRequests = record.hostUiRequests.filter((item) => item.id !== requestId);
    this.publish(record, { type: "permission_resolved", generationId: record.generation?.id || null, requestId });
    record.activity = record.active ? "working" : "idle";
    resolve?.(response);
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
    await this.submit(record, message, messageId, type === "steer" ? "steer" : "followUp", options.attachments || []);
    return { attachmentIdentity: { messageId } };
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
  // A template's skills, as `/skill:<name>`, as classic Pi offered them.
  listCommands(id) { return Promise.resolve(this.skillCommands(this.get(id)?.templateId)); }
  listAvailableCommands({ template } = {}) { return Promise.resolve(this.skillCommands(template?.id)); }
  skillCommands(templateId) {
    return this.runtime.skillsFor(templateId).map((skill) => ({ name: `skill:${skill.name}`, description: skill.description, source: "skill" }));
  }

  /** `/skill:<name> args` as the model reads it: the skill, then the args (Pi's expansion). The transcript keeps what was typed. */
  expandSkill(record, text) {
    const match = /^\/skill:(\S+)(?:\s+([\s\S]*))?$/.exec(String(text || ""));
    const skill = match && this.runtime.skillsFor(record.templateId).find((item) => item.name === match[1]);
    if (!skill) return text;
    const block = `<skill name="${skill.name}">\n${skill.body}\n</skill>`;
    return match[2]?.trim() ? `${block}\n\n${match[2].trim()}` : block;
  }

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

  contextUsage(record) { return record?.history?.contextUsage || null; }

  /**
   * What the conversation has spent and how full its context is, read from
   * its entries as Conduit reads a Pi session's: every request's usage, with a
   * compaction resetting the cache prefix.
   */
  async contextFromHistory({ conversation = null, opaqueSession = null } = {}) {
    const harness = await this.runtime.open();
    const held = conversation || await harness.conversation(Number(opaqueSession), this.context);
    if (!held) return null;
    const requests = [];
    let model = null;
    let cost = 0;
    for (const entry of await this.entries(held)) {
      if (entry.kind === "pi.compaction") { requests.push(null); continue; }
      const message = entry.kind === "pi.assistant" ? entry.model?.[0] : null;
      if (!message?.usage) continue;
      if (message.provider && message.model) model = { provider: message.provider, id: message.model };
      cost += Number(message.usage.cost?.total) || 0;
      requests.push({ input: message.usage.input || 0, output: message.usage.output || 0,
        cacheRead: message.usage.cacheRead || 0, cacheWrite: message.usage.cacheWrite || 0 });
    }
    const contextWindow = model ? this.runtime.models.getModel(model.provider, model.id)?.contextWindow || null : null;
    const compactAt = contextWindow && contextWindow > COMPACTION_RESERVE ? contextWindow - COMPACTION_RESERVE : null;
    return usageFromRequests(requests, { model: model ? `${model.provider}/${model.id}` : null, contextWindow, cost, compactAt });
  }

  async publishUsage(record) {
    record.history = await this.contextFromHistory({ conversation: record.conversation }).catch(() => record.history);
    if (!record.history) return;
    this.publish(record, { type: "usage", generationId: record.generation?.id || null, ...record.history });
  }

  async refreshContext(id) {
    const record = this.get(id);
    if (!record) return null;
    await this.publishUsage(record);
    return this.contextUsage(record);
  }

  async readTranscript({ liveSessionId, opaqueSession }) {
    const record = liveSessionId ? this.get(liveSessionId) : null;
    const conversationId = record?.conversationId ?? Number(opaqueSession);
    if (!Number.isInteger(conversationId)) return { messages: [], tools: [], page: { before: null } };
    const harness = await this.runtime.open();
    const conversation = record?.conversation || await harness.conversation(conversationId, this.context);
    if (!conversation) return { messages: [], tools: [], page: { before: null } };
    const entries = await this.entries(conversation);
    const ids = (await harness.snapshot(ConduitIds, conversationId, this.context))?.messages || {};
    const { messages, tools } = applyTranscriptOps({}, entriesToOps(entries, ids));
    // An answer still being written is the live stream's, not the reload's.
    return { messages: messages.filter((message) => !message.streaming), tools, page: { before: null } };
  }

  /**
   * The subagents a chat's turns delegated to (src/server/subagents.js), on
   * its conversation and the branches it left: each child's task and, once
   * it has one, its answer. Their transcripts read as any conversation's.
   */
  async subagents({ liveSessionId, opaqueSession }) {
    const record = liveSessionId ? this.get(liveSessionId) : null;
    const current = record?.conversationId ?? Number(opaqueSession);
    if (!Number.isInteger(current)) return [];
    const harness = await this.runtime.open();
    const children = [];
    for (const conversationId of [...await this.branchesOf(current), current]) {
      const conversation = await harness.conversation(conversationId, this.context);
      const page = conversation ? await conversation.commit((tx) => tx.scanConversations({ ownerConversationId: conversationId }, 200), this.context) : { items: [] };
      for (const child of page.items) {
        const handle = await harness.conversation(child.id, this.context);
        const first = handle && (await handle.entries({ order: "ascending" }, 5, undefined, this.context)).items.find((entry) => entry.kind === USER_ENTRY || entry.kind === "pi.user");
        children.push({ conversationId: String(child.id), parentConversationId: String(conversationId),
          task: textOf(first?.model?.[0]?.content) || (typeof first?.model?.[0]?.content === "string" ? first.model[0].content : ""),
          answer: (await this.runtime.lastAnswer(child.id)) || null });
      }
    }
    return children;
  }

  /**
   * A chat moved to another project or workspace: its conversation, and every
   * branch it left (an edit there forks from it), now work in the target's
   * folder, on the target's device. Nothing in the store moves; the record and
   * the agent's working directory change. A roaming chat stays roaming. The
   * chat's live session is closed first by the caller and reopens in place.
   */
  async relocate({ opaqueSession, project }) {
    const current = Number(opaqueSession);
    if (!Number.isInteger(current)) return;
    const harness = await this.runtime.open();
    const nodeId = remoteNode(project);
    for (const conversationId of [...await this.branchesOf(current), current]) {
      const conversation = await harness.conversation(conversationId, this.context);
      if (!conversation) continue;
      await conversation.commit(async (tx) => {
        const workspace = await tx.doc(ConduitWorkspace, conversationId);
        Object.assign(workspace, nodeId ? { nodeId, place: project.place, roaming: false }
          : { nodeId: null, place: null, roaming: Boolean(workspace.roaming) });
      }, this.context);
      if (project.workingRoot) await conversation.configure({ cwd: project.workingRoot }, this.context);
    }
  }

  /**
   * Start the chat's context again (pi-durable's reset): the model sees
   * nothing before it, or only `handoff` when given; the transcript keeps
   * everything. While a turn runs it waits for the next boundary.
   */
  async reset({ liveSessionId, opaqueSession, handoff }) {
    const record = liveSessionId ? this.get(liveSessionId) : null;
    const harness = await this.runtime.open();
    const conversation = record?.conversation || await harness.conversation(Number(opaqueSession), this.context);
    if (!conversation) throw failure("This chat has no conversation to reset", "session_not_found", 404);
    await conversation.reset(String(handoff || "").trim() || undefined, this.context);
  }

  /** The conversations a chat was on before the one given (its edits' forks), oldest first. */
  async branchesOf(conversationId) {
    const harness = await this.runtime.open();
    return ((await harness.snapshot(ConduitIds, conversationId, this.context))?.branches || []).filter(Number.isInteger);
  }

  /**
   * The chat's history as a tree: its conversation and every branch it left,
   * merged by message id. Branches share what came before their fork, so a
   * message seen in several is one node, and each branch's messages chain from
   * it. The leaf is the chat's own last message.
   */
  async readHistory(options) {
    const record = options.liveSessionId ? this.get(options.liveSessionId) : null;
    const current = record?.conversationId ?? Number(options.opaqueSession);
    const branches = Number.isInteger(current) ? await this.branchesOf(current) : [];
    const nodes = new Map();
    const roots = [];
    let leafId = null;
    for (const conversationId of [...branches, current]) {
      const { messages } = conversationId === current
        ? await this.readTranscript(options) : await this.readTranscript({ opaqueSession: conversationId });
      let parent = null;
      for (const message of messages) {
        let node = nodes.get(message.id);
        if (!node) {
          node = { entry: { id: message.id, parentId: parent?.entry.id || null, timestamp: message.timestamp || null, type: "message",
            display: `${message.role}: ${String(message.content || "").replace(/\s+/g, " ").trim().slice(0, 240)}`,
            kind: message.role, hidden: false, forkable: message.role === "user", regeneratable: message.role === "user" },
          children: [] };
          nodes.set(message.id, node);
          (parent ? parent.children : roots).push(node);
        }
        parent = node;
      }
      if (conversationId === current) leafId = parent?.entry.id || null;
    }
    return { mode: branches.length ? "tree" : "linear", leafId, tree: roots };
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
    return { ...this.sessions.view(record), hostUiRequests: [...(record?.hostUiRequests || [])], queue: this.queueView(record || { queue: [] }),
      ...(record?.waitingFor ? { retry: { waitingFor: record.waitingForName } } : {}),
      contextUsage: this.contextUsage(record), sessionStats: record?.history?.sessionStats || null,
      cacheStats: record?.history?.cacheStats || null };
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
  /**
   * Stop a chat's process. A turn here outlives its session -- it is durable,
   * and would come back after a restart -- so stopping the process stops the
   * turn too, as ending another harness's process does.
   */
  async stopProcess(id) {
    if (this.get(id)?.active) await this.cancel(id).catch(() => {});
    await this.close(id);
  }

  stop(id) { void this.stopProcess(id); return Boolean(this.get(id)); }
  async shutdownResources() { await this.runtime.close(); }
}

/** `provider/model`, where the model id may itself contain slashes. */
function splitSpec(spec) {
  const value = String(spec || "").trim();
  const slash = value.indexOf("/");
  if (slash <= 0) return null;
  return { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
}
