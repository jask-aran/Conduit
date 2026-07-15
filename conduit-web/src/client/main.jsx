import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppSidebar } from "./app-sidebar";
import "./styles.css";

const api = async (url, options) => {
  const response = await fetch(url, { headers: { "content-type": "application/json" }, ...options });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.message || body.error || "Request failed");
  return body;
};
const list = (value) => Array.isArray(value) ? value : [];
const time = (value) => value ? new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
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

function RichText({ text = "" }) {
  const parts = String(text || "").split(/```([\w-]*)\n([\s\S]*?)```/g);
  return <>{parts.map((part, index) => index % 3 === 2
    ? <div className="code" key={index}><div><span>{parts[index - 1] || "text"}</span><button onClick={() => navigator.clipboard.writeText(part)}>Copy</button></div><pre>{part}</pre></div>
    : index % 3 === 0 && part ? <div className="prose" key={index}>{part}</div> : null)}</>;
}

function ToolCard({ tool }) {
  const [open, setOpen] = useState(false);
  return <button className={`tool ${tool.done ? "done" : ""}`} onClick={() => setOpen(!open)}>
    <span>{tool.done ? <CheckIcon /> : "·"}</span><strong>{tool.name || "Tool"}</strong><small>{tool.done ? "Complete" : "Running"}</small><span>{open ? <ChevronUpIcon /> : <ChevronDownIcon />}</span>
    {open && <pre>{JSON.stringify(tool.result || tool.args || {}, null, 2)}</pre>}
  </button>;
}

function App() {
  const [projects, setProjects] = useState([]);
  const [models, setModels] = useState([]);
  const [modelNotice, setModelNotice] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [projectId, setProjectId] = useState("project_chat");
  const [selectedId, setSelectedId] = useState(null);
  const [live, setLive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [tools, setTools] = useState([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [plusOpen, setPlusOpen] = useState(false);
  const [error, setError] = useState("");
  const ws = useRef(null);
  const bottom = useRef(null);

  const refresh = async () => {
    const payload = await api("/v0/projects");
    setProjects(list(payload.projects).map((item) => ({ ...item, sessions: list(item.sessions) })));
  };
  useEffect(() => {
    let active = true;
    refresh().catch((e) => active && setError(e.message));
    return () => { active = false; ws.current?.close(); };
  }, []);
  useEffect(() => {
    if (typeof bottom.current?.scrollIntoView === "function") bottom.current.scrollIntoView({ behavior: "smooth" });
  }, [messages, tools, streaming]);
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
        setDefaultModel(nextDefault);
        setModel(requestedModel);
        setEffort((current) => levels.includes(current)
          ? current
          : levels.includes(payload.defaultThinkingLevel) ? payload.defaultThinkingLevel : levels[0] || "off");
      })
      .catch((e) => active && setError(e.message));
    return () => { active = false; };
  }, [projectId]);
  const project = projects.find((item) => item.id === projectId) || projects[0];
  const selectedModel = models.find((item) => item.spec === (model || defaultModel));
  const thinkingLevels = list(selectedModel?.thinkingLevels);

  function chooseModel(spec) {
    const nextModel = models.find((item) => item.spec === (spec || defaultModel));
    const levels = list(nextModel?.thinkingLevels);
    setModel(spec);
    setEffort((current) => levels.includes(current) ? current : levels.includes("medium") ? "medium" : levels[0] || "off");
  }

  function consume(event) {
    if (event.type === "agent_start") setStreaming(true);
    if (event.type === "agent_end" || event.type === "runtime_exit") { setStreaming(false); refresh().catch(() => {}); }
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
    if (event.type === "tool_execution_start") setTools((old) => [...old, { id: event.toolCallId, name: event.toolName, args: event.args, done: false }]);
    if (event.type === "tool_execution_end") setTools((old) => old.map((x) => x.id === event.toolCallId ? { ...x, done: true, result: event.result } : x));
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
          if (event.session?.active) list(event.events).forEach(consume);
        } else consume(event);
      } catch (e) { setError(e.message); }
    };
    socket.onerror = () => setError("Lost connection to the Conduit runtime");
  }

  async function openSession(session, owningProject) {
    setError(""); setProjectId(owningProject.id); setSelectedId(session.id); setTools([]);
    const detail = await api(`/v0/sessions/${session.id}`); setMessages(list(detail.messages));
    const record = await api("/v0/live-sessions", { method: "POST", body: JSON.stringify({ projectId: owningProject.id, resumeSessionId: session.id }) });
    setLive(record); connect(record);
  }

  function newChat(target) {
    const nextProject = target || project || projects[0];
    ws.current?.close(); setLive(null); setSelectedId(null); setMessages([]); setTools([]); setStreaming(false); setError("");
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
    const text = draft.trim(); if (!text) return;
    if (streaming) { ws.current?.send(JSON.stringify({ type: "abort" })); return; }
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

  return <TooltipProvider>
    <SidebarProvider>
      <AppSidebar
        projects={projects}
        projectId={projectId}
        selectedId={selectedId}
        onAddProject={addProject}
        onDeleteProject={deleteProject}
        onDeleteSession={deleteSession}
        onNewChat={newChat}
        onOpenSession={(session, owningProject) => openSession(session, owningProject).catch((e) => setError(e.message))}
      />
      <SidebarInset className="chat-main">
        <SidebarTrigger className="sidebar-floating-trigger" />
      <div className="transcript">
        {!messages.length && !tools.length && <div className="welcome"><i /><h1>What are we working on?</h1><p>Start an unstructured chat, or choose a project to give Pi a working directory.</p></div>}
        <div className="thread">
          {messages.map((message) => message.role === "user" ? <div className="user-row" key={message.id}><time>{time(message.timestamp)}</time><div>{String(message.content || "")}</div></div> : message.role === "assistant" ? <div className="assistant-row" key={message.id}><time>{time(message.timestamp)}</time><div><RichText text={message.content} />{streaming && message === messages[messages.length - 1] && <span className="caret" />}</div></div> : null)}
          {tools.map((tool) => <ToolCard tool={tool} key={tool.id} />)}<div ref={bottom} />
        </div>
      </div>
      <div className="composer-wrap"><div className="composer">
        <div className="menu-anchor"><button onClick={() => setPlusOpen(!plusOpen)}>＋</button>{plusOpen && <div className="plus-menu"><button disabled>⌕ Attach files <small>Coming later</small></button></div>}</div>
        <textarea rows="1" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }} placeholder={`Message Pi in ${project?.name || "Chats"}`} />
        <div className="model-anchor"><button className="model-button" onClick={() => setModelOpen(!modelOpen)}>{model ? model.split("/").pop() : "Default model"}<small>{effort || "off"}</small><ChevronDownIcon className="model-chevron" /></button>
          {modelOpen && <div className="model-menu"><div><label>Model</label>{modelNotice && <span className="model-notice">{modelNotice}</span>}<button className={!model ? "chosen" : ""} onClick={() => chooseModel("")}>Pi default</button>{models.map((item) => <button className={model === item.spec ? "chosen" : ""} key={item.spec} onClick={() => chooseModel(item.spec)}>{item.label}<small>{item.provider}</small></button>)}</div><div><label>Thinking</label>{thinkingLevels.map((level) => <button className={effort === level ? "chosen" : ""} key={level} onClick={() => { setEffort(level); setModelOpen(false); }}>{level === "xhigh" ? "XHigh" : level[0].toUpperCase() + level.slice(1)}</button>)}</div></div>}
        </div>
        <button className="send" disabled={!draft.trim() && !streaming} onClick={send}>{streaming ? "■" : "↑"}</button>
      </div><p>Conduit can make mistakes. Verify important output.</p>{error && <div className="error" onClick={() => setError("")}>{error} ×</div>}</div>
      </SidebarInset>
    </SidebarProvider>
  </TooltipProvider>;
}

createRoot(document.getElementById("root")).render(<AppErrorBoundary><App /></AppErrorBoundary>);
