/**
 * The fold, on its own.
 *
 * This is the one description of what a transcript is, and it runs at both
 * ends: the browser folds the live stream through it, and a backend with no
 * history to re-read folds its own journal through it. So what it does to a
 * statement is worth pinning down here, separately from any harness.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { applyToolOp, applyTranscriptOp, isToolOp } from "../src/transcript-fold.js";

const open = (id, role, fields = {}) => ({
  type: "transcript_op", op: "message.open", answers: null, message: { id, role, ...fields },
});

test("a message goes where the server said, not at the end", () => {
  let messages = [];
  messages = applyTranscriptOp(messages, open("m1", "user", { content: "first" }));
  messages = applyTranscriptOp(messages, open("m3", "user", { content: "third" }));
  // Stated as belonging after the first, though it arrived last.
  messages = applyTranscriptOp(messages, { ...open("m2", "assistant"), after: "m1" });
  assert.deepEqual(messages.map((message) => message.id), ["m1", "m2", "m3"]);
});

test("an anchor this side never loaded puts the message at the end", () => {
  const messages = applyTranscriptOp([{ id: "m1", role: "user", content: "held" }],
    { ...open("m2", "assistant"), after: "m_never_loaded" });
  assert.deepEqual(messages.map((message) => message.id), ["m1", "m2"]);
});

test("a dropped row goes alone; a cut takes everything after it too", () => {
  const held = [{ id: "m1", role: "user" }, { id: "m2", role: "assistant" }, { id: "m3", role: "user" }];
  assert.deepEqual(
    applyTranscriptOp(held, { type: "transcript_op", op: "message.drop", messageId: "m2", inclusive: false })
      .map((message) => message.id), ["m1", "m3"]);
  // What a fork or an edit states: the history now ends before this message.
  assert.deepEqual(
    applyTranscriptOp(held, { type: "transcript_op", op: "message.drop", messageId: "m2", inclusive: true })
      .map((message) => message.id), ["m1"]);
  // And what a regenerate states: it ends after it. The prompt stands.
  assert.deepEqual(
    applyTranscriptOp(held, { type: "transcript_op", op: "message.drop", messageId: "m1", keep: true })
      .map((message) => message.id), ["m1"]);
});

test("a tool is a record of its own, opened and closed by the server", () => {
  const openOp = { type: "transcript_op", op: "tool.open", toolCallId: "call_1", name: "bash", input: { command: "ls" } };
  assert.equal(isToolOp(openOp), true);
  let tools = applyToolOp([], openOp);
  assert.deepEqual(tools.map((tool) => [tool.toolCallId, tool.name, tool.done]), [["call_1", "bash", false]]);
  tools = applyToolOp(tools, { type: "transcript_op", op: "tool.close", toolCallId: "call_1", output: "a.txt", isError: false });
  assert.equal(tools[0].done, true);
  assert.equal(tools[0].output, "a.txt");
  assert.equal(tools[0].isError, false);
  // Re-stated rather than duplicated, and it keeps the place it already had.
  assert.equal(applyToolOp(tools, openOp).length, 1);
  assert.equal(applyToolOp(tools, openOp)[0].seq, 0);
});
