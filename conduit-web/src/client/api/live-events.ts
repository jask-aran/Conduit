import type { CacheStats, ChatCapabilities, ChatSummary, ContextUsage, HostUiRequest, Question, QueueState, RetryState, SessionStats, ToolCallStep, ToolKind, TurnOutcome, TurnTiming } from "./contracts";
import type { ProtocolMessage } from "../timeline-order";
import type { LIVE_EVENTS } from "../../live-session-api.js";
import type { ChatBackendEvent } from "../../chat-backend-contract.js";

type LiveEventName = keyof typeof LIVE_EVENTS;

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

/** Only events that change what the transcript says are numbered: an unstamped event is a delta or state, not a hole. */
export interface LogStamp { id: string; seq: number }

interface EventBase { generationId: string | null; log?: LogStamp }
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
  | { type: "retry"; active: boolean; retry: RetryState | null; seq?: number }
  | { type: "queue_state"; queue: QueueState }
  | { type: "permission_request"; request: HostUiRequest | null }
  | { type: "permission_resolved"; requestId: string }
  | { type: "agents_changed" }
  // A Pi extension's `ctx.ui.notify`: said once, as a toast, never kept in the transcript.
  | { type: "extension_notice"; message: string; level: "info" | "warning" | "error" }
  | { type: "history_truncated"; beforeMessageId: string | null; afterMessageId: string | null }
  | { type: "session_checkpoint"; chatId: string; title: string | null; chat: ChatSummary | null; artifacts: TurnArtifactSummary[] | null }
  | { type: "transcript_sync"; messages: unknown[]; tools: unknown[]; replace?: boolean }
  | { type: "transcript_op"; op: "message.open"; message: ProtocolMessage; after: string | null;
    answers: string | null }
  | { type: "transcript_op"; op: "message.close"; messageId: string; stopReason: string | null;
    content: string; blocks: unknown[]; interim: boolean; discarded?: boolean;
    provider?: string; model?: string; timestamp?: string; errorMessage?: string }
  | { type: "transcript_op"; op: "message.drop"; messageId: string; inclusive: boolean; keep: boolean }
  | { type: "transcript_op"; op: "tool.open"; toolCallId: string; name: string; kind?: ToolKind; subject?: string; input: unknown; timestamp?: string;
    messageId: string | null }
  | { type: "transcript_op"; op: "tool.close"; toolCallId: string; output: unknown; isError: boolean; cancelled?: boolean; kind?: ToolKind; subject?: string; calls?: ToolCallStep[]; completedAt?: string }
  | { type: "transcript_op"; op: "tool.calls"; toolCallId: string; calls: ToolCallStep[] }
  | { type: "transcript_op"; op: "turn.settle"; promptId: string; outcome: TurnOutcome }
  | { type: "transcript_op"; op: "turn.time"; promptId: string; timing: TurnTiming }
  | { type: "log_state"; log: LogStamp }
  | { type: "log_reset" }
  | StructuredGenerationEvent
  | { type: "error"; scope: "runtime" | "request"; seq?: number; error?: { code?: string; message?: string } }
  | { type: "unknown"; sourceType: string }
);

/**
 * The three lists name the same events: what the hub declares, what its wire types describe (ChatBackendEvent) and
 * what this file normalizes them into. One gaining or losing a name without the others is a type error here.
 */
type Same<A, B> = [A] extends [B] ? [B] extends [A] ? true : never : never;
true satisfies Same<LiveEventName, ChatBackendEvent["type"]>;
true satisfies Same<LiveEventName, Exclude<LiveEvent["type"], "unknown">>;

const record = (value: unknown): UnknownRecord => value && typeof value === "object" ? value as UnknownRecord : {};
const text = (value: unknown) => value == null ? "" : String(value);
const optionalText = (value: unknown) => value == null || value === "" ? null : String(value);
const list = (value: unknown) => Array.isArray(value) ? value : [];
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined;
const TRANSCRIPT_OPS = new Set(["message.open", "message.close", "message.drop", "tool.open", "tool.close", "tool.calls", "turn.settle", "turn.time"]);
/**
 * The phase is the discriminator both folds switch on: an event naming a phase neither has a case for would fold into
 * nothing while still advancing the turn's position, so it is rejected here and arrives as `unknown`.
 */
const GENERATION_PHASES: Record<StructuredGenerationType, Set<string> | null> = {
  generation_replay: null,
  assistant_content: new Set(["start", "delta", "final"]),
  tool_activity: new Set(["start", "update", "end"]),
  status: new Set(["started", "running", "stopping", "stopped", "settled"]),
};
const STRUCTURED_GENERATION_TYPES = new Set<StructuredGenerationType>(
  Object.keys(GENERATION_PHASES) as StructuredGenerationType[]);

/** The fields both folds read without asking: a frame missing one would throw inside the store instead of being dropped. */
const BLOCK_KINDS = new Set(["text", "thinking", "narration", "tool_call"]);
const GENERATION_REQUIREMENTS: Record<string, (source: UnknownRecord) => boolean> = {
  "assistant_content:start": (source) => typeof source.messageId === "string",
  "assistant_content:delta": (source) => typeof source.messageId === "string"
    && typeof source.delta === "string" && Number.isInteger(source.contentIndex)
    && BLOCK_KINDS.has(text(source.blockKind)),
  "assistant_content:final": (source) => typeof source.messageId === "string" && Array.isArray(source.blocks),
  "tool_activity:start": (source) => typeof source.toolCallId === "string" && typeof source.name === "string",
  "tool_activity:update": (source) => typeof source.toolCallId === "string",
  "tool_activity:end": (source) => typeof source.toolCallId === "string",
  "generation_replay:": (source) => Boolean(record(source.generation).id),
};

export function isStructuredGenerationEvent(event: LiveEvent): event is StructuredGenerationEvent {
  return STRUCTURED_GENERATION_TYPES.has(event.type as StructuredGenerationType)
    && typeof (event as Partial<StructuredGenerationEvent>).seq === "number";
}

/**
 * Folded, then handled: a retry and a failure are on the generation the server snapshots, and they also move the
 * composer or raise a message. Only handling them leaves this copy of the generation differing from the server's.
 */
export type FoldedTurnEvent = Extract<LiveEvent, { type: "retry" } | { type: "error" }> & { seq: number };

export function isFoldedTurnEvent(event: LiveEvent): event is FoldedTurnEvent {
  // A rejected command is not part of any turn -- it has no generation and no
  // position -- so only a runtime failure is folded.
  if (event.type === "error" ? event.scope !== "runtime" : event.type !== "retry") return false;
  return typeof (event as { seq?: unknown }).seq === "number";
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
  const kind = text(source.kind);
  if (!["confirm", "select", "input", "editor", "question"].includes(kind)) return null;
  const id = text(source.id || source.requestId);
  if (!id) return null;
  // Only fields read without asking are shaped; the rest travels with the request, so a harness adding a field needs
  // no change here. The envelope is stripped because the contract states a request flat.
  const { requestId: _requestId, type: _type, generationId: _generationId, seq: _seq, log: _log, ...rest } = source;
  return {
    ...rest,
    id,
    kind: kind as HostUiRequest["kind"],
    title: text(source.title || "Request"),
    message: text(source.message),
    options: list(source.options).map(String),
    placeholder: text(source.placeholder),
    prefill: text(source.prefill),
    timeoutMs: number(source.timeoutMs) ?? null,
    ...(kind === "question" ? { questions: list(source.questions).map(question), notes: source.notes === true } : {}),
  } as HostUiRequest;
}

function question(value: unknown): Question {
  const source = record(value);
  const freeform = source.freeform && typeof source.freeform === "object" ? record(source.freeform) : null;
  return {
    id: text(source.id), header: text(source.header), prompt: text(source.prompt),
    multiSelect: source.multiSelect === true, secret: source.secret === true, required: source.required === true,
    options: list(source.options).map((item) => {
      const option = record(item);
      const preview = record(option.preview);
      return { id: text(option.id), label: text(option.label), description: text(option.description),
        ...(preview.text ? { preview: { format: preview.format === "markdown" ? "markdown" : "monospace", text: text(preview.text) } } : {}) };
    }),
    freeform: freeform ? { placeholder: text(freeform.placeholder), multiline: freeform.multiline === true, numeric: freeform.numeric === true } : false,
  } as Question;
}

function generation(value: unknown): GenerationHandle | null {
  const source = record(value);
  if (!Object.keys(source).length) return null;
  return { id: optionalText(source.id), settled: Boolean(source.settled) };
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

function logStamp(value: unknown): LogStamp | undefined {
  const source = record(value);
  const id = optionalText(source.id);
  const seq = number(source.seq);
  return id && seq !== undefined ? { id, seq } : undefined;
}

/** Every case below builds its own object, so the log stamp is put back here, once. */
export function normalizeLiveEvent(value: unknown): LiveEvent {
  const stamp = logStamp(record(value).log);
  const normalized = normalizeLiveEventBody(value);
  return stamp ? { ...normalized, log: stamp } as LiveEvent : normalized;
}

function normalizeLiveEventBody(value: unknown): LiveEvent {
  const source = record(value);
  const sourceType = text(source.type);
  const generationId = optionalText(source.generationId);
  const seq = number(source.seq);
  if (STRUCTURED_GENERATION_TYPES.has(sourceType as StructuredGenerationType) && seq !== undefined) {
    const phases = GENERATION_PHASES[sourceType as StructuredGenerationType];
    if (phases && !phases.has(text(source.phase))) return { type: "unknown", sourceType, generationId };
    const carries = GENERATION_REQUIREMENTS[`${sourceType}:${text(source.phase)}`];
    if (carries && !carries(source)) return { type: "unknown", sourceType, generationId };
    return { ...source, type: sourceType as StructuredGenerationType, generationId, seq } as StructuredGenerationEvent;
  }
  // The stream's own names only; each has a case, or the default below is a type error.
  const name = sourceType as LiveEventName;
  switch (name) {
    // A rejected command leaves the turn alone; a runtime failure ends it.
    case "error": {
      const detail = record(source.error);
      if (!text(detail.code) && !text(source.code)) return { type: "unknown", sourceType, generationId };
      const scope = source.scope === "request" ? "request" : "runtime";
      return { ...source, type: "error", scope, generationId, ...(seq === undefined ? {} : { seq }),
        error: Object.keys(detail).length ? detail : { code: text(source.code), message: text(source.message) } } as LiveEvent;
    }
    case "permission_request": {
      const request = normalizeHostUiRequest(source);
      if (!request) return { type: "unknown", sourceType, generationId };
      return { ...source, type: "permission_request", generationId, request } as LiveEvent;
    }
    case "permission_resolved": return { type: "permission_resolved", generationId, requestId: text(source.requestId) };
    case "agents_changed": return { type: "agents_changed", generationId };
    case "extension_notice": {
      const message = text(source.message);
      if (!message) return { type: "unknown", sourceType, generationId };
      return { type: "extension_notice", generationId, message, level: source.level === "warning" || source.level === "error" ? source.level : "info" };
    }
    case "usage": return { type: "usage", generationId, contextUsage: contextUsage(source.contextUsage), sessionStats: sessionStats(source.sessionStats), cacheStats: cacheStats(source.cacheStats) };
    case "queue_state": return { type: "queue_state", generationId, queue: queue(source.queue) || { steering: [], followUp: [] } };
    case "compaction": return { type: "compaction", generationId, active: Boolean(source.active) };
    // `seq` is the turn-local position both reducers order by; without it they refuse the event.
    case "retry": return { ...source, type: "retry", generationId, ...(seq === undefined ? {} : { seq }),
      active: Boolean(source.active), retry: source.active ? source.retry ?? {} : null } as LiveEvent;
    case "transcript_sync": return { type: "transcript_sync", generationId, messages: list(source.messages), tools: list(source.tools),
      ...(source.replace ? { replace: true } : {}) };
    // Applied as stated: the server checked the op where it was made (`assertTranscriptOp`), and rebuilding it here
    // would drop any field the builders add.
    case "transcript_op": {
      const op = text(source.op);
      if (!TRANSCRIPT_OPS.has(op)) return { type: "unknown", sourceType, generationId };
      return { ...source, type: "transcript_op", generationId } as unknown as LiveEvent;
    }
    case "log_state": {
      const stamp = logStamp(source.log);
      return stamp ? { type: "log_state", generationId, log: stamp } : { type: "unknown", sourceType, generationId };
    }
    case "log_reset": return { type: "log_reset", generationId };
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
        // Without it the open chat's unread state would depend on the global SSE stream being alive.
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
    // A generation event with no `seq`, which no fold can place.
    case "assistant_content": case "tool_activity": case "generation_replay": case "status":
      return { type: "unknown", sourceType, generationId };
    default:
      name satisfies never;
      return { type: "unknown", sourceType, generationId };
  }
}
