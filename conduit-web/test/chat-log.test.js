import assert from "node:assert/strict";
import test from "node:test";
import { ChatLog } from "../src/server/chat-log.js";

test("a number from another log, or one the log no longer holds, asks for a snapshot", () => {
  const log = new ChatLog({ limit: 2 });
  for (let index = 0; index < 5; index += 1) log.stamp({ type: "message_end", index });
  assert.equal(log.since("some-other-log", 3), null);
  assert.equal(log.since(log.id, 1), null, "trimmed out of the buffer");
  assert.equal(log.since(log.id, 9), null, "ahead of the log");
  assert.deepEqual(log.since(log.id, 3).map((event) => event.log.seq), [4, 5]);
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
