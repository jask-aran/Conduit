import assert from "node:assert/strict";
import test from "node:test";
import { createInitialReasoningState, reduceReasoningState } from "../src/client/reasoning-state.js";

test("creates an empty active slot at generation start", () => {
  assert.equal(createInitialReasoningState(), null);
  assert.deepEqual(reduceReasoningState(null, {
    type: "generation_started",
    generationId: "g1",
  }, 1_000), {
    generationId: "g1",
    status: "active",
    content: "",
    redacted: false,
    startedAt: 1_000,
    completedAt: null,
    durationSeconds: null,
    observed: false,
  });
});

test("survives a same-generation late acknowledgement after thinking starts", () => {
  let state = reduceReasoningState(null, {
    type: "message_update",
    generationId: "g1",
    assistantMessageEvent: { type: "thinking_start" },
  }, 1_000);
  state = reduceReasoningState(state, {
    type: "message_update",
    generationId: "g1",
    assistantMessageEvent: { type: "thinking_delta", delta: "early" },
  }, 1_100);
  const acknowledged = reduceReasoningState(state, {
    type: "generation_started",
    generationId: "g1",
  }, 1_200);

  assert.equal(acknowledged, state);
  assert.equal(acknowledged.content, "early");
  assert.equal(acknowledged.startedAt, 1_000);
});

test("accumulates visible thinking and never exposes signatures", () => {
  let state = reduceReasoningState(null, {
    type: "thinking_start",
    generationId: "g1",
    partial: {
      content: [{ type: "thinking", thinking: "", thinkingSignature: "secret" }],
    },
    contentIndex: 0,
  }, 1_000);
  state = reduceReasoningState(state, {
    type: "thinking_delta",
    generationId: "g1",
    delta: "one ",
    thinkingSignature: "secret",
  }, 1_100);
  state = reduceReasoningState(state, {
    type: "thinking_delta",
    generationId: "g1",
    content: "two",
  }, 1_200);

  assert.equal(state.content, "one two");
  assert.equal(state.observed, true);
  assert.equal("thinkingSignature" in state, false);
});

test("records redaction without making opaque signatures visible", () => {
  const state = reduceReasoningState(null, {
    type: "thinking_start",
    generationId: "g1",
    partial: {
      content: [{
        type: "thinking",
        thinking: "[Reasoning redacted]",
        thinkingSignature: "opaque",
        redacted: true,
      }],
    },
    contentIndex: 0,
  }, 1_000);

  assert.equal(state.redacted, true);
  assert.equal(state.observed, true);
  assert.equal("thinkingSignature" in state, false);
});

test("thinking completion keeps content and measures duration", () => {
  let state = reduceReasoningState(null, {
    type: "thinking_start",
    generationId: "g1",
  }, 1_000);
  state = reduceReasoningState(state, {
    type: "thinking_end",
    generationId: "g1",
    content: "kept",
  }, 3_400);

  assert.equal(state.status, "completed");
  assert.equal(state.content, "kept");
  assert.equal(state.completedAt, 3_400);
  assert.equal(state.durationSeconds, 2);
});

test("transitioning to text completes reasoning without deleting it", () => {
  let state = reduceReasoningState(null, {
    type: "thinking_delta",
    generationId: "g1",
    delta: "retained",
  }, 1_000);
  state = reduceReasoningState(state, {
    type: "text_start",
    generationId: "g1",
  }, 2_600);

  assert.equal(state.status, "completed");
  assert.equal(state.content, "retained");
  assert.equal(state.durationSeconds, 2);
});

test("generation completion measures an unfinished reasoning slot", () => {
  let state = reduceReasoningState(null, {
    type: "generation_started",
    generationId: "g1",
  }, 1_000);
  state = reduceReasoningState(state, {
    type: "agent_end",
    generationId: "g1",
  }, 4_100);

  assert.equal(state.status, "completed");
  assert.equal(state.durationSeconds, 3);
});

test("ignores stale events and replaces completed state for a new generation", () => {
  let state = reduceReasoningState(null, {
    type: "thinking_start",
    generationId: "g1",
  }, 1_000);
  const stale = reduceReasoningState(state, {
    type: "thinking_delta",
    generationId: "older",
    delta: "wrong",
  }, 1_100);
  assert.equal(stale, state);

  state = reduceReasoningState(state, {
    type: "thinking_end",
    generationId: "g1",
  }, 2_000);
  state = reduceReasoningState(state, {
    type: "thinking_start",
    generationId: "g2",
  }, 3_000);
  assert.equal(state.generationId, "g2");
  assert.equal(state.status, "active");
  assert.equal(state.content, "");
});
