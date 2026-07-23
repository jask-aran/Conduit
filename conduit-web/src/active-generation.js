const TERMINAL_STATUSES = new Set(["stopped", "complete", "failed"]);

export function createActiveGeneration(id, { status = "submitting", continuation = false } = {}) {
  return {
    id,
    status,
    continuation,
    assistantMessages: [],
    toolExecutions: {},
    retry: null,
    error: null,
    lastSeq: 0,
  };
}

export function contentBlockIdentity(generationId, messageId, contentIndex) {
  return `${generationId}:${messageId}:${contentIndex}`;
}

function cloneGeneration(state) {
  return {
    ...state,
    assistantMessages: [...state.assistantMessages],
    toolExecutions: { ...state.toolExecutions },
  };
}

function cloneMessage(state, messageId) {
  const index = state.assistantMessages.findIndex((message) => message.id === messageId);
  if (index < 0) return null;
  const message = {
    ...state.assistantMessages[index],
    blocks: [...state.assistantMessages[index].blocks],
  };
  state.assistantMessages[index] = message;
  return message;
}

function upsertBlock(message, incoming) {
  const index = message.blocks.findIndex((block) => block.contentIndex === incoming.contentIndex);
  if (index < 0) {
    const block = { ...incoming };
    message.blocks.push(block);
    message.blocks.sort((left, right) => left.contentIndex - right.contentIndex);
    return block;
  }
  const block = { ...message.blocks[index], ...incoming };
  message.blocks[index] = block;
  return block;
}

function terminalStatus(state) {
  const lastMessage = state.assistantMessages.at(-1);
  if (lastMessage?.stopReason === "error") return "failed";
  if (lastMessage?.stopReason === "aborted") return "stopped";
  return "complete";
}

export function snapshotActiveGeneration(state) {
  return state ? structuredClone(state) : null;
}

export function generationResumeEvent(state) {
  return {
    type: "generation_resume",
    generationId: state.id,
    seq: state.lastSeq,
    generation: snapshotActiveGeneration(state),
  };
}

export function reduceActiveGeneration(current, event) {
  if (!event || !event.generationId) return current;
  if (event.type === "generation_resume") {
    if (!event.generation || event.generation.id !== event.generationId) return current;
    if (current?.id === event.generationId && current.lastSeq > event.seq) return current;
    return snapshotActiveGeneration(event.generation);
  }
  if (event.type === "generation_started") {
    if (current?.id === event.generationId) return current;
    const started = createActiveGeneration(event.generationId, {
      continuation: Boolean(event.continuation),
    });
    started.lastSeq = event.seq;
    return started;
  }
  if (!current || current.id !== event.generationId) return current;
  if (event.seq <= current.lastSeq || TERMINAL_STATUSES.has(current.status)) return current;

  const next = cloneGeneration(current);
  next.lastSeq = event.seq;

  switch (event.type) {
    case "generation_running":
      next.status = "running";
      break;
    case "generation_stopping":
      next.status = "stopping";
      break;
    case "assistant_message_started":
      if (!next.assistantMessages.some((message) => message.id === event.messageId)) {
        next.assistantMessages.push({
          id: event.messageId,
          status: "streaming",
          stopReason: null,
          errorMessage: null,
          blocks: [],
        });
      }
      break;
    case "content_block_started": {
      const message = cloneMessage(next, event.messageId);
      if (message) upsertBlock(message, {
        ...event.block,
        status: "streaming",
        identity: contentBlockIdentity(next.id, event.messageId, event.block.contentIndex),
      });
      break;
    }
    case "content_block_delta": {
      const message = cloneMessage(next, event.messageId);
      if (!message) break;
      const existing = message.blocks.find((block) => block.contentIndex === event.contentIndex);
      const block = upsertBlock(message, {
        type: event.blockType,
        contentIndex: event.contentIndex,
        status: "streaming",
        identity: contentBlockIdentity(next.id, event.messageId, event.contentIndex),
      });
      if (event.blockType === "toolCall") block.argumentsText = `${existing?.argumentsText || ""}${event.delta}`;
      else block.text = `${existing?.text || ""}${event.delta}`;
      break;
    }
    case "content_block_completed": {
      const message = cloneMessage(next, event.messageId);
      if (message) upsertBlock(message, {
        ...event.block,
        status: "complete",
        identity: contentBlockIdentity(next.id, event.messageId, event.block.contentIndex),
      });
      break;
    }
    case "assistant_message_completed": {
      const message = cloneMessage(next, event.messageId);
      if (!message) break;
      const existingByIndex = new Map(message.blocks.map((block) => [block.contentIndex, block]));
      message.blocks = event.blocks.map((block) => ({
        ...existingByIndex.get(block.contentIndex),
        ...block,
        status: "complete",
        identity: contentBlockIdentity(next.id, event.messageId, block.contentIndex),
      }));
      message.status = event.stopReason === "error" || event.stopReason === "aborted" ? "error" : "complete";
      message.stopReason = event.stopReason;
      message.errorMessage = event.errorMessage || null;
      break;
    }
    case "tool_execution_started":
      next.toolExecutions[event.toolCallId] = {
        toolCallId: event.toolCallId,
        name: event.name,
        arguments: event.arguments,
        status: "running",
        partialResult: null,
        result: null,
        isError: false,
      };
      break;
    case "tool_execution_updated": {
      const existing = next.toolExecutions[event.toolCallId] || { toolCallId: event.toolCallId };
      next.toolExecutions[event.toolCallId] = {
        ...existing,
        name: event.name || existing.name,
        arguments: event.arguments ?? existing.arguments,
        status: "running",
        partialResult: event.partialResult,
      };
      break;
    }
    case "tool_execution_completed": {
      const existing = next.toolExecutions[event.toolCallId] || { toolCallId: event.toolCallId };
      next.toolExecutions[event.toolCallId] = {
        ...existing,
        name: event.name || existing.name,
        status: event.isError ? "error" : "complete",
        result: event.result,
        isError: Boolean(event.isError),
      };
      break;
    }
    case "generation_retry_started":
      next.status = "running";
      next.retry = event.retry;
      break;
    case "generation_retry_ended":
      next.retry = null;
      break;
    case "generation_turn_ended":
      if (!event.willRetry) next.retry = null;
      break;
    case "generation_settled":
      next.status = terminalStatus(next);
      next.retry = null;
      break;
    case "generation_stopped":
      next.status = "stopped";
      next.retry = null;
      break;
    case "generation_failed":
      next.status = "failed";
      next.error = event.error;
      next.retry = null;
      break;
  }
  return next;
}

export function reduceGenerationEvents(events, initial = null) {
  return events.reduce(reduceActiveGeneration, initial);
}

export function textBlockClassifications(state) {
  const result = {};
  const ordered = state.assistantMessages.flatMap((message, messageIndex) =>
    message.blocks.map((block) => ({ block, message, messageIndex })));
  const laterToolCall = new Array(ordered.length).fill(false);
  let seenToolCall = false;
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    laterToolCall[index] = seenToolCall;
    if (ordered[index].block.type === "toolCall") seenToolCall = true;
  }
  ordered.forEach(({ block, message }, index) => {
    if (block.type !== "text") return;
    result[block.identity] = message.stopReason === "toolUse" || laterToolCall[index]
      ? "interim"
      : "answer";
  });
  return result;
}

export function activeGenerationFromPersistedMessages(generationId, messages, { toolExecutions = {} } = {}) {
  const state = createActiveGeneration(generationId, { status: "complete" });
  state.assistantMessages = messages
    .filter((message) => message?.role === "assistant")
    .map((message, messageIndex) => ({
      id: `m${messageIndex + 1}`,
      status: message.stopReason === "error" || message.stopReason === "aborted" ? "error" : "complete",
      stopReason: message.stopReason || "stop",
      errorMessage: message.errorMessage || null,
      blocks: normalizePersistedBlocks(generationId, `m${messageIndex + 1}`, message.content),
    }));
  state.toolExecutions = structuredClone(toolExecutions);
  state.status = terminalStatus(state);
  return state;
}

function normalizePersistedBlocks(generationId, messageId, content) {
  if (!Array.isArray(content)) {
    return content == null || content === "" ? [] : [{
      type: "text",
      contentIndex: 0,
      text: String(content),
      status: "complete",
      identity: contentBlockIdentity(generationId, messageId, 0),
    }];
  }
  return content.flatMap((block, contentIndex) => {
    if (block?.type === "text") return [{
      type: "text",
      contentIndex,
      text: String(block.text || ""),
      status: "complete",
      identity: contentBlockIdentity(generationId, messageId, contentIndex),
    }];
    if (block?.type === "thinking") return [{
      type: "thinking",
      contentIndex,
      text: String(block.thinking || ""),
      redacted: Boolean(block.redacted),
      status: "complete",
      identity: contentBlockIdentity(generationId, messageId, contentIndex),
    }];
    if (block?.type === "toolCall") return [{
      type: "toolCall",
      contentIndex,
      toolCallId: String(block.id || ""),
      name: String(block.name || ""),
      arguments: block.arguments,
      status: "complete",
      identity: contentBlockIdentity(generationId, messageId, contentIndex),
    }];
    return [];
  });
}
