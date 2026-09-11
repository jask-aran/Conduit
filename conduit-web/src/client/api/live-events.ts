import type { CacheStats, ChatCapabilities, ContextUsage, HostUiRequest, QueueState, RetryState, SessionStats } from "./contracts";
import type { ProtocolMessage, ToolLifecycleEvent } from "../timeline-order";

type UnknownRecord = Record<string, unknown>;

export interface GenerationHandle {
  id: string | null;
  closed: boolean;
  settled: boolean;
}

export interface SessionSnapshot {
  contextUsage: ContextUsage | null;
  sessionStats: SessionStats | null;
  cacheStats: CacheStats | null;
  queue: QueueState | null;
  hostUiRequests: HostUiRequest[] | null;
  compacting: boolean | null;
  retry: RetryState | null | undefined;
  generation: GenerationHandle | null;
  stopping: boolean;
  active: boolean;
  capabilities: ChatCapabilities | null;
}

interface EventBase { generationId: string | null }
export type StructuredGenerationType =
  | "generation_resume"
  | "generation_started"
  | "generation_running"
  | "generation_stopping"
  | "assistant_message_started"
  | "content_block_started"
  | "content_block_delta"
  | "content_block_completed"
  | "assistant_message_completed"
  | "tool_execution_started"
  | "tool_execution_updated"
  | "tool_execution_completed"
  | "generation_retry_started"
  | "generation_retry_ended"
  | "generation_turn_ended"
  | "generation_settled"
  | "generation_stopped"
  | "generation_failed";

export interface StructuredGenerationEvent extends EventBase {
  type: StructuredGenerationType;
  seq: number;
  [key: string]: unknown;
}
export interface RuntimeStateEvent extends EventBase {
  type: "runtime_state";
  session: SessionSnapshot;
  contextUsage: ContextUsage | null;
  sessionStats: SessionStats | null;
  cacheStats: CacheStats | null;
  queue: QueueState | null;
  hostUiRequests: HostUiRequest[] | null;
}

export type LiveEvent = EventBase & (
  | RuntimeStateEvent
  | { type: "context_usage"; contextUsage: ContextUsage | null; sessionStats: SessionStats | null; cacheStats: CacheStats | null }
  | { type: "compaction_start" | "compaction_end" | "auto_retry_end" }
  | { type: "auto_retry_start"; retry: RetryState }
  | { type: "queue_update"; queue: QueueState }
  | { type: "extension_ui_request"; request: HostUiRequest | null }
  | { type: "extension_ui_resolved"; requestId: string }
  | { type: "session_checkpoint"; chatId: string; title: string | null; generationSeq: number | null }
  | { type: "message_end"; message: ProtocolMessage }
  | { type: "transcript_sync"; messages: unknown[]; tools: unknown[] }
  | StructuredGenerationEvent
  | { type: "runtime_error" | "client_error"; code: string; message: string }
  | { type: "unknown"; sourceType: string }
);

const record = (value: unknown): UnknownRecord => value && typeof value === "object" ? value as UnknownRecord : {};
const text = (value: unknown) => value == null ? "" : String(value);
const optionalText = (value: unknown) => value == null || value === "" ? null : String(value);
const list = (value: unknown) => Array.isArray(value) ? value : [];
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined;
const STRUCTURED_GENERATION_TYPES = new Set<StructuredGenerationType>([
  "generation_resume", "generation_started", "generation_running", "generation_stopping",
  "assistant_message_started", "content_block_started", "content_block_delta", "content_block_completed",
  "assistant_message_completed", "tool_execution_started", "tool_execution_updated", "tool_execution_completed",
  "generation_retry_started", "generation_retry_ended", "generation_turn_ended", "generation_settled",
  "generation_stopped", "generation_failed",
]);

export function isStructuredGenerationEvent(event: LiveEvent): event is StructuredGenerationEvent {
  return STRUCTURED_GENERATION_TYPES.has(event.type as StructuredGenerationType)
    && typeof (event as Partial<StructuredGenerationEvent>).seq === "number";
}
const contextUsage = (value: unknown): ContextUsage | null => Object.keys(record(value)).length ? record(value) as ContextUsage : null;
const sessionStats = (value: unknown): SessionStats | null => Object.keys(record(value)).length ? record(value) as unknown as SessionStats : null;
const cacheStats = (value: unknown): CacheStats | null => Object.keys(record(value)).length ? record(value) as unknown as CacheStats : null;
const queue = (value: unknown): QueueState | null => {
  const source = record(value);
  if (!Object.keys(source).length) return null;
  return { steering: list(source.steering), followUp: list(source.followUp) };
};
const retry = (value: unknown): RetryState | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const source = record(value);
  return {
    attempt: number(source.attempt),
    maxAttempts: number(source.maxAttempts),
    delayMs: number(source.delayMs),
    errorMessage: optionalText(source.errorMessage),
  };
};

export function normalizeHostUiRequest(value: unknown): HostUiRequest | null {
  const source = record(value);
  const nested = record(source.request);
  const kind = text(source.kind || source.method || nested.kind || nested.method);
  if (!["confirm", "select", "input", "editor"].includes(kind)) return null;
  const id = text(source.id || nested.id);
  if (!id) return null;
  return {
    id,
    kind: kind as HostUiRequest["kind"],
    title: text(source.title || nested.title || "Request"),
    message: text(source.message || nested.message),
    options: list(source.options || nested.options).map(String),
    placeholder: text(source.placeholder || nested.placeholder),
    prefill: text(source.prefill || nested.prefill),
    timeoutMs: number(source.timeout ?? source.timeoutMs ?? nested.timeout) ?? null,
  };
}

function generation(value: unknown): GenerationHandle | null {
  const source = record(value);
  if (!Object.keys(source).length) return null;
  return { id: optionalText(source.id), closed: Boolean(source.closed), settled: Boolean(source.settled) };
}

function sessionSnapshot(value: unknown): SessionSnapshot {
  const source = record(value);
  const requests = source.hostUiRequests === undefined ? null : list(source.hostUiRequests).map(normalizeHostUiRequest).filter((item): item is HostUiRequest => Boolean(item));
  return {
    contextUsage: contextUsage(source.contextUsage),
    sessionStats: sessionStats(source.sessionStats),
    cacheStats: cacheStats(source.cacheStats),
    queue: queue(source.queue),
    hostUiRequests: requests,
    compacting: source.compacting == null ? null : Boolean(source.compacting),
    retry: retry(source.retry),
    generation: generation(source.generation),
    stopping: Boolean(source.stopping),
    active: Boolean(source.active),
    capabilities: Object.keys(record(source.capabilities)).length ? record(source.capabilities) as unknown as ChatCapabilities : null,
  };
}

// Pi timestamps messages with epoch milliseconds, while the session file
// timestamps its entries with an ISO string. Stringifying the number gave the
// transcript "Invalid Date" live and the right time after a reload.
function messageTimestamp(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  const parsed = typeof value === "number" ? new Date(value) : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function protocolMessage(value: unknown): ProtocolMessage {
  const source = record(value);
  return {
    id: optionalText(source.id) || undefined,
    role: optionalText(source.role) || undefined,
    content: source.content,
    timestamp: messageTimestamp(source.timestamp),
    stopReason: optionalText(source.stopReason) || undefined,
    errorMessage: optionalText(source.errorMessage),
  };
}

export function normalizeLiveEvent(value: unknown): LiveEvent {
  const source = record(value);
  const sourceType = text(source.type);
  const generationId = optionalText(source.generationId);
  const seq = number(source.seq ?? source.sequence);
  if (STRUCTURED_GENERATION_TYPES.has(sourceType as StructuredGenerationType) && seq !== undefined) {
    return { ...source, type: sourceType as StructuredGenerationType, generationId, seq } as StructuredGenerationEvent;
  }
  switch (sourceType) {
    case "generation_replay": return { type: "generation_resume", generationId, seq: seq ?? 0, generation: source.generation };
    case "assistant_content": {
      const phase = text(source.phase);
      if (phase === "start") return { type: "assistant_message_started", generationId, seq: seq ?? 0, messageId: text(source.messageId) };
      if (phase === "delta") return {
        type: "content_block_delta", generationId, seq: seq ?? 0,
        messageId: text(source.messageId), contentIndex: number(source.contentIndex) ?? 0,
        blockType: text(source.blockKind), delta: text(source.delta),
      };
      return { type: "assistant_message_completed", generationId, seq: seq ?? 0,
        messageId: text(source.messageId), blocks: list(source.blocks).map((block) => {
          const item = record(block);
          return { ...item, type: item.kind === "tool_call" ? "toolCall" : item.kind };
        }), stopReason: text(source.stopReason || "stop"), errorMessage: optionalText(source.errorMessage) };
    }
    case "tool_activity": return {
      type: source.phase === "start" ? "tool_execution_started" : source.phase === "update" ? "tool_execution_updated" : "tool_execution_completed",
      generationId, seq: seq ?? 0, toolCallId: text(source.toolCallId), name: text(source.name),
      arguments: source.input, partialResult: source.phase === "update" ? source.output : undefined,
      result: source.phase === "end" ? source.output : undefined, isError: Boolean(source.isError),
    };
    case "status": {
      const detail = text(source.detail);
      const status = text(source.status);
      const type = detail === "stopped" ? "generation_stopped"
        : status === "idle" ? "generation_settled"
          : status === "stopping" ? "generation_stopping"
            : detail === "generation_running" ? "generation_running" : "generation_started";
      return { type, generationId, seq: seq ?? 0, processTerminated: Boolean(source.processTerminated) };
    }
    case "error": {
      const detail = record(source.error);
      return { type: "runtime_error", generationId, code: text(detail.code), message: text(detail.message) };
    }
    case "permission_request": return { type: "extension_ui_request", generationId, request: normalizeHostUiRequest({
      id: source.requestId, kind: source.kind, title: source.title, message: source.message,
      options: source.options, placeholder: source.placeholder, prefill: source.prefill, timeoutMs: source.timeoutMs,
    }) };
    case "permission_resolved": return { type: "extension_ui_resolved", generationId, requestId: text(source.requestId) };
    case "usage": return { type: "context_usage", generationId, contextUsage: contextUsage(source.contextUsage), sessionStats: sessionStats(source.sessionStats), cacheStats: cacheStats(source.cacheStats) };
    case "queue_state": return { type: "queue_update", generationId, queue: queue(source.queue) || { steering: [], followUp: [] } };
    case "compaction": return { type: source.active ? "compaction_start" : "compaction_end", generationId };
    case "retry": return source.active
      ? { type: "auto_retry_start", generationId, retry: retry(source.retry) || {} }
      : { type: "auto_retry_end", generationId };
    case "transcript_message": return { type: "message_end", generationId, message: protocolMessage(source.message) };
    case "transcript_sync": return { type: "transcript_sync", generationId, messages: list(source.messages), tools: list(source.tools) };
    case "runtime_state": {
      if (!Object.keys(record(source.session)).length && source.lifecycle) {
        const active = source.lifecycle === "working" || source.status === "working";
        const session = sessionSnapshot({ active, stopping: source.status === "stopping", generation: generationId ? { id: generationId, closed: !active, settled: !active } : null, capabilities: source.capabilities });
        return { type: "runtime_state", generationId, session, contextUsage: null, sessionStats: null, cacheStats: null, queue: null, hostUiRequests: null };
      }
      const requests = source.hostUiRequests === undefined ? null : list(source.hostUiRequests).map(normalizeHostUiRequest).filter((item): item is HostUiRequest => Boolean(item));
      return { type: "runtime_state", generationId, session: sessionSnapshot(source.session), contextUsage: contextUsage(source.contextUsage), sessionStats: sessionStats(source.sessionStats), cacheStats: cacheStats(source.cacheStats), queue: queue(source.queue), hostUiRequests: requests };
    }
    case "context_usage": return { type: "context_usage", generationId, contextUsage: contextUsage(source.contextUsage), sessionStats: sessionStats(source.sessionStats), cacheStats: cacheStats(source.cacheStats) };
    case "compaction_start": return { type: "compaction_start", generationId };
    case "compaction_end": return { type: "compaction_end", generationId };
    case "auto_retry_start": return { type: "auto_retry_start", generationId, retry: retry(source) || {} };
    case "auto_retry_end": return { type: "auto_retry_end", generationId };
    case "queue_update": return { type: "queue_update", generationId, queue: queue(source) || { steering: [], followUp: [] } };
    case "extension_ui_request": return { type: "extension_ui_request", generationId, request: normalizeHostUiRequest(source) };
    case "extension_ui_resolved": return { type: "extension_ui_resolved", generationId, requestId: text(source.requestId || source.id) };
    case "session_checkpoint": {
      const chat = record(source.chat);
      return {
        type: "session_checkpoint",
        generationId,
        generationSeq: number(source.generationSeq ?? source.sequence) ?? null,
        chatId: text(chat.id || source.chatId),
        title: optionalText(chat.title || source.title),
      };
    }
    case "message_end": return { type: "message_end", generationId, message: protocolMessage(source.message) };
    case "runtime_error": return { type: "runtime_error", generationId, code: text(source.code), message: text(source.message) };
    case "client_error": return { type: "client_error", generationId, code: text(source.code), message: text(source.message) };
    default: return { type: "unknown", sourceType, generationId };
  }
}
