import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
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
import { AppSidebar } from "./app-sidebar";
import { ChatComposer } from "./chat-composer";
import { ChatDropOverlay, useChatDrop } from "./chat-drop-overlay";
import { ChatThread } from "./chat-thread";
import { createLiveStreamStore } from "./live-stream-store";
import { useAttachments } from "./use-attachments";
import { useModelSettings } from "./use-model-settings";
import "./styles.css";

const CommandMenu = lazy(() => import("./command-menu").then((module) => ({ default: module.CommandMenu })));
const SettingsDialog = lazy(() => import("./settings-dialog").then((module) => ({ default: module.SettingsDialog })));

const api = async (url, options) => {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.message || body.error || "Request failed");
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

function ChatHeader({ project, title }) {
  const projectLabel = project?.slug === "chat" ? "Chats" : project?.slug || project?.name || "Chats";
  return <header className="chat-header">
    <SidebarTrigger className="-ml-1" />
    {title && <Breadcrumb className="chat-header-title">
      <BreadcrumbList className="flex-nowrap">
        <BreadcrumbItem><span className="truncate">{projectLabel}</span></BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem className="min-w-0"><BreadcrumbPage className="truncate font-semibold">{title}</BreadcrumbPage></BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>}
    <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Share chat"><ShareIcon /></Button>
  </header>;
}

function App() {
  const [projects, setProjects] = useState([]);
  const [projectId, setProjectId] = useState("project_chat");
  const [selectedId, setSelectedId] = useState(null);
  const [chatStatus, setChatStatus] = useState("draft");
  const [chatTitle, setChatTitle] = useState("New chat");
  const [live, setLive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [tools, setTools] = useState([]);
  const [pageBefore, setPageBefore] = useState(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState("models");
  const [commandOpen, setCommandOpen] = useState(false);
  const [sidebarCommand, setSidebarCommand] = useState(null);
  const [editEntryId, setEditEntryId] = useState(null);
  const [partialContinue, setPartialContinue] = useState(true);
  const ws = useRef(null);
  const currentGeneration = useRef(null);
  const closedGenerations = useRef(new Set());
  const stopPending = useRef(false);
  const continuation = useRef(null);
  const liveStream = useRef(null);
  const selectedIdRef = useRef(null);
  selectedIdRef.current = selectedId;
  if (!liveStream.current) liveStream.current = createLiveStreamStore();

  const showError = useCallback((message) => setError(message), []);
  useEffect(() => {
    if (!error) return;
    toast.error(error);
    setError("");
  }, [error]);
  const modelSettings = useModelSettings(projectId, { onError: showError, socketRef: ws });
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
    }
    return next;
  }, []);

  const loadDetail = useCallback(async (chatId) => {
    const detail = await api(`/v0/sessions/${encodeURIComponent(chatId)}`);
    setMessages(list(detail.messages));
    setTools(list(detail.tools));
    setPageBefore(detail.page?.before || null);
    setChatStatus(detail.status || "draft");
    setChatTitle(detail.title || "New chat");
    return detail;
  }, []);

  function connect(record) {
    ws.current?.close();
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${record.streamUrl || `/v0/live-sessions/${record.id}/stream`}`);
    ws.current = socket;
    socket.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data);
        if (event.type === "runtime_snapshot") {
          const generation = event.session?.generation;
          if (generation?.id && !generation.closed) currentGeneration.current = generation.id;
          if (event.session?.active) list(event.events).forEach((item) => consume(item, record.id));
          if (event.stream?.generationId && !event.session?.generation?.closed) {
            liveStream.current.setSnapshot(event.stream.generationId, event.stream.content);
          }
        } else consume(event, record.id);
      } catch (caught) { setError(caught.message); }
    };
    socket.onerror = () => setError("Lost connection to the Conduit runtime");
    socket.addEventListener("close", () => {
      if (ws.current === socket) ws.current = null;
    });
  }

  async function openLive(chatId, owningProjectId, options = {}) {
    const record = await api("/v0/live-sessions", {
      method: "POST",
      body: JSON.stringify({
        chatId,
        projectId: owningProjectId,
        model: modelSettings.model,
        thinkingLevel: modelSettings.effort,
        ...options,
      }),
    });
    setLive(record);
    connect(record);
    await new Promise((resolve, reject) => {
      if (ws.current.readyState === WebSocket.OPEN) resolve();
      else {
        ws.current.addEventListener("open", resolve, { once: true });
        ws.current.addEventListener("error", () => reject(new Error("Could not connect to Pi")), { once: true });
      }
    });
    return record;
  }

  useEffect(() => {
    let active = true;
    Promise.all([api("/v0/projects"), api("/v0/capabilities").catch(() => ({ partialContinue: true }))])
      .then(async ([payload, capabilities]) => {
        if (!active) return;
        const nextProjects = list(payload.projects).map((project) => ({ ...project, sessions: list(project.sessions) }));
        setProjects(nextProjects);
        setPartialContinue(capabilities.partialContinue !== false);
        const routeId = pathChatId();
        if (routeId) {
          const chat = await api(`/v0/chats/${encodeURIComponent(routeId)}`);
          if (!active) return;
          setSelectedId(chat.id); setProjectId(chat.projectId); setChatStatus(chat.status); setChatTitle(chat.title);
          await loadDetail(chat.id);
          if (chat.status === "active") await openLive(chat.id, chat.projectId);
          return;
        }
        const project = nextProjects.find((item) => item.slug === "chat") || nextProjects[0];
        if (!project) throw new Error("Conduit has no chat project");
        const chat = await api("/v0/chats", { method: "POST", body: JSON.stringify({ projectId: project.id }) });
        if (!active) return;
        history.replaceState({}, "", `/chat/${chat.id}`);
        setSelectedId(chat.id); setProjectId(chat.projectId); setChatStatus(chat.status); setChatTitle(chat.title);
      })
      .catch((caught) => active && setError(caught.message));
    return () => { active = false; ws.current?.close(); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function consume(event, liveId = "") {
    if (event.generationId && closedGenerations.current.has(event.generationId)
      && !["generation_stopped", "generation_started"].includes(event.type)) return;
    if (stopPending.current && ["message_start", "assistant_stream_delta", "assistant_stream_final"].includes(event.type)) return;
    if (event.type === "generation_started") {
      currentGeneration.current = event.generationId;
      stopPending.current = false;
      setStopping(false);
      setStreaming(true);
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
    if (event.type === "agent_start") setStreaming(true);
    if (event.type === "agent_end" || event.type === "runtime_exit") setStreaming(false);
    if (event.type === "generation_stopped") {
      stopPending.current = false;
      setStopping(false);
      setStreaming(false);
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
      if (event.chat?.id === selectedIdRef.current) loadDetail(event.chat.id).catch(() => {});
    }
    if (event.type === "message_start" && event.message?.role === "assistant" && !continuation.current) {
      setMessages((current) => [...current, { id: `live_${Date.now()}`, role: "assistant", content: "", timestamp: new Date().toISOString() }]);
    }
    if (event.type === "assistant_stream_delta") liveStream.current.append(event.generationId, event.delta || "");
    if (event.type === "assistant_stream_final") {
      liveStream.current.flush();
      continuation.current = null;
      setStreaming(false);
      setStopping(false);
      setMessages((current) => {
        const copy = [...current];
        const index = findLastMessage(copy, (message) => message.role === "assistant");
        const final = { content: event.content, stopped: false, continuing: false };
        if (index >= 0) copy[index] = { ...copy[index], ...final };
        else copy.push({ id: `end_${Date.now()}`, role: "assistant", ...final });
        return copy;
      });
      liveStream.current.clear();
    }
    if (event.type === "message_end" && event.message?.role === "user") refresh().catch(() => {});
    if (event.type === "tool_execution_start") setTools((current) => {
      const tool = { id: event.toolCallId, name: event.toolName, args: event.args, done: false, timestamp: event.timestamp || new Date().toISOString() };
      return current.some((item) => item.id === tool.id) ? current.map((item) => item.id === tool.id ? { ...item, ...tool } : item) : [...current, tool];
    });
    if (event.type === "tool_execution_end") setTools((current) => current.map((tool) =>
      tool.id === event.toolCallId ? { ...tool, done: true, result: event.result } : tool));
    if (["runtime_error", "client_error"].includes(event.type)) {
      setStreaming(false);
      setStopping(false);
      setError(event.message || "Runtime error");
    }
  }

  async function discardEmptyDraft(chatId = selectedId, status = chatStatus) {
    if (!chatId || status !== "draft") return;
    await fetch(`/v0/chats/${encodeURIComponent(chatId)}?ifEmpty=true`, { method: "DELETE" }).catch(() => {});
  }

  function resetChatState() {
    ws.current?.close(); setLive(null); setMessages([]); setTools([]); setPageBefore(null);
    setStreaming(false); setStopping(false); setDraft(""); setEditEntryId(null); setError("");
    liveStream.current.clear();
    currentGeneration.current = null; stopPending.current = false; continuation.current = null;
  }

  async function newChat(target) {
    const nextProject = target || projects.find((item) => item.id === projectId) || projects[0];
    if (!nextProject) return;
    await discardEmptyDraft();
    resetChatState();
    const chat = await api("/v0/chats", { method: "POST", body: JSON.stringify({ projectId: nextProject.id }) });
    history.replaceState({}, "", `/chat/${chat.id}`);
    setSelectedId(chat.id); setProjectId(chat.projectId); setChatStatus(chat.status); setChatTitle(chat.title);
  }

  async function openSession(session, owningProject) {
    await discardEmptyDraft();
    resetChatState();
    setProjectId(owningProject.id); setSelectedId(session.id); setChatTitle(session.title); setChatStatus(session.status);
    history.replaceState({}, "", `/chat/${session.id}`);
    const detail = await loadDetail(session.id);
    if (detail.status === "active") await openLive(session.id, owningProject.id);
  }

  async function ensureLive() {
    if (live && ws.current?.readyState === WebSocket.OPEN) return live;
    if (!selectedId) throw new Error("Chat is not ready yet");
    return openLive(selectedId, projectId);
  }

  function stopResponse() {
    if (!streaming) return;
    const generationId = currentGeneration.current;
    if (generationId) closedGenerations.current.add(generationId);
    liveStream.current.flush();
    stopPending.current = true;
    setStopping(true);
    setStreaming(false);
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

  async function send() {
    if (stopping) return;
    if (streaming) { stopResponse(); return; }
    const text = draft.trim();
    if (!text) return;
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
    try {
      await ensureLive();
      ws.current.send(JSON.stringify(editEntryId
        ? { type: "fork_and_prompt", entryId: editEntryId, message: text, attachmentIds }
        : { type: "prompt", message: text, attachmentIds }));
      setChatStatus("active");
      setStreaming(true);
      setEditEntryId(null);
    } catch (caught) {
      setMessages(previousMessages);
      setEditEntryId(previousEditEntryId);
      attachmentState.restoreDraft(sentAttachments);
      setError(caught.message);
      setDraft(text);
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
      ws.current.send(JSON.stringify({ type: "regenerate", entryId }));
      setStreaming(true);
    } catch (caught) { setError(caught.message); }
  }

  async function continueResponse() {
    if (streaming || stopping || !partialContinue) return;
    try {
      await ensureLive();
      ws.current.send(JSON.stringify({ type: "continue" }));
      setStreaming(true);
    } catch (caught) { setError(caught.message); }
  }

  async function loadOlder() {
    if (!selectedId || !pageBefore || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const detail = await api(`/v0/sessions/${selectedId}?before=${encodeURIComponent(pageBefore)}`);
      setMessages((current) => [...list(detail.messages), ...current]);
      setTools((current) => [...list(detail.tools), ...current]);
      setPageBefore(detail.page?.before || null);
    } catch (caught) { setError(caught.message); }
    finally { setLoadingOlder(false); }
  }

  async function addProject(name) {
    try {
      const created = await api("/v0/projects", { method: "POST", body: JSON.stringify({ name }) });
      await refresh(); await newChat(created); return true;
    } catch (caught) { setError(caught.message); return false; }
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
      if (selectedId === session.id) { resetChatState(); setProjectId(target.id); setSelectedId(moved.id); setChatStatus(moved.status); }
      await refresh();
    } catch (caught) { setError(caught.message); }
  }

  async function moveProjectSessions(source, target) {
    try {
      const payload = await api(`/v0/projects/${source.id}/move-sessions`, { method: "POST", body: JSON.stringify({ projectId: target.id }) });
      if (list(payload.moved).some((item) => item.sourceId === selectedId)) { resetChatState(); setProjectId(target.id); }
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

  const lastAssistant = messages.findLast((message) => message.role === "assistant");
  const lastAssistantIndex = lastAssistant ? messages.indexOf(lastAssistant) : -1;
  const precedingUser = lastAssistantIndex >= 0
    ? messages.slice(0, lastAssistantIndex).findLast((message) => message.role === "user" && !String(message.id || "").startsWith("user_"))
    : null;
  const commandContext = {
    chatId: selectedId,
    streaming,
    canRegenerate: Boolean(precedingUser),
    canContinue: Boolean(partialContinue && lastAssistant?.stopped),
    canCopy: Boolean(lastAssistant?.content),
  };
  const openSettings = (section = "models") => { setSettingsSection(section); setSettingsOpen(true); };
  const commandActions = {
    newChat: () => newChat(),
    attach: attachmentState.openPicker,
    settings: () => openSettings("general"),
    model: () => openSettings("models"),
    rename: () => setSidebarCommand({ type: "rename", nonce: Date.now() }),
    move: () => setSidebarCommand({ type: "move", nonce: Date.now() }),
    delete: () => setSidebarCommand({ type: "delete", nonce: Date.now() }),
    stop: stopResponse,
    regenerate: () => regenerate(precedingUser?.id),
    continue: continueResponse,
    copy: () => lastAssistant && navigator.clipboard.writeText(lastAssistant.content),
  };

  const emptyChat = messages.length === 0 && tools.length === 0;
  const selectedProject = projects.find((project) => project.id === projectId);
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
        onAddProject={addProject}
        onCommandHandled={() => setSidebarCommand(null)}
        onCopyTranscript={copyTranscript}
        onDeleteProject={deleteProject}
        onDeleteSession={deleteSession}
        onMoveProjectSessions={moveProjectSessions}
        onMoveSession={moveSession}
        onNewChat={(project) => newChat(project).catch((caught) => setError(caught.message))}
        onOpenSettings={() => openSettings("models")}
        onOpenSession={(session, project) => openSession(session, project).catch((caught) => setError(caught.message))}
        onRenameProject={renameProject}
        onRenameSession={renameSession}
      />
      <SidebarInset className={`chat-main${emptyChat ? " chat-main-empty" : ""}`} {...drop.handlers}>
        <ChatDropOverlay active={drop.active} />
        <div className="chat-meteors" aria-hidden="true"><Meteors number={30} minDelay={0} maxDelay={1} minDuration={12} maxDuration={20} /></div>
        <ChatHeader project={selectedProject} title={chatTitle} />
        <ChatThread
          messages={messages}
          tools={tools}
          streaming={streaming}
          liveStore={liveStream.current}
          sessionId={selectedId}
          hasOlder={Boolean(pageBefore)}
          loadingOlder={loadingOlder}
          partialContinue={partialContinue}
          editingEntryId={editEntryId}
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
        <ChatComposer
          draft={draft}
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
          onDraftChange={setDraft}
          onChooseModel={modelSettings.chooseModel}
          onChooseEffort={modelSettings.chooseEffort}
          onSend={send}
        />
      </SidebarInset>
      <Suspense fallback={null}>
        {commandOpen && <CommandMenu
          open={commandOpen}
          onOpenChange={setCommandOpen}
          context={commandContext}
          actions={commandActions}
          models={modelSettings.models}
          model={modelSettings.model}
          onChooseModel={modelSettings.chooseModel}
        />}
        {settingsOpen && <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} initialSection={settingsSection} modelSettings={modelSettings} />}
      </Suspense>
    </SidebarProvider>
  </TooltipProvider>;
}

createRoot(document.getElementById("root")).render(<AppErrorBoundary><App /></AppErrorBoundary>);
