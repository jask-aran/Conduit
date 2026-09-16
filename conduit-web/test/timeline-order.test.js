import assert from "node:assert/strict";
import test from "node:test";
import {
  assignToolSeq,
  buildTimeline,
  mergeToolEvent,
  promotePendingUser,
  settleGenerationMessages,
} from "../src/client/timeline-order.ts";

test("mergeToolEvent preserves first-seen timestamp and seq on reconnect replay", () => {
  let seq = 0;
  const first = mergeToolEvent([], {
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "read",
    timestamp: "2026-01-01T00:00:00.000Z",
  }, { nextSeq: () => seq++ });
  assert.equal(first.tools[0].seq, 0);
  assert.equal(first.tools[0].timestamp, "2026-01-01T00:00:00.000Z");

  const replay = mergeToolEvent(first.tools, {
    type: "tool_execution_start",
    toolCallId: "t1",
    toolName: "read",
    timestamp: "2026-07-17T12:00:00.000Z",
  }, { nextSeq: () => seq++ });
  assert.equal(replay.tools.length, 1);
  assert.equal(replay.tools[0].timestamp, "2026-01-01T00:00:00.000Z");
  assert.equal(replay.tools[0].seq, 0);
});

test("buildTimeline keeps tools between messages when timestamps order them", () => {
  const messages = [
    { id: "u1", role: "user", content: "go", timestamp: "2026-01-01T00:00:00.000Z" },
    { id: "a1", role: "assistant", content: "working", timestamp: "2026-01-01T00:00:01.000Z" },
    { id: "u2", role: "user", content: "steer", timestamp: "2026-01-01T00:00:03.000Z", pending: false },
  ];
  const tools = [
    { id: "t1", name: "read", timestamp: "2026-01-01T00:00:02.000Z", seq: 0 },
  ];
  const timeline = buildTimeline(messages, tools);
  assert.deepEqual(timeline.map((item) => item.type === "tool" ? item.value.id : item.value.id), [
    "u1", "a1", "t1", "u2",
  ]);
});


test("an ordinary pending message is promoted on delivery", () => {
  const current = [{ id: "user_1", role: "user", content: "hello", pending: true }];
  const next = promotePendingUser(current, {
    role: "user", content: "hello", id: "entry_user", timestamp: "2026-01-01T00:00:05.000Z",
  });
  assert.equal(next.length, 1);
  assert.equal(next[0].pending, false);
  assert.equal(next[0].id, "entry_user");
});

test("assignToolSeq fills missing seq values", () => {
  const tools = assignToolSeq([{ id: "a" }, { id: "b", seq: 7 }]);
  assert.equal(tools[0].seq, 0);
  assert.equal(tools[1].seq, 7);
});

test("a settled generation replaces its provisional assistant copy once", () => {
  const committed = [
    { id: "user_1", role: "user", content: "hello", generationId: "g1" },
    { id: "live_g1", role: "assistant", content: "Hello", generationId: "g1" },
  ];
  const settled = settleGenerationMessages(committed, "g1", [{
    id: "end_g1:m1", role: "assistant", content: "Hello", generationId: "g1", stopReason: "stop",
  }]);
  assert.deepEqual(settled.map((message) => [message.role, message.content]), [
    ["user", "hello"],
    ["assistant", "Hello"],
  ]);
});

test("a settled generation preserves its answer when no transcript message arrived", () => {
  const settled = settleGenerationMessages([
    { id: "user_1", role: "user", content: "hello", generationId: "g1" },
  ], "g1", [{ id: "end_g1:m1", role: "assistant", content: "Hello", generationId: "g1" }]);
  assert.equal(settled.at(-1).content, "Hello");
});
