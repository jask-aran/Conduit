import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ArrowUpIcon, EyeIcon, EyeOffIcon, FolderIcon, GitBranchIcon, HomeIcon, RefreshCwIcon, SearchIcon, TerminalIcon } from "lucide-solid";
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
  onMakeWorkspace: () => void;
  onOpenView: (view: "files" | "diff" | "terminal") => void;
  onOpenFile: (path: string) => void;
}) {
  const [address, setAddress] = createSignal("");
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [query, setQuery] = createSignal("");
  const [showHidden, setShowHidden] = createSignal(false);
  const [listingError, setListingError] = createSignal("");
  const [refreshing, setRefreshing] = createSignal(false);
  let controller: AbortController | undefined;

  const workspaces = () => props.projects.filter((project) => !isConduitManagedProject(project));
  const designated = () => workspaces().find((project) => project.workingRoot === props.location?.project.workingRoot);
  const visibleEntries = createMemo(() => {
    const filter = query().trim().toLowerCase();
    return entries().filter((entry) => (showHidden() || !entry.name.startsWith(".")) && (!filter || entry.name.toLowerCase().includes(filter)));
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
  onCleanup(() => controller?.abort());

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

  return <div class="computer-dashboard">
    <section class="computer-explorer" aria-label="Computer files">
      <aside class="computer-explorer-sidebar">
        <h2>Locations</h2>
        <button type="button" data-active={props.location?.project.workingRoot === props.location?.home} onClick={() => props.onBrowse()}><HomeIcon /><span>Home</span></button>
        <h2>Workspaces</h2>
        <div class="computer-workspace-shortcuts"><For each={workspaces()}>{(project) =>
          <button type="button" data-active={props.location?.project.workingRoot === project.workingRoot} title={project.workingRoot} onClick={() => props.onBrowse(project.workingRoot)}><WorkspaceGlyph appearance={project.workspaceAppearance} /><span>{project.name}</span></button>
        }</For></div>
        <Show when={!workspaces().length}><p>No workspaces</p></Show>
      </aside>

      <div class="computer-explorer-main">
        <form class="computer-explorer-toolbar" onSubmit={(event) => { event.preventDefault(); go(); }}>
          <button type="button" aria-label="Home folder" title="Home folder" disabled={props.loading} onClick={() => props.onBrowse()}><HomeIcon /></button>
          <button type="button" aria-label="Parent folder" title="Parent folder" disabled={props.loading || !props.location || props.location.parent === props.location.project.workingRoot} onClick={() => props.onBrowse(props.location!.parent)}><ArrowUpIcon /></button>
          <input class="computer-address" aria-label="Folder path" value={address()} onInput={(event) => setAddress(event.currentTarget.value)} />
          <label class="computer-search"><SearchIcon /><input type="search" aria-label="Search this folder" placeholder="Search" value={query()} onInput={(event) => setQuery(event.currentTarget.value)} /></label>
          <button type="button" aria-label="Refresh folder" title="Refresh folder" disabled={refreshing()} onClick={() => void refresh()}><RefreshCwIcon /></button>
          <button type="button" aria-label={showHidden() ? "Hide hidden files" : "Show hidden files"} title={showHidden() ? "Hide hidden files" : "Show hidden files"} aria-pressed={showHidden()} onClick={() => setShowHidden((value) => !value)}><Show when={showHidden()} fallback={<EyeOffIcon />}><EyeIcon /></Show></button>
        </form>

        <div class="computer-explorer-actions" role="toolbar" aria-label="Folder actions">
          <strong>{props.location?.project.name || "Home"}</strong>
          <span>{visibleEntries().length} items</span>
          <button type="button" disabled={!props.location || props.loading} onClick={props.onMakeWorkspace}>{designated() ? "Open workspace" : "Make workspace"}</button>
          <button type="button" disabled={!props.location || props.loading} onClick={() => props.onOpenView("terminal")}><TerminalIcon />Terminal</button>
          <button type="button" disabled={!props.location?.repository || props.loading} onClick={() => props.onOpenView("diff")}><GitBranchIcon />Source Control</button>
        </div>

        <Show when={props.error || listingError()}><p class="computer-error" role="alert">{props.error || listingError()}</p></Show>
        <div class="computer-file-grid" aria-busy={props.loading || refreshing()}>
          <For each={visibleEntries()}>{(entry) =>
            <button type="button" disabled={entry.type === "other" || props.loading} title={entry.name} onClick={() => openEntry(entry)}>
              <Show when={entry.type === "directory"} fallback={<FileTypeIcon name={entry.name} />}><FolderIcon /></Show>
              <span>{entry.name}</span>
            </button>
          }</For>
          <Show when={!props.loading && !refreshing() && !visibleEntries().length}><div class="computer-folder-empty">{query() ? "No items match this search." : "This folder is empty."}</div></Show>
        </div>
        <Show when={props.loading || refreshing()}><div class="computer-loading" role="status">Loading…</div></Show>
        <Show when={cursor()}><button type="button" class="computer-load-more" disabled={refreshing()} onClick={() => void refresh(cursor()!)}>Load more</button></Show>
      </div>
    </section>
  </div>;
}
