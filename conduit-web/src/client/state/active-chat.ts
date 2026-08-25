import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import { deriveFineActivity } from "../../activity.js";
import { api, asList } from "../api/client";
import { webSocketUrl } from "../api/transport";
import { isStructuredGenerationEvent, normalizeLiveEvent } from "../api/live-events";
import type { LiveEvent, RuntimeStateEvent, StructuredGenerationEvent } from "../api/live-events";
import type {
  ChatStatus,
  ChatSummary,
  CacheStats,
  ContextUsage,
  GenerationState,
  HostUiRequest,
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
import { assignToolSeq, promotePendingUser } from "../timeline-order";
import { reconcileMessages } from "../reconcile-messages";
import { getHarnessRecorder, recordHarnessMetric } from "../harness-metrics";
import { canCoalesceTextDelta, enqueueOverflowLiveEvent, mergeTextDeltaEvents } from "./text-delta-batcher";
import type { AttachmentsStore, UploadAttachment } from "./attachments";
import type { CatalogueStore } from "./catalogue";
import type { ActiveGenerationView, LiveGenerationChange } from "../turn-rows";
import type { ModelSettings } from "./model-settings";
import type { RuntimeStore } from "./runtime";
import { createClientActiveGenerationStore } from "./active-generation-store.js";

type UnknownRecord = Record<string, unknown>;
type ErrorHandler = (error: unknown) => void;

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

interface ActiveChatOptions {
  catalogue: CatalogueStore;
  runtime: RuntimeStore;
  models: ModelSettings;
  attachments: AttachmentsStore;
  onError: ErrorHandler;
  defaultTemplateId: () => string;
  saveWorkspaceDefault: (workspaceId: string, templateId: string | null) => Promise<unknown>;
}

export function createActiveChat(options: ActiveChatOptions) {
  const { catalogue, models, attachments, onError } = options;
  const [status, setStatus] = createSignal<ChatStatus>("draft");
  const [title, setTitle] = createSignal("");
  const [templateId, setTemplateId] = createSignal<string | null>(null);
  const [runtimeIdentity, setRuntimeIdentity] = createSignal<RuntimeIdentity | null>(null);
  const [live, setLive] = createSignal<LiveRecord | null>(null);
  const [messages, setMessages] = createSignal<Message[]>([]);
  const [tools, setTools] = createSignal<ToolItem[]>([]);
  const [loadedId, setLoadedId] = createSignal<string | null>(null);
  const [pageBefore, setPageBefore] = createSignal<string | null>(null);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [generation, setGeneration] = createSignal<GenerationState>("idle");
  const [editingEntryId, setEditingEntryId] = createSignal<string | null>(null);
  const [contextUsage, setContextUsage] = createSignal<ContextUsage | null>(null);
  const [sessionStats, setSessionStats] = createSignal<SessionStats | null>(null);
  const [cacheStats, setCacheStats] = createSignal<CacheStats | null>(null);
  const [compacting, setCompacting] = createSignal(false);
  const [hostUiRequests, setHostUiRequests] = createSignal<HostUiRequest[]>([]);
  const [queue, setQueue] = createSignal<QueueState>({ steering: [], followUp: [] });
  const [thinking, setThinking] = createSignal(false);
  const [responding, setResponding] = createSignal(false);
  const [activeToolName, setActiveToolName] = createSignal<string | null>(null);
  const [retry, setRetry] = createSignal<RetryState | null>(null);
  const [activeGenerationRoot, setActiveGenerationRoot] = createSignal<ActiveGenerationView | null>(null);
  const [activeGenerationRevision, setActiveGenerationRevision] = createSignal(0);
  const [activeGenerationChange, setActiveGenerationChange] = createSignal<LiveGenerationChange | null>(null);
  const activeGeneration = () => {
    activeGenerationRevision();
    return activeGenerationRoot();
  };
  const setActiveGeneration = (next: ActiveGenerationView | null) => {
    setActiveGenerationRoot(next);
    setActiveGenerationRevision((revision) => revision + 1);
  };
  const generationStore = createClientActiveGenerationStore();
  const [connectingId, setConnectingId] = createSignal<string | null>(null);
  let socket: WebSocket | null = null;
  let currentGeneration: string | null = null;
  let stopPending = false;
  let openToken = 0;
  let selectionToken = 0;
  let navigationToken = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let reconnectToken = 0;
  let pendingTextDelta: StructuredGenerationEvent | null = null;
  let pendingTextDeltaTimer: ReturnType<typeof setTimeout> | null = null;
  let overflowLiveEvents: LiveEvent[] = [];
  let overflowLiveEventFrame: number | null = null;
  let overflowLiveEventTimer: ReturnType<typeof setTimeout> | null = null;
  let overflowMode = false;
  const OVERFLOW_FRAME_BUDGET_MS = 6;
  const OVERFLOW_MAX_EVENTS_PER_FRAME = 32;
  const STOP_TERMINAL_EVENT_TYPES = new Set(["generation_stopping", "generation_stopped", "generation_settled", "generation_failed"]);

  const selectedId = catalogue.selectedId;
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

  const cancelReconnect = () => {
    reconnectToken += 1;
    reconnectAttempts = 0;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
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
    if (pending) applyStructuredGeneration(pending);
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
    openToken += 1;
    cancelReconnect();
    setConnectingId(null);
    socket?.close();
    socket = null;
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
    resetLiveFlags();
    clearPendingLiveEvents();
    generationStore.clear();
    setActiveGenerationChange(null);
    setActiveGeneration(null);
    currentGeneration = null;
    stopPending = false;
  };

  const applyStructuredGeneration = (event: StructuredGenerationEvent) => {
    if (stopPending && !STOP_TERMINAL_EVENT_TYPES.has(event.type)) return;
    if (!live() || live()!.chatId !== selectedId()) return;
    const previous = activeGeneration();
    const recorder = getHarnessRecorder();
    const reduceStartedAt = recorder ? performance.now() : 0;
    let result: ReturnType<typeof generationStore.apply> | undefined;
    batch(() => {
      result = generationStore.apply(event);
      if (result.changed && result.state) {
        setActiveGeneration(result.state as ActiveGenerationView);
        setActiveGenerationChange(generationChangeFor(event));
      }
    });
    if (!result) return;
    const next = result.state as ActiveGenerationView | null;
    if (!next) return;
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
    const terminal = ["stopped", "complete", "failed"].includes(next.status);
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
    else if (next.status === "failed") setGeneration("failed");
    else if (next.status === "stopped") {
      stopPending = false;
      setGeneration("interrupted");
      if (event.type === "generation_stopped" && Boolean(event.processTerminated)) {
        setLive(null);
        cancelReconnect();
        socket?.close();
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
      if (detail.templateId) setTemplateId(detail.templateId);
      if (detail.runtime) setRuntimeIdentity(detail.runtime);
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
    const turnOpen = Boolean(session.generation && !session.generation.closed && !session.generation.settled);
    if (session.stopping) setGeneration("stopping");
    else if (turnOpen || session.active) setGeneration("active");
    else setGeneration((current) => ["stopping", "interrupted"].includes(current) ? current : "idle");
  };

  const scheduleReconnect = (record: LiveRecord, chatId: string, selection: number) => {
    if (reconnectTimer || selection !== selectionToken || selectedId() !== chatId) return;
    const token = reconnectToken;
    const delay = Math.min(250 * 2 ** Math.min(reconnectAttempts, 5), 8_000);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (token !== reconnectToken || selection !== selectionToken || selectedId() !== chatId) return;
      try {
        await openLive(chatId, projectId(), { intent: "open" }, selection);
        reconnectAttempts = 0;
      } catch {
        if (token === reconnectToken) scheduleReconnect(record, chatId, selection);
      }
    }, delay);
  };

  const connect = (record: LiveRecord, chatId: string, selection: number) => {
    cancelReconnect();
    socket?.close();
    const next = new WebSocket(webSocketUrl(record.streamUrl || `/v0/live-sessions/${record.id}/stream`));
    socket = next;
    next.onmessage = ({ data }) => {
      if (socket !== next || selection !== selectionToken || selectedId() !== chatId) return;
      try {
        const event = normalizeLiveEvent(JSON.parse(String(data)));
        consume(event);
      } catch (error) { onError(error); }
    };
    next.addEventListener("close", () => {
      if (socket !== next) return;
      socket = null;
      scheduleReconnect(record, chatId, selection);
    });
  };

  const openLive = async (chatId: string, ownerProjectId: string, launch: UnknownRecord = {}, selection = selectionToken): Promise<LiveRecord | null> => {
    if (selection !== selectionToken || selectedId() !== chatId) return null;
    const token = ++openToken;
    setConnectingId(chatId);
    const intent = String(launch.intent || "open");
    const hostFallback = Boolean(launch.hostFallback);
    try {
      const record = await api<LiveRecord>("/v0/live-sessions", {
        method: "POST",
        body: JSON.stringify({
          chatId,
          projectId: ownerProjectId,
          model: launch.modelOverride ?? models.model(),
          thinkingLevel: launch.thinkingOverride ?? models.effort(),
          intent,
        }),
      });
      if (token !== openToken || selection !== selectionToken || selectedId() !== chatId) return null;
      setLive(record);
      if (record.runtime) setRuntimeIdentity(record.runtime);
      if (record.contextUsage) setContextUsage(record.contextUsage);
      if (record.sessionStats) setSessionStats(record.sessionStats);
      if (record.cacheStats) setCacheStats(record.cacheStats);
      connect(record, chatId, selection);
      await new Promise<void>((resolve, reject) => {
        const current = socket;
        if (!current) return reject(new Error("Could not connect to Pi"));
        if (current.readyState === WebSocket.OPEN) return resolve();
        current.addEventListener("open", () => resolve(), { once: true });
        current.addEventListener("error", () => reject(new Error("Pi is starting or the live stream failed. Try again.")), { once: true });
      });
      if (token !== openToken || selection !== selectionToken || selectedId() !== chatId) return null;
      await models.reloadChat(chatId);
      const refreshedProjects = await catalogue.refresh();
      if (token !== openToken || selection !== selectionToken || selectedId() !== chatId) return null;
      const refreshed = refreshedProjects.flatMap((project) => project.sessions).find((chat) => chat.id === chatId);
      if (refreshed) setTitle(refreshed.title);
      return record;
    } catch (error) {
      if (token !== openToken || selection !== selectionToken || selectedId() !== chatId) return null;
      const detail = error as Error & { error?: string };
      const project = catalogue.projects().find((item) => item.id === ownerProjectId);
      const hostFailed = !hostFallback && runtimeIdentity()?.kind === "native_pi" && project?.defaultTemplateId === "host-pi"
        && !["live_process_limit", "generation_limit"].includes(detail.error || "");
      if (hostFailed && project) {
        await options.saveWorkspaceDefault(project.id, null);
        if (token !== openToken || selection !== selectionToken || selectedId() !== chatId) return null;
        const fallback = options.defaultTemplateId() || "chat";
        const chat = await api<ChatSummary>(`/v0/chats/${encodeURIComponent(chatId)}`, {
          method: "PATCH",
          body: JSON.stringify({ templateId: fallback, runtimeKind: "conduit_profile" }),
        });
        if (token !== openToken || selection !== selectionToken || selectedId() !== chatId) return null;
        setTemplateId(chat.templateId || fallback);
        setRuntimeIdentity(chat.runtime || null);
        return openLive(chatId, ownerProjectId, { intent, hostFallback: true, modelOverride: "", thinkingOverride: "" }, selection);
      }
      throw error;
    } finally { if (token === openToken) setConnectingId(null); }
  };

  const ensureLive = async (intent = "open") => {
    if (live() && live()!.chatId === selectedId() && socket?.readyState === WebSocket.OPEN) return live()!;
    const chatId = selectedId();
    if (!chatId) throw new Error("Chat is not ready yet");
    const selection = selectionToken;
    const record = await openLive(chatId, projectId(), { intent }, selection);
    if (!record) throw new Error("Chat switched before Pi was ready");
    return record;
  };

  const resumeLive = () => {
    if (document.visibilityState === "hidden") return;
    const record = live();
    const chatId = selectedId();
    if (record && chatId && record.chatId === chatId) connect(record, chatId, selectionToken);
  };
  const restoreLive = (event: PageTransitionEvent) => {
    if (event.persisted) resumeLive();
  };
  document.addEventListener("visibilitychange", resumeLive);
  window.addEventListener("pageshow", restoreLive);
  window.addEventListener("online", resumeLive);

  function applyLiveEvent(event: LiveEvent) {
    if (isStructuredGenerationEvent(event)) {
      applyStructuredGeneration(event);
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
        if (event.title) {
          catalogue.patchChat(event.chatId, { title: event.title });
          if (event.chatId === selectedId()) setTitle(event.title);
        }
        void catalogue.refresh();
        if (event.chatId === selectedId()) {
          const current = activeGeneration();
          const terminal = current && ["stopped", "complete", "failed"].includes(current.status);
          if (terminal && current.id === event.generationId
            && (event.generationSeq == null || current.lastSeq >= event.generationSeq)) {
            const selection = selectionToken;
            const checkpointGenerationId = event.generationId;
            const checkpointGenerationSeq = event.generationSeq;
            queueMicrotask(() => {
              void api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(event.chatId)}`, { cache: "no-store" }).then((detail) => {
                if (selection !== selectionToken || event.chatId !== selectedId()) return;
                const matching = activeGeneration();
                if (!matching || matching.id !== checkpointGenerationId
                  || !["stopped", "complete", "failed"].includes(matching.status)
                  || (checkpointGenerationSeq != null && matching.lastSeq < checkpointGenerationSeq)) return;
                const liveProviderError = matching.status === "failed"
                  && matching.assistantMessages.some((message) => message.stopReason === "error");
                const persistedProviderError = asList<Message>(detail.messages)
                  .some((message) => message.role === "assistant" && message.stopReason === "error");
                batch(() => {
                  applyDetail(detail, true);
                  if (liveProviderError && !persistedProviderError) return;
                  generationStore.clear();
                  setActiveGenerationChange(null);
                  setActiveGeneration(null);
                });
              }).catch((error) => onError(error));
            });
          } else if (!current) void loadDetail(event.chatId, true).catch((error) => onError(error));
        }
        break;
      case "message_end":
        if (event.message.role === "user") {
          void catalogue.refresh();
          setMessages((current) => promotePendingUser(current, event.message));
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

  const select = async (
    chat: ChatSummary,
    project: Project,
    navigationOptions: { history?: "push" | "replace" | "none"; onCommit?: () => void } = {},
  ) => {
    // Load first, commit once: failed or superseded navigation leaves the
    // current chat, URL, socket, and selection intact.
    const navigation = ++navigationToken;
    const detail = await api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(chat.id)}`);
    if (navigation !== navigationToken) return;
    reset();
    const selection = selectionToken;
    const historyMode = navigationOptions.history || "replace";
    batch(() => {
      catalogue.select(chat, project);
      if (historyMode === "push") history.pushState({}, "", `/chat/${chat.id}`);
      else if (historyMode === "replace") history.replaceState({}, "", `/chat/${chat.id}`);
      navigationOptions.onCommit?.();
    });
    models.select(project.id, chat.id, detail, { reloadChat: detail.status !== "active" });
    void attachments.select(chat.id);
    applyDetail(detail);
    if (detail.status === "active") await openLive(chat.id, project.id, {}, selection);
  };

  const initialize = (chat: ChatSummary, project: Project, detail?: TranscriptDetail) => {
    // Drop any previous chat's live socket/record first: send() reuses an open
    // socket without re-checking ownership, so a stale stream would carry this
    // chat's prompts into the previous chat's Pi process.
    reset();
    catalogue.select(chat, project);
    setStatus(chat.status);
    setTitle(chat.title);
    setTemplateId(chat.templateId || options.defaultTemplateId() || "chat");
    setRuntimeIdentity(chat.runtime || null);
    models.select(project.id, chat.id, detail, { reloadChat: (detail?.status || chat.status) !== "active" });
    void attachments.select(chat.id);
    if (detail) applyDetail(detail);
    else { setMessages([]); setTools([]); setPageBefore(null); setLoadedId(chat.id); }
  };

  const send = async (mode?: "steer" | "follow_up") => {
    if (generation() === "stopping") return;
    if (options.runtime.connectivity() !== "online") return onError("Server unavailable");
    const text = draft().trim();
    if (!text) return;
    const attachmentIds = attachments.pendingIds();
    const sentAttachments = attachments.items().filter((item) => attachmentIds.includes(item.id)).map(({ id, name, size, type, objectUrl }) => ({ id, name, size, type, objectUrl }));
    const busy = streaming();
    const local: Message = { id: `user_${Date.now()}`, role: "user", content: text, timestamp: new Date().toISOString(), attachments: sentAttachments };

    if (busy) {
      const queueMode = mode === "steer" ? "steer" : "follow_up";
      local.pending = true;
      local.queueMode = queueMode;
      setDraft("");
      setMessages((current) => [...current, local]);
      try {
        await ensureLive();
        socket!.send(JSON.stringify({ type: queueMode === "steer" ? "steer" : "follow_up", message: text, attachmentIds }));
        attachments.markAnnounced(attachmentIds);
      } catch (error) { setMessages((current) => current.filter((item) => item.id !== local.id)); setDraft(text); onError(error); }
      return;
    }

    if (!live() || live()!.chatId !== selectedId() || socket?.readyState !== WebSocket.OPEN) {
      setGeneration("submitting");
      try { await ensureLive("prompt"); } catch (error) { setGeneration("idle"); onError(error); return; }
    }

    const previous = messages();
    const editId = editingEntryId();
    setDraft("");
    setMessages((current) => {
      if (!editId) return [...current, local];
      const index = current.findIndex((item) => item.id === editId);
      return index >= 0 ? [...current.slice(0, index), local] : [...current, local];
    });
    attachments.markAnnounced(attachmentIds);
    setGeneration("submitting");
    try {
      socket!.send(JSON.stringify(editId
        ? { type: "fork_and_prompt", entryId: editId, message: text, attachmentIds, model: models.model(), thinkingLevel: models.effort() }
        : { type: "prompt", message: text, attachmentIds }));
      setStatus("active");
      setGeneration("active");
      setEditingEntryId(null);
    } catch (error) {
      setMessages(previous);
      setEditingEntryId(editId);
      attachments.restoreDraft(sentAttachments);
      setDraft(text);
      setGeneration("idle");
      onError(error);
    }
  };

  const stop = () => {
    if (!streaming()) return;
    flushPendingTextDelta();
    stopPending = true;
    setGeneration("stopping");
    const command = JSON.stringify({ type: "stop_generation", generationId: currentGeneration });
    if (socket?.readyState === WebSocket.OPEN) socket.send(command);
    else void ensureLive("open").then(() => socket?.send(command)).catch((error) => onError(error));
  };

  const regenerate = async (entryId: string) => {
    if (!entryId || streaming() || stopping()) return;
    try {
      await ensureLive();
      setMessages((current) => { const index = current.findIndex((item) => item.id === entryId); return index >= 0 ? current.slice(0, index + 1) : current; });
      setGeneration("active");
      socket!.send(JSON.stringify({ type: "regenerate", entryId, model: models.model(), thinkingLevel: models.effort() }));
    } catch (error) { setGeneration("idle"); onError(error); }
  };

  const continueResponse = async () => {
    if (streaming() || stopping()) return;
    try { await ensureLive(); setGeneration("active"); socket!.send(JSON.stringify({ type: "continue" })); }
    catch (error) { setGeneration("idle"); onError(error); }
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
    if (editingEntryId() === message.id) { setDraft(""); setEditingEntryId(null); attachments.restore([]); return; }
    setDraft(message.content || "");
    setEditingEntryId(message.id);
    attachments.restore(message.attachments || []);
  };

  const respondHostUi = (response: UnknownRecord) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return onError("Not connected to the live session");
    socket.send(JSON.stringify({ type: "extension_ui_response", ...response }));
    setHostUiRequests((current) => current.filter((item) => item.id !== response.id));
  };

  const clearQueue = () => {
    const restored = [...queue().steering, ...queue().followUp].map(String).join("\n");
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
      const lastAssistant = [...messages()].reverse().find((message) => message.role === "assistant");
      if (lastAssistant?.stopReason === "error") {
        return { kind: "request_failed", label: "Request failed · Ready to retry" };
      }
    }
    return derived.kind === "starting" ? { kind: "idle", label: null } : derived;
  });

  onCleanup(() => {
    cancelReconnect();
    socket?.close();
    document.removeEventListener("visibilitychange", resumeLive);
    window.removeEventListener("pageshow", restoreLive);
    window.removeEventListener("online", resumeLive);
  });

  return {
    status, setStatus, title, setTitle, templateId, setTemplateId, runtimeIdentity, setRuntimeIdentity,
    live, messages, setMessages, tools, loadedId, pageBefore, loadingOlder, draft, setDraft,
    generation, editingEntryId, contextUsage, sessionStats, cacheStats, compacting, hostUiRequests, queue, activeGeneration, activeGenerationChange,
    connectingId, streaming, stopping, activity,
    initialize, select, loadDetail, openLive, ensureLive, reset, send, stop, regenerate,
    continueResponse, loadOlder, edit, respondHostUi, clearQueue,
  };
}

export type ActiveChatStore = ReturnType<typeof createActiveChat>;
