import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { SessionRecords } from "./harnesses/session-records.js";
import { applyTranscriptOp } from "./transcript-fold.js";
import { messageClose, messageDrop, messageOpen, toolClose, toolOpen, turnSettle } from "./harnesses/transcript-ops.js";
import { reduceActiveGeneration, snapshotActiveGeneration } from "./active-generation.js";
import { unsupported } from "./harnesses/unsupported.js";

/**
 * A backend that answers instantly, forever, at a rate you choose.
 *
 * There is no model here and nothing to install. It exists to put the live
 * path under sustained, *evenly paced* delta pressure so the cost of drawing a
 * turn can be watched on its own: adapter -> chat log -> SocketDelivery ->
 * socket -> client reducer -> turn rows -> paint. Every one of those is the
 * real one. A real harness cannot be used for this because its rate is
 * whatever the provider felt like that second, so a slow frame and a slow
 * provider look identical.
 *
 * Pacing is held against the wall clock rather than by counting timers, so a
 * late tick emits what it owes instead of stretching the run. That is the
 * whole point: if the stream itself drifted, every number read off it would be
 * measuring this file.
 */
/**
 * What it can do: everything the reference harness can, deterministically.
 *
 * This declared four things and refused the rest, so the profile exercised a
 * narrow slice of Conduit -- prompt, stream, stop -- and every path built for a
 * real harness (steering, forks, regenerate, tools, approvals, compaction) had
 * no coverage here at all. Capabilities are the whole of how a backend's
 * behaviour is decided: the client hides what is not declared and the server
 * refuses it, so declaring them is what turns those paths on.
 *
 * What it does with each is fixed and repeatable, because that is the point of
 * this backend. A tool call returns the same output every time, an approval is
 * asked the same way, a fork cuts at the entry it was given. There is no model
 * to be unpredictable.
 */
export const TEST_STREAM_CAPABILITIES = Object.freeze({
  // Forks are cuts in its own journal, so the history it reports is a tree for
  // the same reason Pi's is: a chat can hold more than one continuation.
  history: "tree",
  fork: true,
  regenerate: true,
  steer: true,
  followUpQueue: true,
  cancel: true,
  compaction: true,
  // How much comes back is this harness's decision, and a thinking level is
  // already a signal a harness interprets however it likes -- so the amount
  // rides on it, labelled in tokens. Two independent questions, the two
  // pickers that are already in the composer, and no new settings surface.
  thinkingLevels: true,
  modelSwitch: true,
  toolUse: true,
  approvals: true,
  // Matching Pi: it answers an approval, it does not offer profiles to answer
  // under. That is a Codex feature, and claiming it here would mean declaring a
  // surface with nothing behind it.
  permissionModes: false,
  usage: true,
  replay: true,
  attachments: true,
  // True here, and only here. Every real harness drops an interrupted partial
  // because what it writes and what it sends the model next turn are different
  // things. This backend's journal *is* its transcript and there is no model to
  // disagree with it, so a stopped answer really does stand. It is also the
  // only coverage Conduit has of the `discarded: false` close.
  interruptKeepsPartial: true,
});

/**
 * How fast, as the models.
 *
 * `paced-60` is roughly what a fast provider does, and is the control: a frame
 * dropped at 60 tokens/s is not the stream's fault. The rest climb until
 * something gives.
 */
export const TEST_STREAM_SPEEDS = Object.freeze([
  { id: "paced-60", label: "60 tokens/s · about a real model", tokensPerSecond: 60 },
  { id: "fast-250", label: "250 tokens/s", tokensPerSecond: 250 },
  { id: "fast-1000", label: "1000 tokens/s", tokensPerSecond: 1000 },
  { id: "flood-4000", label: "4000 tokens/s · past any real provider", tokensPerSecond: 4000 },
].map(Object.freeze));

/**
 * How much, as the thinking levels.
 *
 * A level is a string a harness is free to interpret, and what this one does
 * with it is decide how much to send back -- so the level is written as the
 * amount. Speed and amount are independent questions: a short run says a turn
 * starts and settles cleanly, a long one says it still paints after tens of
 * thousands of tokens, which is where a leak or a growing reconcile shows and
 * a short run never would.
 */
export const TEST_STREAM_AMOUNTS = Object.freeze([
  { id: "400 tokens", tokens: 400 },
  { id: "2000 tokens", tokens: 2000 },
  { id: "8000 tokens", tokens: 8000 },
  { id: "32000 tokens", tokens: 32_000 },
].map(Object.freeze));

export const DEFAULT_SPEED_ID = "fast-250";
export const DEFAULT_AMOUNT_ID = "2000 tokens";
const MAX_TOKENS = 100_000;
// setTimeout cannot be trusted below a couple of milliseconds, so past roughly
// 500 tokens/s a tick emits several tokens rather than pretending to fire more
// often than it can. The rate stays honest; only the deltas-per-tick changes.
const TICK_FLOOR_MS = 2;
// More than this in one turn is a typo in the prompt rather than a request.
const MAX_TOOL_RUNS = 8;
const CONTEXT_WINDOW = 200_000;

const WORDS = ("the quick brown fox jumps over a lazy dog while conduit streams tokens through "
  + "its transcript at a fixed and deliberate pace so that every frame can be measured against "
  + "the last one without a provider deciding how fast today is going to be").split(" ");

const adapterError = (message, code = "backend_unavailable", status = 409) =>
  Object.assign(new Error(message), { code, status });

export const speedFor = (id) => TEST_STREAM_SPEEDS.find((speed) => speed.id === id)
  || TEST_STREAM_SPEEDS.find((speed) => speed.id === DEFAULT_SPEED_ID);
export const amountFor = (id) => TEST_STREAM_AMOUNTS.find((amount) => amount.id === id)
  || TEST_STREAM_AMOUNTS.find((amount) => amount.id === DEFAULT_AMOUNT_ID);

/**
 * A one-off amount, taken from the prompt when it names one.
 *
 * Typing "1200t" streams 1200 tokens whatever the level says, for a figure the
 * four presets do not cover. Anything else uses the level, because the prompt
 * is not a question here and refusing it would only mean the tester has to
 * remember the syntax.
 */
export function amountFromPrompt(message, fallback) {
  const match = /(\d+)\s*t\b/i.exec(String(message || ""));
  if (!match) return fallback;
  return Math.min(MAX_TOKENS, Math.max(1, Number(match[1])));
}

/**
 * What else the prompt asks for, in the same spirit as the amount.
 *
 * The prompt is not a question here, so it is the one place a tester can steer
 * a run without leaving the composer: "3 tools" runs three tool calls, "approve"
 * makes each of them ask first. Everything is deterministic -- the same prompt
 * produces the same turn, which is what makes this backend worth measuring
 * against.
 */
export function toolRunsFromPrompt(message) {
  const match = /(\d+)\s*tools?\b/i.exec(String(message || ""));
  if (match) return Math.min(MAX_TOOL_RUNS, Math.max(0, Number(match[1])));
  return /\btools?\b/i.test(String(message || "")) ? 1 : 0;
}

export const approvalFromPrompt = (message) => /\bapprove|approval\b/i.test(String(message || ""));

/** The tool a run calls, and what it returns. Fixed, like everything else. */
export const TEST_STREAM_TOOL = Object.freeze({
  name: "read_file",
  kind: "read",
  subject: "docs/testing.md",
  input: Object.freeze({ path: "docs/testing.md" }),
  output: "docs/testing.md: approach selection, commands, safety boundaries, evidence.",
});

/** The nth token of the stream, including the paragraph breaks. */
export function tokenAt(index) {
  const word = WORDS[index % WORDS.length];
  if (index > 0 && index % 60 === 0) return `\n\n${word} `;
  return `${word} `;
}

/**
 * The steps a turn will take, decided before it writes a word.
 *
 * Text, then a tool, then text, for as many tools as were asked for. Deciding
 * it up front is what makes a run repeatable: the same prompt produces the same
 * turn, down to which token the call lands on.
 */
export function planTurn(tokens, toolRuns) {
  const total = Math.max(1, tokens);
  if (!toolRuns) return [{ kind: "text", tokens: total }];
  const share = Math.max(1, Math.floor(total / (toolRuns + 1)));
  const steps = [];
  let left = total;
  for (let run = 0; run < toolRuns; run += 1) {
    steps.push({ kind: "text", tokens: share });
    steps.push({ kind: "tool", toolCallId: `call_${run + 1}` });
    left -= share;
  }
  steps.push({ kind: "text", tokens: Math.max(1, left) });
  return steps;
}

/** What Conduit keeps about an attachment, as this backend would record it. */
const attachmentSummary = (attachments) => attachments.map((item) => ({
  id: item.id, name: item.name || item.id, mimeType: item.mimeType || "application/octet-stream",
}));

export class TestStreamAdapter extends EventEmitter {
  constructor({ logs = null } = {}) {
    super();
    this.sessions = new SessionRecords({
      capabilities: TEST_STREAM_CAPABILITIES,
      backend: { protocol: "native_api", implementation: "test-stream", installationId: "conduit-test-stream" },
      extras: (record) => ({ rate: speedFor(record.model).label, thinkingLevel: record.thinkingLevel, tokens: record.tokens }),
      // Nothing outside this process knows anything about these chats, so the
      // statements are the transcript, exactly as they are for ChatGPT Web. The
      // journal is memory only: this backend exists for the length of a
      // profiling session, and giving it a file would leave real ones behind.
      onPublish: (record, event) => {
        if (event.type !== "transcript_op") return;
        const journal = this.journals.get(record.chatId) || [];
        journal.push(event);
        this.journals.set(record.chatId, journal);
      },
      logs,
    });
    this.journals = new Map();
    this.logs = logs;
    this.records = this.sessions.records;
    this.byChatId = this.sessions.byChatId;
    Object.assign(this, unsupported(TEST_STREAM_CAPABILITIES, { label: "Test stream" }));
  }

  async launch(context, { model = "", thinkingLevel = "", forceModel = false } = {}) {
    const selected = (forceModel ? String(model).trim() : "") || String(context.chat.backend.model || "").trim() || DEFAULT_SPEED_ID;
    const level = (forceModel ? String(thinkingLevel).trim() : "")
      || String(context.chat.modelThinkingLevels?.[selected] || "").trim() || DEFAULT_AMOUNT_ID;
    const live = await this.create({ chatId: context.chat.id, project: context.project, model: selected, thinkingLevel: level });
    return {
      live,
      mapping: {
        backend: { ...context.chat.backend, model: selected, opaqueSession: live.chatId },
        modelThinkingLevels: { ...(context.chat.modelThinkingLevels || {}), [selected]: level },
      },
      modelRecovery: null,
    };
  }

  create(options) { return this.start(options); }
  restore(_opaqueSession, options) { return this.start(options); }

  async start({ chatId, project, model = "", thinkingLevel = "" }) {
    const existing = this.getByChatId(chatId);
    if (existing) return existing;
    const amount = amountFor(thinkingLevel);
    return this.sessions.add({
      id: crypto.randomUUID(),
      chatId,
      projectId: project?.id,
      status: "running",
      activity: "idle",
      active: false,
      stopping: false,
      model: speedFor(model).id,
      thinkingLevel: amount.id,
      tokens: amount.tokens,
      generation: null,
      clients: new Set(),
      events: [],
      generationSeq: 0,
      timer: null,
      // Everything a real harness holds between turns: what is waiting to be
      // said, what it is waiting to be told, and what it has spent.
      queue: { steering: [], followUp: [] },
      hostUiRequests: [],
      pendingApproval: null,
      streamed: 0,
      messages: 0,
      activeGeneration: null,
    });
  }

  async prompt(id, message, options) {
    const record = this.get(id);
    if (!record) throw adapterError("No test stream session", "backend_unavailable", 404);
    if (record.active) throw adapterError("Test stream session is busy", "generation_limit", 409);
    const generationId = crypto.randomUUID();
    // The browser drew this row before it sent the prompt, so it already has a
    // name. Inventing one here would state a second row for a message that is
    // on screen: the same prompt twice, until a reload agreed with neither.
    const userMessageId = options?.clientUserMessageId || crypto.randomUUID();
    record.tokens = amountFromPrompt(message, amountFor(record.thinkingLevel).tokens);
    record.active = true;
    record.activity = "working";
    record.stopping = false;
    record.generation = { id: generationId, closed: false, settled: false };
    // Both rows are named before a byte of the answer exists, so nothing
    // arriving later needs a place worked out for it.
    this.publish(record, messageOpen({ id: userMessageId, role: "user", generationId,
      content: message, timestamp: new Date().toISOString(),
      ...(options?.attachments?.length ? { attachments: attachmentSummary(options.attachments) } : {}) }));
    this.publish(record, { type: "status", generationId, phase: "started", seq: ++record.generationSeq,
      status: "working", activity: "working", detail: null,
      ...(options?.continuationBase ? { continuation: true, continuationBase: String(options.continuationBase) } : {}) });
    record.turn = {
      generationId,
      answers: userMessageId,
      prompts: [userMessageId],
      steps: planTurn(record.tokens, toolRunsFromPrompt(message)),
      step: 0,
      approvals: approvalFromPrompt(message),
      attachments: attachmentSummary(options?.attachments || []),
      sent: 0,
      userMessages: 1,
      messageId: null,
      text: "",
      blocks: [],
      contentIndex: 0,
    };
    // Accepted, and now working. Both transitions are stated because both are
    // in the contract's lifecycle and a client that missed the second would
    // show a turn as submitting for as long as it ran.
    this.publish(record, { type: "status", generationId, phase: "running", seq: ++record.generationSeq,
      status: "working", activity: "working", detail: null });
    this.openAnswer(record);
    this.runStream(record);
    return generationId;
  }

  /**
   * Open the message this turn is about to write into.
   *
   * A turn writes more than one whenever it calls a tool: the message that
   * asked for the tool is finished when the call is made, and what comes after
   * the result is a message of its own. That is how every real harness records
   * it, so it is how this one does.
   */
  openAnswer(record) {
    const turn = record.turn;
    turn.messageId = `assistant-${turn.generationId}-${turn.messages = (turn.messages || 0) + 1}`;
    turn.text = "";
    turn.blocks = [];
    turn.contentIndex = 0;
    this.publish(record, messageOpen({ id: turn.messageId, role: "assistant",
      generationId: turn.generationId, answers: turn.answers }));
    this.publish(record, { type: "assistant_content", generationId: turn.generationId, phase: "start",
      seq: ++record.generationSeq, messageId: turn.messageId });
  }

  /**
   * Emit what the clock says is owed, then sleep until the next token is due.
   *
   * The count comes from elapsed time rather than from how many ticks have
   * fired, so a tick that arrives late catches up in one go and the run still
   * takes the time it said it would. Without that, every measurement taken
   * during a slow frame would be reading this scheduler's drift rather than
   * the renderer's cost.
   */
  runStream(record) {
    const speed = speedFor(record.model);
    const intervalMs = Math.max(TICK_FLOOR_MS, Math.floor(1000 / speed.tokensPerSecond));
    const startedAt = Date.now();
    const turn = record.turn;
    const step = turn.steps[turn.step];
    const target = turn.sent + step.tokens;
    const from = turn.sent;
    const { messageId, generationId } = turn;
    const contentIndex = turn.contentIndex;

    const tick = () => {
      record.timer = null;
      if (!record.turn || record.stopping || record.turn !== turn) return;
      const due = Math.min(target, from + Math.ceil(((Date.now() - startedAt) / 1000) * speed.tokensPerSecond));
      while (turn.sent < due) {
        const delta = tokenAt(turn.sent);
        turn.text += delta;
        turn.sent += 1;
        record.streamed += 1;
        this.publish(record, { type: "assistant_content", generationId, phase: "delta",
          seq: ++record.generationSeq, messageId, contentIndex, blockKind: "text", delta });
      }
      if (turn.sent >= target) { this.advance(record); return; }
      record.timer = setTimeout(tick, intervalMs);
    };
    record.timer = setTimeout(tick, intervalMs);
  }

  /**
   * The step is done. Take a queued message if one is waiting, then go on.
   *
   * A step boundary is where a real harness notices its queue: mid-token would
   * cut a word in half, and waiting for the turn to end would make steering
   * indistinguishable from a follow-up.
   */
  advance(record) {
    const turn = record.turn;
    if (!turn) return;
    turn.step += 1;
    if (this.takeQueued(record)) return;
    const next = turn.steps[turn.step];
    if (!next) return this.finish(record, "stop");
    if (next.kind === "tool") return this.runTool(record, next);
    this.runStream(record);
  }

  /**
   * Call the tool, asking first when the run was told to ask.
   *
   * The call is a block of the message that made it, exactly as a real harness
   * writes it, and the result is a tool record beside the transcript rather
   * than inside it. Both are stated as ops; the activity events beside them are
   * the paint that draws the call arriving.
   */
  runTool(record, step) {
    const turn = record.turn;
    if (turn.approvals && !step.approved) return this.askApproval(record, step);
    const { generationId, messageId } = turn;
    const toolCallId = step.toolCallId;
    const input = TEST_STREAM_TOOL.input;
    turn.contentIndex += 1;
    const contentIndex = turn.contentIndex;
    // The call paints like any other block: its input arrives as text into a
    // block of kind `tool_call`, which is what the reducers at both ends build
    // a call out of.
    this.publish(record, { type: "assistant_content", generationId, phase: "delta",
      seq: ++record.generationSeq, messageId, contentIndex, blockKind: "tool_call",
      delta: JSON.stringify(input) });
    turn.blocks.push({ kind: "tool_call", contentIndex, toolCallId, name: TEST_STREAM_TOOL.name, input });
    this.publish(record, toolOpen({ toolCallId, name: TEST_STREAM_TOOL.name, kind: TEST_STREAM_TOOL.kind, subject: TEST_STREAM_TOOL.subject, input,
      messageId, generationId }));
    this.publish(record, { type: "tool_activity", phase: "start", generationId,
      seq: ++record.generationSeq, toolCallId, name: TEST_STREAM_TOOL.name, kind: TEST_STREAM_TOOL.kind, subject: TEST_STREAM_TOOL.subject, input });
    this.publish(record, { type: "tool_activity", phase: "update", generationId,
      seq: ++record.generationSeq, toolCallId, name: TEST_STREAM_TOOL.name, input,
      output: TEST_STREAM_TOOL.output.slice(0, 24) });
    this.publish(record, { type: "tool_activity", phase: "end", generationId,
      seq: ++record.generationSeq, toolCallId, name: TEST_STREAM_TOOL.name,
      output: TEST_STREAM_TOOL.output, isError: false });
    this.publish(record, toolClose({ toolCallId, output: TEST_STREAM_TOOL.output, generationId }));
    // The message that called the tool is finished with. What answers the
    // result is the next message of the turn.
    this.closeAnswer(record, "toolUse");
    this.openAnswer(record);
    this.advanceAfterTool(record);
  }

  advanceAfterTool(record) {
    const turn = record.turn;
    turn.step += 1;
    if (this.takeQueued(record)) return;
    const next = turn.steps[turn.step];
    if (!next) return this.finish(record, "stop");
    if (next.kind === "tool") return this.runTool(record, next);
    this.runStream(record);
  }

  /** Ask before running, and stop until the answer comes back. */
  askApproval(record, step) {
    const requestId = `approval-${step.toolCallId}`;
    record.hostUiRequests.push({ id: requestId, kind: "confirm",
      title: `Run ${TEST_STREAM_TOOL.name}?`,
      message: `${TEST_STREAM_TOOL.name}(${JSON.stringify(TEST_STREAM_TOOL.input)})`,
      options: [], placeholder: "", prefill: "", timeoutMs: null });
    record.pendingApproval = { requestId, step };
    record.activity = "waiting_for_user";
    this.publish(record, { type: "permission_request", generationId: record.turn.generationId,
      requestId, kind: "confirm",
      title: `Run ${TEST_STREAM_TOOL.name}?`,
      message: `${TEST_STREAM_TOOL.name}(${JSON.stringify(TEST_STREAM_TOOL.input)})`,
      options: [], placeholder: "", prefill: "", timeoutMs: null });
    this.publishState(record);
  }

  respondHostUi(id, response) {
    const record = this.get(id);
    if (!record) throw adapterError("No test stream session", "backend_unavailable", 404);
    const requestId = response?.id || response?.requestId;
    if (!requestId) throw adapterError("Host UI response requires id", "host_ui_id_required", 400);
    const pending = record.pendingApproval;
    record.hostUiRequests = record.hostUiRequests.filter((item) => item.id !== requestId);
    record.pendingApproval = null;
    this.publish(record, { type: "permission_resolved", generationId: record.generation?.id || null, requestId });
    record.activity = record.active ? "working" : "idle";
    this.publishState(record);
    if (!pending || pending.requestId !== requestId || !record.turn) return null;
    // A permission prompt fails closed, the same as the real harnesses: only an
    // explicit approval runs the step, so an ambiguous or unrecognised response
    // refuses rather than letting this backend vouch for behaviour the real one
    // would have denied.
    const approved = response.cancelled || response.dismissed ? false
      : typeof response.confirmed === "boolean" ? response.confirmed
        : ["yes", "approve"].includes(String(response.value ?? "").toLowerCase());
    if (!approved) {
      // Refused: the turn says so and stops, which is the shape a refusal takes
      // on a real harness -- the model is told, and there is nothing else to do
      // with a step it was not allowed to run.
      this.finish(record, "aborted");
      return null;
    }
    pending.step.approved = true;
    this.runTool(record, pending.step);
    return null;
  }

  /**
   * Take one queued message, if the turn has reached a place to take it.
   *
   * Steering is answered inside the running turn: the message is committed
   * where the turn had got to, and what comes after it is a new message
   * answering that. A follow-up waits for the turn to end, which is what the
   * two queues mean.
   */
  takeQueued(record) {
    const turn = record.turn;
    if (!turn || !record.queue.steering.length) return false;
    const queued = record.queue.steering.shift();
    turn.userMessages = (turn.userMessages || 1) + 1;
    this.closeAnswer(record, "toolUse");
    this.publish(record, messageOpen({ id: queued.messageId, role: "user",
      generationId: turn.generationId, content: queued.message, timestamp: new Date().toISOString() }));
    // The prompt the turn moves on from is over now.
    for (const promptId of turn.prompts) {
      this.publish(record, turnSettle({ promptId, outcome: "complete", generationId: turn.generationId }));
    }
    turn.answers = queued.messageId;
    turn.prompts = [queued.messageId];
    // What is left of the answer now answers the steer, and it gets a fresh
    // budget so a message steered at the end still produces something.
    turn.steps = turn.steps.slice(0, turn.step).concat(planTurn(Math.max(40, Math.round(record.tokens / 4)), 0));
    turn.step = turn.steps.length - 1;
    this.publishQueue(record);
    this.openAnswer(record);
    this.runStream(record);
    return true;
  }

  async queue(id, type, message, options = {}) {
    const record = this.get(id);
    if (!record) throw adapterError("No test stream session", "backend_unavailable", 404);
    const messageId = options.messageId || crypto.randomUUID();
    const entry = { messageId, message, attachments: attachmentSummary(options.attachments || []) };
    const list = type === "steer" ? record.queue.steering : record.queue.followUp;
    list.push(entry);
    this.publishQueue(record);
    return { attachmentIdentity: { afterMessageId: messageId, ordinal: 0 } };
  }

  async clearQueue(id) {
    const record = this.get(id);
    if (!record) throw adapterError("No test stream session", "backend_unavailable", 404);
    const { steering, followUp } = record.queue;
    const taken = [...steering, ...followUp];
    record.queue = { steering: [], followUp: [] };
    this.publishQueue(record);
    return {
      steering: steering.map((item) => item.message),
      followUp: followUp.map((item) => item.message),
      // The identity is the one handed back when the message was queued, so a
      // cleared message releases the attachments it was holding.
      discardedAttachmentIdentities: taken.filter((item) => item.attachments.length)
        .map((item) => ({ afterMessageId: item.messageId, ordinal: 0 })),
      discardedMessageIds: taken.map((item) => item.messageId),
    };
  }

  publishQueue(record) {
    this.publish(record, { type: "queue_state", generationId: record.generation?.id || null,
      queue: { steering: record.queue.steering.map((item) => item.message),
        followUp: record.queue.followUp.map((item) => item.message) } });
  }

  publishState(record) {
    this.publish(record, { type: "runtime_state", generationId: record.generation?.id || null,
      session: this.view(record), hostUiRequests: [...record.hostUiRequests],
      queue: { steering: record.queue.steering.map((item) => item.message),
        followUp: record.queue.followUp.map((item) => item.message) },
      contextUsage: this.contextUsage(record) });
  }

  /** Finish the message being written, with the reason it stopped. */
  closeAnswer(record, stopReason) {
    const turn = record.turn;
    if (!turn?.messageId) return;
    const blocks = [{ kind: "text", contentIndex: 0, text: turn.text }, ...turn.blocks];
    this.publish(record, { type: "assistant_content", generationId: turn.generationId, phase: "final",
      seq: ++record.generationSeq, messageId: turn.messageId, stopReason, errorMessage: null, blocks });
    this.publish(record, messageClose({ messageId: turn.messageId, stopReason,
      interim: stopReason === "toolUse",
      generationId: turn.generationId, keepsPartial: TEST_STREAM_CAPABILITIES.interruptKeepsPartial, blocks,
      model: record.model || null }));
  }

  finish(record, stopReason) {
    const turn = record.turn;
    if (!turn) return;
    if (record.timer) { clearTimeout(record.timer); record.timer = null; }
    this.closeAnswer(record, stopReason);
    record.turn = null;
    record.active = false;
    record.stopping = false;
    record.activity = "idle";
    // One user message for the prompt, one more for every steer taken mid-turn,
    // and one assistant message per answer opened -- a turn that called a tool
    // opened more than one.
    record.messages += (turn.userMessages || 1) + (turn.messages || 1);
    record.pendingApproval = null;
    record.hostUiRequests = [];
    Object.assign(record.generation, { closed: true, settled: true });
    for (const promptId of turn.prompts) {
      this.publish(record, turnSettle({ promptId, generationId: turn.generationId,
        outcome: stopReason === "aborted" ? "interrupted" : "complete" }));
    }
    this.publish(record, { type: "status", generationId: turn.generationId, seq: ++record.generationSeq,
      phase: stopReason === "aborted" ? "stopped" : "settled", status: "idle", activity: "idle", detail: null });
    this.publishUsage(record);
    // A follow-up waited for exactly this moment. It is a prompt of its own,
    // which is the difference between the two queues.
    const next = record.queue.followUp.shift();
    if (next) {
      this.publishQueue(record);
      void this.prompt(record.id, next.message, { clientUserMessageId: next.messageId });
    }
    this.emit("settled", { record, completed: stopReason !== "aborted" });
  }

  async cancel(id) {
    const record = this.get(id);
    if (!record || !record.active) return null;
    record.stopping = true;
    if (record.timer) { clearTimeout(record.timer); record.timer = null; }
    this.finish(record, "aborted");
    return null;
  }

  async close(id) {
    const record = this.get(id);
    if (!record) return null;
    if (record.timer) { clearTimeout(record.timer); record.timer = null; }
    record.turn = null;
    record.status = "stopped";
    record.active = false;
    this.sessions.remove(id);
    return null;
  }

  listModels() {
    return Promise.resolve(TEST_STREAM_SPEEDS.map((speed) => ({
      provider: "conduit-test", id: speed.id, spec: speed.id, label: speed.label,
      reasoning: true, thinkingLevels: TEST_STREAM_AMOUNTS.map((amount) => amount.id),
      defaultThinkingLevel: DEFAULT_AMOUNT_ID,
    })));
  }

  listAvailableModels() { return this.listModels(); }
  listCommands() { return Promise.resolve([]); }
  listAvailableCommands() { return Promise.resolve([]); }

  async setModel(id, model) {
    const record = this.get(id);
    // Only the speed: how much comes back is the level's business, and changing
    // one should not silently change the other.
    if (record) record.model = speedFor(model).id;
    return record?.model || DEFAULT_SPEED_ID;
  }

  async setThinkingLevel(id, level) {
    const record = this.get(id);
    if (record) {
      const amount = amountFor(level);
      record.thinkingLevel = amount.id;
      // A one-off amount named in a prompt applies to that prompt only, so the
      // level is what the next one goes back to.
      record.tokens = amount.tokens;
    }
    return record?.thinkingLevel || DEFAULT_AMOUNT_ID;
  }

  getModelState(id) {
    const record = this.get(id);
    return Promise.resolve({
      model: record?.model || DEFAULT_SPEED_ID,
      thinkingLevel: record?.thinkingLevel || DEFAULT_AMOUNT_ID,
    });
  }

  getCapabilities() { return TEST_STREAM_CAPABILITIES; }
  toClientEvent(event) { return event; }

  /**
   * What the turn so far looks like, for a browser that has just arrived.
   *
   * Reduced from the events this adapter published, with the same reducer the
   * browser runs -- so a reconnecting client is given the view it would have
   * built if it had never dropped the socket, and paint stays droppable for
   * this backend the way it is for Pi.
   */
  replay(id) {
    const record = this.get(id);
    return record?.activeGeneration
      ? { type: "generation_replay", generationId: record.activeGeneration.id,
        seq: record.activeGeneration.lastSeq, generation: snapshotActiveGeneration(record.activeGeneration) }
      : this.sessions.runtimeState(record);
  }

  waitForSession() { return Promise.resolve(); }

  attach(id, socket) {
    const replayed = this.sessions.attach(id, socket);
    const resume = this.replay(id);
    return resume?.type === "generation_replay" ? resume : replayed;
  }

  setFrameInterval(id, socket, ms) { return this.sessions.setFrameInterval(socket, ms); }

  view(record) {
    return {
      ...this.sessions.view(record),
      hostUiRequests: [...(record?.hostUiRequests || [])],
      queue: { steering: (record?.queue?.steering || []).map((item) => item.message),
        followUp: (record?.queue?.followUp || []).map((item) => item.message) },
      contextUsage: this.contextUsage(record),
      sessionStats: { totalMessages: record?.messages || 0 },
      cacheStats: { cacheHits: 0, cacheMisses: 0 },
    };
  }

  publish(record, event) {
    const stamped = this.sessions.publish(record, event);
    // The turn, folded as it is published. This is the server's copy: what a
    // paused or reconnecting socket is restated from.
    record.activeGeneration = reduceActiveGeneration(record.activeGeneration, stamped);
    return stamped;
  }

  /** What the turn has spent, counted rather than reported by a provider. */
  contextUsage(record) {
    const tokens = record?.streamed || 0;
    return { tokens, contextWindow: CONTEXT_WINDOW, percentUsed: Math.round((tokens / CONTEXT_WINDOW) * 100) };
  }

  publishUsage(record) {
    this.publish(record, { type: "usage", generationId: record.generation?.id || null,
      contextUsage: this.contextUsage(record),
      sessionStats: { totalMessages: record.messages },
      cacheStats: { cacheHits: 0, cacheMisses: 0 } });
  }

  async refreshContext(id) {
    const record = this.get(id);
    if (!record) return null;
    this.publishUsage(record);
    return this.contextUsage(record);
  }

  /**
   * Fold the context back down, as a harness with a model would.
   *
   * There is no history to summarise here -- the transcript is what it says and
   * nothing is sent to anyone -- so what compaction means for this backend is
   * exactly what the reader sees of it elsewhere: the context it has spent goes
   * back to nothing, with the transcript left alone.
   */
  async compact(id) {
    const record = this.get(id);
    if (!record) throw adapterError("No test stream session", "backend_unavailable", 404);
    this.publish(record, { type: "compaction", generationId: record.generation?.id || null, active: true });
    record.streamed = 0;
    this.publishUsage(record);
    this.publish(record, { type: "compaction", generationId: record.generation?.id || null, active: false });
    return { compacted: true };
  }

  /**
   * Cut the journal at an entry, and say what was asked there.
   *
   * A fork and a regenerate are the same cut: the history ends at the entry
   * given, and the caller decides what to ask next. The prompt's text is
   * returned so a regenerate can re-ask exactly what was asked before.
   */
  async fork(id, { nodeId } = {}) {
    const record = this.get(id);
    if (!record) throw adapterError("No test stream session", "backend_unavailable", 404);
    const messages = this.transcript(record.chatId);
    const index = messages.findIndex((message) => message.id === nodeId);
    if (index < 0) throw adapterError("No such entry in this chat", "entry_not_found", 404);
    const source = messages[index];
    // Everything from the entry on is gone, stated as one op rather than left
    // for the browser to work out from a shorter transcript.
    this.publish(record, messageDrop({ messageId: nodeId, inclusive: true,
      generationId: record.generation?.id || null }));
    return { opaqueSession: record.chatId, text: source.content || "",
      sourceMessage: { id: source.id, text: source.content || "" } };
  }

  transcript(chatId) {
    let messages = [];
    for (const event of this.journals.get(chatId) || []) messages = applyTranscriptOp(messages, event);
    return messages.filter((message) => !message.streaming);
  }

  async readTranscript({ liveSessionId, chatId }) {
    const record = liveSessionId ? this.get(liveSessionId) : null;
    // Nothing is stored beyond this process, so there is never an earlier page
    // and the read says so rather than leaving the browser to decide.
    return { messages: this.transcript(chatId || record?.chatId), tools: [], page: { before: null } };
  }

  /**
   * The chat as a tree, which is what a forkable history is.
   *
   * Linear until something is forked, like Pi's: the shape is the same either
   * way, and what makes it a tree is that an entry can be cut and asked again.
   * Every user message says so -- a prompt can be forked from or re-asked --
   * and an answer can be neither, because re-asking an answer means nothing.
   */
  async readHistory(options) {
    const { messages } = await this.readTranscript(options);
    let child = null;
    let leafId = null;
    for (const message of [...messages].reverse()) {
      if (!message.id) continue;
      const node = { entry: {
        id: message.id, parentId: null, timestamp: message.timestamp || null, type: "message",
        display: `${message.role}: ${String(message.content || "").replace(/\s+/g, " ").trim().slice(0, 240)}`,
        kind: message.role, hidden: false,
        forkable: message.role === "user", regeneratable: message.role === "user",
      }, children: child ? [child] : [] };
      if (child) child.entry.parentId = node.entry.id;
      else leafId = node.entry.id;
      child = node;
    }
    return { mode: "tree", leafId, tree: child ? [child] : [] };
  }

  get(id) { return this.sessions.get(id); }
  getByChatId(chatId) { return this.sessions.getByChatId(chatId); }
  rawRecords() { return this.sessions.rawRecords(); }
  list() { return this.sessions.list(); }
  stop(id) { void this.close(id); return Boolean(this.get(id)); }
}
