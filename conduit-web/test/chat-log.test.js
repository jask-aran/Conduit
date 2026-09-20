import assert from "node:assert/strict";
import test from "node:test";
import { ChatLog, LOGGED_EVENT_TYPES, isLoggedEvent } from "../src/server/chat-log.js";
import { normalizePiBackendEvent, serializePiV0 } from "../src/pi-rpc-adapter.js";

test("only events that change the transcript take a number", () => {
  const log = new ChatLog();
  assert.equal(isLoggedEvent({ type: "assistant_content", phase: "delta" }), false);
  assert.equal(isLoggedEvent({ type: "tool_activity", phase: "update" }), false);
  assert.equal(isLoggedEvent({ type: "runtime_state" }), false);
  assert.equal(isLoggedEvent({ type: "transcript_sync" }), true);
  assert.equal(isLoggedEvent({ type: "status", phase: "settled" }), true);
  // A status with no phase reports what the session is busy with -- Codex
  // waiting on an approval -- rather than a transition, and the statement that
  // follows restates whatever it implied.
  assert.equal(isLoggedEvent({ type: "status", activity: "waiting_for_user" }), false);
  const stamped = log.stamp({ type: "transcript_sync" });
  assert.deepEqual(stamped.log, { id: log.id, seq: 1 });
  assert.equal(log.state().seq, 1);
});

test("an event that takes a number is an event the browser is sent", () => {
  // These two facts have to agree. A number the browser never receives is a
  // gap in its copy of the order, and a gap makes it reject the next statement
  // and ask to be caught up -- with the same undeliverable entry, forever. So
  // nothing may be both logged and dropped.
  for (const type of LOGGED_EVENT_TYPES) {
    const event = { type, generationId: "g1", phase: type === "status" ? "settled" : undefined,
      op: "message.drop", messageId: "m1", log: { id: "l", seq: 1 } };
    if (!isLoggedEvent(normalizePiBackendEvent(event))) continue;
    assert.notEqual(serializePiV0(event), null, `${type} is numbered but never sent`);
  }
});

test("one order means the same thing whichever harness is answering", () => {
  // The set used to be written in Pi's words, so a turn on Codex was numbered
  // for its transcript statements and not for its lifecycle. Pi's events reach
  // the question through Pi's adapter, and the two must agree about what is
  // worth a number.
  const pi = (event) => isLoggedEvent(normalizePiBackendEvent(event));
  assert.equal(pi({ type: "generation_settled", generationId: "g1" }), true);
  assert.equal(pi({ type: "generation_started", generationId: "g1" }), true);
  assert.equal(pi({ type: "generation_running", generationId: "g1" }), false, "not a transition worth replaying");
  assert.equal(pi({ type: "content_block_delta", generationId: "g1" }), false);
  assert.equal(pi({ type: "assistant_message_started", generationId: "g1" }), false, "paint, restated by message.close");
  assert.equal(pi({ type: "generation_failed", generationId: "g1", error: { message: "gone" } }), true);
  // And the same turn stated by a harness that speaks the contract directly.
  assert.equal(isLoggedEvent({ type: "status", phase: "settled" }), true);
  assert.equal(isLoggedEvent({ type: "status", phase: "started" }), true);
  assert.equal(isLoggedEvent({ type: "status", phase: "running" }), false);
  assert.equal(isLoggedEvent({ type: "error", scope: "runtime" }), true);
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
