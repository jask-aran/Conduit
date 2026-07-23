function record(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeBlock(block, contentIndex) {
  if (block?.type === "thinking") {
    return {
      type: "thinking",
      contentIndex,
      text: String(block.thinking || ""),
      redacted: Boolean(block.redacted),
    };
  }
  if (block?.type === "text") {
    return { type: "text", contentIndex, text: String(block.text || "") };
  }
  if (block?.type === "toolCall") {
    return {
      type: "toolCall",
      contentIndex,
      toolCallId: String(block.id || ""),
      name: String(block.name || ""),
      arguments: block.arguments,
    };
  }
  return null;
}

export function createPiEventNormalizer(generationId, { startingSequence = 0 } = {}) {
  let sequence = startingSequence;
  let messageSequence = 0;
  let activeMessageId = null;

  const emit = (event) => ({ ...event, generationId, seq: ++sequence });
  const normalize = (sourceValue) => {
    const source = record(sourceValue);
    const update = record(source.assistantMessageEvent);
    const partial = record(update.partial);
    const content = Array.isArray(partial.content) ? partial.content : [];

    switch (source.type) {
      case "generation_started":
        return [emit({ type: "generation_started", continuation: Boolean(source.continuation) })];
      case "agent_start":
        return [emit({ type: "generation_running" })];
      case "message_start":
        if (source.message?.role !== "assistant") return [];
        activeMessageId = `m${++messageSequence}`;
        return [emit({ type: "assistant_message_started", messageId: activeMessageId })];
      case "message_update": {
        if (!activeMessageId || !update.type || update.type === "start") return [];
        const contentIndex = Number(update.contentIndex);
        if (!Number.isInteger(contentIndex) || contentIndex < 0) return [];
        const blockType = update.type.startsWith("thinking_")
          ? "thinking"
          : update.type.startsWith("text_") ? "text"
            : update.type.startsWith("toolcall_") ? "toolCall" : null;
        if (!blockType) return [];
        if (update.type.endsWith("_start")) {
          const normalized = normalizeBlock(content[contentIndex], contentIndex)
            || { type: blockType, contentIndex };
          return [emit({
            type: "content_block_started",
            messageId: activeMessageId,
            block: normalized,
          })];
        }
        if (update.type.endsWith("_delta")) {
          return [emit({
            type: "content_block_delta",
            messageId: activeMessageId,
            blockType,
            contentIndex,
            delta: String(update.delta || ""),
          })];
        }
        if (update.type === "toolcall_end") {
          const normalized = normalizeBlock(update.toolCall, contentIndex);
          return normalized ? [emit({
            type: "content_block_completed",
            messageId: activeMessageId,
            block: normalized,
          })] : [];
        }
        const normalized = blockType === "thinking"
          ? { type: "thinking", contentIndex, text: String(update.content || ""), redacted: Boolean(content[contentIndex]?.redacted) }
          : { type: "text", contentIndex, text: String(update.content || "") };
        return [emit({
          type: "content_block_completed",
          messageId: activeMessageId,
          block: normalized,
        })];
      }
      case "message_end": {
        if (source.message?.role !== "assistant" || !activeMessageId) return [];
        const messageId = activeMessageId;
        activeMessageId = null;
        const blocks = (Array.isArray(source.message.content) ? source.message.content : [])
          .map(normalizeBlock)
          .filter(Boolean);
        return [emit({
          type: "assistant_message_completed",
          messageId,
          blocks,
          stopReason: String(source.message.stopReason || "stop"),
          errorMessage: source.message.errorMessage ? String(source.message.errorMessage) : null,
          usage: source.message.usage || null,
        })];
      }
      case "tool_execution_start":
        return [emit({
          type: "tool_execution_started",
          toolCallId: String(source.toolCallId || ""),
          name: String(source.toolName || ""),
          arguments: source.args,
        })];
      case "tool_execution_update":
        return [emit({
          type: "tool_execution_updated",
          toolCallId: String(source.toolCallId || ""),
          name: String(source.toolName || ""),
          arguments: source.args,
          partialResult: source.partialResult,
        })];
      case "tool_execution_end":
        return [emit({
          type: "tool_execution_completed",
          toolCallId: String(source.toolCallId || ""),
          name: String(source.toolName || ""),
          result: source.result,
          isError: Boolean(source.isError),
        })];
      case "auto_retry_start":
        return [emit({
          type: "generation_retry_started",
          retry: {
            attempt: Number(source.attempt) || 0,
            maxAttempts: Number(source.maxAttempts) || 0,
            delayMs: Number(source.delayMs) || 0,
            errorMessage: source.errorMessage ? String(source.errorMessage) : null,
          },
        })];
      case "auto_retry_end":
        return [emit({ type: "generation_retry_ended" })];
      case "agent_end":
        return [emit({ type: "generation_turn_ended", willRetry: Boolean(source.willRetry) })];
      case "agent_settled":
        return [emit({ type: "generation_settled" })];
      case "generation_stopped":
        return [emit({ type: "generation_stopped" })];
      case "runtime_error":
        return [emit({
          type: "generation_failed",
          error: {
            code: source.code ? String(source.code) : "",
            message: String(source.message || "Runtime error"),
          },
        })];
      default:
        return [];
    }
  };

  return {
    normalize,
    get sequence() { return sequence; },
    get activeMessageId() { return activeMessageId; },
  };
}
