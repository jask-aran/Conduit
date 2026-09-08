import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { ArrowRightIcon, ArrowUpIcon, CopyIcon, EyeIcon, EyeOffIcon, FolderIcon, GitBranchIcon, Grid2X2Icon, HomeIcon, ListIcon, PaletteIcon, PencilIcon, PlusIcon, RefreshCwIcon, SearchIcon, SquareIcon, TerminalIcon, UnlinkIcon, XIcon } from "lucide-solid";
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuTrigger } from "@/components/primitives";
import { api } from "../api/client";
import type { BackendSessionSummary, ChatSummary, ComputerLocation, HarnessSummary, Project } from "../api/contracts";
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
  onOpenTerminalView?: () => void;
  onOpenTerminalHere?: () => void;
  onOpenFile: (path: string) => void;
  selectedHarness?: string | null;
  onOpenHarness?: (id: string | null) => void;
  onOpenHarnessChat?: (chat: ChatSummary, project: Project, prompt?: string) => void;
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
        <Show when={!props.dialog && harnesses().some((item) => item.available)}><h2>Harnesses</h2></Show>
        <Show when={!props.dialog}><For each={harnesses().filter((item) => item.available)}>{(harness) =>
          <button type="button" data-active={props.selectedHarness === harness.id} onClick={() => props.onOpenHarness?.(harness.id)}>
            <img class="computer-harness-mark" src={harness.id === "codex" ? "/codex-mark.svg" : "/chatgpt-mark.svg"} alt="" />
            <span>{harness.label}</span><i data-status={harness.status || "ready"} />
          </button>
        }</For></Show>
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

      <Show when={!props.selectedHarness} fallback={<HarnessDashboard harness={harnesses().find((item) => item.id === props.selectedHarness)} projects={workspaces()} cwd={props.location?.project.workingRoot || ""} onOpenChat={props.onOpenHarnessChat} />}>
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
      </Show>
    </section>
  </div>;
}

function HarnessDashboard(props: {
  harness?: HarnessSummary;
  projects: Project[];
  cwd: string;
  onOpenChat?: (chat: ChatSummary, project: Project, prompt?: string) => void;
}) {
  const initialProject = () => props.projects.find((project) => project.workingRoot === props.cwd) || props.projects[0];
  const [projectId, setProjectId] = createSignal(initialProject()?.id || "");
  const [sessions, setSessions] = createSignal<BackendSessionSummary[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [prompt, setPrompt] = createSignal("");
  const [drive, setDrive] = createSignal<{ id: string; nativeSessionId: string; messages: { role: string; content: string }[]; active: boolean } | null>(null);
  let socket: WebSocket | null = null;
  const project = () => props.projects.find((item) => item.id === projectId());
  const load = async () => {
    if (!props.harness?.sessions || !projectId()) return setSessions([]);
    setLoading(true); setError("");
    try {
      const result = await api<{ sessions: BackendSessionSummary[] }>(`/v0/harnesses/${props.harness.id}/sessions?projectId=${encodeURIComponent(projectId())}`);
      setSessions(result.sessions);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Sessions could not be loaded"); }
    finally { setLoading(false); }
  };
  createEffect(() => { props.harness?.id; projectId(); void load(); });
  onCleanup(() => { socket?.close(); const current = drive(); if (current) void api(`/v0/live-sessions/${current.id}/process`, { method: "DELETE" }); });
  const openDrive = async (session: BackendSessionSummary) => {
    setError("");
    try {
      const live = await api<{ id: string; nativeSessionId: string; streamUrl: string }>(`/v0/harnesses/${props.harness!.id}/drive`, {
        method: "POST", body: JSON.stringify({ projectId: projectId(), sessionId: session.id }),
      });
      setDrive({ id: live.id, nativeSessionId: live.nativeSessionId, messages: [], active: false });
      socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}${live.streamUrl}`);
      socket.onmessage = (message) => {
        const event = JSON.parse(String(message.data));
        if (event.type === "transcript_message") setDrive((current) => current && ({ ...current, messages: [...current.messages, event.message] }));
        if (event.type === "assistant_content" && event.phase === "delta") setDrive((current) => {
          if (!current) return current;
          const messages = [...current.messages];
          const last = messages.at(-1);
          if (last?.role === "assistant") messages[messages.length - 1] = { ...last, content: last.content + event.delta };
          else messages.push({ role: "assistant", content: event.delta });
          return { ...current, messages, active: true };
        });
        if (event.type === "status") setDrive((current) => current && ({ ...current, active: event.status === "working" }));
        if (event.type === "error" || event.type === "client_error") setError(event.error?.message || event.message || "Harness request failed");
      };
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Thread could not be opened"); }
  };
  const closeDrive = async () => {
    const current = drive(); socket?.close(); socket = null; setDrive(null);
    if (current) await api(`/v0/live-sessions/${current.id}/process`, { method: "DELETE" });
  };
  const track = async () => {
    const current = drive(); const selectedProject = project();
    if (!current || !selectedProject) return;
    await closeDrive();
    const chat = await api<ChatSummary>(`/v0/projects/${selectedProject.id}/backend-sessions/${current.nativeSessionId}/adopt`, { method: "POST" });
    props.onOpenChat?.(chat, selectedProject);
  };
  const launch = async () => {
    const selectedProject = project(); if (!selectedProject || !props.harness) return;
    const chat = await api<ChatSummary>("/v0/chats", { method: "POST", body: JSON.stringify({ projectId: selectedProject.id, profileId: props.harness.id }) });
    props.onOpenChat?.(chat, selectedProject, prompt().trim() || undefined);
  };
  const send = () => { const value = prompt().trim(); if (!value || !socket || socket.readyState !== WebSocket.OPEN) return; socket.send(JSON.stringify({ type: "prompt", message: value })); setPrompt(""); };

  return <main class="computer-harness-dashboard">
    <Show when={props.harness} fallback={<p class="computer-error">Harness is unavailable.</p>}>{(harness) => <>
      <header><img src={harness().id === "codex" ? "/codex-mark.svg" : "/chatgpt-mark.svg"} alt="" /><div><h1>{harness().label}</h1><p>{harness().version || "Installed adapter"} · {harness().status === "authentication_required" ? "Authentication required" : "Ready"}</p></div></header>
      <Show when={drive()} fallback={<>
        <section class="computer-harness-launch"><input aria-label="Initial prompt" placeholder="Optional initial prompt" value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} /><button type="button" disabled={!project()} onClick={() => void launch()}>Start tracked chat <ArrowRightIcon /></button></section>
        <section class="computer-harness-ledger"><div class="computer-harness-heading"><div><h2>Sessions</h2><p>Metadata from {harness().label}</p></div><select aria-label="Workspace" value={projectId()} onChange={(event) => setProjectId(event.currentTarget.value)}><For each={props.projects}>{(item) => <option value={item.id}>{item.name}</option>}</For></select></div>
          <Show when={!loading()} fallback={<p>Finding sessions…</p>}><For each={sessions()}>{(session) => <button type="button" onClick={() => void openDrive(session)}><span><strong>{session.title}</strong><small>{session.updatedAt ? new Date(session.updatedAt).toLocaleString() : session.id}</small></span><ArrowRightIcon /></button>}</For><Show when={!sessions().length}><p>No sessions in this workspace.</p></Show></Show>
        </section>
      </>}>
        {(current) => <section class="computer-harness-drive"><header><div><strong>Driving {harness().label} thread — not tracked</strong><small>{current().nativeSessionId}</small></div><button type="button" onClick={() => void track()}>Track this thread</button><button type="button" aria-label="Close drive mode" onClick={() => void closeDrive()}><XIcon /></button></header><div class="computer-harness-transcript"><For each={current().messages}>{(message) => <article data-role={message.role}>{message.content}</article>}</For></div><div class="computer-harness-composer"><textarea aria-label="Message" value={prompt()} onInput={(event) => setPrompt(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} /><button type="button" aria-label={current().active ? "Stop response" : "Send message"} onClick={() => current().active ? socket?.send(JSON.stringify({ type: "stop_generation" })) : send()}><SquareIcon /></button></div></section>}
      </Show>
      <Show when={error()}><p class="computer-error" role="alert">{error()}</p></Show>
    </>}</Show>
  </main>;
}

export const ComputerExplorer = ComputerDashboard;
