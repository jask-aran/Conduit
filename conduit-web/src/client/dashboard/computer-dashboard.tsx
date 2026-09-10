import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ArrowRightIcon, ArrowUpIcon, ChevronDownIcon, CopyIcon, EyeIcon, EyeOffIcon, FolderIcon, GitBranchIcon, Grid2X2Icon, HomeIcon, ListIcon, PaletteIcon, PencilIcon, PlusIcon, RefreshCwIcon, SearchIcon, SquareIcon, TerminalIcon, UnlinkIcon, XIcon } from "lucide-solid";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger, Menu, MenuContent, MenuGroup, MenuItem, MenuTrigger } from "@/components/primitives";
import { api } from "../api/client";
import type { ChatSummary, ComputerLocation, HarnessSummary, HarnessThread, HarnessThreadDiscovery, HarnessThreadGroup, Project } from "../api/contracts";
import { isConduitManagedProject } from "../navigation/sidebar-preferences";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import { FileTypeIcon } from "../workspace/file-type-icon";
import { HarnessMark } from "../harness-brand";
import { Transcript } from "../chat/transcript";
import { selectedMarkdownRenderer } from "../chat/markdown-settings";
import { createDriveChat } from "../state/drive-chat";
import { Composer } from "../chat/composer";
import { loadVoiceDictationSettings } from "../chat/voice-dictation.js";
import type { RuntimeStore } from "../state/runtime";
import "./app-dashboard.css";

type Entry = { name: string; path: string; type: "directory" | "file" | "other" };
type Listing = { entries: Entry[]; cursor?: string | null; oversize?: boolean };
export function ComputerDashboard(props: {
  projects: Project[];
  location: ComputerLocation | null;
  loading: boolean;
  error: string;
  onBrowse: (path?: string) => void;
  onPrefetch: (path: string) => void;
  onMakeWorkspace: () => void;
  onCreateWorkspace: (path: string) => void;
  onOpenWorkspace: (project: Project) => void;
  onManageWorkspace: (action: "rename" | "identity" | "unlink", project: Project) => void;
  onStartWorkspaceAction: (action: "created" | "cloned", path: string) => void;
  onOpenView: (view: "files" | "diff" | "terminal") => void;
  onOpenTerminalView?: () => void;
  onOpenTerminalHere?: () => void;
  onOpenFile: (path: string) => void;
  runtime?: RuntimeStore;
  selectedHarness?: string | null;
  onOpenHarness?: (id: string | null) => void;
  onOpenHarnessHere?: (id: string, cwd: string) => void;
  onOpenHarnessChat?: (chat: ChatSummary, project: Project, prompt?: string) => void;
  onLaunchHarnessChat?: (harness: HarnessSummary, cwd: string, prompt?: string) => Promise<void>;
  dialog?: boolean;
  onSelectFolder?: () => void;
  onCreateFolder?: () => void;
  onCloneRepository?: () => void;
}) {
  const [address, setAddress] = createSignal("");
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");
  const [showHidden, setShowHidden] = createSignal(false);
  const [listingError, setListingError] = createSignal("");
  const [refreshing, setRefreshing] = createSignal(false);
  const [view, setView] = createSignal<"tiles" | "details">("tiles");
  const [order, setOrder] = createSignal<"name" | "name-desc" | "type">("name");
  const [sidebarWidth, setSidebarWidth] = createSignal(Number(localStorage.getItem("conduit.computer.sidebar-width")) || 168);
  const [harnesses, setHarnesses] = createSignal<HarnessSummary[]>([]);
  let controller: AbortController | undefined;
  let stopSidebarResize: (() => void) | undefined;

  const workspaces = () => props.projects.filter((project) => !isConduitManagedProject(project));
  const designated = () => workspaces().find((project) => project.workingRoot === props.location?.project.workingRoot);
  const workspaceFor = (entry: Entry) => entry.type === "directory"
    ? workspaces().find((project) => project.workingRoot === `${props.location?.project.workingRoot}/${entry.path}`)
    : undefined;
  const visibleEntries = createMemo(() => {
    const filter = query().trim().toLowerCase();
    const filtered = entries().filter((entry) => (showHidden() || !entry.name.startsWith(".")) && (!filter || entry.name.toLowerCase().includes(filter)));
    return filtered.sort((left, right) => order() === "type"
      ? left.type.localeCompare(right.type) || left.name.localeCompare(right.name)
      : (order() === "name-desc" ? -1 : 1) * left.name.localeCompare(right.name));
  });

  createEffect(() => {
    const location = props.location;
    controller?.abort();
    controller = new AbortController();
    setAddress(location?.project.workingRoot || "");
    setEntries(location?.listing.entries || []);
    setCursor(location?.listing.cursor || null);
    setListingError(location?.listing.oversize ? "This folder is too large to list. Enter a smaller path." : "");
    setRefreshing(false);
  });
  createEffect(() => {
    if (props.dialog) return;
    void api<{ harnesses: HarnessSummary[] }>("/v0/harnesses").then((result) => setHarnesses(result.harnesses));
  });
  onCleanup(() => { controller?.abort(); stopSidebarResize?.(); });

  const go = () => {
    const value = address().trim();
    if (!value || value === "~") props.onBrowse();
    else if (value.startsWith("~/")) props.onBrowse(`${props.location?.home}/${value.slice(2)}`);
    else props.onBrowse(value.startsWith("/") ? value : `${props.location?.project.workingRoot}/${value}`);
  };
  const refresh = async (after?: string) => {
    const location = props.location;
    if (!location || !controller) return;
    setRefreshing(true);
    setListingError("");
    try {
      const listing = await api<Listing>(`/v0/projects/${encodeURIComponent(location.project.id)}/tree${after ? `?after=${encodeURIComponent(after)}` : ""}`, { signal: controller.signal });
      setEntries((current) => after ? [...current, ...listing.entries] : listing.entries);
      setCursor(listing.cursor || null);
      if (listing.oversize) setListingError("This folder is too large to list. Enter a smaller path.");
    } catch (error) {
      if (!controller.signal.aborted) setListingError(error instanceof Error ? error.message : "Folder could not be read");
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  };
  const openEntry = (entry: Entry) => {
    if (entry.type === "directory") props.onBrowse(`${props.location!.project.workingRoot}/${entry.path}`);
    else if (entry.type === "file") props.onOpenFile(entry.path);
  };
  const copyPath = (path: string) => void navigator.clipboard.writeText(path);
  const startSidebarResize = (event: PointerEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth();
    const move = (moveEvent: PointerEvent) => setSidebarWidth(Math.min(280, Math.max(120, startWidth + moveEvent.clientX - startX)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      localStorage.setItem("conduit.computer.sidebar-width", String(sidebarWidth()));
      stopSidebarResize = undefined;
    };
    stopSidebarResize = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  };
  // The harness dashboard scopes its thread list from this same Locations rail,
  // so the scope lives here rather than in a second sidebar of its own.
  const [harnessScope, setHarnessScope] = createSignal<string | null>(null);
  const [harnessFolders, setHarnessFolders] = createSignal<{ path: string; display: string }[]>([]);
  createEffect(() => { props.selectedHarness; setHarnessScope(null); setHarnessFolders([]); });
  const harnessFolderShortcuts = () => harnessFolders().filter((folder) => !workspaces().some((project) => project.workingRoot === folder.path));
  const selectedHarnessLabel = () => harnesses().find((item) => item.id === props.selectedHarness)?.label || "harness";

  const WorkspaceActions = () => <>
    <button type="button" disabled={!props.location || props.loading} onClick={() => props.dialog ? props.onSelectFolder?.() : props.onMakeWorkspace()}><FolderIcon />{props.dialog ? "Select folder" : designated() ? "Open workspace" : "Make workspace"}</button>
    <button type="button" disabled={!props.location || props.loading} onClick={() => props.dialog ? props.onCreateFolder?.() : props.onStartWorkspaceAction("created", props.location!.project.workingRoot)}><PlusIcon />Create folder</button>
    <button type="button" disabled={!props.location || props.loading} onClick={() => props.dialog ? props.onCloneRepository?.() : props.onStartWorkspaceAction("cloned", props.location!.project.workingRoot)}><GitBranchIcon />Clone repository</button>
  </>;

  return <div class="computer-dashboard" data-dialog={props.dialog ? "true" : undefined}>
    <section class="computer-explorer" aria-label="Computer files" style={{ "--computer-sidebar-width": `${sidebarWidth()}px` }}>
      <aside class="computer-explorer-sidebar">
        <h2>Locations</h2>
        <ContextMenu><ContextMenuTrigger as="button" type="button" data-active={props.location?.project.workingRoot === props.location?.home} onClick={() => props.onBrowse()}><HomeIcon /><span>Home</span></ContextMenuTrigger><ContextMenuContent><ContextMenuGroup><ContextMenuItem onSelect={() => props.onBrowse()}><FolderIcon />Open</ContextMenuItem><ContextMenuItem onSelect={() => copyPath(props.location?.home || "")}><CopyIcon />Copy path</ContextMenuItem></ContextMenuGroup></ContextMenuContent></ContextMenu>
        <Show when={!props.dialog}><button type="button" onClick={props.onOpenTerminalView}><TerminalIcon /><span>Terminal</span></button></Show>
        <Show when={props.selectedHarness}>
          <button type="button" data-active={harnessScope() === null} onClick={() => setHarnessScope(null)}><ListIcon /><span>All threads</span></button>
        </Show>
        <h2>Workspaces</h2>
        <div class="computer-workspace-shortcuts"><For each={workspaces()}>{(project) =>
          <ContextMenu><ContextMenuTrigger as="button" type="button" data-active={props.selectedHarness ? harnessScope() === project.workingRoot : props.location?.project.workingRoot === project.workingRoot} title={project.workingRoot} onClick={() => props.selectedHarness ? setHarnessScope(project.workingRoot) : props.onBrowse(project.workingRoot)}><WorkspaceGlyph appearance={project.workspaceAppearance} /><span>{project.name}</span></ContextMenuTrigger><ContextMenuContent><ContextMenuGroup>
            <ContextMenuItem onSelect={() => props.onBrowse(project.workingRoot)}><FolderIcon />Browse in Computer</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onOpenWorkspace(project)}><WorkspaceGlyph appearance={project.workspaceAppearance} />Open workspace</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onManageWorkspace("rename", project)}><PencilIcon />Rename workspace</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onManageWorkspace("identity", project)}><PaletteIcon />Workspace identity</ContextMenuItem>
            <ContextMenuItem onSelect={() => copyPath(project.workingRoot)}><CopyIcon />Copy path</ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => props.onManageWorkspace("unlink", project)}><UnlinkIcon />Unlink workspace</ContextMenuItem>
          </ContextMenuGroup></ContextMenuContent></ContextMenu>
        }</For></div>
        <Show when={!workspaces().length}><p>No workspaces</p></Show>
        <Show when={props.selectedHarness && harnessFolderShortcuts().length}>
          <h2>Folders from {selectedHarnessLabel()}</h2>
          <div class="computer-workspace-shortcuts"><For each={harnessFolderShortcuts()}>{(folder) =>
            <button type="button" data-active={harnessScope() === folder.path} title={folder.path} onClick={() => setHarnessScope(folder.path)}><FolderIcon /><span>{folder.display}</span></button>
          }</For></div>
        </Show>
      </aside>
      <div class="computer-sidebar-resize" role="separator" aria-label="Resize locations sidebar" aria-orientation="vertical" aria-valuemin="120" aria-valuemax="280" aria-valuenow={sidebarWidth()} onPointerDown={startSidebarResize} />

      <Show when={!props.selectedHarness} fallback={<HarnessDashboard harness={harnesses().find((item) => item.id === props.selectedHarness)} projects={workspaces()} cwd={props.location?.project.workingRoot || ""} runtime={props.runtime} scope={harnessScope()} onScope={setHarnessScope} onFolders={setHarnessFolders} onOpenChat={props.onOpenHarnessChat} onLaunchChat={props.onLaunchHarnessChat} />}>
      <div class="computer-explorer-main">
        <div class="computer-explorer-toolbar">
          <button type="button" aria-label="Home folder" title="Home folder" disabled={props.loading} onClick={() => props.onBrowse()}><HomeIcon /></button>
          <button type="button" aria-label="Parent folder" title="Parent folder" disabled={props.loading || !props.location || props.location.parent === props.location.project.workingRoot} onClick={() => props.onBrowse(props.location!.parent)}><ArrowUpIcon /></button>
          <input class="computer-address" aria-label="Folder path" value={address()} onInput={(event) => setAddress(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); go(); } }} />
          <label class="computer-search"><SearchIcon /><input type="search" aria-label="Search this folder" placeholder="Search" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} /></label>
          <select aria-label="Order files" value={order()} onChange={(event) => setOrder(event.currentTarget.value as "name" | "name-desc" | "type")}><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="type">Type</option></select>
          <button type="button" aria-label={view() === "tiles" ? "Use details view" : "Use tile view"} title={view() === "tiles" ? "Details view" : "Tile view"} onClick={() => setView((value) => value === "tiles" ? "details" : "tiles")}><Show when={view() === "tiles"} fallback={<Grid2X2Icon />}><ListIcon /></Show></button>
          <button type="button" aria-label="Refresh folder" title="Refresh folder" disabled={refreshing()} onClick={() => void refresh()}><RefreshCwIcon /></button>
          <button type="button" aria-label={showHidden() ? "Hide hidden files" : "Show hidden files"} title={showHidden() ? "Hide hidden files" : "Show hidden files"} aria-pressed={showHidden()} onClick={() => setShowHidden((value) => !value)}><Show when={showHidden()} fallback={<EyeOffIcon />}><EyeIcon /></Show></button>
          <span class="computer-item-count">{visibleEntries().length} items</span>
        </div>
        <div class="computer-explorer-actions" role="toolbar" aria-label="Folder actions">
          <Show when={props.location?.repositoryRoot}><span class="computer-repository-summary" title={props.location?.repositoryRoot || ""}><GitBranchIcon />{props.location?.repositoryRoot?.split("/").at(-1)}</span></Show>
          <span class="computer-actions-spacer" />
          <WorkspaceActions />
          <Show when={!props.dialog}>
            <button type="button" disabled={!props.location || props.loading} onClick={props.onOpenTerminalHere}><TerminalIcon />Terminal Here</button>
            <Show when={harnesses().some((item) => item.available)}><Menu><MenuTrigger disabled={!props.location || props.loading} aria-label="Open harness here"><TerminalIcon />Harness Here<ChevronDownIcon /></MenuTrigger><MenuContent class="computer-harness-menu"><MenuGroup><For each={harnesses().filter((item) => item.available)}>{(harness) =>
              <MenuItem onSelect={() => props.onOpenHarnessHere?.(harness.id, props.location!.project.workingRoot)}><HarnessMark id={harness.id} class="computer-harness-mark" />Open {harness.label} here</MenuItem>
            }</For></MenuGroup></MenuContent></Menu></Show>
            <button type="button" disabled={!props.location?.repository || props.loading} onClick={() => props.onOpenView("diff")}><GitBranchIcon />Source Control</button>
          </Show>
        </div>

        <Show when={props.error || listingError()}><p class="computer-error" role="alert">{props.error || listingError()}</p></Show>
        <ContextMenu><ContextMenuTrigger as="div" class="computer-file-grid" data-view={view()} aria-busy={props.loading || refreshing()}>
          <Show when={view() === "details"}><div class="computer-detail-heading"><span>Name</span><span>Type</span></div></Show>
          <For each={visibleEntries()}>{(entry) =>
            <ContextMenu><ContextMenuTrigger as="button" type="button" disabled={entry.type === "other" || props.loading} title={entry.name} onPointerEnter={() => entry.type === "directory" && props.onPrefetch(entry.path)} onFocus={() => entry.type === "directory" && props.onPrefetch(entry.path)} onClick={() => openEntry(entry)}>
              <Show when={entry.type === "directory"} fallback={<FileTypeIcon name={entry.name} />}><FolderIcon /></Show>
              <span>{entry.name}</span>
              <Show when={workspaceFor(entry)}>{(workspace) => <span class="computer-file-workspace-mark" title={`${workspace().name} workspace`}><WorkspaceGlyph appearance={workspace().workspaceAppearance} /></span>}</Show>
              <Show when={view() === "details"}><small>{entry.type === "directory" ? "Folder" : entry.type === "file" ? "File" : "Other"}</small></Show>
            </ContextMenuTrigger><ContextMenuContent><ContextMenuGroup>
              <ContextMenuItem onSelect={() => openEntry(entry)}><FolderIcon />Open</ContextMenuItem>
              <Show when={!props.dialog && entry.type === "directory"}><For each={harnesses().filter((item) => item.available)}>{(harness) => <ContextMenuItem onSelect={() => props.onOpenHarnessHere?.(harness.id, `${props.location!.project.workingRoot}/${entry.path}`)}><HarnessMark id={harness.id} class="computer-harness-mark" />Open {harness.label} here</ContextMenuItem>}</For></Show>
              <Show when={!props.dialog && entry.type === "directory" && !workspaceFor(entry)}><ContextMenuItem onSelect={() => props.onCreateWorkspace(`${props.location!.project.workingRoot}/${entry.path}`)}><PlusIcon />Make workspace</ContextMenuItem></Show>
              <Show when={workspaceFor(entry)}>{(workspace) => <>
                <ContextMenuItem onSelect={() => props.onOpenWorkspace(workspace())}><WorkspaceGlyph appearance={workspace().workspaceAppearance} />Open workspace</ContextMenuItem>
                <ContextMenuItem onSelect={() => props.onManageWorkspace("rename", workspace())}><PencilIcon />Rename workspace</ContextMenuItem>
                <ContextMenuItem onSelect={() => props.onManageWorkspace("identity", workspace())}><PaletteIcon />Workspace identity</ContextMenuItem>
                <ContextMenuItem variant="destructive" onSelect={() => props.onManageWorkspace("unlink", workspace())}><UnlinkIcon />Unlink workspace</ContextMenuItem>
              </>}</Show>
              <ContextMenuItem onSelect={() => copyPath(`${props.location!.project.workingRoot}/${entry.path}`)}><CopyIcon />Copy path</ContextMenuItem>
            </ContextMenuGroup></ContextMenuContent></ContextMenu>
          }</For>
          <Show when={!props.loading && !refreshing() && !visibleEntries().length}><div class="computer-folder-empty">{query() ? "No items match this search." : "This folder is empty."}</div></Show>
        </ContextMenuTrigger><ContextMenuContent><ContextMenuGroup>
          <ContextMenuItem disabled={!props.location} onSelect={() => props.dialog ? props.onSelectFolder?.() : props.onStartWorkspaceAction("created", props.location!.project.workingRoot)}><FolderIcon />{props.dialog ? "Select this folder" : "Create workspace folder here"}</ContextMenuItem>
          <ContextMenuItem disabled={!props.location} onSelect={() => props.dialog ? props.onCreateFolder?.() : props.onStartWorkspaceAction("cloned", props.location!.project.workingRoot)}><PlusIcon />{props.dialog ? "Create folder here" : "Clone repository here"}</ContextMenuItem>
          <Show when={props.dialog}><ContextMenuItem disabled={!props.location} onSelect={props.onCloneRepository}><GitBranchIcon />Clone repository here</ContextMenuItem></Show>
          <Show when={!props.dialog}><For each={harnesses().filter((item) => item.available)}>{(harness) => <ContextMenuItem disabled={!props.location} onSelect={() => props.onOpenHarnessHere?.(harness.id, props.location!.project.workingRoot)}><HarnessMark id={harness.id} class="computer-harness-mark" />Open {harness.label} here</ContextMenuItem>}</For></Show>
          <ContextMenuItem onSelect={() => void refresh()}><RefreshCwIcon />Refresh</ContextMenuItem>
          <ContextMenuItem onSelect={() => setShowHidden((value) => !value)}><EyeIcon />{showHidden() ? "Hide hidden files" : "Show hidden files"}</ContextMenuItem>
          <ContextMenuItem onSelect={() => props.onOpenView("terminal")}><TerminalIcon />Terminal here</ContextMenuItem>
        </ContextMenuGroup></ContextMenuContent></ContextMenu>
        <Show when={props.loading || refreshing()}><div class="computer-loading" role="status">Loading…</div></Show>
        <Show when={cursor()}><button type="button" class="computer-load-more" disabled={refreshing()} onClick={() => void refresh(cursor()!)}>Load more</button></Show>
      </div>
      </Show>
    </section>
  </div>;
}

function HarnessDashboard(props: {
  harness?: HarnessSummary;
  projects: Project[];
  cwd: string;
  runtime?: RuntimeStore;
  /** Folder the Locations rail has scoped to, or null for every folder. */
  scope: string | null;
  onScope: (path: string | null) => void;
  onFolders: (folders: { path: string; display: string }[]) => void;
  onOpenChat?: (chat: ChatSummary, project: Project, prompt?: string) => void;
  onLaunchChat?: (harness: HarnessSummary, cwd: string, prompt?: string) => Promise<void>;
}) {
  const relativeTime = (value: number | string | null) => {
    const raw = typeof value === "number" && value < 1_000_000_000_000 ? value * 1_000 : value;
    if (!raw) return "";
    const elapsed = Date.now() - new Date(raw).getTime();
    const minutes = Math.round(elapsed / 60_000);
    if (minutes < 1) return "now";
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.round(hours / 24);
    return days < 7 ? `${days}d` : new Date(raw).toLocaleDateString();
  };

  const scope = () => props.scope;
  const [groups, setGroups] = createSignal<HarnessThreadGroup[]>([]);
  const [truncated, setTruncated] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [picker, setPicker] = createSignal<ComputerLocation | null>(null);
  const voiceSettings = loadVoiceDictationSettings();
  let liveId = "";
  const [pickerBusy, setPickerBusy] = createSignal(false);
  // Driving a thread runs on the same chat store and transcript as a Conduit
  // chat; only the identity differs - the thread is not in the registry.
  const [drive, setDrive] = createSignal<{ cwd: string; title: string; nativeSessionId: string } | null>(null);
  const driveChat = props.runtime ? createDriveChat({ runtime: props.runtime, onError: (cause) => setError(cause instanceof Error ? cause.message : String(cause)) }) : null;

  const discovers = () => props.harness?.discovery === "machine";
  const workspaces = () => props.projects.filter((project) => !isConduitManagedProject(project));
  const projectFor = (path: string) => props.projects.find((project) => project.workingRoot === path);
  const [known, setKnown] = createSignal<HarnessThreadGroup[]>([]);

  const load = async () => {
    if (!discovers()) { setGroups([]); setKnown([]); return; }
    setLoading(true); setError("");
    try {
      const target = scope();
      const query = target ? `?path=${encodeURIComponent(target)}` : "";
      const result = await api<HarnessThreadDiscovery>(`/v0/harnesses/${props.harness!.id}/threads${query}`);
      setGroups(result.groups); setTruncated(result.truncated);
      if (!target) {
        setKnown(result.groups);
        props.onFolders(result.groups.map((group) => ({ path: group.path, display: group.display })));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Threads could not be loaded"); }
    finally { setLoading(false); }
  };
  createEffect(() => { props.harness?.id; scope(); void load(); });
  onCleanup(() => { const current = liveId; if (current) void api(`/v0/live-sessions/${current}/process`, { method: "DELETE" }); });

  const attach = async (live: { id: string; nativeSessionId: string; streamUrl: string }, cwd: string, title: string) => {
    if (!driveChat) return setError("Live sessions are unavailable on this surface");
    liveId = live.id;
    setDrive({ cwd, title, nativeSessionId: live.nativeSessionId });
    try { await driveChat.attach(live, title); }
    catch (cause) { setDrive(null); setError(cause instanceof Error ? cause.message : "Thread could not be opened"); }
  };

  const openThread = async (group: HarnessThreadGroup, thread: HarnessThread) => {
    setError("");
    if (thread.tracked && thread.chatId) {
      const project = projectFor(group.path);
      const chat = await api<ChatSummary>(`/v0/chats/${thread.chatId}`).catch(() => null);
      if (chat && project) return props.onOpenChat?.(chat, project);
    }
    try {
      const live = await api<{ id: string; nativeSessionId: string; streamUrl: string }>(`/v0/harnesses/${props.harness!.id}/drive`, {
        method: "POST", body: JSON.stringify({ path: group.path, sessionId: thread.id }),
      });
      await attach(live, group.path, thread.title);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Thread could not be opened"); }
  };

  const startThread = async (path: string) => {
    setError(""); setPickerBusy(true);
    try {
      const live = await api<{ id: string; nativeSessionId: string; streamUrl: string }>(`/v0/harnesses/${props.harness!.id}/drive`, {
        method: "POST", body: JSON.stringify({ path, newThread: true }),
      });
      setPicker(null);
      await attach(live, path, "New thread");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Thread could not be started"); }
    finally { setPickerBusy(false); }
  };

  const closeDrive = async () => {
    const current = liveId;
    liveId = "";
    driveChat?.detach();
    setDrive(null);
    if (current) await api(`/v0/live-sessions/${current}/process`, { method: "DELETE" });
    void load();
  };

  // Adoption is the one action that needs a Conduit workspace, so an ad-hoc
  // folder is registered here - deliberately, on an explicit request.
  const track = async () => {
    const current = drive();
    if (!current) return;
    setError("");
    try {
      let project = projectFor(current.cwd);
      if (!project) project = await api<Project>("/v0/projects", { method: "POST", body: JSON.stringify({ mode: "linked", path: current.cwd }) });
      await closeDrive();
      const chat = await api<ChatSummary>(`/v0/projects/${project.id}/backend-sessions/${current.nativeSessionId}/adopt`, { method: "POST" });
      props.onOpenChat?.(chat, project);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Thread could not be tracked"); }
  };

  // Codex takes text only, so the composer runs with attachments switched off.
  const driveAttachments = {
    items: () => [] as never[],
    addFiles: () => {},
    remove: () => {},
  } as never;

  const browsePicker = async (path?: string) => {
    setPickerBusy(true);
    try { setPicker(await api<ComputerLocation>(`/v0/computer${path ? `?path=${encodeURIComponent(path)}` : ""}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Folder could not be opened"); }
    finally { setPickerBusy(false); }
  };
  const pickerDirectories = () => (picker()?.listing.entries || []).filter((entry) => entry.type === "directory");
  const recentFolders = createMemo(() => {
    const seen = new Set<string>();
    const rows: { path: string; display: string }[] = [];
    for (const group of known()) if (!seen.has(group.path)) { seen.add(group.path); rows.push({ path: group.path, display: group.display }); }
    for (const project of workspaces()) if (!seen.has(project.workingRoot)) { seen.add(project.workingRoot); rows.push({ path: project.workingRoot, display: project.name }); }
    return rows.slice(0, 6);
  });

  return <main class="computer-harness-dashboard" data-driving={drive() ? "true" : undefined}>
    <Show when={props.harness} fallback={<p class="computer-error">Harness is unavailable.</p>}>{(harness) => <>
      {/* Driving is a thread, not a page about a harness: the hero gives way so
          the transcript reads like any other conversation in Conduit. */}
      <Show when={!drive()}>
        <header>
          <HarnessMark id={harness().id} class="computer-harness-hero-mark" />
          <div>
            <h1>{harness().label}</h1>
            <p>{harness().version || "Installed adapter"} · {harness().status === "authentication_required" ? "Authentication required" : "Ready"}</p>
          </div>
          <Show when={harness().drive}>
            <button type="button" class="computer-harness-start" onClick={() => void browsePicker(drive()?.cwd || props.cwd)}><PlusIcon />New thread</button>
          </Show>
        </header>
      </Show>

      <Show when={drive()} fallback={<>
        {/* The Locations rail is hidden on a phone, so scoping needs its own
            affordance where the threads actually are. */}
        <Show when={discovers()}>
          <nav class="computer-harness-scopebar" aria-label="Thread folders">
            <button type="button" data-active={props.scope === null} onClick={() => props.onScope(null)}>All threads</button>
            <For each={recentFolders()}>{(folder) =>
              <button type="button" data-active={props.scope === folder.path} title={folder.path} onClick={() => props.onScope(folder.path)}>{folder.display}</button>
            }</For>
          </nav>
        </Show>
        <Show when={discovers()} fallback={
          <section class="computer-harness-empty">
            <p><strong>{harness().label} does not report thread history.</strong></p>
            <p>Threads you start here run as an app on this page. Nothing is listed because this harness keeps no local thread database Conduit can read.</p>
          </section>
        }>
          <section class="computer-harness-threads" aria-busy={loading()}>
              <Show when={!loading()} fallback={<p class="computer-harness-note">Finding threads…</p>}>
                <For each={groups()}>{(group) =>
                  <section class="computer-harness-group" data-missing={group.missing ? "true" : undefined}>
                    <div class="computer-harness-group-header">
                      <strong title={group.path}>{group.display}</strong>
                      <Show when={group.repository?.branch}><small><GitBranchIcon />{group.repository!.branch}</small></Show>
                      <Show when={group.missing}><small class="computer-harness-gone">Folder is gone</small></Show>
                      <small>{relativeTime(group.updatedAt)}</small>
                    </div>
                    <For each={group.threads}>{(thread) =>
                      <button type="button" class="computer-harness-thread" disabled={group.missing} onClick={() => void openThread(group, thread)}>
                        <i class="computer-harness-thread-status" data-status={thread.status} />
                        <span>
                          <strong>{thread.title}</strong>
                          <Show when={thread.preview && thread.preview !== thread.title}><small>{thread.preview}</small></Show>
                        </span>
                        <Show when={thread.tracked}><em class="computer-harness-badge">Tracked</em></Show>
                        <small>{relativeTime(thread.updatedAt)}</small>
                      </button>
                    }</For>
                  </section>
                }</For>
                <Show when={!groups().length}><p class="computer-harness-note">No threads {scope() ? "in this folder" : "yet"}.</p></Show>
              <Show when={truncated()}><p class="computer-harness-note">Older threads are not shown.</p></Show>
            </Show>
          </section>
        </Show>
      </>}>
        {(current) => <section class="computer-harness-drive">
          <header>
            <button type="button" aria-label="Back to threads" onClick={() => void closeDrive()}><ArrowRightIcon class="computer-harness-back" /></button>
            <div>
              <strong>{current().title}</strong>
              <small title={current().cwd}><HarnessMark id={harness().id} class="computer-harness-mark" />{current().cwd} · not tracked</small>
            </div>
            <button type="button" onClick={() => void track()}>Track this thread</button>
          </header>
          <Show when={driveChat} fallback={<p class="computer-harness-note">Live sessions are unavailable on this surface.</p>}>{(store) =>
            <div class="work-area">
              <section class="work-area-conversation" aria-label="Conversation">
                <Transcript chat={store().chat} partialContinue={false} markdownRenderer={selectedMarkdownRenderer()} rendererControlsVisible={false} profileLabel={harness().label} />
                <div class="composer-stack">
                  <Composer
                    chat={store().chat}
                    attachments={driveAttachments}
                    attachmentsSupported={false}
                    models={store().models}
                    profiles={[]}
                    activeProfile={null}
                    serverOnline={props.runtime?.connectivity() === "online"}
                    voiceSettings={voiceSettings}
                    onChooseProfile={() => {}}
                    onOpenSettings={() => {}}
                    onOpenAttachments={() => {}}
                  />
                </div>
              </section>
            </div>
          }</Show>
        </section>}
      </Show>

      <Show when={picker()}>{(location) =>
        <div class="computer-harness-picker-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setPicker(null); }}>
          <div class="computer-harness-picker" role="dialog" aria-label={`Start a ${harness().label} thread`} aria-busy={pickerBusy()}>
            <header>
              <strong>Start a {harness().label} thread</strong>
              <button type="button" aria-label="Cancel" onClick={() => setPicker(null)}><XIcon /></button>
            </header>
            <div class="computer-harness-picker-path">
              <button type="button" aria-label="Home" onClick={() => void browsePicker(location().home)}><HomeIcon /></button>
              <span title={location().project.workingRoot}>{location().project.workingRoot}</span>
              <Show when={location().project.workingRoot !== location().home}>
                <button type="button" onClick={() => void browsePicker(location().parent)}>Up</button>
              </Show>
            </div>
            <div class="computer-harness-picker-list">
              <For each={pickerDirectories()}>{(entry) =>
                <button type="button" onClick={() => void browsePicker(`${location().project.workingRoot}/${entry.path}`)}><FolderIcon /><span>{entry.name}</span></button>
              }</For>
              <Show when={!pickerDirectories().length}><p class="computer-harness-note">No folders here.</p></Show>
            </div>
            <Show when={recentFolders().length}>
              <div class="computer-harness-picker-recent">
                <For each={recentFolders()}>{(folder) =>
                  <button type="button" title={folder.path} onClick={() => void browsePicker(folder.path)}>{folder.display}</button>
                }</For>
              </div>
            </Show>
            <footer>
              <small title={location().project.workingRoot}>{location().project.workingRoot}</small>
              <button type="button" disabled={pickerBusy()} onClick={() => void startThread(location().project.workingRoot)}>Start here <ArrowRightIcon /></button>
            </footer>
          </div>
        </div>
      }</Show>

      <Show when={error()}><p class="computer-error" role="alert">{error()}</p></Show>
    </>}</Show>
  </main>;
}

export const ComputerExplorer = ComputerDashboard;
