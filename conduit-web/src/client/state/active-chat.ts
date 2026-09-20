import { batch, createMemo, createSignal, onCleanup, untrack } from "solid-js";
import { deriveFineActivity } from "../../activity.js";
import { api, asList } from "../api/client";
import { createAgentSession } from "./agent-session";
import { webSocketUrl } from "../api/transport";
import { isFoldedTurnEvent, isStructuredGenerationEvent, normalizeLiveEvent } from "../api/live-events";
import type { FoldedTurnEvent, LiveEvent, RuntimeStateEvent, StructuredGenerationEvent, TurnArtifactSummary } from "../api/live-events";
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
import { applyToolOp, applyTranscriptOp, assignToolSeq, isToolOp, replaceMessages, truncateAt } from "../timeline-order";
import { getHarnessRecorder, recordHarnessMetric } from "../harness-metrics";
import type { UploadAttachment } from "./attachments";
import type { DraftsStore } from "./drafts";
import type { CatalogueStore } from "./catalogue";
import { type ActiveGenerationView, type LiveGenerationChange } from "../turn-rows";
import type { ModelSettings } from "./model-settings";
import type { PermissionSettings } from "./permission-settings";
import type { ServiceLevelSettings } from "./service-level-settings";
import type { RuntimeStore } from "./runtime";
import { createClientActiveGenerationStore } from "./active-generation-store.js";
import { markChatRead } from "./read-receipts";
import { clearReviewComments, parseReviewComments, projectReviewComments, restoreReviewComments, reviewComments } from "../chat/review-comments";

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

/** Mirrors the server's SPAWNING_INTENTS; see the note at its only use. */
const SPAWNING_INTENTS = new Set(["prompt", "continue", "compact", "regenerate", "steer"]);

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
  const [presentation, setPresentation] = createSignal<ChatPresentation>({ kind: "ready", chatId: null });
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
  const supports = (capability: keyof ChatCapabilities) => capabilities()?.[capability] !== false;
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
   * A chat's agent state is the server's to report: it publishes the process
   * when it spawns and again when the harness can answer, and both the sidebar
   * row and the composer read that one record through `activity`. A promise in
   * this client used to decide it instead, which is how "Starting agent…" came
   * to cover a catalogue fetch, outlast a warm attach, and mean nothing.
   *
   * The one thing the server cannot report is the stretch before it has heard
   * from us at all. `session.launching()` covers exactly that -- a launch
   * request in flight, nothing more -- and `activity` prefers anything the
   * server does say over it.
   */
  const [navigatingId, setNavigatingId] = createSignal<string | null>(null);
  let navigationRequest: Promise<void> | null = null;

  let currentGeneration: string | null = null;
  let stopPending = false;
  let selectionToken = 0;
  let navigationToken = 0;
  let liveOpening: LiveOpening | null = null;
  const transcriptPrefetches = new Map<string, {
    revision: string;
    expiresAt: number;
    request: Promise<TranscriptDetail>;
  }>();
  const transcriptCache = new Map<string, {
    revision: string;
    detail: TranscriptDetail;
  }>();

  // The runtime stream is the live-process authority. The catalogue carries a
  // point-in-time copy that can still say active after the process has settled.
  const chatIsLive = (chat: ChatSummary) => Boolean(options.runtime.getProcess(chat.id)?.active);
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
  // A stop is finished when the turn says it stopped, settled or is stopping.
  // `generation_failed` used to be in here and could never arrive: a failed
  // generation reaches the browser as `error`, which is not a structured
  // generation event and never reached this check.
  const STOP_TERMINAL_PHASES = new Set(["stopping", "stopped", "settled"]);

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
    onEvent: (data, chatId) => {
      try {
        const event = normalizeLiveEvent(JSON.parse(data));
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

  /**
   * Where this client is in the chat's order, and which order that is.
   *
   * The server numbers every event that changes what the transcript says, so a
   * hole in the numbers is a fact rather than something to be inferred from
   * messages that look duplicated or out of place. Seeing one, this asks to be
   * caught up from the last number it did see, and drops what arrived out of
   * order: the replay carries it again, in its place.
   */
  let logId: string | null = null;
  let logSeq = 0;

  const requestLogResume = () => {
    if (!logId || !session.isOpen()) return;
    // A failed send is not worth reporting: the socket is already closing, and
    // the reconnect asks the same question again.
    try { session.send({ type: "resume_log", logId, since: logSeq }); } catch { /* asked again on reconnect */ }
  };

  /**
   * Take the event's place in the order, and say whether to apply it.
   *
   * An unnumbered event -- a delta, runtime state, the queue -- is always
   * applied: it carries no position and losing one costs nothing the next
   * numbered event does not restate.
   */
  const acceptInOrder = (event: LiveEvent): boolean => {
    const stamp = (event as { log?: { id?: string; seq?: number } }).log;
    if (!stamp?.id || typeof stamp.seq !== "number") return true;
    if (stamp.id !== logId) { logId = stamp.id; logSeq = stamp.seq; return true; }
    // Already applied. The replay that answers a hole ends with events this
    // client had seen, and applying them twice is what it is being spared.
    if (stamp.seq <= logSeq) return false;
    if (stamp.seq > logSeq + 1) { requestLogResume(); return false; }
    logSeq = stamp.seq;
    return true;
  };

  const reset = (draftProfileId?: string) => {
    navigationToken += 1;
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
    stopPending = false;
    if (draftProfileId) {
      setStatus("draft");
      setTitle("");
      setTemplateId(draftProfileId);
      setRuntimeIdentity(null);
    }
  };

  /** The only client owner of assistant generation state and terminal handoff. */
  const applyGenerationEvent = (event: StructuredGenerationEvent | FoldedTurnEvent) => {
    if (stopPending && !(event.type === "status" && STOP_TERMINAL_PHASES.has(String(event.phase)))) return;
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
      result = generationStore.apply(event);
      if (result.changed && result.state) {
        const state = result.state as ActiveGenerationView;
        // The row this answer goes in already exists: the server opened it,
        // where it belongs, the moment the harness named the message. Nothing
        // here has a position to work out.
        setActiveGeneration(state);
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
      // Nothing is folded into the transcript here. The server has already said
      // what every message of this turn says, which rows to give up, and what
      // every tool it ran returned. Assembling a second answer to that out of
      // the deltas drawn on the way past is what used to race the harness's own
      // writes -- and what the reader saw as an answer changing after it
      // settled.
      batch(() => {
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
      setThinking(latest?.kind === "thinking" && latest.status === "streaming");
      setResponding(latest?.kind === "text" && latest.status === "streaming");
      const runningTool = Object.values(next.toolExecutions).find((tool) => tool.status === "running");
      setActiveToolName(runningTool?.name || null);
      setRetry((next as { retry?: RetryState | null }).retry || null);
    }
    if (next.status === "stopping") setGeneration("stopping");
    else if (next.status === "failed") setGeneration("failed")
    else if (next.status === "stopped") {
      stopPending = false;
      setGeneration("interrupted");
      if (event.type === "status" && event.phase === "stopped" && Boolean(event.processTerminated)) {
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
      setMessages((current) => (reconcile ? replaceMessages(current, incoming) : incoming));
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
    // A retry and a failure are part of the turn as well as the chat: they are
    // folded into the generation the same way the server folds them, and then
    // handled below for the things that are not the turn.
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
      case "session_checkpoint":
        // The socket is the one channel the open chat is guaranteed to have,
        // so the row it carries updates the catalogue exactly like the global
        // stream's does. Both feed one reducer; duplicates are free.
        if (event.chat) window.dispatchEvent(new CustomEvent("conduit:chat-changed", { detail: event.chat }));
        if (event.title && event.chatId === selectedId()) setTitle(event.title);
        if (event.chatId === selectedId()) {
          if (event.artifacts) setTurnArtifacts({ chatId: event.chatId, items: event.artifacts });
        }
        break;
      // The only sync left is the whole of what this chat should hold, sent to
      // a client that lost its place in the order and cannot be replayed back
      // into it. A window of the transcript says nothing this client was not
      // already told, message by message, as it happened.
      case "transcript_sync":
        if (!event.replace) break;
        batch(() => {
          setMessages((current) => replaceMessages(current, asList<Message>(event.messages)));
          setTools(assignToolSeq(event.tools as ToolItem[]));
        });
        break;
      // The server saying what the transcript is: a message exists and where,
      // a message is finished, a message is gone. This is the whole of how a
      // row gets its place -- nothing below works one out.
      case "transcript_op":
        if (isToolOp(event)) setTools((current) => applyToolOp(current, event));
        else setMessages((current) => applyTranscriptOp(current, event));
        break;
      // Where the chat's order stands. A client that was already here says how
      // far it got; one arriving fresh has just loaded the transcript and takes
      // the number as its own.
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
        // The fork says where the history ends now; this client holds whatever
        // of it it has loaded, and cuts to the same point. A regenerate ends it
        // after the prompt it is re-asking, which stays exactly where it is.
        if (event.beforeMessageId) setMessages((current) => truncateAt(current, event.beforeMessageId!, { inclusive: true }));
        else if (event.afterMessageId) setMessages((current) => truncateAt(current, event.afterMessageId!, { inclusive: false }));
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
          // The process is gone, so nothing is going to close the rows it left
          // open. A row with text keeps it -- it is what the reader watched
          // arrive -- and an empty one goes rather than sitting there as an
          // answer that never comes.
          setMessages((current) => current
            .filter((message) => !(message.streaming && !message.content))
            .map((message) => (message.streaming ? { ...message, streaming: false } : message)));
          generationStore.clear();
          setActiveGeneration(null);
          setActiveGenerationChange(null);
          currentGeneration = null;
          session.detach();
        }
        break;
      case "error":
        // A rejected command is not a failed turn. The scope says which this
        // is, rather than the browser reading it off two event names that only
        // one of the four harnesses ever distinguished.
        if (!stopPending) setGeneration(event.scope === "runtime" ? "failed" : "idle");
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
    // The server coalesces paint on its own timer and never merges across
    // blocks, so what arrives is already the batch. Applying it in arrival
    // order is the whole of the client's job.
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
    // Opening is reading, however it was reached -- a click, a pasted URL, the
    // back button, or re-entering after a profile switch.
    markChatRead(catalogue, chat);
    // An existing live process attaches before the scoped fetches below. Chat
    // selection is a document read and this attach-only request must not start
    // an agent. It takes its model from the transcript detail rather than from
    // the model store, which has not been told about this chat yet.
    if (entry.warm) {
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
    }
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
    setPresentation({ kind: "ready", chatId: chat.id });
    // The chat somebody asked for is on screen: navigation is done. Whether its
    // agent is warm is a separate question, answered in the sidebar by the
    // process itself.
    entry.onShown?.();
    await scopeReload;
  };

  /**
   * Enter a resident chat immediately, but do not expose a partial projection.
   *
   * The transcript read and the live attach are independent network paths. They
   * run together while the already-mounted transcript stays hidden. Live frames
   * are buffered until the persisted transcript is installed, then replayed in
   * order. The first runtime_state is the attach boundary: the server always
   * sends it after the optional generation_replay snapshot.
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
      if (navigationOptions.history === "push") history.pushState({}, "", `/chat/${chat.id}`);
      else if (navigationOptions.history === "replace") history.replaceState({}, "", `/chat/${chat.id}`);
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
    if (transcriptResult.kind === "error") {
      batch(() => {
        setPresentation({ kind: "live_error", chatId: chat.id });
        navigationOptions.onShown?.();
      });
      liveOpening = null;
      opening.resolve();
      throw transcriptResult.error;
    }
    let detail = transcriptResult.value;

    // The process can settle between the runtime-list click and the attach. A
    // second transcript read after that answer is the authoritative settled
    // state; there is no socket snapshot to wait for in this branch.
    if (attachResult.kind === "value" && !attachResult.value) detail = await fetchTranscript(chat);
    if (liveOpening !== opening || selection !== selectionToken || selectedId() !== chat.id) return;
    applyDetail(detail);
    // Each scope selects the target synchronously before its request yields.
    // Start it before reveal so no visible control belongs to the prior chat;
    // its network completion does not delay the transcript.
    const scopeReload = reconcileChatScope(chat, project, detail, true);
    opening.transcriptReady = true;
    for (const event of opening.events.splice(0)) consume(event);
    if (attachResult.kind === "error") onError(attachResult.error);
    else if (!attachResult.value) opening.socketReady = true;
    finishLiveOpening(opening);
    await shown;
    await scopeReload;
  };

  const performSelect = async (
    chat: ChatSummary,
    project: Project,
    navigationOptions: { history?: "push" | "replace" | "none"; onCommit?: () => void; onShown?: () => void } = {},
  ) => {
    if (chatIsLive(chat)) return performLiveSelect(chat, project, navigationOptions);
    const navigation = ++navigationToken;
    const cached = cachedTranscript(chat);
    const detail = cached || await loadTranscript(chat);
    if (chatIsLive(chat)) transcriptPrefetches.delete(chat.id);
    if (navigation !== navigationToken) return;
    await enterChat(chat, project, {
      detail,
      history: navigationOptions.history || "replace",
      warm: chatIsLive(chat),
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
   * It follows the same document rule as a click: show stored history without
   * starting an agent, and attach only when the runtime stream already reports
   * a live process.
   */
  const initialize = (chat: ChatSummary, project: Project, detail?: TranscriptDetail, entry: { warm?: boolean } = {}) =>
    enterChat(chat, project, {
      detail,
      history: "none",
      warm: entry.warm ?? chatIsLive(chat),
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

  /**
   * Name a message this client is sending, before sending it.
   *
   * The id travels with the prompt, so the harness's commit event comes back
   * carrying the same name and the row already on screen is that message
   * rather than a stand-in for it. Nothing has to be promoted, matched or
   * reconciled afterwards.
   */
  const newMessageId = () => `m_${crypto.randomUUID()}`;

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
    const messageId = newMessageId();
    const local: Message = { id: messageId, role: "user", content: prepared.message, timestamp: new Date().toISOString(), attachments: prepared.sentAttachments };

    if (busy) {
      // Sending while the agent works queues: the message reaches the model as
      // soon as the current tool call settles, rather than cutting the turn off
      // mid-thought. Cutting it off is the other button -- the one on the queued
      // bubble -- which takes these messages back and interrupts with them.
      // The id goes with it either way. A queued message the browser had not
      // named arrived in the transcript only when the session file was read
      // back, under an id derived from the entry, beside the copy the live turn
      // had already drawn: the same message, twice, until a reload.
      const queueMode = mode || (supports("steer") ? "steer" : "follow_up");
      setDraft("");
      try {
        await requireAgent("steer");
        session.send({ type: queueMode === "steer" ? "steer" : "follow_up", messageId, message: prepared.message, attachmentIds: prepared.attachmentIds });
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
        ? { type: "fork_and_prompt", entryId: editId, messageId, message: prepared.message, attachmentIds: prepared.attachmentIds, model: models.model(), thinkingLevel: models.effort() }
        : { type: "prompt", messageId, message: prepared.message, attachmentIds: prepared.attachmentIds });
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
    stopPending = true;
    setGeneration("stopping");
    session.sendWhenReady({ type: "stop_generation", generationId: currentGeneration });
  };

  const regenerate = async (entryId: string) => {
    if (!entryId || !supports("regenerate") || streaming() || stopping()) return;
    const previous = messages();
    if (!previous.some((message) => message.id === entryId)) return;
    // Show the answers going before the round trip. The prompt itself stays:
    // regenerate re-asks it, and the server restates it under the name this row
    // already has, so there is nothing here to take away and put back.
    setMessages(truncateAt(previous, entryId, { inclusive: false }));
    try {
      await requireAgent("regenerate");
      setMessages((current) => truncateAt(current, entryId, { inclusive: false }));
      setGeneration("active");
      session.send({ type: "regenerate", entryId, model: models.model(), thinkingLevel: models.effort() });
    } catch (error) { setMessages(previous); setGeneration("idle"); onError(error); }
  };

  const continueResponse = async () => {
    if (streaming() || stopping()) return;
    try { await requireAgent("continue"); setGeneration("active"); session.send({ type: "continue" }); }
    catch (error) { setGeneration("idle"); onError(error); }
  };

  const compact = async () => {
    if (streaming() || compacting() || !supports("compaction")) return;
    try { await requireAgent("compact"); session.send({ type: "compact" }); }
    catch (error) { onError(error); }
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
    const interruptId = newMessageId();
    const local: Message = { id: interruptId, role: "user", content: interrupting,
      timestamp: new Date().toISOString(), attachments: prepared.sentAttachments };
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
    const currentPresentation = presentation();
    if (currentPresentation.kind === "opening_live" && currentPresentation.chatId === selectedId()) {
      return { kind: "reconnecting", label: "Reconnecting…" };
    }
    if (currentPresentation.kind === "live_error" && currentPresentation.chatId === selectedId()) {
      return { kind: "runtime_failed", label: "Could not load chat" };
    }
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
    // We have asked for a process and the server has not answered yet, so it
    // has nothing to publish and the derived activity is idle by default. The
    // asking is worth showing: it is the whole of the gap between clicking a
    // chat and the spawn reaching the runtime stream, and the transcript has
    // already painted from cache by then. Anything the server does report wins,
    // because `derived` is consulted first.
    if (derived.kind === "idle" && !process && session.launching() === selectedId()) {
      return { kind: "starting", label: "Starting agent…" };
    }
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
    navigatingId, presentation, interactionReady: () => presentation().kind === "ready" && Boolean(loadedId()), streaming, stopping, activity,
    initialize, select, prefetch, loadDetail, ensureAgent, reset, send, stop, regenerate,
    continueResponse, compact, loadHarnessCommands, loadOlder, edit, respondHostUi, clearQueue, interruptAndSend, editQueued, discardQueued,
  };
}

export type ActiveChatStore = ReturnType<typeof createActiveChat>;
