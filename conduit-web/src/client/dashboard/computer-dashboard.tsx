import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { ArrowRightIcon, FolderIcon, TerminalIcon } from "lucide-solid";
import { api } from "../api/client";
import type { ComputerLocation, Project } from "../api/contracts";
import { isConduitManagedProject } from "../navigation/sidebar-preferences";
import { FileTypeIcon } from "../workspace/file-type-icon";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import "./app-dashboard.css";

type Entry = { name: string; path: string; type: "directory" | "file" | "other" };
type Listing = { entries: Entry[]; cursor?: string | null };

export function ComputerDashboard(props: {
  projects: Project[];
  location: ComputerLocation | null;
  loading: boolean;
  error: string;
  onBrowse: (path?: string) => void;
  onMakeWorkspace: () => void;
  onOpenWorkspace: (project: Project) => void;
  onOpenView: (view: "files" | "diff" | "terminal") => void;
  onOpenFile: (path: string) => void;
}) {
  const [address, setAddress] = createSignal("");
  const [entries, setEntries] = createSignal<Entry[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [listingError, setListingError] = createSignal("");
  const [listingLoading, setListingLoading] = createSignal(false);
  const [showHidden, setShowHidden] = createSignal(false);
  let controller: AbortController | undefined;
  const workspaces = () => props.projects.filter((project) => !isConduitManagedProject(project));
  const designated = () => workspaces().find((project) => project.workingRoot === props.location?.project.workingRoot);
  const load = async (id: string, signal: AbortSignal, after?: string) => {
    setListingLoading(true);
    setListingError("");
    try {
      const listing = await api<Listing>(`/v0/projects/${encodeURIComponent(id)}/tree${after ? `?after=${encodeURIComponent(after)}` : ""}`, { signal });
      if (signal.aborted) return;
      setEntries((current) => after ? [...current, ...listing.entries] : listing.entries);
      setCursor(listing.cursor || null);
    } catch (error) {
      if (!signal.aborted) setListingError(error instanceof Error ? error.message : "Folder could not be read");
    } finally {
      if (!signal.aborted) setListingLoading(false);
    }
  };
  createEffect(() => {
    const location = props.location;
    controller?.abort();
    controller = new AbortController();
    setAddress(location?.project.workingRoot || "");
    setEntries(location?.listing.entries || []);
    setCursor(location?.listing.cursor || null);
    setListingError(location?.listing.oversize ? "This folder contains too many entries to list. Open a subfolder using its path." : "");
    setListingLoading(false);
  });
  onCleanup(() => controller?.abort());
  const go = () => {
    const value = address().trim();
    if (!value || value === "~") props.onBrowse();
    else if (value.startsWith("~/")) props.onBrowse(`${props.location?.home}/${value.slice(2)}`);
    else props.onBrowse(value.startsWith("/") ? value : `${props.location?.project.workingRoot}/${value}`);
  };
  return <div class="app-dashboard computer-dashboard">
    <div class="app-dashboard-intro"><h1>Computer</h1><p>Explore your host. Make a folder a workspace when you want to work with chats.</p></div>
    <section class="app-dashboard-section" aria-label="Host files">
      <header class="app-dashboard-section-heading"><div><h2>Files</h2><p>{props.location?.project.workingRoot || "Home folder"}</p></div><button type="button" disabled={!props.location} onClick={() => props.onOpenView("files")}>Open panel</button></header>
      <form class="computer-location-bar" onSubmit={(event) => { event.preventDefault(); go(); }}>
        <button type="button" disabled={props.loading} onClick={() => props.onBrowse()}>Home</button>
        <button type="button" disabled={props.loading || !props.location || props.location.parent === props.location.project.workingRoot} onClick={() => props.onBrowse(props.location!.parent)}>Up</button>
        <input aria-label="Folder path" placeholder="~" value={address()} onInput={(event) => setAddress(event.currentTarget.value)} />
        <button type="submit" disabled={props.loading}>Go</button>
      </form>
      <div class="computer-folder-actions">
        <button type="button" disabled={!props.location || props.loading} onClick={props.onMakeWorkspace}>{designated() ? "Open workspace" : "Make workspace"}</button>
        <button type="button" disabled={!props.location || props.loading} onClick={() => props.onOpenView("terminal")}><TerminalIcon />Terminal here</button>
        <button type="button" disabled={!props.location?.repository || props.loading} onClick={() => props.onOpenView("diff")}>Source Control</button>
        <button type="button" disabled={listingLoading()} onClick={() => { if (props.location && controller) void load(props.location.project.id, controller.signal); }}>Refresh</button>
        <button type="button" aria-pressed={showHidden()} onClick={() => setShowHidden((value) => !value)}>Hidden files</button>
      </div>
      <Show when={props.error || listingError()}><p class="computer-error" role="alert">{props.error || listingError()}</p></Show>
      <Show when={props.loading || listingLoading()}><div class="app-dashboard-empty" role="status">Loading folder…</div></Show>
      <div class="app-dashboard-list"><For each={entries().filter((entry) => showHidden() || !entry.name.startsWith("."))}>{(entry) =>
        <button type="button" disabled={entry.type === "other" || props.loading} onClick={() => entry.type === "directory" ? props.onBrowse(`${props.location!.project.workingRoot}/${entry.path}`) : props.onOpenFile(entry.path)}>
          <Show when={entry.type === "directory"} fallback={<FileTypeIcon name={entry.name} />}><FolderIcon /></Show><span><strong>{entry.name}</strong><small>{entry.type === "directory" ? "Folder" : entry.type === "file" ? "File" : "Special entry"}</small></span><ArrowRightIcon />
        </button>
      }</For></div>
      <Show when={!listingLoading() && !props.loading && !listingError() && !entries().length}><div class="app-dashboard-empty">This folder is empty.</div></Show>
      <Show when={cursor()}><div class="computer-folder-actions"><button type="button" disabled={listingLoading()} onClick={() => { if (props.location && controller) void load(props.location.project.id, controller.signal, cursor()!); }}>Load more</button></div></Show>
    </section>
    <section class="app-dashboard-section" aria-label="Workspace shortcuts">
      <header class="app-dashboard-section-heading"><div><h2>Workspaces</h2><p>Folders designated for chats and quick access.</p></div></header>
      <div class="app-dashboard-list"><For each={workspaces()}>{(project) =>
        <button type="button" onClick={() => props.onOpenWorkspace(project)}><span class="app-dashboard-workspace-glyph"><WorkspaceGlyph appearance={project.workspaceAppearance} /></span><span><strong>{project.name}</strong><small>{project.workingRoot}</small></span><ArrowRightIcon /></button>
      }</For></div>
      <Show when={!workspaces().length}><div class="app-dashboard-empty">Open a folder above and choose Make workspace.</div></Show>
    </section>
  </div>;
}
