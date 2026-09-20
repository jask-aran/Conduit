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

test("a message's place in the chat's order survives normalization", () => {
  assert.deepEqual(normalizeLiveEvent({
    type: "transcript_op",
    op: "message.open",
    generationId: "g1",
    after: "m_prompt",
    answers: "m_prompt",
    message: { id: "m_answer", role: "assistant" },
    log: { id: "log-1", seq: 7 },
  }), {
    type: "transcript_op",
    op: "message.open",
    generationId: "g1",
    after: "m_prompt",
    // The prompt being answered, stated rather than read off the transcript.
    answers: "m_prompt",
    message: { id: "m_answer", role: "assistant", content: undefined, timestamp: undefined,
      stopReason: undefined, errorMessage: null },
    log: { id: "log-1", seq: 7 },
  });
});

test("normalizes host UI events into the client discriminated union", () => {
  assert.deepEqual(normalizeLiveEvent({
    type: "extension_ui_request",
    generationId: 42,
    request: { id: "request_1", method: "select", title: "Choose", options: ["one", 2] },
  }), {
    type: "extension_ui_request",
    generationId: "42",
    request: {
      id: "request_1",
      kind: "select",
      title: "Choose",
      message: "",
      options: ["one", "2"],
      placeholder: "",
      prefill: "",
      timeoutMs: null,
    },
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
    type: "context_usage",
    contextUsage: { tokens: null, contextWindow: 128000, percent: null },
    sessionStats: { userMessages: 2, assistantMessages: 2, toolCalls: 1, toolResults: 1, totalMessages: 5, tokens: { input: 100, output: 40, cacheRead: 20, cacheWrite: 10, total: 170 }, cost: 0.123 },
    cacheStats: { eligibleTokens: 500, cacheHits: 450, cacheMissedTokens: 50, eligibleRequests: 4, eligibleHitRate: 0.9 },
  });
  assert.equal(event.type, "context_usage");
  assert.equal(event.contextUsage.tokens, null);
  assert.equal(event.sessionStats.toolCalls, 1);
  assert.equal(event.cacheStats.eligibleTokens, 500);
});

test("preserves a checkpoint's durable chat title", () => {
  assert.deepEqual(normalizeLiveEvent({
    type: "session_checkpoint",
    generationId: "g4",
    generationSeq: 18,
    chat: { id: "chat_1", title: "Tell me a long story" },
  }), {
    type: "session_checkpoint",
    generationId: "g4",
    generationSeq: 18,
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
  const state = normalizeLiveEvent({
    type: "runtime_state", generationId: null, lifecycle: "idle", status: "idle", activity: "idle",
    capabilities: { steer: false, replay: true },
  });
  assert.equal(state.type, "runtime_state");
  assert.equal(state.session.capabilities.steer, false);
  assert.equal(state.session.capabilities.replay, true);
});
