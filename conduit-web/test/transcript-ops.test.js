/**
 * The one place a transcript statement is built, and the one place it is checked.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTranscriptOp, messageClose, messageDrop, messageOpen, toolClose, toolOpen,
} from "../src/harnesses/transcript-ops.js";

test("a malformed statement is refused where it is built, not rendered", () => {
  assert.throws(() => messageOpen({ id: "", role: "user" }), /no message id/);
  assert.throws(() => messageOpen({ id: "m1", role: "toolResult" }), /role "toolResult"/);
  assert.throws(() => messageOpen({ id: "m1", role: "assistant", answers: 7 }), /answers/);
  assert.throws(() => messageDrop({ messageId: null }), /no message id/);
  assert.throws(() => toolOpen({ toolCallId: null, name: "read" }), /no tool call id/);
  assert.throws(() => toolClose({ toolCallId: null, output: "" }), /no tool call id/);
  // The three drops are one statement each. The builder resolves the choice --
  // keeping the message wins -- and the check is there for anything that got
  // built some other way.
  assert.deepEqual(messageDrop({ messageId: "m1", keep: true, inclusive: true }),
    { type: "transcript_op", op: "message.drop", messageId: "m1", keep: true });
  assert.throws(() => assertTranscriptOp({
    type: "transcript_op", op: "message.drop", messageId: "m1", keep: true, inclusive: true,
  }), /either keeps/);
  assert.throws(() => assertTranscriptOp({
    type: "transcript_op", op: "message.close", messageId: "m1", content: "hi", blocks: [],
  }), /interim must be stated/);
  assert.throws(() => assertTranscriptOp({ type: "transcript_op", op: "message.rename" }), /unknown op/);
});

test("a close decides discarded from the harness capability alone", () => {
  const blocks = [{ kind: "text", text: "Alright — settle in." }];
  assert.equal(messageClose({ messageId: "m1", stopReason: "aborted", blocks }).discarded, true);
  // A harness that carries a partial into the next request has nothing to mark.
  assert.equal(messageClose({ messageId: "m1", stopReason: "aborted", blocks, keepsPartial: true }).discarded, undefined);
  // Nothing was written, so there is nothing the agent has lost.
  assert.equal(messageClose({ messageId: "m1", stopReason: "aborted", blocks: [] }).discarded, undefined);
  assert.equal(messageClose({ messageId: "m1", stopReason: "stop", blocks }).discarded, undefined);
});
