import assert from "node:assert/strict";
import test from "node:test";
import {
  canCoalesceTextDelta,
  enqueueOverflowLiveEvent,
  mergeTextDeltaEvents,
  MAX_TEXT_DELTA_BATCH_CHARS,
  sameTextDeltaBlock,
} from "../src/client/state/text-delta-batcher.ts";

const delta = (value, overrides = {}) => ({
  type: "content_block_delta",
  generationId: "g1",
  seq: 1,
  messageId: "m1",
  blockType: "text",
  contentIndex: 0,
  delta: value,
  ...overrides,
});

test("same-block text deltas coalesce below the bounded batch size", () => {
  assert.equal(sameTextDeltaBlock(delta("a"), delta("b")), true);
  assert.equal(canCoalesceTextDelta(delta("a".repeat(128)), delta("b".repeat(128))), true);
  assert.equal(canCoalesceTextDelta(delta("a".repeat(128)), delta("b".repeat(129))), false);
  assert.equal(MAX_TEXT_DELTA_BATCH_CHARS, 256);
});

test("different blocks never coalesce even when the batch has room", () => {
  assert.equal(canCoalesceTextDelta(delta("a"), delta("b", { contentIndex: 1 })), false);
  assert.equal(canCoalesceTextDelta(delta("a"), delta("b", { blockType: "thinking" })), false);
});

test("overflow merging bounds same-block burst entries without losing text", () => {
  const queue = [];
  enqueueOverflowLiveEvent(queue, delta("a"));
  enqueueOverflowLiveEvent(queue, delta("b", { seq: 2 }));
  enqueueOverflowLiveEvent(queue, delta("c".repeat(MAX_TEXT_DELTA_BATCH_CHARS), { seq: 3 }));
  assert.equal(queue.length, 1);
  assert.equal(queue[0].delta, `ab${"c".repeat(MAX_TEXT_DELTA_BATCH_CHARS)}`);
  assert.equal(queue[0].seq, 3);
  assert.equal(mergeTextDeltaEvents(queue[0], delta("d", { seq: 4 })).delta.endsWith("d"), true);
});

test("overflow merging preserves structural event order and replaces stale snapshots", () => {
  const queue = [];
  enqueueOverflowLiveEvent(queue, delta("before"));
  enqueueOverflowLiveEvent(queue, { type: "content_block_completed", generationId: "g1", seq: 3, messageId: "m1", contentIndex: 0 });
  enqueueOverflowLiveEvent(queue, delta("after", { seq: 4 }));
  enqueueOverflowLiveEvent(queue, { type: "runtime_state", generationId: "g1", session: {}, contextUsage: null, queue: { steering: [], followUp: [] }, hostUiRequests: null });
  enqueueOverflowLiveEvent(queue, { type: "runtime_state", generationId: "g1", session: { active: true }, contextUsage: null, queue: { steering: [], followUp: [] }, hostUiRequests: null });
  assert.deepEqual(queue.map((event) => event.type), ["content_block_delta", "content_block_completed", "content_block_delta", "runtime_state"]);
  assert.equal(queue.at(-1).session.active, true);
});
