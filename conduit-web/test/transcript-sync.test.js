import assert from "node:assert/strict";
import test from "node:test";
import { mergeTranscript, mergeTranscriptProjection } from "../src/client/timeline-order.ts";

const message = (id, role, content, extra = {}) => ({ id, role, content, ...extra });

test("a synced turn replaces the version the client assembled", () => {
  const live = [
    message("u1", "user", "write a story"),
    message("a1", "assistant", "half a stor"),
  ];
  const merged = mergeTranscript(live, [
    message("u1", "user", "write a story"),
    message("a1", "assistant", "half a story", { stopReason: "aborted", stopped: true }),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["u1", "a1"]);
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

/**
 * Pi puts ids on session entries, not on the messages it streams, so the
 * client's copy of a turn never matches the synced copy by id. What it does
 * carry is the generation it was minted for, and the sync says which generation
 * it closes - so the turn is found by correlation rather than by position.
 */
test("the client's copy of a turn is replaced through the generation it belongs to", () => {
  const live = [
    message("user_1700", "user", "write a story", { generationId: "g1" }),
    message("end_g1:m1", "assistant", "half a stor", { generationId: "g1", stopped: true }),
  ];
  const merged = mergeTranscript(live, [
    message("d8f7a8eb", "user", "write a story"),
    message("7dab869c", "assistant", "half a story", { stopReason: "aborted" }),
  ], "g1");
  assert.deepEqual(merged.map((item) => item.id), ["d8f7a8eb", "7dab869c"]);
});

test("earlier turns survive a sync of the turn that follows them", () => {
  const live = [
    message("u0", "user", "earlier"),
    message("a0", "assistant", "earlier answer"),
    message("user_1700", "user", "write a story", { generationId: "g2" }),
    message("end_g2:m1", "assistant", "partial", { generationId: "g2" }),
  ];
  const merged = mergeTranscript(live, [
    message("d8f7a8eb", "user", "write a story"),
    message("7dab869c", "assistant", "complete"),
  ], "g2");
  assert.deepEqual(merged.map((item) => item.id), ["u0", "a0", "d8f7a8eb", "7dab869c"]);
  assert.equal(merged[1].content, "earlier answer");
});

/**
 * The two-turn sync an interrupt ends with: the interrupted turn is named by
 * the ids the earlier sync gave it, and the replacement turn by the generation
 * it was prompted as. Both are stated, so neither is counted.
 */
test("an interrupt's two-turn sync replaces both turns and nothing else", () => {
  const live = [
    message("u0", "user", "first"),
    message("a0", "assistant", "first answer"),
    message("e1", "user", "write a long story"),
    message("e2", "assistant", "Once upon a", { stopped: true, stopReason: "aborted" }),
    message("user_1701", "user", "make it about australia", { generationId: "g3" }),
  ];
  const merged = mergeTranscript(live, [
    message("e1", "user", "write a long story"),
    message("e2", "assistant", "Once upon a", { stopped: true, stopReason: "aborted" }),
    message("e3", "user", "make it about australia"),
    message("e4", "assistant", "Mara found the key"),
  ], "g3");
  assert.deepEqual(merged.map((item) => item.id), ["u0", "a0", "e1", "e2", "e3", "e4"]);
  assert.equal(merged[3].stopped, true);
});

/**
 * The property that matters: a sync the client cannot place must never be able
 * to remove a turn the user watched being generated. Appending leaves a
 * duplicate at worst, and the next sync - which names both - resolves it.
 */
test("a sync that names nothing the client holds appends rather than replacing", () => {
  const live = [
    message("u0", "user", "write a long story"),
    message("a0", "assistant", "Once upon a", { stopReason: "aborted", stopped: true }),
  ];
  const merged = mergeTranscript(live, [
    message("e1", "user", "make it about australia"),
    message("e2", "assistant", "Mara found the key"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["u0", "a0", "e1", "e2"]);
  assert.equal(merged[1].content, "Once upon a");
});

test("a stale generation tag does not pull an unrelated turn into the range", () => {
  const live = [
    message("u0", "user", "first", { generationId: "g1" }),
    message("a0", "assistant", "first answer", { generationId: "g1" }),
    message("u1", "user", "second", { generationId: "g2" }),
  ];
  const merged = mergeTranscript(live, [
    message("e3", "user", "second"),
    message("e4", "assistant", "second answer"),
  ], "g2");
  assert.deepEqual(merged.map((item) => item.id), ["u0", "a0", "e3", "e4"]);
});

test("a synced turn replaces its tools and retains tools from older turns", () => {
  const live = [
    message("u0", "user", "earlier", { blocks: [{ type: "toolCall", id: "t0" }] }),
    message("a0", "assistant", "earlier answer"),
    message("u1", "user", "now", { generationId: "g4" }),
    message("end_g4:m1", "assistant", "partial", { generationId: "g4", blocks: [{ type: "toolCall", id: "t1" }] }),
  ];
  const tools = [{ id: "t0", name: "read" }, { id: "t1", name: "write" }];
  const projection = mergeTranscriptProjection(live, tools, [
    message("e1", "user", "now"),
    message("e2", "assistant", "done", { blocks: [{ type: "toolCall", id: "t2" }] }),
  ], [{ id: "t2", name: "write" }], "g4");
  assert.deepEqual(projection.messages.map((item) => item.id), ["u0", "a0", "e1", "e2"]);
  assert.deepEqual(projection.tools.map((tool) => tool.id), ["t0", "t2"]);
});
