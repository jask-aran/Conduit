import assert from "node:assert/strict";
import test from "node:test";
import {
  canCoalesceTextDelta,
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
