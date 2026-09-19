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
 * shape of what gets published is not negotiable, so it lives here.
 */

/** A message now exists. `after` is filled in by the chat's log, not here. */
export const messageOpen = ({ id, role, generationId = null, answers = null, ...fields }) => ({
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
 */
export const messageClose = ({ messageId, stopReason = null, blocks = [], interim = false, generationId = null, discarded = false }) => ({
  type: "transcript_op", op: "message.close", messageId, stopReason, interim,
  // Whether the harness will carry this message into the next request. An
  // interrupted answer on a backend that cannot keep a partial is text the
  // reader watched arrive and the model will never see again, so the transcript
  // says so rather than showing it as an ordinary part of the conversation.
  ...(discarded ? { discarded: true } : {}),
  ...(generationId ? { generationId } : {}),
  content: blocks.filter((block) => block.kind === "text").map((block) => block.text || "").join("\n"),
  // Blocks still travel in the spelling the renderer reads, which is Pi's.
  // Collapsing that into the neutral one is a change to `turn-rows`, not to
  // what is being stated here, so it is left for when the delta channel goes
  // the same way.
  blocks: blocks.flatMap((block) => {
    if (block.kind === "thinking") return [{ type: "thinking", thinking: block.text || "" }];
    if (block.kind === "tool_call") {
      return [{ type: "toolCall", id: block.toolCallId || block.id, name: block.name, arguments: block.input }];
    }
    return [];
  }),
});

/**
 * A message is gone.
 *
 * `inclusive` separates the two reasons that happens: a fork or an edit cuts
 * the history from this message on, while a turn giving up a row it never
 * wrote into takes back that row alone.
 */
export const messageDrop = ({ messageId, inclusive = false, generationId = null }) => ({
  type: "transcript_op", op: "message.drop", messageId, inclusive,
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
export const toolOpen = ({ toolCallId, name, input, messageId = null, generationId = null }) => ({
  type: "transcript_op", op: "tool.open", toolCallId, name: name || "tool", input,
  ...(messageId ? { messageId } : {}),
  ...(generationId ? { generationId } : {}),
});

/** And what it returned. */
export const toolClose = ({ toolCallId, output, isError = false, generationId = null }) => ({
  type: "transcript_op", op: "tool.close", toolCallId, output, isError: Boolean(isError),
  ...(generationId ? { generationId } : {}),
});
