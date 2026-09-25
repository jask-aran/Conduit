import { isConduitManagedProject } from "../navigation/sidebar-preferences";
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import {
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  FolderGit2Icon,
  FolderOpenIcon,
  GitCompareArrowsIcon,
  PaletteIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  SearchIcon,
  Settings2Icon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-solid";
import { HarnessMark, ThreadHarnessMark } from "../harness-brand";
import { activityLabel } from "../../activity.js";
import { Segmented } from "../settings/settings-controls";
import { FileTypeIcon } from "../workspace/file-type-icon";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogContent,
  Field,
  FieldLabel,
  Input,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Spinner,
} from "@/components/primitives";
import { api } from "../api/client";
import type { DashboardChat, HarnessSummary, HarnessThread, HarnessThreadDiscovery, Project, ProjectDashboardPayload, WorkspaceAppearance, WorkspaceOperation } from "../api/contracts";
import { activityDetail, activityOf, RuntimeIndicator } from "../navigation/runtime-indicator";
import type { SidebarCommand } from "../navigation/sidebar";
import { COMMAND_IDS, commandLabel } from "../commands/command-registry";
import { SplitCounts, SplitDashboard, SplitEmpty, SplitGroup, SplitHeader, SplitRow, SplitShortcut, SplitShortcuts } from "../dashboard/primitives/split";
import type { Pty } from "../remotes/terminal-pane";
import type { RuntimeStore } from "../state/runtime";
import { compareChatsBySort, saveChatSort, useChatSort } from "../preferences/chat-sort";
import { WorkspaceGlyph } from "./workspace-appearance";
import { WorkspaceAppearanceEditor } from "./workspace-appearance-editor";
import "./dashboard.css";

type WorkspaceView = "files" | "diff" | "terminal";
const dashboardCache = new Map<string, { expiresAt: number; promise: Promise<ProjectDashboardPayload> }>();

function projectRevision(project: Project) {
  return `${project.state || ""}:${project.sessions.map((chat) => chat.updatedAt || chat.createdAt || "").join(",")}`;
}

export function prefetchProjectDashboard(project: Project) {
  const key = `${project.id}:${projectRevision(project)}`;
  const cached = dashboardCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;
  const promise = api<ProjectDashboardPayload>(`/v0/projects/${encodeURIComponent(project.id)}/dashboard`)
    .catch((error) => { dashboardCache.delete(key); throw error; });
  dashboardCache.clear();
  dashboardCache.set(key, { expiresAt: Date.now() + 30_000, promise });
  return promise;
}

function workspaceProject(project: Project) {
  return project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");
}

function kindLabel(project: Project) {
  if (project.origin === "cloned") return "Cloned workspace";
  if (project.origin === "created") return "Created workspace";
  if (workspaceProject(project)) return "Linked workspace";
  return "Managed folder";
}

type ThreadSide = "chats" | "outside";
type OutsideThread = HarnessThread & { harnessId: string; at: number };

function readThreadSide(projectId: string): ThreadSide {
  try { return localStorage.getItem(`conduit.dashboard.threads:${projectId}`) === "outside" ? "outside" : "chats"; } catch { return "chats"; }
}

// Harnesses report seconds, milliseconds or ISO strings.
function timestampOf(value: number | string | null | undefined) {
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  return Date.parse(value || "") || 0;
}

function compactDate(value?: string | null) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date);
}

function relativeActivity(value?: string | null, currentTime = Date.now()) {
  const timestamp = Date.parse(value || "") || 0;
  if (!timestamp) return "No activity";
  const minutes = Math.max(0, Math.floor((currentTime - timestamp) / 60_000));
  if (minutes < 1) return "Active now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function ProjectDashboard(props: {
  project: Project;
  composer: JSX.Element;
  runtime: RuntimeStore;
  onOpenChat: (chat: DashboardChat, project: Project) => Promise<void>;
  onOpenChatTerminal: (chat: DashboardChat, project: Project) => void;
  onPrefetchChat: (chat: DashboardChat) => void;
  onContextAction: (type: string, target: Omit<SidebarCommand, "type" | "nonce">) => void;
  isPinned: (type: "chat" | "project" | "terminal", id: string) => boolean;
  onOpenView: (view: WorkspaceView) => void;
  onOpenTerminal: (terminal: Pty) => void;
  onOpenTerminalMaximized: (terminal: Pty) => void;
  onPrefetchTerminal: () => void;
  onOpenHarnessThread?: (harnessId: string, path: string, threadId: string, title: string) => void;
  onSearchChats: () => void;
  onRename: () => void;
  onDelete: () => void;
  onOpenSettings: (section: string, workspaceId?: string | null) => void;
  onSaveAppearance: (projectId: string, appearance: WorkspaceAppearance) => Promise<Project>;
  onRefresh: () => Promise<unknown>;
  onCancelClone: (operationId: string) => Promise<void>;
  onDestroyWorkspace: (confirmation: string) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [payload, setPayload] = createSignal<ProjectDashboardPayload | null>(null);
  const [terminals, setTerminals] = createSignal<Pty[]>([]);
  const [terminalsLoading, setTerminalsLoading] = createSignal(true);
  const [error, setError] = createSignal("");
  const [copied, setCopied] = createSignal(false);
  const [refreshVersion, setRefreshVersion] = createSignal(0);
  const [now, setNow] = createSignal(Date.now());
  const [operation, setOperation] = createSignal<WorkspaceOperation | null>(null);
  const [cancellingClone, setCancellingClone] = createSignal(false);
  const [appearanceOpen, setAppearanceOpen] = createSignal(false);
  const [savingAppearance, setSavingAppearance] = createSignal(false);
  const [savedAppearance, setSavedAppearance] = createSignal<{ projectId: string; value: WorkspaceAppearance | null } | null>(null);
  const [destroyOpen, setDestroyOpen] = createSignal(false);
  const [destroyConfirmation, setDestroyConfirmation] = createSignal("");
  const [destroying, setDestroying] = createSignal(false);
  const [outsideThreads, setOutsideThreads] = createSignal<OutsideThread[]>([]);
  const [outsideHarnesses, setOutsideHarnesses] = createSignal<Array<{ id: string; label: string }>>([]);
  const [outsideLoading, setOutsideLoading] = createSignal(true);
  const [outsideFilter, setOutsideFilter] = createSignal("");
  const [threadSide, setThreadSide] = createSignal<ThreadSide>("chats");
  const chatSort = useChatSort();
  const projectId = createMemo(() => props.project.id);
  const isWorkspace = createMemo(() => workspaceProject(props.project));
  const cloning = createMemo(() => props.project.state === "cloning" && Boolean(props.project.cloneOperationId));

  const activeAppearance = createMemo(() => {
    const saved = savedAppearance();
    if (saved?.projectId === projectId()) return saved.value;
    return payload()?.identity.workspaceAppearance ?? props.project.workspaceAppearance ?? null;
  });
  const visibleChats = createMemo<DashboardChat[]>(() => {
    const sort = chatSort();
    const previews = new Map((payload()?.recentChats || []).map((chat) => [chat.id, chat]));
    return props.project.sessions
      .map((chat) => ({ ...chat, lastMessageAt: previews.get(chat.id)?.lastMessageAt || chat.lastMessageAt, lastMessagePreview: previews.get(chat.id)?.lastMessagePreview || "" }))
      .filter((chat) => chat.status === "active")
      .sort((left, right) => compareChatsBySort(left, right, sort))
      .slice(0, 10);
  });
  const activeChatCount = createMemo(() => payload()?.stats.activeChats
    ?? props.project.sessions.filter((chat) => chat.status === "active").length);
  const scopedTerminals = createMemo(() => terminals()
    .filter((terminal) => terminal.projectId === projectId() && terminal.status === "running"));
  const filteredOutside = createMemo(() => outsideFilter() ? outsideThreads().filter((thread) => thread.harnessId === outsideFilter()) : outsideThreads());
  createEffect(() => setThreadSide(readThreadSide(projectId())));
  const saveThreadSide = (side: ThreadSide) => {
    setThreadSide(side);
    try { localStorage.setItem(`conduit.dashboard.threads:${projectId()}`, side); } catch { /* a per-viewer convenience */ }
  };

  const refreshTerminals = async () => {
    try {
      const result = await api<{ ptys: Pty[] }>("/v0/ptys");
      setTerminals(result.ptys || []);
    } catch {
      setTerminals([]);
    } finally {
      setTerminalsLoading(false);
    }
  };

  onMount(() => {
    const refresh = () => {
      setRefreshVersion((version) => version + 1);
      void refreshTerminals();
    };
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    window.addEventListener("conduit:ptys-changed", refresh);
    void refreshTerminals();
    onCleanup(() => {
      window.clearInterval(clock);
      window.removeEventListener("conduit:ptys-changed", refresh);
    });
  });

  createEffect(() => {
    const id = projectId();
    const version = refreshVersion();
    if (cloning()) return;
    setPayload(null);
    setError("");
    let disposed = false;
    const request = version === 0
      ? prefetchProjectDashboard(props.project)
      : api<ProjectDashboardPayload>(`/v0/projects/${encodeURIComponent(id)}/dashboard`);
    void request
      .then((next) => { if (!disposed) setPayload(next); })
      .catch((requestError) => {
        if (!disposed) setError((requestError as Error).message);
      });
    onCleanup(() => { disposed = true; });
  });

  // Threads this workspace's harnesses ran here that no Conduit chat owns.
  createEffect(() => {
    const path = props.project.workingRoot;
    refreshVersion();
    if (!isWorkspace() || cloning() || !path) { setOutsideThreads([]); setOutsideLoading(false); return; }
    let disposed = false;
    setOutsideLoading(true);
    void (async () => {
      const { harnesses } = await api<{ harnesses: HarnessSummary[] }>("/v0/harnesses");
      const visible = harnesses.filter((harness) => harness.available && harness.discovery === "machine");
      const found = await Promise.all(visible.map((harness) => api<HarnessThreadDiscovery>(`/v0/harnesses/${encodeURIComponent(harness.id)}/threads?path=${encodeURIComponent(path)}`)
        .then((discovery) => discovery.groups.flatMap((group) => group.threads)
          .filter((thread) => !thread.tracked)
          .map((thread) => ({ ...thread, harnessId: harness.id as string, at: timestampOf(thread.updatedAt ?? thread.createdAt) })))
        .catch(() => [])));
      if (disposed) return;
      setOutsideHarnesses(visible.map((harness) => ({ id: harness.id as string, label: harness.label })));
      setOutsideThreads(found.flat().sort((left, right) => right.at - left.at));
    })().catch(() => { if (!disposed) setOutsideThreads([]); })
      .finally(() => { if (!disposed) setOutsideLoading(false); });
    onCleanup(() => { disposed = true; });
  });

  createEffect(() => {
    const operationId = props.project.cloneOperationId;
    if (!cloning() || !operationId) {
      setOperation(null);
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const next = await api<WorkspaceOperation>(`/v0/workspace-operations/${encodeURIComponent(operationId)}`);
        if (disposed) return;
        setOperation(next);
        if (["ready", "cancelled", "failed", "complete"].includes(next.state)) {
          await props.onRefresh();
          return;
        }
      } catch {
        if (!disposed) await props.onRefresh();
        return;
      }
      if (!disposed) timer = setTimeout(() => { void refresh(); }, 500);
    };
    void refresh();
    onCleanup(() => {
      disposed = true;
      if (timer) clearTimeout(timer);
    });
  });

  const copyPath = async () => {
    const path = payload()?.identity.workingRoot || props.project.workingRoot;
    if (!path) return;
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (copyError) {
      props.onError((copyError as Error).message);
    }
  };

  const saveAppearance = async (appearance: WorkspaceAppearance) => {
    if (savingAppearance()) return;
    setSavingAppearance(true);
    try {
      const saved = await props.onSaveAppearance(props.project.id, appearance);
      const value = saved.workspaceAppearance || null;
      setSavedAppearance({ projectId: props.project.id, value });
      setPayload((current) => current ? {
        ...current,
        identity: { ...current.identity, workspaceAppearance: value },
      } : current);
      setAppearanceOpen(false);
    } catch (saveError) {
      props.onError((saveError as Error).message);
    } finally {
      setSavingAppearance(false);
    }
  };

  const cancelClone = async () => {
    const operationId = props.project.cloneOperationId;
    if (!operationId || cancellingClone()) return;
    setCancellingClone(true);
    try {
      await props.onCancelClone(operationId);
      await props.onRefresh();
    } catch (cancelError) {
      props.onError((cancelError as Error).message);
    } finally {
      setCancellingClone(false);
    }
  };

  const destroyWorkspace = async () => {
    if (destroying() || destroyConfirmation() !== props.project.name) return;
    setDestroying(true);
    try {
      if (await props.onDestroyWorkspace(destroyConfirmation())) {
        setDestroyOpen(false);
        setDestroyConfirmation("");
      }
    } finally {
      setDestroying(false);
    }
  };

  const terminalActivity = (terminal: Pty) => relativeActivity(
    terminal.lastActivityAt || terminal.updatedAt || terminal.createdAt,
    now(),
  );
  const git = createMemo(() => payload()?.git || null);
  const changeTotals = createMemo(() => (payload()?.changes || []).reduce((sum, file) => ({
    added: sum.added + (file.added ?? 0),
    removed: sum.removed + (file.removed ?? 0),
  }), { added: 0, removed: 0 }));
  const workingRoot = () => payload()?.identity.workingRoot || props.project.workingRoot || "";
  const showOutside = () => isWorkspace() && threadSide() === "outside";

  const manageMenu = () => <Menu modal={false}>
    <MenuTrigger class="workspace-dashboard-manage" aria-label={isWorkspace() ? "Manage workspace" : "Manage project"} title={isWorkspace() ? "Manage workspace" : "Manage project"}><EllipsisIcon /></MenuTrigger>
    <MenuContent>
      <MenuGroup>
        <Show when={isWorkspace()}><MenuItem onSelect={() => setAppearanceOpen(true)}><PaletteIcon />Workspace identity</MenuItem></Show>
        <MenuItem onSelect={props.onRename}><PencilIcon />Rename</MenuItem>
        <MenuItem onSelect={() => props.onOpenSettings("workspaces", props.project.id)}><Settings2Icon />{isWorkspace() ? "Workspace settings" : "Project settings"}</MenuItem>
      </MenuGroup>
      <MenuSeparator />
      <MenuItem variant="destructive" onSelect={props.onDelete}><Trash2Icon />{isWorkspace() ? "Unlink workspace" : "Delete project"}</MenuItem>
      <Show when={isWorkspace()}><MenuItem variant="destructive" onSelect={() => setDestroyOpen(true)}><Trash2Icon />Delete workspace and files</MenuItem></Show>
    </MenuContent>
  </Menu>;

  // Running chats stay in place; their dot and activity say they are live.
  const chatRows = () => <Show when={visibleChats().length} fallback={<SplitEmpty>Nothing here yet.</SplitEmpty>}>
    <For each={visibleChats()}>{(item) => {
      const process = () => props.runtime.getProcess(item.id);
      const live = () => process()?.active ? activityLabel(activityOf(process()) || "working", activityDetail(process())) : "";
      return <ContextMenu><ContextMenuTrigger as={SplitRow} element="button" onPointerEnter={() => props.onPrefetchChat(item)} onFocus={() => props.onPrefetchChat(item)} onClick={() => void props.onOpenChat(item, props.project)}
          lead={<RuntimeIndicator process={process()} stale={props.runtime.stale()} unread={item.unread} fallback={<ThreadHarnessMark id={item.harnessId} />} />}
          primary={item.title || "Untitled chat"}
          context={live() || item.lastMessagePreview}
          trailing={<time dateTime={item.lastMessageAt || item.createdAt}>{relativeActivity(item.lastMessageAt || item.createdAt, now())}</time>} />
        <ContextMenuContent class="w-60 sidebar-context-menu"><ContextMenuGroup>
          <ContextMenuItem onSelect={() => props.onContextAction("rename-chat", { chat: item, project: props.project })}><PencilIcon />{commandLabel(COMMAND_IDS.renameChat)}</ContextMenuItem>
          <ContextMenuItem onSelect={() => props.onContextAction("move-chat", { chat: item, project: props.project })}><FolderOpenIcon />Move to folder…</ContextMenuItem>
          <ContextMenuItem onSelect={() => props.onContextAction("copy-chat", { chat: item })}><CopyIcon />{commandLabel(COMMAND_IDS.copyTranscript)}</ContextMenuItem>
          <ContextMenuItem onSelect={() => props.onOpenChatTerminal(item, props.project)}><TerminalIcon />Open terminal</ContextMenuItem>
          <Show when={isConduitManagedProject(props.project)}><ContextMenuItem onSelect={() => props.onContextAction("pin-chat", { chat: item })}><Show when={props.isPinned("chat", item.id)} fallback={<><PinIcon />Pin to sidebar</>}><PinOffIcon />Unpin</Show></ContextMenuItem></Show>
        </ContextMenuGroup><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => props.onContextAction("delete-chat", { chat: item, project: props.project })}><Trash2Icon />{commandLabel(COMMAND_IDS.deleteChat)}</ContextMenuItem></ContextMenuContent></ContextMenu>;
    }}</For>
  </Show>;

  const outsideRows = () => <Show when={!outsideLoading()} fallback={<SplitEmpty><Spinner /><span>Looking for threads…</span></SplitEmpty>}>
    <Show when={filteredOutside().length} fallback={<SplitEmpty>No threads outside Conduit in this workspace.</SplitEmpty>}>
      <For each={filteredOutside()}>{(thread) =>
        <SplitRow element="button" title={thread.preview || thread.title} onClick={() => props.onOpenHarnessThread?.(thread.harnessId, workingRoot(), thread.id, thread.title)}
          lead={<HarnessMark id={thread.harnessId} />} primary={thread.title || "Untitled thread"} context={thread.preview}
          trailing={thread.at ? relativeActivity(new Date(thread.at).toISOString(), now()) : ""} />}
      </For>
    </Show>
  </Show>;

  const threadsGroup = () => <SplitGroup id="dashboard-threads" order="list" heading={<Show when={isWorkspace()} fallback={<h2 id="dashboard-threads">Chats<small>{activeChatCount()}</small></h2>}>
      <Segmented label="Threads" value={threadSide()} onChange={(value) => saveThreadSide(value as ThreadSide)} options={[
        { value: "chats", label: "Chats", detail: <small>{activeChatCount()}</small> },
        { value: "outside", label: "Not in Conduit", detail: <Show when={!outsideLoading()}><small>{outsideThreads().length}</small></Show> },
      ]} />
    </Show>} actions={<Show when={showOutside()} fallback={<>
        <button type="button" title="Change sort" onClick={() => saveChatSort(chatSort() === "latest" ? "created" : "latest")}>{chatSort() === "latest" ? "Latest" : "Created"}</button>
        <button type="button" aria-label={`Search chats in ${props.project.name}`} title="Search chats" onClick={props.onSearchChats}><SearchIcon /></button>
      </>}>
      <Show when={outsideHarnesses().length > 1}>
        <Menu modal={false}>
          <MenuTrigger>{outsideHarnesses().find((harness) => harness.id === outsideFilter())?.label || "All harnesses"}<ChevronDownIcon /></MenuTrigger>
          <MenuContent>
            <MenuItem onSelect={() => setOutsideFilter("")}>All harnesses</MenuItem>
            <For each={outsideHarnesses()}>{(harness) => <MenuItem onSelect={() => setOutsideFilter(harness.id)}><HarnessMark id={harness.id} />{harness.label}</MenuItem>}</For>
          </MenuContent>
        </Menu>
      </Show>
    </Show>}>
    <Show when={showOutside()} fallback={chatRows()}>{outsideRows()}</Show>
  </SplitGroup>;

  const terminalsGroup = () => <SplitGroup id="dashboard-terminals" label="Terminals" count={scopedTerminals().length} busy={terminalsLoading()} actions={<button type="button" onClick={() => props.onOpenView("terminal")}>Open</button>}>
    <Show when={scopedTerminals().length} fallback={<SplitEmpty>{terminalsLoading() ? "Loading terminals…" : "No live terminals."}</SplitEmpty>}>
      <For each={scopedTerminals()}>{(terminal) =>
        <ContextMenu><ContextMenuTrigger as={SplitRow} element="button" onPointerEnter={props.onPrefetchTerminal} onFocus={props.onPrefetchTerminal} onClick={() => props.onOpenTerminal(terminal)}
            lead={<TerminalIcon />} primary={terminal.title || "Shell"} context={terminal.currentCommand || "shell"} trailing={terminalActivity(terminal)} />
          <ContextMenuContent class="w-52 sidebar-context-menu"><ContextMenuGroup>
            <ContextMenuItem onSelect={() => props.onOpenTerminalMaximized(terminal)}><TerminalIcon />Open maximized</ContextMenuItem>
            <ContextMenuItem onSelect={() => props.onContextAction("rename-terminal", { terminal })}><PencilIcon />Rename</ContextMenuItem>
          </ContextMenuGroup><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => props.onContextAction("delete-terminal", { terminal })}><Trash2Icon />Destroy shell</ContextMenuItem></ContextMenuContent></ContextMenu>}
      </For>
    </Show>
  </SplitGroup>;

  // Uncommitted work against HEAD, staged and unstaged together, drawn with
  // the workspace panel's change rows.
  const changesGroup = () => <SplitGroup id="dashboard-changes" label="Changes" count={git()?.changedFiles ?? 0} actions={<Show when={git()?.changedFiles}><SplitCounts {...changeTotals()} /></Show>}>
    <Show when={payload()?.changes.length} fallback={<SplitEmpty>{payload() ? "Working tree clean." : "Loading…"}</SplitEmpty>}>
      <For each={payload()!.changes}>{(file) => {
        const name = file.path.replace(/\/$/, "").split("/").at(-1) ?? file.path;
        const directory = file.path.replace(/\/$/, "").split("/").slice(0, -1).join("/");
        const status = file.status === "??" ? "U" : file.status.trim().charAt(0);
        return <button type="button" class="split-row split-change-row" title={file.path} onClick={() => props.onOpenView("diff")}>
          <FileTypeIcon name={name} />
          <span class="workspace-change-name">{name}</span>
          <span class="workspace-change-directory">{directory}</span>
          <Show when={file.added != null} fallback={<small class="workspace-change-counts">—</small>}>
            <small class="workspace-change-counts"><span class="workspace-git-removed">−{file.removed}</span><span class="workspace-git-added">+{file.added}</span></small>
          </Show>
          <code data-status={status}>{status}</code>
        </button>;
      }}</For>
    </Show>
  </SplitGroup>;

  const filesGroup = () => <SplitGroup id="dashboard-files" label="Files" actions={<button type="button" onClick={() => props.onOpenView("files")}>Browse</button>}>
    <Show when={payload()?.recentFiles.length} fallback={<SplitEmpty>{payload() ? "No files yet." : "Loading…"}</SplitEmpty>}>
      <For each={payload()!.recentFiles}>{(file) =>
        <SplitRow element="button" onClick={() => props.onOpenView("files")} lead={<FileTypeIcon name={file.name} />} primary={file.name} trailing={relativeActivity(file.modifiedAt, now())} />}
      </For>
    </Show>
  </SplitGroup>;

  return <>
    <SplitDashboard class="workspace-dashboard" label={`${props.project.name} dashboard`}
      header={<SplitHeader title={props.project.name} kind={kindLabel(props.project)}
        glyph={<Show when={isWorkspace()} fallback={<FolderGit2Icon />}><WorkspaceGlyph appearance={activeAppearance()} /></Show>}
        context={[
          <button type="button" title="Copy working path" onClick={() => void copyPath()}><code>{copied() ? "Copied" : workingRoot() || "Working path unavailable"}</code></button>,
          git() && <>{git()!.branch}{git()!.upstream ? ` → ${git()!.upstream}` : ""}</>,
          git() && (git()!.ahead || git()!.behind) ? [git()!.ahead && `${git()!.ahead} ahead`, git()!.behind && `${git()!.behind} behind`].filter(Boolean).join(", ") : null,
          !isWorkspace() && `last active ${relativeActivity(payload()?.stats.lastActivityAt, now()).toLowerCase()}`,
        ]} />}
      shortcuts={<SplitShortcuts>
        <SplitShortcut icon={<FolderOpenIcon />} label="Files" onClick={() => props.onOpenView("files")} />
        <Show when={isWorkspace()} fallback={<SplitShortcut icon={<SearchIcon />} label="Search chats" onClick={props.onSearchChats} />}>
          <SplitShortcut icon={<GitCompareArrowsIcon />} label="Changes" onClick={() => props.onOpenView("diff")} />
        </Show>
        <Show when={isWorkspace()} fallback={<SplitShortcut icon={<CopyIcon />} label="Copy path" onClick={() => void copyPath()} />}>
          <SplitShortcut icon={<TerminalIcon />} label="Terminal" onClick={() => props.onOpenView("terminal")} />
        </Show>
        <SplitShortcut icon={<Settings2Icon />} label="Settings" onClick={() => props.onOpenSettings("workspaces", props.project.id)} />
        {manageMenu()}
      </SplitShortcuts>}
      notice={cloning() || (error() && !cloning()) ? <>
        <Show when={cloning()}>
          <section class="clone-progress" aria-live="polite">
            <div class="clone-progress-heading"><Spinner /><div><strong>{operation()?.state === "cancelling" ? "Cancelling clone" : "Cloning workspace"}</strong><p>Closing this tab does not stop the operation.</p></div></div>
            <div class="clone-progress-path"><span>Destination</span><code>{props.project.workingRoot}</code></div>
            <pre aria-label="Clone output preview">{operation()?.diagnostic || "Preparing clone…"}</pre>
            <Button variant="destructive" size="sm" disabled={cancellingClone()} onClick={() => void cancelClone()}><XIcon />{cancellingClone() ? "Cancelling…" : "Cancel clone"}</Button>
          </section>
        </Show>
        <Show when={error() && !cloning()}>
          <div class="project-dashboard-error" role="alert"><strong>Dashboard details could not be loaded</strong><span>{error()}</span></div>
        </Show>
      </> : undefined}
      composer={cloning() ? undefined : props.composer}
      list={<Show when={!cloning()}>{threadsGroup()}</Show>}
      aside={<Show when={!cloning()}>
        <Show when={isWorkspace()}>{terminalsGroup()}</Show>
        <Show when={git()} fallback={filesGroup()}>{changesGroup()}</Show>
      </Show>} />

    <Dialog open={appearanceOpen()} onOpenChange={(open) => { if (!savingAppearance()) setAppearanceOpen(open); }}>
      <DialogContent class="workspace-appearance-dialog" title="Workspace identity" description="Choose a short mark or a Lucide icon, then choose a preset or custom color.">
        <Show when={appearanceOpen()}>
          <WorkspaceAppearanceEditor compact value={activeAppearance()} saving={savingAppearance()} onSave={(appearance) => void saveAppearance(appearance)} />
        </Show>
      </DialogContent>
    </Dialog>

    <KAlertDialog.Root open={destroyOpen()} onOpenChange={(open) => { if (!destroying()) setDestroyOpen(open); }}>
      <KAlertDialog.Portal><KAlertDialog.Content class="conduit-modal" onEscapeKeyDown={(event) => { if (destroying()) event.preventDefault(); }}>
        <div class="conduit-modal-card workspace-destroy-dialog">
          <KAlertDialog.Title>Delete workspace and files?</KAlertDialog.Title>
          <KAlertDialog.Description>This removes <strong>{props.project.name}</strong> from Conduit and permanently erases its working directory. Type the exact workspace name to continue.</KAlertDialog.Description>
          <Field>
            <FieldLabel for="workspace-destroy-confirmation">Workspace name</FieldLabel>
            <Input id="workspace-destroy-confirmation" value={destroyConfirmation()} onInput={(event) => setDestroyConfirmation(event.currentTarget.value)} autocomplete="off" />
          </Field>
          <div class="conduit-modal-actions">
            <Button variant="outline" size="sm" disabled={destroying()} onClick={() => setDestroyOpen(false)}>Cancel</Button>
            <Button class="workspace-destroy-confirm" variant="destructive" size="sm" disabled={destroying() || destroyConfirmation() !== props.project.name} onClick={() => void destroyWorkspace()}><Trash2Icon />{destroying() ? "Deleting…" : "Delete workspace and files"}</Button>
          </div>
        </div>
      </KAlertDialog.Content></KAlertDialog.Portal>
    </KAlertDialog.Root>
  </>;
}

export default ProjectDashboard;
