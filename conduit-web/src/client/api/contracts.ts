export type RuntimeKind = "conduit_profile" | "native_pi";
export type ChatStatus = "draft" | "active";

export interface RuntimeIdentity {
  kind: RuntimeKind;
  installationId?: string;
  binaryVersion?: string;
}

export interface ChatSummary {
  id: string;
  projectId: string;
  status: ChatStatus;
  title: string;
  templateId?: string;
  runtime?: RuntimeIdentity;
  createdAt?: string;
  updatedAt?: string;
  /** Server-side live snapshot for offline indicator fallback (SSE owns truth while online). */
  liveStatus?: string | null;
  liveActivity?: string | null;
  liveActive?: boolean;
  /** Client-only: draft created by an explicit New chat action. Lets the sidebar
      show it while selected, unlike the transient auto-created page-load draft. */
  pinned?: boolean;
}

export interface WorkspaceAppearance {
  mode: "icon" | "monogram";
  value: string;
  color: string;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  origin?: "managed" | "linked" | "created" | "cloned";
  kind?: "unstructured" | "project" | "workspace";
  path?: string;
  workingRoot: string;
  externalPath?: string;
  state?: "ready" | "cloning";
  cloneOperationId?: string | null;
  createdAt?: string;
  defaultTemplateId?: string | null;
  workspaceAppearance?: WorkspaceAppearance | null;
  deletesFilesOnRemove?: boolean;
  sessions: ChatSummary[];
}

export interface WorkspaceOperation {
  id: string;
  projectId: string;
  state: "cloning" | "cancelling" | "ready" | "cancelled" | "failed" | "complete";
  error?: string | null;
  diagnostic?: string;
}

export interface DashboardChat extends ChatSummary {
  lastMessageAt?: string | null;
  lastMessagePreview?: string;
}

export interface ProjectDashboardPayload {
  identity: Omit<Project, "sessions">;
  stats: {
    totalChats: number;
    activeChats: number;
    liveChats: number;
    liveTerminals: number;
    lastActivityAt?: string | null;
  };
  git: {
    branch: string;
    upstream?: string | null;
    ahead: number;
    behind: number;
    lastCommitAt?: string | null;
    hasUnstaged: boolean;
    changedFiles: number;
  } | null;
  recentChats: DashboardChat[];
}

export interface WorkspacePolicy {
  allowlist: string[];
  defaultRoot: string | null;
  defaultInputPath: string | null;
  suggestionRoot: string;
  modes: string[];
}

export interface WorkspaceSuggestion {
  name: string;
  path: string;
  displayPath?: string;
}

export interface WorkspaceSuggestionsPayload extends WorkspacePolicy {
  root: string;
  folders: WorkspaceSuggestion[];
}

export interface Attachment {
  id: string;
  name: string;
  type?: string;
  size?: number;
  path?: string;
  progress?: number;
  uploading?: boolean;
  error?: string;
}

export interface ContentBlock {
  type: string;
  id?: string;
  text?: string;
  thinking?: string;
  name?: string;
  arguments?: unknown;
}

export interface Message {
  id: string;
  key?: string;
  role: "user" | "assistant" | "system" | "tool";
  content?: string;
  /** Raw Pi content blocks (text / thinking / toolCall) — source of persisted reasoning. */
  blocks?: ContentBlock[];
  stopReason?: string;
  errorMessage?: string | null;
  provider?: string | null;
  model?: string | null;
  timestamp?: string;
  stopped?: boolean;
  status?: string | null;
  continuing?: boolean;
  pending?: boolean;
  queueMode?: "steer" | "follow_up";
  attachments?: Attachment[];
  order?: number;
}

export interface ToolItem {
  id: string;
  name?: string;
  args?: unknown;
  result?: unknown;
  partialResult?: unknown;
  resultDeferred?: boolean;
  resultSize?: number;
  error?: boolean;
  cancelled?: boolean;
  done?: boolean;
  timestamp?: string;
  completedAt?: string;
  seq?: number;
  order?: number;
}

export interface TranscriptDetail extends ChatSummary {
  model?: string;
  thinkingLevel?: string;
  messages: Message[];
  tools: ToolItem[];
  page?: { before?: string | null };
}

export interface ModelOption {
  provider: string;
  id: string;
  spec: string;
  label: string;
  thinkingLevels: string[];
  outsideScope?: boolean;
}

export interface ModelProfileView {
  id: string;
  label: string;
  searchRouting: {
    providers: string[];
    fallbackOn: string[];
  };
}

export interface ModelState {
  installationId?: string;
  runtimeKind?: RuntimeKind;
  models: ModelOption[];
  model: string;
  thinkingLevel: string;
  /** Conduit-owned per-chat preference; Pi itself keeps only one active level. */
  modelThinkingLevels?: Record<string, string>;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  enabledModels?: string[];
  requiresAuthentication?: boolean;
  warnings?: string[];
  modelProfile?: ModelProfileView | null;
  source?: string;
}

export interface Template {
  id: string;
  label: string;
  description?: string;
  posture?: string;
  defaultable?: boolean;
  tools?: string[];
  runtimeOverlays?: string[];
  runtime?: RuntimeIdentity;
  disabled?: boolean;
}

export interface Installation {
  id: string;
  label: string;
  version?: string;
  available: boolean;
  reason?: string;
}

export type ProcessState = "absent" | "starting" | "ready" | "failed";
export type GenerationState = "idle" | "submitting" | "active" | "running" | "stopping" | "interrupted" | "failed";

export interface UsageCost {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  total?: number | null;
}

export interface RequestUsage {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  cacheWrite1h?: number | null;
  reasoning?: number | null;
  totalTokens?: number | null;
  cost?: UsageCost | null;
}

export interface SessionTokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface SessionStats {
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: SessionTokenUsage;
  cost: number;
}

export interface CacheStats {
  eligibleTokens: number;
  cacheHits: number;
  cacheMissedTokens: number;
  eligibleRequests: number;
  eligibleHitRate: number | null;
}

export interface ContextUsage {
  tokens?: number | null;
  used?: number | null;
  contextWindow?: number | null;
  limit?: number | null;
  percent?: number | null;
  lastRequestUsage?: RequestUsage | null;
}

export interface RuntimeActivity { kind: string; label: string; }

export interface QueueState { steering: unknown[]; followUp: unknown[]; }

export interface RetryState {
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  errorMessage?: string | null;
}

export interface HostUiRequest {
  id: string;
  kind: "confirm" | "select" | "input" | "editor";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeoutMs?: number | null;
}

export interface RuntimeProcess {
  chatId: string;
  projectId?: string;
  status?: string;
  process?: ProcessState;
  generation?: GenerationState | Record<string, unknown>;
  activity?: string | RuntimeActivity;
  active?: boolean;
  stopping?: boolean;
  contextUsage?: ContextUsage;
  sessionStats?: SessionStats | null;
  cacheStats?: CacheStats | null;
  queue?: QueueState;
  hostUiRequests?: HostUiRequest[];
  compacting?: boolean;
  retry?: RetryState | null;
  modelProfile?: ModelProfileView | null;
}

export interface LiveRecord {
  id: string;
  chatId?: string;
  streamUrl?: string;
  runtime?: RuntimeIdentity;
  contextUsage?: ContextUsage;
  sessionStats?: SessionStats | null;
  cacheStats?: CacheStats | null;
  binaryVersion?: string;
  trustPosture?: string;
  sessionFile?: string;
  modelProfile?: ModelProfileView | null;
  modelRecovery?: {
    from: string;
    to: string;
    reason: "outside_scope";
  };
}

export type VoiceExecution = "stop" | "eager" | "live";
export type VoiceSegmentation = "none" | "silero" | "heuristic";

export interface VoiceLocalSelection {
  modelId: string;
  artifactId: string;
  runtimeId: string;
  execution: VoiceExecution;
  segmentation: VoiceSegmentation;
}

export interface VoiceExecutionProfile {
  schemaVersion: 1;
  id: string;
  modelId: string;
  artifactId: string;
  runtimeId: string;
  backendPathId: string;
  execution: VoiceExecution;
  segmentation: VoiceSegmentation;
  output: { tentative: boolean; stableSegments: boolean; sampleTimestamps: boolean };
  resourcePolicy: {
    preload: "supported" | "required" | "unsupported";
    serialInference: boolean;
    maximumSessionMs: number;
    maximumQueuedAudioMs: number | null;
  };
  fallback: { profileId: string; allowed: "before_output" | "after_tentative" | "after_stable_checkpoint"; replay: "from_zero" | "from_committed_sample" } | null;
}

export interface VoiceBackendPathStatus {
  backendPathId: string;
  installable: boolean;
  operational: boolean;
  blockedReason: string | null;
  artifactState: "absent" | "installing" | "installed" | "failed";
  runtimeState: "cold" | "loading" | "warm" | "busy" | "failed";
  requestedComputeBackend: string | null;
  actualComputeBackend: string | null;
  loadedRuntimeVersion: string | null;
  lastErrorCode: string | null;
}

export interface VoiceLocalModel {
  id: string;
  label: string;
  engine: string;
  size: string;
  languages: string;
  description: string;
  approximateBytes: number;
  precision: string;
  license: { id: string; attribution: string };
  installed: boolean;
  staged: boolean;
  running: boolean;
  state: "not_installed" | "installing" | "ready" | "running" | "error" | "interrupted";
  error: string | null;
}

export interface VoiceExecutionCatalogueView {
  version: string;
  schemaVersion: 1;
  models: { id: string; label: string; languages: string; description: string; artifactIds: string[] }[];
  artifacts: { id: string; modelId: string; legacyModelId: string; runtimeId: string; format: string; precision: string; approximateBytes: number; minimumFreeBytes: number; modelFile: string | null; runtimeVersion: string | null; license: { id: string; attribution: string } }[];
  runtimes: { id: string; adapterKind: string; version: string; compiledComputeBackends: string[] }[];
  backendPaths: { id: string; artifactId: string; runtimeId: string; ports: { batch: boolean; stream: boolean } }[];
  profiles: VoiceExecutionProfile[];
  defaultProfileId: string;
}

export interface VoiceServerSettings {
  voiceConfigVersion: 2;
  mode: "off" | "local" | "remote";
  localModelId: string;
  localSelection: VoiceLocalSelection;
  localSelectionOrigin: "default" | "explicit" | "migrated_explicit";
  resolvedProfileId: string;
  provider: string;
  adapter: string;
  model: string;
  endpoint: string;
  source: "stored";
  adapters: { id: string; label: string; transport: "http" | "ws"; description: string }[];
  providers: { id: string; label: string; adapter: string; endpoint: string; authLabel: string; configured?: boolean; models: { id: string; label: string; description: string; adapter?: string }[] }[];
  auth: { type: "none" | "bearer" | "header"; headerName: string; configured: boolean; source: "stored" | null; removable: boolean };
  local: {
    catalogue?: VoiceExecutionCatalogueView;
    backendPaths?: VoiceBackendPathStatus[];
    installingModelId: string | null;
    activeModelId: string | null;
    progress: { phase: string; current: string; completedBytes: number; totalBytes: number } | null;
    models: VoiceLocalModel[];
  } | null;
}
