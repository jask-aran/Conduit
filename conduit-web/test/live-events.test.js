import assert from "node:assert/strict";
import test from "node:test";
import { isStructuredGenerationEvent, normalizeLiveEvent } from "../src/client/api/live-events.ts";

test("preserves a sync that replaces the whole transcript", () => {
  assert.deepEqual(normalizeLiveEvent({
    type: "transcript_sync",
    generationId: null,
    replace: true,
    messages: [{ id: "user-kept", role: "user" }],
    tools: [],
  }), {
    type: "transcript_sync",
    generationId: null,
    replace: true,
    messages: [{ id: "user-kept", role: "user" }],
    tools: [],
  });
});

test("an op arrives at the client as the server stated it", () => {
  // Not rebuilt: the op is checked where it is made, and anything the builders
  // add travels without this file learning about it first.
  const op = {
    type: "transcript_op",
    op: "message.open",
    generationId: "g1",
    after: "m_prompt",
    answers: "m_prompt",
    message: { id: "m_answer", role: "assistant" },
    log: { id: "log-1", seq: 7 },
  };
  assert.deepEqual(normalizeLiveEvent(op), op);
  // An op name nothing applies is not passed through as one.
  assert.deepEqual(normalizeLiveEvent({ ...op, op: "message.rewrite" }),
    { type: "unknown", sourceType: "transcript_op", generationId: "g1", log: { id: "log-1", seq: 7 } });
});

test("a generation event is folded only if it carries what the folds read", () => {
  const final = { type: "assistant_content", phase: "final", generationId: "g1", seq: 4,
    messageId: "m1", blocks: [], stopReason: "stop" };
  assert.deepEqual(normalizeLiveEvent(final), final, "stated as the server sent it");
  // Blocks the browser's store maps over. Without them this passed the boundary
  // and threw inside the fold, which is a crash rather than a dropped event.
  assert.equal(normalizeLiveEvent({ ...final, blocks: undefined }).type, "unknown");
  // A phase neither fold has a case for takes no place in the turn.
  assert.equal(normalizeLiveEvent({ ...final, phase: "midway" }).type, "unknown");
  // What the session is busy with is not a transition, and no longer travels as
  // a status with no phase.
  assert.equal(normalizeLiveEvent({ type: "status", generationId: "g1", seq: 5, activity: "waiting_for_user" }).type,
    "unknown");
  const delta = { type: "assistant_content", phase: "delta", generationId: "g1", seq: 5,
    messageId: "m1", contentIndex: 0, blockKind: "text", delta: "hi" };
  assert.deepEqual(normalizeLiveEvent(delta), delta);
  assert.equal(normalizeLiveEvent({ ...delta, contentIndex: undefined }).type, "unknown");
  // A block is text, thinking or a tool call. Anything else is a block kind the
  // renderer has no case for, arriving as one it does.
  assert.equal(normalizeLiveEvent({ ...delta, blockKind: "diagram" }).type, "unknown");
  // And a tool is named when it starts, because that is what the row says while
  // it runs.
  const tool = { type: "tool_activity", phase: "start", generationId: "g1", seq: 6,
    toolCallId: "call_1", name: "read", input: {} };
  assert.deepEqual(normalizeLiveEvent(tool), tool);
  assert.equal(normalizeLiveEvent({ ...tool, name: undefined }).type, "unknown");
});

test("normalizes host UI events into the client discriminated union", () => {
  // Stated flat, the way the contract states it. The nested `request` is
  // derived for the dialog; the rest of the frame travels with it.
  const event = normalizeLiveEvent({
    type: "permission_request",
    generationId: 42,
    requestId: "request_1",
    kind: "select",
    title: "Choose",
    options: ["one", 2],
    grantRoot: "/tmp",
  });
  assert.equal(event.type, "permission_request");
  assert.equal(event.generationId, "42");
  assert.equal(event.requestId, "request_1");
  assert.equal(event.grantRoot, "/tmp");
  assert.deepEqual(event.request, {
    id: "request_1",
    kind: "select",
    title: "Choose",
    message: "",
    options: ["one", "2"],
    placeholder: "",
    prefill: "",
    timeoutMs: null,
    grantRoot: "/tmp",
  });
});

test("normalizes runtime state without a legacy event replay", () => {
  const event = normalizeLiveEvent({
    type: "runtime_state",
    session: {
      active: true,
      generation: { id: "g1", closed: false },
      queue: { steering: ["now"] },
      sessionStats: { userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0.01 },
      cacheStats: { eligibleTokens: 100, cacheHits: 80, cacheMissedTokens: 20, eligibleRequests: 1, eligibleHitRate: 0.8 },
    },
  });
  assert.equal(event.type, "runtime_state");
  assert.equal(event.session.generation.id, "g1");
  assert.deepEqual(event.session.queue, { steering: ["now"], followUp: [] });
  assert.equal(event.session.sessionStats.tokens.total, 15);
  assert.equal(event.session.cacheStats.eligibleHitRate, 0.8);
});

test("normalizes aggregate session stats on context usage updates", () => {
  const event = normalizeLiveEvent({
    type: "usage",
    contextUsage: { tokens: null, contextWindow: 128000, percent: null },
    sessionStats: { userMessages: 2, assistantMessages: 2, toolCalls: 1, toolResults: 1, totalMessages: 5, tokens: { input: 100, output: 40, cacheRead: 20, cacheWrite: 10, total: 170 }, cost: 0.123 },
    cacheStats: { eligibleTokens: 500, cacheHits: 450, cacheMissedTokens: 50, eligibleRequests: 4, eligibleHitRate: 0.9 },
  });
  assert.equal(event.type, "usage");
  assert.equal(event.contextUsage.tokens, null);
  assert.equal(event.sessionStats.toolCalls, 1);
  assert.equal(event.cacheStats.eligibleTokens, 500);
});

test("an error states whose fault it was", () => {
  // Two event names used to carry this, and only Pi's adapter knew to rename
  // either of them. A rejected command must not read as a failed turn.
  const rejected = normalizeLiveEvent({
    type: "error", scope: "request", generationId: "g1",
    error: { code: "invalid_request", message: "not JSON" },
  });
  assert.deepEqual(rejected, { type: "error", scope: "request", generationId: "g1",
    error: { code: "invalid_request", message: "not JSON" } });
  const failed = normalizeLiveEvent({
    type: "error", generationId: "g1", error: { code: "backend_unavailable", message: "gone" },
  });
  assert.equal(failed.scope, "runtime", "an unscoped error is the runtime's");
});

test("preserves a checkpoint's durable chat title", () => {
  assert.deepEqual(normalizeLiveEvent({
    type: "session_checkpoint",
    generationId: "g4",
    chat: { id: "chat_1", title: "Tell me a long story" },
  }), {
    type: "session_checkpoint",
    generationId: "g4",
    chatId: "chat_1",
    title: "Tell me a long story",
    // The whole row travels with the checkpoint: the open chat's unread state
    // stops depending on the global stream being alive.
    chat: { id: "chat_1", title: "Tell me a long story" },
    artifacts: null,
  });
});

test("unknown wire events cannot masquerade as lifecycle events", () => {
  assert.deepEqual(normalizeLiveEvent({ type: "future_protocol_event", generationId: "g2" }), {
    type: "unknown",
    sourceType: "future_protocol_event",
    generationId: "g2",
  });
});

test("preserves reduced-generation events and their sequence at the client boundary", () => {
  const event = normalizeLiveEvent({
    type: "assistant_content",
    phase: "delta",
    generationId: "g1",
    seq: 7,
    messageId: "m1",
    blockKind: "text",
    contentIndex: 2,
    delta: "hello",
  });
  assert.equal(isStructuredGenerationEvent(event), true);
  if (!isStructuredGenerationEvent(event)) return;
  assert.equal(event.seq, 7);
  assert.equal(event.messageId, "m1");
  assert.equal(event.delta, "hello");
});

test("carries adapter events into the reducer under the names the contract gave them", () => {
  // The browser reduces the contract's vocabulary directly. Nothing here
  // renames `assistant_content` back to a harness's word for it on the way in,
  // which is the whole point: one translation, in the adapter.
  const delta = normalizeLiveEvent({
    type: "assistant_content", phase: "delta", generationId: "g1", seq: 2,
    messageId: "m1", contentIndex: 0, blockKind: "text", delta: "hello",
  });
  assert.equal(delta.type, "assistant_content");
  assert.equal(delta.phase, "delta");
  assert.equal(delta.seq, 2);
  assert.equal(delta.delta, "hello");
  // The session view is the event, not a summary the browser rebuilds from a
  // `lifecycle` string. There is one shape now; the thin one existed for a
  // second frame that attach no longer sends.
  const state = normalizeLiveEvent({
    type: "runtime_state", generationId: null, lifecycle: "idle", status: "idle", activity: "idle",
    session: { active: false, capabilities: { steer: false, replay: true } },
  });
  assert.equal(state.type, "runtime_state");
  assert.equal(state.session.capabilities.steer, false);
  assert.equal(state.session.capabilities.replay, true);
});
