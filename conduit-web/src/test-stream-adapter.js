import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { SessionRecords } from "./harnesses/session-records.js";
import { beginTurn, endTurn, turnEnded, turnStarted } from "./harnesses/turn.js";
import { ask, asked, hostsOf, take, takeAll } from "./harnesses/host-requests.js";
import { applyTranscriptOps } from "./transcript-fold.js";
import { messageClose, messageDrop, messageOpen, toolClose, toolOpen, turnSettle } from "./harnesses/transcript-ops.js";
import { reduceActiveGeneration, snapshotActiveGeneration } from "./active-generation.js";
import { unsupported } from "./harnesses/unsupported.js";
import { KATEX_COMPENDIUM, KATEX_LIMITS, MARKDOWN_MIX, RICH_MIX, RICH_PROSE } from "./test-stream-replays.js";

/*
 * A backend with no model, to put the real live path under evenly paced delta pressure: a real harness's rate is
 * whatever the provider felt like that second, so a slow frame and a slow provider look identical. Pacing is held
 * against the wall clock, so a late tick emits what it owes instead of stretching the run.
 */
export const TEST_STREAM_CAPABILITIES = Object.freeze({
  history: "tree",
  fork: true,
  regenerate: true,
  steer: true,
  followUpQueue: true,
  cancel: true,
  compaction: true,
  // The thinking level carries the amount, labelled in tokens, so no new settings surface is needed.
  thinkingLevels: true,
  modelSwitch: true,
  toolUse: true,
  approvals: true,
  permissionModes: false,
  usage: true,
  replay: true,
  attachments: true,
  // True here only: this backend's journal is its transcript and there is no model to disagree with it, so a stopped
  // answer stands. It is the only coverage Conduit has of the `discarded: false` close.
  interruptKeepsPartial: true,
});

// `paced-60` is the control: a frame dropped at 60 tokens/s is not the stream's fault.
export const TEST_STREAM_SPEEDS = Object.freeze([
  { id: "paced-60", label: "60 tok/s · like a real model", tokensPerSecond: 60 },
  // Even ticks flatter any reveal; this is the pause-then-paragraph a real turn has, repeatably.
  { id: "bursty-60", label: "60 tok/s in bursts · like a real provider", tokensPerSecond: 60, gapsMs: [40, 120, 60, 350, 80, 1200, 150, 90] },
  { id: "fast-250", label: "250 tok/s", tokensPerSecond: 250 },
  { id: "fast-1000", label: "1000 tok/s", tokensPerSecond: 1000 },
  { id: "flood-4000", label: "4000 tok/s · past any provider", tokensPerSecond: 4000 },
].map(Object.freeze));

const REPLAY_ALIASES = new Map([
  ["replay-markdown", { pace: "paced-60", replay: MARKDOWN_MIX }],
  ["replay-markdown-bursty", { pace: "bursty-60", replay: MARKDOWN_MIX }],
  ["replay-katex-limits", { pace: "paced-60", replay: KATEX_LIMITS }],
  ["replay-katex-compendium", { pace: "paced-60", replay: KATEX_COMPENDIUM }],
]);

// A long run is where a leak or a growing reconcile shows, which a short run never would.
export const TEST_STREAM_AMOUNTS = Object.freeze([
  { id: "400 tokens", tokens: 400 },
  { id: "2000 tokens", tokens: 2000 },
  { id: "8000 tokens", tokens: 8000 },
  { id: "32000 tokens", tokens: 32_000 },
].map(Object.freeze));

export const DEFAULT_SPEED_ID = "fast-250";
export const DEFAULT_AMOUNT_ID = "2000 tokens";
const MAX_TOKENS = 100_000;
// setTimeout cannot be trusted below a couple of milliseconds, so past roughly 500 tokens/s a tick emits several
// tokens; the rate stays honest, only the deltas-per-tick change.
const TICK_FLOOR_MS = 2;
// More than this in one turn is a typo in the prompt rather than a request.
const MAX_TOOL_RUNS = 8;
const CONTEXT_WINDOW = 200_000;

const WORDS = ("the quick brown fox jumps over a lazy dog while conduit streams tokens through "
  + "its transcript at a fixed and deliberate pace so that every frame can be measured against "
  + "the last one without a provider deciding how fast today is going to be").split(" ");

const adapterError = (message, code = "backend_unavailable", status = 409) =>
  Object.assign(new Error(message), { code, status });

export const speedFor = (id) => TEST_STREAM_SPEEDS.find((speed) => speed.id === (REPLAY_ALIASES.get(id)?.pace || id))
  || TEST_STREAM_SPEEDS.find((speed) => speed.id === DEFAULT_SPEED_ID);
export const amountFor = (id) => TEST_STREAM_AMOUNTS.find((amount) => amount.id === id)
  || TEST_STREAM_AMOUNTS.find((amount) => amount.id === DEFAULT_AMOUNT_ID);

export function amountFromPrompt(message, fallback) {
  const match = /(\d+)\s*t\b/i.exec(String(message || ""));
  if (!match) return fallback;
  return Math.min(MAX_TOKENS, Math.max(1, Number(match[1])));
}

function toolRunsFromPrompt(message) {
  const match = /(\d+)\s*tools?\b/i.exec(String(message || ""));
  if (match) return Math.min(MAX_TOOL_RUNS, Math.max(0, Number(match[1])));
  return /\btools?\b/i.test(String(message || "")) ? 1 : 0;
}

// A number ending in t is the answer's length, not the thinking's.
const THINKING_TOKENS = 400;
function thinkingFromPrompt(message) {
  const match = /\bthink(?:ing)?\b(?:\s+(\d+)(?!\d|\s*t\b))?/i.exec(String(message || ""));
  if (!match) return 0;
  return match[1] ? Math.min(MAX_TOKENS, Math.max(1, Number(match[1]))) : THINKING_TOKENS;
}

const narrationFromPrompt = (message) => /\bnarrat/i.test(String(message || ""));
const richFromPrompt = (message) => /\brich\b/i.test(String(message || ""));
function replayFromPrompt(message) {
  const text = String(message || "");
  if (/\bkatex(?:\s+|-)limits\b/i.test(text)) return KATEX_LIMITS;
  if (/\bkatex\b/i.test(text)) return KATEX_COMPENDIUM;
  if (/\bmarkdown\b/i.test(text)) return MARKDOWN_MIX;
  return null;
}
export const TEST_STREAM_DENIED = "Denied: the user did not allow this call.";
const approvalFromPrompt = (message) => /\bapprove|approval\b/i.test(String(message || ""));

export const TEST_STREAM_TOOL = Object.freeze({
  name: "read_file",
  kind: "read",
  subject: "docs/testing.md",
  input: Object.freeze({ path: "docs/testing.md" }),
  output: "docs/testing.md: approach selection, commands, safety boundaries, evidence.",
});

// About four characters a token, as a provider's tokenizer cuts prose.
const replayTokenCache = new Map();
export function replayTokens(text) {
  if (!replayTokenCache.has(text)) replayTokenCache.set(text, text.match(/\s*\S{1,4}|\s+/g) || []);
  return replayTokenCache.get(text);
}

const loopedToken = (text, index) => { const tokens = replayTokens(text); return tokens[index % tokens.length]; };

export function tokenAt(index) {
  const word = WORDS[index % WORDS.length];
  if (index > 0 && index % 60 === 0) return `\n\n${word} `;
  return `${word} `;
}

/*
 * Shaped as real models work with tools: each message opens with its own thinking, then its call, and the long text is
 * the final answer alone. Most real calls have no text before them, so narration is opt-in. Planned up front so the
 * same prompt produces the same turn, down to which token the call lands on.
 */
const NARRATION = " I'll read docs/testing.md to see what it says first.";
function planTurn(tokens, toolRuns, thinking = 0, narrate = false) {
  const total = Math.max(1, tokens);
  const thought = thinking ? Math.max(20, Math.floor(thinking / (toolRuns + 1))) : 0;
  const steps = [];
  for (let run = 0; run < toolRuns; run += 1) {
    if (thought) steps.push({ kind: "thinking", tokens: thought });
    if (narrate) steps.push({ kind: "text", text: NARRATION, tokens: replayTokens(NARRATION).length });
    steps.push({ kind: "tool", toolCallId: `call_${run + 1}` });
  }
  if (thought) steps.push({ kind: "thinking", tokens: thought });
  steps.push({ kind: "text", tokens: total });
  return steps;
}

const attachmentSummary = (attachments) => attachments.map((item) => ({
  id: item.id, name: item.name || item.id, mimeType: item.mimeType || "application/octet-stream",
}));

export class TestStreamAdapter extends EventEmitter {
  constructor({ dataDir = null, logs = null } = {}) {
    super();
    this.sessions = new SessionRecords({
      capabilities: TEST_STREAM_CAPABILITIES,
      backend: { protocol: "native_api", implementation: "test-stream", installationId: "conduit-test-stream" },
      extras: (record) => ({ rate: speedFor(record.model).label, thinkingLevel: record.thinkingLevel, tokens: record.tokens }),
      // Nothing outside Conduit knows these chats, so the statements are the transcript, each durable before it is
      // broadcast.
      onPublish: (record, event) => {
        if (event.type === "transcript_op") this.appendJournal(record.chatId, event);
      },
      logs,
    });
    this.dataDir = dataDir;
    this.journals = new Map();
    this.logs = logs;
    this.records = this.sessions.records;
    this.byChatId = this.sessions.byChatId;
    Object.assign(this, unsupported(TEST_STREAM_CAPABILITIES, { label: "Render test" }));
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
      active: false,
      stopping: false,
      model: REPLAY_ALIASES.has(model) ? model : speedFor(model).id,
      thinkingLevel: amount.id,
      tokens: amount.tokens,
      generation: null,
      clients: new Set(),
      events: [],
      generationSeq: 0,
      timer: null,
      queue: { steering: [], followUp: [] },
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
    // The browser drew this row before it sent the prompt; inventing an id would state a second row for it.
    const userMessageId = options?.clientUserMessageId || crypto.randomUUID();
    const replay = REPLAY_ALIASES.get(record.model)?.replay || replayFromPrompt(message);
    record.tokens = replay ? replayTokens(replay).length : amountFromPrompt(message, amountFor(record.thinkingLevel).tokens);
    beginTurn(record, generationId);
    this.publish(record, messageOpen({ id: userMessageId, role: "user", generationId,
      content: message, timestamp: new Date().toISOString(),
      ...(options?.attachments?.length ? { attachments: attachmentSummary(options.attachments) } : {}) }));
    this.publish(record, turnStarted(record));
    record.turn = {
      generationId,
      answers: userMessageId,
      prompts: [userMessageId],
      // Tool records are keyed by id for the whole chat, so a second turn's call_1 would be folded over the first's.
      steps: planTurn(record.tokens, toolRunsFromPrompt(message), thinkingFromPrompt(message), narrationFromPrompt(message))
        .map((step) => (step.toolCallId ? { ...step, toolCallId: `${step.toolCallId}_${generationId.slice(0, 8)}` } : step)),
      step: 0,
      rich: richFromPrompt(message),
      replay,
      approvals: approvalFromPrompt(message),
      attachments: attachmentSummary(options?.attachments || []),
      sent: 0,
      userMessages: 1,
      messageId: null,
      text: "",
      blocks: [],
      contentIndex: 0,
    };
    // A client that missed this transition would show the turn as submitting for as long as it ran.
    this.publish(record, { type: "status", generationId, phase: "running", seq: ++record.generationSeq,
      status: "working", activity: "working", detail: null });
    this.openAnswer(record);
    // A turn that opens on its call makes it a tick later, so a message sent with the prompt is read after it.
    const turn = record.turn;
    if (turn.steps[0].kind === "tool") record.timer = setTimeout(() => { record.timer = null; if (record.turn === turn && !record.stopping) this.runTool(record, turn.steps[0]); }, 0);
    else this.runStream(record);
    return generationId;
  }

  openAnswer(record) {
    const turn = record.turn;
    turn.messageId = `assistant-${turn.generationId}-${turn.messages = (turn.messages || 0) + 1}`;
    turn.text = "";
    turn.thinking = "";
    turn.textIndex = 0;
    turn.blocks = [];
    turn.contentIndex = 0;
    this.publish(record, messageOpen({ id: turn.messageId, role: "assistant",
      generationId: turn.generationId, answers: turn.answers }));
    this.publish(record, { type: "assistant_content", generationId: turn.generationId, phase: "start",
      seq: ++record.generationSeq, messageId: turn.messageId });
  }

  // The count comes from elapsed time, not ticks fired, so measurements read the renderer's cost rather than this
  // scheduler's drift.
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
    const blockKind = step.kind === "thinking" ? "thinking" : "text";
    let gap = 0;
    const nextDelay = () => speed.gapsMs ? speed.gapsMs[gap++ % speed.gapsMs.length] : intervalMs;

    const tick = () => {
      record.timer = null;
      if (!record.turn || record.stopping || record.turn !== turn) return;
      const due = Math.min(target, from + Math.ceil(((Date.now() - startedAt) / 1000) * speed.tokensPerSecond));
      const emit = (delta) => this.publish(record, { type: "assistant_content", generationId, phase: "delta",
        seq: ++record.generationSeq, messageId, contentIndex, blockKind, delta });
      // Bursts arrive as one delta, the way a provider's chunk does.
      let burst = "";
      while (turn.sent < due) {
        const delta = step.text ? replayTokens(step.text)[turn.sent - from] ?? ""
          : turn.replay ? replayTokens(turn.replay)[turn.sent] ?? ""
          : turn.rich ? loopedToken(blockKind === "thinking" ? RICH_PROSE : RICH_MIX, turn.sent - from) : tokenAt(turn.sent);
        if (blockKind === "thinking") turn.thinking += delta;
        else turn.text += delta;
        turn.sent += 1;
        record.streamed += 1;
        if (speed.gapsMs) burst += delta;
        else emit(delta);
      }
      if (burst) emit(burst);
      if (turn.sent >= target) {
        if (blockKind === "thinking") turn.textIndex = turn.contentIndex += 1;
        this.advance(record);
        return;
      }
      record.timer = setTimeout(tick, nextDelay());
    };
    record.timer = setTimeout(tick, nextDelay());
  }

  // A step boundary is where a real harness notices its queue: waiting for the turn to end would make steering
  // indistinguishable from a follow-up.
  advance(record) {
    const turn = record.turn;
    if (!turn) return;
    const finished = turn.steps[turn.step];
    turn.step += 1;
    const next = turn.steps[turn.step];
    // Never between thinking and the answer it leads to.
    if (next && finished?.kind !== "thinking" && this.takeQueued(record)) return;
    if (!next) return this.finish(record, "stop");
    if (next.kind === "tool") return this.runTool(record, next);
    this.runStream(record);
  }

  runTool(record, step) {
    const turn = record.turn;
    const { generationId, messageId } = turn;
    const toolCallId = step.toolCallId;
    const input = TEST_STREAM_TOOL.input;
    if (!step.called) {
      step.called = true;
      turn.contentIndex += 1;
      const contentIndex = turn.contentIndex;
      // The reducers at both ends build a call out of a `tool_call` block.
      this.publish(record, { type: "assistant_content", generationId, phase: "delta",
        seq: ++record.generationSeq, messageId, contentIndex, blockKind: "tool_call",
        delta: JSON.stringify(input) });
      turn.blocks.push({ kind: "tool_call", contentIndex, toolCallId, name: TEST_STREAM_TOOL.name, input });
      this.publish(record, toolOpen({ toolCallId, name: TEST_STREAM_TOOL.name, kind: TEST_STREAM_TOOL.kind, subject: TEST_STREAM_TOOL.subject, input,
        messageId, generationId }));
    }
    // Asked about once the call is made, as a harness asks: the model has called it, and it waits to run.
    if (turn.approvals && !step.approved) return this.askApproval(record, step);
    this.publish(record, { type: "tool_activity", phase: "start", generationId,
      seq: ++record.generationSeq, toolCallId, name: TEST_STREAM_TOOL.name, kind: TEST_STREAM_TOOL.kind, subject: TEST_STREAM_TOOL.subject, input });
    this.publish(record, { type: "tool_activity", phase: "update", generationId,
      seq: ++record.generationSeq, toolCallId, name: TEST_STREAM_TOOL.name, input,
      output: TEST_STREAM_TOOL.output.slice(0, 24) });
    this.publish(record, { type: "tool_activity", phase: "end", generationId,
      seq: ++record.generationSeq, toolCallId, name: TEST_STREAM_TOOL.name,
      output: TEST_STREAM_TOOL.output, isError: false });
    this.publish(record, toolClose({ toolCallId, output: TEST_STREAM_TOOL.output, generationId }));
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

  askApproval(record, step) {
    const requestId = `approval-${step.toolCallId}`;
    this.publish(record, ask(record, requestId, { id: requestId, kind: "confirm",
      title: `Run ${TEST_STREAM_TOOL.name}?`,
      message: `${TEST_STREAM_TOOL.name}(${JSON.stringify(TEST_STREAM_TOOL.input)})`,
      options: [], placeholder: "", prefill: "", timeoutMs: null }, { step, generationId: record.turn.generationId }));
    this.publishState(record);
  }

  respondHostUi(id, response) {
    const record = this.get(id);
    if (!record) throw adapterError("No test stream session", "backend_unavailable", 404);
    const requestId = response?.id || response?.requestId;
    if (!requestId) throw adapterError("Host UI response requires id", "host_ui_id_required", 400);
    // An answer to a prompt that is no longer up leaves the one that is alone.
    const pending = take(record, requestId);
    if (!pending) return null;
    this.publish(record, pending.event);
    this.publishState(record);
    if (!record.turn) return null;
    // Fails closed, as the real harnesses do: an ambiguous or unrecognised response refuses.
    const approved = response.cancelled || response.dismissed ? false
      : typeof response.confirmed === "boolean" ? response.confirmed
        : ["yes", "approve"].includes(String(response.value ?? "").toLowerCase());
    if (!approved) {
      const { generationId } = record.turn;
      const toolCallId = pending.step.toolCallId;
      this.publish(record, { type: "tool_activity", phase: "end", generationId, seq: ++record.generationSeq,
        toolCallId, name: TEST_STREAM_TOOL.name, output: TEST_STREAM_DENIED, isError: true });
      this.publish(record, toolClose({ toolCallId, output: TEST_STREAM_DENIED, isError: true, generationId }));
      this.closeAnswer(record, "toolUse");
      this.openAnswer(record);
      this.advanceAfterTool(record);
      return null;
    }
    pending.step.approved = true;
    this.runTool(record, pending.step);
    return null;
  }

  takeQueued(record) {
    const turn = record.turn;
    if (!turn || !record.queue.steering.length) return false;
    const queued = record.queue.steering.shift();
    turn.userMessages = (turn.userMessages || 1) + 1;
    this.closeAnswer(record, "toolUse");
    // Off the queue before it is in the transcript, so it is never in both.
    this.publishQueue(record);
    this.publish(record, messageOpen({ id: queued.messageId, role: "user",
      generationId: turn.generationId, content: queued.message, timestamp: new Date().toISOString() }));
    for (const promptId of turn.prompts) {
      this.publish(record, turnSettle({ promptId, outcome: "complete", generationId: turn.generationId }));
    }
    turn.answers = queued.messageId;
    turn.prompts = [queued.messageId];
    // A fresh budget, so a message steered at the end still produces something.
    turn.steps = turn.steps.slice(0, turn.step).concat(planTurn(Math.max(40, Math.round(record.tokens / 4)), 0));
    turn.step = turn.steps.length - 1;
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
      // The identity handed back when the message was queued, so a cleared message releases its attachments.
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
      session: this.view(record), hostUiRequests: hostsOf(record),
      queue: { steering: record.queue.steering.map((item) => item.message),
        followUp: record.queue.followUp.map((item) => item.message) },
      contextUsage: this.contextUsage(record) });
  }

  closeAnswer(record, stopReason) {
    const turn = record.turn;
    if (!turn?.messageId) return;
    const blocks = [
      ...(turn.thinking ? [{ kind: "thinking", contentIndex: 0, text: turn.thinking, redacted: false }] : []),
      ...(turn.text ? [{ kind: "text", contentIndex: turn.textIndex || 0, text: turn.text }] : []),
      ...turn.blocks,
    ];
    this.publish(record, { type: "assistant_content", generationId: turn.generationId, phase: "final",
      seq: ++record.generationSeq, messageId: turn.messageId, stopReason, errorMessage: null, blocks });
    this.publish(record, messageClose({ messageId: turn.messageId, stopReason,
      interim: stopReason === "toolUse",
      generationId: turn.generationId, keepsPartial: TEST_STREAM_CAPABILITIES.interruptKeepsPartial, blocks,
      model: record.model || null, timestamp: new Date().toISOString() }));
  }

  finish(record, stopReason) {
    const turn = record.turn;
    if (!turn) return;
    if (record.timer) { clearTimeout(record.timer); record.timer = null; }
    // Stopped while a call waited for approval: the call goes with the turn.
    const waiting = asked(record)[0]?.step;
    if (waiting?.called) this.publish(record, toolClose({ toolCallId: waiting.toolCallId, output: "", cancelled: true, generationId: turn.generationId }));
    this.closeAnswer(record, stopReason);
    record.turn = null;
    const outcome = stopReason === "aborted" ? "interrupted" : "complete";
    endTurn(record, outcome);
    // A turn that called a tool opened more than one assistant message.
    record.messages += (turn.userMessages || 1) + (turn.messages || 1);
    for (const pending of takeAll(record)) this.publish(record, pending.event);
    for (const promptId of turn.prompts) this.publish(record, turnSettle({ promptId, generationId: turn.generationId, outcome }));
    this.publish(record, turnEnded(record, outcome, turn.generationId));
    this.publishUsage(record);
    // A steer still waiting when the answer ended is ready too.
    const next = (stopReason !== "aborted" && record.queue.steering.shift()) || record.queue.followUp.shift();
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
    // Only the speed: changing one should not silently change the amount.
    if (record) record.model = REPLAY_ALIASES.has(model) ? model : speedFor(model).id;
    return record?.model || DEFAULT_SPEED_ID;
  }

  async setThinkingLevel(id, level) {
    const record = this.get(id);
    if (record) {
      const amount = amountFor(level);
      record.thinkingLevel = amount.id;
      // A one-off amount named in a prompt applies to that prompt only.
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

  // The same reducer the browser runs, so a reconnecting client gets the view it would have built had it never dropped.
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
      hostUiRequests: hostsOf(record),
      queue: { steering: (record?.queue?.steering || []).map((item) => item.message),
        followUp: (record?.queue?.followUp || []).map((item) => item.message) },
      contextUsage: this.contextUsage(record),
      sessionStats: { totalMessages: record?.messages || 0 },
      cacheStats: { cacheHits: 0, cacheMisses: 0 },
    };
  }

  publish(record, event) {
    const stamped = this.sessions.publish(record, event);
    // The server's copy: what a paused or reconnecting socket is restated from.
    record.activeGeneration = reduceActiveGeneration(record.activeGeneration, stamped);
    return stamped;
  }

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

  // There is no history to summarise, so compaction only takes the context spent back to nothing.
  async compact(id) {
    const record = this.get(id);
    if (!record) throw adapterError("No test stream session", "backend_unavailable", 404);
    this.publish(record, { type: "compaction", generationId: record.generation?.id || null, active: true });
    record.streamed = 0;
    this.publishUsage(record);
    this.publish(record, { type: "compaction", generationId: record.generation?.id || null, active: false });
    return { compacted: true };
  }

  // A fork and a regenerate are the same cut; the prompt's text is returned so a regenerate can re-ask it.
  async fork(id, { nodeId } = {}) {
    const record = this.get(id);
    if (!record) throw adapterError("No test stream session", "backend_unavailable", 404);
    const messages = this.transcript(record.chatId);
    const index = messages.findIndex((message) => message.id === nodeId);
    if (index < 0) throw adapterError("No such entry in this chat", "entry_not_found", 404);
    const source = messages[index];
    // Stated as one op rather than left for the browser to work out from a shorter transcript.
    this.publish(record, messageDrop({ messageId: nodeId, inclusive: true,
      generationId: record.generation?.id || null }));
    return { opaqueSession: record.chatId, text: source.content || "",
      sourceMessage: { id: source.id, text: source.content || "" } };
  }

  journalPath(chatId) { return this.dataDir ? path.join(this.dataDir, "journals", `${chatId}.jsonl`) : null; }

  // Without its seq: that belongs to a log that dies with the process.
  appendJournal(chatId, event) {
    const { log: _log, seq: _seq, ...durable } = event;
    const file = this.journalPath(chatId);
    if (!file) {
      this.journals.set(chatId, [...(this.journals.get(chatId) || []), durable]);
      return;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(durable) + "\n", { mode: 0o600 });
  }

  readJournal(chatId) {
    const file = this.journalPath(chatId);
    if (!file) return this.journals.get(chatId) || [];
    try { return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch { return []; }
  }

  fold(chatId) {
    const { messages, tools } = applyTranscriptOps({}, this.readJournal(chatId));
    // A row still marked as arriving is one the process died holding; nothing will finish it now.
    const kept = messages.filter((message) => !message.streaming);
    const calls = new Set(kept.flatMap((message) => (message.blocks || []).map((block) => block.toolCallId).filter(Boolean)));
    return { messages: kept, tools: calls.size ? tools.filter((tool) => calls.has(tool.toolCallId)) : tools };
  }

  transcript(chatId) { return this.fold(chatId).messages; }

  async readTranscript({ liveSessionId, chatId }) {
    const record = liveSessionId ? this.get(liveSessionId) : null;
    // The journal is the whole chat, so there is never an earlier page.
    return { ...this.fold(chatId || record?.chatId), page: { before: null } };
  }

  // An answer can be neither forked from nor re-asked: re-asking an answer means nothing.
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
