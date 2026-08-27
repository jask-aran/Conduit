import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ArrowRightIcon, SearchIcon, TerminalIcon } from "lucide-solid";
import { Spinner } from "@/components/primitives";
import { api, projectPath } from "../api/client";
import type { ChatSummary, Project } from "../api/contracts";
import { RuntimeIndicator } from "../navigation/runtime-indicator";
import type { Pty } from "../remotes/terminal-pane";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import type { RuntimeStore } from "../state/runtime";
import "./app-dashboard.css";

function latestActivity(project: Project) {
  return Math.max(0, ...project.sessions.map((chat) => Date.parse(chat.updatedAt || chat.createdAt || "") || 0));
}

function relativeActivity(value: number, currentTime = Date.now()) {
  if (!value) return "No recent chats";
  const minutes = Math.max(0, Math.floor((currentTime - value) / 60_000));
  if (minutes < 1) return "Active now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function compactDate(value?: string) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

export function AppDashboard(props: {
  projects: Project[];
  composer: JSX.Element;
  runtime: RuntimeStore;
  onOpenChat: (chat: ChatSummary, project: Project) => void;
  onPrefetchChat: (chat: ChatSummary) => void;
  onOpenProject: (project: Project) => void;
  onOpenTerminal: (terminal: Pty) => void;
  onOpenTerminalView: () => void;
  onSearchChats: (scope: "unscoped" | "all") => void;
}) {
  const [terminals, setTerminals] = createSignal<Pty[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [now, setNow] = createSignal(Date.now());
  const [chatScope, setChatScope] = createSignal<"unscoped" | "all">("unscoped");
  const workspaces = createMemo(() => props.projects
    .filter((project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || ""))
    .sort((left, right) => latestActivity(right) - latestActivity(left))
    .slice(0, 6));
  const chats = createMemo(() => props.projects
    .filter((project) => chatScope() === "all" || project.slug === "chat")
    .flatMap((project) => project.sessions
      .filter((chat) => chat.status === "active")
      .map((chat) => ({ chat, project })))
    .sort((left, right) => String(right.chat.updatedAt || right.chat.createdAt || "")
      .localeCompare(String(left.chat.updatedAt || left.chat.createdAt || "")))
    .slice(0, 10));

  const refresh = async () => {
    try {
      const payload = await api<{ ptys: Pty[] }>("/v0/ptys");
      setTerminals((payload.ptys || []).filter((terminal) => terminal.status === "running"));
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    for (const { chat } of chats()) props.onPrefetchChat(chat);
  });

  onMount(() => {
    const changed = () => void refresh();
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    window.addEventListener("conduit:ptys-changed", changed);
    void refresh();
    onCleanup(() => {
      window.clearInterval(clock);
      window.removeEventListener("conduit:ptys-changed", changed);
    });
  });

  const terminalScope = (terminal: Pty) => props.projects.find((project) => project.id === terminal.projectId);
  const terminalActivity = (terminal: Pty) => {
    const value = Date.parse(terminal.lastActivityAt || terminal.updatedAt || terminal.createdAt || "") || 0;
    return value ? relativeActivity(value, now()) : "Activity unavailable";
  };
  const terminalCwd = (terminal: Pty) => terminal.cwd || terminalScope(terminal)?.path || terminalScope(terminal)?.externalPath || "Working directory unavailable";

  return <section class="app-dashboard" aria-labelledby="app-dashboard-title">
    <div class="app-dashboard-intro">
      <h1 id="app-dashboard-title">Start where the work is.</h1>
    </div>

    <div class="app-dashboard-launch-row">
      <div class="app-dashboard-composer-slot">{props.composer}</div>
      <aside class="app-dashboard-quick-actions" aria-label="Quick actions">
        <span>Quick actions</span>
        <button type="button" onClick={props.onOpenTerminalView}>
          <TerminalIcon />
          <strong>Terminal View</strong>
          <ArrowRightIcon />
        </button>
        <button type="button" onClick={() => props.onSearchChats("unscoped")}>
          <SearchIcon />
          <strong>Search chats</strong>
          <ArrowRightIcon />
        </button>
      </aside>
    </div>

    <div class="app-dashboard-grid">
      <section class="app-dashboard-section app-dashboard-chats" aria-labelledby="recent-chats-title">
        <div class="app-dashboard-section-heading">
          <div><h2 id="recent-chats-title">Recent chats</h2><p>Continue a conversation</p></div>
          <div class="app-dashboard-chat-actions">
            <div class="app-dashboard-scope-toggle" role="group" aria-label="Recent chat scope">
              <button type="button" aria-pressed={chatScope() === "unscoped"} onClick={() => setChatScope("unscoped")}>Unscoped</button>
              <button type="button" aria-pressed={chatScope() === "all"} onClick={() => setChatScope("all")}>All</button>
            </div>
            <button type="button" class="app-dashboard-chat-search" aria-label="Search Chats" title="Search Chats" onClick={() => props.onSearchChats(chatScope())}>
              <SearchIcon />
            </button>
          </div>
        </div>
        <Show when={chats().length} fallback={<div class="app-dashboard-empty">No recent chats.</div>}>
          <div class="project-chat-list">
            <For each={chats()}>{({ chat, project }) =>
              <button class="project-chat-row" onPointerEnter={() => props.onPrefetchChat(chat)} onFocus={() => props.onPrefetchChat(chat)} onClick={() => props.onOpenChat(chat, project)}>
                <span class="project-chat-runtime"><RuntimeIndicator process={props.runtime.getProcess(chat.id)} stale={props.runtime.stale()} /></span>
                <span class="project-chat-copy">
                  <strong>{chat.title || "Untitled chat"}</strong>
                  <small>{project.name}{compactDate(chat.createdAt) ? ` · ${compactDate(chat.createdAt)}` : ""}</small>
                </span>
                <time dateTime={chat.updatedAt || chat.createdAt}>{relativeActivity(Date.parse(chat.updatedAt || chat.createdAt || "") || 0)}</time>
                <ArrowRightIcon />
              </button>}
            </For>
          </div>
        </Show>
      </section>

      <section class="app-dashboard-section app-dashboard-workspaces" aria-labelledby="recent-workspaces-title">
        <div class="app-dashboard-section-heading">
          <div><h2 id="recent-workspaces-title">Recent Workspaces</h2><p>Open a dashboard</p></div>
        </div>
        <Show when={workspaces().length} fallback={<div class="app-dashboard-empty">No Workspaces yet.</div>}>
          <div class="app-dashboard-list">
            <For each={workspaces()}>{(project) =>
              <a href={projectPath(project)} onClick={(event) => { event.preventDefault(); props.onOpenProject(project); }}>
                <span class="app-dashboard-workspace-glyph"><WorkspaceGlyph appearance={project.workspaceAppearance} /></span>
                <span><strong>{project.name}</strong><small>{relativeActivity(latestActivity(project))}</small></span>
                <ArrowRightIcon />
              </a>}
            </For>
          </div>
        </Show>
      </section>

      <section class="app-dashboard-section app-dashboard-terminals" aria-labelledby="live-terminals-title">
        <div class="app-dashboard-section-heading">
          <div><h2 id="live-terminals-title">Live terminals</h2><p>{terminals().length || "No"} running</p></div>
        </div>
        <Show when={!loading()} fallback={<div class="app-dashboard-empty"><Spinner /><span>Loading terminals…</span></div>}>
          <Show when={terminals().length} fallback={<div class="app-dashboard-empty">No live terminals.</div>}>
            <div class="app-dashboard-list app-dashboard-terminal-list">
              <For each={terminals()}>{(terminal) =>
                <button onClick={() => props.onOpenTerminal(terminal)}>
                  <TerminalIcon />
                  <span class="app-dashboard-terminal-copy">
                    <span class="app-dashboard-terminal-title">
                      <strong>{terminal.title || "Shell"}</strong>
                      <em>{terminalScope(terminal)?.name || "Unscoped"}</em>
                    </span>
                    <small title={`${terminal.currentCommand || "shell"} · ${terminalActivity(terminal)} · ${terminalCwd(terminal)}`}>
                      {terminal.currentCommand || "shell"} · {terminalActivity(terminal)} · <code>{terminalCwd(terminal)}</code>
                    </small>
                  </span>
                  <ArrowRightIcon />
                </button>}
              </For>
            </div>
          </Show>
        </Show>
      </section>
    </div>
  </section>;
}
