import assert from "node:assert/strict";
import test from "node:test";
import { isStructuredGenerationEvent, normalizeLiveEvent } from "../src/client/api/live-events.ts";

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
    type: "content_block_delta",
    generationId: "g1",
    seq: 7,
    messageId: "m1",
    blockType: "text",
    contentIndex: 2,
    delta: "hello",
  });
  assert.equal(isStructuredGenerationEvent(event), true);
  if (!isStructuredGenerationEvent(event)) return;
  assert.equal(event.seq, 7);
  assert.equal(event.messageId, "m1");
  assert.equal(event.delta, "hello");
});
