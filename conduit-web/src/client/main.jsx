import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CableIcon, ShareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Meteors } from "@/components/ui/meteors";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./app-sidebar";
import { ChatComposer } from "./chat-composer";
import { ChatThread } from "./chat-thread";
import { SettingsPage } from "./settings-page";
import { sessionIdForLive } from "./session-selection";
import "./styles.css";

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

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, details) { console.error("Conduit UI crashed", error, details); }
  render() {
    if (!this.state.error) return this.props.children;
    return <div className="crash-screen"><div><i /><h1>Conduit hit a UI error</h1><p>{this.state.error.message || "The interface could not continue."}</p><button onClick={() => location.reload()}>Reload Conduit</button></div></div>;
  }
}

function MobileSidebarBrand() {
  const { toggleSidebar } = useSidebar();
  return <Button className="mobile-sidebar-brand z-10" variant="ghost" size="icon-sm" aria-label="Conduit" onClick={toggleSidebar}>
    <CableIcon />
  </Button>;
}

function ChatHeader({ title }) {
  return <header className="chat-header">
    <span className="chat-header-title">{title}</span>
    <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Share chat">
      <ShareIcon />
    </Button>
  </header>;
}

function App() {
  const [projects, setProjects] = useState([]);
  const [models, setModels] = useState([]);
  const [modelNotice, setModelNotice] = useState("");
  const [view, setView] = useState("chat");
  const [projectId, setProjectId] = useState("project_chat");
  const [selectedId, setSelectedId] = useState(null);
  const [live, setLive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [tools, setTools] = useState([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [error, setError] = useState("");
  const ws = useRef(null);

  const refresh = async (selectLiveId = "") => {
    const payload = await api("/v0/projects");
    const nextProjects = list(payload.projects).map((item) => ({ ...item, sessions: list(item.sessions) }));
    setProjects(nextProjects);
    const createdSessionId = sessionIdForLive(nextProjects, selectLiveId);
    if (createdSessionId) setSelectedId(createdSessionId);
    return nextProjects;
  };
  useEffect(() => {
    let active = true;
    refresh().catch((e) => active && setError(e.message));
    return () => { active = false; ws.current?.close(); };
  }, []);
  useEffect(() => {
    let active = true;
    api(`/v0/models?projectId=${encodeURIComponent(projectId)}`)
      .then((payload) => {
        if (!active) return;
        const nextModels = list(payload.models);
        const nextDefault = payload.defaultModel || nextModels[0]?.spec || "";
        const requestedModel = nextModels.some((item) => item.spec === model) ? model : "";
        const selectedModel = nextModels.find((item) => item.spec === (requestedModel || nextDefault));
        const levels = list(selectedModel?.thinkingLevels);
        setModels(nextModels);
        setModelNotice(payload.requiresAuthentication ? "Authenticate with conduit-pi, then run /login." : "");
        setModel(requestedModel || nextDefault);
        setEffort((current) => levels.includes(current)
          ? current
          : levels.includes(payload.defaultThinkingLevel) ? payload.defaultThinkingLevel : levels[0] || "off");
      })
      .catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [projectId]);
  const project = projects.find((item) => item.id === projectId) || projects[0];
  const selectedSession = projects.flatMap((item) => item.sessions).find((item) => item.id === selectedId);
  const chatTitle = selectedSession?.title || "New Chat";
  function chooseModel(spec) {
    const nextModel = models.find((item) => item.spec === spec);
    if (!nextModel) return;
    const levels = list(nextModel?.thinkingLevels);
    setModel(spec);
    setEffort((current) => levels.includes(current) ? current : levels.includes("medium") ? "medium" : levels[0] || "off");
    if (ws.current?.readyState === WebSocket.OPEN) {
      const [provider, ...modelParts] = spec.split("/");
      ws.current.send(JSON.stringify({ type: "set_model", provider, modelId: modelParts.join("/") }));
    }
    api("/v0/settings", {
      method: "PATCH",
      body: JSON.stringify({
        projectId: project?.id || "project_chat",
        enabledModels: models.map((item) => item.spec),
        defaultModel: spec,
      }),
    }).catch((e) => setError(e.message));
  }

  function consume(event, liveId = "") {
    if (event.type === "agent_start") setStreaming(true);
    if (event.type === "agent_end" || event.type === "runtime_exit") { setStreaming(false); refresh(liveId).catch(() => {}); }
    if (event.type === "message_start" && event.message?.role === "assistant") {
      setMessages((old) => [...old, { id: `live_${Date.now()}`, role: "assistant", content: "", timestamp: new Date().toISOString() }]);
    }
    const delta = event.assistantMessageEvent;
    if (event.type === "message_update" && delta?.type === "text_delta") {
      setMessages((old) => { const copy = [...old]; const i = findLastMessage(copy, (x) => x.role === "assistant"); if (i >= 0) copy[i] = { ...copy[i], content: String(copy[i].content || "") + delta.delta }; return copy; });
    }
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const content = Array.isArray(event.message.content) ? event.message.content.filter((x) => x.type === "text").map((x) => x.text).join("\n") : String(event.message.content || "");
      setMessages((old) => { const copy = [...old]; const i = findLastMessage(copy, (x) => x.role === "assistant"); if (i >= 0) copy[i] = { ...copy[i], content }; else copy.push({ id: `end_${Date.now()}`, role: "assistant", content }); return copy; });
    }
    if (event.type === "message_end" && event.message?.role === "user") refresh(liveId).catch(() => {});
    if (event.type === "tool_execution_start") setTools((old) => {
      const tool = {
        id: event.toolCallId,
        name: event.toolName,
        args: event.args,
        done: false,
        timestamp: event.timestamp || new Date().toISOString(),
      };
      return old.some((item) => item.id === tool.id)
        ? old.map((item) => item.id === tool.id ? { ...item, ...tool } : item)
        : [...old, tool];
    });
    if (event.type === "tool_execution_end") setTools((old) => old.map((x) =>
      x.id === event.toolCallId ? { ...x, done: true, result: event.result } : x));
    if (["runtime_error", "client_error"].includes(event.type)) setError(event.message || "Runtime error");
  }

  function connect(record) {
    ws.current?.close();
    const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${record.streamUrl || `/v0/live-sessions/${record.id}/stream`}`);
    ws.current = socket;
    socket.onmessage = ({ data }) => {
      try {
        const event = JSON.parse(data);
        if (event.type === "runtime_snapshot") {
          if (event.session?.active) list(event.events).forEach((item) => consume(item, record.id));
        } else consume(event, record.id);
      } catch (e) { setError(e.message); }
    };
    socket.onerror = () => setError("Lost connection to the Conduit runtime");
  }

  async function openSession(session, owningProject) {
    setError(""); setView("chat"); setProjectId(owningProject.id); setSelectedId(session.id); setTools([]);
    const detail = await api(`/v0/sessions/${session.id}`);
    setMessages(list(detail.messages));
    setTools(list(detail.tools));
    if (detail.model) {
      setModel(detail.model);
      const sessionModel = models.find((item) => item.spec === detail.model);
      const levels = list(sessionModel?.thinkingLevels);
      setEffort(levels.includes(detail.thinkingLevel)
        ? detail.thinkingLevel
        : levels.includes("medium") ? "medium" : levels[0] || "off");
    }
    const record = await api("/v0/live-sessions", { method: "POST", body: JSON.stringify({ projectId: owningProject.id, resumeSessionId: session.id }) });
    setLive(record); connect(record);
  }

  function newChat(target) {
    const nextProject = target || project || projects[0];
    ws.current?.close(); setView("chat"); setLive(null); setSelectedId(null); setMessages([]); setTools([]); setStreaming(false); setError("");
    if (nextProject) setProjectId(nextProject.id);
  }

  async function ensureLive() {
    if (live && ws.current?.readyState === WebSocket.OPEN) return live;
    const record = await api("/v0/live-sessions", {
      method: "POST",
      body: JSON.stringify({ projectId: project?.id || "project_chat", model, thinkingLevel: effort }),
    });
    setLive(record); connect(record); await new Promise((resolve) => { if (ws.current.readyState === WebSocket.OPEN) resolve(); else ws.current.addEventListener("open", resolve, { once: true }); });
    return record;
  }

  async function send() {
    if (streaming) { ws.current?.send(JSON.stringify({ type: "abort" })); return; }
    const text = draft.trim(); if (!text) return;
    setDraft(""); setMessages((old) => [...old, { id: `user_${Date.now()}`, role: "user", content: text, timestamp: new Date().toISOString() }]);
    try { await ensureLive(); ws.current.send(JSON.stringify({ type: "prompt", message: text })); setStreaming(true); }
    catch (e) { setError(e.message); setDraft(text); }
  }

  async function addProject(name) {
    try {
      const created = await api("/v0/projects", { method: "POST", body: JSON.stringify({ name }) });
      await refresh(); setProjectId(created.id); newChat(created); return true;
    } catch (e) { setError(e.message); return false; }
  }

  async function deleteSession(session, owningProject) {
    try {
      await api(`/v0/sessions/${session.id}`, { method: "DELETE" });
      if (selectedId === session.id) newChat(owningProject);
      await refresh();
    } catch (e) { setError(e.message); }
  }

  async function deleteProject(target) {
    try {
      await api(`/v0/projects/${target.id}`, { method: "DELETE" });
      if (projectId === target.id) newChat(projects.find((item) => item.slug === "chat"));
      await refresh();
    } catch (e) { setError(e.message); }
  }

  const loadSettings = useCallback((targetProjectId) => api(`/v0/settings?projectId=${encodeURIComponent(targetProjectId)}`), []);
  const saveSettings = useCallback((targetProjectId, enabledModels) => api("/v0/settings", {
    method: "PATCH",
    body: JSON.stringify({ projectId: targetProjectId, enabledModels }),
  }), []);
  const showError = useCallback((message) => setError(message), []);
  const applyModelSettings = useCallback((payload) => {
    const enabled = new Set(list(payload.enabledModels));
    const nextModels = list(payload.models).filter((item) => enabled.has(item.spec));
    const nextDefault = payload.defaultModel || nextModels[0]?.spec || "";
    setModels(nextModels);
    setModel((current) => enabled.has(current) ? current : nextDefault);
    const nextModel = nextModels.find((item) => item.spec === nextDefault) || nextModels[0];
    const levels = list(nextModel?.thinkingLevels);
    setEffort((current) => levels.includes(current)
      ? current
      : levels.includes("medium") ? "medium" : levels[0] || "off");
  }, []);
  const emptyChat = view === "chat" && messages.length === 0 && tools.length === 0;

  return <TooltipProvider>
    <SidebarProvider open>
      <AppSidebar
        projects={projects}
        projectId={projectId}
        selectedId={selectedId}
        view={view}
        onAddProject={addProject}
        onDeleteProject={deleteProject}
        onDeleteSession={deleteSession}
        onNewChat={newChat}
        onOpenSettings={() => setView("settings")}
        onOpenSession={(session, owningProject) => openSession(session, owningProject).catch((e) => setError(e.message))}
      />
      <SidebarInset className={`chat-main${emptyChat ? " chat-main-empty" : ""}`}>
        {view === "chat" && <div className="chat-meteors" aria-hidden="true">
          <Meteors number={30} minDelay={0} maxDelay={1} minDuration={12} maxDuration={20} />
        </div>}
        <MobileSidebarBrand />
        {view === "settings" ? <SettingsPage
          projectId={projectId}
          loadSettings={loadSettings}
          saveSettings={saveSettings}
          onError={showError}
          onSaved={applyModelSettings}
        /> : <>
          <ChatHeader title={chatTitle} />
          <ChatThread messages={messages} tools={tools} streaming={streaming} />
          <ChatComposer
            draft={draft}
            streaming={streaming}
            models={models}
            model={model}
            effort={effort}
            modelNotice={modelNotice}
            onDraftChange={setDraft}
            onChooseModel={chooseModel}
            onChooseEffort={setEffort}
            onSend={send}
          />
        </>}
        {error && <Button className="error" variant="destructive" onClick={() => setError("")}>{error} ×</Button>}
      </SidebarInset>
    </SidebarProvider>
  </TooltipProvider>;
}

createRoot(document.getElementById("root")).render(<AppErrorBoundary><App /></AppErrorBoundary>);
