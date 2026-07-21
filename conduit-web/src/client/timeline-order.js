import { parseAttachmentEnvelope } from "../attachment-envelope.js";
import { isInteractiveRequestKind } from "./interactive-request-state.js";

export function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text")
    .map((block) => block.text || "")
    .join("\n");
}

export function displayUserText(message) {
  const raw = messageText(message);
  return parseAttachmentEnvelope(raw).message || raw;
}

export function mergeToolEvent(tools, event, { nextSeq } = {}) {
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
          error: event.isError != null
            ? Boolean(event.isError)
            : (event.error != null ? Boolean(event.error) : item.error),
        }
        : item)),
      created: false,
    };
  }
  const seq = typeof nextSeq === "function" ? nextSeq() : (event.seq ?? tools.length);
  const tool = {
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

export function assignToolSeq(tools) {
  return (tools || []).map((tool, index) => ({
    ...tool,
    seq: tool.seq == null ? index : tool.seq,
  }));
}

export function maxToolSeq(tools) {
  return (tools || []).reduce((max, tool) => {
    const seq = Number(tool.seq);
    return Number.isFinite(seq) ? Math.max(max, seq) : max;
  }, -1);
}

export function buildTimeline(messages, tools, { streaming = false, requests = [] } = {}) {
  const list = messages || [];
  const lastMessage = list[list.length - 1];
  const messageItems = list.flatMap((message, index) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const showStreaming = streaming && message === lastMessage && message.role === "assistant";
    if (message.role === "assistant" && !String(message.content || "").trim() && !showStreaming) return [];
    return [{ type: "message", value: message, index, order: message.order ?? index }];
  });
  const toolItems = (tools || []).map((tool, index) => ({
    type: "tool",
    value: tool,
    index: messageItems.length + index,
    order: tool.seq ?? tool.order ?? (messageItems.length + index),
  }));
  const requestIds = new Set();
  const requestItems = (requests || []).flatMap((request, index) => {
    if (!request?.id || !isInteractiveRequestKind(request.kind) || requestIds.has(request.id)) return [];
    requestIds.add(request.id);
    const itemIndex = messageItems.length + toolItems.length + index;
    return [{
      type: "question",
      value: request,
      index: itemIndex,
      order: request.seq ?? request.order ?? itemIndex,
    }];
  });
  const typeRank = { message: 0, tool: 1, question: 2 };
  return [...messageItems, ...toolItems, ...requestItems].sort((left, right) => {
    const leftTime = Date.parse(left.value.timestamp || "");
    const rightTime = Date.parse(right.value.timestamp || "");
    const leftHasTime = !Number.isNaN(leftTime);
    const rightHasTime = !Number.isNaN(rightTime);
    if (leftHasTime && rightHasTime && leftTime !== rightTime) return leftTime - rightTime;
    if (left.order != null && right.order != null && left.order !== right.order) {
      return left.order - right.order;
    }
    if (left.type !== right.type) return (typeRank[left.type] ?? 99) - (typeRank[right.type] ?? 99);
    return left.index - right.index;
  });
}

export function promotePendingUser(messages, eventMessage) {
  const list = Array.isArray(messages) ? messages : [];
  const content = displayUserText(eventMessage);
  const pendingIndex = (() => {
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const message = list[index];
      if (message.role !== "user" || !message.pending) continue;
      if (!content || message.content === content || content.includes(message.content)) return index;
    }
    return -1;
  })();
  if (pendingIndex >= 0) {
    const copy = [...list];
    const previous = copy[pendingIndex];
    copy[pendingIndex] = {
      ...previous,
      pending: false,
      queueMode: undefined,
      content: previous.content || content,
      timestamp: eventMessage?.timestamp || previous.timestamp,
      id: eventMessage?.id || previous.id,
    };
    return copy;
  }
  if (!content) return list;
  const already = list.some((message) => message.role === "user" && !message.pending && message.content === content);
  if (already) return list;
  return [...list, {
    id: eventMessage?.id || `user_${Date.now()}`,
    role: "user",
    content,
    timestamp: eventMessage?.timestamp || new Date().toISOString(),
  }];
}
