import { batch, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { deriveFineActivity } from "../../activity.js";
import { api, asList } from "../api/client";
import { createAgentSession } from "./agent-session";
import { webSocketUrl } from "../api/transport";
import { isStructuredGenerationEvent, normalizeLiveEvent } from "../api/live-events";
import type { LiveEvent, RuntimeStateEvent, StructuredGenerationEvent, TurnArtifactSummary } from "../api/live-events";
import type {
  ChatStatus,
  Attachment,
  ChatSummary,
  CacheStats,
  ChatCapabilities,
  ContextUsage,
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
import { assignToolSeq, mergeTranscriptProjection, promotePendingUser, replaceTranscriptProjection, settleGenerationMessages, tagOptimisticGenerationOwner, truncateForRegenerate } from "../timeline-order";
import { reconcileMessages } from "../reconcile-messages";
import { getHarnessRecorder, recordHarnessMetric } from "../harness-metrics";
import { canCoalesceTextDelta, enqueueOverflowLiveEvent, mergeTextDeltaEvents } from "./text-delta-batcher";
import type { UploadAttachment } from "./attachments";
import type { DraftsStore } from "./drafts";
import type { CatalogueStore } from "./catalogue";
import { freezeGeneration, settleGenerationTools, type ActiveGenerationView, type LiveGenerationChange } from "../turn-rows";
import type { ModelSettings } from "./model-settings";
import type { PermissionSettings } from "./permission-settings";
import type { ServiceLevelSettings } from "./service-level-settings";
import type { RuntimeStore } from "./runtime";
import { createClientActiveGenerationStore } from "./active-generation-store.js";
import { clearReviewComments, parseReviewComments, projectReviewComments, restoreReviewComments, reviewComments } from "../chat/review-comments";

type UnknownRecord = Record<string, unknown>;
type ErrorHandler = (error: unknown) => void;

/** Mirrors the server's SPAWNING_INTENTS; see the note at its only use. */
const SPAWNING_INTENTS = new Set(["select", "prompt", "continue", "compact", "regenerate", "steer"]);

function generationChangeFor(event: StructuredGenerationEvent): LiveGenerationChange {
  const block = event.block && typeof event.block === "object" ? event.block as UnknownRecord : null;
  const contentIndex = Number.isInteger(event.contentIndex)
    ? Number(event.contentIndex)
    : Number.isInteger(block?.contentIndex) ? Number(block?.contentIndex) : undefined;
  const messageId = typeof event.messageId === "string" ? event.messageId : undefined;
  const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : undefined;
  const scope = event.type === "tool_execution_started"
    || event.type === "tool_execution_updated"
    || event.type === "tool_execution_completed"
    ? "tool"
    : event.type === "content_block_delta" || event.type === "content_block_completed"
      ? "block"
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
 * The slices of the two per-chat stores this one actually uses.
 *
 * Named so that a surface without them -- a harness thread with no Conduit
 * chat behind it -- can supply something real instead of casting an object
 * literal through `as never`. A cast satisfies the compiler and not the code:
 * the drive composer shipped one missing a single method, and the surface died
 * on "pendingIds is not a function" the moment somebody opened it.
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

/** For a chat whose harness owns the model and whose surface carries no files. */
export const HARNESS_OWNED_MODELS: ChatModels = {
  model: () => "",
  effort: () => "",
  reloadChat: async () => {},
  select: async () => {},
};

export const NO_CHAT_ATTACHMENTS: ChatAttachments = {
  items: () => [],
  pendingIds: () => [],
  select: () => {},
  markAnnounced: () => {},
  restore: () => {},
};

/** The slice of the catalogue this store uses: which chat is open, and where. */
export interface ChatCatalogue {
  selectedId: () => string | null;
  projectId: () => string;
  select: (chat: ChatSummary, project: Project) => void;
  refresh: () => Promise<Project[]>;
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
  onModelRecovered: (details: { from: string; to: string }) => void;
  defaultTemplateId: () => string;
  saveWorkspaceDefault: (workspaceId: string, templateId: string | null) => Promise<unknown>;
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
  const [pageBefore, setPageBefore] = createSignal<string | null>(null);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [draft, setDraftSignal] = createSignal("");
  /**
   * Persisting through the setter rather than an effect is what keeps `reset()`
   * from wiping the stored draft: it clears `loadedId` before the draft, so the
   * clear has no owner to write to. Every other caller does have one, so
   * sending and failing both reach the store correctly.
   */
  const setDraft: typeof setDraftSignal = ((value: Parameters<typeof setDraftSignal>[0]) => {
    const next = setDraftSignal(value);
    const chatId = loadedId();
    if (chatId) options.drafts?.save(chatId, next, attachments.pendingIds());
    return next;
  }) as typeof setDraftSignal;
  const hydrateDraft = (chatId: string) => {
    const saved = options.drafts?.draftFor(chatId);
    if (saved?.text && !untrack(draft)) setDraftSignal(saved.text);
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
  const [harnessCommands, setHarnessCommands] = createSignal<HarnessCommand[]>([]);
  let commandsLoadedFor: string | null = null;
  let commandsLoading: Promise<void> | null = null;
  const [thinking, setThinking] = createSignal(false);
  const [responding, setResponding] = createSignal(false);
  const [activeToolName, setActiveToolName] = createSignal<string | null>(null);
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
  /*
   * There is deliberately no "is this chat connecting?" signal here any more.
   * A chat's agent state is the server's to report: it publishes the process
   * when it spawns and again when the harness can answer, and both the sidebar
   * row and the composer read that one record through `activity`. A promise in
   * this client used to decide it instead, which is how "Starting agent…" came
   * to cover a catalogue fetch, outlast a warm attach, and mean nothing.
   */
  const [navigatingId, setNavigatingId] = createSignal<string | null>(null);
  let navigationRequest: Promise<void> | null = null;

  let currentGeneration: string | null = null;
  let stopPending = false;
  let selectionToken = 0;
  let navigationToken = 0;
  let pendingTextDelta: StructuredGenerationEvent | null = null;
  let pendingTextDeltaTimer: ReturnType<typeof setTimeout> | null = null;
  const transcriptPrefetches = new Map<string, {
    revision: string;
    expiresAt: number;
    request: Promise<TranscriptDetail>;
  }>();
  const transcriptCache = new Map<string, {
    revision: string;
    detail: TranscriptDetail;
  }>();

  const chatIsLive = (chat: ChatSummary) => chat.liveActive || Boolean(options.runtime.getProcess(chat.id)?.active);
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

  const prefetch = (chat: ChatSummary) => {
    if (!chatIsLive(chat)) void loadTranscript(chat).catch(() => {});
  };
  let overflowLiveEvents: LiveEvent[] = [];
  let overflowLiveEventFrame: number | null = null;
  let overflowLiveEventTimer: ReturnType<typeof setTimeout> | null = null;
  let overflowMode = false;
  const OVERFLOW_FRAME_BUDGET_MS = 6;
  const OVERFLOW_MAX_EVENTS_PER_FRAME = 32;
  const STOP_TERMINAL_EVENT_TYPES = new Set(["generation_stopping", "generation_stopped", "generation_settled", "generation_failed"]);

  const selectedId = catalogue.selectedId;
  /**
   * This chat's connection to its agent.
   *
   * The lifecycle lives in one place that owns nothing else: the process, the
   * stream and the reconnect. What arrives from it is applied here, and what
   * the UI says about it comes from the runtime stream, not from either.
   */
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
    onEvent: (data) => {
      try { consume(normalizeLiveEvent(JSON.parse(data))); }
      catch (error) { onError(error); }
    },
    onLost: () => setLive(null),
    onError,
  });
  const ensureAgent = session.ensure;
  const requireAgent = session.require;
  const projectId = catalogue.projectId;
  const streaming = createMemo(() => generation() === "active" || generation() === "submitting");
  const stopping = createMemo(() => generation() === "stopping");

  const resetLiveFlags = () => {
    setThinking(false);
    setResponding(false);
    setActiveToolName(null);
    setRetry(null);
    setCompacting(false);
  };

  const clearPendingLiveEvents = () => {
    if (pendingTextDeltaTimer) clearTimeout(pendingTextDeltaTimer);
    if (overflowLiveEventFrame != null) cancelAnimationFrame(overflowLiveEventFrame);
    if (overflowLiveEventTimer != null) clearTimeout(overflowLiveEventTimer);
    pendingTextDeltaTimer = null;
    overflowLiveEventFrame = null;
    overflowLiveEventTimer = null;
    pendingTextDelta = null;
    overflowLiveEvents = [];
    overflowMode = false;
  };

  const flushPendingTextDelta = () => {
    const pending = pendingTextDelta;
    pendingTextDelta = null;
    if (pendingTextDeltaTimer) clearTimeout(pendingTextDeltaTimer);
    pendingTextDeltaTimer = null;
    if (pending) applyGenerationEvent(pending);
  };

  const scheduleOverflowLiveEvents = () => {
    if (overflowLiveEventFrame != null || overflowLiveEventTimer != null || !overflowLiveEvents.length) return;
    const drain = () => {
      overflowLiveEventFrame = null;
      overflowLiveEventTimer = null;
      const startedAt = performance.now();
      let processed = 0;
      while (overflowLiveEvents.length && processed < OVERFLOW_MAX_EVENTS_PER_FRAME) {
        const pending = overflowLiveEvents.shift();
        if (pending) applyLiveEvent(pending);
        processed += 1;
        if (processed > 1 && performance.now() - startedAt >= OVERFLOW_FRAME_BUDGET_MS) break;
      }
      if (overflowLiveEvents.length) scheduleOverflowLiveEvents();
      else overflowMode = false;
    };
    if (document.visibilityState === "hidden") overflowLiveEventTimer = setTimeout(drain, 16);
    else overflowLiveEventFrame = requestAnimationFrame(drain);
  };

  const queueTextDelta = (event: StructuredGenerationEvent) => {
    if (overflowMode) {
      const previous = overflowLiveEvents.at(-1);
      if (previous && isStructuredGenerationEvent(previous)
        && previous.type === "content_block_delta"
        && canCoalesceTextDelta(previous, event)) {
        overflowLiveEvents[overflowLiveEvents.length - 1] = mergeTextDeltaEvents(previous, event)!;
      } else {
        enqueueOverflowLiveEvent(overflowLiveEvents, event);
      }
      scheduleOverflowLiveEvents();
      return;
    }
    if (canCoalesceTextDelta(pendingTextDelta, event)) {
      pendingTextDelta = {
        ...pendingTextDelta,
        seq: event.seq,
        delta: `${String(pendingTextDelta!.delta || "")}${String(event.delta || "")}`,
      } as StructuredGenerationEvent;
    } else if (pendingTextDelta
      && pendingTextDelta.generationId === event.generationId
      && pendingTextDelta.messageId === event.messageId
      && pendingTextDelta.contentIndex === event.contentIndex
      && pendingTextDelta.blockType === event.blockType) {
      // The current same-block batch is full. Move it behind an animation
      // frame so the renderer can commit before the next batch is reduced.
      const previous = pendingTextDelta;
      pendingTextDelta = null;
      if (pendingTextDeltaTimer) clearTimeout(pendingTextDeltaTimer);
      pendingTextDeltaTimer = null;
      overflowMode = true;
      enqueueOverflowLiveEvent(overflowLiveEvents, previous);
      enqueueOverflowLiveEvent(overflowLiveEvents, event);
      scheduleOverflowLiveEvents();
    } else {
      flushPendingTextDelta();
      pendingTextDelta = event;
    }
    if (pendingTextDelta && !pendingTextDeltaTimer) pendingTextDeltaTimer = setTimeout(flushPendingTextDelta, 0);
  };

  const queueLiveEvent = (event: LiveEvent) => {
    if (event.type === "content_block_delta") {
      queueTextDelta(event);
      return;
    }
    if (overflowMode) {
      enqueueOverflowLiveEvent(overflowLiveEvents, event);
      scheduleOverflowLiveEvents();
      return;
    }
    flushPendingTextDelta();
    applyLiveEvent(event);
  };

  const reset = () => {
    navigationToken += 1;
    selectionToken += 1;
    setLoadedId(null);
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
    clearPendingLiveEvents();
    generationStore.clear();
    setActiveGenerationChange(null);
    setActiveGeneration(null);
    currentGeneration = null;
    stopPending = false;
  };

  /** The only client owner of assistant generation state and terminal handoff. */
  const applyGenerationEvent = (event: StructuredGenerationEvent) => {
    if (stopPending && !STOP_TERMINAL_EVENT_TYPES.has(event.type)) return;
    if (!live() || live()!.chatId !== selectedId()) return;
    const previous = activeGeneration();
    // The Solid store mutates in place. Capture the status before apply;
    // reading previous.status afterwards reads the new terminal status too.
    const previousStatus = previous?.status;
    const recorder = getHarnessRecorder();
    const reduceStartedAt = recorder ? performance.now() : 0;
    let result: ReturnType<typeof generationStore.apply> | undefined;
    batch(() => {
      // The message that started this turn is the last one the client minted,
      // and until the harness writes it there is nothing else to call it. Tagging it
      // with the generation is what lets that turn's sync find it again.
      if (event.type === "generation_started" || event.type === "generation_resume") {
        setMessages((existing) => tagOptimisticGenerationOwner(existing, event.generationId));
      }
      result = generationStore.apply(event);
      if (result.changed && result.state) {
        setActiveGeneration(result.state as ActiveGenerationView);
        setActiveGenerationChange(generationChangeFor(event));
      }
    });
    if (!result) return;
    const next = result.state as ActiveGenerationView | null;
    if (!next) return;
    // A terminal turn moves into the transcript exactly once. A harness can already
    // have committed its final message; Codex does not. Both copies carry the
    // generation id, so this replacement handles either path and the later
    // backend transcript sync replaces the same range instead of appending.
    const terminal = ["stopped", "complete", "failed"].includes(next.status);
    const wasTerminal = previousStatus ? ["stopped", "complete", "failed"].includes(previousStatus) : false;
    if (terminal && !wasTerminal) {
      const frozen = freezeGeneration(next);
      batch(() => {
        if (frozen.length) {
          setTools((existing) => settleGenerationTools(existing, next));
          setMessages((existing) => settleGenerationMessages(existing, next.id, frozen));
        }
        generationStore.clear();
        setActiveGenerationChange(null);
        setActiveGeneration(null);
      });
    }
    if (recorder) {
      const eventRecord = event as Record<string, unknown>;
      const nestedBlock = eventRecord.block && typeof eventRecord.block === "object"
        ? eventRecord.block as Record<string, unknown>
        : null;
      const nestedBlocks = Array.isArray(eventRecord.blocks)
        ? eventRecord.blocks.filter((block): block is Record<string, unknown> => Boolean(block && typeof block === "object"))
        : [];
      const messageId = typeof eventRecord.messageId === "string" ? eventRecord.messageId : null;
      const directContentIndex = Number.isInteger(eventRecord.contentIndex) ? Number(eventRecord.contentIndex) : null;
      const nestedIndexValue = nestedBlock?.contentIndex;
      const nestedContentIndex = Number.isInteger(nestedIndexValue) ? Number(nestedIndexValue) : null;
      const contentIndex = directContentIndex ?? nestedContentIndex;
      const previousMessage = messageId == null
        ? null
        : previous?.assistantMessages.find((message) => message.id === messageId) || null;
      const nextMessage = messageId == null
        ? null
        : next.assistantMessages.find((message) => message.id === messageId) || null;
      const previousBlock = previousMessage && contentIndex != null
        ? previousMessage.blocks.find((block) => block.contentIndex === contentIndex) || null
        : null;
      const nextBlock = nextMessage && contentIndex != null
        ? nextMessage.blocks.find((block) => block.contentIndex === contentIndex) || null
        : null;
      const selectedIndexValue = nestedBlocks[0]?.contentIndex;
      const selectedBlock = nestedBlocks.length === 1 && Number.isInteger(selectedIndexValue)
        ? Number(selectedIndexValue)
        : null;
      recordHarnessMetric(recorder, {
        stage: "client-reduce",
        eventType: event.type,
        seq: event.seq,
        messageId,
        contentIndex,
        changedBlock: messageId != null && contentIndex != null
          ? `${messageId}:${contentIndex}`
          : messageId != null && selectedBlock != null
            ? `${messageId}:${selectedBlock}`
            : null,
        changeScope: messageId != null && (contentIndex != null || selectedBlock != null)
          ? "block"
          : "structural-boundary",
        boundaryType: messageId != null && (contentIndex != null || selectedBlock != null) ? null : event.type,
        reduceMs: performance.now() - reduceStartedAt,
        generationIdentityChanged: previous !== next,
        assistantMessagesIdentityChanged: previous?.assistantMessages !== next.assistantMessages,
        messageIdentityChanged: previousMessage !== nextMessage,
        blockArrayIdentityChanged: previousMessage?.blocks !== nextMessage?.blocks,
        blockIdentityChanged: previousBlock !== nextBlock,
        toolExecutionsIdentityChanged: previous?.toolExecutions !== next.toolExecutions,
      });
    }
    currentGeneration = next.id;
    if (terminal) {
      resetLiveFlags();
    } else {
      const blocks = next.assistantMessages.flatMap((message) => message.blocks);
      const latest = blocks.at(-1);
      setThinking(latest?.type === "thinking" && latest.status === "streaming");
      setResponding(latest?.type === "text" && latest.status === "streaming");
      const runningTool = Object.values(next.toolExecutions).find((tool) => tool.status === "running");
      setActiveToolName(runningTool?.name || null);
      setRetry((next as { retry?: RetryState | null }).retry || null);
    }
    if (next.status === "stopping") setGeneration("stopping");
    else if (next.status === "failed") setGeneration("failed")
    else if (next.status === "stopped") {
      stopPending = false;
      setGeneration("interrupted");
      if (event.type === "generation_stopped" && Boolean(event.processTerminated)) {
        setLive(null);
        session.detach();
      }
    } else if (next.status === "complete") {
      stopPending = false;
      setGeneration("idle");
    } else {
      stopPending = false;
      setGeneration("active");
    }
  };

  const applyDetail = (detail: TranscriptDetail, reconcile = false) => {
    const incoming = asList<Message>(detail.messages);
    const nextTools = assignToolSeq(asList<ToolItem>(detail.tools)) as ToolItem[];
    batch(() => {
      setLoadedId(detail.id);
      setMessages((current) => reconcile ? reconcileMessages(current, incoming) as Message[] : incoming);
      setTools(nextTools);
      setPageBefore(detail.page?.before || null);
      setStatus(detail.status || "draft");
      setTitle(detail.title ?? "");
      if (detail.profileId || detail.templateId) setTemplateId(detail.profileId || detail.templateId || null);
      if (detail.runtime) setRuntimeIdentity(detail.runtime);
      setBackendImplementation(detail.backend?.implementation || null);
    });
  };

  const loadDetail = async (chatId: string, reconcile = false, selection = selectionToken) => {
    const detail = await api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(chatId)}`);
    if (selection === selectionToken && selectedId() === chatId) applyDetail(detail, reconcile);
    return detail;
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
    const turnOpen = Boolean(session.generation && !session.generation.closed && !session.generation.settled);
    if (session.stopping) setGeneration("stopping");
    else if (turnOpen || session.active) setGeneration("active");
    else setGeneration((current) => current === "interrupted" ? current : "idle");
  };

  function applyLiveEvent(event: LiveEvent) {
    if (isStructuredGenerationEvent(event)) {
      applyGenerationEvent(event);
      return;
    }
    switch (event.type) {
      case "runtime_state":
        applySnapshot(event);
        break;
      case "context_usage":
        if (event.contextUsage) setContextUsage(event.contextUsage);
        if (event.sessionStats) setSessionStats(event.sessionStats);
        if (event.cacheStats) setCacheStats(event.cacheStats);
        break;
      case "compaction_start":
        setCompacting(true);
        break;
      case "compaction_end":
        setCompacting(false);
        break;
      case "auto_retry_start":
        setRetry(event.retry);
        setGeneration((current) => current === "stopping" ? current : "active");
        break;
      case "auto_retry_end":
        setRetry(null);
        break;
      case "queue_update":
        setQueue(event.queue);
        break;
      case "extension_ui_request":
        if (event.request) setHostUiRequests((current) => current.some((item) => item.id === event.request!.id) ? current : [...current, event.request!]);
        break;
      case "extension_ui_resolved":
        setHostUiRequests((current) => current.filter((item) => item.id !== event.requestId));
        break;
      case "session_checkpoint":
        if (event.title && event.chatId === selectedId()) setTitle(event.title);
        if (event.chatId === selectedId()) {
          if (event.artifacts) setTurnArtifacts({ chatId: event.chatId, items: event.artifacts });
        }
        break;
      case "transcript_sync":
        batch(() => {
          const incomingMessages = asList<Message>(event.messages);
          const incomingTools = assignToolSeq(event.tools as ToolItem[]);
          const projection = event.replaceAll
            ? replaceTranscriptProjection(messages(), incomingMessages, incomingTools)
            : mergeTranscriptProjection(messages(), tools(), incomingMessages, incomingTools, event.generationId || null);
          setMessages(projection.messages);
          setTools(projection.tools);
        });
        break;
      case "user_message_committed":
        setMessages((current) => promotePendingUser(current, event.message));
        break;
      // A process the server deliberately stopped stays stopped. The socket
      // close that follows is otherwise indistinguishable from a dropped
      // connection, so the reconnect timer used to start a replacement process
      // within a second -- which is why Stop process appeared to do nothing and
      // the live dot came straight back. A crash still reconnects.
      case "runtime_exit":
        if (event.deliberate) {
          setLive(null);
          resetLiveFlags();
          setGeneration("idle");
          session.detach();
        }
        break;
      case "runtime_error":
      case "client_error":
        if (!stopPending) setGeneration(event.type === "runtime_error" ? "failed" : "idle");
        resetLiveFlags();
        if (event.code === "generation_limit") {
          setMessages((current) => {
            const last = current.at(-1);
            if (last?.role === "user" && last.id.startsWith("user_")) { setDraft((value) => value || last.content || ""); return current.slice(0, -1); }
            return current;
          });
        }
        const message = event.message || (event.code === "generation_limit" ? "Too many concurrent generations. Wait for another chat to finish." : "Runtime error");
        onError(Object.assign(new Error(message), {
          code: event.code,
          runtimeEvent: { type: event.type, code: event.code, generationId: event.generationId },
        }));
        break;
      case "unknown":
        break;
    }
  }

  function consume(event: LiveEvent) {
    // Normal deltas retain the existing zero-delay coalescing path. Only an
    // oversized same-block burst enters the RAF queue, which gives Solid and
    // the browser a paint boundary between bounded batches.
    if (overflowMode || pendingTextDelta || isStructuredGenerationEvent(event)) {
      queueLiveEvent(event);
      return;
    }
    applyLiveEvent(event);
  }

  /**
   * Everything that is scoped to one chat, in one list.
   *
   * These stores each hold one chat's answers and keep them until told to hold
   * another's. Both ways into a chat -- the boot path and the chat-switch path
   * -- used to call them by hand, so adding a store meant remembering it twice
   * and leaving it out of one was invisible: nothing broke, the store simply
   * went on answering for whichever chat it last heard about. That is how a
   * codex chat's permission profiles came to be offered in Pi chats. Anything
   * that belongs to a chat belongs in here, so there is one list to add to and
   * no second place to forget.
   */
  const chatScopes: Array<(scope: { chat: ChatSummary; project: Project; detail?: TranscriptDetail; launching?: boolean }) => void | Promise<void>> = [
    // A chat that is about to launch reloads its models when the process is
    // up. Asking for them here as well raced the launch: the
    // route answers from the live process the moment one is registered, and a
    // process registered but not yet serving answers nothing, and the model
    // request times out waiting for it. The selection itself is applied
    // synchronously from the transcript detail either way, so the composer
    // still shows the right model while the agent starts.
    ({ chat, project, detail, launching }) => models.select(project.id, chat.id, detail, {
      reloadChat: !launching,
      profile: detail?.profileId || detail?.templateId || chat.profileId || chat.templateId || "",
    }),
    ({ chat }) => permissions?.select(chat.id),
    ({ chat }) => serviceLevels?.select(chat.id),
    ({ chat }) => { void attachments.select(chat.id); },
    ({ chat }) => hydrateDraft(chat.id),
  ];

  const reconcileChatScope = (chat: ChatSummary, project: Project, detail?: TranscriptDetail, launching = false) =>
    Promise.all(chatScopes.map((scope) => scope({ chat, project, detail, launching }))).then(() => {});

  /**
   * The one way a chat becomes the open chat.
   *
   * Creating a chat, restoring one from a URL, and clicking one in the sidebar
   * all arrive here with the same three questions answered differently: what
   * history it starts from, whether the address bar moves, and whether its
   * agent should be warmed. They used to be two functions that each remembered
   * a different subset of the work, which is how a chat could end up selected
   * with somebody else's permission modes still on screen.
   */
  const enterChat = async (chat: ChatSummary, project: Project, entry: {
    detail?: TranscriptDetail;
    history?: "push" | "replace" | "none";
    warm?: boolean;
    onCommit?: () => void;
    onShown?: () => void;
  }) => {
    const detail = entry.detail;
    // Drop any previous chat's stream first: sending reuses an open socket
    // without re-checking ownership, so a stale one would carry this chat's
    // prompts into the previous chat's agent.
    reset();
    const selection = selectionToken;
    batch(() => {
      catalogue.select(chat, project);
      if (entry.history === "push") history.pushState({}, "", `/chat/${chat.id}`);
      else if (entry.history === "replace") history.replaceState({}, "", `/chat/${chat.id}`);
      entry.onCommit?.();
    });
    // Every store that holds one chat's answers is told which chat, in one
    // place, so adding one cannot mean remembering it in two.
    const scopeReload = reconcileChatScope(chat, project, detail, entry.warm);
    if (detail) applyDetail(detail);
    else {
      setMessages([]);
      setTools([]);
      setPageBefore(null);
      setLoadedId(chat.id);
      setStatus(chat.status);
      setTitle(chat.title);
      setTemplateId(chat.profileId || chat.templateId || options.defaultTemplateId() || "assistant");
      setRuntimeIdentity(chat.runtime || null);
      setBackendImplementation(chat.backend?.implementation || null);
    }
    // The chat somebody asked for is on screen: navigation is done. Whether its
    // agent is warm is a separate question, answered in the sidebar by the
    // process itself.
    entry.onShown?.();
    if (entry.warm) {
      const draft = chat.status === "draft";
      void ensureAgent({ chatId: chat.id, projectId: project.id, intent: "select" })
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
    }
    await scopeReload;
  };

  const performSelect = async (
    chat: ChatSummary,
    project: Project,
    navigationOptions: { history?: "push" | "replace" | "none"; onCommit?: () => void; onShown?: () => void } = {},
  ) => {
    const navigation = ++navigationToken;
    const cached = cachedTranscript(chat);
    const detail = cached || await loadTranscript(chat);
    if (chatIsLive(chat)) transcriptPrefetches.delete(chat.id);
    if (navigation !== navigationToken) return;
    await enterChat(chat, project, {
      detail,
      history: navigationOptions.history || "replace",
      warm: detail.status === "active",
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

  const select = (
    chat: ChatSummary,
    project: Project,
    navigationOptions: { history?: "push" | "replace" | "none"; onCommit?: () => void } = {},
  ) => {
    if (navigatingId() === chat.id && navigationRequest) return navigationRequest;
    setNavigatingId(chat.id);
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

  /**
   * Open a chat this client just created, restored from a URL, or re-entered
   * after switching its profile - the ways in that do not move history.
   *
   * It warms on the same rule as a click: a chat with a session behind it gets
   * its agent started, behind the transcript. Every caller used to decide that
   * for itself and they disagreed, which is why opening the same chat from two
   * places felt like two different products.
   */
  const initialize = (chat: ChatSummary, project: Project, detail?: TranscriptDetail, entry: { warm?: boolean } = {}) =>
    enterChat(chat, project, {
      detail,
      history: "none",
      // A chat with a session behind it warms on sight. A brand new one does
      // not, unless the caller says it is about to be used -- a chat somebody
      // just created, where the alternative is paying the cold start on their
      // first message.
      warm: entry.warm ?? (detail?.status || chat.status) === "active",
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

  const acceptOutboundMessage = (prepared: ReturnType<typeof prepareOutboundMessage>) => {
    attachments.markAnnounced(prepared.attachmentIds);
    clearReviewComments(prepared.chatId);
  };

  const send = async (mode?: "steer" | "follow_up") => {
    if (generation() === "stopping") return;
    if (options.runtime.connectivity() !== "online") return onError("Server unavailable");
    const prepared = prepareOutboundMessage();
    if (!prepared.hasContent) return;
    const busy = streaming();
    const local: Message = { id: `user_${Date.now()}`, role: "user", content: prepared.message, timestamp: new Date().toISOString(), attachments: prepared.sentAttachments };

    if (busy) {
      // Sending while the agent works steers by default: the message reaches
      // the model as soon as the current tool call settles, rather than waiting
      // for the whole turn. Backends without steering fall back to the queue.
      const queueMode = mode || (capabilities()?.steer === false ? "follow_up" : "steer");
      setDraft("");
      try {
        await requireAgent("steer");
        session.send({ type: queueMode === "steer" ? "steer" : "follow_up", message: prepared.message, attachmentIds: prepared.attachmentIds });
        acceptOutboundMessage(prepared);
      } catch (error) { setDraft(prepared.text); onError(error); }
      return;
    }

    if (!live() || live()!.chatId !== selectedId() || !session.isOpen()) {
      setGeneration("submitting");
      try { await requireAgent("prompt"); } catch (error) { setGeneration("idle"); onError(error); return; }
    }

    const previous = messages();
    const editId = editingEntryId();
    setDraft("");
    setMessages((current) => {
      if (!editId) return [...current, local];
      const index = current.findIndex((item) => item.id === editId);
      return index >= 0 ? [...current.slice(0, index), local] : [...current, local];
    });
    setGeneration("submitting");
    try {
      session.send(editId
        ? { type: "fork_and_prompt", entryId: editId, message: prepared.message, attachmentIds: prepared.attachmentIds, model: models.model(), thinkingLevel: models.effort() }
        : { type: "prompt", message: prepared.message, attachmentIds: prepared.attachmentIds });
      acceptOutboundMessage(prepared);
      setStatus("active");
      setGeneration("active");
      setEditingEntryId(null);
    } catch (error) {
      setMessages(previous);
      setEditingEntryId(editId);
      setDraft(prepared.text);
      setGeneration("idle");
      onError(error);
    }
  };

  const stop = () => {
    if (!streaming()) return;
    flushPendingTextDelta();
    stopPending = true;
    setGeneration("stopping");
    session.sendWhenReady({ type: "stop_generation", generationId: currentGeneration });
  };

  const regenerate = async (entryId: string) => {
    if (!entryId || !capabilities()?.regenerate || streaming() || stopping()) return;
    try {
      await requireAgent("regenerate");
      setMessages((current) => truncateForRegenerate(current, entryId));
      setGeneration("active");
      session.send({ type: "regenerate", entryId, model: models.model(), thinkingLevel: models.effort() });
    } catch (error) { setGeneration("idle"); onError(error); }
  };

  const continueResponse = async () => {
    if (streaming() || stopping()) return;
    try { await requireAgent("continue"); setGeneration("active"); session.send({ type: "continue" }); }
    catch (error) { setGeneration("idle"); onError(error); }
  };

  const compact = async () => {
    if (streaming() || compacting() || !capabilities()?.compaction) return;
    try { await requireAgent("compact"); session.send({ type: "compact" }); }
    catch (error) { onError(error); }
  };

  const loadHarnessCommands = async () => {
    const chatId = selectedId();
    if (!chatId || commandsLoadedFor === chatId) return;
    if (commandsLoading) return commandsLoading;
    commandsLoading = (async () => {
      const record = await requireAgent("open");
      if (!record || selectedId() !== chatId) return;
      const result = await api<{ commands: HarnessCommand[] }>(`/v0/live-sessions/${encodeURIComponent(record.id)}/commands`);
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

  const edit = (message: Message) => {
    const chatId = loadedId() ?? "";
    if (editingEntryId() === message.id) { setDraft(""); setEditingEntryId(null); attachments.restore([]); clearReviewComments(chatId); return; }
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

  // Messages the user sent while the agent was working, not yet taken by the
  // model. These are local and immediate, so the composer can show them without
  // waiting for the backend to echo its queue back.
  // What is still waiting comes from the backend's queue, not from guessing at
  // local state: it reports a message as queued when it takes it and drops it
  // when the model actually reads it, which is the moment the bubble should
  // clear. Pi sends queue_update; Codex sends thread/queue/changed.
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

  /**
   * Take the queued messages back off the backend, returning their text.
   *
   * Pi carries queued messages through an abort on purpose, so stopping without
   * clearing first would still deliver them. Its own Esc does clear-then-abort,
   * and so does this.
   */
  const takeQueued = () => {
    const text = pendingMessages().map((message) => message.content).filter(Boolean).join("\n");
    if (session.isOpen()) session.send({ type: "clear_queue" });
    setQueue({ steering: [], followUp: [] });
    return text;
  };

  /**
   * Interrupt the turn and send what is queued, as one server-side command.
   *
   * The sequence is clear_queue, abort, prompt, and it has to run in that
   * order: leaving the queue in place means the abort delivers it anyway, and
   * aborting during a tool call makes Pi fail that queued turn instantly and
   * empty. Sequencing it here - by waiting for the stop to land before
   * prompting - raced against the backend's terminal event, so the server owns
   * the whole sequence now and the client sends one message.
   */
  const interruptAndSend = () => {
    const prepared = prepareOutboundMessage();
    if (!pendingMessages().length && !prepared.hasContent) return void stop();
    // The server prompts with the queue it takes back plus this message, joined
    // the way interruptedPromptInput joins them, so the bubble says what the
    // model was actually asked.
    const interrupting = [...pendingMessages().map((message) => message.content), prepared.message]
      .map((text) => text.trim()).filter(Boolean).join("\n");
    // Pi accepts a steered message without saying which entry it becomes, so
    // unlike a prompt there is no id to reconcile against and nothing arrives
    // until the session file is read back. Without a bubble of its own the
    // message the interrupt sent is absent from the transcript until then --
    // for the whole of the response it asked for.
    const local: Message = { id: `user_${Date.now()}`, role: "user", content: interrupting,
      timestamp: new Date().toISOString(), attachments: prepared.sentAttachments };
    const previous = messages();
    setQueue({ steering: [], followUp: [] });
    setDraft("");
    setGeneration("submitting");
    try {
      session.send({ type: "interrupt_and_send", message: prepared.message, attachmentIds: prepared.attachmentIds,
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

  /** Put the queued text back in the composer so it can be reworded. */
  const editQueued = () => {
    const text = takeQueued();
    if (text) setDraft((current) => current ? `${current}\n${text}` : text);
  };

  const discardQueued = () => { takeQueued(); };

  const clearQueue = () => {
    const restored = pendingMessages().map((message) => message.content).filter(Boolean).join("\n");
    setQueue({ steering: [], followUp: [] });
    setMessages((current) => current.filter((message) => !message.pending));
    if (restored) setDraft((current) => current ? `${current}\n${restored}` : restored);
  };

  const activity = createMemo(() => {
    const process = options.runtime.getProcess(selectedId());
    const derived = deriveFineActivity({
      generation: generation(),
      processStatus: process?.status || (live() ? "running" : "none"),
      coarse: typeof process?.activity === "string" ? process.activity : process?.activity?.kind || "idle",
      thinking: thinking(),
      responding: responding(),
      toolName: activeToolName(),
      retry: retry(),
    });
    if (hostUiRequests().length) return { kind: "waiting_for_user", label: "Waiting for your confirmation" };
    if (derived.kind === "idle") {
      const lastAssistant = messages().findLast((message) => message.role === "assistant");
      if (lastAssistant?.stopReason === "error") {
        return { kind: "request_failed", label: "Request failed · Ready to retry" };
      }
    }
    // "starting" now means the harness itself is not ready yet -- the server
    // says so, and says when it stops being true -- so it is worth showing.
    return derived.kind === "starting" ? { kind: "starting", label: "Starting agent…" } : derived;
  });

  onCleanup(() => {
    transcriptPrefetches.clear();
    transcriptCache.clear();
    session.dispose();
  });

  return {
    status, setStatus, title, setTitle, templateId, setTemplateId, runtimeIdentity, setRuntimeIdentity, backendImplementation,
    live, messages, setMessages, tools, loadedId, pageBefore, loadingOlder, draft, setDraft,
    generation, editingEntryId, contextUsage, sessionStats, cacheStats, compacting, hostUiRequests, queue, pendingMessages, capabilities, harnessCommands, activeGeneration, activeGenerationChange, turnArtifacts,
    navigatingId, streaming, stopping, activity,
    initialize, select, prefetch, loadDetail, ensureAgent, reset, send, stop, regenerate,
    continueResponse, compact, loadHarnessCommands, loadOlder, edit, respondHostUi, clearQueue, interruptAndSend, editQueued, discardQueued,
  };
}

export type ActiveChatStore = ReturnType<typeof createActiveChat>;
