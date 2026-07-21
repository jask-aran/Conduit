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
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  origin?: "managed" | "linked" | "cloned";
  kind?: "project" | "workspace";
  path?: string;
  externalPath?: string;
  defaultTemplateId?: string | null;
  sessions: ChatSummary[];
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

export interface Message {
  id: string;
  key?: string;
  role: "user" | "assistant" | "system" | "tool";
  content?: string;
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
}

export interface ModelState {
  installationId?: string;
  runtimeKind?: RuntimeKind;
  models: ModelOption[];
  model: string;
  thinkingLevel: string;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  enabledModels?: string[];
  requiresAuthentication?: boolean;
  warnings?: string[];
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
}

export interface Installation {
  id: string;
  label: string;
  version?: string;
  available: boolean;
  reason?: string;
}

export type ProcessState = "absent" | "starting" | "ready" | "failed";
export type GenerationState = "idle" | "submitting" | "active" | "running" | "stopping" | "failed";

export interface ContextUsage {
  tokens?: number;
  used?: number;
  contextWindow?: number;
  limit?: number;
  percent?: number;
  lastRequestUsage?: Record<string, unknown>;
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
  status?: string;
  process?: ProcessState;
  generation?: GenerationState | Record<string, unknown>;
  activity?: string | RuntimeActivity;
  active?: boolean;
  stopping?: boolean;
  contextUsage?: ContextUsage;
  queue?: QueueState;
  hostUiRequests?: HostUiRequest[];
  compacting?: boolean;
  retry?: RetryState | null;
}

export interface LiveRecord {
  id: string;
  streamUrl?: string;
  runtime?: RuntimeIdentity;
  contextUsage?: ContextUsage;
  binaryVersion?: string;
  trustPosture?: string;
  sessionFile?: string;
}
