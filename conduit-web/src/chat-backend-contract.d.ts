/** Backend-neutral contract for chat adapters. */

export type SessionSurface = "chat" | "terminal";
export type AgentProtocol = "pi_rpc" | "acp" | "native_api" | "pty";
export type AgentImplementation = "conduit_pi" | "native_pi" | "codex" | "opencode" | "chatgpt-web" | (string & {});
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
  /** Host Pi has no Conduit profile revision. */
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
  steer: boolean;
  followUpQueue: boolean;
  cancel: boolean;
  compaction: boolean;
  thinkingLevels: boolean;
  modelSwitch: boolean;
  toolUse: boolean;
  permissions: boolean;
  usage: boolean;
  replay: boolean;
}

export interface ChatBackendAdapter<LiveSession = unknown, ModelCatalog = unknown> {
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
  fork(liveSessionId: string, entryId: string): Promise<unknown>;
  setModel(liveSessionId: string, model: string): Promise<unknown>;
  setThinkingLevel(liveSessionId: string, level: string): Promise<unknown>;
  refreshContext(liveSessionId: string): Promise<unknown>;
  get(liveSessionId: string): LiveSession | null;
  getByChatId(chatId: string): LiveSession | null;
  list(): unknown[];

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
  getModelState(liveSessionId: string): Promise<{ model: string; thinkingLevel: string }>;
}

export const CHAT_CAPABILITY_KEYS: readonly (keyof ChatCapabilities)[];
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
  | { type: "assistant_content"; phase: "start"; sequence: number; messageId: string }
  | {
    type: "assistant_content";
    phase: "delta";
    sequence: number;
    messageId: string;
    contentIndex: number;
    blockKind: AssistantBlock["kind"];
    delta: string;
  }
  | {
    type: "assistant_content";
    phase: "final";
    sequence: number;
    messageId: string;
    blocks: AssistantBlock[];
    stopReason: string;
    errorMessage: string | null;
  }
);

export type ToolActivityEvent = EventBase & {
  type: "tool_activity";
  phase: "start" | "update" | "end";
  sequence: number;
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
  sequence: number | null;
}

export interface RuntimeStateEvent extends EventBase {
  type: "runtime_state";
  lifecycle: ChatLifecycleState;
  status: ChatStatus;
  activity: ChatActivity;
  capabilities: ChatCapabilities;
}

export type OptionalCapabilityEvent = EventBase & (
  | { type: "queue_state"; queue: { steering: unknown[]; followUp: unknown[] } }
  | { type: "compaction"; active: boolean }
  | { type: "retry"; active: boolean; retry?: unknown }
  | { type: "transcript_message"; message: unknown }
  /** The backend's own record of recent turns, published to repair live drift. */
  | { type: "transcript_sync"; messages: unknown[]; tools: unknown[] }
  | { type: "generation_replay"; sequence: number; generation: unknown }
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
  | OptionalCapabilityEvent;
