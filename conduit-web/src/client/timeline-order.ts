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

export function promotePendingUser(messages: Message[], eventMessage: ProtocolMessage): Message[] {
  const content = displayUserText(eventMessage);
  const pendingIndex = (() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]!;
      if (message.role !== "user" || !message.pending) continue;
      if (!content || message.content === content || content.includes(message.content || "")) return index;
    }
    return -1;
  })();
  if (pendingIndex >= 0) {
    const copy = [...messages];
    const previous = copy[pendingIndex]!;
    copy[pendingIndex] = {
      ...previous,
      pending: false,
      queueMode: undefined,
      content: previous.content || content,
      timestamp: eventMessage.timestamp || previous.timestamp,
      id: eventMessage.id || previous.id,
    };
    return copy;
  }
  if (!content) return messages;
  if (messages.some((message) => message.role === "user" && !message.pending && message.content === content)) return messages;
  return [...messages, {
    id: eventMessage.id || `user_${Date.now()}`,
    role: "user",
    content,
    timestamp: eventMessage.timestamp || new Date().toISOString(),
  }];
}

/**
 * Commit a completed assistant message into the transcript.
 *
 * The turn that owns the live generation renders that structure instead of its
 * settled assistants, so committing here does not duplicate the streaming view
 * - it gives the turn something to fall back to once it stops being live. A
 * turn that ended early used to have nothing, and went blank until a reload.
 */
export function commitAssistantMessage(messages: Message[], eventMessage: ProtocolMessage): Message[] {
  const id = eventMessage.id;
  const blocks = Array.isArray(eventMessage.content) ? eventMessage.content as Message["blocks"] : undefined;
  const next: Message = {
    id: id || `assistant_${Date.now()}`,
    role: "assistant",
    content: messageText(eventMessage),
    blocks,
    stopReason: eventMessage.stopReason,
    errorMessage: eventMessage.errorMessage ?? null,
    timestamp: eventMessage.timestamp || new Date().toISOString(),
  };
  const index = id ? messages.findIndex((message) => message.id === id) : -1;
  if (index >= 0) {
    const copy = [...messages];
    copy[index] = { ...messages[index]!, ...next };
    return copy;
  }
  return [...messages, next];
}

/**
 * Merge the backend's own record of recent turns into the transcript.
 *
 * The incoming messages are authoritative for the turns they cover: they came
 * from the backend's transcript through the same projection the initial load
 * uses. Anything older is left alone, so a one-turn sync costs one turn.
 *
 * Ids cannot be relied on to find where the synced range begins. Pi puts ids on
 * session entries, not on the messages it streams, so the client's copy of a
 * turn has locally minted ids that match nothing. The sync always covers a
 * whole number of turns, so the fallback anchor is the same number of user
 * messages counted back from the end.
 */
export function mergeTranscript(messages: Message[], incoming: Message[], generationId?: string | null): Message[] {
  if (!incoming.length) return messages;
  const replaced = replacedRange(messages, incoming, generationId);
  // Nothing of the client's is recognisably part of this sync: it is a turn the
  // client has not seen, and it belongs after what it holds. Appending can at
  // worst leave a duplicate, which the next sync resolves; guessing at a
  // position can destroy a turn the sync never carried.
  if (replaced.at == null) return [...messages, ...incoming];
  // A pending message is the composer's, not the transcript's, so it survives.
  const pending = messages.slice(replaced.at).filter((message) => message.pending);
  const kept = messages.filter((message, index) => index < replaced.at! && !replaced.ids.has(message.id));
  const tail = messages.slice(replaced.at)
    .filter((message) => !message.pending && !replaced.ids.has(message.id));
  return [...kept, ...incoming, ...tail, ...pending];
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

/** Replace one committed transcript range, including the tools owned by it. */
export function mergeTranscriptProjection(
  messages: Message[],
  tools: ToolItem[],
  incomingMessages: Message[],
  incomingTools: ToolItem[],
  generationId?: string | null,
): { messages: Message[]; tools: ToolItem[] } {
  if (!incomingMessages.length) return { messages, tools };
  const merged = mergeTranscript(messages, incomingMessages, generationId);
  const incomingIds = new Set(incomingTools.map((tool) => tool.id));
  // The turns the sync did not replace keep the tools they own.
  const retainedIds = toolIds(merged.filter((message) => !incomingMessages.includes(message)));
  return {
    messages: merged,
    tools: [...tools.filter((tool) => retainedIds.has(tool.id) && !incomingIds.has(tool.id)), ...incomingTools],
  };
}

/**
 * Which of the client's messages this sync is the persisted copy of.
 *
 * Two keys, both stated rather than inferred. A message the sync names by id is
 * plainly the same message. A message the client froze out of a live generation
 * carries the generation that produced it, and the sync says which generation
 * it closes -- which is the only handle a turn has before Pi has written it,
 * because Pi puts ids on session entries, not on the messages it streams.
 *
 * What this deliberately does not do is guess by position. Counting the sync's
 * turns back from the end of the transcript is right only when the two lists
 * agree about how many turns there are, and a sync is sent at exactly the
 * moments they do not: it doubled a turn when it counted short, and destroyed
 * one when it counted long.
 */
function replacedRange(messages: Message[], incoming: Message[], generationId?: string | null):
{ at: number | null; ids: Set<string> } {
  const incomingIds = new Set(incoming.map((message) => message.id).filter(Boolean));
  const ids = new Set<string>();
  let at: number | null = null;
  messages.forEach((message, index) => {
    const matched = (message.id && incomingIds.has(message.id))
      || (generationId != null && message.generationId === generationId);
    if (!matched || message.pending) return;
    ids.add(message.id);
    if (at == null) at = index;
  });
  return { at, ids };
}


