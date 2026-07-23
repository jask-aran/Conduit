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
    session: { active: true, generation: { id: "g1", closed: false }, queue: { steering: ["now"] } },
  });
  assert.equal(event.type, "runtime_state");
  assert.equal(event.session.generation.id, "g1");
  assert.deepEqual(event.session.queue, { steering: ["now"], followUp: [] });
});

test("preserves a checkpoint's durable chat title", () => {
  assert.deepEqual(normalizeLiveEvent({
    type: "session_checkpoint",
    chat: { id: "chat_1", title: "Tell me a long story" },
  }), {
    type: "session_checkpoint",
    generationId: null,
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
