import type { ContextUsage, HostUiRequest, QueueState, RetryState } from "./contracts";
import type { ProtocolMessage, ToolLifecycleEvent } from "../timeline-order";

type UnknownRecord = Record<string, unknown>;

export interface GenerationHandle {
  id: string | null;
  closed: boolean;
  settled: boolean;
}

export interface SessionSnapshot {
  contextUsage: ContextUsage | null;
  queue: QueueState | null;
  hostUiRequests: HostUiRequest[] | null;
  compacting: boolean | null;
  retry: RetryState | null | undefined;
  generation: GenerationHandle | null;
  stopping: boolean;
  active: boolean;
}

interface EventBase { generationId: string | null }
export interface RuntimeSnapshotEvent extends EventBase {
  type: "runtime_snapshot";
  session: SessionSnapshot;
  contextUsage: ContextUsage | null;
  queue: QueueState | null;
  hostUiRequests: HostUiRequest[] | null;
  events: LiveEvent[];
  stream: { generationId: string; content: string } | null;
}
export interface RuntimeStateEvent extends EventBase {
  type: "runtime_state";
  session: SessionSnapshot;
  contextUsage: ContextUsage | null;
  queue: QueueState | null;
  hostUiRequests: HostUiRequest[] | null;
}

export type AssistantMessageUpdate =
  | { type: "thinking_start" }
  | { type: "thinking_delta"; delta: string }
  | { type: "thinking_end"; content: string }
  | { type: "text_start" | "text_delta" | "text_end" }
  | { type: "unknown" };

export type LiveEvent = EventBase & (
  | RuntimeSnapshotEvent
  | RuntimeStateEvent
  | { type: "generation_started"; continuation: boolean }
  | { type: "agent_start" }
  | { type: "agent_end" | "agent_settled"; willRetry: boolean }
  | { type: "runtime_exit" }
  | { type: "context_usage"; contextUsage: ContextUsage | null }
  | { type: "compaction_start" | "compaction_end" | "auto_retry_end" }
  | { type: "auto_retry_start"; retry: RetryState }
  | { type: "queue_update"; queue: QueueState }
  | { type: "extension_ui_request"; request: HostUiRequest | null }
  | { type: "extension_ui_resolved"; requestId: string }
  | { type: "generation_stopped"; processTerminated: boolean }
  | { type: "session_checkpoint"; chatId: string }
  | { type: "message_start" | "message_end"; message: ProtocolMessage }
  | { type: "message_update"; update: AssistantMessageUpdate }
  | { type: "assistant_stream_delta"; delta: string }
  | { type: "assistant_stream_final"; content: string }
  | ToolLifecycleEvent
  | { type: "runtime_error" | "client_error"; code: string; message: string }
  | { type: "unknown"; sourceType: string }
);

const record = (value: unknown): UnknownRecord => value && typeof value === "object" ? value as UnknownRecord : {};
const text = (value: unknown) => value == null ? "" : String(value);
const optionalText = (value: unknown) => value == null || value === "" ? null : String(value);
const list = (value: unknown) => Array.isArray(value) ? value : [];
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined;
const contextUsage = (value: unknown): ContextUsage | null => Object.keys(record(value)).length ? record(value) as ContextUsage : null;
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
    queue: queue(source.queue),
    hostUiRequests: requests,
    compacting: source.compacting == null ? null : Boolean(source.compacting),
    retry: retry(source.retry),
    generation: generation(source.generation),
    stopping: Boolean(source.stopping),
    active: Boolean(source.active),
  };
}

function protocolMessage(value: unknown): ProtocolMessage {
  const source = record(value);
  return {
    id: optionalText(source.id) || undefined,
    role: optionalText(source.role) || undefined,
    content: source.content,
    timestamp: optionalText(source.timestamp) || undefined,
  };
}

function assistantUpdate(value: unknown): AssistantMessageUpdate {
  const source = record(value);
  switch (source.type) {
    case "thinking_start": return { type: "thinking_start" };
    case "thinking_delta": return { type: "thinking_delta", delta: text(source.delta) };
    case "thinking_end": return { type: "thinking_end", content: text(source.content) };
    case "text_start": return { type: "text_start" };
    case "text_delta": return { type: "text_delta" };
    case "text_end": return { type: "text_end" };
    default: return { type: "unknown" };
  }
}

function toolEvent(type: ToolLifecycleEvent["type"], source: UnknownRecord, generationId: string | null): LiveEvent {
  return {
    type,
    generationId,
    toolCallId: optionalText(source.toolCallId) || undefined,
    id: optionalText(source.id) || undefined,
    toolName: optionalText(source.toolName) || undefined,
    name: optionalText(source.name) || undefined,
    args: source.args,
    partialResult: source.partialResult,
    result: source.result,
    done: source.done == null ? undefined : Boolean(source.done),
    isError: source.isError == null ? undefined : Boolean(source.isError),
    error: source.error == null ? undefined : Boolean(source.error),
    timestamp: optionalText(source.timestamp) || undefined,
    seq: number(source.seq),
  };
}

export function normalizeLiveEvent(value: unknown): LiveEvent {
  const source = record(value);
  const sourceType = text(source.type);
  const generationId = optionalText(source.generationId);
  switch (sourceType) {
    case "runtime_snapshot": {
      const stream = record(source.stream);
      const requests = source.hostUiRequests === undefined ? null : list(source.hostUiRequests).map(normalizeHostUiRequest).filter((item): item is HostUiRequest => Boolean(item));
      return {
        type: "runtime_snapshot", generationId, session: sessionSnapshot(source.session), contextUsage: contextUsage(source.contextUsage),
        queue: queue(source.queue), hostUiRequests: requests, events: list(source.events).map(normalizeLiveEvent),
        stream: stream.generationId ? { generationId: text(stream.generationId), content: text(stream.content) } : null,
      };
    }
    case "runtime_state": {
      const requests = source.hostUiRequests === undefined ? null : list(source.hostUiRequests).map(normalizeHostUiRequest).filter((item): item is HostUiRequest => Boolean(item));
      return { type: "runtime_state", generationId, session: sessionSnapshot(source.session), contextUsage: contextUsage(source.contextUsage), queue: queue(source.queue), hostUiRequests: requests };
    }
    case "generation_started": return { type: "generation_started", generationId, continuation: Boolean(source.continuation) };
    case "agent_start": return { type: "agent_start", generationId };
    case "agent_end": return { type: "agent_end", generationId, willRetry: Boolean(source.willRetry) };
    case "agent_settled": return { type: "agent_settled", generationId, willRetry: Boolean(source.willRetry) };
    case "runtime_exit": return { type: "runtime_exit", generationId };
    case "context_usage": return { type: "context_usage", generationId, contextUsage: contextUsage(source.contextUsage) };
    case "compaction_start": return { type: "compaction_start", generationId };
    case "compaction_end": return { type: "compaction_end", generationId };
    case "auto_retry_start": return { type: "auto_retry_start", generationId, retry: retry(source) || {} };
    case "auto_retry_end": return { type: "auto_retry_end", generationId };
    case "queue_update": return { type: "queue_update", generationId, queue: queue(source) || { steering: [], followUp: [] } };
    case "extension_ui_request": return { type: "extension_ui_request", generationId, request: normalizeHostUiRequest(source) };
    case "extension_ui_resolved": return { type: "extension_ui_resolved", generationId, requestId: text(source.requestId || source.id) };
    case "generation_stopped": return { type: "generation_stopped", generationId, processTerminated: Boolean(source.processTerminated) };
    case "session_checkpoint": return { type: "session_checkpoint", generationId, chatId: text(record(source.chat).id) };
    case "message_start": return { type: "message_start", generationId, message: protocolMessage(source.message) };
    case "message_end": return { type: "message_end", generationId, message: protocolMessage(source.message) };
    case "message_update": return { type: "message_update", generationId, update: assistantUpdate(source.assistantMessageEvent) };
    case "assistant_stream_delta": return { type: "assistant_stream_delta", generationId, delta: text(source.delta) };
    case "assistant_stream_final": return { type: "assistant_stream_final", generationId, content: text(source.content) };
    case "tool_execution_start": return toolEvent("tool_execution_start", source, generationId);
    case "tool_execution_update": return toolEvent("tool_execution_update", source, generationId);
    case "tool_execution_end": return toolEvent("tool_execution_end", source, generationId);
    case "runtime_error": return { type: "runtime_error", generationId, code: text(source.code), message: text(source.message) };
    case "client_error": return { type: "client_error", generationId, code: text(source.code), message: text(source.message) };
    default: return { type: "unknown", sourceType, generationId };
  }
}
