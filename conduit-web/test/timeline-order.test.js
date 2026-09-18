import assert from "node:assert/strict";
import test from "node:test";
import {
  assignToolSeq,
  buildTimeline,
  mergeToolEvent,
  applyCommittedUser,
  upsertMessages,
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


test("a message this client sent is already itself when the harness commits it", () => {
  const current = [{ id: "m_abc", role: "user", content: "hello" }];
  const next = applyCommittedUser(current, {
    role: "user", content: "hello", id: "m_abc", timestamp: "2026-01-01T00:00:05.000Z",
  });
  assert.equal(next, current);
});

test("a prompt this client did not compose is added", () => {
  const next = applyCommittedUser([{ id: "m_abc", role: "user", content: "hello" }], {
    role: "user", content: "typed in the CLI", id: "pi:e1", timestamp: "2026-01-01T00:00:05.000Z",
  });
  assert.deepEqual(next.map((message) => message.id), ["m_abc", "pi:e1"]);
});

test("assignToolSeq fills missing seq values", () => {
  const tools = assignToolSeq([{ id: "a" }, { id: "b", seq: 7 }]);
  assert.equal(tools[0].seq, 0);
  assert.equal(tools[1].seq, 7);
});

test("a settled answer replaces the streaming copy it was frozen from", () => {
  const committed = [
    { id: "m_user", role: "user", content: "hello" },
    { id: "m_answer", role: "assistant", content: "Hel", generationId: "g1" },
  ];
  const settled = upsertMessages(committed, [{
    id: "m_answer", role: "assistant", content: "Hello", generationId: "g1", stopReason: "stop",
  }]);
  assert.deepEqual(settled.map((message) => [message.role, message.content]), [
    ["user", "hello"],
    ["assistant", "Hello"],
  ]);
});

test("a persisted turn the client has not seen is appended, not merged into one it has", () => {
  const current = [{ id: "m_user", role: "user", content: "hello" }];
  const next = upsertMessages(current, [
    { id: "m_user", role: "user", content: "hello" },
    { id: "pi:abc", role: "assistant", content: "Hello" },
  ]);
  assert.deepEqual(next.map((message) => message.id), ["m_user", "pi:abc"]);
});

test("a re-sent prompt with a new id does not duplicate the one it replaced", () => {
  // What a regenerate does: the harness forks the old prompt away and sends a
  // new one. The client is cut to the fork point first, so the only prompt left
  // is the new one and it arrives once.
  const afterFork = [{ id: "m_first", role: "user", content: "hi" }, { id: "pi:a1", role: "assistant", content: "Hi" }];
  const next = upsertMessages(afterFork, [
    { id: "m_second", role: "user", content: "hi again" },
    { id: "pi:a2", role: "assistant", content: "Hi again" },
  ]);
  assert.deepEqual(next.map((message) => message.id), ["m_first", "pi:a1", "m_second", "pi:a2"]);
});
