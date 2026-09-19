import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { SessionRecords } from "./harnesses/session-records.js";
import { applyTranscriptOp } from "./transcript-fold.js";
import { messageClose, messageOpen } from "./harnesses/transcript-ops.js";
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
export const TEST_STREAM_CAPABILITIES = Object.freeze({
  history: "linear",
  fork: false,
  regenerate: false,
  steer: false,
  followUpQueue: false,
  cancel: true,
  compaction: false,
  // How much comes back is this harness's decision, and a thinking level is
  // already a signal a harness interprets however it likes -- so the amount
  // rides on it, labelled in tokens. Two independent questions, the two
  // pickers that are already in the composer, and no new settings surface.
  thinkingLevels: true,
  modelSwitch: true,
  toolUse: false,
  approvals: false,
  permissionModes: false,
  usage: false,
  replay: false,
  attachments: false,
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

/** The nth token of the stream, including the paragraph breaks. */
export function tokenAt(index) {
  const word = WORDS[index % WORDS.length];
  if (index > 0 && index % 60 === 0) return `\n\n${word} `;
  return `${word} `;
}

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
      eventSequence: 0,
      timer: null,
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
    const messageId = `assistant-${generationId}`;
    record.tokens = amountFromPrompt(message, amountFor(record.thinkingLevel).tokens);
    record.active = true;
    record.activity = "working";
    record.stopping = false;
    record.generation = { id: generationId, closed: false, settled: false };
    // Both rows are named before a byte of the answer exists, so nothing
    // arriving later needs a place worked out for it.
    this.publish(record, messageOpen({ id: userMessageId, role: "user", generationId,
      content: message, timestamp: new Date().toISOString() }));
    this.publish(record, messageOpen({ id: messageId, role: "assistant", generationId, answers: userMessageId }));
    this.publish(record, { type: "status", generationId, seq: ++record.eventSequence,
      status: "working", activity: "working", detail: null });
    this.publish(record, { type: "assistant_content", generationId, phase: "start",
      seq: ++record.eventSequence, messageId });
    record.turn = { messageId, generationId, text: "", sent: 0 };
    this.runStream(record);
    return generationId;
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
    const total = Math.max(1, record.tokens || amountFor(record.thinkingLevel).tokens);
    const intervalMs = Math.max(TICK_FLOOR_MS, Math.floor(1000 / speed.tokensPerSecond));
    const startedAt = Date.now();
    const { messageId, generationId } = record.turn;

    const tick = () => {
      record.timer = null;
      if (!record.turn || record.stopping) return;
      const due = Math.min(total, Math.ceil(((Date.now() - startedAt) / 1000) * speed.tokensPerSecond));
      while (record.turn.sent < due) {
        const delta = tokenAt(record.turn.sent);
        record.turn.text += delta;
        record.turn.sent += 1;
        this.publish(record, { type: "assistant_content", generationId, phase: "delta",
          seq: ++record.eventSequence, messageId, contentIndex: 0, blockKind: "text", delta });
      }
      if (record.turn.sent >= total) { this.finish(record, "stop"); return; }
      record.timer = setTimeout(tick, intervalMs);
    };
    record.timer = setTimeout(tick, intervalMs);
  }

  finish(record, stopReason) {
    const turn = record.turn;
    if (!turn) return;
    record.turn = null;
    if (record.timer) { clearTimeout(record.timer); record.timer = null; }
    const blocks = [{ kind: "text", contentIndex: 0, text: turn.text }];
    this.publish(record, { type: "assistant_content", generationId: turn.generationId, phase: "final",
      seq: ++record.eventSequence, messageId: turn.messageId, stopReason, errorMessage: null, blocks });
    this.publish(record, messageClose({ messageId: turn.messageId, stopReason, interim: false,
      generationId: turn.generationId, keepsPartial: TEST_STREAM_CAPABILITIES.interruptKeepsPartial, blocks }));
    record.active = false;
    record.stopping = false;
    record.activity = "idle";
    Object.assign(record.generation, { closed: true, settled: true });
    this.publish(record, { type: "status", generationId: turn.generationId, seq: ++record.eventSequence,
      status: "idle", activity: "idle", detail: stopReason === "aborted" ? "stopped" : "settled" });
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
  replay(id) { return this.sessions.runtimeState(this.get(id)); }
  waitForSession() { return Promise.resolve(); }
  attach(id, socket) { return this.sessions.attach(id, socket); }
  view(record) { return this.sessions.view(record); }
  publish(record, event) { return this.sessions.publish(record, event); }

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

  async readHistory(options) {
    const { messages } = await this.readTranscript(options);
    let child = null;
    let leafId = null;
    for (const message of [...messages].reverse()) {
      if (!message.id) continue;
      const node = { entry: {
        id: message.id, parentId: null, timestamp: message.timestamp || null, type: "message",
        display: `${message.role}: ${String(message.content || "").replace(/\s+/g, " ").trim().slice(0, 240)}`,
        kind: message.role, hidden: false, forkable: false, regeneratable: false,
      }, children: child ? [child] : [] };
      if (child) child.entry.parentId = node.entry.id;
      else leafId = node.entry.id;
      child = node;
    }
    return { mode: "linear", leafId, tree: child ? [child] : [] };
  }

  get(id) { return this.sessions.get(id); }
  getByChatId(chatId) { return this.sessions.getByChatId(chatId); }
  rawRecords() { return this.sessions.rawRecords(); }
  list() { return this.sessions.list(); }
  stop(id) { void this.close(id); return Boolean(this.get(id)); }
}
