import { batch, createMemo, createSignal, onCleanup } from "solid-js";
import { deriveFineActivity, normalizeHostUiRequest } from "../../activity.js";
import { api, asList } from "../api/client";
import type {
  ChatStatus,
  ChatSummary,
  ContextUsage,
  GenerationState,
  HostUiRequest,
  LiveEvent,
  LiveRecord,
  Message,
  Project,
  QueueState,
  RetryState,
  RuntimeIdentity,
  ToolItem,
  TranscriptDetail,
} from "../api/contracts";
import { assignToolSeq, maxToolSeq, mergeToolEvent, promotePendingUser } from "../timeline-order.js";
import { reconcileMessages } from "../reconcile-messages.js";
import type { AttachmentsStore, UploadAttachment } from "./attachments";
import type { CatalogueStore } from "./catalogue";
import { createLiveStream } from "./live-stream";
import type { ModelSettings } from "./model-settings";
import type { RuntimeStore } from "./runtime";

type UnknownRecord = Record<string, unknown>;
type ErrorHandler = (message: string) => void;
const fineActivity = deriveFineActivity as (input: {
  generation: string;
  processStatus: string;
  coarse: string;
  thinking: boolean;
  responding: boolean;
  toolName: string | null;
  retry: RetryState | null;
}) => { kind: string; label: string | null };

interface ActiveChatOptions {
  catalogue: CatalogueStore;
  runtime: RuntimeStore;
  models: ModelSettings;
  attachments: AttachmentsStore;
  onError: ErrorHandler;
  defaultTemplateId: () => string;
  saveWorkspaceDefault: (workspaceId: string, templateId: string | null) => Promise<unknown>;
}

function lastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index]!)) return index;
  return -1;
}

function eventRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? value as UnknownRecord : {};
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
  const [reasoning, setReasoning] = createSignal({ content: "", active: false, redacted: false });
  const [connectingId, setConnectingId] = createSignal<string | null>(null);
  const liveStream = createLiveStream();
  let socket: WebSocket | null = null;
  let currentGeneration: string | null = null;
  let stopPending = false;
  let continuation = false;
  let openToken = 0;
  let toolSeq = 0;
  const closedGenerations = new Set<string>();

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
    setReasoning({ content: "", active: false, redacted: false });
  };

  const reset = () => {
    openToken += 1;
    setConnectingId(null);
    socket?.close();
    socket = null;
    setLive(null);
    setGeneration("idle");
    setDraft("");
    setEditingEntryId(null);
    setContextUsage(null);
    setHostUiRequests([]);
    setQueue({ steering: [], followUp: [] });
    resetLiveFlags();
    liveStream.clear();
    currentGeneration = null;
    stopPending = false;
    continuation = false;
    toolSeq = 0;
  };

  const applyDetail = (detail: TranscriptDetail, reconcile = false) => {
    const incoming = asList<Message>(detail.messages);
    const nextTools = assignToolSeq(asList<ToolItem>(detail.tools)) as ToolItem[];
    toolSeq = maxToolSeq(nextTools) + 1;
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

  const loadDetail = async (chatId: string, reconcile = false) => {
    const detail = await api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(chatId)}`);
    if (selectedId() === chatId) applyDetail(detail, reconcile);
    return detail;
  };

  const applySnapshot = (event: UnknownRecord) => {
    const session = eventRecord(event.session);
    if (event.contextUsage || session.contextUsage) setContextUsage((event.contextUsage || session.contextUsage) as ContextUsage);
    if (event.queue || session.queue) setQueue((event.queue || session.queue) as QueueState);
    const requests = event.hostUiRequests || session.hostUiRequests;
    if (requests) setHostUiRequests(asList<HostUiRequest>(requests));
    if (session.compacting != null) setCompacting(Boolean(session.compacting));
    if (session.retry !== undefined) setRetry(session.retry as RetryState | null);
    const turn = eventRecord(session.generation);
    const turnOpen = Boolean(Object.keys(turn).length && !turn.closed && !turn.settled);
    if (session.stopping) setGeneration("stopping");
    else if (turnOpen || session.active) setGeneration("active");
    else setGeneration((current) => current === "stopping" ? current : "idle");
  };

  const connect = (record: LiveRecord) => {
    socket?.close();
    const next = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${record.streamUrl || `/v0/live-sessions/${record.id}/stream`}`);
    socket = next;
    next.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(String(data)) as LiveEvent;
        if (event.type === "runtime_snapshot") {
          const session = eventRecord(event.session);
          const turn = eventRecord(session.generation);
          if (turn.id && !turn.closed) currentGeneration = String(turn.id);
          applySnapshot(event);
          if ((Object.keys(turn).length && !turn.closed && !turn.settled) || session.active) {
            asList<LiveEvent>(event.events).forEach(consume);
          }
          const stream = eventRecord(event.stream);
          if (stream.generationId && !turn.closed) liveStream.setSnapshot(String(stream.generationId), String(stream.content || ""));
        } else consume(event);
      } catch (error) { onError((error as Error).message); }
    };
    next.addEventListener("close", () => { if (socket === next) socket = null; });
  };

  const openLive = async (chatId: string, ownerProjectId: string, launch: UnknownRecord = {}): Promise<LiveRecord | null> => {
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
      if (token !== openToken || selectedId() !== chatId) return null;
      setLive(record);
      if (record.runtime) setRuntimeIdentity(record.runtime);
      if (record.contextUsage) setContextUsage(record.contextUsage);
      connect(record);
      await new Promise<void>((resolve, reject) => {
        const current = socket;
        if (!current) return reject(new Error("Could not connect to Pi"));
        if (current.readyState === WebSocket.OPEN) return resolve();
        current.addEventListener("open", () => resolve(), { once: true });
        current.addEventListener("error", () => reject(new Error("Pi is starting or the live stream failed. Try again.")), { once: true });
      });
      if (token !== openToken || selectedId() !== chatId) return null;
      await models.reloadChat(chatId);
      return record;
    } catch (error) {
      if (token !== openToken || selectedId() !== chatId) return null;
      const detail = error as Error & { error?: string };
      const project = catalogue.projects().find((item) => item.id === ownerProjectId);
      const hostFailed = !hostFallback && runtimeIdentity()?.kind === "native_pi" && project?.defaultTemplateId === "host-pi"
        && !["live_process_limit", "generation_limit"].includes(detail.error || "");
      if (hostFailed && project) {
        await options.saveWorkspaceDefault(project.id, null);
        const fallback = options.defaultTemplateId() || "chat";
        const chat = await api<ChatSummary>(`/v0/chats/${encodeURIComponent(chatId)}`, {
          method: "PATCH",
          body: JSON.stringify({ templateId: fallback, runtimeKind: "conduit_profile" }),
        });
        setTemplateId(chat.templateId || fallback);
        setRuntimeIdentity(chat.runtime || null);
        await models.reloadChat(chatId);
        return openLive(chatId, ownerProjectId, { intent, hostFallback: true, modelOverride: "", thinkingOverride: "" });
      }
      throw error;
    } finally { if (token === openToken) setConnectingId(null); }
  };

  const ensureLive = async (intent = "open") => {
    if (live() && socket?.readyState === WebSocket.OPEN) return live()!;
    const chatId = selectedId();
    if (!chatId) throw new Error("Chat is not ready yet");
    const record = await openLive(chatId, projectId(), { intent });
    if (!record) throw new Error("Chat switched before Pi was ready");
    return record;
  };

  function consume(raw: LiveEvent) {
    const event = raw as UnknownRecord;
    const type = String(event.type || "");
    const eventGeneration = event.generationId ? String(event.generationId) : null;
    if (eventGeneration && closedGenerations.has(eventGeneration) && !["generation_stopped", "generation_started"].includes(type)) return;
    if (stopPending && ["message_start", "assistant_stream_delta", "assistant_stream_final"].includes(type)) return;

    if (type === "generation_started") {
      currentGeneration = eventGeneration;
      stopPending = false;
      setGeneration("active");
      resetLiveFlags();
      if (eventGeneration) liveStream.start(eventGeneration);
      if (event.continuation) {
        continuation = true;
        setMessages((current) => {
          const copy = [...current];
          const index = lastIndex(copy, (message) => message.role === "assistant" && Boolean(message.stopped));
          if (index >= 0) copy[index] = { ...copy[index]!, stopped: false, status: null, continuing: true };
          return copy;
        });
      }
    }
    if (type === "agent_start") setGeneration((current) => current === "stopping" ? current : "active");
    if (["agent_end", "agent_settled"].includes(type) && !event.willRetry && !stopPending) {
      setGeneration((current) => current === "stopping" ? current : "idle");
      resetLiveFlags();
    }
    if (type === "runtime_exit") { setGeneration("idle"); resetLiveFlags(); setLive(null); }
    if (type === "runtime_state") applySnapshot(event);
    if (type === "context_usage" && event.contextUsage) setContextUsage(event.contextUsage as ContextUsage);
    if (type === "compaction_start") setCompacting(true);
    if (type === "compaction_end") setCompacting(false);
    if (type === "auto_retry_start") {
      setRetry({ attempt: Number(event.attempt), maxAttempts: Number(event.maxAttempts), delayMs: Number(event.delayMs), errorMessage: String(event.errorMessage || "") || null });
      setGeneration((current) => current === "stopping" ? current : "active");
    }
    if (type === "auto_retry_end") setRetry(null);
    if (type === "queue_update") setQueue({ steering: asList(event.steering), followUp: asList(event.followUp) });
    if (type === "extension_ui_request") {
      const request = normalizeHostUiRequest(event) as HostUiRequest | null;
      if (request) setHostUiRequests((current) => current.some((item) => item.id === request.id) ? current : [...current, request]);
    }
    if (type === "extension_ui_resolved") {
      const requestId = String(event.requestId || event.id || "");
      setHostUiRequests((current) => current.filter((item) => item.id !== requestId));
    }
    if (type === "generation_stopped") {
      stopPending = false;
      setGeneration("idle");
      resetLiveFlags();
      setMessages((current) => {
        const copy = [...current];
        const index = lastIndex(copy, (message) => message.role === "assistant");
        if (index >= 0) copy[index] = { ...copy[index]!, stopped: true, status: "stopped" };
        return copy;
      });
      if (event.processTerminated) { setLive(null); socket?.close(); }
    }
    if (type === "session_checkpoint") {
      void catalogue.refresh();
      const chat = eventRecord(event.chat);
      if (chat.id === selectedId()) void loadDetail(String(chat.id), true);
    }
    const eventMessage = eventRecord(event.message);
    if (type === "message_start" && eventMessage.role === "assistant" && !continuation) {
      setMessages((current) => [...current, { id: `live_${Date.now()}`, role: "assistant", content: "", timestamp: new Date().toISOString() }]);
    }
    const delta = eventRecord(event.assistantMessageEvent);
    if (type === "message_update" && Object.keys(delta).length) {
      if (delta.type === "thinking_start") { setThinking(true); setResponding(false); setReasoning((current) => ({ ...current, active: true })); }
      if (delta.type === "thinking_delta") { setThinking(true); setReasoning((current) => ({ ...current, active: true, content: current.content + String(delta.delta || "") })); }
      if (delta.type === "thinking_end") { setThinking(false); setReasoning((current) => ({ ...current, active: false, content: String(delta.content || current.content) })); }
      if (["text_start", "text_delta"].includes(String(delta.type))) { setResponding(true); setThinking(false); }
      if (delta.type === "text_end") setResponding(false);
    }
    if (type === "assistant_stream_delta" && eventGeneration) { setResponding(true); liveStream.append(eventGeneration, String(event.delta || "")); }
    if (type === "assistant_stream_final") {
      continuation = false;
      setResponding(false);
      setThinking(false);
      setMessages((current) => {
        const copy = [...current];
        const index = lastIndex(copy, (message) => message.role === "assistant");
        const final: Partial<Message> = { content: String(event.content || ""), stopped: false, continuing: false };
        if (index >= 0) copy[index] = { ...copy[index]!, ...final };
        else copy.push({ id: `end_${Date.now()}`, role: "assistant", ...final });
        return copy;
      });
      liveStream.clear();
    }
    if (type === "message_end" && eventMessage.role === "user") {
      void catalogue.refresh();
      setMessages((current) => promotePendingUser(current, eventMessage) as Message[]);
    }
    if (type === "tool_execution_start") {
      setActiveToolName(String(event.toolName || "tool"));
      setTools((current) => (mergeToolEvent(current, event, { nextSeq: () => toolSeq++ }).tools as ToolItem[]));
    }
    if (type === "tool_execution_update") setTools((current) => mergeToolEvent(current, event).tools as ToolItem[]);
    if (type === "tool_execution_end") {
      setActiveToolName(null);
      setTools((current) => mergeToolEvent(current, { ...event, done: true }).tools as ToolItem[]);
    }
    if (["runtime_error", "client_error"].includes(type)) {
      if (!stopPending) setGeneration(type === "runtime_error" ? "failed" : "idle");
      resetLiveFlags();
      if (event.code === "generation_limit") {
        setMessages((current) => {
          const last = current.at(-1);
          if (last?.role === "user" && last.id.startsWith("user_")) { setDraft((value) => value || last.content || ""); return current.slice(0, -1); }
          return current;
        });
      }
      onError(String(event.message || (event.code === "generation_limit" ? "Too many concurrent generations. Wait for another chat to finish." : "Runtime error")));
    }
  }

  const select = async (chat: ChatSummary, project: Project) => {
    reset();
    catalogue.select(chat, project);
    setStatus(chat.status);
    setTitle(chat.title);
    setTemplateId(chat.templateId || options.defaultTemplateId() || "chat");
    setRuntimeIdentity(chat.runtime || null);
    history.replaceState({}, "", `/chat/${chat.id}`);
    models.select(project.id, chat.id);
    void attachments.select(chat.id);
    const detail = await loadDetail(chat.id);
    if (detail.status === "active") await openLive(chat.id, project.id);
  };

  const initialize = (chat: ChatSummary, project: Project, detail?: TranscriptDetail) => {
    catalogue.select(chat, project);
    setStatus(chat.status);
    setTitle(chat.title);
    setTemplateId(chat.templateId || options.defaultTemplateId() || "chat");
    setRuntimeIdentity(chat.runtime || null);
    models.select(project.id, chat.id);
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

    if (!live() || socket?.readyState !== WebSocket.OPEN) {
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
        ? { type: "fork_and_prompt", entryId: editId, message: text, attachmentIds }
        : { type: "prompt", message: text, attachmentIds }));
      setStatus("active");
      setGeneration("active");
      setEditingEntryId(null);
    } catch (error) {
      setMessages(previous);
      setEditingEntryId(editId);
      attachments.restore(sentAttachments);
      setDraft(text);
      setGeneration("idle");
      onError((error as Error).message);
    }
  };

  const stop = () => {
    if (!streaming()) return;
    if (currentGeneration) closedGenerations.add(currentGeneration);
    liveStream.flush();
    stopPending = true;
    setGeneration("stopping");
    setMessages((current) => {
      const copy = [...current];
      const index = lastIndex(copy, (message) => message.role === "assistant");
      if (index >= 0) copy[index] = { ...copy[index]!, content: `${copy[index]!.content || ""}${liveStream.content()}`, stopped: true, status: "stopping" };
      return copy;
    });
    socket?.send(JSON.stringify({ type: "stop_generation", generationId: currentGeneration }));
  };

  const regenerate = async (entryId: string) => {
    if (!entryId || streaming() || stopping()) return;
    try {
      await ensureLive();
      setMessages((current) => { const index = current.findIndex((item) => item.id === entryId); return index >= 0 ? current.slice(0, index + 1) : current; });
      setGeneration("active");
      socket!.send(JSON.stringify({ type: "regenerate", entryId }));
    } catch (error) { setGeneration("idle"); onError((error as Error).message); }
  };

  const continueResponse = async () => {
    if (streaming() || stopping()) return;
    try { await ensureLive(); setGeneration("active"); socket!.send(JSON.stringify({ type: "continue" })); }
    catch (error) { setGeneration("idle"); onError((error as Error).message); }
  };

  const loadOlder = async () => {
    if (!selectedId() || !pageBefore() || loadingOlder()) return;
    setLoadingOlder(true);
    try {
      const detail = await api<TranscriptDetail>(`/v0/sessions/${selectedId()}?before=${encodeURIComponent(pageBefore()!)}`);
      setMessages((current) => [...asList<Message>(detail.messages), ...current]);
      setTools((current) => [...assignToolSeq(asList<ToolItem>(detail.tools)), ...current] as ToolItem[]);
      setPageBefore(detail.page?.before || null);
    } catch (error) { onError((error as Error).message); }
    finally { setLoadingOlder(false); }
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
    const derived = fineActivity({
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
    generation, editingEntryId, contextUsage, compacting, hostUiRequests, queue, reasoning,
    connectingId, streaming, stopping, liveStream, activity,
    initialize, select, loadDetail, openLive, ensureLive, reset, send, stop, regenerate,
    continueResponse, loadOlder, edit, respondHostUi, clearQueue,
  };
}

export type ActiveChatStore = ReturnType<typeof createActiveChat>;
