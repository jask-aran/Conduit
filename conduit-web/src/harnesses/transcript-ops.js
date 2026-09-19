/**
 * The statements Conduit makes about a transcript, in one vocabulary.
 *
 * Every harness reaches its transcript by a different route -- Pi over its own
 * stdio protocol, Codex over app-server notifications, ChatGPT Web over a
 * streamed HTTP body -- and none of that reaches the browser. What reaches the
 * browser is this: a message exists and where, a message is finished and what
 * it says, a message is gone, a tool ran and what it returned. An adapter's
 * whole job is to say these things at the right moments.
 *
 * They are builders rather than a base class on purpose: publishing a record's
 * events is the adapter's business and the three do it differently, but the
 * shape of what gets published is not negotiable, so it lives here. Nothing
 * else may hand-write one. Three adapters typing the same object literal is how
 * the same statement ended up with two spellings and two ways of working out
 * whether an interrupted answer had been thrown away, and neither divergence
 * showed up as anything but a transcript that looked wrong.
 */

import { wasDiscarded } from "../abort-signature.js";

const ROLES = new Set(["user", "assistant"]);
const text = (value) => typeof value === "string" && value.length > 0;

/**
 * Every op is checked before it leaves, because nothing downstream checks it.
 *
 * Capabilities are asserted against the manifest at startup and the adapter
 * contract is asserted method by method, but the events those methods publish
 * went out unread: a missing `interim` or a misspelt `keep` reached the browser
 * as a transcript that simply rendered wrong, with every layer in between
 * reporting success. A throw here names the adapter that got it wrong.
 */
export function assertTranscriptOp(event) {
  const bad = (reason) => { throw new Error(`invalid ${event?.op || "transcript"} op: ${reason}`); };
  if (event?.type !== "transcript_op") bad("not a transcript_op");
  if (event.op === "message.open") {
    if (!text(event.message?.id)) bad("no message id");
    if (!ROLES.has(event.message?.role)) bad(`role ${JSON.stringify(event.message?.role)}`);
    if (event.answers !== null && !text(event.answers)) bad("answers must be a message id or null");
  } else if (event.op === "message.close") {
    if (!text(event.messageId)) bad("no message id");
    if (typeof event.interim !== "boolean") bad("interim must be stated");
    if (typeof event.content !== "string") bad("content must be stated");
    if (!Array.isArray(event.blocks)) bad("blocks must be stated");
  } else if (event.op === "message.drop") {
    if (!text(event.messageId)) bad("no message id");
    // The three drops are one statement each. Asking for two of them at once
    // is the ambiguity this op was split up to remove.
    if (event.keep && event.inclusive) bad("a drop either keeps the message or takes it");
  } else if (event.op === "tool.open") {
    if (!text(event.toolCallId)) bad("no tool call id");
  } else if (event.op === "tool.close") {
    if (!text(event.toolCallId)) bad("no tool call id");
  } else bad("unknown op");
  return event;
}

/** A message now exists. `after` is filled in by the chat's log, not here. */
export const messageOpen = ({ id, role, generationId = null, answers = null, ...fields }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "message.open",
    ...(generationId ? { generationId } : {}),
    answers,
    message: { id, role, ...fields },
  });

/**
 * A message is finished.
 *
 * `interim` is the turn saying whether this is its answer or it talking as it
 * works, and `discarded` whether the harness is keeping it at all. The browser
 * is told both, rather than deciding them from the shape of the turn around the
 * message. The text is stated either way -- the trace renders interim text, and
 * a close that left it out took commentary off the screen the moment the turn
 * settled.
 *
 * `discarded` is worked out here from the harness's own capability rather than
 * by each adapter, because all three were doing the same arithmetic over the
 * same blocks and had already drifted into doing it over two different
 * spellings of them.
 */
export const messageClose = ({ messageId, stopReason = null, blocks = [], interim = false, generationId = null, keepsPartial = false }) => {
  const content = blocks.filter((block) => block.kind === "text").map((block) => block.text || "").join("\n");
  return assertTranscriptOp({
    type: "transcript_op", op: "message.close", messageId, stopReason, interim,
    // Whether the harness will carry this message into the next request. An
    // interrupted answer on a backend that cannot keep a partial is text the
    // reader watched arrive and the model will never see again, so the
    // transcript says so rather than showing it as an ordinary part of the
    // conversation.
    ...(wasDiscarded({ role: "assistant", stopReason, content }, { keepsPartial }) ? { discarded: true } : {}),
    ...(generationId ? { generationId } : {}),
    content,
    // Blocks leave exactly as the adapter stated them. They used to be rewritten
    // here into Pi's spelling so the browser would not have to convert them,
    // which meant the server built the renderer's dialect on behalf of two
    // harnesses that do not speak it -- and the same rewrite in reverse sat a
    // few lines from where the client read the result. The text is already in
    // `content`; what is left is what it sat among.
    blocks: blocks.filter((block) => block.kind !== "text"),
  });
};

/**
 * Something is gone, and this says exactly what.
 *
 * Three statements, because there are three things that happen and they used to
 * be told apart by one flag:
 *
 * - `inclusive` -- a fork or an edit: the history now ends *before* this
 *   message, so it goes and so does everything after it.
 * - `keep` -- a regenerate: the history now ends *after* this message. The
 *   prompt stands, and the answers it produced go. The row on screen is the
 *   same row, which is why regenerating no longer takes the prompt away and
 *   puts an identical one back.
 * - neither -- a turn giving up a row it named and never wrote into. That row
 *   alone, and nothing around it.
 */
export const messageDrop = ({ messageId, inclusive = false, keep = false, generationId = null }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "message.drop", messageId,
    ...(keep ? { keep: true } : { inclusive }),
    ...(generationId ? { generationId } : {}),
  });

/**
 * A tool call has started, and which message owns it.
 *
 * Tools used to reach the browser only as live activity, which meant they were
 * whatever the client had managed to accumulate: a reconnecting browser
 * replayed the chat's order and got the messages back without the commands
 * they ran. Stated here, they travel in the same order as everything else and
 * a replay restores them with it.
 */
export const toolOpen = ({ toolCallId, name, input, messageId = null, generationId = null }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "tool.open", toolCallId, name: name || "tool", input,
    ...(messageId ? { messageId } : {}),
    ...(generationId ? { generationId } : {}),
  });

/** And what it returned. */
export const toolClose = ({ toolCallId, output, isError = false, generationId = null }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "tool.close", toolCallId, output, isError: Boolean(isError),
    ...(generationId ? { generationId } : {}),
  });
