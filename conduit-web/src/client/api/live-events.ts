import type { CacheStats, ChatCapabilities, ChatSummary, ContextUsage, HostUiRequest, Question, QueueState, RetryState, SessionStats, ToolKind, TurnOutcome } from "./contracts";
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
  | { type: "retry"; active: boolean; retry: RetryState | null; seq?: number }
  | { type: "queue_state"; queue: QueueState }
  | { type: "permission_request"; request: HostUiRequest | null }
  | { type: "permission_resolved"; requestId: string }
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
  | { type: "transcript_op"; op: "tool.close"; toolCallId: string; output: unknown; isError: boolean; cancelled?: boolean; kind?: ToolKind; subject?: string; completedAt?: string }
  | { type: "transcript_op"; op: "turn.settle"; promptId: string; outcome: TurnOutcome }
  | { type: "log_state"; log: LogStamp }
  | { type: "log_reset" }
  | StructuredGenerationEvent
  | { type: "error"; scope: "runtime" | "request"; seq?: number; error?: { code?: string; message?: string } }
  | { type: "runtime_exit"; deliberate: boolean }
  | { type: "unknown"; sourceType: string }
);

const record = (value: unknown): UnknownRecord => value && typeof value === "object" ? value as UnknownRecord : {};
const text = (value: unknown) => value == null ? "" : String(value);
const optionalText = (value: unknown) => value == null || value === "" ? null : String(value);
const list = (value: unknown) => Array.isArray(value) ? value : [];
const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined;
const TRANSCRIPT_OPS = new Set(["message.open", "message.close", "message.drop", "tool.open", "tool.close", "turn.settle"]);
/**
 * The phases each generation event is allowed to arrive in.
 *
 * The event itself is passed through -- it is already Conduit's words, and
 * rebuilding it here is what this file stopped doing -- but which words they
 * are is checked, because the phase is the discriminator both folds switch on.
 * An event naming a phase neither end has a case for would otherwise fold into
 * nothing at both ends while still advancing the turn's position, so a new
 * adapter event could be added, reach the browser, change nothing, and look
 * delivered. Rejected here it arrives as `unknown`, which is what it is.
 *
 * A `status` with no phase is not a transition and has no case in either fold,
 * so it is not one of these. Codex used to send one to report that it was
 * waiting on an approval; what the session is busy with travels as
 * `runtime_state`, which the browser has a case for.
 */
const GENERATION_PHASES: Record<StructuredGenerationType, Set<string> | null> = {
  generation_replay: null,
  assistant_content: new Set(["start", "delta", "final"]),
  tool_activity: new Set(["start", "update", "end"]),
  status: new Set(["started", "running", "stopping", "stopped", "settled"]),
};
const STRUCTURED_GENERATION_TYPES = new Set<StructuredGenerationType>(
  Object.keys(GENERATION_PHASES) as StructuredGenerationType[]);

/**
 * What each of those events has to carry to be foldable.
 *
 * Only the fields both folds read without asking: a delta names the block it is
 * adding to, a final states the blocks it ended with, a tool event names the
 * call. A frame missing one of them used to pass through and throw inside the
 * browser's store -- `event.blocks.map` on an undefined -- which is a crash
 * rather than a dropped event. This is a check, not a rebuild: what passes is
 * the event as the server stated it.
 */
/** The block kinds a live assistant message can carry, per `AssistantBlock`. */
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
 * A turn event that is folded as well as acted on.
 *
 * A retry and a failure hold a place in the turn's sequence and both folds have
 * a case for them -- they are what puts `retry` and `error` on the generation
 * the server snapshots and a reconnecting browser is restated from. Unlike the
 * four above they also mean something to the chat around the turn: a retry
 * moves the composer's state, an error raises a message. So they are folded
 * first and then handled, rather than routed to one or the other.
 *
 * The browser used to only handle them. Its copy of the generation therefore
 * had `retry: null` and `error: null` through a turn the server's copy had both
 * on, and the difference only disappeared when a reconnect replaced the whole
 * snapshot.
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

/**
 * A request the harness is waiting on an answer to, in the contract's words.
 *
 * Stated flat: `permission_request` carries `requestId` and the fields beside
 * it, and `runtime_state` lists the same thing under `id`. The nested
 * `{ request: { method } }` shape this also accepted is Pi's own, and it is
 * read where Pi's bytes are read -- `normalizeHostUiRequest` in
 * `pi-activity.js` -- so by the time anything reaches the browser it has
 * already been said once, in these names. Accepting the second shape here only
 * kept a spelling alive that no adapter sends.
 */
export function normalizeHostUiRequest(value: unknown): HostUiRequest | null {
  const source = record(value);
  const kind = text(source.kind);
  if (!["confirm", "select", "input", "editor", "question"].includes(kind)) return null;
  const id = text(source.id || source.requestId);
  if (!id) return null;
  // Checked, then carried. The fields below are the ones something reads
  // without asking first, so they are given a shape here; everything else the
  // request was stated with travels with it, and a harness adding a field does
  // not have to teach this file about it before the dialog can show it.
  // The envelope is not part of the request: this is handed the whole event,
  // because the contract states a request flat rather than nested.
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
    const phases = GENERATION_PHASES[sourceType as StructuredGenerationType];
    if (phases && !phases.has(text(source.phase))) return { type: "unknown", sourceType, generationId };
    const carries = GENERATION_REQUIREMENTS[`${sourceType}:${text(source.phase)}`];
    if (carries && !carries(source)) return { type: "unknown", sourceType, generationId };
    return { ...source, type: sourceType as StructuredGenerationType, generationId, seq } as StructuredGenerationEvent;
  }
  switch (sourceType) {
    // Whose fault it was is stated, not guessed from which of two event names
    // arrived. A rejected command leaves the turn alone; a runtime failure
    // ends it.
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
    case "usage": return { type: "usage", generationId, contextUsage: contextUsage(source.contextUsage), sessionStats: sessionStats(source.sessionStats), cacheStats: cacheStats(source.cacheStats) };
    case "queue_state": return { type: "queue_state", generationId, queue: queue(source.queue) || { steering: [], followUp: [] } };
    case "compaction": return { type: "compaction", generationId, active: Boolean(source.active) };
    // `seq` is the turn-local position, and both reducers order by it. Leaving
    // it off here made a retry and a failure the two lifecycle events a reducer
    // reading this stream had to refuse.
    case "retry": return { ...source, type: "retry", generationId, ...(seq === undefined ? {} : { seq }),
      active: Boolean(source.active), retry: source.active ? source.retry ?? {} : null } as LiveEvent;
    case "transcript_sync": return { type: "transcript_sync", generationId, messages: list(source.messages), tools: list(source.tools),
      ...(source.replace ? { replace: true } : {}) };
    // The server stating the transcript: which messages there are and where,
    // what each one says, and which tools ran. This is the whole of how a row
    // gets its place -- nothing downstream works one out.
    // The op is the statement. It was checked where it was made -- every
    // builder in `transcript-ops.js` runs `assertTranscriptOp` before the op
    // leaves -- so rebuilding it here field by field only invented a second
    // spelling of the same thing, and quietly dropped any field the builders
    // learned to say until this list was updated to match. What the server
    // stated is what the client applies.
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
