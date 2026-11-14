export interface ChatCapabilities {
  history: "none" | "linear" | "tree";
  fork: boolean;
  regenerate: boolean;
  steer: boolean;
  followUpQueue: boolean;
  cancel: boolean;
  /**
   * An interrupted turn's partial assistant message survives as content the next turn can see. Where this is false,
   * interrupting discards what was written, and the UI has to say so rather than imply the model was redirected.
   */
  interruptKeepsPartial: boolean;
  compaction: boolean;
  thinkingLevels: boolean;
  modelSwitch: boolean;
  toolUse: boolean;
  /** respondHostUi is real. */
  approvals: boolean;
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

  /** The live event stream is a reconstruction; this is the record, read to heal drift. */
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

export type TurnStatus = "working" | "stopping" | "idle" | "failed";
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
 * A turn is stated twice: `transcript_op` (plus `status` transitions and runtime `error`) is the record; paint
 * (`assistant_content`, `tool_activity`) draws it arriving. Paint may be merged per frame and dropped past a socket's
 * high-water mark, is never authoritative (`message.close` restates the message in full), and is never numbered in the
 * chat's order: its turn-local `seq` has gaps by design. An op is delivered in order, exactly once.
 */

export type AssistantBlock =
  | { kind: "text"; contentIndex: number; text: string; phase?: "commentary" | "final_answer" }
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
    /** On the close so a live answer and the same answer after a reload agree about which model produced it. */
    provider?: string | null;
    model?: string | null;
    timestamp?: string | null;
  }
);

/** `message`: the agent sending the person something outside the thread. */
export type ToolKind = "command" | "read" | "edit" | "search" | "fetch" | "script" | "agent" | "message" | "other";

/** Paint: a tool running, and its output as it arrives. Same promises. */
export type ToolActivityEvent = EventBase & {
  type: "tool_activity";
  phase: "start" | "update" | "end";
  seq: number;
  toolCallId: string;
  name: string;
  /** On `start`: what it did, as `tool.open` states it; on `end`, only if it is known only then. */
  kind?: ToolKind;
  subject?: string;
  /** On `start` and `end`: when, stated once where it is published. */
  at?: string;
  input?: unknown;
  output?: unknown;
  isError?: boolean;
};

export interface PermissionRequestEvent extends EventBase {
  type: "permission_request";
  requestId: string;
  /** `question` is a harness's question tool. */
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
  notes?: boolean;
}

export interface PermissionResolvedEvent extends EventBase {
  type: "permission_resolved";
  requestId: string;
}

/**
 * A `phase` is a transition in the turn's life; without one a status event only says what the session is busy with,
 * and no turn has started or finished.
 */
export type GenerationPhase = "started" | "running" | "stopping" | "stopped" | "settled";

export interface StatusEvent extends EventBase {
  type: "status";
  phase?: GenerationPhase;
  status: TurnStatus;
  activity: ChatActivity;
  detail: string | null;
}

export type ChatError =
  | { code: "generation_limit" | "live_process_limit" | "rpc_timeout" | "auth_expired" | "backend_unavailable"; message: string }
  | { code: "rate_limited"; message: string; retryAfterMs: number };

/** Conduit's own words about its own API, not a harness failing; the set of codes is open. */
export interface ChatRequestError { code: string; message: string }

/** A `request` error is Conduit rejecting a command the browser sent, which leaves the turn exactly as it was. */
export type ErrorEvent = EventBase & (
  | { type: "error"; scope: "runtime"; error: ChatError }
  | { type: "error"; scope: "request"; error: ChatRequestError }
);

export interface UsageEvent extends EventBase {
  type: "usage";
  contextUsage: unknown | null;
  sessionStats: unknown | null;
  cacheStats: unknown | null;
}

export interface SessionCheckpointEvent extends EventBase {
  type: "session_checkpoint";
  chat?: { id: string; title?: string | null; [field: string]: unknown };
  chatId?: string;
  title?: string | null;
  artifacts?: unknown[];
}

export interface AgentsChangedEvent extends EventBase { type: "agents_changed" }

/** Said once, as a toast, never kept in the transcript. */
export interface ExtensionNoticeEvent extends EventBase {
  type: "extension_notice";
  message: string;
  level?: "info" | "warning" | "error";
}

export interface RuntimeStateEvent extends EventBase {
  type: "runtime_state";
  status: TurnStatus;
  activity: ChatActivity;
  capabilities: ChatCapabilities;
  session?: unknown;
  hostUiRequests?: unknown[];
  queue?: { steering: unknown[]; followUp: unknown[] };
  contextUsage?: unknown | null;
  sessionStats?: unknown | null;
  cacheStats?: unknown | null;
}

export type TurnOutcome = "complete" | "interrupted" | "failed";

/**
 * A comment on an artifact as the hub hands it to a chat (`hand`, server/documents.js), on the prompt's message as
 * `markup` and never in the text the model reads. `block`: the first block of a paper it is about; `said`: what the
 * person wrote back on an item already handed over ("reply"), or a comment they reopened. `context`: what it is on as
 * the hub has it now (a paper's commented blocks, `target`, and one block either side; a site's elements, with no `id`);
 * `rev`: a site's revision when it was handed (a paper's live copy has none).
 */
export interface MarkupHandoff {
  artifact: string; kind: "paper" | "markdown" | "sheet" | "site"; name: string; item: string;
  n?: number; block?: string; said?: "reply" | "reopened"; quote?: string; words?: string;
  context?: { id?: string; md: string; target?: true }[]; rev?: string;
}

/**
 * A harness that leaves out `answers` or `interim` is refused rather than guessed at. `after` is filled in by the
 * chat's log, not by the adapter: the log knows what the transcript's last word was.
 */
export type TranscriptOpEvent = EventBase & { type: "transcript_op" } & (
  | { op: "message.open"; message: { id: string; role: "user" | "assistant"; markup?: MarkupHandoff[]; [field: string]: unknown };
      answers: string | null; after?: string | null }
  | { op: "message.close"; messageId: string; stopReason: string | null; interim: boolean;
      content: string; blocks: unknown[]; discarded?: true;
      provider?: string; model?: string; timestamp?: string; errorMessage?: string }
  | { op: "message.drop"; messageId: string; keep?: boolean; inclusive?: boolean }
  | { op: "tool.open"; toolCallId: string; name: string;
      kind: ToolKind;
      subject?: string; input: unknown;
      messageId?: string;
      timestamp: string }
  /** A tool the user's stop killed is `cancelled`, never `isError`. */
  | { op: "tool.close"; toolCallId: string; output: unknown; isError: boolean; cancelled?: true;
      kind?: ToolKind; subject?: string;
      calls?: { name: string; kind: string; subject?: string; isError?: boolean; durationMs?: number }[];
      completedAt: string }
  | { op: "tool.calls"; toolCallId: string;
      calls: { name: string; kind: string; subject?: string; done?: boolean; isError?: boolean; durationMs?: number }[] }
  /** Stated by every harness before the event that ends the turn; the browser refuses a finished turn that did not say. */
  | { op: "turn.settle"; promptId: string; outcome: TurnOutcome }
  | { op: "turn.time"; promptId: string; timing: Record<string, unknown> }
);

/** `log_reset` tells a browser holding a number from a previous log to take a snapshot instead of being replayed. */
export type ChatLogEvent = EventBase & (
  | { type: "log_state"; log: { id: string; seq: number } }
  | { type: "log_reset"; log: { id: string; seq: number } | null }
);

export type OptionalCapabilityEvent = EventBase & (
  | { type: "queue_state"; queue: { steering: unknown[]; followUp: unknown[] } }
  | { type: "compaction"; active: boolean }
  | { type: "retry"; active: boolean; retry?: unknown }
  | { type: "transcript_sync"; messages: unknown[]; tools: unknown[]; replace?: true }
  | { type: "generation_replay"; seq: number; generation: unknown }
  | { type: "history_truncated"; beforeMessageId: string | null; afterMessageId: string | null }
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
  | AgentsChangedEvent
  | ExtensionNoticeEvent
  | OptionalCapabilityEvent;
