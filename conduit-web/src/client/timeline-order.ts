import { parseAttachmentEnvelope } from "../attachment-envelope.js";
import type { Message, ToolItem } from "./api/contracts";

export interface ProtocolMessage {
  id?: string;
  role?: string;
  content?: unknown;
  timestamp?: string;
  stopReason?: string;
  errorMessage?: string | null;
}

export interface ToolLifecycleEvent {
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  toolCallId?: string;
  id?: string;
  toolName?: string;
  name?: string;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  done?: boolean;
  isError?: boolean;
  error?: boolean;
  timestamp?: string;
  seq?: number;
}

export function messageText(message?: ProtocolMessage | Message | null): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: string; text?: string } => Boolean(block && typeof block === "object" && block.type === "text"))
    .map((block) => block.text || "")
    .join("\n");
}

export function displayUserText(message?: ProtocolMessage | Message | null): string {
  const raw = messageText(message);
  return parseAttachmentEnvelope(raw).message || raw;
}

export function mergeToolEvent(tools: ToolItem[], event: ToolLifecycleEvent, options: { nextSeq?: () => number } = {}) {
  const id = event.toolCallId || event.id;
  if (!id) return { tools, created: false };
  const existing = tools.find((item) => item.id === id);
  if (existing) {
    return {
      tools: tools.map((item) => (item.id === id
        ? {
          ...item,
          name: event.toolName || item.name,
          args: event.args !== undefined ? event.args : item.args,
          partialResult: event.partialResult !== undefined ? event.partialResult : item.partialResult,
          result: event.result !== undefined ? event.result : item.result,
          done: event.done != null ? event.done : (event.type === "tool_execution_end" ? true : item.done),
          error: event.isError != null ? Boolean(event.isError) : (event.error != null ? Boolean(event.error) : item.error),
        }
        : item)),
      created: false,
    };
  }
  const seq = typeof options.nextSeq === "function" ? options.nextSeq() : (event.seq ?? tools.length);
  const tool: ToolItem = {
    id,
    name: event.toolName || event.name || "tool",
    args: event.args,
    done: Boolean(event.done) || event.type === "tool_execution_end",
    error: Boolean(event.isError || event.error),
    timestamp: event.timestamp || new Date().toISOString(),
    seq,
    result: event.result,
    partialResult: event.partialResult,
  };
  return { tools: [...tools, tool], created: true };
}

export function assignToolSeq(tools: ToolItem[] = []): ToolItem[] {
  return tools.map((tool, index) => ({ ...tool, seq: tool.seq == null ? index : tool.seq }));
}

/**
 * A prompt the harness has committed.
 *
 * A message this client sent is already on screen under the id it chose and
 * sent with the prompt, so this has nothing to do for it. What it is for is a
 * prompt this client did not compose: one the harness re-sent for a
 * regenerate, or a message typed into the CLI of a thread driven from here.
 */
export function applyCommittedUser(messages: Message[], eventMessage: ProtocolMessage): Message[] {
  const content = displayUserText(eventMessage);
  if (!content || !eventMessage.id) return messages;
  if (messages.some((message) => message.id === eventMessage.id)) return messages;
  return [...messages, {
    id: eventMessage.id,
    role: "user",
    content,
    timestamp: eventMessage.timestamp || new Date().toISOString(),
  }];
}

/**
 * Fold a projection into the transcript.
 *
 * Every message carries an id assigned before anyone saw it -- Codex's item
 * ids, the ChatGPT-web journal's, and for Pi the ids Conduit claims for a turn
 * and binds to the entries it writes. So a sync is an upsert: a known id
 * updates in place, an unknown one is new and belongs at the end, and nothing
 * is matched by content, by position, or by the generation that produced it.
 */
export function upsertMessages(current: Message[], incoming: Message[]): Message[] {
  if (!incoming.length) return current;
  const next = [...current];
  // The server's order is the statement; only a message nobody has seen before
  // has an open position, and it goes between the messages the server put it
  // between. So an unseen message waits for the next one this client knows and
  // is placed in front of it, and falls to the end only when the rest of the
  // sync is unseen too. Placing it immediately, relative to the last known
  // message, sent a run that opened with unseen messages to the end of the
  // transcript -- which is how a prompt could end up below a later one.
  let cursor = -1;
  let held: Message[] = [];
  const place = (at: number) => {
    next.splice(at, 0, ...held);
    cursor = at + held.length - 1;
    held = [];
  };
  for (const message of incoming) {
    const index = message.id ? next.findIndex((item) => item.id === message.id) : -1;
    if (index < 0) { held.push(message); continue; }
    if (held.length) place(index);
    const settled = next.findIndex((item) => item.id === message.id);
    next[settled] = message;
    cursor = settled;
  }
  if (held.length) place(cursor >= 0 ? cursor + 1 : next.length);
  return next;
}

/**
 * The whole transcript, as the server has it.
 *
 * A full load is the entire truth about a chat, so it replaces rather than
 * merges: a message it does not contain is a message the chat no longer has.
 * Merging one in made a load that landed after a fork put the abandoned
 * branch back. Only rows the server has never seen survive it: the composer's
 * own unsent messages, and an answer still arriving over the socket.
 */
export function replaceMessages(current: Message[], incoming: Message[]): Message[] {
  const kept = current.filter((message) => (message.pending || message.streaming)
    && !incoming.some((item) => item.id === message.id));
  return [...incoming, ...kept];
}

/**
 * Cut the transcript where the server says the history now ends.
 *
 * A fork abandons everything after its point and states where that is, so this
 * never has to work it out. An id this client does not hold means the cut is
 * somewhere it has not loaded, and there is nothing here to remove.
 */
export function truncateAt(messages: Message[], messageId: string, { inclusive = false } = {}): Message[] {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return messages;
  return messages.slice(0, inclusive ? index : index + 1);
}

function toolIds(messages: Message[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const block of message.blocks || []) {
      if (block?.type === "toolCall" && block.id) ids.add(block.id);
    }
  }
  return ids;
}

/** A sync carries messages and the tools those messages own. */
export function applyTranscriptProjection(
  messages: Message[],
  tools: ToolItem[],
  incomingMessages: Message[],
  incomingTools: ToolItem[],
): { messages: Message[]; tools: ToolItem[] } {
  if (!incomingMessages.length) return { messages, tools };
  const nextMessages = upsertMessages(messages, incomingMessages);
  const incomingIds = new Set(incomingTools.map((tool) => tool.id));
  // Turns the sync did not carry keep the tools they own.
  const retained = toolIds(nextMessages);
  return {
    messages: nextMessages,
    tools: [...tools.filter((tool) => retained.has(tool.id) && !incomingIds.has(tool.id)), ...incomingTools],
  };
}

/**
 * Put a message where the server said it goes.
 *
 * This is the whole of placement. The server decided the position when it
 * decided the message existed, and states both together, so there is nothing
 * here to work out from content, timestamps, or which prompt happens to be
 * last. A message already held keeps its place and takes the new fields: the
 * sender's own row settles into the message it was always going to be, rather
 * than being replaced by a second copy of itself.
 *
 * An anchor this client does not hold means the position is somewhere it has
 * not loaded, and the end is the only honest answer.
 */
export function openMessage(messages: Message[], incoming: Message, after: string | null): Message[] {
  const held = messages.findIndex((message) => message.id === incoming.id);
  if (held >= 0) {
    const next = [...messages];
    next[held] = { ...next[held]!, ...incoming };
    return next;
  }
  const anchor = after ? messages.findIndex((message) => message.id === after) : -1;
  const at = anchor >= 0 ? anchor + 1 : messages.length;
  return [...messages.slice(0, at), incoming, ...messages.slice(at)];
}

export interface TranscriptOp {
  op?: string;
  message?: ProtocolMessage;
  after?: string | null;
  answers?: string | null;
  messageId?: string;
  stopReason?: string | null;
  content?: string;
  blocks?: unknown[];
  interim?: boolean;
  inclusive?: boolean;
  generationId?: string | null;
}

/**
 * Apply one of the server's statements about the transcript.
 *
 * The whole of what a transcript op does, in one place, so the browser and the
 * tests that check what a chat ends up looking like are running the same code
 * rather than two descriptions of it.
 */
export function applyTranscriptOp(messages: Message[], event: TranscriptOp): Message[] {
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
        blocks: (event.blocks as Message["blocks"]) ?? message.blocks,
        interim: event.interim,
        stopReason: event.stopReason || message.stopReason,
        stopped: event.stopReason === "aborted" || message.stopped,
        streaming: false,
      }
      : message));
  }
  if (event.op === "message.drop" && event.messageId) {
    // A cut says where the history ends; a turn giving up a row it never wrote
    // into takes back that row alone.
    return event.inclusive
      ? truncateAt(messages, event.messageId, { inclusive: true })
      : messages.filter((message) => message.id !== event.messageId);
  }
  return messages;
}

/**
 * Give every answer this generation has named a row, in order, at the end.
 *
 * The row is a placeholder: the live overlay draws the tokens as they arrive,
 * and the transcript projection skips it until it settles. What it holds is a
 * position, claimed when the id first exists rather than when the turn ends.
 *
 * Only for a backend that does not state its own order. Where the server sends
 * transcript ops, `openMessage` has already put the row where it belongs, and
 * guessing at the end would be a second, worse answer to the same question.
 */
export function claimAnswerRows(
  messages: Message[],
  generation: { id: string; assistantMessages?: Array<{ id: string }> },
): Message[] {
  const live = new Set((generation.assistantMessages || []).map((answer) => answer.id).filter(Boolean));
  if (!live.size) return messages;
  // A sync can name an answer this turn is still writing -- the one an
  // interrupt publishes does exactly that. Holding the row as the turn's own
  // keeps it from being drawn twice, once settled and once live, until the
  // turn ends and settles it for real.
  const held = messages.some((message) => live.has(message.id) && !message.streaming)
    ? messages.map((message) => (live.has(message.id) && !message.streaming
      ? { ...message, streaming: true, generationId: generation.id }
      : message))
    : messages;
  const missing = [...live]
    .filter((id) => !held.some((message) => message.id === id))
    .map((id) => ({ id, role: "assistant" as const, content: "",
      generationId: generation.id, streaming: true }));
  return missing.length ? [...held, ...missing] : held;
}

/** Replace a finished turn's placeholders with what it wrote, in place. */
export function settleAnswerRows(messages: Message[], generationId: string, frozen: Message[]): Message[] {
  const written = new Set(frozen.map((message) => message.id));
  const kept = messages.filter((message) =>
    !(message.streaming && message.generationId === generationId && !written.has(message.id)));
  return upsertMessages(kept, frozen);
}
