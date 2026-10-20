import { Browser, BrowserLayout, BrowserSidebar, BrowserHeading, BrowserPlaces, BrowserMain, BrowserToolbar, BrowserActions, BrowserSearch, BrowserCount, BrowserSummary, BrowserSpacer, BrowserColumns, BrowserMark, BrowserEmpty, BrowserLoading, BrowserError, BrowserDivider, BrowserGrid, BrowserEntry, BrowserPlace, BrowserAddress, Select } from "@/components/ui/browser";
import { Button, Input } from "@/components/ui/controls";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ArrowUpIcon, ChevronDownIcon, CopyIcon, EyeIcon, EyeOffIcon, FolderIcon, GitBranchIcon, Grid2X2Icon, HomeIcon, ListIcon, PaletteIcon, PencilIcon, PlusIcon, RefreshCwIcon, SearchIcon, TerminalIcon, UnlinkIcon } from "lucide-solid";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger, Menu, MenuContent, MenuGroup, MenuItem, MenuTrigger } from "@/components/menus";
import { api } from "../api/client";
import type { ComputerLocation, HarnessSummary, Project } from "../api/contracts";
import { isConduitManagedProject } from "../navigation/sidebar-preferences";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import { FileTypeIcon } from "../workspace/file-type-icon";
import { HarnessMark } from "../harness-brand";


type Entry = {
  name: string;
  path: string;
  type: "directory" | "file" | "other";
  size?: number | null;
  createdAt?: number | null;
  modifiedAt?: number | null;
};
type Listing = { entries: Entry[]; cursor?: string | null; oversize?: boolean };
type ComputerView = "tiles" | "details";
type ComputerOrder = "name" | "name-desc" | "type";

const storedComputerView = (): ComputerView => localStorage.getItem("conduit.computer.view") === "details" ? "details" : "tiles";
const storedComputerOrder = (): ComputerOrder => {
  const value = localStorage.getItem("conduit.computer.order");
  return value === "name" || value === "name-desc" ? value : "type";
};

const formatFileSize = (value?: number | null) => {
  if (value == null) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: size < 10 && unit > 0 ? 1 : 0 }).format(size)} ${units[unit]}`;
};

const formatFileDate = (value?: number | null) => value
  ? new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value))
  : "—";

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
  onOpenHarnessHere?: (id: string, cwd: string) => void;
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
  const [view, setView] = createSignal<ComputerView>(storedComputerView());
  const [order, setOrder] = createSignal<ComputerOrder>(storedComputerOrder());
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
    void api<{ harnesses: HarnessSummary[] }>("/v0/harnesses")
      .then((result) => setHarnesses(result.harnesses))
      .catch(() => setHarnesses([]));
  });
  createEffect(() => localStorage.setItem("conduit.computer.view", view()));
  createEffect(() => localStorage.setItem("conduit.computer.order", order()));
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

  const WorkspaceActions = () => <>
    <Button variant="ghost" type="button" disabled={!props.location || props.loading} onClick={() => props.dialog ? props.onSelectFolder?.() : props.onMakeWorkspace()}><FolderIcon />{props.dialog ? "Select folder" : designated() ? "Open workspace" : "Make workspace"}</Button>
    <Button variant="ghost" type="button" disabled={!props.location || props.loading} onClick={() => props.dialog ? props.onCreateFolder?.() : props.onStartWorkspaceAction("created", props.location!.project.workingRoot)}><PlusIcon />Create folder</Button>
    <Button variant="ghost" type="button" disabled={!props.location || props.loading} onClick={() => props.dialog ? props.onCloneRepository?.() : props.onStartWorkspaceAction("cloned", props.location!.project.workingRoot)}><GitBranchIcon />Clone repository</Button>
  </>;

  return <Browser compact={props.dialog} sidebarWidth={sidebarWidth()}>
    <BrowserLayout>
      <BrowserSidebar>
        <BrowserHeading>Locations</BrowserHeading>
        <ContextMenu><ContextMenuTrigger as={BrowserPlace} type="button" data-active={props.location?.project.workingRoot === props.location?.home} onClick={() => props.onBrowse()}><HomeIcon /><span>Home</span></ContextMenuTrigger><ContextMenuContent><ContextMenuGroup><ContextMenuItem onSelect={() => props.onBrowse()}><FolderIcon />Open</ContextMenuItem><ContextMenuItem onSelect={() => copyPath(props.location?.home || "")}><CopyIcon />Copy path</ContextMenuItem></ContextMenuGroup></ContextMenuContent></ContextMenu>
        <Show when={!props.dialog}><Button variant="ghost" type="button" onClick={props.onOpenTerminalView}><TerminalIcon /><span>Terminal</span></Button></Show>
        <BrowserHeading>Workspaces</BrowserHeading>
        <BrowserPlaces><For each={workspaces()}>{(project) =>
          <ContextMenu><ContextMenuTrigger as={BrowserPlace} type="button" data-active={props.location?.project.workingRoot === project.workingRoot} title={project.workingRoot} onClick={() => props.onBrowse(project.workingRoot)}><WorkspaceGlyph appearance={project.workspaceAppearance} /><span>{project.name}</span></ContextMenuTrigger><ContextMenuContent><ContextMenuGroup>
            <ContextMenuItem onSelect={() => props.onBrowse(project.workingRoot)}><FolderIcon />Browse in Computer</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onOpenWorkspace(project)}><WorkspaceGlyph appearance={project.workspaceAppearance} />Open workspace</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onManageWorkspace("rename", project)}><PencilIcon />Rename workspace</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onManageWorkspace("identity", project)}><PaletteIcon />Workspace identity</ContextMenuItem>
            <ContextMenuItem onSelect={() => copyPath(project.workingRoot)}><CopyIcon />Copy path</ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => props.onManageWorkspace("unlink", project)}><UnlinkIcon />Unlink workspace</ContextMenuItem>
          </ContextMenuGroup></ContextMenuContent></ContextMenu>
        }</For></BrowserPlaces>
        <Show when={!workspaces().length}><p>No workspaces</p></Show>
      </BrowserSidebar>
      <BrowserDivider role="separator" aria-label="Resize locations sidebar" aria-orientation="vertical" aria-valuemin="120" aria-valuemax="280" aria-valuenow={sidebarWidth()} onPointerDown={startSidebarResize} />

      <BrowserMain>
        <BrowserToolbar>
          <Button variant="ghost" type="button" aria-label="Home folder" title="Home folder" disabled={props.loading} onClick={() => props.onBrowse()}><HomeIcon /></Button>
          <Button variant="ghost" type="button" aria-label="Parent folder" title="Parent folder" disabled={props.loading || !props.location || props.location.parent === props.location.project.workingRoot} onClick={() => props.onBrowse(props.location!.parent)}><ArrowUpIcon /></Button>
          <BrowserAddress aria-label="Folder path" value={address()} onInput={(event) => setAddress(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); go(); } }} />
          <BrowserSearch><SearchIcon /><Input type="search" aria-label="Search this folder" placeholder="Search" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} /></BrowserSearch>
          <Select aria-label="Order files" value={order()} onChange={(event) => setOrder(event.currentTarget.value as ComputerOrder)}><option value="name">Name A–Z</option><option value="name-desc">Name Z–A</option><option value="type">Type</option></Select>
          <Button variant="ghost" type="button" aria-label={view() === "tiles" ? "Use details view" : "Use tile view"} title={view() === "tiles" ? "Details view" : "Tile view"} onClick={() => setView((value) => value === "tiles" ? "details" : "tiles")}><Show when={view() === "tiles"} fallback={<Grid2X2Icon />}><ListIcon /></Show></Button>
          <Button variant="ghost" type="button" aria-label="Refresh folder" title="Refresh folder" disabled={refreshing()} onClick={() => void refresh()}><RefreshCwIcon /></Button>
          <Button variant="ghost" type="button" aria-label={showHidden() ? "Hide hidden files" : "Show hidden files"} title={showHidden() ? "Hide hidden files" : "Show hidden files"} aria-pressed={showHidden()} onClick={() => setShowHidden((value) => !value)}><Show when={showHidden()} fallback={<EyeOffIcon />}><EyeIcon /></Show></Button>
          <BrowserCount>{visibleEntries().length} items</BrowserCount>
        </BrowserToolbar>
        <BrowserActions>
          <Show when={props.location?.repositoryRoot}><BrowserSummary title={props.location?.repositoryRoot || ""}><GitBranchIcon />{props.location?.repositoryRoot?.split("/").at(-1)}</BrowserSummary></Show>
          <BrowserSpacer />
          <WorkspaceActions />
          <Show when={!props.dialog}>
            <Button variant="ghost" type="button" disabled={!props.location || props.loading} onClick={props.onOpenTerminalHere}><TerminalIcon />Terminal Here</Button>
            <Show when={harnesses().some((item) => item.available)}><Menu><MenuTrigger disabled={!props.location || props.loading} aria-label="Open harness here"><TerminalIcon />Harness Here<ChevronDownIcon /></MenuTrigger><MenuContent><MenuGroup><For each={harnesses().filter((item) => item.available)}>{(harness) =>
              <MenuItem onSelect={() => props.onOpenHarnessHere?.(harness.id, props.location!.project.workingRoot)}><HarnessMark id={harness.id} />Open {harness.label} here</MenuItem>
            }</For></MenuGroup></MenuContent></Menu></Show>
            <Button variant="ghost" type="button" disabled={!props.location?.repository || props.loading} onClick={() => props.onOpenView("diff")}><GitBranchIcon />Source Control</Button>
          </Show>
        </BrowserActions>

        <Show when={props.error || listingError()}><BrowserError>{props.error || listingError()}</BrowserError></Show>
        <ContextMenu><ContextMenuTrigger as={BrowserGrid} data-view={view()} aria-busy={props.loading || refreshing()}>
          <Show when={view() === "details"}><BrowserColumns><span>Name</span><span>Type</span><span>Size</span><span>Created</span><span>Modified</span></BrowserColumns></Show>
          <For each={visibleEntries()}>{(entry) =>
            <ContextMenu><ContextMenuTrigger as={BrowserEntry} type="button" disabled={entry.type === "other" || props.loading} title={entry.name} onPointerEnter={() => entry.type === "directory" && props.onPrefetch(entry.path)} onFocus={() => entry.type === "directory" && props.onPrefetch(entry.path)} onClick={() => openEntry(entry)}>
              <Show when={entry.type === "directory"} fallback={<FileTypeIcon name={entry.name} />}><FolderIcon /></Show>
              <span>{entry.name}</span>
              <Show when={workspaceFor(entry)}>{(workspace) => <BrowserMark title={`${workspace().name} workspace`}><WorkspaceGlyph appearance={workspace().workspaceAppearance} /></BrowserMark>}</Show>
              <Show when={view() === "details"}><>
                <small>{entry.type === "directory" ? "Folder" : entry.type === "file" ? "File" : "Other"}</small>
                <small>{entry.type === "file" ? formatFileSize(entry.size) : "—"}</small>
                <small>{formatFileDate(entry.createdAt)}</small>
                <small>{formatFileDate(entry.modifiedAt)}</small>
              </></Show>
            </ContextMenuTrigger><ContextMenuContent><ContextMenuGroup>
              <ContextMenuItem onSelect={() => openEntry(entry)}><FolderIcon />Open</ContextMenuItem>
              <Show when={!props.dialog && entry.type === "directory"}><For each={harnesses().filter((item) => item.available)}>{(harness) => <ContextMenuItem onSelect={() => props.onOpenHarnessHere?.(harness.id, `${props.location!.project.workingRoot}/${entry.path}`)}><HarnessMark id={harness.id} />Open {harness.label} here</ContextMenuItem>}</For></Show>
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
          <Show when={!props.loading && !refreshing() && !visibleEntries().length}><BrowserEmpty>{query() ? "No items match this search." : "This folder is empty."}</BrowserEmpty></Show>
        </ContextMenuTrigger><ContextMenuContent><ContextMenuGroup>
          <ContextMenuItem disabled={!props.location} onSelect={() => props.dialog ? props.onSelectFolder?.() : props.onStartWorkspaceAction("created", props.location!.project.workingRoot)}><FolderIcon />{props.dialog ? "Select this folder" : "Create workspace folder here"}</ContextMenuItem>
          <ContextMenuItem disabled={!props.location} onSelect={() => props.dialog ? props.onCreateFolder?.() : props.onStartWorkspaceAction("cloned", props.location!.project.workingRoot)}><PlusIcon />{props.dialog ? "Create folder here" : "Clone repository here"}</ContextMenuItem>
          <Show when={props.dialog}><ContextMenuItem disabled={!props.location} onSelect={props.onCloneRepository}><GitBranchIcon />Clone repository here</ContextMenuItem></Show>
          <Show when={!props.dialog}><For each={harnesses().filter((item) => item.available)}>{(harness) => <ContextMenuItem disabled={!props.location} onSelect={() => props.onOpenHarnessHere?.(harness.id, props.location!.project.workingRoot)}><HarnessMark id={harness.id} />Open {harness.label} here</ContextMenuItem>}</For></Show>
          <ContextMenuItem onSelect={() => void refresh()}><RefreshCwIcon />Refresh</ContextMenuItem>
          <ContextMenuItem onSelect={() => setShowHidden((value) => !value)}><EyeIcon />{showHidden() ? "Hide hidden files" : "Show hidden files"}</ContextMenuItem>
          <ContextMenuItem onSelect={() => props.onOpenView("terminal")}><TerminalIcon />Terminal here</ContextMenuItem>
        </ContextMenuGroup></ContextMenuContent></ContextMenu>
        <Show when={props.loading || refreshing()}><BrowserLoading>Loading…</BrowserLoading></Show>
        <Show when={cursor()}><Button variant="ghost" type="button" disabled={refreshing()} onClick={() => void refresh(cursor()!)}>Load more</Button></Show>
      </BrowserMain>
    </BrowserLayout>
  </Browser>;
}

export const ComputerExplorer = ComputerDashboard;
