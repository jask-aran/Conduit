import assert from "node:assert/strict";
import test from "node:test";
import {
  assignToolSeq,
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

test("an interrupted answer stays under the prompt it answers, not the one that stopped it", () => {
  // The transcript while an interrupt is in flight: the prompt that started
  // the turn, the answer still streaming, and the message that just cut it off.
  const messages = [
    { id: "m_ask", role: "user", content: "now a longer one" },
    { id: "m_stop", role: "user", content: "stop" },
  ];
  const frozen = [{ id: "m_answer", role: "assistant", content: "The Cartographer", generationId: "g1" }];
  const owner = messages.find((message) => message.id === "m_ask");
  assert.deepEqual(upsertMessages(messages, [owner, ...frozen]).map((message) => message.id),
    ["m_ask", "m_answer", "m_stop"]);
  // Without the anchor it lands after the message that interrupted it, which
  // is what ran the two answers together in one bubble.
  assert.deepEqual(upsertMessages(messages, frozen).map((message) => message.id),
    ["m_ask", "m_stop", "m_answer"]);
});
