import assert from "node:assert/strict";
import test from "node:test";
import { ChatLog, isLoggedEvent } from "../src/server/chat-log.js";

test("only events that change the transcript take a number", () => {
  const log = new ChatLog();
  assert.equal(isLoggedEvent({ type: "content_block_delta" }), false);
  assert.equal(isLoggedEvent({ type: "runtime_state" }), false);
  assert.equal(isLoggedEvent({ type: "transcript_sync" }), true);
  const stamped = log.stamp({ type: "transcript_sync" });
  assert.deepEqual(stamped.log, { id: log.id, seq: 1 });
  assert.equal(log.state().seq, 1);
});

test("a client is caught up from where it got to, and not sent what it has", () => {
  const log = new ChatLog();
  for (let index = 0; index < 4; index += 1) log.stamp({ type: "message_end", index });
  assert.deepEqual(log.since(log.id, 4), []);
  assert.deepEqual(log.since(log.id, 2).map((event) => event.log.seq), [3, 4]);
});

test("a number from another log, or one the log no longer holds, asks for a snapshot", () => {
  const log = new ChatLog({ limit: 2 });
  for (let index = 0; index < 5; index += 1) log.stamp({ type: "message_end", index });
  assert.equal(log.since("some-other-log", 3), null);
  assert.equal(log.since(log.id, 1), null, "trimmed out of the buffer");
  assert.equal(log.since(log.id, 9), null, "ahead of the log");
  assert.deepEqual(log.since(log.id, 3).map((event) => event.log.seq), [4, 5]);
});

test("the log places a message against what was last said, and says so", () => {
  const log = new ChatLog();
  const prompt = log.stamp({ type: "transcript_op", op: "message.open", message: { id: "m_1", role: "user" } });
  assert.equal(prompt.after, null, "nothing said yet, so it goes at the end");
  const answer = log.stamp({ type: "transcript_op", op: "message.open", message: { id: "m_2", role: "assistant" } });
  assert.equal(answer.after, "m_1");
  const second = log.stamp({ type: "transcript_op", op: "message.open", message: { id: "m_3", role: "assistant" } });
  assert.equal(second.after, "m_2", "a turn's later answers follow its earlier ones");
});

test("a sync tells the log where the transcript now ends", () => {
  const log = new ChatLog();
  log.stamp({ type: "transcript_sync", messages: [{ id: "m_1" }, { id: "m_2" }] });
  const opened = log.stamp({ type: "transcript_op", op: "message.open", message: { id: "m_3", role: "user" } });
  assert.equal(opened.after, "m_2");
});

test("a cut gives up the end rather than naming a message that is gone", () => {
  const log = new ChatLog();
  log.stamp({ type: "transcript_op", op: "message.open", message: { id: "m_1", role: "user" } });
  log.stamp({ type: "transcript_op", op: "message.drop", messageId: "m_1", inclusive: true });
  const opened = log.stamp({ type: "transcript_op", op: "message.open", message: { id: "m_2", role: "user" } });
  assert.equal(opened.after, null);
});

test("a window of the transcript cannot send the next message backwards", () => {
  const log = new ChatLog();
  const prompt = log.stamp({ type: "transcript_op", op: "message.open", message: { id: "m_1", role: "user" } });
  log.stamp({ type: "transcript_op", op: "message.open", message: { id: "m_2", role: "assistant" } });
  log.stamp({ type: "transcript_op", op: "message.open", message: { id: "m_3", role: "user" } });
  // The sync an interrupt publishes ends at the turn it cut off, which is no
  // longer the end of the transcript.
  log.stamp({ type: "transcript_sync", messages: [{ id: "m_1" }, { id: "m_2" }] });
  const answer = log.stamp({ type: "transcript_op", op: "message.open", message: { id: "m_4", role: "assistant" } });
  assert.equal(prompt.after, null);
  assert.equal(answer.after, "m_3", "the answer follows the prompt that asked for it");
});

test("a log that has placed nothing learns the end from a window", () => {
  const log = new ChatLog();
  log.stamp({ type: "transcript_sync", messages: [{ id: "m_1" }, { id: "m_2" }] });
  const opened = log.stamp({ type: "transcript_op", op: "message.open", message: { id: "m_3", role: "user" } });
  assert.equal(opened.after, "m_2");
});
