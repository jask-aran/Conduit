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

/**
 * Conduit's names, in one list, because there is only one set of them.
 *
 * A message: `id`, `role`, `content`, `blocks`, `stopReason`, `interim`,
 * `answers`, `discarded`, `after`.
 * A block: `kind` (`text` | `thinking` | `tool_call`), `text`, `toolCallId`,
 * `name`, `input` -- plus `contentIndex`, `identity` and `status` while it is
 * still arriving, which are additions to these names and not alternatives.
 * A tool: `toolCallId`, `name`, `kind`, `subject`, `input`, `output`, `isError`, `cancelled`, `done`.
 * A turn: `outcome` -- `complete`, `interrupted` or `failed` -- stated on the
 * prompt it answers, once the turn is over.
 * An event: `seq`.
 *
 * A harness's own names -- Pi's `type`/`toolCall`/`arguments`/`thinking`/
 * `toolName`/`partialResult`, Codex's item shapes, ChatGPT Web's stream -- may
 * appear only where that harness's own bytes are being read: its normalizer,
 * its session file reader, its thread reader. Past that boundary they do not
 * exist. Every time a second spelling has been allowed to travel one layer
 * further, the two have drifted and the drift has shown up as a transcript that
 * rendered wrong while every test passed.
 */

const ROLES = new Set(["user", "assistant"]);
const OUTCOMES = new Set(["complete", "interrupted", "failed"]);
const text = (value) => typeof value === "string" && value.length > 0;

/**
 * What a tool did, in one word the reader can count: "3 commands, 2 reads".
 *
 * Each harness names its tools its own way -- Pi's `bash`, Codex's command
 * execution, OpenCode's `webfetch` -- so each adapter holds the table from its
 * names to these, and the browser never guesses from a name. A tool the table
 * does not know is `other`, which is still counted, just not named.
 */
export const TOOL_KINDS = new Set(["command", "read", "edit", "search", "fetch", "other"]);
export const toolKind = (table, name) => (Object.hasOwn(table, name) ? table[name] : "other");

/**
 * And what it did it to, in one short line: the command, the path, the query,
 * the page. The adapter picks the field out of its own tool's input -- the
 * browser cannot, since every harness spells its inputs differently -- and this
 * makes it one line. A list is its first item and how many more. A web address
 * is its site and path -- no scheme, no `www`, no query string, which is what
 * made one unreadable -- and several are counted as pages, since a row of
 * addresses says less than "4 pages on shirakawa-go.gr.jp". Nothing worth
 * naming is null.
 */
const pageOf = (value) => {
  try {
    const url = new URL(value);
    return { host: url.hostname.replace(/^www\d*\./, ""), path: url.pathname === "/" ? "" : url.pathname };
  } catch { return null; }
};
export const toolSubject = (value) => {
  const list = (Array.isArray(value) ? value : [value]).filter((item) => typeof item === "string" && item.trim());
  if (!list.length) return null;
  const pages = list.map((item) => (/^https?:\/\//i.test(item.trim()) ? pageOf(item.trim()) : null));
  if (pages.every(Boolean)) {
    if (list.length === 1) return `${pages[0].host}${pages[0].path}`;
    const hosts = new Set(pages.map((page) => page.host));
    return hosts.size === 1 ? `${list.length} pages on ${pages[0].host}` : `${list.length} pages`;
  }
  let line = list[0].trim().split("\n")[0];
  if (line.length > 160) line = `${line.slice(0, 159)}…`;
  return list.length > 1 ? `${line} and ${list.length - 1} more` : line;
};

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
    if (!TOOL_KINDS.has(event.kind)) bad(`kind ${JSON.stringify(event.kind)}`);
    if (event.subject !== undefined && !text(event.subject)) bad("subject must be a line or left out");
  } else if (event.op === "tool.close") {
    if (!text(event.toolCallId)) bad("no tool call id");
    if (event.isError && event.cancelled) bad("a tool is stopped or it failed");
  } else if (event.op === "turn.settle") {
    if (!text(event.promptId)) bad("no prompt id");
    if (!OUTCOMES.has(event.outcome)) bad(`outcome ${JSON.stringify(event.outcome)}`);
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
export const messageClose = ({ messageId, stopReason = null, blocks = [], interim = false, generationId = null,
  keepsPartial = false, provider = null, model = null, timestamp = null, errorMessage = null }) => {
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
    // Who wrote it, with what, when, and what went wrong -- stated here because
    // the record has to say everything the reader can see. These four reached
    // the browser only on the final paint frame, which may be merged away or
    // dropped under backpressure, so the message details panel showed a
    // provider and a model during the turn and nothing after it settled, until
    // a reload read them off the harness's own file.
    ...(provider ? { provider } : {}),
    ...(model ? { model } : {}),
    ...(timestamp ? { timestamp } : {}),
    ...(errorMessage ? { errorMessage } : {}),
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
export const toolOpen = ({ toolCallId, name, kind = "other", subject = null, input, messageId = null, generationId = null }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "tool.open", toolCallId, name: name || "tool", kind, input,
    ...(subject ? { subject } : {}),
    ...(messageId ? { messageId } : {}),
    ...(generationId ? { generationId } : {}),
  });

/**
 * And what it returned. A tool the user's stop cut short was `cancelled`, not
 * failed: harnesses report the kill as an error -- Pi's "Command aborted" -- and
 * the adapter, which knows it asked for the stop, says which it was.
 */
export const toolClose = ({ toolCallId, output, isError = false, cancelled = false, generationId = null }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "tool.close", toolCallId, output,
    isError: Boolean(isError) && !cancelled,
    ...(cancelled ? { cancelled: true } : {}),
    ...(generationId ? { generationId } : {}),
  });

/**
 * How a turn ended, stated once, on the prompt it answers.
 *
 * Every harness ends a turn in its own words -- Pi files an empty entry with
 * `stopReason: "error"` under a killed tool, Codex reports the turn
 * `interrupted`, a provider's cancellation arrives as a failure -- and reading
 * those shapes back had the trace, the tool and the composer giving three
 * answers to one question. The adapter knows whether it was asked to stop, so
 * it says: `complete`, `interrupted` or `failed`. Everything that shows a
 * turn's ending reads this and nothing else.
 */
export const turnSettle = ({ promptId, outcome, generationId = null }) =>
  assertTranscriptOp({
    type: "transcript_op", op: "turn.settle", promptId, outcome,
    ...(generationId ? { generationId } : {}),
  });
