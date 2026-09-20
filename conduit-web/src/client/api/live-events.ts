import type { CacheStats, ChatCapabilities, ChatSummary, ContextUsage, HostUiRequest, QueueState, RetryState, SessionStats } from "./contracts";
import type { ProtocolMessage } from "../timeline-order";

type UnknownRecord = Record<string, unknown>;

export interface TurnArtifactSummary {
  id: string;
  messageId: string | null;
  sequence: number;
  targetSequence: number | null;
  summary: { added: number; removed: number; preferredPath: string } | null;
}

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

/**
 * The place an event holds in its chat's order, when it holds one.
 *
 * Only events that change what the transcript says are numbered, so an
 * unstamped event is not a hole -- it is a delta, or state, which the next
 * numbered event restates anyway.
 */
export interface LogStamp { id: string; seq: number }

interface EventBase { generationId: string | null; log?: LogStamp }
/**
 * The four events a live generation is built from, in Conduit's words.
 *
 * These were eighteen, in Pi's words, and the browser reached them by
 * translating the contract back into the names Pi's own stream uses -- so a
 * delta was `content_block_delta` here, `assistant_content` on the wire, and
 * `content_block_delta` again inside Pi. Two translations to arrive where it
 * started, and for Codex and ChatGPT Web a translation into a vocabulary
 * neither end speaks.
 *
 * Six of the eighteen could not arrive at all: `content_block_started`,
 * `content_block_completed`, `generation_retry_started`,
 * `generation_retry_ended`, `generation_turn_ended` and `generation_failed`
 * have no adapter case, so they reached the browser as `pi_event` and were
 * dropped. The reducer kept handling them because the test that guards it
 * feeds Pi's internal stream rather than the wire.
 */
export type StructuredGenerationType =
  | "generation_replay"
  | "assistant_content"
  | "tool_activity"
  | "status";

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
  | { type: "usage"; contextUsage: ContextUsage | null; sessionStats: SessionStats | null; cacheStats: CacheStats | null }
  | { type: "compaction"; active: boolean }
  | { type: "retry"; active: boolean; retry: RetryState | null }
  | { type: "queue_state"; queue: QueueState }
  | { type: "permission_request"; request: HostUiRequest | null }
  | { type: "permission_resolved"; requestId: string }
  | { type: "history_truncated"; beforeMessageId: string | null; afterMessageId: string | null }
  | { type: "session_checkpoint"; chatId: string; title: string | null; chat: ChatSummary | null; artifacts: TurnArtifactSummary[] | null }
  | { type: "user_message_committed"; message: ProtocolMessage }
  | { type: "transcript_sync"; messages: unknown[]; tools: unknown[]; replace?: boolean }
  | { type: "transcript_op"; op: "message.open"; message: ProtocolMessage; after: string | null;
    answers: string | null }
  | { type: "transcript_op"; op: "message.close"; messageId: string; stopReason: string | null;
    content: string; blocks: unknown[]; interim: boolean; discarded: boolean }
  | { type: "transcript_op"; op: "message.drop"; messageId: string; inclusive: boolean; keep: boolean }
  | { type: "transcript_op"; op: "tool.open"; toolCallId: string; name: string; input: unknown;
    messageId: string | null }
  | { type: "transcript_op"; op: "tool.close"; toolCallId: string; output: unknown; isError: boolean }
  | { type: "log_state"; log: LogStamp }
  | { type: "log_reset" }
  | StructuredGenerationEvent
  | { type: "error"; scope: "runtime" | "request"; code: string; message: string }
  | { type: "runtime_exit"; deliberate: boolean }
  | { type: "unknown"; sourceType: string }
);

const record = (value: unknown): UnknownRecord => value && typeof value === "object" ? value as UnknownRecord : {};
const text = (value: unknown) => value == null ? "" : String(value);
const optionalText = (value: unknown) => value == null || value === "" ? null : String(value);
const list = (value: unknown) => Array.isArray(value) ? value : [];
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined;
const STRUCTURED_GENERATION_TYPES = new Set<StructuredGenerationType>([
  "generation_replay", "assistant_content", "tool_activity", "status",
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

function logStamp(value: unknown): LogStamp | undefined {
  const source = record(value);
  const id = optionalText(source.id);
  const seq = number(source.seq);
  return id && seq !== undefined ? { id, seq } : undefined;
}

/**
 * Keep the event's place in the order on whatever shape it normalizes into.
 *
 * Every case below builds its own object, so a stamp added to one of them
 * would be dropped by all the others. It is put back here, once.
 */
export function normalizeLiveEvent(value: unknown): LiveEvent {
  const stamp = logStamp(record(value).log);
  const normalized = normalizeLiveEventBody(value);
  return stamp ? { ...normalized, log: stamp } as LiveEvent : normalized;
}

function normalizeLiveEventBody(value: unknown): LiveEvent {
  const source = record(value);
  const sourceType = text(source.type);
  const generationId = optionalText(source.generationId);
  // One number, one name. The adapters used to publish it as `sequence` while
  // the log, the reducer and every event type here called it `seq`, and this
  // line was the bridge between the two.
  const seq = number(source.seq);
  // A generation event is passed straight through. Below this there used to be
  // a case per type rebuilding each field, which could only run for an event
  // with no `seq` -- and every adapter states one, so none of them ever did.
  // They were the last of the field-by-field rewrites, left behind when the
  // pass-through was added above them.
  if (STRUCTURED_GENERATION_TYPES.has(sourceType as StructuredGenerationType) && seq !== undefined) {
    return { ...source, type: sourceType as StructuredGenerationType, generationId, seq } as StructuredGenerationEvent;
  }
  switch (sourceType) {
    // Whose fault it was is stated, not guessed from which of two event names
    // arrived. A rejected command leaves the turn alone; a runtime failure
    // ends it.
    case "error": {
      const detail = record(source.error);
      const scope = source.scope === "request" ? "request" : "runtime";
      return { type: "error", scope, generationId, code: text(detail.code), message: text(detail.message) };
    }
    case "permission_request": return { type: "permission_request", generationId, request: normalizeHostUiRequest({
      id: source.requestId, kind: source.kind, title: source.title, message: source.message,
      options: source.options, placeholder: source.placeholder, prefill: source.prefill, timeoutMs: source.timeoutMs,
    }) };
    case "permission_resolved": return { type: "permission_resolved", generationId, requestId: text(source.requestId) };
    case "usage": return { type: "usage", generationId, contextUsage: contextUsage(source.contextUsage), sessionStats: sessionStats(source.sessionStats), cacheStats: cacheStats(source.cacheStats) };
    case "queue_state": return { type: "queue_state", generationId, queue: queue(source.queue) || { steering: [], followUp: [] } };
    case "compaction": return { type: "compaction", generationId, active: Boolean(source.active) };
    case "retry": return { type: "retry", generationId, active: Boolean(source.active),
      retry: source.active ? retry(source.retry) || {} : null };
    case "user_message_committed": return { type: "user_message_committed", generationId, message: protocolMessage(source.message) };
    case "transcript_sync": return { type: "transcript_sync", generationId, messages: list(source.messages), tools: list(source.tools),
      ...(source.replace ? { replace: true } : {}) };
    // The server stating the transcript: which messages there are and where,
    // what each one says, and which tools ran. This is the whole of how a row
    // gets its place -- nothing downstream works one out.
    case "transcript_op": {
      const op = text(source.op);
      if (op === "message.open") {
        return { type: "transcript_op", op, generationId, message: protocolMessage(source.message),
          after: optionalText(source.after), answers: optionalText(source.answers) };
      }
      if (op === "message.close") {
        return { type: "transcript_op", op, generationId, messageId: text(source.messageId),
          stopReason: optionalText(source.stopReason), content: text(source.content), blocks: list(source.blocks),
          interim: Boolean(source.interim), discarded: Boolean(source.discarded) };
      }
      if (op === "message.drop") {
        return { type: "transcript_op", op, generationId, messageId: text(source.messageId),
          inclusive: Boolean(source.inclusive), keep: Boolean(source.keep) };
      }
      if (op === "tool.open") {
        return { type: "transcript_op", op, generationId, toolCallId: text(source.toolCallId),
          name: text(source.name), input: source.input, messageId: optionalText(source.messageId) };
      }
      if (op === "tool.close") {
        return { type: "transcript_op", op, generationId, toolCallId: text(source.toolCallId),
          output: source.output, isError: Boolean(source.isError) };
      }
      return { type: "unknown", sourceType, generationId };
    }
    case "log_state": {
      const stamp = logStamp(source.log);
      return stamp ? { type: "log_state", generationId, log: stamp } : { type: "unknown", sourceType, generationId };
    }
    case "log_reset": return { type: "log_reset", generationId };
    // One shape. There used to be a second, rebuilt from `lifecycle` when the
    // event carried no session, for the thinner frame three adapters returned
    // from `attach` on top of the one the stream sends anyway.
    case "runtime_state": {
      const requests = source.hostUiRequests === undefined ? null : list(source.hostUiRequests).map(normalizeHostUiRequest).filter((item): item is HostUiRequest => Boolean(item));
      return { type: "runtime_state", generationId, session: sessionSnapshot(source.session), contextUsage: contextUsage(source.contextUsage), sessionStats: sessionStats(source.sessionStats), cacheStats: cacheStats(source.cacheStats), queue: queue(source.queue), hostUiRequests: requests };
    }
    case "history_truncated":
      return { type: "history_truncated", generationId,
        beforeMessageId: optionalText(source.beforeMessageId),
        afterMessageId: optionalText(source.afterMessageId) };
    case "session_checkpoint": {
      const chat = record(source.chat);
      return {
        type: "session_checkpoint",
        generationId,
        chatId: text(chat.id || source.chatId),
        title: optionalText(chat.title || source.title),
        // The socket carries the whole chat row. Dropping it made the open
        // chat's unread state depend on the global SSE stream being alive.
        chat: typeof chat.id === "string" ? chat as unknown as ChatSummary : null,
        artifacts: Array.isArray(source.artifacts) ? source.artifacts.flatMap((value) => {
          const item = record(value);
          const summary = record(item.summary);
          if (typeof item.id !== "string" || typeof item.sequence !== "number") return [];
          return [{ id: item.id, messageId: optionalText(item.messageId), sequence: item.sequence,
            targetSequence: typeof item.targetSequence === "number" ? item.targetSequence : null,
            summary: typeof summary.added === "number" && typeof summary.removed === "number" && typeof summary.preferredPath === "string"
              ? { added: summary.added, removed: summary.removed, preferredPath: summary.preferredPath } : null }];
        }) : null,
      };
    }
    // The process is gone. `deliberate` separates a stop the server chose --
    // the reaper, or someone picking Stop process -- from a crash, because only
    // the second is worth reconnecting through.
    case "runtime_exit": return { type: "runtime_exit", generationId, deliberate: Boolean(source.deliberate) };
    default: return { type: "unknown", sourceType, generationId };
  }
}
