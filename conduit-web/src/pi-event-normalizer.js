import { PI_TOOL_KINDS, piResultFailed, piResultSubject, piSubjectFields } from "./pi-capabilities.js";
import { toolKind, toolSubject } from "./harnesses/transcript-ops.js";
function record(value) {
  return value && typeof value === "object" ? value : {};
}

function normalizeTimestamp(value) {
  if (value == null || value === "") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Pi's block, in Conduit's spelling.
 *
 * The reads are Pi's -- `type`, `toolCall`, `arguments`, `thinking` -- because
 * that is what comes off Pi's wire. What leaves is Conduit's, the same names a
 * settled message is stated in. A block in flight carries more than a settled
 * one does, because `contentIndex` is how a delta finds the block it belongs
 * to, but it is the same block and it is called the same things.
 */
function normalizeBlock(block, contentIndex) {
  if (block?.type === "thinking") {
    return {
      kind: "thinking",
      contentIndex,
      text: String(block.thinking || ""),
      // Reasoning the provider returned only encrypted -- a signature and no
      // text -- is redacted as far as the reader is concerned: it happened,
      // and there is nothing of it to show.
      redacted: Boolean(block.redacted) || (!block.thinking && Boolean(block.thinkingSignature)),
    };
  }
  if (block?.type === "text") {
    return { kind: "text", contentIndex, text: String(block.text || "") };
  }
  if (block?.type === "toolCall") {
    const name = String(block.name || "");
    return {
      kind: "tool_call",
      contentIndex,
      toolCallId: String(block.id || ""),
      name,
      ...(name ? { toolKind: toolKind(PI_TOOL_KINDS, name) } : {}),
      input: block.arguments,
    };
  }
  return null;
}

/*
 * What a call acts on, read out of its arguments while the model is still
 * writing them: the first of the tool's subject fields whose string has
 * closed, or the first item of its list. A write states its path before its
 * content, so the file is known while the content streams. Tried only near
 * the start of the arguments, where those fields are, so a long write is not
 * rescanned on every delta.
 */
const SUBJECT_SCAN_LIMIT = 4000;
function subjectSoFar(name, args) {
  for (const field of piSubjectFields(name)) {
    const match = args.match(new RegExp(`"${field}"\\s*:\\s*\\[?\\s*"((?:[^"\\\\]|\\\\.)*)"`));
    if (!match) continue;
    try { return toolSubject(JSON.parse(`"${match[1]}"`)); } catch { continue; }
  }
  return null;
}

export function createPiEventNormalizer(generationId, { startingSequence = 0, claimMessageId = null } = {}) {
  let sequence = startingSequence;
  let messageSequence = 0;
  let activeMessageId = null;
  // The calls of the message being written, by content index: which tool,
  // under which id. Pi's RPC mode strips the partial message from every
  // stream event and states these only on a call's start, so they are kept
  // here for the deltas that follow it.
  let calls = new Map();

  const emit = (event) => ({ ...event, generationId, seq: ++sequence });
  const normalize = (sourceValue) => {
    const source = record(sourceValue);
    const update = record(source.assistantMessageEvent);
    const partial = record(update.partial);
    const content = Array.isArray(partial.content) ? partial.content : [];

    switch (source.type) {
      case "generation_started":
        return [emit({
          type: "generation_started",
          continuation: Boolean(source.continuation),
          continuationBase: source.continuationBase ? String(source.continuationBase) : "",
        })];
      case "agent_start":
        return [emit({ type: "generation_running" })];
      case "message_start":
        if (source.message?.role !== "assistant") return [];
        // Pi names nothing it streams. An id claimed for this answer makes the
        // live message and its eventual session entry one message; without one
        // the fallback is unique within this generation and nothing more.
        activeMessageId = claimMessageId?.() || `${generationId}:m${++messageSequence}`;
        calls = new Map();
        return [emit({ type: "assistant_message_started", messageId: activeMessageId })];
      case "message_update": {
        if (!activeMessageId || !update.type || update.type === "start") return [];
        const contentIndex = Number(update.contentIndex);
        if (!Number.isInteger(contentIndex) || contentIndex < 0) return [];
        const blockKind = update.type.startsWith("thinking_")
          ? "thinking"
          : update.type.startsWith("text_") ? "text"
            : update.type.startsWith("toolcall_") ? "tool_call" : null;
        if (!blockKind) return [];
        if (update.type === "toolcall_start") {
          const name = String(update.toolName || content[contentIndex]?.name || "");
          const toolCallId = String(update.id || content[contentIndex]?.id || "");
          calls.set(contentIndex, { name, toolCallId, ...(name ? { toolKind: toolKind(PI_TOOL_KINDS, name) } : {}) });
        }
        if (update.type.endsWith("_start")) {
          const normalized = normalizeBlock(content[contentIndex], contentIndex)
            || { kind: blockKind, contentIndex, ...(blockKind === "tool_call" ? calls.get(contentIndex) : {}) };
          // Some providers include their first token in the partial block at
          // *_start and emit that same token again as the first delta. Starts
          // establish block identity; deltas own streaming text.
          if (normalized.kind === "thinking" || normalized.kind === "text") delete normalized.text;
          return [emit({
            type: "content_block_started",
            messageId: activeMessageId,
            block: normalized,
          })];
        }
        if (update.type.endsWith("_delta")) {
          // A call being written says which tool it is as soon as Pi knows:
          // the browser never sees the call's start, only these, and without
          // a name it read as an unknown tool until the tool began to run.
          const call = blockKind === "tool_call"
            ? calls.get(contentIndex) || normalizeBlock(content[contentIndex], contentIndex)
            : null;
          if (call && calls.has(contentIndex) && !call.subject && call.name) {
            call.args = `${call.args || ""}${String(update.delta || "")}`;
            if (call.args.length <= SUBJECT_SCAN_LIMIT) {
              const subject = subjectSoFar(call.name, call.args);
              if (subject) call.subject = subject;
            }
          }
          return [emit({
            type: "content_block_delta",
            messageId: activeMessageId,
            blockKind,
            contentIndex,
            delta: String(update.delta || ""),
            ...(call?.name ? { name: call.name, toolKind: call.toolKind } : {}),
            ...(call?.subject ? { subject: call.subject } : {}),
            ...(call?.toolCallId ? { toolCallId: call.toolCallId } : {}),
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
        const normalized = blockKind === "thinking"
          ? { kind: "thinking", contentIndex, text: String(update.content || ""), redacted: Boolean(content[contentIndex]?.redacted) }
          : { kind: "text", contentIndex, text: String(update.content || "") };
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
          provider: source.message.provider ? String(source.message.provider) : null,
          model: source.message.model ? String(source.message.model) : null,
          timestamp: normalizeTimestamp(source.message.timestamp),
          usage: source.message.usage || null,
        })];
      }
      case "tool_execution_start":
        return [emit({
          type: "tool_execution_started",
          toolCallId: String(source.toolCallId || ""),
          name: String(source.toolName || ""),
          input: source.args,
          // When, stated once here, so every fold of it agrees on how long it took.
          at: new Date().toISOString(),
        })];
      case "tool_execution_update":
        return [emit({
          type: "tool_execution_updated",
          toolCallId: String(source.toolCallId || ""),
          name: String(source.toolName || ""),
          input: source.args,
          output: source.partialResult,
        })];
      case "tool_execution_end": {
        const name = String(source.toolName || "");
        const subject = piResultSubject(name, source.result?.details);
        return [emit({
          type: "tool_execution_completed",
          toolCallId: String(source.toolCallId || ""),
          name,
          output: source.result,
          isError: Boolean(source.isError) || piResultFailed(name, source.result?.details),
          ...(subject ? { subject } : {}),
          at: new Date().toISOString(),
        })];
      }
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
        return [emit({
          type: "generation_stopped",
          status: "stopped",
          processTerminated: Boolean(source.processTerminated),
        })];
      case "generation_stopping":
        return [emit({ type: "generation_stopping" })];
      case "runtime_error":
        return [emit({
          type: "generation_failed",
          error: {
            code: source.code ? String(source.code) : "",
            message: String(source.message || "Runtime error"),
          },
        })];
      case "runtime_exit":
        return [emit({
          type: "generation_failed",
          error: {
            code: "runtime_exit",
            message: String(source.message || "Pi process exited during generation"),
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
