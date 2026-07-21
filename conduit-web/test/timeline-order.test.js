import assert from "node:assert/strict";
import test from "node:test";
import {
  assignToolSeq,
  buildTimeline,
  mergeToolEvent,
  promotePendingUser,
} from "../src/client/timeline-order.js";

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

test("promotePendingUser clears queue pending on delivery", () => {
  const current = [
    { id: "user_1", role: "user", content: "after tools", pending: true, queueMode: "steer" },
  ];
  const next = promotePendingUser(current, {
    role: "user",
    content: "after tools",
    id: "entry_user",
    timestamp: "2026-01-01T00:00:05.000Z",
  });
  assert.equal(next.length, 1);
  assert.equal(next[0].pending, false);
  assert.equal(next[0].queueMode, undefined);
  assert.equal(next[0].id, "entry_user");
});

test("assignToolSeq fills missing seq values", () => {
  const tools = assignToolSeq([{ id: "a" }, { id: "b", seq: 7 }]);
  assert.equal(tools[0].seq, 0);
  assert.equal(tools[1].seq, 7);
});

test("buildTimeline emits stable question items in transcript order", () => {
  const messages = [
    { id: "u1", role: "user", content: "deploy", timestamp: "2026-07-20T12:00:00.000Z" },
    { id: "a1", role: "assistant", content: "Checking", timestamp: "2026-07-20T12:00:02.000Z" },
  ];
  const requests = [{
    id: "request-1",
    kind: "confirm",
    title: "Deploy now?",
    status: "pending",
    timestamp: "2026-07-20T12:00:01.000Z",
    seq: 8,
  }];

  const timeline = buildTimeline(messages, [], { requests });
  assert.deepEqual(timeline.map((item) => item.value.id), ["u1", "request-1", "a1"]);
  const question = timeline[1];
  assert.equal(question.type, "question");
  assert.equal(question.value, requests[0]);
  assert.equal(question.index, 2);
  assert.equal(question.order, 8);
});

test("buildTimeline de-duplicates replayed requests by stable request ID", () => {
  const first = {
    id: "request-1",
    kind: "select",
    title: "Choose",
    timestamp: "2026-07-20T12:00:00.000Z",
    seq: 4,
  };
  const replay = {
    ...first,
    title: "Replayed",
    timestamp: "2026-07-20T13:00:00.000Z",
    seq: 99,
  };

  const timeline = buildTimeline([], [], { requests: [first, replay] });
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].type, "question");
  assert.equal(timeline[0].value, first);
  assert.equal(timeline[0].order, 4);
});

test("buildTimeline excludes fire-and-forget request records", () => {
  const timeline = buildTimeline([], [], {
    requests: [
      { id: "notify-1", kind: "notify", message: "Finished" },
      { id: "status-1", kind: "setStatus", message: "Working" },
    ],
  });
  assert.deepEqual(timeline, []);
});
