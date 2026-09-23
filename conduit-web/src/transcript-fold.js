/**
 * What a transcript is, applied to the statements that make one.
 *
 * The server decides what the transcript says and states it; this is the fold
 * that turns those statements back into rows. It lives here, in one place, and
 * runs at both ends: the browser folds the live stream through it, and a
 * backend with no history to re-read folds its own journal through it. Two
 * descriptions of the same thing is how a transcript ends up saying one thing
 * on screen and another after a reload, so there is one.
 *
 * Nothing here works anything out. Every question a fold could be tempted to
 * answer for itself -- where a message goes, whether it is finished, whether it
 * is the answer or the turn talking as it works -- was answered by the server
 * when it decided the message existed, and is carried by the op.
 */
import { parseAttachmentEnvelope } from "./attachment-envelope.js";

const messageText = (message) => {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text").map((block) => block.text || "").join("\n");
};

/** What the user actually typed, with the attachment envelope taken back off. */
export function displayUserText(message) {
  const raw = messageText(message);
  return parseAttachmentEnvelope(raw).message || raw;
}

/**
 * Put a message where the server said it goes.
 *
 * This is the whole of placement. A message already held keeps its place and
 * takes the new fields: the sender's own row settles into the message it was
 * always going to be, rather than being replaced by a second copy of itself.
 *
 * An anchor this side does not hold means the position is somewhere it has not
 * loaded, and the end is the only honest answer.
 */
export function openMessage(messages, incoming, after) {
  const held = messages.findIndex((message) => message.id === incoming.id);
  if (held >= 0) {
    const next = [...messages];
    next[held] = { ...next[held], ...incoming };
    return next;
  }
  const anchor = after ? messages.findIndex((message) => message.id === after) : -1;
  const at = anchor >= 0 ? anchor + 1 : messages.length;
  return [...messages.slice(0, at), incoming, ...messages.slice(at)];
}

/** Cut the transcript where the server says the history now ends. */
export function truncateAt(messages, messageId, { inclusive = false } = {}) {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return messages;
  return messages.slice(0, inclusive ? index : index + 1);
}

/** Apply one of the server's statements about which messages there are. */
export function applyTranscriptOp(messages, event) {
  if (event.op === "message.open") {
    const incoming = event.message;
    if (!incoming?.id) return messages;
    return openMessage(messages, incoming.role === "assistant"
      ? {
        id: incoming.id, role: "assistant", content: "", streaming: true,
        answers: event.answers ?? null,
        ...(event.generationId ? { generationId: event.generationId } : {}),
      }
      : {
        id: incoming.id, role: "user", content: displayUserText(incoming),
        timestamp: incoming.timestamp || new Date().toISOString(),
      },
    event.after ?? null);
  }
  if (event.op === "message.close") {
    // What the message says, as the server has it. The deltas drew a preview of
    // this; they are not what the transcript keeps.
    return messages.map((message) => (message.id === event.messageId
      ? {
        ...message,
        content: event.content ?? message.content,
        blocks: event.blocks ?? message.blocks,
        interim: event.interim === true,
        // Text the reader watched arrive that the harness is not carrying into
        // the next request. It stays in the transcript -- taking it away would
        // remove something they saw -- but it is marked, so nothing here or on
        // screen treats it as part of the conversation the model can answer to.
        discarded: event.discarded === true,
        stopReason: event.stopReason || message.stopReason,
        stopped: event.stopReason === "aborted" || message.stopped,
        // Who wrote it, with what, when, and what went wrong. The deltas carried
        // these too, but a delta may be dropped and this may not.
        ...(event.provider ? { provider: event.provider } : {}),
        ...(event.model ? { model: event.model } : {}),
        ...(event.timestamp ? { timestamp: event.timestamp } : {}),
        ...(event.errorMessage ? { errorMessage: event.errorMessage } : {}),
        streaming: false,
      }
      : message));
  }
  if (event.op === "turn.settle") {
    return messages.map((message) => (message.id === event.promptId ? { ...message, outcome: event.outcome } : message));
  }
  if (event.op === "message.drop" && event.messageId) {
    // Where the history now ends, or one row taken back. `keep` is a regenerate:
    // the prompt stands and its answers go, so the row the reader is looking at
    // is never removed and re-added under a new name.
    if (event.keep) return truncateAt(messages, event.messageId, { inclusive: false });
    return event.inclusive
      ? truncateAt(messages, event.messageId, { inclusive: true })
      : messages.filter((message) => message.id !== event.messageId);
  }
  return messages;
}

/**
 * And the statements about which tools ran.
 *
 * Tools are kept beside the messages rather than inside them because that is
 * how the renderer joins them: a message's tool-call blocks name the ids, and
 * these are the records those ids point at. Their order is the order they were
 * stated in, which is the order they ran.
 */
export function applyToolOp(tools, event) {
  if (event.op === "tool.open") {
    if (!event.toolCallId) return tools;
    const held = tools.findIndex((tool) => tool.toolCallId === event.toolCallId);
    const incoming = {
      toolCallId: event.toolCallId, name: event.name || "tool", input: event.input,
      done: false, isError: false, timestamp: event.timestamp || new Date().toISOString(),
      seq: held >= 0 ? tools[held].seq : tools.length,
    };
    if (held < 0) return [...tools, incoming];
    const next = [...tools];
    next[held] = { ...next[held], ...incoming };
    return next;
  }
  if (event.op === "tool.close") {
    if (!event.toolCallId) return tools;
    return tools.map((tool) => (tool.toolCallId === event.toolCallId
      ? { ...tool, output: event.output, isError: Boolean(event.isError), cancelled: event.cancelled === true, done: true }
      : tool));
  }
  return tools;
}

/** Whether this op is about a tool rather than a message. */
export const isToolOp = (event) => event?.op === "tool.open" || event?.op === "tool.close";

/**
 * A transcript read back from a harness, brought up to what the server has said.
 *
 * A harness writes its history down when a turn ends. The server states each
 * message as it happens, and keeps those statements in the chat's log -- so
 * mid-turn the two disagree, and the read is the one that is behind. A browser
 * loading a chat while a turn is running was given the read alone: the prompt
 * it sent was not in the file yet, so the page came back with no prompt, an
 * answer arriving from a live generation that belonged to nothing, and a stop
 * that closed a message the browser did not hold and left an empty chat.
 *
 * Every statement is idempotent by message id, so replaying one already in the
 * file settles the same row rather than adding a second.
 */
export function applyTranscriptOps({ messages = [], tools = [] } = {}, ops = []) {
  let nextMessages = messages;
  let nextTools = tools;
  for (const op of ops) {
    if (op?.type !== "transcript_op") continue;
    if (isToolOp(op)) nextTools = applyToolOp(nextTools, op);
    else nextMessages = applyTranscriptOp(nextMessages, op);
  }
  return { messages: nextMessages, tools: nextTools };
}
