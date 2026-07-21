import { parseAttachmentEnvelope } from "../attachment-envelope.js";
import type { Message, ToolItem } from "./api/contracts";

export interface ProtocolMessage {
  id?: string;
  role?: string;
  content?: unknown;
  timestamp?: string;
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

export function maxToolSeq(tools: ToolItem[] = []): number {
  return tools.reduce((max, tool) => {
    const seq = Number(tool.seq);
    return Number.isFinite(seq) ? Math.max(max, seq) : max;
  }, -1);
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
