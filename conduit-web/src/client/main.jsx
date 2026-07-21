import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ShareIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Meteors } from "@/components/ui/meteors";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { deriveFineActivity } from "../activity.js";
import { AppSidebar } from "./app-sidebar";
import { ChatComposer } from "./chat-composer";
import { ChatDropOverlay, useChatDrop } from "./chat-drop-overlay";
import { ChatThread } from "./chat-thread";
import {
  failInteractiveRequest,
  markInteractiveRequestSubmitting,
  mergeInteractiveRequestSnapshot,
  normalizeInteractiveRequest,
  resolveInteractiveRequest,
} from "./interactive-request-state";
import { createLiveStreamStore } from "./live-stream-store";
import { createInitialReasoningState, reduceReasoningState } from "./reasoning-state";
import { reconcileMessages } from "./reconcile-messages";
import { useGlobalRuntime } from "./runtime/use-global-runtime";
import { useAttachments } from "./use-attachments";
import { useModelSettings } from "./use-model-settings";
import {
  assignToolSeq,
  maxToolSeq,
  mergeToolEvent,
  promotePendingUser,
} from "./timeline-order";
import "./styles.css";

const CommandMenu = lazy(() => import("./command-menu").then((module) => ({ default: module.CommandMenu })));
const SettingsDialog = lazy(() => import("./settings-dialog").then((module) => ({ default: module.SettingsDialog })));

const api = async (url, options) => {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
  if (response.status === 401 && (url.startsWith("/v0/") || url.startsWith("/"))) {
    location.href = "/login";
  }
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw Object.assign(new Error(body.message || body.error || "Request failed"), body);
  return body;
};
const list = (value) => Array.isArray(value) ? value : [];
const findLastMessage = (items, predicate) => {
  for (let index = items.length - 1; index >= 0; index -= 1) if (predicate(items[index])) return index;
  return -1;
};
const pathChatId = () => location.pathname.match(/^\/chat\/([a-zA-Z0-9_-]{8,128})$/)?.[1] || null;

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, details) { console.error("Conduit UI crashed", error, details); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="crash-screen">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Conduit hit a UI error</CardTitle><CardDescription>The interface could not continue.</CardDescription></CardHeader>
        <CardContent><Alert variant="destructive"><TriangleAlertIcon /><AlertTitle>Unexpected error</AlertTitle><AlertDescription>{this.state.error.message || "Unknown interface error"}</AlertDescription></Alert></CardContent>
        <CardFooter><Button onClick={() => location.reload()}>Reload Conduit</Button></CardFooter>
      </Card>
    </div>;
  }
}

function ChatHeader({ project, title, profile, runtime, live, attentionCount = 0 }) {
  const projectLabel = project?.slug === "chat" ? "Chats" : project?.slug || project?.name || "Chats";
  const profileLabel = runtime?.kind === "native_pi" ? null : profile?.label || profile?.id || null;
  const hostTrustLabel = live?.trustPosture === "native_saved_trust"
    ? "project resources trusted"
    : "project trust pending";
  const posture = runtime?.kind === "native_pi"
    ? hostTrustLabel
    : profile?.posture || (Array.isArray(profile?.tools) ? profile.tools.join(" / ") : "");
  const workspaceHint = project?.origin === "linked"
    ? "linked"
    : project?.origin === "cloned"
      ? "cloned"
      : project?.slug === "chat"
        ? null
        : "folder";
  const runtimeLabel = runtime?.kind === "native_pi" ? "Host Pi" : "Isolated Pi";
  const runtimeVersion = live?.binaryVersion || runtime?.binaryVersion;
  const postureLine = [runtimeLabel, runtimeVersion ? `Pi ${runtimeVersion}` : null, profileLabel, projectLabel !== "Chats" ? projectLabel : null, posture]
    .filter(Boolean).join(" · ");
  return <header className="chat-header">
    <SidebarTrigger className="-ml-1" />
    {title && <Breadcrumb className="chat-header-title">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem><span className="truncate">{projectLabel}</span></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem className="min-w-0"><BreadcrumbPage className="truncate font-semibold">{title}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>}
    {attentionCount > 0 && <span className="chat-attention" role="status">
      {attentionCount} {attentionCount === 1 ? "question" : "questions"} waiting
    </span>}
    {postureLine && <span
      className={`chat-profile-posture text-muted-foreground truncate text-xs${attentionCount ? "" : " ml-auto"}`}
      title={[
        postureLine,
        project?.path ? `cwd: ${project.path}` : null,
        live?.sessionFile ? `session: ${live.sessionFile}` : null,
        runtime?.binaryVersion && live?.binaryVersion && runtime.binaryVersion !== live.binaryVersion
          ? `created with Pi ${runtime.binaryVersion}; launched with Pi ${live.binaryVersion}`
          : null,
        live?.trustPosture ? `trust: ${live.trustPosture}` : null,
        workspaceHint,
      ].filter(Boolean).join("\n")}
    >
      {postureLine}
    </span>}
    <Button variant="ghost" size="icon-sm" className={postureLine || attentionCount ? "" : "ml-auto"} aria-label="Share chat"><ShareIcon /></Button>
  </header>;
}

function App() {
  const globalRuntime = useGlobalRuntime();
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("project_chat");
  const [selectedId, setSelectedId] = useState(null);
  const [chatStatus, setChatStatus] = useState("draft");
  const [chatTitle, setChatTitle] = useState("New chat");
  const [live, setLive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [tools, setTools] = useState([]);
  const [loadedSessionId, setLoadedSessionId] = useState(null);
  const [pageBefore, setPageBefore] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [generation, setGeneration] = useState("idle");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState("models");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandPage, setCommandPage] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [workspaceSuggestions, setWorkspaceSuggestions] = useState([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState("chat");
  const [chatTemplateId, setChatTemplateId] = useState(null);
  const [chatRuntime, setChatRuntime] = useState(null);
  const [installations, setInstallations] = useState([]);
  const [commandLaunchNonce, setCommandLaunchNonce] = useState(0);
  const [sidebarCommand, setSidebarCommand] = useState(null);
  const [editEntryId, setEditEntryId] = useState(null);
  const [partialContinue, setPartialContinue] = useState(true);
  const [contextUsage, setContextUsage] = useState(null);
  const [compacting, setCompacting] = useState(false);
  const [interactiveRequests, setInteractiveRequests] = useState([]);
  const [commands, setCommands] = useState([]);
  const [queue, setQueue] = useState({ steering: [], followUp: [] });
  const [thinking, setThinking] = useState(false);
  const [responding, setResponding] = useState(false);
  const [activeToolName, setActiveToolName] = useState(null);
  const [retry, setRetry] = useState(null);
  const [reasoning, setReasoning] = useState(createInitialReasoningState);
  const ws = useRef(null);
  const reasoningRef = useRef(null);
  const currentGeneration = useRef(null);
  const closedGenerations = useRef(new Set());
  const stopPending = useRef(false);
  const continuation = useRef(null);
  const liveStream = useRef(null);
  const toolSeq = useRef(0);
  const requestSeq = useRef(0);
  const openLiveToken = useRef(0);
  const [connectingChatId, setConnectingChatId] = useState(null);
  const selectedIdRef = useRef(null);
  const chatRuntimeRef = useRef(chatRuntime);
  selectedIdRef.current = selectedId;
  chatRuntimeRef.current = chatRuntime;
  if (!liveStream.current) liveStream.current = createLiveStreamStore();

  const streaming = generation === "active" || generation === "submitting";
  const stopping = generation === "stopping";
  const serverOnline = globalRuntime.connectivity === "online";
  const getProcess = useCallback((chatId) => {
    const process = globalRuntime.getProcess(chatId);
    // Only show starting while connect is in flight if no resident process is already live.
    if (chatId && chatId === connectingChatId && process?.status !== "running") {
      return {
        ...(process || { chatId }),
        status: "starting",
        activity: "starting",
        active: false,
      };
    }
    return process;
  }, [connectingChatId, globalRuntime.getProcess]);
  const selectedProcess = getProcess(selectedId);

  const showError = useCallback((message) => setError(message), []);
  useEffect(() => {
    if (!error) return;
    toast.error(error);
    setError("");
  }, [error]);
  const modelSettings = useModelSettings(projectId, selectedId, { onError: showError });
  const attachmentState = useAttachments(selectedId, showError);
  const drop = useChatDrop(attachmentState.addFiles);

  const refresh = useCallback(async () => {
    const payload = await api("/v0/projects");
    const next = list(payload.projects).map((project) => ({ ...project, sessions: list(project.sessions) }));
    setProjects(next);
    const selected = next.flatMap((project) => project.sessions).find((chat) => chat.id === selectedIdRef.current);
    if (selected) {
      setChatTitle(selected.title);
      setChatStatus(selected.status);
      if (selected.runtime) setChatRuntime(selected.runtime);
    }
    return next;
  }, []);

  const loadDetail = useCallback(async (chatId, { reconcile = false } = {}) => {
    const detail = await api(`/v0/sessions/${encodeURIComponent(chatId)}`);
    if (selectedIdRef.current !== chatId) return detail;
    const incoming = list(detail.messages);
    if (reconcile) setMessages((current) => reconcileMessages(current, incoming));
    else setMessages(incoming);
    const nextTools = assignToolSeq(list(detail.tools));
    setTools(nextTools);
    setCommands(list(detail.commands));
    toolSeq.current = maxToolSeq(nextTools) + 1;
    setPageBefore(detail.page?.before || null);
    setChatStatus(detail.status || "draft");
    setChatTitle(detail.title || "New chat");
    if (detail.templateId) setChatTemplateId(detail.templateId);
    if (detail.runtime) setChatRuntime(detail.runtime);
    setLoadedSessionId(chatId);
    return detail;
  }, []);

  function resetLiveUiFlags() {
    setThinking(false);
    setResponding(false);
    setActiveToolName(null);
    setRetry(null);
    setCompacting(false);
  }

  function applySnapshotExtras(event) {
    if (event.contextUsage) setContextUsage(event.contextUsage);
    else if (event.session?.contextUsage) setContextUsage(event.session.contextUsage);
    if (event.queue) setQueue(event.queue);
    else if (event.session?.queue) setQueue(event.session.queue);
    const requests = event.interactiveRequests
      || event.session?.interactiveRequests
      || event.hostUiRequests
      || event.session?.hostUiRequests;
    if (requests) setInteractiveRequests((current) => mergeInteractiveRequestSnapshot(current, list(requests)));
    if (event.session?.compacting != null) setCompacting(Boolean(event.session.compacting));
    if (event.session?.retry) setRetry(event.session.retry);
    const gen = event.session?.generation;
    const turnOpen = Boolean(gen && !gen.closed && !gen.settled);
    if (event.session?.stopping) {
      setGeneration("stopping");
    } else if (turnOpen || event.session?.active) {
      setGeneration("active");
    } else {
      setGeneration((current) => (current === "stopping" ? current : "idle"));
    }
  }

  function connect(record) {
    ws.current?.close();
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${record.streamUrl || `/v0/live-sessions/${record.id}/stream`}`);
    ws.current = socket;
    socket.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data);
        if (event.type === "runtime_snapshot") {
          const generationInfo = event.session?.generation;
          if (generationInfo?.id && !generationInfo.closed) currentGeneration.current = generationInfo.id;
          applySnapshotExtras(event);
          const snapGen = event.session?.generation;
          const turnOpen = Boolean(snapGen && !snapGen.closed && !snapGen.settled);
          if (turnOpen || event.session?.active) list(event.events).forEach((item) => consume(item, record.id));
          if (event.stream?.generationId && !event.session?.generation?.closed) {
            liveStream.current.setSnapshot(event.stream.generationId, event.stream.content);
          }
        } else consume(event, record.id);
      } catch (caught) { setError(caught.message); }
    };
    socket.onerror = () => {
      // Global connectivity handles server-wide offline; keep chat-local noise low.
    };
    socket.addEventListener("close", () => {
      if (ws.current === socket) ws.current = null;
    });
  }

  async function openLive(chatId, owningProjectId, options = {}) {
    const {
      intent = "open",
      hostFallback = false,
      modelOverride,
      thinkingOverride,
      ...launchOptions
    } = options;
    const token = ++openLiveToken.current;
    setConnectingChatId(chatId);
    try {
      const record = await api("/v0/live-sessions", {
        method: "POST",
        body: JSON.stringify({
          chatId,
          projectId: owningProjectId,
          model: modelOverride ?? modelSettings.model,
          thinkingLevel: thinkingOverride ?? modelSettings.effort,
          ...launchOptions,
        }),
      });
      if (token !== openLiveToken.current || selectedIdRef.current !== chatId) return null;
      setLive(record);
      setCommands(list(record.commands));
      if (record.runtime) setChatRuntime(record.runtime);
      if (record.contextUsage) setContextUsage(record.contextUsage);
      connect(record);
      await new Promise((resolve, reject) => {
        const socket = ws.current;
        if (!socket) {
          reject(new Error("Could not connect to Pi"));
          return;
        }
        if (socket.readyState === WebSocket.OPEN) {
          resolve();
          return;
        }
        const onOpen = () => resolve();
        const onError = () => reject(new Error("Pi is starting or the live stream failed. Try again."));
        socket.addEventListener("open", onOpen, { once: true });
        socket.addEventListener("error", onError, { once: true });
      });
      if (token !== openLiveToken.current || selectedIdRef.current !== chatId) return null;
      await modelSettings.reloadChat();
      return record;
    } catch (caught) {
      if (token !== openLiveToken.current || selectedIdRef.current !== chatId) return null;
      const owningProject = projects.find((project) => project.id === owningProjectId);
      const hostDefaultFailed = !hostFallback
        && chatRuntimeRef.current?.kind === "native_pi"
        && owningProject?.defaultTemplateId === "host-pi"
        && !["live_process_limit", "generation_limit"].includes(caught.error);
      if (hostDefaultFailed) {
        await saveWorkspaceDefault(owningProject.id, null);
        const fallbackTemplateId = defaultTemplateId || "chat";
        const fallbackChat = await api(`/v0/chats/${encodeURIComponent(chatId)}`, {
          method: "PATCH",
          body: JSON.stringify({ templateId: fallbackTemplateId, runtimeKind: "conduit_profile" }),
        });
        setChatTemplateId(fallbackChat.templateId || fallbackTemplateId);
        setChatRuntime(fallbackChat.runtime || null);
        await modelSettings.reloadChat();
        return openLive(chatId, owningProjectId, {
          intent,
          hostFallback: true,
          modelOverride: "",
          thinkingOverride: "",
        });
      }
      if (caught.message?.includes("Too many live Pi") || caught.message?.includes("live_process_limit")) {
        throw new Error(caught.message || "Too many live Pi processes. Wait for idle chats to free up.");
      }
      throw caught;
    } finally {
      if (token === openLiveToken.current) setConnectingChatId(null);
    }
  }

  useEffect(() => {
    let active = true;
    Promise.all([
      api("/v0/projects"),
      api("/v0/capabilities").catch(() => ({ partialContinue: true })),
      api("/v0/templates").catch(() => ({ templates: [], defaultTemplateId: "chat" })),
      api("/v0/workspaces/suggestions").catch(() => ({ folders: [] })),
      api("/v0/pi-installations").catch(() => ({ installations: [] })),
    ])
      .then(async ([payload, capabilities, templateCatalog, workspaceCatalog, installationCatalog]) => {
        if (!active) return;
        const nextProjects = list(payload.projects).map((project) => ({ ...project, sessions: list(project.sessions) }));
        setProjects(nextProjects);
        setPartialContinue(capabilities.partialContinue !== false);
        setTemplates(list(templateCatalog.templates));
        setWorkspaceSuggestions(list(workspaceCatalog.folders));
        setInstallations(list(installationCatalog.installations));
        setDefaultTemplateId(templateCatalog.defaultTemplateId || "chat");
        const routeId = pathChatId();
        if (routeId) {
          const chat = await api(`/v0/chats/${encodeURIComponent(routeId)}`);
          if (!active) return;
          selectedIdRef.current = chat.id;
          setSelectedId(chat.id); setProjectId(chat.projectId); setChatStatus(chat.status); setChatTitle(chat.title);
          setChatTemplateId(chat.templateId || templateCatalog.defaultTemplateId || "chat");
          setChatRuntime(chat.runtime || null);
          await loadDetail(chat.id);
          if (chat.status === "active") await openLive(chat.id, chat.projectId);
          return;
        }
        const project = nextProjects.find((item) => item.slug === "chat") || nextProjects[0];
        if (!project) throw new Error("Conduit has no chat project");
        const chat = await api("/v0/chats", {
          method: "POST",
          body: JSON.stringify({
            projectId: project.id,
            templateId: templateCatalog.defaultTemplateId || "chat",
          }),
        });
        if (!active) return;
        history.replaceState({}, "", `/chat/${chat.id}`);
        selectedIdRef.current = chat.id;
        setSelectedId(chat.id); setProjectId(chat.projectId); setChatStatus(chat.status); setChatTitle(chat.title);
        setChatTemplateId(chat.templateId || templateCatalog.defaultTemplateId || "chat");
        setChatRuntime(chat.runtime || null);
        setMessages([]); setTools([]); setPageBefore(null); setLoadedSessionId(chat.id);
      })
      .catch((caught) => active && setError(caught.message));
    return () => { active = false; ws.current?.close(); };
  }, []);

  useEffect(() => {
    const openPalette = (page = null) => {
      setCommandPage(page);
      setCommandLaunchNonce(Date.now());
      setCommandOpen(true);
    };
    const onKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === "k" && !event.shiftKey) {
        event.preventDefault();
        setCommandOpen((open) => {
          if (open) setCommandPage(null);
          return !open;
        });
        return;
      }
      // ⌘⇧O — open palette in Go to mode (avoid ⌘O / ⌘P browser chrome).
      if (key === "o" && event.shiftKey) {
        event.preventDefault();
        openPalette("goto");
        return;
      }
      // ⌘⇧C — new chat (⌘N is new-window in browsers).
      if (key === "c" && event.shiftKey) {
        event.preventDefault();
        requestNewChat();
        return;
      }
      if (key === ",") {
        event.preventDefault();
        setSettingsSection("profiles");
        setSettingsOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [projects, projectId]);

  function consume(event, liveId = "") {
    if (event.generationId && closedGenerations.current.has(event.generationId)
      && !["generation_stopped", "generation_started"].includes(event.type)) return;
    if (stopPending.current && ["message_start", "assistant_stream_delta", "assistant_stream_final"].includes(event.type)) return;

    if (event.generationId) {
      const nextReasoning = reduceReasoningState(reasoningRef.current, event);
      reasoningRef.current = nextReasoning;
      setReasoning(nextReasoning);
    }

    if (event.type === "generation_started") {
      currentGeneration.current = event.generationId;
      stopPending.current = false;
      setGeneration("active");
      resetLiveUiFlags();
      liveStream.current.start(event.generationId);
      if (event.continuation) {
        continuation.current = true;
        setMessages((current) => {
          const copy = [...current];
          const index = findLastMessage(copy, (message) => message.role === "assistant" && message.stopped);
          if (index >= 0) {
            copy[index] = { ...copy[index], html: null, stopped: false, status: null, continuing: true };
          }
          return copy;
        });
      }
    }
    if (event.type === "agent_start") {
      setGeneration((current) => (current === "stopping" ? current : "active"));
    }
    if (event.type === "agent_end") {
      if (event.willRetry) {
        // Keep active until auto_retry resolves; do not clear the turn yet.
      } else if (!stopPending.current) {
        setGeneration((current) => (current === "stopping" ? current : "idle"));
        resetLiveUiFlags();
      }
    }
    if (event.type === "agent_settled") {
      if (!stopPending.current) {
        setGeneration((current) => (current === "stopping" ? current : "idle"));
        resetLiveUiFlags();
      }
    }
    if (event.type === "runtime_exit") {
      setGeneration("idle");
      resetLiveUiFlags();
      setLive(null);
    }
    if (event.type === "runtime_state" && event.session) {
      if (event.session.contextUsage) setContextUsage(event.session.contextUsage);
      if (event.session.queue) setQueue(event.session.queue);
      if (event.session.interactiveRequests || event.session.hostUiRequests) {
        setInteractiveRequests((current) => mergeInteractiveRequestSnapshot(
          current,
          list(event.session.interactiveRequests || event.session.hostUiRequests),
        ));
      }
      if (event.session.compacting != null) setCompacting(Boolean(event.session.compacting));
      if (event.session.retry !== undefined) setRetry(event.session.retry);
      // Prefer Conduit generation lifecycle. Clear only when the generation is
      // missing/closed/settled — not when active is briefly false mid-turn.
      if (event.session.stopping) setGeneration("stopping");
      else {
        const gen = event.session.generation;
        const turnOpen = Boolean(gen && !gen.closed && !gen.settled);
        if (!turnOpen && !stopPending.current) {
          setGeneration((current) => (current === "stopping" ? current : "idle"));
          resetLiveUiFlags();
        } else if (turnOpen) {
          setGeneration((current) => (current === "stopping" ? current : "active"));
        }
      }
    }
    if (event.type === "context_usage" && event.contextUsage) {
      setContextUsage(event.contextUsage);
    }
    if (event.type === "compaction_start") setCompacting(true);
    if (event.type === "compaction_end") setCompacting(false);
    if (event.type === "auto_retry_start") {
      setRetry({
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage || null,
      });
      setGeneration((current) => (current === "stopping" ? current : "active"));
    }
    if (event.type === "auto_retry_end") setRetry(null);
    if (event.type === "queue_update") {
      setQueue({
        steering: list(event.steering),
        followUp: list(event.followUp),
      });
    }
    if (event.type === "extension_ui_request") {
      const request = normalizeInteractiveRequest(event, {
        timestamp: event.timestamp || new Date().toISOString(),
        seq: requestSeq.current++,
      });
      if (request) setInteractiveRequests((current) => mergeInteractiveRequestSnapshot(current, [request]));
    }
    if (event.type === "extension_ui_resolved") {
      const requestId = event.requestId || event.id;
      setInteractiveRequests((current) => resolveInteractiveRequest(current, requestId, event));
    }
    if (event.type === "generation_stopped") {
      stopPending.current = false;
      setGeneration("idle");
      resetLiveUiFlags();
      setMessages((current) => {
        const copy = [...current];
        const index = findLastMessage(copy, (message) => message.role === "assistant");
        if (index >= 0) copy[index] = { ...copy[index], stopped: true, status: "stopped" };
        return copy;
      });
      if (event.processTerminated) { setLive(null); ws.current?.close(); }
    }
    if (event.type === "session_checkpoint") {
      refresh().catch(() => {});
      if (event.chat?.id === selectedIdRef.current) loadDetail(event.chat.id, { reconcile: true }).catch(() => {});
    }
    if (event.type === "message_start" && event.message?.role === "assistant" && !continuation.current) {
      setMessages((current) => [...current, { id: `live_${Date.now()}`, role: "assistant", content: "", timestamp: new Date().toISOString() }]);
    }
    const delta = event.assistantMessageEvent;
    if (event.type === "message_update" && delta) {
      if (delta.type === "thinking_start" || delta.type === "thinking_delta") {
        setThinking(true);
        setResponding(false);
      }
      if (delta.type === "thinking_end") setThinking(false);
      if (delta.type === "text_start" || delta.type === "text_delta") {
        setResponding(true);
        setThinking(false);
      }
      if (delta.type === "text_end") setResponding(false);
    }
    if (event.type === "assistant_stream_delta") {
      setResponding(true);
      liveStream.current.append(event.generationId, event.delta || "");
    }
    if (event.type === "assistant_stream_final") {
      continuation.current = null;
      setResponding(false);
      setThinking(false);
      setMessages((current) => {
        const copy = [...current];
        const index = findLastMessage(copy, (message) => message.role === "assistant");
        const final = {
          content: event.content,
          stopped: false,
          continuing: false,
          reasoning: reasoningRef.current?.observed ? reasoningRef.current : undefined,
        };
        if (index >= 0) copy[index] = { ...copy[index], ...final };
        else copy.push({ id: `end_${Date.now()}`, role: "assistant", ...final });
        return copy;
      });
      liveStream.current.clear();
      if (event.usage) {
        setContextUsage((current) => current ? {
          ...current,
          lastRequestUsage: {
            input: event.usage.input ?? null,
            output: event.usage.output ?? null,
            cacheRead: event.usage.cacheRead ?? null,
            cacheWrite: event.usage.cacheWrite ?? null,
            totalTokens: event.usage.totalTokens ?? null,
            cost: event.usage.cost || null,
          },
        } : current);
      }
    }
    if (event.type === "message_end" && event.message?.role === "user") {
      refresh().catch(() => {});
      setMessages((current) => promotePendingUser(current, event.message));
    }
    if (event.type === "tool_execution_start") {
      setActiveToolName(event.toolName || "tool");
      setTools((current) => mergeToolEvent(current, event, {
        nextSeq: () => {
          const seq = toolSeq.current;
          toolSeq.current += 1;
          return seq;
        },
      }).tools);
    }
    if (event.type === "tool_execution_update") {
      setTools((current) => mergeToolEvent(current, {
        ...event,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        partialResult: event.partialResult,
      }).tools);
    }
    if (event.type === "tool_execution_end") {
      setActiveToolName(null);
      setTools((current) => mergeToolEvent(current, {
        ...event,
        toolCallId: event.toolCallId,
        done: true,
        result: event.result,
        isError: event.isError,
      }).tools);
    }
    if (event.type === "client_error" && event.requestId) {
      setInteractiveRequests((current) => failInteractiveRequest(current, event.requestId, event.message));
      return;
    }
    if (["runtime_error", "client_error"].includes(event.type)) {
      if (!stopPending.current) setGeneration(event.type === "runtime_error" ? "failed" : "idle");
      resetLiveUiFlags();
      if (event.code === "generation_limit") {
        // Prompt was rejected before a turn started: undo optimistic user bubble and restore draft.
        setMessages((current) => {
          const last = current[current.length - 1];
          if (last?.role === "user" && String(last.id || "").startsWith("user_")) {
            setDraft((draft) => draft || last.content || "");
            return current.slice(0, -1);
          }
          return current;
        });
        setError(event.message || "Too many concurrent generations. Wait for another chat to finish.");
      } else {
        setError(event.message || "Runtime error");
      }
    }
  }

  async function discardEmptyDraft(chatId = selectedId, status = chatStatus) {
    if (!chatId || status !== "draft") return;
    await fetch(`/v0/chats/${encodeURIComponent(chatId)}?ifEmpty=true`, { method: "DELETE" }).catch(() => {});
  }

  function resetChatState() {
    openLiveToken.current += 1;
    setConnectingChatId(null);
    ws.current?.close(); setLive(null);
    setGeneration("idle"); setDraft(""); setEditEntryId(null); setError("");
    setContextUsage(null); setInteractiveRequests([]); setCommands([]); setQueue({ steering: [], followUp: [] });
    reasoningRef.current = createInitialReasoningState();
    setReasoning(reasoningRef.current);
    resetLiveUiFlags();
    liveStream.current.clear();
    currentGeneration.current = null; stopPending.current = false; continuation.current = null;
    toolSeq.current = 0;
  }

  async function newChat(target, options = {}) {
    const nextProject = target || projects.find((item) => item.id === projectId) || projects[0];
    if (!nextProject) return;
    const hostDefault = nextProject.defaultTemplateId === "host-pi" && !options.templateId && !options.runtimeKind;
    const templateId = options.templateId
      || (nextProject.defaultTemplateId === "host-pi" ? null : nextProject.defaultTemplateId)
      || defaultTemplateId
      || "chat";
    await discardEmptyDraft();
    resetChatState();
    const specialRuntimeChat = templateId === "runtime";
    const chat = await api(specialRuntimeChat ? "/v0/runtime/chats" : "/v0/chats", {
      method: "POST",
      body: JSON.stringify(specialRuntimeChat ? {} : hostDefault
        ? { projectId: nextProject.id }
        : {
          projectId: nextProject.id,
          templateId,
          runtimeKind: options.runtimeKind || "conduit_profile",
        }),
    });
    history.replaceState({}, "", `/chat/${chat.id}`);
    selectedIdRef.current = chat.id;
    setSelectedId(chat.id); setProjectId(chat.projectId); setChatStatus(chat.status); setChatTitle(chat.title);
    setChatTemplateId(chat.templateId || templateId);
    setChatRuntime(chat.runtime || null);
    if (hostDefault && chat.runtime?.kind !== "native_pi") {
      setProjects((current) => current.map((project) => project.id === nextProject.id
        ? { ...project, defaultTemplateId: null }
        : project));
    }
    setMessages([]); setTools([]); setPageBefore(null); setLoadedSessionId(chat.id);
  }

  function requestNewChat(target = null, options = {}) {
    if (!target && !options.templateId && !options.runtimeKind) {
      setSidebarCommand({ type: "new-chat", nonce: Date.now() });
      return;
    }
    newChat(target, options).catch((caught) => setError(caught.message));
  }

  async function setChatLaunchOption(optionId) {
    if (!selectedId || !optionId) return;
    if (chatStatus !== "draft") {
      setError("Profile is locked after the first message. Start a new chat to switch.");
      return;
    }
    const project = projects.find((item) => item.id === projectId);
    const hostPi = optionId === "host-pi";
    if (hostPi && project?.kind !== "workspace") return;
    const templateId = hostPi ? chatTemplateId : optionId;
    if (!hostPi && templateId === chatTemplateId && chatRuntime?.kind !== "native_pi") return;
    const chat = await api(`/v0/chats/${encodeURIComponent(selectedId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        templateId,
        ...(project?.kind === "workspace" ? { runtimeKind: hostPi ? "native_pi" : "conduit_profile" } : {}),
      }),
    });
    setChatTemplateId(chat.templateId || templateId);
    setChatRuntime(chat.runtime || null);
    await modelSettings.reloadChat();
  }

  const setChatProfile = (templateId) => setChatLaunchOption(templateId);

  async function saveDefaultTemplate(templateId) {
    const saved = await api("/v0/preferences", {
      method: "PATCH",
      body: JSON.stringify({ defaultTemplateId: templateId }),
    });
    setDefaultTemplateId(saved.defaultTemplateId || templateId);
    return saved;
  }

  async function openSession(session, owningProject) {
    await discardEmptyDraft();
    resetChatState();
    selectedIdRef.current = session.id;
    setProjectId(owningProject.id); setSelectedId(session.id); setChatTitle(session.title); setChatStatus(session.status);
    setChatTemplateId(session.templateId || defaultTemplateId || "chat");
    setChatRuntime(session.runtime || null);
    history.replaceState({}, "", `/chat/${session.id}`);
    const detail = await loadDetail(session.id);
    if (detail?.templateId) setChatTemplateId(detail.templateId);
    if (detail?.runtime) setChatRuntime(detail.runtime);
    if (selectedIdRef.current === session.id && detail.status === "active") {
      try {
        await openLive(session.id, owningProject.id);
      } catch (caught) {
        if (selectedIdRef.current === session.id) setError(caught.message);
      }
    }
  }

  async function ensureLive(intent = "open") {
    if (live && ws.current?.readyState === WebSocket.OPEN) return live;
    if (!selectedId) throw new Error("Chat is not ready yet");
    const record = await openLive(selectedId, projectId, { intent });
    if (!record) throw new Error("Chat switched before Pi was ready");
    return record;
  }

  function stopResponse() {
    if (generation !== "active" && generation !== "submitting" && !streaming) return;
    const generationId = currentGeneration.current;
    if (generationId) closedGenerations.current.add(generationId);
    liveStream.current.flush();
    stopPending.current = true;
    setGeneration("stopping");
    setMessages((current) => {
      const copy = [...current];
      const index = findLastMessage(copy, (message) => message.role === "assistant");
      if (index >= 0) {
        const partial = `${copy[index].content || ""}${liveStream.current.getSnapshot().content}`;
        copy[index] = { ...copy[index], content: partial, stopped: true, status: "stopping" };
      }
      return copy;
    });
    ws.current?.send(JSON.stringify({ type: "stop_generation", generationId }));
  }

  async function send({ streamingBehavior = null, steer = false, text: explicitText = null } = {}) {
    if (generation === "stopping") return;
    if (!serverOnline) {
      setError("Server unavailable");
      return;
    }
    const text = String(explicitText ?? draft).trim();
    if (!text) return;

    const busy = generation === "active" || generation === "submitting";
    if (busy) {
      const mode = steer || streamingBehavior === "steer" ? "steer" : "followUp";
      const attachmentIds = attachmentState.pendingIds;
      const sentAttachments = attachmentState.items
        .filter((item) => attachmentIds.includes(item.id))
        .map(({ id, name, size, type, objectUrl }) => ({ id, name, size, type, objectUrl }));
      const pendingId = `user_${Date.now()}`;
      const pendingMessage = {
        id: pendingId,
        key: pendingId,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
        attachments: sentAttachments,
        pending: true,
        queueMode: mode,
      };
      setDraft("");
      setMessages((current) => [...current, pendingMessage]);
      try {
        await ensureLive();
        ws.current.send(JSON.stringify({
          type: mode === "steer" ? "steer" : "follow_up",
          message: text,
          attachmentIds,
        }));
        attachmentState.markAnnounced(attachmentIds);
      } catch (caught) {
        setMessages((current) => current.filter((message) => message.id !== pendingId));
        setError(caught.message);
        setDraft(text);
      }
      return;
    }

    if (!live || ws.current?.readyState !== WebSocket.OPEN) {
      setGeneration("submitting");
      try {
        await ensureLive("prompt");
      } catch (caught) {
        setGeneration("idle");
        setError(caught.message);
        return;
      }
    }

    const attachmentIds = attachmentState.pendingIds;
    const previousMessages = messages;
    const previousEditEntryId = editEntryId;
    const sentAttachments = attachmentState.items
      .filter((item) => attachmentIds.includes(item.id))
      .map(({ id, name, size, type, objectUrl }) => ({ id, name, size, type, objectUrl }));
    setDraft("");
    const localMessage = {
      id: `user_${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toISOString(),
      attachments: sentAttachments,
    };
    if (editEntryId) {
      setMessages((current) => {
        const index = current.findIndex((message) => message.id === editEntryId);
        return index >= 0 ? [...current.slice(0, index), localMessage] : [...current, localMessage];
      });
    } else setMessages((current) => [...current, localMessage]);
    attachmentState.markAnnounced(attachmentIds);
    setGeneration("submitting");
    try {
      ws.current.send(JSON.stringify(editEntryId
        ? { type: "fork_and_prompt", entryId: editEntryId, message: text, attachmentIds }
        : { type: "prompt", message: text, attachmentIds }));
      setChatStatus("active");
      setGeneration("active");
      setEditEntryId(null);
    } catch (caught) {
      setMessages(previousMessages);
      setEditEntryId(previousEditEntryId);
      attachmentState.restoreDraft(sentAttachments);
      setError(caught.message);
      setDraft(text);
      setGeneration("idle");
    }
  }

  async function regenerate(entryId) {
    if (!entryId || streaming || stopping) return;
    try {
      await ensureLive();
      setMessages((current) => {
        const index = current.findIndex((message) => message.id === entryId);
        return index >= 0 ? current.slice(0, index + 1) : current;
      });
      setGeneration("active");
      ws.current.send(JSON.stringify({ type: "regenerate", entryId }));
    } catch (caught) { setError(caught.message); setGeneration("idle"); }
  }

  async function continueResponse() {
    if (streaming || stopping || !partialContinue) return;
    try {
      await ensureLive();
      setGeneration("active");
      ws.current.send(JSON.stringify({ type: "continue" }));
    } catch (caught) { setError(caught.message); setGeneration("idle"); }
  }

  function respondHostUi(response) {
    if (!ws.current || ws.current.readyState !== WebSocket.OPEN) {
      setInteractiveRequests((current) => failInteractiveRequest(current, response.id, "Not connected to the live session"));
      return;
    }
    setInteractiveRequests((current) => markInteractiveRequestSubmitting(current, response.id, response));
    try {
      ws.current.send(JSON.stringify({ type: "extension_ui_response", ...response }));
    } catch (caught) {
      setInteractiveRequests((current) => failInteractiveRequest(current, response.id, caught.message));
    }
  }

  /** Local UI only: pull queue text into the draft. Pi has no clear_queue RPC and may still deliver. */
  function clearQueue() {
    const restored = [...(queue.steering || []), ...(queue.followUp || [])].join("\n");
    setQueue({ steering: [], followUp: [] });
    setMessages((current) => current.filter((message) => !message.pending));
    if (restored) setDraft((current) => (current ? `${current}\n${restored}` : restored));
  }

  async function loadOlder() {
    if (!selectedId || !pageBefore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const detail = await api(`/v0/sessions/${selectedId}?before=${encodeURIComponent(pageBefore)}`);
      setMessages((current) => [...list(detail.messages), ...current]);
      setTools((current) => {
        const older = assignToolSeq(list(detail.tools));
        const known = new Set(older.map((tool) => tool.id));
        const live = current.filter((tool) => !known.has(tool.id));
        const merged = [...older, ...live];
        toolSeq.current = Math.max(toolSeq.current, maxToolSeq(merged) + 1);
        return merged;
      });
      setPageBefore(detail.page?.before || null);
    } catch (caught) { setError(caught.message); }
    finally { setLoadingOlder(false); }
  }

  async function addProject(input) {
    try {
      const body = typeof input === "string"
        ? { name: input, mode: "managed" }
        : {
          mode: input.mode || "managed",
          name: input.name || undefined,
          path: input.path || undefined,
          cloneUrl: input.cloneUrl || undefined,
          defaultTemplateId: input.defaultTemplateId || undefined,
        };
      const created = await api("/v0/projects", { method: "POST", body: JSON.stringify(body) });
      await refresh();
      const templateId = created.defaultTemplateId || defaultTemplateId || "chat";
      await newChat(created, { templateId });
      return true;
    } catch (caught) { setError(caught.message); return false; }
  }

  async function openRuntimeChat() {
    const project = projects.find((item) => item.slug === "chat") || projects[0];
    if (!project) throw new Error("No chat project");
    setSettingsOpen(false);
    await newChat(project, { templateId: "runtime" });
  }

  async function saveWorkspaceDefault(workspaceId, templateId) {
    const saved = await api(`/v0/projects/${encodeURIComponent(workspaceId)}`, {
      method: "PATCH",
      body: JSON.stringify({ defaultTemplateId: templateId }),
    });
    setProjects((current) => current.map((project) => project.id === workspaceId
      ? { ...project, ...saved, sessions: project.sessions }
      : project));
    return saved;
  }

  async function deleteSession(session, owningProject) {
    try {
      await api(`/v0/sessions/${session.id}`, { method: "DELETE" });
      if (selectedId === session.id) await newChat(owningProject);
      await refresh();
    } catch (caught) { setError(caught.message); }
  }

  async function deleteProject(target) {
    try {
      await api(`/v0/projects/${target.id}`, { method: "DELETE" });
      if (projectId === target.id) await newChat(projects.find((item) => item.slug === "chat"));
      await refresh();
    } catch (caught) { setError(caught.message); }
  }

  async function renameSession(session, _project, name) {
    try {
      const renamed = await api(`/v0/sessions/${session.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
      if (selectedId === session.id) setChatTitle(renamed.title);
      await refresh(); return true;
    } catch (caught) { setError(caught.message); return false; }
  }

  async function renameProject(target, name) {
    try { await api(`/v0/projects/${target.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); await refresh(); return true; }
    catch (caught) { setError(caught.message); return false; }
  }

  async function moveSession(session, _source, target) {
    try {
      const moved = await api(`/v0/sessions/${session.id}/move`, { method: "POST", body: JSON.stringify({ projectId: target.id }) });
      if (selectedId === session.id) {
        resetChatState();
        selectedIdRef.current = moved.id;
        setProjectId(target.id); setSelectedId(moved.id); setChatStatus(moved.status);
        await loadDetail(moved.id);
      }
      await refresh();
    } catch (caught) { setError(caught.message); }
  }

  async function moveProjectSessions(source, target) {
    try {
      const payload = await api(`/v0/projects/${source.id}/move-sessions`, { method: "POST", body: JSON.stringify({ projectId: target.id }) });
      const movedSelected = list(payload.moved).find((item) => item.sourceId === selectedId);
      if (movedSelected) {
        resetChatState();
        const nextId = movedSelected.session?.id || selectedId;
        selectedIdRef.current = nextId;
        setProjectId(target.id); setSelectedId(nextId);
        await loadDetail(nextId);
      }
      await refresh();
    } catch (caught) { setError(caught.message); }
  }

  async function copyTranscript(session) {
    try {
      const response = await fetch(`/v0/sessions/${session.id}/transcript`);
      if (!response.ok) throw new Error("Could not load the transcript");
      await navigator.clipboard.writeText(await response.text());
    } catch (caught) { setError(caught.message); }
  }

  const unresolvedRequests = interactiveRequests.filter((request) => request.status !== "resolved");
  const activity = useMemo(() => deriveFineActivity({
    generation,
    processStatus: selectedProcess?.status || (live ? "running" : "none"),
    coarse: selectedProcess?.activity || "idle",
    thinking,
    responding,
    toolName: activeToolName,
    retry,
  }), [generation, selectedProcess, live, thinking, responding, activeToolName, retry, unresolvedRequests.length]);

  // Transcript activity is for in-turn work only. Starting/connecting shows in the
  // sidebar RuntimeIndicator so the thread does not jump or flash the composer busy state.
  const displayActivity = unresolvedRequests.length
    ? { kind: "waiting_for_user", label: "Waiting for your confirmation" }
    : (activity.kind === "starting" ? { kind: "idle", label: null } : activity);

  const lastAssistant = messages.findLast((message) => message.role === "assistant");
  const lastAssistantIndex = lastAssistant ? messages.indexOf(lastAssistant) : -1;
  const precedingUser = lastAssistantIndex >= 0
    ? messages.slice(0, lastAssistantIndex).findLast((message) => message.role === "user" && !String(message.id || "").startsWith("user_"))
    : null;
  const selectedModel = modelSettings.models.find((item) => item.spec === modelSettings.model);
  const commandContext = {
    chatId: selectedId,
    chatStatus,
    streaming,
    canRegenerate: Boolean(precedingUser),
    canContinue: Boolean(partialContinue && lastAssistant?.stopped),
    canCopy: Boolean(lastAssistant?.content),
    connectivity: globalRuntime.connectivity,
    projects,
    project: projects.find((item) => item.id === projectId) || null,
    thinkingLevels: Array.isArray(selectedModel?.thinkingLevels) ? selectedModel.thinkingLevels : [],
    effort: modelSettings.effort,
    templates: templates.filter((item) => item.defaultable !== false),
    templateId: chatTemplateId || defaultTemplateId,
    defaultTemplateId,
    commands,
  };
  const openSettings = (section = "profiles", workspaceId = null) => {
    setSettingsSection(section);
    setSettingsWorkspaceId(workspaceId);
    setSettingsOpen(true);
  };
  const activeProfile = templates.find((item) => item.id === chatTemplateId)
    || templates.find((item) => item.id === defaultTemplateId)
    || templates[0]
    || null;
  const commandActions = {
    newChat: requestNewChat,
    newFolder: () => setSidebarCommand({ type: "new-folder", nonce: Date.now() }),
    newWorkspace: () => setSidebarCommand({ type: "new-workspace", nonce: Date.now() }),
    attach: attachmentState.openPicker,
    settings: (section = "profiles") => openSettings(section),
    workspaceSettings: (workspaceId) => openSettings("workspaces", workspaceId),
    rename: () => setSidebarCommand({ type: "rename", nonce: Date.now() }),
    renameFolder: () => setSidebarCommand({ type: "rename-folder", nonce: Date.now() }),
    move: () => setSidebarCommand({ type: "move", nonce: Date.now() }),
    delete: () => setSidebarCommand({ type: "delete", nonce: Date.now() }),
    deleteFolder: () => setSidebarCommand({ type: "delete-folder", nonce: Date.now() }),
    stop: stopResponse,
    regenerate: () => regenerate(precedingUser?.id),
    continue: continueResponse,
    copy: () => lastAssistant && navigator.clipboard.writeText(lastAssistant.content),
    copyTranscript: () => selectedId && copyTranscript({ id: selectedId }),
    openChat: (session, project) => openSession(session, project).catch((caught) => setError(caught.message)),
    sendText: (text) => send({ text }),
    insertCommand: (text) => setDraft((current) => current ? `${current} ${text}` : text),
    chooseEffort: modelSettings.chooseEffort,
    setChatProfile: (templateId) => setChatProfile(templateId).catch((caught) => setError(caught.message)),
    openRuntimeChat: () => openRuntimeChat().catch((caught) => setError(caught.message)),
    retryConnection: globalRuntime.retry,
    reload: () => location.reload(),
    logout: () => {
      fetch("/v0/auth/logout", { method: "POST" })
        .catch(() => {})
        .finally(() => { location.href = "/login"; });
    },
  };

  const threadReady = loadedSessionId === selectedId;
  const emptyChat = threadReady && messages.length === 0 && tools.length === 0 && !displayActivity?.label;
  const selectedProject = projects.find((project) => project.id === projectId);
  const sharedWorkspaceGeneration = selectedProject?.kind === "workspace"
    && [...globalRuntime.processes.values()].some((process) => process.projectId === selectedProject.id
      && process.chatId !== selectedId
      && (process.active || ["working", "compacting", "retrying"].includes(process.activity)));
  return <TooltipProvider>
    <Toaster richColors />
    <SidebarProvider defaultOpen>
      <AppSidebar
        projects={projects}
        commandRequest={sidebarCommand}
        projectId={projectId}
        selectedId={selectedId}
        selectedStatus={chatStatus}
        selectedTitle={chatTitle}
        view="chat"
        connectivity={globalRuntime.connectivity}
        getProcess={getProcess}
        runtimeStale={globalRuntime.stale}
        onRetryConnection={globalRuntime.retry}
        onAddProject={addProject}
        workspaceSuggestions={workspaceSuggestions}
        onCommandHandled={() => setSidebarCommand(null)}
        onCopyTranscript={copyTranscript}
        onDeleteProject={deleteProject}
        onDeleteSession={deleteSession}
        onMoveProjectSessions={moveProjectSessions}
        onMoveSession={moveSession}
        onNewChat={(project, options) => newChat(project, options).catch((caught) => setError(caught.message))}
        onOpenSettings={() => openSettings("models")}
        onOpenWorkspaceSettings={(workspace) => openSettings("workspaces", workspace.id)}
        onOpenSession={(session, project) => openSession(session, project).catch((caught) => setError(caught.message))}
        onRenameProject={renameProject}
        onRenameSession={renameSession}
      />
      <SidebarInset className={`chat-main${emptyChat ? " chat-main-empty" : ""}`} {...drop.handlers}>
        <ChatDropOverlay active={drop.active} />
        <div className="chat-meteors" aria-hidden="true"><Meteors number={30} minDelay={0} maxDelay={1} minDuration={12} maxDuration={20} /></div>
        <ChatHeader
          project={selectedProject}
          title={chatTitle}
          profile={activeProfile}
          runtime={chatRuntime}
          live={live}
          attentionCount={unresolvedRequests.length}
        />
        {sharedWorkspaceGeneration && <Alert className="mx-auto mt-3 max-w-3xl" variant="default">
          <TriangleAlertIcon />
          <AlertTitle>Another chat is working in this Workspace</AlertTitle>
          <AlertDescription>Both agents can edit the same files. Conduit does not lock the Workspace or create worktrees automatically.</AlertDescription>
        </Alert>}
        <ChatThread
          key={loadedSessionId ?? "boot"}
          messages={messages}
          tools={tools}
          streaming={streaming}
          liveStore={liveStream.current}
          sessionId={selectedId}
          hasOlder={Boolean(pageBefore)}
          loadingOlder={loadingOlder}
          partialContinue={partialContinue}
          editingEntryId={editEntryId}
          activity={displayActivity}
          reasoning={reasoning}
          requests={interactiveRequests}
          onRespond={respondHostUi}
          onLoadOlder={loadOlder}
          onCopyMessage={(message) => navigator.clipboard.writeText(message.content || "")}
          onEditMessage={(message) => {
            if (editEntryId === message.id) {
              setDraft("");
              setEditEntryId(null);
              attachmentState.clear();
              return;
            }
            setDraft(message.content || "");
            setEditEntryId(message.id);
            attachmentState.restore(message.attachments);
          }}
          onRegenerate={regenerate}
          onContinue={continueResponse}
        />
        <div className="composer-stack">
          <ChatComposer
            draft={draft}
            generation={generation}
            streaming={streaming}
            stopping={stopping}
            models={modelSettings.models}
            model={modelSettings.model}
            effort={modelSettings.effort}
            modelNotice={modelSettings.notice}
            attachments={attachmentState}
            chatId={selectedId}
            commandContext={commandContext}
            commandActions={commandActions}
            contextUsage={contextUsage}
            compacting={compacting}
            queue={queue}
            serverOnline={serverOnline}
            profile={chatRuntime?.kind === "native_pi"
              ? { id: "host-pi", label: "Host Pi", description: "Uses your host Pi installation, authentication, and project resources." }
              : activeProfile}
            runtime={chatRuntime}
            profiles={chatTemplateId === "runtime" ? [] : [
              ...templates.filter((item) => item.defaultable !== false && item.special !== true),
              ...(selectedProject?.kind === "workspace" ? [{
                id: "host-pi",
                label: "Host Pi",
                description: installations.find((item) => item.id === "host-pi")?.available
                  ? "Uses your host Pi installation, authentication, and project resources."
                  : "Host Pi is unavailable.",
                disabled: !installations.find((item) => item.id === "host-pi")?.available,
              }] : []),
            ]}
            profileLocked={chatStatus !== "draft"}
            onDraftChange={setDraft}
            onChooseModel={modelSettings.chooseModel}
            onChooseEffort={modelSettings.chooseEffort}
            onChooseProfile={(optionId) => setChatLaunchOption(optionId).catch((caught) => setError(caught.message))}
            onSend={() => send()}
            onSendText={(text) => send({ text })}
            onStop={stopResponse}
            onSteer={() => send({ steer: true })}
            onClearQueue={clearQueue}
          />
        </div>
      </SidebarInset>
      <Suspense fallback={null}>
        {commandOpen && <CommandMenu
          open={commandOpen}
          initialPage={commandPage}
          launchNonce={commandLaunchNonce}
          onOpenChange={(open) => {
            setCommandOpen(open);
            if (!open) setCommandPage(null);
          }}
          context={commandContext}
          actions={commandActions}
          models={modelSettings.models}
          model={modelSettings.model}
          onChooseModel={modelSettings.chooseModel}
        />}
        {settingsOpen && <SettingsDialog
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          initialSection={settingsSection}
          modelSettings={modelSettings}
          templates={templates}
          defaultTemplateId={defaultTemplateId}
          onDefaultTemplateChange={saveDefaultTemplate}
          onOpenRuntimeChat={() => openRuntimeChat().catch((caught) => setError(caught.message))}
          installations={installations}
          onInstallationsChange={setInstallations}
          projects={projects}
          initialWorkspaceId={settingsWorkspaceId}
          onWorkspaceDefaultChange={saveWorkspaceDefault}
          onHostUnavailable={() => setProjects((current) => current.map((project) => project.defaultTemplateId === "host-pi"
            ? { ...project, defaultTemplateId: null }
            : project))}
        />}
      </Suspense>
    </SidebarProvider>
  </TooltipProvider>;
}

createRoot(document.getElementById("root")).render(<AppErrorBoundary><App /></AppErrorBoundary>);
