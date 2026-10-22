import { harnessMarkLabelFor } from "../harness-brand";
import { ThreadHarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { isConduitManagedProject } from "../navigation/sidebar-preferences";
import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";

import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger, MenuSection } from "@/components/menus";
import { ContextMenu as MenuHost, ContextMenuContent as MenuContent, ContextMenuTrigger as MenuTrigger } from "@/components/menus";
import { ChatMenuFor, PlaceMenuFor, type ItemActions } from "../navigation/item-menus";
import { api, projectPath } from "../api/client";
import type { ChatSummary, Project, Template } from "../api/contracts";
import { activityDetail, runtimeActivity, RuntimeIndicator } from "../navigation/runtime-indicator";
import { activityLabel } from "../../activity.js";

import type { Pty } from "../remotes/terminal-pane";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import type { RuntimeStore } from "../state/runtime";
import type { SidebarCommand } from "../navigation/sidebar";
import { COMMAND_IDS, commandLabel } from "../commands/command-registry";
import { compareChatsBySort, saveChatSort, useChatSort } from "../preferences/chat-sort";
import { FolderShelf, FolderTile, GroupAction, GroupSwitches } from "@/components/ui/dashboard";
import { Segmented } from "@/components/ui/controls";
import { CHAT_PAGE, DayGroups, FilterBar, groupByDay, ListSearch, CompactHeading, FiltersMenu, placeChoice, profileChoice, profileOf, ShowMore, sortChoice } from "./primitives/chat-list";
import { SplitDashboard, SplitEmpty, SplitGroup, SplitHeader, SplitRow } from "./primitives/split";

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
  /** What a chat's and a place's menu do. */
  menus: ItemActions;
  onOpenTerminal: (terminal: Pty) => void;
  onOpenTerminalMaximized: (terminal: Pty) => void;
  onPrefetchTerminal: () => void;
  onSearchChats: (scope: "unscoped" | "all") => void;
  onOpenTerminalView: () => void;
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
    return <MenuHost><MenuTrigger as={SplitRow} element="button" draggable="true" data-doc-view={`chat:${chat.id}`} onPointerEnter={() => props.onPrefetchChat(chat)} onFocus={() => props.onPrefetchChat(chat)} onClick={() => props.onOpenChat(chat, project)}
        lead={<RuntimeIndicator process={process()} stale={props.runtime.stale()} unread={chat.unread} fallback={<ThreadHarnessMark id={chat.harnessId} label={harnessMarkLabelFor(chat.harnessId)} lively />} />}
        primary={chat.title || "Untitled chat"}
        context={<>{live()}{live() && where() ? " · " : ""}{where()}</>}
        trailing={<time dateTime={chat.lastMessageAt || chat.createdAt}>{shortAge(Date.parse(chat.lastMessageAt || chat.createdAt || "") || 0, now())}</time>} />
      <MenuContent><ChatMenuFor chat={chat} project={project} actions={props.menus} /></MenuContent></MenuHost>;
  };

  const projectMenu = (project: Project) => <MenuContent><PlaceMenuFor project={project} actions={props.menus} /></MenuContent>;

  const openProject = (event: MouseEvent, project: Project) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    props.onOpenProject(project);
  };

  // Built inside SplitDashboard, so it reads the pane's width.
  const chatsGroup = () => <SplitGroup id="app-dashboard-chats" order="list"
    heading={<GroupSwitches>
      <Segmented arrows label="Chats" value={unreadOnly() ? "unread" : "all"} onChange={(value) => { setUnreadOnly(value === "unread"); setLimit(CHAT_PAGE); }} options={[
        { value: "all", label: "All", count: allChats().length },
        { value: "unread", label: "Unread", count: unread() },
      ]} />
      <Segmented arrows label="Where" value={side()} onChange={(value) => chooseSide(value as "conduit" | "computer")} options={[
        { value: "conduit", label: "Conduit", count: conduitChats().length },
        { value: "computer", label: "Computer", count: computerChats().length },
      ]} />
    </GroupSwitches>}
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
    // Folders added change what overflows without resizing the shelf. Checked
    // once a frame: once per folder laid the page out per folder while the
    // first open was still building it.
    let frame = 0;
    const mutations = new MutationObserver(() => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; measure(); }); });
    mutations.observe(shelf, { childList: true });
    onCleanup(() => { cancelAnimationFrame(frame); observer.disconnect(); mutations.disconnect(); });
  };
  const foldersGroup = () => <SplitGroup id="app-dashboard-projects" label="Projects" count={folders().length} order="first"
    actions={<Show when={shelfOver() || shelfAll()}><GroupAction onClick={() => setShelfAll((value) => !value)}>{shelfAll() ? "Show less" : "Show all"}</GroupAction></Show>}>
    <FolderShelf ref={watchShelf} all={shelfAll()}>
      <For each={folders()}>{(project) =>
        <MenuHost><MenuTrigger as={FolderTile} element="a" href={projectPath(project)} title={project.workingRoot} onPointerEnter={() => props.onPrefetchProject(project)} onFocus={() => props.onPrefetchProject(project)} onClick={(event: MouseEvent) => openProject(event, project)}
          name={project.name} live={folderLive(project)}
          meta={`${project.sessions.filter((chat) => chat.status === "active").length} chats${latestActivity(project) ? ` · ${shortAge(latestActivity(project), now())}` : ""}`} />{projectMenu(project)}</MenuHost>}
      </For>
      <FolderTile element="button" icon={<Icons.NewFolder />} name="New project" onClick={() => props.onContextAction("new-folder", {})} />
    </FolderShelf>
  </SplitGroup>;

  const workspacesGroup = () => <SplitGroup id="app-dashboard-workspaces" label="Workspaces" count={props.projects.filter(isWorkspace).length} actions={<GroupAction onClick={() => props.onContextAction("new-workspace", {})}>New</GroupAction>}>
    <Show when={workspaces().length} fallback={<SplitEmpty>Nothing here yet.</SplitEmpty>}>
      <For each={workspaces()}>{(project) =>
        <MenuHost><MenuTrigger as={SplitRow} element="a" href={projectPath(project)} onPointerEnter={() => props.onPrefetchProject(project)} onFocus={() => props.onPrefetchProject(project)} onClick={(event: MouseEvent) => openProject(event, project)}
            lead={<WorkspaceGlyph appearance={project.workspaceAppearance} />} primary={project.name}
            context={<Show when={folderLive(project)} fallback={`${project.sessions.filter((chat) => chat.status === "active").length} chats`}>Running</Show>}
            trailing={shortAge(latestActivity(project), now())} />{projectMenu(project)}</MenuHost>}
      </For>
    </Show>
  </SplitGroup>;

  const terminalsGroup = () => <SplitGroup id="app-dashboard-terminals" label="Terminals" collapsible count={terminals().length} busy={loading()} actions={<GroupAction onClick={props.onOpenTerminalView}>Open</GroupAction>}>
    <Show when={terminals().length} fallback={<SplitEmpty>{loading() ? "Loading terminals…" : "No live terminals."}</SplitEmpty>}>
      <For each={terminals()}>{(terminal) =>
        <ContextMenu><ContextMenuTrigger as={SplitRow} element="button" onPointerEnter={props.onPrefetchTerminal} onFocus={props.onPrefetchTerminal} onClick={() => props.onOpenTerminal(terminal)}
            lead={<Icons.Terminal />} primary={terminal.title || "Shell"} context={`${terminal.currentCommand || "shell"} · ${terminalScope(terminal)?.name || (/^(computer|device)(:|$)/.test(terminal.projectId) ? terminal.cwd || "Computer" : "Unscoped")}`} trailing={terminalAge(terminal)} />
          <ContextMenuContent><ContextMenuGroup>
            <ContextMenuItem onSelect={() => props.onOpenTerminalMaximized(terminal)}><Icons.Terminal />Open maximized</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onContextAction("rename-terminal", { terminal })}><Icons.Edit />Rename</ContextMenuItem>
          </ContextMenuGroup><MenuSection><ContextMenuItem variant="destructive" onSelect={() => props.onContextAction("delete-terminal", { terminal })}><Icons.Delete />Destroy shell</ContextMenuItem></MenuSection></ContextMenuContent></ContextMenu>}
      </For>
    </Show>
  </SplitGroup>;

  return <SplitDashboard page="Dashboard" label="Conduit dashboard"
    header={<SplitHeader title="Conduit" context={[
      running() ? `${running()} running` : "Nothing running",
      unread() ? `${unread()} unread` : null,
    ]} />}
    composer={props.composer}
    list={chatsGroup()}
    aside={<>{foldersGroup()}{workspacesGroup()}{terminalsGroup()}</>} />;
}
