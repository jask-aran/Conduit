import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import { deriveFineActivity } from "../../activity.js";
import { reduceActiveGeneration } from "../../active-generation.js";
import { api, asList } from "../api/client";
import { isStructuredGenerationEvent, normalizeLiveEvent } from "../api/live-events";
import type { LiveEvent, RuntimeStateEvent, StructuredGenerationEvent } from "../api/live-events";
import type {
  ChatStatus,
  ChatSummary,
  ContextUsage,
  GenerationState,
  HostUiRequest,
  LiveRecord,
  Message,
  Project,
  QueueState,
  RetryState,
  RuntimeIdentity,
  ToolItem,
  TranscriptDetail,
} from "../api/contracts";
import { assignToolSeq, promotePendingUser } from "../timeline-order";
import { reconcileMessages } from "../reconcile-messages";
import type { AttachmentsStore, UploadAttachment } from "./attachments";
import type { CatalogueStore } from "./catalogue";
import type { ActiveGenerationView } from "../turn-rows";
import type { ModelSettings } from "./model-settings";
import type { RuntimeStore } from "./runtime";

type UnknownRecord = Record<string, unknown>;
type ErrorHandler = (message: string) => void;

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
  const [title, setTitle] = createSignal("New chat");
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
  const [compacting, setCompacting] = createSignal(false);
  const [hostUiRequests, setHostUiRequests] = createSignal<HostUiRequest[]>([]);
  const [queue, setQueue] = createSignal<QueueState>({ steering: [], followUp: [] });
  const [thinking, setThinking] = createSignal(false);
  const [responding, setResponding] = createSignal(false);
  const [activeToolName, setActiveToolName] = createSignal<string | null>(null);
  const [retry, setRetry] = createSignal<RetryState | null>(null);
  const [activeGeneration, setActiveGeneration] = createSignal<ActiveGenerationView | null>(null);
  const [connectingId, setConnectingId] = createSignal<string | null>(null);
  let socket: WebSocket | null = null;
  let currentGeneration: string | null = null;
  let stopPending = false;
  let openToken = 0;
  let selectionToken = 0;
  let navigationToken = 0;

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

  const reset = () => {
    navigationToken += 1;
    selectionToken += 1;
    openToken += 1;
    setConnectingId(null);
    socket?.close();
    socket = null;
    setLive(null);
    setGeneration("idle");
    setDraft("");
    setEditingEntryId(null);
    setContextUsage(null);
    setLoadingOlder(false);
    setHostUiRequests([]);
    setQueue({ steering: [], followUp: [] });
    resetLiveFlags();
    setActiveGeneration(null);
    currentGeneration = null;
    stopPending = false;
  };

  const applyStructuredGeneration = (event: StructuredGenerationEvent) => {
    if (!live() || live()!.chatId !== selectedId()) return;
    const next = reduceActiveGeneration(activeGeneration(), event) as ActiveGenerationView | null;
    if (!next) return;
    setActiveGeneration(next);
    currentGeneration = next.id;
    const blocks = next.assistantMessages.flatMap((message) => message.blocks);
    const latest = blocks.at(-1);
    setThinking(latest?.type === "thinking" && latest.status === "streaming");
    setResponding(latest?.type === "text" && latest.status === "streaming");
    const runningTool = Object.values(next.toolExecutions).find((tool) => tool.status === "running");
    setActiveToolName(runningTool?.name || null);
    setRetry((next as { retry?: RetryState | null }).retry || null);
    if (next.status === "stopping") setGeneration("stopping");
    else if (next.status === "failed") setGeneration("failed");
    else if (["stopped", "complete"].includes(next.status)) {
      stopPending = false;
      setGeneration("idle");
      if (event.type === "generation_stopped" && Boolean(event.processTerminated)) {
        setLive(null);
        socket?.close();
      }
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
      setTitle(detail.title || "New chat");
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
    if (event.queue || session.queue) setQueue(event.queue || session.queue!);
    if (event.hostUiRequests || session.hostUiRequests) setHostUiRequests(event.hostUiRequests || session.hostUiRequests!);
    if (session.compacting != null) setCompacting(session.compacting);
    if (session.retry !== undefined) setRetry(session.retry);
    const turnOpen = Boolean(session.generation && !session.generation.closed && !session.generation.settled);
    if (session.stopping) setGeneration("stopping");
    else if (turnOpen || session.active) setGeneration("active");
    else setGeneration((current) => current === "stopping" ? current : "idle");
  };

  const connect = (record: LiveRecord, chatId: string, selection: number) => {
    socket?.close();
    const next = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${record.streamUrl || `/v0/live-sessions/${record.id}/stream`}`);
    socket = next;
    next.onmessage = ({ data }) => {
      if (socket !== next || selection !== selectionToken || selectedId() !== chatId) return;
      try {
        const event = normalizeLiveEvent(JSON.parse(String(data)));
        consume(event);
      } catch (error) { onError((error as Error).message); }
    };
    next.addEventListener("close", () => { if (socket === next) socket = null; });
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

  function consume(event: LiveEvent) {
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
          if (current && ["stopped", "complete", "failed"].includes(current.status)) {
            const selection = selectionToken;
            void api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(event.chatId)}`).then((detail) => {
              if (selection !== selectionToken || event.chatId !== selectedId()) return;
              batch(() => {
                applyDetail(detail, true);
                setActiveGeneration(null);
              });
            }).catch((error) => onError((error as Error).message));
          } else void loadDetail(event.chatId, true).catch((error) => onError((error as Error).message));
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
        onError(event.message || (event.code === "generation_limit" ? "Too many concurrent generations. Wait for another chat to finish." : "Runtime error"));
        break;
      case "unknown":
        break;
    }
  }

  const select = async (chat: ChatSummary, project: Project) => {
    // Load first, commit once: failed or superseded navigation leaves the
    // current chat, URL, socket, and selection intact.
    const navigation = ++navigationToken;
    const detail = await api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(chat.id)}`);
    if (navigation !== navigationToken) return;
    reset();
    const selection = selectionToken;
    catalogue.select(chat, project);
    history.replaceState({}, "", `/chat/${chat.id}`);
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
      } catch (error) { setMessages((current) => current.filter((item) => item.id !== local.id)); setDraft(text); onError((error as Error).message); }
      return;
    }

    if (!live() || live()!.chatId !== selectedId() || socket?.readyState !== WebSocket.OPEN) {
      setGeneration("submitting");
      try { await ensureLive("prompt"); } catch (error) { setGeneration("idle"); onError((error as Error).message); return; }
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
      onError((error as Error).message);
    }
  };

  const stop = () => {
    if (!streaming()) return;
    stopPending = true;
    setGeneration("stopping");
    socket?.send(JSON.stringify({ type: "stop_generation", generationId: currentGeneration }));
  };

  const regenerate = async (entryId: string) => {
    if (!entryId || streaming() || stopping()) return;
    try {
      await ensureLive();
      setMessages((current) => { const index = current.findIndex((item) => item.id === entryId); return index >= 0 ? current.slice(0, index + 1) : current; });
      setGeneration("active");
      socket!.send(JSON.stringify({ type: "regenerate", entryId, model: models.model(), thinkingLevel: models.effort() }));
    } catch (error) { setGeneration("idle"); onError((error as Error).message); }
  };

  const continueResponse = async () => {
    if (streaming() || stopping()) return;
    try { await ensureLive(); setGeneration("active"); socket!.send(JSON.stringify({ type: "continue" })); }
    catch (error) { setGeneration("idle"); onError((error as Error).message); }
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
      if (selection === selectionToken && selectedId() === chatId) onError((error as Error).message);
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
    return derived.kind === "starting" ? { kind: "idle", label: null } : derived;
  });

  onCleanup(() => socket?.close());

  return {
    status, setStatus, title, setTitle, templateId, setTemplateId, runtimeIdentity, setRuntimeIdentity,
    live, messages, setMessages, tools, loadedId, pageBefore, loadingOlder, draft, setDraft,
    generation, editingEntryId, contextUsage, compacting, hostUiRequests, queue, activeGeneration,
    connectingId, streaming, stopping, activity,
    initialize, select, loadDetail, openLive, ensureLive, reset, send, stop, regenerate,
    continueResponse, loadOlder, edit, respondHostUi, clearQueue,
  };
}

export type ActiveChatStore = ReturnType<typeof createActiveChat>;
