import type { ApprovalLine } from "@/components/ui";
import type { Device } from "../platform/devices";
export type RuntimeKind = "conduit_profile" | "codex";
export type BooleanCapability = {
  [K in keyof ChatCapabilities]: ChatCapabilities[K] extends boolean ? K : never
}[keyof ChatCapabilities];

import type { UiPreferences } from "../preferences/ui-preferences";
import type { ChatCapabilities, ToolKind, TurnOutcome } from "../../chat-backend-contract.js";
export type { ChatCapabilities };

export interface HarnessCommand {
  name: string;
  description?: string;
  source?: string;
}
export interface PermissionMode {
  id: string;
  label: string;
  description: string;
  allowed: boolean;
}
export interface PermissionModeState {
  modes: PermissionMode[];
  selected: string;
}
export interface ServiceLevel {
  id: string;
  label: string;
}
export interface ServiceLevelState {
  levels: ServiceLevel[];
  selected: string;
}
export interface HarnessManifestView extends ChatCapabilities {
  serviceLevels?: ServiceLevel[];
}
/** subagent: a subagent's transcript, read-only and kept out of the lists (backend.parentChatId names its chat). */
export type ChatStatus = "draft" | "active" | "subagent";

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
  /** Stable user-facing harness identity. Session routing still uses backend.implementation. */
  harnessId?: string;
  templateId?: string;
  runtime?: RuntimeIdentity;
  profileId?: string | null;
  backend?: { protocol: string; implementation: string; installationId: string; serviceLevel?: string; parentChatId?: string; subagentId?: string };
  createdAt?: string;
  updatedAt?: string;
  lastUserMessageAt?: string | null;
  lastAssistantCompletedAt?: string | null;
  lastMessageAt?: string | null;
  /** Server-derived: lastAssistantCompletedAt > lastReadAt. */
  unread?: boolean;
  lastReadAt?: string | null;
  /** Server-side live snapshot for offline indicator fallback (SSE owns truth while online). */
  liveStatus?: string | null;
  liveActivity?: string | null;
  liveActive?: boolean;
  pinned?: boolean;
}

export interface WorkspaceAppearance {
  mode: "icon" | "monogram";
  value: string;
  color: string;
}

export interface PlaceCapabilities {
  device: { id: string; name: string; local: boolean; online: boolean };
  harnesses: string[];
  checkpoints: boolean;
  deleteFiles: boolean;
  git: boolean;
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
  /** A folder a paired device shares; its path is that device's. */
  nodeId?: string | null;
  place?: { root: string; path: string } | null;
  /** Whose place it is and what can be done there: asked instead of `nodeId`. */
  capabilities?: PlaceCapabilities | null;
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
  changes: Array<{ path: string; status: string; added: number | null; removed: number | null }>;
  /** Null when the folder could not be read (its device away), not empty. */
  recentFiles: Array<{ name: string; modifiedAt: string }> | null;
  recentChats: DashboardChat[];
}

export interface BackendSessionSummary {
  id: string;
  title: string;
  preview: string;
  cwd: string;
  createdAt: number | string | null;
  updatedAt: number | string | null;
  status: string;
  source: string;
  replayFidelity: "full" | "summary" | "from-now";
}

export interface HarnessSummary {
  id: "codex" | "chatgpt-web";
  label: string;
  profileLabel: string;
  available: boolean;
  sessions: boolean;
  drive: boolean;
  status?: "ready" | "authentication_required" | "unavailable";
  version?: string | null;
  /** How far the harness can see: "machine" lists every thread it knows about. */
  discovery?: "machine" | "none";
}

export interface HarnessThread extends BackendSessionSummary {
  branch?: string | null;
  originUrl?: string | null;
  tracked: boolean;
  chatId: string | null;
}

export interface HarnessThreadGroup {
  path: string;
  display: string;
  repository: { branch: string | null; originUrl: string | null } | null;
  updatedAt: number;
  missing?: boolean;
  threads: HarnessThread[];
}

export interface HarnessThreadDiscovery {
  scope: "machine" | "folder" | "none";
  groups: HarnessThreadGroup[];
  truncated: boolean;
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
  kind: string;
  toolCallId?: string;
  text?: string;
  name?: string;
  input?: unknown;
  /** Thinking the provider kept to itself: it happened, with no text to show. */
  redacted?: boolean;
}

export type { TurnOutcome };
/** Tokens are estimated from the characters streamed, four to a token. */
export interface TurnTiming {
  startedAt: string;
  firstOutputAt: string | null;
  firstAnswerAt: string | null;
  lastOutputAt: string | null;
  endedAt: string;
  ttftMs: number | null;
  ttfaMs: number | null;
  durationMs: number | null;
  thinkingChars: number;
  answerChars: number;
  tokens: number;
  tokensEstimated: boolean;
  tokensPerSecond: number | null;
  tools: Array<{ name: string; kind: string; startedAt: string; endedAt: string | null; ms: number | null; failed?: boolean; cancelled?: boolean }>;
}
export type { ToolKind };
/** The subagent a spawn or a report is about: its id (bg-3 in the background, fg-3 for a turn's own; sa-3 in older chats) and its conversation. */
export interface AgentRef { id: string | null; conversationId: number | string | null }
/** A subagent Conduit started (a routine's schedule, the heartbeat, a webhook, a check-back), not a turn of the thread. */
export interface RunInfo {
  routine: string;
  label: string;
  number: number;
  trigger?: string | null;
  /** Its report reached the thread's agent as a prompt; false: quiet, written for the record only. */
  woke: boolean;
  status: "running" | "finished" | "failed" | "stopped";
  startedAt?: string | null;
  endedAt?: string | null;
  conversationId?: number | string | null;
  summary?: string | null;
}
/** One of a chat's subagents (GET /v0/chats/:chatId/agents): chatId is its transcript, a chat of its own. */
export interface AgentSummary {
  id: string | null;
  conversationId: number;
  chatId: string | null;
  title: string;
  mode: "foreground" | "background";
  status: "running" | "finished" | "failed" | "stopped";
  startedAt: string | null;
  endedAt: string | null;
  activity: string | null;
  /** The codemode script call that spawned it, when a script did: its row is drawn under that call. */
  via?: string;
  /** Present when Conduit started it (a run), not a turn: the rider lists it under Runs. */
  run?: RunInfo;
  /** `context`: what its last request held, as a chat's context pane says; `tokens`: summed over its requests. */
  usage: { tokens: number; context?: number | null; cost: number };
}

export interface Message {
  id: string;
  /** Model context stored in a runtime entry; its text is fetched on demand. */
  context?: {
    kind: "prompt" | "update" | "compaction";
    entryId: number;
    /** The first prompt the conversation was given; `resent`: sent again because a compaction replaced what came before. */
    opening?: boolean;
    resent?: boolean;
    /** removed: a piece the request took away. */
    sections: { name: string; chars: number; removed?: boolean }[];
    tools?: { added: string[]; removed: string[]; changed?: string[]; restated?: number };
    summary?: { chars: number };
  };
  notes?: string;
  agent?: AgentRef;
  /** The live generation this message was frozen out of, until a sync names it. */
  generationId?: string | null;
  role: "user" | "assistant" | "system" | "tool";
  content?: string;
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
  /** Added by this client and not yet stated by the server. */
  local?: boolean;
  /** Sent while the hub could not be reached, and kept on this device until it can: Waiting to send. */
  outbox?: boolean;
  /** A line in the record the model was never given (a heartbeat's quiet line): drawn, and said to be unseen. */
  unseen?: boolean;
  /** An answer still arriving holds its place from the moment the harness names it; the live overlay draws over it. */
  streaming?: boolean;
  /** The prompt this answer answers, as the server stated it; turns are grouped by it, not by where a row sits. */
  answers?: string | null;
  outcome?: TurnOutcome;
  timing?: TurnTiming;
  interim?: boolean;
  /**
   * Text the reader saw that the harness is not carrying forward (`interruptKeepsPartial` false). It stays because the
   * reader saw it, and is marked because a follow-up about it would reach a model that never wrote it.
   */
  discarded?: boolean;
  queueMode?: "steer" | "follow_up";
  /** A prompt the harness made itself (a background task finishing), drawn as a notice, not as the user's bubble. */
  origin?: "harness";
  sender?: { name: string; routine?: string; status?: string };
  run?: RunInfo;
  /** What Conduit added to a prompt it delivered for the agent (the decision it asks for): shown apart, never hidden. */
  appended?: string;
  attachments?: Attachment[];
  order?: number;
}

/** `output` is what the tool has returned, and `done` whether that is all of it. */
export interface ToolCallStep {
  name: string;
  kind: ToolKind;
  subject?: string;
  /** Read from the script's code before it runs; `repeats` when it sits in a loop. */
  planned?: boolean;
  repeats?: boolean;
  /** A row standing for this many earlier calls, no longer listed. */
  earlier?: number;
  /** False while it runs; a call without it has ended. */
  done?: boolean;
  isError?: boolean;
  durationMs?: number;
  facts?: ToolFacts;
  /** A message call's arguments (title, text): it is drawn as its own row, as a direct call's is. */
  input?: unknown;
}

export interface ToolFacts {
  /** What it did, running and done ("Checking", "Checked"), and what kind of work it was, where its tool's own say less. */
  verb?: [string, string];
  kind?: ToolKind;
  subject?: string;
  aside?: string;
  added?: number;
  removed?: number;
  diff?: { sign: "+" | "-" | "…"; text: string }[];
}

export interface ToolItem {
  toolCallId: string;
  name?: string;
  kind?: ToolKind;
  subject?: string;
  /** Its line said better than the subject can, when the adapter knows. */
  facts?: ToolFacts;
  calls?: ToolCallStep[];
  agent?: AgentRef;
  input?: unknown;
  output?: unknown;
  outputSize?: number;
  isError?: boolean;
  cancelled?: boolean;
  done?: boolean;
  timestamp?: string;
  completedAt?: string;
  seq?: number;
  order?: number;
}

export interface TranscriptDetail extends ChatSummary {
  log?: { id: string; seq: number };
  model?: string;
  thinkingLevel?: string;
  messages: Message[];
  tools: ToolItem[];
  page?: { before?: string | null };
  /** A turn is still running: the last prompt's unsettled steps are not an ended turn. */
  turnOpen?: boolean;
}

export interface ModelOption {
  provider: string;
  id: string;
  spec: string;
  label: string;
  thinkingLevels: string[];
  /** The model's own names for its levels, where it has them (the Test models' paces); else the level's. */
  thinkingLabels?: Record<string, string>;
  defaultThinkingLevel?: string;
  outsideScope?: boolean;
}

export interface ModelState {
  installationId?: string;
  runtimeKind?: RuntimeKind;
  models: ModelOption[];
  model: string;
  thinkingLevel: string;
  modelThinkingLevels?: Record<string, string>;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  enabledModels?: string[];
  requiresAuthentication?: boolean;
  warnings?: string[];
  /** The model a profile remembered left its catalogue and another stands in, so the surface can say so. */
  modelFallback?: { from: string; to: string };
  source?: string;
}

export interface Template {
  id: string;
  label: string;
  description?: string;
  posture?: string;
  defaultable?: boolean;
  tools?: string[];
  runtime?: RuntimeIdentity;
  disabled?: boolean;
  /** The harness this profile elects. Capabilities are declared there, not here. */
  implementation?: string;
  drive?: boolean;
}

export type ProcessState = "absent" | "starting" | "ready" | "failed";
export type GenerationState = "idle" | "submitting" | "active" | "stopping" | "failed";

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
  model?: string | null;
  /** What fills the window, when the harness itemises it. Free space is a category of its own. */
  categories?: ContextCategory[] | null;
  /** Whether the categories can be asked for (an old Claude Code thread), or were. */
  breakdown?: "loadable" | "loaded";
  compactions?: number;
  compactAt?: number | null;
  plan?: { name?: string | null; windows: { id: string; label: string; usedPercent: number; resetsAt: string | null }[] } | null;
  lastRequestUsage?: RequestUsage | null;
}

/** Conduit's own set, the same for every harness. */
export type ContextCategoryId = "system-prompt" | "tools" | "instructions" | "messages" | "other" | "used" | "buffer" | "deferred-tools" | "free";

export interface ContextCategory {
  id: ContextCategoryId;
  label: string;
  tokens: number;
  /** used occupies the window; free is what is left; buffer is the compaction reserve; deferred sits outside it. */
  kind: "used" | "free" | "buffer" | "deferred";
  items?: { label: string; tokens: number }[];
}

export interface RuntimeActivity { kind: string; label: string; }

export interface QueueState { steering: unknown[]; followUp: unknown[]; }

export interface RetryState {
  attempt?: number;
  maxAttempts?: number;
  delayMs?: number;
  errorMessage?: string | null;
  /** A device the turn's next step runs on, offline; the turn goes on when it is back. */
  waitingFor?: string;
}

export interface HostUiRequest {
  id: string;
  kind: "confirm" | "select" | "input" | "editor" | "question";
  title?: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeoutMs?: number | null;
  questions?: Question[];
  notes?: boolean;
}

export interface Question {
  id: string;
  header: string;
  prompt: string;
  multiSelect: boolean;
  secret: boolean;
  required: boolean;
  options: QuestionOption[];
  freeform: false | { placeholder?: string; multiline?: boolean; numeric?: boolean; initial?: string };
  /** An approval: drawn as one (ApprovalSummary) in the prompt's place. */
  approval?: { title: string; service?: string | null; lines?: ApprovalLine[] };
}

export interface QuestionOption {
  id: string;
  label: string;
  description: string;
  preview?: { format: "monospace" | "markdown"; text: string };
}

export interface QuestionAnswer {
  questionId: string;
  optionIds: string[];
  freeform?: string;
  note?: string;
}

export interface RuntimeProcess {
  id?: string;
  chatId: string;
  projectId?: string;
  status?: string;
  ready?: boolean;
  waiting?: boolean;
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
  runtime?: RuntimeIdentity;
  capabilities?: ChatCapabilities;
  permissionMode?: string;
}

export interface LiveRecord {
  id: string;
  chatId?: string;
  sessionId?: string | null;
  streamUrl?: string;
  runtime?: RuntimeIdentity;
  contextUsage?: ContextUsage;
  sessionStats?: SessionStats | null;
  cacheStats?: CacheStats | null;
  binaryVersion?: string;
  trustPosture?: string;
  modelRecovery?: {
    from: string;
    to: string;
    reason: "outside_scope" | "unavailable";
  };
  capabilities?: ChatCapabilities;
}

export type VoiceExecution = "stop" | "eager" | "live";
export type VoiceSegmentation = "none" | "heuristic";

export interface VoiceLocalSelection {
  modelId: string;
  artifactId: string;
  execution: VoiceExecution;
  segmentation: VoiceSegmentation;
}

export interface VoiceExecutionProfile {
  id: string;
  modelId: string;
  artifactId: string;
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

export interface VoiceArtifactStatus {
  artifactId: string;
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
  models: { id: string; label: string; languages: string; description: string; artifactIds: string[] }[];
  artifacts: { id: string; modelId: string; legacyModelId: string; format: string; precision: string; approximateBytes: number; minimumFreeBytes: number; modelFile: string | null; runtimeVersion: string | null; license: { id: string; attribution: string } }[];
  profiles: VoiceExecutionProfile[];
  defaultProfileId: string;
}

export interface VoiceServerSettings {
  mode: "off" | "local" | "remote";
  localModelId: string;
  localSelection: VoiceLocalSelection;
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
    artifactStatuses?: VoiceArtifactStatus[];
    installingModelId: string | null;
    activeModelId: string | null;
    progress: { phase: string; current: string; completedBytes: number; totalBytes: number } | null;
    models: VoiceLocalModel[];
  } | null;
}

export interface ComputerDirectoryListing {
  entries: {
    name: string;
    path: string;
    type: "directory" | "file" | "other";
    size?: number | null;
    createdAt?: number | null;
    modifiedAt?: number | null;
  }[];
  cursor?: string | null;
  truncated: boolean;
  total?: number | null;
  oversize?: boolean;
}

export interface ComputerLocation {
  project: Project;
  home: string;
  parent: string;
  repository: boolean;
  repositoryRoot?: string | null;
  listing: ComputerDirectoryListing;
}

export interface ComputerPrefetchPayload {
  locations: ComputerLocation[];
}

export interface HarnessesPayload {
  harnesses: HarnessSummary[];
}

/** GET /v0/share-origin: the origin a shared link is made on. */
export interface ShareOriginPayload {
  origin: string;
}

/** A terminal the hub runs (GET /v0/ptys lists them; POST /v0/ptys starts one). */
export type Pty = {
  id: string;
  nodeId?: string | null;
  projectId: string;
  templateId?: string;
  title?: string;
  cwd?: string | null;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  exitCode?: number | null;
  signal?: string | null;
  currentCommand?: string | null;
  lastActivityAt?: string | null;
  paneDead?: boolean;
};

export interface PtysPayload {
  ptys: Pty[];
}

/** An environment that can offer the person's own browser, by its node id. */
export interface PersonBrowserEnvironment {
  id: string;
  name: string;
  online: boolean;
  available: boolean;
  browsers: Array<{ id: string; name: string; connected: boolean }>;
  /** A one-time code out for a browser's extension to redeem. */
  pairing: { code: string; expiresAt: string } | null;
  /** Browse's relay answers there; false when it could not be started (its port taken). */
  relay?: boolean;
  /** A browser there has the extension and can be started from here. */
  launchable?: boolean;
  extensionUrl: string;
  error?: string;
}

export interface PersonBrowsersPayload {
  environments: PersonBrowserEnvironment[];
}

export interface ProjectsPayload {
  projects: Project[];
}

export interface NodesPayload {
  devices: Device[];
}

export interface AgentsPayload {
  agents: AgentSummary[];
}

/** GET /v0/sessions/:id/context and POST /v0/sessions/:id/context/breakdown. */
export interface ContextUsagePayload {
  contextUsage?: ContextUsage;
  sessionStats?: SessionStats;
  cacheStats?: CacheStats | null;
}

/** GET /v0/downloads: this server's own client builds. */
export interface DownloadsPayload {
  windowsUrl: string | null;
  apkUrl: string | null;
  apkVersion: string | null;
}

/** GET adds where the shortcuts file is and what in it could not be read. */
export type PreferencesPayload = UiPreferences & {
  accountName: string;
  accountHome: string;
  defaultTemplateId: string;
  terminalShortcuts: unknown[];
  knownServers: Array<{ origin?: unknown; name?: unknown }>;
  keybindings?: { path: string; errors: string[] };
};

export interface PiAuthProvider {
  id: string;
  label: string;
  oauth: boolean;
  usesCallbackServer: boolean;
  /** What its key goes with (Cloudflare's account ID), asked for beside it. */
  fields?: Array<{ name: string; label: string }>;
  /** kind: a stored credential's, a sign-in or a key. */
  auth: { configured: boolean; source: "stored" | "environment" | "managed" | null; kind?: "oauth" | "key" | null; removable: boolean };
}

export interface PiAuthAttempt {
  id: string;
  providerId: string;
  providerLabel: string;
  state: string;
  message: string;
  authUrl: string | null;
  instructions: string | null;
  deviceCode: { userCode: string; verificationUri: string; expiresInSeconds: number | null } | null;
  prompt: { type: "text" | "manual_code" | "select"; message: string; placeholder?: string; options?: { id: string; label: string }[] } | null;
  error: string | null;
  active: boolean;
  owned: boolean;
}

export interface PiAuthProvidersPayload {
  providers: PiAuthProvider[];
}

export interface PiAuthAttemptPayload {
  attempt: PiAuthAttempt | null;
}
