import { isConduitManagedProject } from "../navigation/sidebar-preferences";
import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ClipboardCopyIcon, FolderInputIcon, FolderPlusIcon, MessageSquarePlusIcon, PaletteIcon, PencilIcon, PinIcon, PinOffIcon, SearchIcon, Settings2Icon, TerminalIcon, Trash2Icon } from "lucide-solid";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger, ContextMenuTrigger, Spinner } from "@/components/primitives";
import { api, projectPath } from "../api/client";
import type { ChatSummary, Project, Template } from "../api/contracts";
import { activityDetail, runtimeActivity, RuntimeIndicator } from "../navigation/runtime-indicator";
import { activityLabel } from "../../activity.js";
import { ThreadHarnessMark } from "../harness-brand";
import type { Pty } from "../remotes/terminal-pane";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import type { RuntimeStore } from "../state/runtime";
import type { SidebarCommand } from "../navigation/sidebar";
import { COMMAND_IDS, commandLabel } from "../commands/command-registry";
import { compareChatsBySort, saveChatSort, useChatSort } from "../preferences/chat-sort";
import { Segmented } from "../settings/settings-controls";
import { CHAT_PAGE, DayGroups, FilterBar, groupByDay, ListSearch, CompactHeading, FiltersMenu, placeChoice, profileChoice, profileOf, ShowMore, sortChoice } from "./primitives/chat-list";
import { SplitDashboard, SplitEmpty, SplitGroup, SplitHeader, SplitRow, SplitShortcuts } from "./primitives/split";
import "./app-dashboard.css";

// The Conduit dashboard is also where New chat lands: the composer, every
// recent chat under it, and the places work lives on the right -- project
// folders as a shelf, workspaces and terminals as lists.

const isWorkspace = (project: Project) => project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");

function latestActivity(project: Project) {
  return Math.max(0, ...project.sessions.map((chat) => Date.parse(chat.lastMessageAt || chat.createdAt || "") || 0));
}

function shortAge(value: number, currentTime = Date.now()) {
  if (!value) return "";
  const minutes = Math.max(0, Math.floor((currentTime - value) / 60_000));
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}mo`;
}

function FolderMark() {
  return <svg class="app-folder-mark" viewBox="0 0 30 24" aria-hidden="true">
    <path class="app-folder-back" d="M1 4a2 2 0 0 1 2-2h7l3 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" />
    <path class="app-folder-front" d="M1 8h28v13a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" />
  </svg>;
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
  onOpenTerminalView: () => void;
  onOpenHarnessThread?: (harnessId: string, path: string, threadId: string, title: string) => void;
  onOpenSettings: () => void;
  profiles: Template[];
}) {
  const [terminals, setTerminals] = createSignal<Pty[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [now, setNow] = createSignal(Date.now());
  const [unreadOnly, setUnreadOnly] = createSignal(false);
  const [limit, setLimit] = createSignal(CHAT_PAGE);
  // Conduit's chats split by where they live: Conduit is no folder and the
  // project folders, Computer the workspaces. Threads no Conduit chat owns
  // stay in each workspace's Not in Conduit. The side is remembered.
  const [side, setSide] = createSignal<"conduit" | "computer">((() => { try { return localStorage.getItem("conduit.dashboard.threads:conduit") === "computer" ? "computer" : "conduit"; } catch { return "conduit"; } })());
  const [place, setPlace] = createSignal("");
  const chooseSide = (value: "conduit" | "computer") => {
    setSide(value);
    setPlace("");
    setLimit(CHAT_PAGE);
    try { localStorage.setItem("conduit.dashboard.threads:conduit", value); } catch { /* a per-viewer convenience */ }
  };
  const computer = () => side() === "computer";
  const [profile, setProfile] = createSignal("");
  const chatSort = useChatSort();

  const folders = createMemo(() => props.projects
    .filter((project) => !isWorkspace(project) && project.slug !== "chat")
    .sort((left, right) => latestActivity(right) - latestActivity(left)));
  const workspaces = createMemo(() => props.projects
    .filter(isWorkspace)
    .sort((left, right) => latestActivity(right) - latestActivity(left))
    .slice(0, 8));
  const everyChat = createMemo(() => props.projects
    .flatMap((project) => project.sessions.filter((chat) => chat.status === "active").map((chat) => ({ chat, project }))));
  const conduitChats = createMemo(() => everyChat().filter(({ project }) => !isWorkspace(project)));
  const computerChats = createMemo(() => everyChat().filter(({ project }) => isWorkspace(project)));
  const allChats = () => computer() ? computerChats() : conduitChats();
  // The places the current side's chats live in, for its filter.
  const places = createMemo(() => props.projects
    .filter((project) => computer() ? isWorkspace(project) : !isWorkspace(project))
    .filter((project) => project.sessions.some((chat) => chat.status === "active"))
    .map((project) => ({ id: project.id, label: project.slug === "chat" ? "No folder" : project.name, project })));
  const chats = createMemo(() => {
    const sort = chatSort();
    return allChats()
      .filter(({ chat }) => !unreadOnly() || chat.unread)
      .filter(({ chat }) => !profile() || profileOf(props.profiles, chat) === profile())
      .filter(({ project }) => !place() || project.id === place())
      .sort((left, right) => compareChatsBySort(left.chat, right.chat, sort));
  });
  const chatTime = (chat: ChatSummary) => Date.parse((chatSort() === "created" ? chat.createdAt : chat.lastMessageAt || chat.createdAt) || "") || 0;
  const grouped = createMemo(() => groupByDay(chats().slice(0, limit()), (row) => chatTime(row.chat), now()));
  const running = createMemo(() => everyChat().filter(({ chat }) => props.runtime.getProcess(chat.id)?.active).length);
  const unread = createMemo(() => allChats().filter(({ chat }) => chat.unread).length);
  const folderLive = (project: Project) => project.sessions.some((chat) => props.runtime.getProcess(chat.id)?.active);

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
  const terminalAge = (terminal: Pty) => shortAge(Date.parse(terminal.lastActivityAt || terminal.updatedAt || terminal.createdAt || "") || 0, now());

  const chatRow = ({ chat, project }: { chat: ChatSummary; project: Project }) => {
    const process = () => props.runtime.getProcess(chat.id);
    const live = () => process()?.active ? activityLabel(runtimeActivity(process()) || "working", activityDetail(process())) : "";
    const where = () => project.slug === "chat" ? "" : project.name;
    return <ContextMenu><ContextMenuTrigger as={SplitRow} element="button" onPointerEnter={() => props.onPrefetchChat(chat)} onFocus={() => props.onPrefetchChat(chat)} onClick={() => props.onOpenChat(chat, project)}
        lead={<RuntimeIndicator process={process()} stale={props.runtime.stale()} unread={chat.unread} fallback={<ThreadHarnessMark id={chat.harnessId} lively />} />}
        primary={chat.title || "Untitled chat"}
        context={<>{live() && <span class="app-dashboard-activity">{live()}</span>}{live() && where() ? " · " : ""}{where()}</>}
        trailing={<time dateTime={chat.lastMessageAt || chat.createdAt}>{shortAge(Date.parse(chat.lastMessageAt || chat.createdAt || "") || 0, now())}</time>} />
      <ContextMenuContent class="w-60 sidebar-context-menu"><ContextMenuGroup>
        <ContextMenuItem onSelect={() => props.onContextAction("rename-chat", { chat, project })}><PencilIcon />{commandLabel(COMMAND_IDS.renameChat)}</ContextMenuItem>
        <ContextMenuItem onSelect={() => props.onContextAction("move-chat", { chat, project })}><FolderInputIcon />Move to folder…</ContextMenuItem>
        <ContextMenuItem onSelect={() => props.onContextAction("copy-chat", { chat })}><ClipboardCopyIcon />{commandLabel(COMMAND_IDS.copyTranscript)}</ContextMenuItem>
        <ContextMenuItem onSelect={() => props.onOpenChatTerminal(chat, project)}><TerminalIcon />Open terminal</ContextMenuItem>
        <Show when={isConduitManagedProject(project)}><ContextMenuItem onSelect={() => props.onContextAction("pin-chat", { chat })}><Show when={props.isPinned("chat", chat.id)} fallback={<><PinIcon />Pin to sidebar</>}><PinOffIcon />Unpin</Show></ContextMenuItem></Show>
      </ContextMenuGroup><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => props.onContextAction("delete-chat", { chat, project })}><Trash2Icon />{commandLabel(COMMAND_IDS.deleteChat)}</ContextMenuItem></ContextMenuContent></ContextMenu>;
  };

  const projectMenu = (project: Project) => <ContextMenuContent class="w-56 sidebar-context-menu"><ContextMenuGroup>
    <ContextMenuItem onSelect={() => props.onNewChat(project)}><MessageSquarePlusIcon />{commandLabel(COMMAND_IDS.newChat)}</ContextMenuItem>
    <ContextMenuItem onSelect={() => props.onContextAction("rename-folder", { project })}><PencilIcon />Rename</ContextMenuItem>
    <Show when={isWorkspace(project)}><ContextMenuItem onSelect={() => props.onOpenWorkspaceIdentity(project)}><PaletteIcon />Identity</ContextMenuItem></Show>
    <ContextMenuItem onSelect={() => props.onOpenWorkspaceSettings(project)}><Settings2Icon />Settings</ContextMenuItem>
    <ContextMenuSub>
      <ContextMenuSubTrigger disabled={!project.sessions.length}><FolderInputIcon />Move chats to…</ContextMenuSubTrigger>
      <ContextMenuSubContent class="w-48 sidebar-context-menu">
        <For each={props.projects.filter((target) => target.id !== project.id)}>{(target) =>
          <ContextMenuItem onSelect={() => props.onMoveProjectChats(project, target)}>{target.name}</ContextMenuItem>}
        </For>
      </ContextMenuSubContent>
    </ContextMenuSub>
  </ContextMenuGroup><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => props.onContextAction("delete-project", { project })}><Trash2Icon />{isWorkspace(project) ? "Unlink workspace" : "Delete project"}</ContextMenuItem></ContextMenuContent>;

  const openProject = (event: MouseEvent, project: Project) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    props.onOpenProject(project);
  };

  // Built inside SplitDashboard, so it reads the pane's width.
  const chatsGroup = () => <SplitGroup id="app-dashboard-chats" order="list"
    heading={<div class="split-heading-switches">
      <Segmented label="Chats" value={unreadOnly() ? "unread" : "all"} onChange={(value) => { setUnreadOnly(value === "unread"); setLimit(CHAT_PAGE); }} options={[
        { value: "all", label: "All", detail: <small>{allChats().length}</small> },
        { value: "unread", label: "Unread", detail: <small>{unread()}</small> },
      ]} />
      <Segmented label="Where" value={side()} onChange={(value) => chooseSide(value as "conduit" | "computer")} options={[
        { value: "conduit", label: "Conduit", detail: <small>{conduitChats().length}</small> },
        { value: "computer", label: "Computer", detail: <small>{computerChats().length}</small> },
      ]} />
    </div>}
    actions={<FilterBar choices={[
      placeChoice(computer() ? "Workspace" : "Project", computer() ? "All workspaces" : "All projects", places(), place(), (id) => { setPlace(id); setLimit(CHAT_PAGE); }),
      profileChoice(props.profiles, new Set(allChats().map(({ chat }) => profileOf(props.profiles, chat))), profile(), (id) => { setProfile(id); setLimit(CHAT_PAGE); }),
      sortChoice(chatSort(), saveChatSort),
    ]}><ListSearch label="Search chats" onClick={() => props.onSearchChats("all")} /></FilterBar>}
    compactHeading={<CompactHeading label={unreadOnly() ? "Unread" : "Recent chats"} count={chats().length} where={computer() ? "Computer" : "Conduit"} />}
    compactActions={<>
      <FiltersMenu choices={[
        { label: "Show", value: unreadOnly() ? "unread" : "all", onChange: (value) => { setUnreadOnly(value === "unread"); setLimit(CHAT_PAGE); }, options: [
          { value: "all", label: "All", detail: allChats().length },
          { value: "unread", label: "Unread", detail: unread() },
        ] },
        { label: "Where", value: side(), onChange: (value) => chooseSide(value as "conduit" | "computer"), options: [
          { value: "conduit", label: "Conduit", detail: conduitChats().length },
          { value: "computer", label: "Computer", detail: computerChats().length },
        ] },
        placeChoice(computer() ? "Workspace" : "Project", computer() ? "All workspaces" : "All projects", places(), place(), (id) => { setPlace(id); setLimit(CHAT_PAGE); }),
        profileChoice(props.profiles, new Set(allChats().map(({ chat }) => profileOf(props.profiles, chat))), profile(), (id) => { setProfile(id); setLimit(CHAT_PAGE); }),
        sortChoice(chatSort(), saveChatSort),
      ]} />
      <ListSearch label="Search chats" onClick={() => props.onSearchChats("all")} />
    </>}
    more={<ShowMore total={chats().length} shown={limit()} onMore={() => setLimit((value) => value + CHAT_PAGE)} />}>
    <Show when={chats().length} fallback={<SplitEmpty>{unreadOnly() ? "Nothing unread." : "Nothing here yet."}</SplitEmpty>}>
      <DayGroups groups={grouped()}>{chatRow}</DayGroups>
    </Show>
  </SplitGroup>;

  // Project folders, drawn as folders rather than rows: they are places, and
  // it keeps them apart from workspaces, which carry more on a row. The shelf
  // wraps to two rows at most; Show all opens the rest.
  const [shelfAll, setShelfAll] = createSignal(false);
  const [shelfOver, setShelfOver] = createSignal(false);
  const watchShelf = (shelf: HTMLDivElement) => {
    const measure = () => setShelfOver(shelf.scrollHeight > shelf.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(shelf);
    const mutations = new MutationObserver(measure);
    mutations.observe(shelf, { childList: true });
    onCleanup(() => { observer.disconnect(); mutations.disconnect(); });
  };
  const foldersGroup = () => <SplitGroup id="app-dashboard-projects" label="Projects" count={folders().length} order="first" class="app-dashboard-projects"
    actions={<Show when={shelfOver() || shelfAll()}><button type="button" onClick={() => setShelfAll((value) => !value)}>{shelfAll() ? "Show less" : "Show all"}</button></Show>}>
    <div class="app-folder-shelf" ref={watchShelf} data-all={shelfAll() ? "" : undefined}>
      <For each={folders()}>{(project) =>
        <ContextMenu><ContextMenuTrigger as="a" class="app-folder" href={projectPath(project)} title={project.workingRoot} onPointerEnter={() => props.onPrefetchProject(project)} onFocus={() => props.onPrefetchProject(project)} onClick={(event: MouseEvent) => openProject(event, project)}>
          <FolderMark />
          <Show when={folderLive(project)}><span class="app-folder-live" aria-label="Running" /></Show>
          <span class="app-folder-name">{project.name}</span>
          <span class="app-folder-meta">{project.sessions.filter((chat) => chat.status === "active").length} chats{latestActivity(project) ? ` · ${shortAge(latestActivity(project), now())}` : ""}</span>
        </ContextMenuTrigger>{projectMenu(project)}</ContextMenu>}
      </For>
      <button type="button" class="app-folder app-folder-new" onClick={() => props.onContextAction("new-folder", {})}>
        <FolderPlusIcon />
        <span class="app-folder-name">New project</span>
      </button>
    </div>
  </SplitGroup>;

  const workspacesGroup = () => <SplitGroup id="app-dashboard-workspaces" label="Workspaces" count={props.projects.filter(isWorkspace).length} actions={<button type="button" onClick={() => props.onContextAction("new-workspace", {})}>New</button>}>
    <Show when={workspaces().length} fallback={<SplitEmpty>Nothing here yet.</SplitEmpty>}>
      <For each={workspaces()}>{(project) =>
        <ContextMenu><ContextMenuTrigger as={SplitRow} element="a" href={projectPath(project)} onPointerEnter={() => props.onPrefetchProject(project)} onFocus={() => props.onPrefetchProject(project)} onClick={(event: MouseEvent) => openProject(event, project)}
            lead={<WorkspaceGlyph appearance={project.workspaceAppearance} />} primary={project.name}
            context={<Show when={folderLive(project)} fallback={`${project.sessions.filter((chat) => chat.status === "active").length} chats`}><span class="app-dashboard-activity">Running</span></Show>}
            trailing={shortAge(latestActivity(project), now())} />{projectMenu(project)}</ContextMenu>}
      </For>
    </Show>
  </SplitGroup>;

  const terminalsGroup = () => <SplitGroup id="app-dashboard-terminals" label="Terminals" collapsible count={terminals().length} busy={loading()} actions={<button type="button" onClick={props.onOpenTerminalView}>Open</button>}>
    <Show when={terminals().length} fallback={<SplitEmpty>{loading() ? "Loading terminals…" : "No live terminals."}</SplitEmpty>}>
      <For each={terminals()}>{(terminal) =>
        <ContextMenu><ContextMenuTrigger as={SplitRow} element="button" onPointerEnter={props.onPrefetchTerminal} onFocus={props.onPrefetchTerminal} onClick={() => props.onOpenTerminal(terminal)}
            lead={<TerminalIcon />} primary={terminal.title || "Shell"} context={`${terminal.currentCommand || "shell"} · ${terminalScope(terminal)?.name || "Unscoped"}`} trailing={terminalAge(terminal)} />
          <ContextMenuContent class="w-52 sidebar-context-menu"><ContextMenuGroup>
            <ContextMenuItem onSelect={() => props.onOpenTerminalMaximized(terminal)}><TerminalIcon />Open maximized</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onContextAction("rename-terminal", { terminal })}><PencilIcon />Rename</ContextMenuItem>
          </ContextMenuGroup><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => props.onContextAction("delete-terminal", { terminal })}><Trash2Icon />Destroy shell</ContextMenuItem></ContextMenuContent></ContextMenu>}
      </For>
    </Show>
  </SplitGroup>;

  return <SplitDashboard class="app-dashboard" page="Dashboard" label="Conduit dashboard"
    header={<SplitHeader title="Conduit" context={[
      running() ? `${running()} running` : "Nothing running",
      unread() ? `${unread()} unread` : null,
    ]} />}
    shortcuts={<SplitShortcuts items={[
      { icon: <SearchIcon />, label: "Search chats", onClick: () => props.onSearchChats("all") },
      { icon: <FolderPlusIcon />, label: "New project", onClick: () => props.onContextAction("new-folder", {}) },
      { icon: <TerminalIcon />, label: "Terminal", onClick: props.onOpenTerminalView },
      { icon: <Settings2Icon />, label: "Settings", onClick: props.onOpenSettings },
    ]} />}
    composer={props.composer}
    list={chatsGroup()}
    aside={<>{foldersGroup()}{workspacesGroup()}{terminalsGroup()}</>} />;
}
