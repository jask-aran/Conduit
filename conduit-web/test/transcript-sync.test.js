import assert from "node:assert/strict";
import test from "node:test";
import { mergeTranscript } from "../src/client/timeline-order.ts";

const message = (id, role, content, extra = {}) => ({ id, role, content, ...extra });

test("a synced turn replaces the version the client assembled", () => {
  const live = [
    message("u1", "user", "write a story"),
    message("a1", "assistant", "half a stor"),
  ];
  const synced = [
    message("u1", "user", "write a story"),
    message("a1", "assistant", "half a story", { stopReason: "aborted", stopped: true }),
  ];
  const merged = mergeTranscript(live, synced);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].content, "half a story");
  assert.equal(merged[1].stopReason, "aborted");
});

test("messages older than the synced turn are left alone", () => {
  const live = [
    message("u0", "user", "earlier"),
    message("a0", "assistant", "earlier answer"),
    message("u1", "user", "write a story"),
    message("a1", "assistant", "partial"),
  ];
  const merged = mergeTranscript(live, [
    message("u1", "user", "write a story"),
    message("a1", "assistant", "complete"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["u0", "a0", "u1", "a1"]);
  assert.equal(merged[1].content, "earlier answer");
  assert.equal(merged[3].content, "complete");
});

test("a queued message survives a sync because it is the composer's", () => {
  const live = [
    message("u1", "user", "write a story"),
    message("a1", "assistant", "partial"),
    message("queued_0", "user", "make it about australia", { pending: true }),
  ];
  const merged = mergeTranscript(live, [
    message("u1", "user", "write a story"),
    message("a1", "assistant", "complete"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["u1", "a1", "queued_0"]);
  assert.equal(merged.at(-1).pending, true);
});

test("an empty sync changes nothing", () => {
  const live = [message("u1", "user", "hello")];
  assert.equal(mergeTranscript(live, []), live);
});
