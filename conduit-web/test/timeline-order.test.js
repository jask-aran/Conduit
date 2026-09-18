import assert from "node:assert/strict";
import test from "node:test";
import {
  assignToolSeq,
  claimAnswerRows,
  mergeToolEvent,
  applyCommittedUser,
  settleAnswerRows,
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

test("an answer takes its place in the transcript as soon as it is named", () => {
  const messages = [{ id: "m_ask", role: "user", content: "now a longer one" }];
  const claimed = claimAnswerRows(messages, { id: "g1", assistantMessages: [{ id: "m_answer" }] });
  assert.deepEqual(claimed.map((message) => message.id), ["m_ask", "m_answer"]);
  assert.equal(claimed[1].streaming, true);
  // An interrupt sent while that answer is still arriving lands after it, so
  // the answer cannot end up below the message that stopped it.
  const interrupted = [...claimed, { id: "m_stop", role: "user", content: "stop" }];
  const settled = settleAnswerRows(interrupted, "g1", [
    { id: "m_answer", role: "assistant", content: "The Cartographer", generationId: "g1" },
  ]);
  assert.deepEqual(settled.map((message) => message.id), ["m_ask", "m_answer", "m_stop"]);
  assert.equal(settled[1].streaming, undefined);
});

test("claiming twice does not give an answer a second row", () => {
  const first = claimAnswerRows([{ id: "m_ask", role: "user" }], { id: "g1", assistantMessages: [{ id: "m_a" }] });
  const second = claimAnswerRows(first, { id: "g1", assistantMessages: [{ id: "m_a" }, { id: "m_b" }] });
  assert.deepEqual(second.map((message) => message.id), ["m_ask", "m_a", "m_b"]);
});

test("a sync that names an answer still arriving does not draw it twice", () => {
  // The sync an interrupt publishes carries the turn it just cancelled. The
  // row stays the turn's own until the turn itself ends.
  const synced = [
    { id: "m_ask", role: "user" },
    { id: "m_a", role: "assistant", content: "half an answer" },
  ];
  const held = claimAnswerRows(synced, { id: "g1", assistantMessages: [{ id: "m_a" }] });
  assert.equal(held[1].streaming, true);
  assert.equal(held.length, 2);
});

test("a turn that named an answer but never wrote one leaves no blank row", () => {
  const claimed = claimAnswerRows([{ id: "m_ask", role: "user" }], { id: "g1", assistantMessages: [{ id: "m_a" }] });
  assert.deepEqual(settleAnswerRows(claimed, "g1", []).map((message) => message.id), ["m_ask"]);
});

test("a sync opening with messages this client has not seen keeps the server's order", () => {
  // What a two-turn sync looks like to a client that joined late: the turn it
  // missed comes first. Dropping it at the end put an older prompt below a
  // newer one.
  const current = [
    { id: "m_ask", role: "user", content: "short story" },
    { id: "m_stop", role: "user", content: "stop" },
  ];
  const next = upsertMessages(current, [
    { id: "pi:tool1", role: "assistant", content: "" },
    { id: "pi:tool2", role: "assistant", content: "" },
    { id: "m_stop", role: "user", content: "stop" },
    { id: "m_reply", role: "assistant", content: "Got it" },
  ]);
  assert.deepEqual(next.map((message) => message.id),
    ["m_ask", "pi:tool1", "pi:tool2", "m_stop", "m_reply"]);
});

test("a sync of nothing this client has seen still arrives in order", () => {
  const next = upsertMessages([{ id: "m_old", role: "user" }], [
    { id: "a", role: "assistant" }, { id: "b", role: "user" }, { id: "c", role: "assistant" },
  ]);
  assert.deepEqual(next.map((message) => message.id), ["m_old", "a", "b", "c"]);
});
