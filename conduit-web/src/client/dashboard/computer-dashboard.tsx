import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ArrowUpIcon, CopyIcon, EyeIcon, EyeOffIcon, FolderIcon, GitBranchIcon, Grid2X2Icon, HomeIcon, ListIcon, PaletteIcon, PencilIcon, PlusIcon, RefreshCwIcon, SearchIcon, TerminalIcon, UnlinkIcon } from "lucide-solid";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from "@/components/primitives";
import { api } from "../api/client";
import type { ComputerLocation, Project } from "../api/contracts";
import { isConduitManagedProject } from "../navigation/sidebar-preferences";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import { FileTypeIcon } from "../workspace/file-type-icon";
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
  onOpenTerminalHere?: () => void;
  onOpenFile: (path: string) => void;
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
    <button type="button" disabled={!props.location || props.loading} onClick={() => props.dialog ? props.onSelectFolder?.() : props.onMakeWorkspace()}><FolderIcon />{props.dialog ? "Select folder" : designated() ? "Open workspace" : "Make workspace"}</button>
    <button type="button" disabled={!props.location || props.loading} onClick={() => props.dialog ? props.onCreateFolder?.() : props.onStartWorkspaceAction("created", props.location!.project.workingRoot)}><PlusIcon />Create folder</button>
    <button type="button" disabled={!props.location || props.loading} onClick={() => props.dialog ? props.onCloneRepository?.() : props.onStartWorkspaceAction("cloned", props.location!.project.workingRoot)}><GitBranchIcon />Clone repository</button>
  </>;

  return <div class="computer-dashboard" data-dialog={props.dialog ? "true" : undefined}>
    <section class="computer-explorer" aria-label="Computer files" style={{ "--computer-sidebar-width": `${sidebarWidth()}px` }}>
      <aside class="computer-explorer-sidebar">
        <h2>Locations</h2>
        <ContextMenu><ContextMenuTrigger as="button" type="button" data-active={props.location?.project.workingRoot === props.location?.home} onClick={() => props.onBrowse()}><HomeIcon /><span>Home</span></ContextMenuTrigger><ContextMenuContent><ContextMenuGroup><ContextMenuItem onSelect={() => props.onBrowse()}><FolderIcon />Open</ContextMenuItem><ContextMenuItem onSelect={() => copyPath(props.location?.home || "")}><CopyIcon />Copy path</ContextMenuItem></ContextMenuGroup></ContextMenuContent></ContextMenu>
        <h2>Workspaces</h2>
        <div class="computer-workspace-shortcuts"><For each={workspaces()}>{(project) =>
          <ContextMenu><ContextMenuTrigger as="button" type="button" data-active={props.location?.project.workingRoot === project.workingRoot} title={project.workingRoot} onClick={() => props.onBrowse(project.workingRoot)}><WorkspaceGlyph appearance={project.workspaceAppearance} /><span>{project.name}</span></ContextMenuTrigger><ContextMenuContent><ContextMenuGroup>
            <ContextMenuItem onSelect={() => props.onBrowse(project.workingRoot)}><FolderIcon />Browse in Computer</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onOpenWorkspace(project)}><WorkspaceGlyph appearance={project.workspaceAppearance} />Open workspace</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onManageWorkspace("rename", project)}><PencilIcon />Rename workspace</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onManageWorkspace("identity", project)}><PaletteIcon />Workspace identity</ContextMenuItem>
            <ContextMenuItem onSelect={() => copyPath(project.workingRoot)}><CopyIcon />Copy path</ContextMenuItem>
            <ContextMenuItem variant="destructive" onSelect={() => props.onManageWorkspace("unlink", project)}><UnlinkIcon />Unlink workspace</ContextMenuItem>
          </ContextMenuGroup></ContextMenuContent></ContextMenu>
        }</For></div>
        <Show when={!workspaces().length}><p>No workspaces</p></Show>
      </aside>
      <div class="computer-sidebar-resize" role="separator" aria-label="Resize locations sidebar" aria-orientation="vertical" aria-valuemin="120" aria-valuemax="280" aria-valuenow={sidebarWidth()} onPointerDown={startSidebarResize} />

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
          <ContextMenuItem onSelect={() => void refresh()}><RefreshCwIcon />Refresh</ContextMenuItem>
          <ContextMenuItem onSelect={() => setShowHidden((value) => !value)}><EyeIcon />{showHidden() ? "Hide hidden files" : "Show hidden files"}</ContextMenuItem>
          <ContextMenuItem onSelect={() => props.onOpenView("terminal")}><TerminalIcon />Terminal here</ContextMenuItem>
        </ContextMenuGroup></ContextMenuContent></ContextMenu>
        <Show when={props.loading || refreshing()}><div class="computer-loading" role="status">Loading…</div></Show>
        <Show when={cursor()}><button type="button" class="computer-load-more" disabled={refreshing()} onClick={() => void refresh(cursor()!)}>Load more</button></Show>
      </div>
    </section>
  </div>;
}

export const ComputerExplorer = ComputerDashboard;
