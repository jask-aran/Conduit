import { isConduitManagedProject } from "../navigation/sidebar-preferences";
import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ArrowRightIcon, ClipboardCopyIcon, FolderInputIcon, MessageSquarePlusIcon, PaletteIcon, PencilIcon, PinIcon, PinOffIcon, SearchIcon, Settings2Icon, TerminalIcon, Trash2Icon } from "lucide-solid";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger, Spinner } from "@/components/primitives";
import { api, projectPath } from "../api/client";
import type { ChatSummary, Project } from "../api/contracts";
import { RuntimeIndicator } from "../navigation/runtime-indicator";
import { ThreadHarnessMark } from "../harness-brand";
import type { Pty } from "../remotes/terminal-pane";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import type { RuntimeStore } from "../state/runtime";
import type { SidebarCommand } from "../navigation/sidebar";
import { COMMAND_IDS, commandLabel } from "../commands/command-registry";
import { compareChatsBySort, saveChatSort, useChatSort } from "../preferences/chat-sort";
import { DashboardControlGroup, DashboardEmpty, DashboardGrid, DashboardIdentity, DashboardLaunch, DashboardQuickActions, DashboardRow, DashboardRowTitle, DashboardScrollRegion, DashboardSearchButton, DashboardSection, DashboardShell } from "./primitives/dashboard";
import "./app-dashboard.css";

function latestActivity(project: Project) {
  return Math.max(0, ...project.sessions.map((chat) => Date.parse(chat.lastMessageAt || chat.createdAt || "") || 0));
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
  onPrefetchProject: (project: Project) => void;
  onContextAction: (type: string, target: Omit<SidebarCommand, "type" | "nonce">) => void;
  isPinned: (type: "chat" | "project" | "terminal", id: string) => boolean;
  onNewChat: (project: Project) => void;
  onOpenWorkspaceIdentity: (project: Project) => void;
  onOpenWorkspaceSettings: (project: Project) => void;
  onMoveProjectChats: (source: Project, target: Project) => void;
  onOpenChatTerminal: (chat: ChatSummary, project: Project) => void;
  onOpenTerminal: (terminal: Pty) => void;
  onOpenTerminalMaximized: (terminal: Pty) => void;
  onPrefetchTerminal: () => void;
  onSearchChats: (scope: "unscoped" | "all") => void;
}) {
  const [terminals, setTerminals] = createSignal<Pty[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [now, setNow] = createSignal(Date.now());
  const [chatScope, setChatScope] = createSignal<"unscoped" | "all">("unscoped");
  const [chatVisibility, setChatVisibility] = createSignal<"all" | "unread">("all");
  const chatSort = useChatSort();
  const workspaces = createMemo(() => props.projects
    .filter((project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || ""))
    .sort((left, right) => latestActivity(right) - latestActivity(left))
    .slice(0, 6));
  const chats = createMemo(() => {
    const sort = chatSort();
    return props.projects
      .filter((project) => chatScope() === "all" || project.slug === "chat")
      .flatMap((project) => project.sessions
        .filter((chat) => chat.status === "active")
        .filter((chat) => chatVisibility() === "all" || chat.unread)
        .map((chat) => ({ chat, project })))
      .sort((left, right) => compareChatsBySort(left.chat, right.chat, sort))
      .slice(0, 10);
  });

  const refresh = async () => {
    try {
      const payload = await api<{ ptys: Pty[] }>("/v0/ptys");
      setTerminals((payload.ptys || []).filter((terminal) => terminal.status === "running"));
    } finally {
      setLoading(false);
    }
  };

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
  const terminalCwd = (terminal: Pty) => terminal.cwd || terminalScope(terminal)?.workingRoot || "Working directory unavailable";

  return <DashboardShell class="app-dashboard" labelledBy="app-dashboard-title">
    <DashboardIdentity title="Start where the work is." titleId="app-dashboard-title" variant="intro" />

    <DashboardLaunch primary={props.composer} aside={<DashboardQuickActions label="Workspace actions" columns={1}>
        <button type="button" onClick={() => props.onSearchChats("unscoped")}>
          <SearchIcon />
          <strong>Search chats</strong>
          <ArrowRightIcon />
        </button>
      </DashboardQuickActions>} />

    <DashboardGrid primary={<DashboardSection scrollable class="app-dashboard-chats" id="recent-chats-title" title="Recent chats" description="Continue a conversation" actions={
          <div class="app-dashboard-chat-actions">
            <DashboardControlGroup label="Recent chat scope">
              <button type="button" aria-pressed={chatScope() === "unscoped"} onClick={() => setChatScope("unscoped")}>Unscoped</button>
              <button type="button" aria-pressed={chatScope() === "all"} onClick={() => setChatScope("all")}>All</button>
            </DashboardControlGroup>
            <DashboardControlGroup label="Recent chat sort">
              <button type="button" aria-pressed={chatSort() === "latest"} onClick={() => saveChatSort("latest")}>Latest</button>
              <button type="button" aria-pressed={chatSort() === "created"} onClick={() => saveChatSort("created")}>Created</button>
            </DashboardControlGroup>
            <DashboardControlGroup label="Recent chat visibility">
              <button type="button" aria-pressed={chatVisibility() === "unread"} onClick={() => setChatVisibility("unread")}>Unread</button>
              <button type="button" aria-pressed={chatVisibility() === "all"} onClick={() => setChatVisibility("all")}>All</button>
            </DashboardControlGroup>
            <DashboardSearchButton aria-label="Search Chats" title="Search Chats" onClick={() => props.onSearchChats(chatScope())}>
              <SearchIcon />
            </DashboardSearchButton>
          </div>}>
        <Show when={chats().length} fallback={<DashboardEmpty>Nothing here yet.</DashboardEmpty>}>
          <DashboardScrollRegion class="project-chat-list">
            <For each={chats()}>{({ chat, project }) =>
              <ContextMenu><ContextMenuTrigger as={DashboardRow} element="button" onPointerEnter={() => props.onPrefetchChat(chat)} onFocus={() => props.onPrefetchChat(chat)} onClick={() => props.onOpenChat(chat, project)} leading={<RuntimeIndicator process={props.runtime.getProcess(chat.id)} stale={props.runtime.stale()} unread={chat.unread} fallback={<ThreadHarnessMark id={chat.harnessId} />} />} content={<>
                  <DashboardRowTitle title={chat.title || "Untitled chat"} context={`${project.name}${compactDate(chat.createdAt) ? ` · ${compactDate(chat.createdAt)}` : ""}`} />
                </>} meta={<time dateTime={chat.lastMessageAt || chat.createdAt}>{relativeActivity(Date.parse(chat.lastMessageAt || chat.createdAt || "") || 0)}</time>} trailing={<ArrowRightIcon />} /><ContextMenuContent class="w-60 sidebar-context-menu"><ContextMenuGroup>
                <ContextMenuItem onSelect={() => props.onContextAction("rename-chat", { chat, project })}><PencilIcon />{commandLabel(COMMAND_IDS.renameChat)}</ContextMenuItem>
                <ContextMenuItem onSelect={() => props.onContextAction("move-chat", { chat, project })}><FolderInputIcon />Move to folder…</ContextMenuItem>
                <ContextMenuItem onSelect={() => props.onContextAction("copy-chat", { chat })}><ClipboardCopyIcon />{commandLabel(COMMAND_IDS.copyTranscript)}</ContextMenuItem>
                <ContextMenuItem onSelect={() => props.onOpenChatTerminal(chat, project)}><TerminalIcon />Open terminal</ContextMenuItem>
                <Show when={isConduitManagedProject(project)}><ContextMenuItem onSelect={() => props.onContextAction("pin-chat", { chat })}><Show when={props.isPinned("chat", chat.id)} fallback={<><PinIcon />Pin to sidebar</>}><PinOffIcon />Unpin</Show></ContextMenuItem></Show>
              </ContextMenuGroup><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => props.onContextAction("delete-chat", { chat, project })}><Trash2Icon />{commandLabel(COMMAND_IDS.deleteChat)}</ContextMenuItem></ContextMenuContent></ContextMenu>}
            </For>
          </DashboardScrollRegion>
        </Show>
      </DashboardSection>} rail={<>

      <DashboardSection class="app-dashboard-workspaces" id="recent-workspaces-title" title="Recent Workspaces" description="Open a dashboard">
        <Show when={workspaces().length} fallback={<DashboardEmpty>Nothing here yet.</DashboardEmpty>}>
          <div class="app-dashboard-list">
            <For each={workspaces()}>{(project) =>
              <ContextMenu><ContextMenuTrigger as={DashboardRow} element="a" href={projectPath(project)} onPointerEnter={() => props.onPrefetchProject(project)} onFocus={() => props.onPrefetchProject(project)} onClick={(event: MouseEvent) => { event.preventDefault(); props.onOpenProject(project); }} leading={<WorkspaceGlyph appearance={project.workspaceAppearance} />} content={<><strong>{project.name}</strong><small>{relativeActivity(latestActivity(project))}</small></>} trailing={<ArrowRightIcon />} /><ContextMenuContent class="w-60 sidebar-context-menu"><ContextMenuGroup>
                <ContextMenuItem onSelect={() => props.onNewChat(project)}><MessageSquarePlusIcon />{commandLabel(COMMAND_IDS.newChat)}</ContextMenuItem>
                <ContextMenuItem onSelect={() => props.onContextAction("rename-folder", { project })}><PencilIcon />Rename workspace</ContextMenuItem>
                <ContextMenuItem onSelect={() => props.onOpenWorkspaceIdentity(project)}><PaletteIcon />Identity</ContextMenuItem>
                <ContextMenuItem onSelect={() => props.onOpenWorkspaceSettings(project)}><Settings2Icon />Workspace settings</ContextMenuItem>
                <ContextMenuSub>
                  <ContextMenuSubTrigger disabled={!project.sessions.length}><FolderInputIcon />Move chats to…</ContextMenuSubTrigger>
                  <ContextMenuSubContent class="w-48 sidebar-context-menu">
                    <For each={props.projects.filter((target) => target.id !== project.id)}>{(target) =>
                      <ContextMenuItem onSelect={() => props.onMoveProjectChats(project, target)}>{target.name}</ContextMenuItem>}
                    </For>
                  </ContextMenuSubContent>
                </ContextMenuSub>
              </ContextMenuGroup><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => props.onContextAction("delete-project", { project })}><Trash2Icon />Unlink workspace</ContextMenuItem></ContextMenuContent></ContextMenu>}
            </For>
          </div>
        </Show>
      </DashboardSection>

      <DashboardSection class="app-dashboard-terminals" id="live-terminals-title" title="Live terminals" description={`${terminals().length || "No"} running`}>
        <Show when={!loading()} fallback={<DashboardEmpty><Spinner /><span>Loading terminals…</span></DashboardEmpty>}>
          <Show when={terminals().length} fallback={<DashboardEmpty>No live terminals.</DashboardEmpty>}>
            <div class="app-dashboard-list app-dashboard-terminal-list">
              <For each={terminals()}>{(terminal) =>
                <ContextMenu><ContextMenuTrigger as={DashboardRow} element="button" onPointerEnter={props.onPrefetchTerminal} onFocus={props.onPrefetchTerminal} onClick={() => props.onOpenTerminal(terminal)} leading={<TerminalIcon />} content={<span class="app-dashboard-terminal-copy">
                    <span class="app-dashboard-terminal-title">
                      <strong>{terminal.title || "Shell"}</strong>
                      <em>{terminalScope(terminal)?.name || "Unscoped"}</em>
                    </span>
                    <small title={`${terminal.currentCommand || "shell"} · ${terminalActivity(terminal)} · ${terminalCwd(terminal)}`}>
                      {terminal.currentCommand || "shell"} · {terminalActivity(terminal)} · <code>{terminalCwd(terminal)}</code>
                    </small>
                  </span>} trailing={<ArrowRightIcon />} /><ContextMenuContent class="w-52 sidebar-context-menu"><ContextMenuGroup>
                  <ContextMenuItem onSelect={() => props.onOpenTerminalMaximized(terminal)}><TerminalIcon />Open maximized</ContextMenuItem>
                  <ContextMenuItem onSelect={() => props.onContextAction("rename-terminal", { terminal })}><PencilIcon />Rename</ContextMenuItem>
                </ContextMenuGroup><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => props.onContextAction("delete-terminal", { terminal })}><Trash2Icon />Destroy shell</ContextMenuItem></ContextMenuContent></ContextMenu>}
              </For>
            </div>
          </Show>
        </Show>
      </DashboardSection>
    </>} />
  </DashboardShell>;
}
