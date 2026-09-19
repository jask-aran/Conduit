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

export type AssistantBlock =
  | { kind: "text"; contentIndex: number; text: string }
  | { kind: "thinking"; contentIndex: number; text: string; redacted: boolean }
  | { kind: "tool_call"; contentIndex: number; toolCallId: string; name: string; input: unknown };

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
  }
);

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
  kind: "confirm" | "select" | "input" | "editor";
  title: string;
  message: string;
  options: string[];
  placeholder: string;
  prefill: string;
  timeoutMs: number | null;
}

export interface PermissionResolvedEvent extends EventBase {
  type: "permission_resolved";
  requestId: string;
}

export interface StatusEvent extends EventBase {
  type: "status";
  status: ChatStatus;
  activity: ChatActivity;
  detail: string | null;
}

export type ChatError =
  | { code: "generation_limit" | "live_process_limit" | "rpc_timeout" | "auth_expired" | "backend_unavailable"; message: string }
  | { code: "rate_limited"; message: string; retryAfterMs: number };

export interface ErrorEvent extends EventBase {
  type: "error";
  error: ChatError;
}

export interface UsageEvent extends EventBase {
  type: "usage";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

export interface SessionCheckpointEvent extends EventBase {
  type: "session_checkpoint";
  seq: number | null;
}

export interface RuntimeStateEvent extends EventBase {
  type: "runtime_state";
  lifecycle: ChatLifecycleState;
  status: ChatStatus;
  activity: ChatActivity;
  capabilities: ChatCapabilities;
}

/**
 * What the transcript holds, stated by the adapter.
 *
 * These are the settled record, and the reason the browser does not have to
 * work out what a turn meant from the paint it watched arrive. Paint --
 * `assistant_content`, `tool_activity` -- may be merged or dropped under
 * backpressure; an op may not. A `message.close` restates the message in full,
 * so a dropped delta costs a repaint and nothing else.
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
      content: string; blocks: unknown[]; discarded?: true }
  /** One row taken back (`keep`), the history cut after it, or cut through it. */
  | { op: "message.drop"; messageId: string; keep?: boolean; inclusive?: boolean }
  | { op: "tool.open"; toolCallId: string; name: string; input: unknown }
  | { op: "tool.close"; toolCallId: string; output: unknown; isError: boolean }
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
  | { type: "user_message_committed"; message: unknown }
  /** The backend's own record of recent turns, published to repair live drift. */
  | { type: "transcript_sync"; messages: unknown[]; tools: unknown[]; replace?: true }
  | { type: "generation_replay"; seq: number; generation: unknown }
  /** Where the history now ends, so the browser cuts to it rather than deducing it. */
  | { type: "history_truncated"; beforeMessageId: string | null; afterMessageId: string | null }
  | { type: "history_forked"; beforeMessageId?: string | null; afterMessageId?: string | null }
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
