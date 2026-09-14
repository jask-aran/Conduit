import assert from "node:assert/strict";
import test from "node:test";
import { mergeTranscript, mergeTranscriptProjection } from "../src/client/timeline-order.ts";

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

// Pi streams messages without ids - they live on the session entries - so the
// client's copy of a turn never matches the synced copy by id. This is the
// ordinary case, not the exception.
test("a turn the client minted ids for is replaced, not appended", () => {
  const live = [
    message("user_1700", "user", "write a story"),
    message("assistant_1701", "assistant", "half a stor"),
  ];
  const merged = mergeTranscript(live, [
    message("d8f7a8eb", "user", "write a story"),
    message("7dab869c", "assistant", "half a story", { stopReason: "aborted" }),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["d8f7a8eb", "7dab869c"]);
});

test("earlier turns survive an id-less sync of the last turn", () => {
  const live = [
    message("u0", "user", "earlier"),
    message("a0", "assistant", "earlier answer"),
    message("user_1700", "user", "write a story"),
    message("assistant_1701", "assistant", "partial"),
  ];
  const merged = mergeTranscript(live, [
    message("d8f7a8eb", "user", "write a story"),
    message("7dab869c", "assistant", "complete"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["u0", "a0", "d8f7a8eb", "7dab869c"]);
  assert.equal(merged[1].content, "earlier answer");
});

test("a two-turn sync replaces exactly two turns", () => {
  const live = [
    message("u0", "user", "first"),
    message("a0", "assistant", "first answer"),
    message("user_1", "user", "second"),
    message("assistant_1", "assistant", "second partial"),
    message("user_2", "user", "third"),
    message("assistant_2", "assistant", "third partial"),
  ];
  const merged = mergeTranscript(live, [
    message("e1", "user", "second"),
    message("e2", "assistant", "second answer"),
    message("e3", "user", "third"),
    message("e4", "assistant", "third answer"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["u0", "a0", "e1", "e2", "e3", "e4"]);
});

test("a queued message survives an id-less sync", () => {
  const live = [
    message("user_1", "user", "write a story"),
    message("assistant_1", "assistant", "partial"),
    message("queued_0", "user", "make it about australia", { pending: true }),
  ];
  const merged = mergeTranscript(live, [
    message("e1", "user", "write a story"),
    message("e2", "assistant", "complete"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["e1", "e2", "queued_0"]);
});

/**
 * Interrupt and send: the turn is aborted and the steering message is prompted
 * as a new turn, so the newest turn the backend holds is one the client has not
 * seen yet - the client never mints a bubble for a steered message. Counting one
 * turn back from the end would land on the interrupted turn and replace it with
 * the new one, taking the stopped answer with it.
 */
test("a sync of a turn the client has not seen appends rather than replacing the last one", () => {
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

/**
 * Interrupting with a steering message prompts it as a turn of its own, which
 * the client never minted a bubble for, and the server then syncs both turns.
 * The interrupted turn must be replaced in place - keeping its stopped answer -
 * rather than overwritten by its successor.
 */
test("an interrupt syncs both turns without eating the interrupted one", () => {
  const live = [
    message("u0", "user", "write a long story"),
    message("a0", "assistant", "Once upon a", { stopReason: "aborted", stopped: true }),
  ];
  const merged = mergeTranscript(live, [
    message("e1", "user", "write a long story"),
    message("e2", "assistant", "Once upon a", { stopReason: "aborted", stopped: true }),
    message("e3", "user", "make it about australia"),
    message("e4", "assistant", "Mara found the key"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["e1", "e2", "e3", "e4"]);
  assert.equal(merged[1].stopReason, "aborted");
});

/** The same interrupt, with an earlier turn the sync does not cover. */
test("an interrupt leaves the turns before it alone", () => {
  const live = [
    message("uA", "user", "hello"),
    message("aA", "assistant", "hi"),
    message("u0", "user", "write a long story"),
    message("a0", "assistant", "Once upon a", { stopReason: "aborted", stopped: true }),
  ];
  const merged = mergeTranscript(live, [
    message("e1", "user", "write a long story"),
    message("e2", "assistant", "Once upon a", { stopReason: "aborted", stopped: true }),
    message("e3", "user", "make it about australia"),
    message("e4", "assistant", "Mara found the key"),
  ]);
  assert.deepEqual(merged.map((item) => item.id), ["uA", "aA", "e1", "e2", "e3", "e4"]);
  assert.equal(merged[1].content, "hi");
});

test("a sync carrying no user message is not placed at all", () => {
  const live = [message("u1", "user", "hello"), message("a1", "assistant", "hi")];
  assert.equal(mergeTranscript(live, [message("e9", "assistant", "orphan")]), live);
});

test("a synced turn replaces its tools and retains tools from older turns", () => {
  const live = [
    message("u0", "user", "earlier"),
    message("a0", "assistant", "done", { blocks: [{ type: "toolCall", id: "old-tool" }] }),
    message("u1", "user", "latest"),
    message("a1", "assistant", "partial", { blocks: [{ type: "toolCall", id: "stale-tool" }] }),
  ];
  const projection = mergeTranscriptProjection(live, [
    { id: "old-tool", name: "read", done: true },
    { id: "stale-tool", name: "write", done: false },
  ], [
    message("e1", "user", "latest"),
    message("e2", "assistant", "complete", { blocks: [{ type: "toolCall", id: "real-tool" }] }),
  ], [
    { id: "real-tool", name: "write", done: true },
  ]);

  assert.deepEqual(projection.messages.map((item) => item.id), ["u0", "a0", "e1", "e2"]);
  assert.deepEqual(projection.tools.map((item) => item.id), ["old-tool", "real-tool"]);
});
