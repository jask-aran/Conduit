import { batch, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js";
import { deriveFineActivity } from "../../activity.js";
import { api, asList, chatPath, isUnreachableError } from "../api/client";
import { createAgentSession } from "./agent-session";
import { createLatest } from "./latest";
import { isFoldedTurnEvent, isStructuredGenerationEvent, normalizeLiveEvent } from "../api/live-events";
import type { FoldedTurnEvent, LiveEvent, RuntimeStateEvent, StructuredGenerationEvent, TurnArtifactSummary } from "../api/live-events";
import type {
  AgentsPayload,
  AgentSummary,
  ChatStatus,
  Attachment,
  ChatSummary,
  CacheStats,
  ChatCapabilities,
  ContextUsage,
  ContextUsagePayload,
  GenerationState,
  HostUiRequest,
  HarnessCommand,
  LiveRecord,
  Message,
  Project,
  QueueState,
  RetryState,
  RuntimeIdentity,
  SessionStats,
  ToolItem,
  TranscriptDetail,
} from "../api/contracts";
import { applyToolOp, applyTranscriptOp, assignToolSeq, isToolOp, replaceMessages, truncateAt } from "../timeline-order";
import type { UploadAttachment } from "./attachments";
import type { DraftsStore } from "./drafts";
import { type ActiveGenerationView, type LiveGenerationChange } from "../turn-rows";
import type { PermissionSettings } from "./permission-settings";
import type { ServiceLevelSettings } from "./service-level-settings";
import type { RuntimeStore } from "./runtime";
import { createClientActiveGenerationStore } from "./active-generation-store.js";
import { markChatRead } from "./read-receipts";
import { clearReviewComments, parseReviewComments, projectReviewComments, restoreReviewComments, reviewComments } from "../chat/review-comments";
import { toast } from "@/components/ui/notifications";
import { addToOutbox, holdOutboxOpen, outboxOf, returnToOutbox, takeFromOutbox, type OutboxEntry } from "./outbox";
import { readDeviceTranscript, saveDeviceTranscript } from "./device-transcripts";
import { createSingleFlight } from "./single-flight";

type UnknownRecord = Record<string, unknown>;
type ErrorHandler = (error: unknown) => void;

type ChatPresentation =
  | { kind: "ready"; chatId: string | null }
  | { kind: "opening_live"; chatId: string }
  | { kind: "live_error"; chatId: string };

type RequestResult<T> =
  | { kind: "value"; value: T }
  | { kind: "error"; error: unknown };

const settleRequest = async <T,>(request: Promise<T>): Promise<RequestResult<T>> => {
  try { return { kind: "value", value: await request }; }
  catch (error) { return { kind: "error", error }; }
};

interface LiveOpening {
  chatId: string;
  selection: number;
  transcriptReady: boolean;
  socketReady: boolean;
  events: LiveEvent[];
  onShown?: () => void;
  resolve: () => void;
}

function generationChangeFor(event: StructuredGenerationEvent | FoldedTurnEvent): LiveGenerationChange {
  const source = event as unknown as UnknownRecord;
  const block = source.block && typeof source.block === "object" ? source.block as UnknownRecord : null;
  const contentIndex = Number.isInteger(source.contentIndex)
    ? Number(source.contentIndex)
    : Number.isInteger(block?.contentIndex) ? Number(block?.contentIndex) : undefined;
  const messageId = typeof source.messageId === "string" ? source.messageId : undefined;
  const toolCallId = typeof source.toolCallId === "string" ? source.toolCallId : undefined;
  const scope = event.type === "tool_activity" ? "tool"
    : event.type === "assistant_content" && source.phase === "delta" ? "block"
      : "structural";
  return {
    generationId: String(event.generationId || ""),
    eventType: event.type,
    scope,
    ...(messageId ? { messageId } : {}),
    ...(contentIndex !== undefined ? { contentIndex } : {}),
    ...(toolCallId ? { toolCallId } : {}),
  };
}

/**
 * Named so a surface with no Conduit chat behind it supplies a real one: an object literal cast through `as never`
 * satisfies the compiler, not the code.
 */
export interface ChatModels {
  model: () => string;
  effort: () => string;
  reloadChat: (chatId?: string) => Promise<void>;
  select: (projectId: string, chatId: string, selection?: { model?: string; thinkingLevel?: string },
    options?: { reloadChat?: boolean; profile?: string }) => Promise<void>;
}

export interface ChatAttachments {
  items: () => UploadAttachment[];
  pendingIds: () => string[];
  select: (chatId: string) => void | Promise<void>;
  markAnnounced: (ids: string[]) => void;
  restore: (attachments: Attachment[]) => void;
}

export interface ChatCatalogue {
  selectedId: () => string | null;
  projectId: () => string;
  select: (chat: ChatSummary, project: Project) => void;
  refresh: () => Promise<Project[]>;
  patchChat: (chatId: string, patch: Partial<ChatSummary>) => unknown;
}

interface ActiveChatOptions {
  catalogue: ChatCatalogue;
  runtime: RuntimeStore;
  models: ChatModels;
  permissions?: PermissionSettings;
  serviceLevels?: ServiceLevelSettings;
  attachments: ChatAttachments;
  drafts?: DraftsStore;
  onError: ErrorHandler;
  onModelRecovered: (details: { from: string; to: string; reason?: string }) => void;
  defaultTemplateId: () => string;
  saveWorkspaceDefault: (workspaceId: string, templateId: string | null) => Promise<unknown>;
}

type ChatCaches = {
  prefetches: Map<string, { revision: string; expiresAt: number; request: Promise<TranscriptDetail> }>;
  transcripts: Map<string, { revision: string; detail: TranscriptDetail }>;
  turnArtifacts: Map<string, { projectId: string; revision: string; expiresAt: number; request: Promise<TurnArtifactSummary[]> }>;
};
// Shared by every pane, so a chat one pane prefetched is not fetched again by another; one set per runtime, so
// separate apps (tests) share nothing.
const sharedChatCaches = new WeakMap<RuntimeStore, ChatCaches>();
function chatCaches(runtime: RuntimeStore): ChatCaches {
  let caches = sharedChatCaches.get(runtime);
  if (!caches) sharedChatCaches.set(runtime, caches = { prefetches: new Map(), transcripts: new Map(), turnArtifacts: new Map() });
  return caches;
}

export function createActiveChat(options: ActiveChatOptions) {
  const { catalogue, models, permissions, serviceLevels, attachments, onError } = options;
  const [status, setStatus] = createSignal<ChatStatus>("draft");
  const [title, setTitle] = createSignal("");
  const [templateId, setTemplateId] = createSignal<string | null>(null);
  const [runtimeIdentity, setRuntimeIdentity] = createSignal<RuntimeIdentity | null>(null);
  const [backendImplementation, setBackendImplementation] = createSignal<string | null>(null);
  const [live, setLive] = createSignal<LiveRecord | null>(null);
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [tools, setTools] = createSignal<ToolItem[]>([]);
  const [loadedId, setLoadedId] = createSignal<string | null>(null);
  const [presentation, setPresentation] = createSignal<ChatPresentation>({ kind: "ready", chatId: null });
  const [pageBefore, setPageBefore] = createSignal<string | null>(null);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [draft, setDraftSignal] = createSignal("");
  /**
   * Persisting through the setter rather than an effect keeps `reset()` from wiping the stored draft: it clears
   * `loadedId` before the draft, so the clear has no owner to write to.
   */
  const setDraft: typeof setDraftSignal = ((value: Parameters<typeof setDraftSignal>[0]) => {
    const next = setDraftSignal(value);
    const chatId = loadedId();
    if (!chatId) return next;
    const pending = attachments.pendingIds();
    // Emptying goes through `clear`, not a debounced save of nothing: a reload in that gap would restore a prompt
    // already sent.
    if (!next.trim() && !pending.length) options.drafts?.clear(chatId);
    else options.drafts?.save(chatId, next, pending);
    return next;
  }) as typeof setDraftSignal;
  const hydrateDraft = (chatId: string) => {
    const saved = options.drafts?.draftFor(chatId);
    if (saved?.text && !untrack(draft)) setDraftSignal(saved.text);
  };
  // The drafts load can answer after a chat opened, so it calls this when it lands. It refuses a composer that
  // already has something in it, so it cannot overwrite typing.
  const rehydrateDraft = () => {
    const chatId = loadedId();
    if (chatId) hydrateDraft(chatId);
  };
  const [generation, setGeneration] = createSignal<GenerationState>("idle");
  const [editingEntryId, setEditingEntryId] = createSignal<string | null>(null);
  const [contextUsage, setContextUsage] = createSignal<ContextUsage | null>(null);
  const [sessionStats, setSessionStats] = createSignal<SessionStats | null>(null);
  const [cacheStats, setCacheStats] = createSignal<CacheStats | null>(null);
  const [compacting, setCompacting] = createSignal(false);
  const [hostUiRequests, setHostUiRequests] = createSignal<HostUiRequest[]>([]);
  const [queue, setQueue] = createSignal<QueueState>({ steering: [], followUp: [] });
  const [capabilities, setCapabilities] = createSignal<ChatCapabilities | null>(null);
  const supports = (capability: keyof ChatCapabilities) => capabilities()?.[capability] !== false;
  const [harnessCommands, setHarnessCommands] = createSignal<HarnessCommand[]>([]);
  let commandsLoadedFor: string | null = null;
  let commandsLoading: Promise<void> | null = null;
  const [thinking, setThinking] = createSignal(false);
  const [responding, setResponding] = createSignal(false);
  const [activeTool, setActiveTool] = createSignal<{ name: string | null; kind: string | null } | null>(null);
  const [retry, setRetry] = createSignal<RetryState | null>(null);
  const [activeGenerationRoot, setActiveGenerationRoot] = createSignal<ActiveGenerationView | null>(null);
  const [activeGenerationRevision, setActiveGenerationRevision] = createSignal(0);
  const [activeGenerationChange, setActiveGenerationChange] = createSignal<LiveGenerationChange | null>(null);
  const [turnArtifacts, setTurnArtifacts] = createSignal<{ chatId: string; items: TurnArtifactSummary[] } | null>(null);
  const activeGeneration = () => {
    activeGenerationRevision();
    return activeGenerationRoot();
  };
  const setActiveGeneration = (next: ActiveGenerationView | null) => {
    setActiveGenerationRoot(next);
    setActiveGenerationRevision((revision) => revision + 1);
  };
  const generationStore = createClientActiveGenerationStore();
  const [navigatingId, setNavigatingId] = createSignal<string | null>(null);
  let navigationRequest: Promise<void> | null = null;

  let currentGeneration: string | null = null;
  let stopRequest: { generationId: string | null; sent?: boolean } | null = null;
  let selectionToken = 0;
  const navigationToken = createLatest();
  let liveOpening: LiveOpening | null = null;
  const caches = chatCaches(options.runtime);
  const transcriptPrefetches = caches.prefetches;
  const transcriptCache = caches.transcripts;

  // The runtime stream is the live-process authority. The catalogue carries a
  // point-in-time copy that can still say active after the process has settled.
  const chatIsLive = (chat: ChatSummary) => Boolean(options.runtime.getProcess(chat.id)?.active);
  // A subagent's chat has no process of its own (its parent's run drives it): open, it attaches read-only so its
  // turn shows live rather than as it was when opened.
  const attachOnOpen = (chat: ChatSummary) => chatIsLive(chat) || chat.status === "subagent";
  const transcriptRevision = (chat: ChatSummary) => chat.updatedAt || chat.createdAt || "";
  const rememberTranscript = (chat: ChatSummary, detail: TranscriptDetail) => {
    transcriptCache.delete(chat.id);
    transcriptCache.set(chat.id, { revision: transcriptRevision(chat), detail });
    while (transcriptCache.size > 10) transcriptCache.delete(transcriptCache.keys().next().value!);
    return detail;
  };
  const cachedTranscript = (chat: ChatSummary) => {
    if (chatIsLive(chat)) return null;
    const cached = transcriptCache.get(chat.id);
    if (!cached || cached.revision !== transcriptRevision(chat)) return null;
    transcriptCache.delete(chat.id);
    transcriptCache.set(chat.id, cached);
    return cached.detail;
  };
  const fetchTranscript = (chat: ChatSummary) => api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(chat.id)}`)
    .then((detail) => rememberTranscript(chat, detail));
  const loadTranscript = (chat: ChatSummary) => {
    const revision = transcriptRevision(chat);
    const cached = transcriptPrefetches.get(chat.id);
    if (!chatIsLive(chat) && cached && cached.revision === revision && cached.expiresAt > Date.now()) return cached.request;
    transcriptPrefetches.delete(chat.id);
    const request = fetchTranscript(chat);
    transcriptPrefetches.set(chat.id, { revision, expiresAt: Date.now() + 30_000, request });
    request.catch(() => {
      if (transcriptPrefetches.get(chat.id)?.request === request) transcriptPrefetches.delete(chat.id);
    });
    while (transcriptPrefetches.size > 10) transcriptPrefetches.delete(transcriptPrefetches.keys().next().value!);
    return request;
  };

  const fetchTurnArtifacts = (projectId: string, chatId: string) =>
    api<TurnArtifactSummary[]>(`/v0/projects/${encodeURIComponent(projectId)}/turn-artifact?${new URLSearchParams({ chatId, timeline: "1" })}`, { cache: "no-store" });
  // Asked for with the transcript rather than once it mounts, so the summaries do not arrive after it fades in and
  // move what it shows.
  const warmTurnArtifacts = (projectId: string, chat: ChatSummary) => {
    const revision = transcriptRevision(chat);
    const cached = caches.turnArtifacts.get(chat.id);
    if (cached && cached.projectId === projectId && cached.revision === revision && cached.expiresAt > Date.now()) return;
    const request = fetchTurnArtifacts(projectId, chat.id);
    caches.turnArtifacts.delete(chat.id);
    caches.turnArtifacts.set(chat.id, { projectId, revision, expiresAt: Date.now() + 30_000, request });
    request.catch(() => { if (caches.turnArtifacts.get(chat.id)?.request === request) caches.turnArtifacts.delete(chat.id); });
    while (caches.turnArtifacts.size > 10) caches.turnArtifacts.delete(caches.turnArtifacts.keys().next().value!);
  };
  const turnArtifactTimeline = (projectId: string, chatId: string) => {
    const cached = caches.turnArtifacts.get(chatId);
    caches.turnArtifacts.delete(chatId);
    return cached && cached.projectId === projectId && cached.expiresAt > Date.now() ? cached.request : fetchTurnArtifacts(projectId, chatId);
  };

  // A chat already read at its revision is not read again (a phone's drawer warms what it shows each time it opens).
  const prefetch = (chat: ChatSummary) => {
    if (chatIsLive(chat)) return;
    if (transcriptCache.get(chat.id)?.revision !== transcriptRevision(chat)) void loadTranscript(chat).catch(() => {});
    if (chat.projectId) warmTurnArtifacts(chat.projectId, chat);
  };
  const STOP_TERMINAL_PHASES = new Set(["stopping", "stopped", "settled"]);

  const selectedId = catalogue.selectedId;
  const finishLiveAttach = () => {
    const opening = liveOpening;
    if (!opening) return;
    opening.socketReady = true;
    finishLiveOpening(opening);
  };
  const session = createAgentSession({
    runtime: options.runtime,
    chatId: () => selectedId(),
    projectId: () => projectId(),
    model: () => models.model(),
    thinkingLevel: () => models.effort(),
    onRecord: (record) => {
      setLive(record);
      if (record.capabilities) setCapabilities(record.capabilities);
      if (record.runtime) setRuntimeIdentity(record.runtime);
      if (record.contextUsage) setContextUsage(record.contextUsage);
      if (record.sessionStats) setSessionStats(record.sessionStats);
      if (record.cacheStats) setCacheStats(record.cacheStats);
      if (record.modelRecovery) options.onModelRecovered(record.modelRecovery);
    },
    onDetail: (detail, chatId) => {
      applyDetail({ ...detail, id: chatId });
      setLoadedId(chatId);
      setStatus("active");
    },
    onEvent: (data, chatId) => {
      try {
        const event = normalizeLiveEvent(JSON.parse(data));
        // A runtime state is what a stream sends first when it attaches: a socket proven live, so the outbox may go.
        if (event.type === "runtime_state") queueMicrotask(() => void flushOutbox());
        if (!acceptInOrder(event)) return;
        const opening = liveOpening;
        if (opening?.chatId === chatId && opening.selection === selectionToken) {
          if (event.type === "runtime_state") opening.socketReady = true;
          if (!opening.transcriptReady) opening.events.push(event);
          else consume(event);
          finishLiveOpening(opening);
          return;
        }
        consume(event);
      }
      catch (error) { onError(error); }
    },
    onLost: () => { setLive(null); if (liveOpening?.transcriptReady) finishLiveAttach(); },
    onAbsent: (chatId) => {
      stopRequest = null;
      currentGeneration = null;
      generationStore.clear();
      setActiveGeneration(null);
      setActiveGenerationChange(null);
      resetLiveFlags();
      // No process asks or holds anything; a reconnect that finds one is given both again by its snapshot.
      setHostUiRequests([]);
      setQueue({ steering: [], followUp: [] });
      setGeneration("idle");
      void api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(chatId)}`).then((detail) => {
        if (selectedId() === chatId && !live() && generation() === "idle") applyDetail(detail, true);
      }).catch(onError);
    },
    onError: (error) => { finishLiveAttach(); onError(error); },
  });
  const ensureAgent = session.ensure;
  const requireAgent = session.require;
  // Whether the chat open now is still the one open when this was taken. Anything that awaits the agent checks it
  // after, since the person can switch chats while it starts, and the session then belongs to the other chat.
  const stillSelected = () => {
    const chatId = selectedId();
    const selection = selectionToken;
    return () => selectionToken === selection && selectedId() === chatId;
  };
  const projectId = catalogue.projectId;
  const streaming = createMemo(() => generation() === "active" || generation() === "submitting");
  const stopping = createMemo(() => generation() === "stopping");

  const resetLiveFlags = () => {
    setThinking(false);
    setResponding(false);
    setActiveTool(null);
    setRetry(null);
    setCompacting(false);
  };

  /**
   * The server numbers every event that changes the transcript, so a hole is a fact: seeing one, this asks to be
   * caught up from the last number seen and drops what arrived out of order, which the replay carries again.
   */
  let logId: string | null = null;
  let logSeq = 0;

  const requestLogResume = () => {
    if (!logId || !session.isOpen()) return;
    try { session.send({ type: "resume_log", logId, since: logSeq }); } catch { /* asked again on reconnect */ }
  };

  // An unnumbered event (a delta, runtime state, the queue) is always applied: the next numbered event restates
  // anything it loses.
  const acceptInOrder = (event: LiveEvent): boolean => {
    const stamp = (event as { log?: { id?: string; seq?: number } }).log;
    if (!stamp?.id || typeof stamp.seq !== "number") return true;
    if (stamp.id !== logId) { logId = stamp.id; logSeq = stamp.seq; return true; }
    // Already applied: the replay that answers a hole ends with events this client had seen.
    if (stamp.seq <= logSeq) return false;
    if (stamp.seq > logSeq + 1) { requestLogResume(); return false; }
    logSeq = stamp.seq;
    return true;
  };

  const reset = (draftProfileId?: string) => batch(() => {
    navigationToken.drop();
    enteredOffline = null;
    logId = null;
    logSeq = 0;
    selectionToken += 1;
    setLoadedId(null);
    setMessages([]);
    setTools([]);
    setPresentation({ kind: "ready", chatId: null });
    liveOpening?.resolve();
    liveOpening = null;
    setBackendImplementation(null);
    session.reset();
    setLive(null);
    setGeneration("idle");
    setDraft("");
    setEditingEntryId(null);
    setContextUsage(null);
    setSessionStats(null);
    setCacheStats(null);
    setLoadingOlder(false);
    setHostUiRequests([]);
    setQueue({ steering: [], followUp: [] });
    setCapabilities(null);
    setHarnessCommands([]);
    commandsLoadedFor = null;
    commandsLoading = null;
    resetLiveFlags();
    generationStore.clear();
    setActiveGenerationChange(null);
    setActiveGeneration(null);
    currentGeneration = null;
    stopRequest = null;
    if (draftProfileId) {
      setStatus("draft");
      setTitle("");
      setTemplateId(draftProfileId);
      setRuntimeIdentity(null);
    }
  });

  const applyGenerationEvent = (event: StructuredGenerationEvent | FoldedTurnEvent) => {
    // The turn being stopped draws nothing more but its end. A stop that does not yet know its turn holds nothing
    // back, so that turn's start can arrive and name it.
    if (stopRequest?.generationId && event.generationId === stopRequest.generationId
      && !(event.type === "status" && STOP_TERMINAL_PHASES.has(String(event.phase)))) return;
    if (!live() || live()!.chatId !== selectedId()) return;
    const previous = activeGeneration();
    // The Solid store mutates in place. Capture the status before apply;
    // reading previous.status afterwards reads the new terminal status too.
    const previousStatus = previous?.status;
    let result: ReturnType<typeof generationStore.apply> | undefined;
    batch(() => {
      result = generationStore.apply(event);
      if (result.changed && result.state) {
        const state = result.state as ActiveGenerationView;
        setActiveGeneration(state);
        setActiveGenerationChange(generationChangeFor(event));
      }
    });
    if (!result) return;
    const next = result.state as ActiveGenerationView | null;
    if (!next || !result.accepted) return;
    const terminal = ["stopped", "complete", "failed"].includes(next.status);
    const wasTerminal = previousStatus ? ["stopped", "complete", "failed"].includes(previousStatus) : false;
    if (terminal && !wasTerminal) {
      // Nothing is folded into the transcript here: the server has already stated every message and tool of this
      // turn, and a second answer assembled from the deltas races the harness's own writes.
      batch(() => {
        generationStore.clear();
        setActiveGenerationChange(null);
        setActiveGeneration(null);
      });
    }
    currentGeneration = terminal ? null : next.id;
    if (terminal) {
      stopRequest = null;
      resetLiveFlags();
    } else {
      const blocks = next.assistantMessages.flatMap((message) => message.blocks);
      const latest = blocks.at(-1);
      setThinking(latest?.kind === "thinking" && latest.status === "streaming");
      setResponding(latest?.kind === "text" && latest.status === "streaming");
      const runningTool = Object.values(next.toolExecutions).find((tool) => tool.status === "running");
      setActiveTool(runningTool ? { name: runningTool.name || null, kind: runningTool.kind || null } : null);
      setRetry((next as { retry?: RetryState | null }).retry || null);
    }
    // Stop can precede the turn's identity. Install the turn before cancelling it.
    if (stopRequest && !stopRequest.generationId && event.type === "status" && event.phase === "started") {
      stopRequest.generationId = next.id;
      session.sendWhenReady({ type: "stop_generation", generationId: next.id });
    }
    if (stopRequest || next.status === "stopping") setGeneration("stopping");
    else if (next.status === "failed") setGeneration("failed")
    else if (next.status === "stopped") {
      setGeneration("idle");
      // A stopped turn asks nothing more; not every harness withdraws what it asked.
      setHostUiRequests([]);
      if (event.type === "status" && event.phase === "stopped" && Boolean(event.processTerminated)) {
        setLive(null);
        session.detach();
      }
    } else if (next.status === "complete") {
      setGeneration("idle");
    } else {
      setGeneration("active");
    }
  };

  // Outbox messages are this device's, so a transcript load (which replaces what is held) puts them back at the end
  // until they go.
  const [outboxRevision, setOutboxRevision] = createSignal(0);
  const outboxChanged = () => setOutboxRevision((revision) => revision + 1);
  const outboxMessage = (entry: OutboxEntry): Message =>
    ({ id: entry.messageId, role: "user", content: entry.message, timestamp: entry.timestamp, local: true, outbox: true });
  const withOutbox = (chatId: string, list: Message[]) => {
    const waiting = outboxOf(chatId).filter((entry) => !list.some((message) => message.id === entry.messageId));
    return waiting.length ? [...list, ...waiting.map(outboxMessage)] : list;
  };
  const hubUnreachable = () => ["reconnecting", "offline"].includes(options.runtime.connectivity());
  let enteredOffline: { chat: ChatSummary; project: Project } | null = null;

  const applyDetail = (detail: TranscriptDetail, reconcile = false) => {
    const incoming = asList<Message>(detail.messages);
    const nextTools = assignToolSeq(asList<ToolItem>(detail.tools)) as ToolItem[];
    batch(() => {
      setLoadedId(detail.id);
      setMessages((current) => withOutbox(detail.id, reconcile ? replaceMessages(current, incoming) : incoming));
      setTools(nextTools);
      setPageBefore(detail.page?.before || null);
      setStatus(detail.status || "draft");
      setTitle(detail.title ?? "");
      if (detail.profileId || detail.templateId) setTemplateId(detail.profileId || detail.templateId || null);
      if (detail.runtime) setRuntimeIdentity(detail.runtime);
      setBackendImplementation(detail.backend?.implementation || null);
      // The load holds the log up to here, so this is where the order stands.
      if (detail.log?.id && (detail.log.id !== logId || detail.log.seq > logSeq)) { logId = detail.log.id; logSeq = detail.log.seq; }
      // Until the socket attaches and says how the turn is going, this keeps a running turn's finished steps from
      // reading as a turn that ended without saying how.
      if (detail.turnOpen && generation() === "idle") setGeneration("active");
    });
  };

  const loadDetail = async (chatId: string, reconcile = false, selection = selectionToken) => {
    const detail = await api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(chatId)}`);
    if (selection === selectionToken && selectedId() === chatId) {
      applyDetail(detail, reconcile);
      if (!contextUsage()) void contextFromHistory(chatId);
    }
    return detail;
  };

  const contextFromHistory = async (chatId: string) => {
    const usage = await api<ContextUsagePayload>(
      `/v0/sessions/${encodeURIComponent(chatId)}/context`).catch(() => null);
    if (!usage?.contextUsage || selectedId() !== chatId) return;
    setContextUsage(usage.contextUsage);
    if (usage.sessionStats) setSessionStats(usage.sessionStats);
    if (usage.cacheStats) setCacheStats(usage.cacheStats);
  };

  /** An old thread's full breakdown, from a harness that has to be running to give it. */
  const loadBreakdown = async () => {
    const chatId = selectedId();
    if (!chatId) return;
    const usage = await api<ContextUsagePayload>(
      `/v0/sessions/${encodeURIComponent(chatId)}/context/breakdown`, { method: "POST", timeout: false });
    if (selectedId() !== chatId || !usage?.contextUsage) return;
    setContextUsage(usage.contextUsage);
    if (usage.sessionStats) setSessionStats(usage.sessionStats);
    if (usage.cacheStats) setCacheStats(usage.cacheStats);
  };

  const refreshContext = () => {
    const chatId = selectedId();
    if (!chatId) return;
    if (session.isOpen()) { try { session.send({ type: "refresh_context" }); } catch { /* the next turn reports it */ } return; }
    void contextFromHistory(chatId);
  };

  const applySnapshot = (event: RuntimeStateEvent) => {
    const { session } = event;
    if (event.contextUsage || session.contextUsage) setContextUsage(event.contextUsage || session.contextUsage);
    if (event.sessionStats || session.sessionStats) setSessionStats(event.sessionStats || session.sessionStats);
    if (event.cacheStats || session.cacheStats) setCacheStats(event.cacheStats || session.cacheStats);
    if (event.queue || session.queue) setQueue(event.queue || session.queue!);
    if (event.hostUiRequests || session.hostUiRequests) setHostUiRequests(event.hostUiRequests || session.hostUiRequests!);
    if (session.compacting != null) setCompacting(session.compacting);
    if (session.retry !== undefined) setRetry(session.retry);
    if (session.capabilities) setCapabilities(session.capabilities);
    const turnOpen = Boolean(session.generation && !session.generation.settled);
    if (!session.stopping && (turnOpen || session.active)) sendOwedStop(turnOpen ? session.generation!.id : null);
    if (session.stopping || (stopRequest && (turnOpen || session.active))) setGeneration("stopping");
    else if (turnOpen || session.active) setGeneration("active");
    else {
      // A stop owed to a prompt whose turn has not started yet still stands.
      if (stopRequest?.generationId || stopRequest?.sent) stopRequest = null;
      currentGeneration = null;
      setGeneration("idle");
    }
  };

  function applyLiveEvent(event: LiveEvent) {
    if (isStructuredGenerationEvent(event)) {
      applyGenerationEvent(event);
      return;
    }
    // A retry and a failure are part of the turn as well as the chat: folded into the generation as the server
    // folds them, then handled below for the rest.
    if (isFoldedTurnEvent(event)) applyGenerationEvent(event);
    switch (event.type) {
      case "runtime_state":
        applySnapshot(event);
        break;
      case "usage":
        if (event.contextUsage) setContextUsage(event.contextUsage);
        if (event.sessionStats) setSessionStats(event.sessionStats);
        if (event.cacheStats) setCacheStats(event.cacheStats);
        break;
      case "compaction":
        setCompacting(event.active);
        break;
      case "retry":
        setRetry(event.retry);
        if (event.active) setGeneration((current) => current === "stopping" ? current : "active");
        break;
      case "queue_state":
        setQueue(event.queue);
        break;
      case "permission_request":
        if (event.request) setHostUiRequests((current) => current.some((item) => item.id === event.request!.id) ? current : [...current, event.request!]);
        break;
      case "permission_resolved":
        setHostUiRequests((current) => current.filter((item) => item.id !== event.requestId));
        break;
      case "extension_notice":
        toast[event.level](event.message);
        break;
      case "agents_changed":
        void refreshAgents();
        break;
      case "session_checkpoint":
        // The socket is the one channel the open chat is guaranteed to have, so its row feeds the catalogue as the
        // global stream's does; duplicates are free.
        if (event.chat) window.dispatchEvent(new CustomEvent("conduit:chat-changed", { detail: event.chat }));
        if (event.title && event.chatId === selectedId()) setTitle(event.title);
        if (event.chatId === selectedId()) {
          if (event.artifacts) setTurnArtifacts({ chatId: event.chatId, items: event.artifacts });
        }
        break;
      // Only a replacing sync is applied: a window of the transcript says nothing this client was not already told.
      case "transcript_sync":
        if (!event.replace) break;
        {
          // The snapshot is the latest turns: what this client holds before the first of them stands, unless that
          // message is gone too, when the history itself changed.
          const incoming = asList<Message>(event.messages);
          const current = messages();
          const from = incoming.length ? current.findIndex((message) => message.id === incoming[0]!.id) : -1;
          const before = from > 0 ? current.slice(0, from) : [];
          const incomingTools = event.tools as ToolItem[];
          const keptTools = before.length ? tools().filter((tool) => !incomingTools.some((item) => item.toolCallId === tool.toolCallId)) : [];
          batch(() => {
            setMessages(replaceMessages(current.slice(before.length), incoming, before));
            setTools(assignToolSeq([...keptTools, ...incomingTools]));
          });
        }
        break;
      // The server places every row; nothing here works out a position.
      case "transcript_op":
        if (isToolOp(event)) setTools((current) => applyToolOp(current, event));
        else setMessages((current) => applyTranscriptOp(current, event));
        break;
      // A client already here says how far it got; one arriving fresh has just loaded the transcript and takes the
      // number as its own.
      case "log_state":
        if (!event.log?.id) break;
        if (!logId) { logId = event.log.id; logSeq = event.log.seq; break; }
        if (logId !== event.log.id || logSeq < event.log.seq) requestLogResume();
        break;
      // The log cannot reach back to where this client is. Its place is given
      // up here, and the replacing sync that follows sets it again.
      case "log_reset":
        logId = null;
        logSeq = 0;
        break;
      case "history_truncated":
        // A regenerate cuts after the prompt it re-asks, which stays.
        if (event.beforeMessageId) setMessages((current) => truncateAt(current, event.beforeMessageId!, { inclusive: true }));
        else if (event.afterMessageId) setMessages((current) => truncateAt(current, event.afterMessageId!, { inclusive: false }));
        break;
      case "error":
        // A rejected command is not a failed turn; the scope says which this is.
        if (event.scope === "runtime") {
          stopRequest = null;
          setGeneration("failed");
          resetLiveFlags();
          // A failed turn asks nothing more, as a stopped one does. Its queue is the process's, which goes on.
          setHostUiRequests([]);
        } else if (generation() === "submitting" || (stopRequest && !stopRequest.generationId)) {
          // The request failed before a turn began. An error from a steer or
          // another command during an active turn must leave that turn alone.
          stopRequest = null;
          setGeneration("idle");
          resetLiveFlags();
        }
        const errorCode = event.error?.code;
        if (errorCode === "generation_limit") {
          setMessages((current) => {
            const last = current.at(-1);
            if (last?.role === "user" && last.local) { setDraft((value) => value || last.content || ""); return current.slice(0, -1); }
            return current;
          });
        }
        const message = event.error?.message || (errorCode === "generation_limit" ? "Too many concurrent generations. Wait for another chat to finish." : "Runtime error");
        onError(Object.assign(new Error(message), {
          code: errorCode,
          runtimeEvent: { type: event.type, code: errorCode, generationId: event.generationId },
        }));
        break;
      case "unknown":
        break;
    }
  }

  function consume(event: LiveEvent) {
    // The server already coalesces paint and never merges across blocks, so arrival order is the client's whole job.
    applyLiveEvent(event);
  }

  const finishLiveOpening = (opening: LiveOpening) => {
    if (liveOpening !== opening || opening.selection !== selectionToken
      || !opening.transcriptReady || !opening.socketReady) return;
    batch(() => {
      setPresentation({ kind: "ready", chatId: opening.chatId });
      opening.onShown?.();
    });
    liveOpening = null;
    opening.resolve();
  };

  /**
   * Every store that holds one chat's answers, told together on every way into a chat: one left out goes on
   * answering for whichever chat it last heard about.
   */
  const chatScopes: Array<(scope: { chat: ChatSummary; project: Project; detail?: TranscriptDetail; launching?: boolean }) => void | Promise<void>> = [
    // A launching chat reloads its models once the process serves: asking now races the launch and times out
    // against a process registered but not yet serving. The selection still applies at once from the detail.
    ({ chat, project, detail, launching }) => models.select(project.id, chat.id, detail, {
      reloadChat: !launching,
      profile: detail?.profileId || detail?.templateId || chat.profileId || chat.templateId || "",
    }),
    ({ chat }) => permissions?.select(chat.id),
    ({ chat }) => serviceLevels?.select(chat.id),
    ({ chat }) => { void attachments.select(chat.id); },
    ({ chat }) => hydrateDraft(chat.id),
  ];

  createEffect(() => {
    const chatId = selectedId();
    if (chatId) permissions?.follow(chatId, options.runtime.getProcess(chatId)?.permissionMode);
  });

  const [agents, setAgents] = createSignal<AgentSummary[]>([]);
  let agentsAsked: string | null = null;
  const readAgents = createSingleFlight(async () => {
    const chatId = loadedId();
    if (!chatId) return;
    agentsAsked = chatId;
    await api<AgentsPayload>(`/v0/chats/${encodeURIComponent(chatId)}/agents`)
      .then((body) => { if (loadedId() === chatId) setAgents(body.agents || []); })
      .catch(() => {});
  });
  const refreshAgents = (): Promise<void> => loadedId() ? readAgents() : Promise.resolve();
  createEffect(on(loadedId, () => { agentsAsked = null; setAgents([]); }));
  createEffect(() => {
    const chatId = loadedId();
    if (!chatId || chatId === agentsAsked) return;
    if (tools().some((tool) => tool.agent) || messages().some((message) => message.agent)) untrack(() => void refreshAgents());
  });
  // A missed agents_changed (a dropped live stream, a sleeping tab) must not leave one running forever: while any shows
  // running, read again now and then.
  createEffect(() => {
    if (!agents().some((agent) => agent.status === "running")) return;
    const timer = setInterval(() => void refreshAgents(), 10_000);
    onCleanup(() => clearInterval(timer));
  });
  const stopAgent = async (id: string) => {
    const chatId = loadedId();
    if (!chatId) return;
    // One that ended while this showed it running: the read below shows how it ended.
    try { await api(`/v0/chats/${encodeURIComponent(chatId)}/agents/${encodeURIComponent(id)}/stop`, { method: "POST" }); }
    catch (error) { if ((error as { error?: string })?.error !== "agent_not_running") onError(error); }
    await refreshAgents();
  };

  // A turn running on the open chat that this page has not joined (opened before the runtime said what runs, or
  // begun on another client) is joined, so it shows here as it does where it began.
  createEffect(() => {
    const chatId = selectedId();
    // Not while the hub cannot be reached: the process list is the last one heard, and joining is asked again when it is back.
    if (!chatId || !options.runtime.getProcess(chatId)?.active || hubUnreachable()) return;
    untrack(() => {
      const project = projectId();
      if (!project || session.isOpen() || liveOpening) return;
      void ensureAgent({ chatId, projectId: project, intent: "open" }).catch(onError);
    });
  });

  const reconcileChatScope = (chat: ChatSummary, project: Project, detail?: TranscriptDetail, launching = false) =>
    Promise.all(chatScopes.map((scope) => scope({ chat, project, detail, launching }))).then(() => {});

  // An existing live process attaches before the scoped fetches; this must not start an agent. It takes its model
  // from the transcript detail, since the model store has not been told about this chat yet.
  const warmAgent = (chat: ChatSummary, project: Project, detail: TranscriptDetail | undefined, selection: number) => {
    const draft = chat.status === "draft";
    void ensureAgent({
      chatId: chat.id,
      projectId: project.id,
      intent: "open",
      modelOverride: detail?.model,
      thinkingOverride: detail?.thinkingLevel,
    })
      .then(async () => {
        if (selection !== selectionToken || selectedId() !== chat.id) return;
        // Read from the harness, so asked for once the agent can answer
        // rather than in front of it.
        await models.reloadChat(chat.id);
        if (draft) return;
        const projects = await catalogue.refresh();
        if (selection !== selectionToken || selectedId() !== chat.id) return;
        const refreshed = projects.flatMap((item) => item.sessions).find((session) => session.id === chat.id);
        if (refreshed) setTitle(refreshed.title);
      })
      .catch(onError);
  };

  const enterChat = async (chat: ChatSummary, project: Project, entry: {
    detail?: TranscriptDetail;
    history?: "push" | "replace" | "none";
    warm?: boolean;
    offline?: boolean;
    preview?: boolean;
    onCommit?: () => void;
    onShown?: () => void;
  }) => {
    const detail = entry.detail;
    // Drop any previous chat's stream first: sending reuses an open socket without re-checking ownership, so a stale
    // one would carry this chat's prompts into the previous chat's agent.
    // One batch from the old chat to this one: torn down a setter at a time, each re-renders (~30ms of a tap).
    const scopeReload = batch(() => {
    reset();
    const selection = selectionToken;
    batch(() => {
      catalogue.select(chat, project);
      if (entry.history === "push") history.pushState({}, "", chatPath(chat.id));
      else if (entry.history === "replace") history.replaceState({}, "", chatPath(chat.id));
      entry.onCommit?.();
    });
    // Opening is reading, however it was reached (a click, a pasted URL, the back button).
    if (!entry.preview) { markChatRead(catalogue, chat); previewed = null; }
    if (entry.warm) warmAgent(chat, project, detail, selection);
    const scopeReload = reconcileChatScope(chat, project, detail, entry.warm || entry.offline);
    if (detail) applyDetail(detail);
    else {
      setMessages(withOutbox(chat.id, []));
      setTools([]);
      setPageBefore(null);
      setLoadedId(chat.id);
      setStatus(chat.status);
      setTitle(chat.title);
      setTemplateId(chat.profileId || chat.templateId || options.defaultTemplateId() || "assistant");
      setRuntimeIdentity(chat.runtime || null);
      setBackendImplementation(chat.backend?.implementation || null);
    }
    setPresentation({ kind: "ready", chatId: chat.id });
    return scopeReload;
    });
    // The chat is on screen, so navigation is done; whether its agent is warm is a separate question.
    entry.onShown?.();
    await scopeReload;
  };

  /**
   * The transcript read and the live attach run together while the transcript stays hidden; live frames buffer until
   * the transcript is installed, then replay in order. The first runtime_state is the attach boundary: the server
   * always sends it after the optional generation_replay snapshot.
   */
  const performLiveSelect = async (
    chat: ChatSummary,
    project: Project,
    navigationOptions: { history?: "push" | "replace" | "none"; onCommit?: () => void; onShown?: () => void } = {},
  ) => {
    reset();
    const selection = selectionToken;
    let resolveShown = () => {};
    const shown = new Promise<void>((resolve) => { resolveShown = resolve; });
    const opening: LiveOpening = {
      chatId: chat.id,
      selection,
      transcriptReady: false,
      socketReady: false,
      events: [],
      onShown: navigationOptions.onShown,
      resolve: resolveShown,
    };
    liveOpening = opening;
    batch(() => {
      catalogue.select(chat, project);
      if (navigationOptions.history === "push") history.pushState({}, "", chatPath(chat.id));
      else if (navigationOptions.history === "replace") history.replaceState({}, "", chatPath(chat.id));
      navigationOptions.onCommit?.();
      setMessages([]);
      setTools([]);
      setPageBefore(null);
      setLoadedId(chat.id);
      setStatus(chat.status);
      setTitle(chat.title);
      setTemplateId(chat.profileId || chat.templateId || options.defaultTemplateId() || "assistant");
      setRuntimeIdentity(chat.runtime || null);
      setBackendImplementation(chat.backend?.implementation || null);
      setPresentation({ kind: "opening_live", chatId: chat.id });
    });

    const transcriptRequest = loadTranscript(chat);
    const attachRequest = ensureAgent({ chatId: chat.id, projectId: project.id, intent: "open" });
    const [transcriptResult, attachResult] = await Promise.all([
      settleRequest(transcriptRequest),
      settleRequest(attachRequest),
    ]);
    if (liveOpening !== opening || selection !== selectionToken || selectedId() !== chat.id) return;
    // The process can settle between the click and the attach; a second transcript read is then the settled state,
    // with no socket snapshot to wait for.
    const detailResult = transcriptResult.kind === "value" && attachResult.kind === "value" && !attachResult.value
      ? await settleRequest(fetchTranscript(chat)) : transcriptResult;
    if (liveOpening !== opening || selection !== selectionToken || selectedId() !== chat.id) return;
    // The hub went while this opened: what this client already holds, shown and ready to type into, rather than a
    // chat that could not be loaded. The address bar has already moved.
    if (detailResult.kind === "error" && isUnreachableError(detailResult.error)) {
      return enterOffline(chat, project, { history: "none", onShown: navigationOptions.onShown });
    }
    if (detailResult.kind === "error") {
      batch(() => {
        setPresentation({ kind: "live_error", chatId: chat.id });
        navigationOptions.onShown?.();
      });
      liveOpening = null;
      opening.resolve();
      throw detailResult.error;
    }
    const detail = detailResult.value;
    applyDetail(detail);
    // Each scope selects the target synchronously, so starting it before the reveal leaves no visible control on
    // the prior chat; its network completion does not delay the transcript.
    const scopeReload = reconcileChatScope(chat, project, detail, true);
    opening.transcriptReady = true;
    for (const event of opening.events.splice(0)) consume(event);
    if (attachResult.kind === "error" || !attachResult.value || !live()) opening.socketReady = true;
    finishLiveOpening(opening);
    if (attachResult.kind === "error") onError(attachResult.error);
    await shown;
    await scopeReload;
  };

  const enterOffline = async (
    chat: ChatSummary,
    project: Project,
    navigationOptions: { history?: "push" | "replace" | "none"; onCommit?: () => void; onShown?: () => void } = {},
  ) => {
    // What this page read of it, else the copy kept on the device (a cold start has nothing in memory).
    const navigation = navigationToken.next();
    const known = transcriptCache.get(chat.id)?.detail ?? await readDeviceTranscript(chat.id) ?? undefined;
    if (!navigation()) return;
    const entering = enterChat(chat, project, {
      detail: known,
      history: navigationOptions.history || "replace",
      warm: false,
      offline: true,
      onCommit: navigationOptions.onCommit,
      onShown: navigationOptions.onShown,
    });
    // After enterChat's reset, which forgets any earlier one.
    enteredOffline = { chat, project };
    await entering;
  };

  createEffect(on(() => options.runtime.connectivity() === "online", (online) => {
    const entered = enteredOffline;
    if (!online || !entered || selectedId() !== entered.chat.id || loadedId() !== entered.chat.id) return;
    enteredOffline = null;
    const selection = selectionToken;
    // Re-asks only what the open could not get from the hub, for the chat already open, rather than entering it again.
    void loadDetail(entered.chat.id, true, selection).catch(onError);
    void models.reloadChat(entered.chat.id);
    void permissions?.select(entered.chat.id);
    void serviceLevels?.select(entered.chat.id);
  }, { defer: true }));

  let deviceCopy: { chatId: string; detail: TranscriptDetail } | null = null;
  let deviceCopyTimer: ReturnType<typeof setTimeout> | undefined;
  const DEVICE_COPY_DELAY_MS = 2_000;
  const writeDeviceCopy = () => {
    clearTimeout(deviceCopyTimer);
    deviceCopyTimer = undefined;
    const copy = deviceCopy;
    deviceCopy = null;
    if (copy) void saveDeviceTranscript(copy.chatId, copy.detail);
  };
  createEffect(() => {
    const chatId = loadedId();
    const list = messages();
    const toolList = tools();
    if (!chatId || presentation().kind !== "ready" || !list.length) return;
    untrack(() => {
      if (deviceCopy && deviceCopy.chatId !== chatId) writeDeviceCopy();
      const base = transcriptCache.get(chatId)?.detail;
      deviceCopy = { chatId, detail: { ...base, id: chatId, projectId: projectId(), title: title(), status: status(),
        messages: list, tools: toolList } as TranscriptDetail };
      deviceCopyTimer ??= setTimeout(writeDeviceCopy, DEVICE_COPY_DELAY_MS);
    });
  });
  // The open chat's waiting messages are its own to send; the app's background sending leaves them alone.
  createEffect(() => {
    const chatId = loadedId();
    if (chatId) onCleanup(holdOutboxOpen(chatId));
  });

  const performSelect = async (
    chat: ChatSummary,
    project: Project,
    navigationOptions: { history?: "push" | "replace" | "none"; onCommit?: () => void; onShown?: () => void } = {},
  ) => {
    if (hubUnreachable()) return enterOffline(chat, project, navigationOptions);
    if (chatIsLive(chat)) return performLiveSelect(chat, project, navigationOptions);
    const navigation = navigationToken.next();
    const cached = cachedTranscript(chat);
    let detail: TranscriptDetail;
    try { detail = cached || await loadTranscript(chat); }
    catch (error) {
      if (!navigation() || !isUnreachableError(error)) throw error;
      return enterOffline(chat, project, navigationOptions);
    }
    if (chatIsLive(chat)) transcriptPrefetches.delete(chat.id);
    if (!navigation()) return;
    await enterChat(chat, project, {
      detail,
      history: navigationOptions.history || "replace",
      warm: attachOnOpen(chat),
      onCommit: navigationOptions.onCommit,
      onShown: navigationOptions.onShown,
    });
    // A cached transcript is shown first and corrected behind itself; a live one
    // is corrected by its own stream.
    if (detail.status !== "active" && cached) {
      const selection = selectionToken;
      void fetchTranscript(chat).then((fresh) => {
        if (selection !== selectionToken || selectedId() !== chat.id) return;
        applyDetail(fresh, true);
      }).catch(onError);
    }
  };

  // A chat drawn as the finger goes down on its row (a phone's drawer), so the tap only has to slide the drawer.
  // Drawn only: the tap adopts it (address, read receipt, agent, fresh read); a press that becomes a scroll goes back.
  let previewed: string | null = null;
  const preview = (chat: ChatSummary, project: Project) => {
    if (hubUnreachable() || chatIsLive(chat) || navigationRequest || selectedId() === chat.id) return false;
    const cached = cachedTranscript(chat);
    if (!cached) return false;
    previewed = chat.id;
    void enterChat(chat, project, { detail: cached, history: "none", preview: true }).catch(onError);
    return true;
  };
  const adoptPreview = (chat: ChatSummary, project: Project) => {
    const adopted = previewed === chat.id && selectedId() === chat.id && loadedId() === chat.id;
    previewed = null;
    if (!adopted) return false;
    history.pushState({}, "", chatPath(chat.id));
    markChatRead(catalogue, chat);
    const selection = selectionToken;
    const cached = cachedTranscript(chat);
    if (attachOnOpen(chat)) warmAgent(chat, project, cached || undefined, selection);
    // As a tap's open: corrected behind itself, an active one by its own stream.
    if (cached?.status !== "active") void fetchTranscript(chat).then((fresh) => {
      if (selection !== selectionToken || selectedId() !== chat.id) return;
      applyDetail(fresh, true);
    }).catch(onError);
    return true;
  };

  const select = (
    chat: ChatSummary,
    project: Project,
    navigationOptions: { history?: "push" | "replace" | "none"; onCommit?: () => void } = {},
  ) => {
    if (navigatingId() === chat.id && navigationRequest) return navigationRequest;
    setNavigatingId(chat.id);
    warmTurnArtifacts(project.id, chat);
    let request: Promise<void>;
    const shown = () => { if (navigatingId() === chat.id) setNavigatingId(null); };
    request = performSelect(chat, project, { ...navigationOptions, onShown: shown }).finally(() => {
      if (navigationRequest !== request) return;
      navigationRequest = null;
      setNavigatingId(null);
    });
    navigationRequest = request;
    return request;
  };

  const initialize = (chat: ChatSummary, project: Project, detail?: TranscriptDetail, entry: { warm?: boolean } = {}) =>
    enterChat(chat, project, {
      detail,
      history: "none",
      warm: entry.warm ?? attachOnOpen(chat),
    });

  const prepareOutboundMessage = () => {
    const chatId = loadedId() ?? "";
    const text = draft().trim();
    const attachmentIds = attachments.pendingIds();
    const comments = reviewComments(chatId);
    const sentAttachments = attachments.items()
      .filter((item) => attachmentIds.includes(item.id))
      .map(({ id, name, size, type, objectUrl }) => ({ id, name, size, type, objectUrl }));
    return {
      chatId,
      text,
      message: projectReviewComments(text, comments),
      attachmentIds,
      sentAttachments,
      hasContent: Boolean(text || attachmentIds.length || comments.length),
    };
  };

  // The id travels with the prompt, so the harness's commit comes back under it and the row on screen is that
  // message, with nothing to reconcile afterwards.
  const newMessageId = () => `m_${crypto.randomUUID()}`;

  const acceptOutboundMessage = (prepared: ReturnType<typeof prepareOutboundMessage>) => {
    attachments.markAnnounced(prepared.attachmentIds);
    clearReviewComments(prepared.chatId);
  };

  const keepForLater = (prepared: ReturnType<typeof prepareOutboundMessage>, chatId: string, messageId = newMessageId()) => {
    const entry: OutboxEntry = { messageId, kind: streaming() ? "follow_up" : "prompt", message: prepared.message, timestamp: new Date().toISOString() };
    addToOutbox(chatId, entry);
    acceptOutboundMessage(prepared);
    setDraft("");
    setMessages((current) => current.some((message) => message.id === messageId)
      ? current.map((message) => message.id === messageId ? { ...message, outbox: true } : message)
      : [...current, outboxMessage(entry)]);
    outboxChanged();
  };

  // Each message leaves the outbox before it is handed to the socket, since the server does not ignore a repeated
  // message id, and goes back only when the socket refused it without sending anything.
  let flushingOutbox = false;
  const flushOutbox = async () => {
    const chatId = loadedId();
    if (flushingOutbox || !chatId || selectedId() !== chatId || !outboxOf(chatId).length) return;
    if (options.runtime.connectivity() !== "online" || presentation().kind !== "ready") return;
    if (generation() === "stopping" || generation() === "submitting") return;
    const current = stillSelected();
    flushingOutbox = true;
    try {
      if (!live() || live()!.chatId !== chatId || !session.isOpen()) {
        try { await requireAgent("prompt"); }
        catch (error) { if (current() && !isUnreachableError(error)) onError(error); return; }
      }
      for (;;) {
        if (!current() || !session.isOpen() || generation() === "stopping") return;
        const next = outboxOf(chatId)[0];
        if (!next) return;
        const busy = streaming();
        const queueMode = !busy ? null : supports("followUpQueue") ? "follow_up" : supports("steer") ? "steer" : undefined;
        // A working agent that takes nothing queued is waited out: its turn ending runs this again.
        if (queueMode === undefined) return;
        const entry = takeFromOutbox(chatId, next.messageId);
        if (!entry) continue;
        try {
          session.send(queueMode
            ? { type: queueMode, messageId: entry.messageId, message: entry.message, attachmentIds: [] }
            : { type: "prompt", messageId: entry.messageId, message: entry.message, attachmentIds: [] });
        } catch {
          returnToOutbox(chatId, entry);
          return;
        }
        outboxChanged();
        if (queueMode) {
          // Queued, it is the composer's queued bubble's (from the server's queue), not a sent turn.
          setMessages((list) => list.filter((message) => message.id !== entry.messageId));
        } else {
          setMessages((list) => list.map((message) => message.id === entry.messageId ? { ...message, outbox: undefined } : message));
          setStatus("active");
          setGeneration(stopRequest ? "stopping" : "active");
        }
      }
    } finally {
      flushingOutbox = false;
    }
  };
  // Asked again whenever the hub, the chat or its turn changes.
  createEffect(() => {
    outboxRevision();
    if (options.runtime.connectivity() !== "online" || presentation().kind !== "ready" || !loadedId()) return;
    generation();
    untrack(() => void flushOutbox());
  });

  const cancelOutbox = (messageId: string) => {
    const chatId = loadedId();
    if (!chatId) return;
    const entry = takeFromOutbox(chatId, messageId);
    // Gone already: it is on its way.
    if (!entry) return;
    outboxChanged();
    setMessages((current) => current.filter((message) => message.id !== messageId));
    const review = parseReviewComments(entry.message);
    setDraft((value) => value.trim() ? `${value}\n${review.text}` : review.text);
    if (review.comments.length) restoreReviewComments(chatId, [...reviewComments(chatId), ...review.comments]);
  };

  const send = async (mode?: "steer" | "follow_up") => {
    if (generation() === "stopping") return;
    const prepared = prepareOutboundMessage();
    const chatId = selectedId();
    const current = stillSelected();
    const online = options.runtime.connectivity() === "online";
    if (!prepared.hasContent) return;
    const compactCommand = /^\/compact\s+\S/.test(prepared.text) && supports("compaction");
    // What can wait for the hub: a plain message, as a prompt or a follow-up. A steer, an edit (a fork), a compaction
    // and attachments still need it there.
    const keepable = Boolean(chatId) && loadedId() === chatId && !compactCommand && mode !== "steer"
      && !editingEntryId() && !prepared.attachmentIds.length;
    if (!online && !keepable) return onError("Server unavailable");
    // Behind anything already waiting, so they go in the order they were sent.
    if (keepable && (!online || outboxOf(chatId!).length)) return keepForLater(prepared, chatId!);
    if (compactCommand) {
      if (!streaming() && !compacting()) try { await requireAgent("compact"); if (!current()) return; session.send({ type: "compact", instructions: prepared.text.slice(8).trim().slice(0, 2000).trim() }); if (draft().trim() === prepared.text) setDraft(""); } catch (error) { if (current()) onError(error); } return; }
    const busy = streaming();
    const messageId = newMessageId();
    const local: Message = { id: messageId, role: "user", content: prepared.message, timestamp: new Date().toISOString(), attachments: prepared.sentAttachments, local: true };

    if (busy) {
      // Sending while the agent works queues rather than cutting the turn off; the id goes with it so the transcript
      // does not show the same message twice.
      const queueMode = mode || (supports("steer") ? "steer" : "follow_up");
      setDraft("");
      try {
        await requireAgent("steer");
        if (!current()) return;
        session.send({ type: queueMode === "steer" ? "steer" : "follow_up", messageId, message: prepared.message, attachmentIds: prepared.attachmentIds });
        acceptOutboundMessage(prepared);
      } catch (error) { if (!current()) return; setDraft(prepared.text); onError(error); }
      return;
    }

    // Shown before the server has it; a failure to start the agent takes the message and the draft back.
    const previous = messages();
    const editId = editingEntryId();
    const placeLocal = (current: Message[]) => {
      if (current.some((item) => item.id === messageId)) return current;
      if (!editId) return [...current, local];
      const index = current.findIndex((item) => item.id === editId);
      return index >= 0 ? [...current.slice(0, index), local] : [...current, local];
    };
    setDraft("");
    setMessages(placeLocal);
    setGeneration("submitting");
    currentGeneration = null;
    // Left while its agent was starting: the stream it waited for went with the chat, so the message goes by HTTP
    // instead of being dropped, and the server starts the agent with the composer's choice. An edit forks in place
    // and is not handed over.
    const ownerProjectId = projectId();
    const model = models.model();
    const thinkingLevel = models.effort();
    const handOver = () => {
      if (editId || !chatId) return;
      void api(`/v0/chats/${encodeURIComponent(chatId)}/prompt`, { method: "POST", timeout: false, body: JSON.stringify({
        messageId, message: prepared.message, attachmentIds: prepared.attachmentIds, projectId: ownerProjectId, model, thinkingLevel }) })
        .then(() => { acceptOutboundMessage(prepared); void catalogue.refresh().catch(() => {}); }).catch(onError);
    };
    if (!live() || live()!.chatId !== selectedId() || !session.isOpen()) {
      try { await requireAgent("prompt"); } catch (error) {
        if (!current()) return handOver();
        stopRequest = null;
        // The hub went before the agent could be reached: nothing was sent, so the message waits rather than coming back.
        if (!editId && chatId && !prepared.attachmentIds.length && isUnreachableError(error)) {
          setGeneration("idle");
          keepForLater(prepared, chatId, messageId);
          return;
        }
        setMessages(previous);
        setDraft(prepared.text);
        setGeneration("idle");
        onError(error);
        return;
      }
      if (!current()) return handOver();
      // A snapshot read while the agent started may not hold it yet.
      setMessages(placeLocal);
    }
    try {
      session.send(editId
        ? { type: "fork_and_prompt", entryId: editId, messageId, message: prepared.message, attachmentIds: prepared.attachmentIds, model: models.model(), thinkingLevel: models.effort() }
        : { type: "prompt", messageId, message: prepared.message, attachmentIds: prepared.attachmentIds });
      acceptOutboundMessage(prepared);
      setStatus("active");
      setGeneration(stopRequest ? "stopping" : "active");
      setEditingEntryId(null);
    } catch (error) {
      if (!current()) return;
      stopRequest = null;
      setMessages(previous);
      setEditingEntryId(editId);
      setDraft(prepared.text);
      setGeneration("idle");
      onError(error);
    }
  };

  /** A stop pressed while the session was closing or closed, and so not sent: the snapshot that opens it finds the turn. */
  const sendOwedStop = (generationId: string | null) => {
    if (!stopRequest || stopRequest.generationId || stopRequest.sent) return;
    if (generationId) stopRequest.generationId = generationId;
    else stopRequest.sent = true;
    try { session.send(generationId ? { type: "stop_generation", generationId } : { type: "stop_generation" }); }
    catch (error) { onError(error); }
  };

  const stop = () => {
    if (!streaming()) return;
    const active = generation() === "active";
    stopRequest = { generationId: currentGeneration };
    setGeneration("stopping");
    // The server clears the queue before it stops, so what was queued comes
    // back to the composer rather than being sent after the stop.
    clearQueue();
    if (stopRequest.generationId) session.sendWhenReady({ type: "stop_generation", generationId: stopRequest.generationId });
    else if (active && session.isOpen()) { stopRequest.sent = true; session.send({ type: "stop_generation" }); }
    else if (!session.isOpen()) void session.ensure({ intent: "open" }).catch(onError);
  };

  const regenerate = async (entryId: string) => {
    if (!entryId || !supports("regenerate") || streaming() || stopping()) return;
    const previous = messages();
    if (!previous.some((message) => message.id === entryId)) return;
    // Show the answers going before the round trip. The prompt stays: the server restates it under the name this
    // row already has.
    const cut = previous.slice(previous.findIndex((message) => message.id === entryId) + 1);
    const current = stillSelected();
    setMessages(truncateAt(previous, entryId, { inclusive: false }));
    // The turn is claimed before the agent starts, as a send's is, so a second press meanwhile does nothing.
    setGeneration("submitting");
    try {
      await requireAgent("regenerate");
      // Left while the agent started: the transcript and the session now belong to the other chat.
      if (!current()) return;
      // Again: a snapshot taken while the agent started still holds them.
      setMessages((current) => truncateAt(current, entryId, { inclusive: false }));
      setGeneration(stopRequest ? "stopping" : "active");
      session.send({ type: "regenerate", entryId, model: models.model(), thinkingLevel: models.effort() });
    } catch (error) {
      if (!current()) return;
      stopRequest = null;
      // Put back only what was cut, so anything stated meanwhile stands.
      setMessages((current) => {
        const at = current.findIndex((message) => message.id === entryId);
        if (at < 0) return current;
        const missing = cut.filter((message) => !current.some((held) => held.id === message.id));
        return [...current.slice(0, at + 1), ...missing, ...current.slice(at + 1)];
      });
      setGeneration("idle");
      onError(error);
    }
  };

  // A compact asked for while the agent starts: the harness says it is compacting only once it is sent.
  let compactAsked = false;
  const compact = async () => {
    if (streaming() || compacting() || compactAsked || !supports("compaction")) return;
    const current = stillSelected();
    compactAsked = true;
    try { await requireAgent("compact"); if (current()) session.send({ type: "compact" }); }
    catch (error) { if (current()) onError(error); }
    finally { compactAsked = false; }
  };

  const loadHarnessCommands = async () => {
    const chatId = selectedId();
    if (!chatId || commandsLoadedFor === chatId) return;
    if (commandsLoading) return commandsLoading;
    commandsLoading = (async () => {
      const result = await api<{ commands: HarnessCommand[] }>(`/v0/chats/${encodeURIComponent(chatId)}/commands`);
      if (selectedId() !== chatId) return;
      setHarnessCommands(Array.isArray(result.commands) ? result.commands : []);
      commandsLoadedFor = chatId;
    })().catch(onError).finally(() => { commandsLoading = null; });
    return commandsLoading;
  };

  const loadOlder = async () => {
    if (!selectedId() || !pageBefore() || loadingOlder()) return false;
    const chatId = selectedId()!;
    const selection = selectionToken;
    setLoadingOlder(true);
    try {
      const detail = await api<TranscriptDetail>(`/v0/sessions/${chatId}?before=${encodeURIComponent(pageBefore()!)}`);
      if (selection !== selectionToken || selectedId() !== chatId) return;
      setMessages((current) => [...asList<Message>(detail.messages), ...current]);
      setTools((current) => [...assignToolSeq(asList<ToolItem>(detail.tools)), ...current] as ToolItem[]);
      setPageBefore(detail.page?.before || null);
      return true;
    } catch (error) {
      if (selection === selectionToken && selectedId() === chatId) onError(error);
      return false;
    }
    finally { if (selection === selectionToken) setLoadingOlder(false); }
  };

  const cancelEdit = () => {
    if (!editingEntryId()) return;
    setDraft(""); setEditingEntryId(null); attachments.restore([]); clearReviewComments(loadedId() ?? "");
  };
  const edit = (message: Message) => {
    const chatId = loadedId() ?? "";
    if (editingEntryId() === message.id) return cancelEdit();
    const review = parseReviewComments(message.content || "");
    setDraft(review.text);
    restoreReviewComments(chatId, review.comments);
    setEditingEntryId(message.id);
    attachments.restore(message.attachments || []);
  };

  const respondHostUi = (response: UnknownRecord) => {
    if (!session.isOpen()) return onError("Not connected to the live session");
    session.send({ type: "extension_ui_response", ...response });
    setHostUiRequests((current) => current.filter((item) => item.id !== response.id));
  };

  // Queued messages come from the backend's queue rather than local state: it drops one when the model reads it,
  // which is when the bubble should clear.
  const pendingMessages = createMemo(() => {
    const waiting = [...queue().steering, ...queue().followUp];
    return waiting.map((item, index) => ({
      id: `queued_${index}`,
      role: "user" as const,
      content: typeof item === "string" ? item : String((item as { message?: string })?.message ?? item ?? ""),
      timestamp: "",
      pending: true,
      queueMode: index < queue().steering.length ? ("steer" as const) : ("follow_up" as const),
    }));
  });

  // Cleared on the backend so it cannot deliver these messages after the user takes them back.
  const takeQueued = () => {
    const text = pendingMessages().map((message) => message.content).filter(Boolean).join("\n");
    if (session.isOpen()) session.send({ type: "clear_queue" });
    setQueue({ steering: [], followUp: [] });
    return text;
  };

  // clear_queue, abort, prompt must run in that order; as one server-side command it cannot race the backend's
  // terminal event.
  const interruptAndSend = () => {
    const prepared = prepareOutboundMessage();
    if (!pendingMessages().length && !prepared.hasContent) return void stop();
    // Joined the way the server's interruptedPromptInput joins them, so the bubble says what the model was asked.
    const interrupting = [...pendingMessages().map((message) => message.content), prepared.message]
      .map((text) => text.trim()).filter(Boolean).join("\n");
    const interruptId = newMessageId();
    const local: Message = { id: interruptId, role: "user", content: interrupting,
      timestamp: new Date().toISOString(), attachments: prepared.sentAttachments, local: true };
    const previous = messages();
    setQueue({ steering: [], followUp: [] });
    setDraft("");
    setGeneration("submitting");
    try {
      session.send({ type: "interrupt_and_send", messageId: interruptId, message: prepared.message, attachmentIds: prepared.attachmentIds,
        model: models.model(), thinkingLevel: models.effort() });
      setMessages((current) => [...current, local]);
      acceptOutboundMessage(prepared);
      setStatus("active");
      setGeneration("active");
    } catch (error) {
      setMessages(previous);
      setDraft(prepared.text);
      setGeneration("idle");
      onError(error);
    }
  };

  const editQueued = () => {
    const text = takeQueued();
    if (text) setDraft((current) => current ? `${current}\n${text}` : text);
  };

  const discardQueued = () => { takeQueued(); };

  const clearQueue = () => {
    const restored = pendingMessages().map((message) => message.content).filter(Boolean).join("\n");
    setQueue({ steering: [], followUp: [] });
    if (restored) setDraft((current) => current ? `${current}\n${restored}` : restored);
  };

  const lastOutcome = createMemo(() => messages().findLast((message) => message.role === "user")?.outcome);
  const activity = createMemo(() => {
    const currentPresentation = presentation();
    if (currentPresentation.kind === "opening_live" && currentPresentation.chatId === selectedId()) {
      return { kind: "reconnecting", label: "Reconnecting…" };
    }
    if (currentPresentation.kind === "live_error" && currentPresentation.chatId === selectedId()) {
      return { kind: "runtime_failed", label: "Could not load chat" };
    }
    const process = options.runtime.getProcess(selectedId());
    // A stopped turn says so on its prompt, so the composer reads the same statement as the trace, on every harness.
    const stopped = generation() === "idle" && lastOutcome() === "interrupted";
    const derived = deriveFineActivity({
      generation: stopped ? "interrupted" : generation(),
      processStatus: process?.status || (live() ? "running" : "none"),
      coarse: typeof process?.activity === "string" ? process.activity : process?.activity?.kind || "idle",
      thinking: thinking(),
      responding: responding(),
      toolName: activeTool()?.name ?? null,
      toolKind: activeTool()?.kind ?? null,
      retry: retry(),
    });
    if (hostUiRequests().length) return { kind: "waiting_for_user",
      label: hostUiRequests()[0]?.kind === "question" ? "Waiting for your answer" : "Waiting for your confirmation" };
    // A launch request in flight: the server has nothing to publish yet, so the gap between clicking a chat and the
    // spawn reaching the runtime stream shows here. Anything the server reports wins, as `derived` comes first.
    if (derived.kind === "idle" && !process && selectedId() && session.launching() === selectedId()) {
      return { kind: "starting", label: "Starting agent…" };
    }
    if (derived.kind === "idle") {
      const lastAssistant = messages().findLast((message) => message.role === "assistant");
      if (lastAssistant?.stopReason === "error") {
        return { kind: "request_failed", label: "Request failed · Ready to retry" };
      }
    }
    // "starting" means the harness itself is not ready yet, which the server reports.
    return derived.kind === "starting" ? { kind: "starting", label: "Starting agent…" } : derived;
  });

  onCleanup(() => {
    writeDeviceCopy();
    transcriptPrefetches.clear();
    transcriptCache.clear();
    session.dispose();
  });

  return {
    status, setStatus, title, setTitle, templateId, setTemplateId, runtimeIdentity, setRuntimeIdentity, backendImplementation,
    live, messages, setMessages, tools, loadedId, pageBefore, loadingOlder, draft, setDraft,
    generation, editingEntryId, contextUsage, sessionStats, cacheStats, refreshContext, loadBreakdown, compacting, hostUiRequests, queue, pendingMessages, capabilities, harnessCommands, activeGeneration, activeGenerationChange, turnArtifacts,
    navigatingId, presentation, interactionReady: () => presentation().kind === "ready" && Boolean(loadedId()), streaming, stopping, activity,
    initialize, select, prefetch, preview, adoptPreview, previewing: () => previewed,
    whenRead: (chat: ChatSummary) => chatIsLive(chat) ? Promise.reject(new Error("live")) : loadTranscript(chat).then(() => undefined), turnArtifactTimeline, loadDetail, ensureAgent, reset, send, stop, regenerate, rehydrateDraft,
    compact, loadHarnessCommands, loadOlder, edit, cancelEdit, respondHostUi, clearQueue, interruptAndSend, editQueued, discardQueued,
    agents, stopAgent, cancelOutbox,
    openOffline: (chat: ChatSummary, project: Project) => enterOffline(chat, project, { history: "none" }),
  };
}

export type ActiveChatStore = ReturnType<typeof createActiveChat>;
