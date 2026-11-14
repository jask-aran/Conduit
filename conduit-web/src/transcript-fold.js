/*
 * One fold for both ends (the browser's live stream, a backend's own journal), so a transcript cannot say one thing
 * on screen and another after a reload. Nothing here works anything out: the server answered it and the op carries it.
 */
import { parseAttachmentEnvelope } from "./attachment-envelope.js";

const messageText = (message) => {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text").map((block) => block.text || "").join("\n");
};

// Prompts Conduit writes into a thread in the person's name that are not the person speaking: never drawn or logged
// as their message.
export const NOT_SPOKEN = /^(?:\[Approval\]|The user stopped your previous response|It is |Since this thread began:)/i;

export function displayUserText(message) {
  const raw = messageText(message);
  return parseAttachmentEnvelope(raw).message || raw;
}

/*
 * A message already held keeps its place and takes the new fields, rather than being replaced by a second copy.
 * An anchor this side does not hold is somewhere it has not loaded, and the end is the only honest answer.
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

export function truncateAt(messages, messageId, { inclusive = false } = {}) {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return messages;
  return messages.slice(0, inclusive ? index : index + 1);
}

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
        // Stated now, so no longer only this client's.
        id: incoming.id, role: incoming.role === "system" ? "system" : "user", content: displayUserText(incoming), local: undefined,
        ...(incoming.unseen ? { unseen: true } : {}),
        ...(incoming.context ? { context: incoming.context, answers: event.answers ?? null } : {}),
        ...(typeof incoming.notes === "string" ? { notes: incoming.notes } : {}),
        timestamp: incoming.timestamp || new Date().toISOString(),
        ...(incoming.origin === "harness" ? { origin: "harness" } : {}),
        ...(incoming.agent ? { agent: incoming.agent } : {}),
        ...(incoming.sender ? { sender: incoming.sender } : {}),
        ...(incoming.appended ? { appended: incoming.appended } : {}),
        ...(incoming.run ? { run: incoming.run } : {}),
        ...(incoming.markup ? { markup: incoming.markup } : {}),
      },
    event.after ?? null);
  }
  if (event.op === "message.close") {
    // The deltas drew a preview of this; they are not what the transcript keeps.
    return messages.map((message) => (message.id === event.messageId
      ? {
        ...message,
        content: event.content ?? message.content,
        blocks: event.blocks ?? message.blocks,
        interim: event.interim === true,
        // Text the harness is not carrying into the next request stays, as the reader saw it, but marked so nothing
        // treats it as part of the conversation the model can answer to.
        discarded: event.discarded === true,
        stopReason: event.stopReason || message.stopReason,
        stopped: event.stopReason === "aborted" || message.stopped,
        // The deltas carried these too, but a delta may be dropped and this may not.
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
  if (event.op === "turn.time") {
    return messages.map((message) => (message.id === event.promptId ? { ...message, timing: event.timing } : message));
  }
  if (event.op === "message.drop" && event.messageId) {
    // `keep` is a regenerate: the prompt stands and its answers go, so the row the reader is looking at is never
    // removed and re-added under a new name.
    if (event.keep) return truncateAt(messages, event.messageId, { inclusive: false });
    return event.inclusive
      ? truncateAt(messages, event.messageId, { inclusive: true })
      : messages.filter((message) => message.id !== event.messageId);
  }
  return messages;
}

// Kept beside the messages rather than inside them: the renderer joins them by the ids a message's tool-call blocks name.
export function applyToolOp(tools, event) {
  if (event.op === "tool.open") {
    if (!event.toolCallId) return tools;
    const held = tools.findIndex((tool) => tool.toolCallId === event.toolCallId);
    const incoming = {
      toolCallId: event.toolCallId, name: event.name || "tool", kind: event.kind || "other",
      ...(event.subject ? { subject: event.subject } : {}), input: event.input,
      ...(event.facts ? { facts: event.facts } : {}),
      ...(event.agent ? { agent: event.agent } : {}),
      done: false, isError: false, timestamp: event.timestamp || new Date().toISOString(),
      seq: held >= 0 ? tools[held].seq : tools.length,
    };
    if (held < 0) return [...tools, incoming];
    const next = [...tools];
    next[held] = { ...next[held], ...incoming };
    return next;
  }
  if (event.op === "tool.calls") {
    return tools.map((tool) => (tool.toolCallId === event.toolCallId && !tool.done ? { ...tool, calls: event.calls } : tool));
  }
  if (event.op === "tool.close") {
    if (!event.toolCallId) return tools;
    return tools.map((tool) => (tool.toolCallId === event.toolCallId
      ? { ...tool, output: event.output, isError: Boolean(event.isError), cancelled: event.cancelled === true, done: true,
        ...(event.kind ? { kind: event.kind } : {}),
        ...(event.subject ? { subject: event.subject } : {}),
        ...(event.agent ? { agent: event.agent } : {}),
        ...(event.calls ? { calls: event.calls } : {}),
        ...(event.completedAt ? { completedAt: event.completedAt } : {}) }
      : tool));
  }
  return tools;
}

export const isToolOp = (event) => event?.op === "tool.open" || event?.op === "tool.close" || event?.op === "tool.calls";

/*
 * A harness writes its history down when a turn ends, so mid-turn its read is behind the server's statements.
 * Every statement is idempotent by message id, so replaying one already in the file settles the same row.
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
