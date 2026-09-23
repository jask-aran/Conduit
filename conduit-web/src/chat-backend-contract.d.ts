/** Backend-neutral contract for chat adapters. */

export type SessionSurface = "chat" | "terminal";
export type AgentProtocol = "pi_rpc" | "acp" | "native_api" | "pty";
export type AgentImplementation = "conduit_pi" | "codex" | "opencode" | "chatgpt-web" | (string & {});
export type ProfileManagement = "conduit" | "agent";

export interface AgentProfile {
  id: string;
  label: string;
  management: ProfileManagement;
  agent: {
    protocol: AgentProtocol;
    implementation: AgentImplementation;
    installationId: string;
  };
}

export interface PersistedChatBackend {
  /** Null for imported Pi chats whose profile has not yet been assigned. */
  profileId: string | null;
  profileRevision: string | null;
  management: ProfileManagement;
  protocol: AgentProtocol;
  implementation: AgentImplementation;
  installationId: string;
  /** Adapter-owned model choice made before the backend session starts. */
  model?: string;
  opaqueSession: unknown;
}

export interface ChatCapabilities {
  history: "none" | "linear" | "tree";
  fork: boolean;
  regenerate: boolean;
  steer: boolean;
  followUpQueue: boolean;
  cancel: boolean;
  /**
   * An interrupted turn's partial assistant message survives as content the
   * next turn can see.
   *
   * Interrupting is not continuing. It means: what the model had written when
   * it was stopped stands as its answer, and a user message follows it saying
   * that was not what was wanted. For that to mean anything the partial has to
   * still be there when the next request is built.
   *
   * No harness integrated so far does this for text. Pi writes the partial to
   * its session file but marks it aborted with zeroed usage and leaves it out
   * of context; Codex does not persist it at all; ChatGPT Web never advances
   * its cursor past an interrupted exchange. Where this is false, interrupting
   * a text completion discards what was written, and the UI has to say so
   * rather than implying the model was redirected mid-thought.
   */
  interruptKeepsPartial: boolean;
  compaction: boolean;
  thinkingLevels: boolean;
  modelSwitch: boolean;
  toolUse: boolean;
  /** Answers host-UI approval requests, i.e. respondHostUi is real. */
  approvals: boolean;
  /** Offers selectable permission profiles to choose between. */
  permissionModes: boolean;
  usage: boolean;
  replay: boolean;
  attachments: boolean;
}

export interface HistoryTarget { nodeId: string; }
export interface ForkResult {
  opaqueSession: unknown;
  sourceMessage: { id: string; text: string } | null;
}

export interface ChatBackendAdapter<LiveSession = unknown, ModelCatalog = unknown> {
  launch(context: unknown, request: unknown, services: unknown): Promise<{
    live: LiveSession;
    mapping: Record<string, unknown>;
    modelRecovery: unknown;
  }>;
  create(options: unknown): Promise<LiveSession>;
  restore(opaqueSession: unknown, options?: unknown): Promise<LiveSession>;
  prompt(liveSessionId: string, message: string, options?: unknown): Promise<string>;
  cancel(liveSessionId: string, generationId?: string | null): Promise<unknown>;
  close(liveSessionId: string): Promise<unknown>;
  respondHostUi(liveSessionId: string, response: unknown): Promise<unknown> | unknown;
  replay(liveSessionId: string, since?: number): ChatBackendEvent | null;
  waitForSession(liveSessionId: string): Promise<unknown>;
  attach(liveSessionId: string, socket: unknown): ChatBackendEvent | null;
  view(liveSession: unknown): unknown;
  toClientEvent(event: unknown): unknown;
  publish(liveSession: unknown, event: unknown): unknown;
  queue(liveSessionId: string, mode: "steer" | "follow_up", message: string, options?: unknown): Promise<unknown>;
  clearQueue(liveSessionId: string): Promise<{ steering: unknown[]; followUp: unknown[] }>;
  fork(liveSessionId: string, target: HistoryTarget): Promise<ForkResult>;
  setModel(liveSessionId: string, model: string): Promise<unknown>;
  setThinkingLevel(liveSessionId: string, level: string): Promise<unknown>;
  refreshContext(liveSessionId: string): Promise<unknown>;
  compact(liveSessionId: string): Promise<unknown>;
  get(liveSessionId: string): LiveSession | null;
  getByChatId(chatId: string): LiveSession | null;
  list(): unknown[];
  rawRecords(): Iterable<LiveSession>;
  readHistory(options: {
    liveSessionId?: string;
    chatId?: string;
    opaqueSession?: unknown;
    project?: unknown;
  }): Promise<{
    mode: "linear" | "tree";
    leafId: string | null;
    tree: unknown[];
  }>;

  /**
   * Project the transcript the backend has actually recorded.
   *
   * The live event stream is a reconstruction; this is the record. Conduit
   * reads it to heal drift rather than trusting its own accumulated state.
   * `project` is passed for backends whose store is validated against it and
   * ignored by backends that own their own.
   */
  readTranscript(options: {
    liveSessionId?: string;
    chatId?: string;
    opaqueSession?: unknown;
    project?: unknown;
    turns?: number;
  }):
    Promise<{ messages: unknown[]; tools: unknown[] }>;
  getCapabilities(): ChatCapabilities;
  listModels(liveSessionId?: string): Promise<ModelCatalog> | ModelCatalog;
  listCommands(liveSessionId: string): Promise<Array<{ name: string; description?: string; source?: string }>>;
  listAvailableCommands(options: { cwd: string; template?: unknown }): Promise<Array<{ name: string; description?: string; source?: string }>>;
  getModelState(liveSessionId: string): Promise<{ model: string; thinkingLevel: string }>;
}

export const CHAT_CAPABILITY_KEYS: readonly Exclude<keyof ChatCapabilities, "history">[];
export const REQUIRED_CHAT_BACKEND_METHODS: readonly (keyof ChatBackendAdapter)[];
export function assertChatBackendAdapter<T extends ChatBackendAdapter>(
  adapter: T,
  label?: string,
  expectedCapabilities?: ChatCapabilities | null,
): T;

export type ChatLifecycleState =
  | "creating"
  | "restoring"
  | "idle"
  | "working"
  | "stopping"
  | "failed"
  | "closed";

export type ChatStatus = "working" | "stopping" | "idle" | "failed";
export type ChatActivity =
  | "idle"
  | "starting"
  | "working"
  | "waiting_for_user"
  | "retrying"
  | "compacting"
  | "stopping"
  | "failed";

interface EventBase {
  generationId: string | null;
}

/**
 * The two channels a turn is told on, and what each one promises.
 *
 * A turn is stated twice, on purpose. `transcript_op` says what the transcript
 * holds; `assistant_content` and `tool_activity` -- paint -- draw it arriving.
 * Both are in Conduit's words, translated once by the adapter, and they are not
 * two versions of the truth: one is the record and the other is the typewriter.
 *
 * Statements arrive at message granularity. `message.close` cannot be sent
 * until the answer is finished, because that is when it is known what the
 * answer says. Paint is the whole of why a reader watches a turn appear
 * instead of waiting for a paragraph to land at once.
 *
 * What makes the second channel safe to have is that it promises less, and
 * every part of the server is allowed to rely on it promising less:
 *
 * - It may be MERGED. Delivery holds deltas for a frame and concatenates them
 *   by block, so a harness writing at a thousand tokens a second costs one send
 *   per frame rather than one per token.
 * - It may be DROPPED. Past a socket's high-water mark paint is discarded
 *   rather than queued, because a reader who cannot draw what they already have
 *   is not helped by being sent more. What makes that safe is the promise
 *   below: the message is restated in full when it closes, so the worst a
 *   dropped delta costs is that the reader watches less of the answer arrive.
 *   A socket that comes back is also restated from the record's own copy of the
 *   turn -- the generation Pi reduces from the wire, replayed as
 *   `generation_replay`, or the merged paint buffer the other harnesses keep
 *   and replay on attach. Neither is promised mid-stream: a socket that falls
 *   behind and recovers without reconnecting catches up at the next
 *   `message.close`.
 * - It is never AUTHORITATIVE. `message.close` restates the message in full, so
 *   a delta that never arrives costs a repaint and nothing else. Nothing
 *   downstream may conclude anything from paint that an op does not also say.
 * - It is never NUMBERED IN THE CHAT'S ORDER. Paint is excluded from the log,
 *   so a merged frame does not look like a hole to a client counting
 *   statements, and a client asking to be caught up is never caught up on
 *   paint. It does carry `seq`, the turn-local position both folds order by --
 *   two different numbers, and only the log's one is a promise about delivery.
 *   A turn's `seq` says where an event sits among that turn's events; a gap in
 *   it is expected, because merging and dropping are what make the gaps.
 *
 * An op may do none of those things. It is delivered, in order, exactly once,
 * and losing one leaves the browser holding a transcript the server does not
 * believe in.
 *
 * Paint is `assistant_content` and `tool_activity`, and nothing else. A turn's
 * transitions -- `status` with a phase -- and a runtime `error` are not paint:
 * a missed `settled` is a hole a client has to be caught up on, not a repaint
 * it can do without, so they are numbered in the chat's order and replayed
 * beside the ops. There are two channels, not three: the record, which is the
 * ops plus those transitions, and paint.
 */

export type AssistantBlock =
  | { kind: "text"; contentIndex: number; text: string }
  | { kind: "thinking"; contentIndex: number; text: string; redacted: boolean }
  | { kind: "narration"; contentIndex: number; text: string }
  | { kind: "tool_call"; contentIndex: number; toolCallId: string; name: string; input: unknown };

/** Paint: the answer being written. Mergeable, droppable, never the record. */
export type AssistantContentEvent = EventBase & (
  | { type: "assistant_content"; phase: "start"; seq: number; messageId: string }
  | {
    type: "assistant_content";
    phase: "delta";
    seq: number;
    messageId: string;
    contentIndex: number;
    blockKind: AssistantBlock["kind"];
    delta: string;
  }
  | {
    type: "assistant_content";
    phase: "final";
    seq: number;
    messageId: string;
    blocks: AssistantBlock[];
    stopReason: string;
    errorMessage: string | null;
    /**
     * Who wrote it, when. The harness knows at this point and the reader is
     * shown it; without these on the close the browser could only learn them by
     * reloading the transcript, so a live answer and the same answer after a
     * refresh disagreed about which model produced it.
     */
    provider?: string | null;
    model?: string | null;
    timestamp?: string | null;
  }
);

/** Paint: a tool running, and its output as it arrives. Same promises. */
export type ToolActivityEvent = EventBase & {
  type: "tool_activity";
  phase: "start" | "update" | "end";
  seq: number;
  toolCallId: string;
  name: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
};

export interface PermissionRequestEvent extends EventBase {
  type: "permission_request";
  requestId: string;
  /** `question` is a harness's question tool; see `src/harnesses/questions.js`. */
  kind: "confirm" | "select" | "input" | "editor" | "question";
  title: string;
  message: string;
  options: string[];
  placeholder: string;
  prefill: string;
  timeoutMs: number | null;
  questions?: Array<{
    id: string; header: string; prompt: string; multiSelect: boolean; secret: boolean; required: boolean;
    options: Array<{ id: string; label: string; description: string; preview?: { format: "monospace" | "markdown"; text: string } }>;
    freeform: false | { placeholder?: string; multiline?: boolean; numeric?: boolean };
  }>;
  /** Whether a note on an answer reaches the model. */
  notes?: boolean;
}

export interface PermissionResolvedEvent extends EventBase {
  type: "permission_resolved";
  requestId: string;
}

/**
 * Where a generation has got to, stated.
 *
 * A status event carries two different things and they must not be confused. A
 * `phase` is a transition in the turn's life; without one the event is only
 * saying what the session is busy with -- an approval waiting, a mode changing
 * -- and no turn has started or finished.
 *
 * These used to be flattened into `status`/`activity` with the original name
 * passed along in `detail` as free text, and the browser rebuilt the five by
 * string-matching it, with a final `else` that called anything unrecognised a
 * started generation. So an approval request, which is not a transition at
 * all, arrived as the start of a turn.
 */
export type GenerationPhase = "started" | "running" | "stopping" | "stopped" | "settled";

export interface StatusEvent extends EventBase {
  type: "status";
  /** Absent when the event reports activity rather than a transition. */
  phase?: GenerationPhase;
  status: ChatStatus;
  activity: ChatActivity;
  detail: string | null;
  /**
   * On `started`: the answer this turn is continuing, when it is continuing
   * one. The transcript shows a continued answer as the one message it is, so
   * the browser needs the text being continued at the moment the turn opens.
   */
  continuation?: boolean;
  continuationBase?: string;
}

/** A runtime failure names one of a fixed set of causes. */
export type ChatError =
  | { code: "generation_limit" | "live_process_limit" | "rpc_timeout" | "auth_expired" | "backend_unavailable"; message: string }
  | { code: "rate_limited"; message: string; retryAfterMs: number };

/**
 * A rejected command names why Conduit refused it, and that set is open --
 * `invalid_request`, `chat_not_found`, whatever a command handler throws.
 * These are Conduit's own words about its own API, not a harness failing.
 */
export interface ChatRequestError { code: string; message: string }

/**
 * Something went wrong, and whose fault it was.
 *
 * `runtime` is the harness or the session failing: the turn is lost and the
 * transcript says so. `request` is Conduit rejecting a command the browser
 * sent -- a malformed frame, a steer with nothing running -- which leaves the
 * turn exactly as it was.
 *
 * The two used to travel as two event types, `runtime_error` and
 * `client_error`, and only Pi's adapter renamed either of them. The other
 * three passed `client_error` through under its own name, so the same rejected
 * command reached the browser as a different event depending on which harness
 * the chat happened to be on -- and Pi, which does rename it, had no code for
 * a bad request and coerced it to `backend_unavailable`, failing a turn that
 * was still running.
 */
export type ErrorEvent = EventBase & (
  | { type: "error"; scope: "runtime"; error: ChatError }
  | { type: "error"; scope: "request"; error: ChatRequestError }
);

/**
 * What the session has spent, as the three views the composer draws.
 *
 * This declared six flat token counts that no adapter has ever sent. The one
 * emitter states the three summaries instead, so the counts are declared where
 * they actually live -- inside `contextUsage` and `sessionStats` -- rather
 * than as a shape the contract invented and nothing satisfies.
 */
export interface UsageEvent extends EventBase {
  type: "usage";
  contextUsage: unknown | null;
  sessionStats: unknown | null;
  cacheStats: unknown | null;
}

/** The turn's record on disk is settled. Carries the chat row and its artifacts. */
export interface SessionCheckpointEvent extends EventBase {
  type: "session_checkpoint";
}

/**
 * Where the session stands, and everything a browser arriving late has missed.
 *
 * The first three are derived and always present. The rest are the catch-up:
 * the approvals the harness is waiting on, what is queued behind the current
 * turn, and the counters the composer draws. They were flowing undeclared --
 * three adapters passed them through and the fourth, being the only one that
 * rewrites the event, dropped them.
 */
export interface RuntimeStateEvent extends EventBase {
  type: "runtime_state";
  lifecycle: ChatLifecycleState;
  status: ChatStatus;
  activity: ChatActivity;
  capabilities: ChatCapabilities;
  session?: unknown;
  hostUiRequests?: unknown[];
  queue?: { steering: unknown[]; followUp: unknown[] };
  contextUsage?: unknown | null;
  sessionStats?: unknown | null;
  cacheStats?: unknown | null;
}

/**
 * What the transcript holds, stated by the adapter.
 *
 * This is the record: the other of the two channels described above
 * `AssistantBlock`, and the reason the browser never has to work out what a
 * turn meant from the paint it watched arrive. An op is delivered, in order,
 * exactly once, and it is numbered -- none of the four things paint is allowed
 * to do apply to one.
 *
 * Every field is stated rather than inferred, including the two the browser
 * used to guess: `answers`, the prompt a message answers, and `interim`,
 * whether it is the turn's answer or the turn talking as it works. A harness
 * that leaves them out is refused rather than guessed at.
 *
 * `after` is filled in by the chat's log, not by the adapter: where a message
 * sits is the log's answer, because it is the thing that knows what the
 * transcript's last word was.
 */
export type TranscriptOpEvent = EventBase & { type: "transcript_op" } & (
  | { op: "message.open"; message: { id: string; role: "user" | "assistant"; [field: string]: unknown };
      answers: string | null; after?: string | null }
  | { op: "message.close"; messageId: string; stopReason: string | null; interim: boolean;
      content: string; blocks: unknown[]; discarded?: true;
      /** Who wrote it, with what, when, and what went wrong, when the harness knows. */
      provider?: string; model?: string; timestamp?: string; errorMessage?: string }
  /** One row taken back (`keep`), the history cut after it, or cut through it. */
  | { op: "message.drop"; messageId: string; keep?: boolean; inclusive?: boolean }
  | { op: "tool.open"; toolCallId: string; name: string; input: unknown }
  /** A tool the user's stop killed is `cancelled`, never `isError`. */
  | { op: "tool.close"; toolCallId: string; output: unknown; isError: boolean; cancelled?: true }
  /**
   * How a turn ended, on the prompt it answers: stated by every harness when a
   * turn ends, before the event that ends it. The browser refuses a finished
   * turn that did not say, the same way it refuses a message without `answers`.
   */
  | { op: "turn.settle"; promptId: string; outcome: "complete" | "interrupted" | "failed" }
);

/**
 * Where this chat's order stands.
 *
 * The server numbers every event that changes what the transcript says, so a
 * hole in the numbers is a fact rather than something inferred from messages
 * that look duplicated. `log_state` tells a browser where the sequence is;
 * `log_reset` tells one holding a number from a previous log to take a
 * snapshot instead of being replayed into a sequence that no longer means the
 * same thing.
 */
export type ChatLogEvent = EventBase & (
  | { type: "log_state"; log: { id: string; seq: number } }
  | { type: "log_reset"; log: { id: string; seq: number } }
);

export type OptionalCapabilityEvent = EventBase & (
  | { type: "queue_state"; queue: { steering: unknown[]; followUp: unknown[] } }
  | { type: "compaction"; active: boolean }
  | { type: "retry"; active: boolean; retry?: unknown }
  /** The backend's own record of recent turns, published to repair live drift. */
  | { type: "transcript_sync"; messages: unknown[]; tools: unknown[]; replace?: true }
  | { type: "generation_replay"; seq: number; generation: unknown }
  /** Where the history now ends, so the browser cuts to it rather than deducing it. */
  | { type: "history_truncated"; beforeMessageId: string | null; afterMessageId: string | null }
  /**
   * The process is gone, and whether that was asked for. A deliberate exit
   * settles the session; anything else is a drop the browser reconnects from.
   */
  | { type: "runtime_exit"; deliberate: boolean }
);

export type ChatBackendEvent =
  | AssistantContentEvent
  | ToolActivityEvent
  | PermissionRequestEvent
  | PermissionResolvedEvent
  | StatusEvent
  | ErrorEvent
  | UsageEvent
  | SessionCheckpointEvent
  | RuntimeStateEvent
  | TranscriptOpEvent
  | ChatLogEvent
  | OptionalCapabilityEvent;
