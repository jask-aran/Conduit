import { parseAttachmentEnvelope } from "../attachment-envelope.js";

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

function toolEventStatus(event, currentStatus = "pending") {
  if (event.cancelled) return "cancelled";
  if (event.isError || event.error) return "error";
  if (event.done || event.type === "tool_execution_end") return "done";
  if (["tool_execution_start", "tool_execution_update"].includes(event.type)) return "running";
  return event.status || currentStatus;
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
          status: toolEventStatus(event, item.status),
          startedAt: event.type === "tool_execution_start"
            ? (event.timestamp || item.startedAt)
            : (item.startedAt || (event.type === "tool_execution_update" ? event.timestamp : undefined)),
          completedAt: event.type === "tool_execution_end" ? (event.timestamp || item.completedAt) : item.completedAt,
        }
        : item)),
      created: false,
    };
  }
  const seq = typeof nextSeq === "function" ? nextSeq() : (event.seq ?? tools.length);
  const timestamp = event.timestamp || new Date().toISOString();
  const tool = {
    id,
    name: event.toolName || event.name || "tool",
    args: event.args,
    done: Boolean(event.done) || event.type === "tool_execution_end",
    error: Boolean(event.isError || event.error),
    status: toolEventStatus(event),
    timestamp,
    startedAt: ["tool_execution_start", "tool_execution_update"].includes(event.type) ? timestamp : undefined,
    completedAt: event.type === "tool_execution_end" ? timestamp : undefined,
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

export function buildTimeline(messages, tools, { streaming = false } = {}) {
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
  return [...messageItems, ...toolItems].sort((left, right) => {
    const leftTime = Date.parse(left.value.timestamp || "");
    const rightTime = Date.parse(right.value.timestamp || "");
    const leftHasTime = !Number.isNaN(leftTime);
    const rightHasTime = !Number.isNaN(rightTime);
    if (leftHasTime && rightHasTime && leftTime !== rightTime) return leftTime - rightTime;
    if (left.order != null && right.order != null && left.order !== right.order) {
      return left.order - right.order;
    }
    if (left.type !== right.type) return left.type === "message" ? -1 : 1;
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
