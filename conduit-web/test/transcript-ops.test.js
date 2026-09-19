/**
 * The one place a transcript statement is built, and the one place it is checked.
 *
 * Capabilities are asserted against the manifest at startup and the adapter
 * contract is asserted method by method, but until now the events those methods
 * published went out unread. Three adapters hand-wrote the same object literal,
 * which is how the same statement acquired two spellings of a block and two
 * ways of working out whether an interrupted answer had been thrown away --
 * neither of which failed anything except the transcript on screen.
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
  // A close that states no standing is the shape that sent the browser back to
  // reading answer-or-narration off the turn around it.
  assert.throws(() => assertTranscriptOp({
    type: "transcript_op", op: "message.close", messageId: "m1", content: "hi", blocks: [],
  }), /interim must be stated/);
  assert.throws(() => assertTranscriptOp({ type: "transcript_op", op: "message.rename" }), /unknown op/);
});

/**
 * Whether the agent kept what the reader watched arrive is one rule.
 *
 * It used to be worked out separately by each adapter, over its own block
 * spelling -- Pi reading `type`, Codex reading `kind`, in the same computation.
 * The op asks the harness the only thing it actually needs to know.
 */
test("a close decides discarded from the harness capability alone", () => {
  const blocks = [{ kind: "text", text: "Alright — settle in." }];
  assert.equal(messageClose({ messageId: "m1", stopReason: "aborted", blocks }).discarded, true);
  // A harness that carries a partial into the next request has nothing to mark.
  assert.equal(messageClose({ messageId: "m1", stopReason: "aborted", blocks, keepsPartial: true }).discarded, undefined);
  // Nothing was written, so there is nothing the agent has lost.
  assert.equal(messageClose({ messageId: "m1", stopReason: "aborted", blocks: [] }).discarded, undefined);
  assert.equal(messageClose({ messageId: "m1", stopReason: "stop", blocks }).discarded, undefined);
});

test("a close states its text once, whichever blocks it was given", () => {
  const op = messageClose({
    messageId: "m1", stopReason: "toolUse", interim: true,
    blocks: [
      { kind: "thinking", text: "Planning" },
      { kind: "text", text: "Let me look." },
      { kind: "tool_call", toolCallId: "t1", name: "read", input: { path: "a" } },
    ],
  });
  assert.equal(op.content, "Let me look.");
  assert.equal(op.interim, true);
  // Blocks still leave in the spelling the renderer reads, which is Pi's.
  assert.deepEqual(op.blocks, [
    { type: "thinking", thinking: "Planning" },
    { type: "toolCall", id: "t1", name: "read", arguments: { path: "a" } },
  ]);
});
