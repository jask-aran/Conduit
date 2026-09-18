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

export type TimelineItem =
  | { type: "message"; value: Message; index: number; order: number }
  | { type: "tool"; value: ToolItem; index: number; order: number };

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

export function buildTimeline(messages: Message[] = [], tools: ToolItem[] = [], { streaming = false }: { streaming?: boolean } = {}): TimelineItem[] {
  const lastMessage = messages.at(-1);
  const messageItems: TimelineItem[] = messages.flatMap((message, index) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const showStreaming = streaming && message === lastMessage && message.role === "assistant";
    if (message.role === "assistant" && !String(message.content || "").trim() && !showStreaming) return [];
    return [{ type: "message" as const, value: message, index, order: message.order ?? index }];
  });
  const toolItems: TimelineItem[] = tools.map((tool, index) => ({
    type: "tool" as const,
    value: tool,
    index: messageItems.length + index,
    order: tool.seq ?? tool.order ?? (messageItems.length + index),
  }));
  return [...messageItems, ...toolItems].sort((left, right) => {
    const leftTime = Date.parse(left.value.timestamp || "");
    const rightTime = Date.parse(right.value.timestamp || "");
    const leftHasTime = !Number.isNaN(leftTime);
    const rightHasTime = !Number.isNaN(rightTime);
    if (leftHasTime && rightHasTime && leftTime !== rightTime) return leftTime - rightTime;
    if (left.order !== right.order) return left.order - right.order;
    if (left.type !== right.type) return left.type === "message" ? -1 : 1;
    return left.index - right.index;
  });
}

/**
 * Take the harness's word for the prompt that starts a turn.
 *
 * Pi puts ids on session entries, not on the messages it streams, so the only
 * handle an unwritten turn has is its generation -- which is what that turn's
 * sync matches on. Stamping it here, where the prompt is committed, covers
 * every way one arrives: the composer's own optimistic copy, a prompt the
 * harness sends back after a regenerate forked the original away, and either
 * order the started/committed events happen to land in.
 */
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
  // Where the sync has placed messages so far. A message this client has not
  // seen goes after the one the server put before it, not at the end -- the
  // order is the server's statement, and only the position of a message nobody
  // has seen before is open to question.
  let cursor = -1;
  for (const message of incoming) {
    const index = message.id ? next.findIndex((item) => item.id === message.id) : -1;
    if (index >= 0) {
      next[index] = { ...message, key: next[index]!.key ?? next[index]!.id };
      cursor = index;
      continue;
    }
    const at = cursor >= 0 ? cursor + 1 : next.length;
    next.splice(at, 0, message);
    cursor = at;
  }
  return next;
}

/** The whole transcript as the server has it; only the composer's unsent rows survive. */
export function replaceMessages(current: Message[], incoming: Message[]): Message[] {
  const keys = new Map(current.map((message) => [message.id, message.key ?? message.id]));
  const pending = current.filter((message) => message.pending);
  return [...incoming.map((message) => ({ ...message, key: keys.get(message.id) ?? message.id })), ...pending];
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
  { replaceAll = false }: { replaceAll?: boolean } = {},
): { messages: Message[]; tools: ToolItem[] } {
  if (!incomingMessages.length && !replaceAll) return { messages, tools };
  if (replaceAll) return { messages: replaceMessages(messages, incomingMessages), tools: incomingTools };
  const nextMessages = upsertMessages(messages, incomingMessages);
  const incomingIds = new Set(incomingTools.map((tool) => tool.id));
  // Turns the sync did not carry keep the tools they own.
  const retained = toolIds(nextMessages);
  return {
    messages: nextMessages,
    tools: [...tools.filter((tool) => retained.has(tool.id) && !incomingIds.has(tool.id)), ...incomingTools],
  };
}
