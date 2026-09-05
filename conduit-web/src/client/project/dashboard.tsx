import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import {
  ArrowRightIcon,
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
import type { DashboardChat, Project, ProjectDashboardPayload, WorkspaceAppearance, WorkspaceOperation } from "../api/contracts";
import { RuntimeIndicator } from "../navigation/runtime-indicator";
import type { SidebarCommand } from "../navigation/sidebar";
import { COMMAND_IDS, commandLabel } from "../commands/command-registry";
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
    return [...props.project.sessions]
      .filter((chat) => chat.status === "active")
      .sort((left, right) => compareChatsBySort(left, right, sort))
      .slice(0, 10);
  });
  const activeChatCount = createMemo(() => payload()?.stats.activeChats
    ?? props.project.sessions.filter((chat) => chat.status === "active").length);
  const scopedTerminals = createMemo(() => terminals()
    .filter((terminal) => terminal.projectId === projectId() && terminal.status === "running"));
  const liveTerminals = createMemo(() => scopedTerminals().slice(0, 4));

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
  const terminalCwd = (terminal: Pty) => terminal.cwd || props.project.workingRoot || "Working directory unavailable";
  const git = createMemo(() => payload()?.git || null);

  return <section class="project-dashboard workspace-dashboard" aria-label={`${props.project.name} dashboard`}>
    <div class="workspace-dashboard-content">
      <header class="workspace-dashboard-identity">
        <div class="workspace-dashboard-title">
          <span class="workspace-dashboard-glyph">
            <Show when={isWorkspace()} fallback={<FolderGit2Icon />}><WorkspaceGlyph appearance={activeAppearance()} /></Show>
          </span>
          <div>
            <div class="workspace-dashboard-name">
              <h1>{props.project.name}</h1>
              <span>{kindLabel(props.project)}</span>
            </div>
            <button type="button" class="workspace-dashboard-path" title="Copy working path" onClick={() => void copyPath()}>
              <code>{payload()?.identity.workingRoot || props.project.workingRoot || "Working path unavailable"}</code>
              <CopyIcon />
              <Show when={copied()}><em>Copied</em></Show>
            </button>
          </div>
        </div>
        <Menu modal={false}>
          <MenuTrigger class="workspace-dashboard-manage" aria-label="Manage workspace" title="Manage workspace"><EllipsisIcon /></MenuTrigger>
          <MenuContent>
            <MenuGroup>
              <Show when={isWorkspace()}><MenuItem onSelect={() => setAppearanceOpen(true)}><PaletteIcon />Workspace identity</MenuItem></Show>
              <MenuItem onSelect={props.onRename}><PencilIcon />Rename</MenuItem>
              <MenuItem onSelect={() => props.onOpenSettings("workspaces", props.project.id)}><Settings2Icon />Workspace settings</MenuItem>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem variant="destructive" onSelect={props.onDelete}><Trash2Icon />{isWorkspace() ? "Unlink workspace" : "Delete project"}</MenuItem>
            <Show when={isWorkspace()}><MenuItem variant="destructive" onSelect={() => setDestroyOpen(true)}><Trash2Icon />Delete workspace and files</MenuItem></Show>
          </MenuContent>
        </Menu>
      </header>

      <Show when={cloning()}>
        <section class="clone-progress" aria-live="polite">
          <div class="clone-progress-heading"><Spinner /><div><strong>{operation()?.state === "cancelling" ? "Cancelling clone" : "Cloning workspace"}</strong><p>Closing this tab does not stop the operation.</p></div></div>
          <div class="clone-progress-path"><span>Destination</span><code>{props.project.workingRoot}</code></div>
          <pre aria-label="Clone output preview">{operation()?.diagnostic || "Preparing clone…"}</pre>
          <Button variant="destructive" size="sm" disabled={cancellingClone()} onClick={() => void cancelClone()}><XIcon />{cancellingClone() ? "Cancelling…" : "Cancel clone"}</Button>
        </section>
      </Show>

      <Dialog open={appearanceOpen()} onOpenChange={(open) => { if (!savingAppearance()) setAppearanceOpen(open); }}>
        <DialogContent class="workspace-appearance-dialog" title="Workspace identity" description="Choose a short mark or a Lucide icon, then choose a preset or custom color.">
          <Show when={appearanceOpen()}>
            <WorkspaceAppearanceEditor compact value={activeAppearance()} saving={savingAppearance()} onSave={(appearance) => void saveAppearance(appearance)} />
          </Show>
        </DialogContent>
      </Dialog>

      <Show when={error() && !cloning()}>
        <div class="project-dashboard-error" role="alert"><strong>Dashboard details could not be loaded</strong><span>{error()}</span></div>
      </Show>

      <Show when={!cloning()}>
        <div class="workspace-dashboard-launch-row">
          <div class="workspace-dashboard-composer-slot">{props.composer}</div>
          <aside class="workspace-dashboard-quick-actions" aria-label="Workspace quick actions">
            <span>Workspace actions</span>
            <button type="button" onClick={() => props.onOpenView("files")}><FolderOpenIcon /><strong>Files</strong><ArrowRightIcon /></button>
            <Show when={isWorkspace()} fallback={<button type="button" onClick={props.onSearchChats}><SearchIcon /><strong>Search chats</strong><ArrowRightIcon /></button>}>
              <button type="button" onClick={() => props.onOpenView("diff")}><GitCompareArrowsIcon /><strong>Changes</strong><ArrowRightIcon /></button>
            </Show>
            <Show when={isWorkspace()} fallback={<button type="button" onClick={() => void copyPath()}><CopyIcon /><strong>Copy path</strong><ArrowRightIcon /></button>}>
              <button type="button" onClick={() => props.onOpenView("terminal")}><TerminalIcon /><strong>Terminal</strong><ArrowRightIcon /></button>
            </Show>
            <button type="button" onClick={() => props.onOpenSettings("workspaces", props.project.id)}><Settings2Icon /><strong>Settings</strong><ArrowRightIcon /></button>
          </aside>
        </div>

        <div class="workspace-dashboard-grid">
          <section class="workspace-dashboard-section workspace-dashboard-chats" aria-labelledby="workspace-recent-chats">
            <div class="workspace-dashboard-section-heading">
              <div>
                <h2 id="workspace-recent-chats">Recent chats</h2>
                <p>{activeChatCount() > 10 ? "10 most recent in this workspace" : "Conversations in this workspace"}</p>
              </div>
              <div class="workspace-dashboard-chat-actions">
                <div class="workspace-dashboard-scope-toggle" role="group" aria-label="Recent chat sort">
                  <button type="button" aria-pressed={chatSort() === "latest"} onClick={() => saveChatSort("latest")}>Latest</button>
                  <button type="button" aria-pressed={chatSort() === "created"} onClick={() => saveChatSort("created")}>Created</button>
                </div>
                <button type="button" class="workspace-dashboard-search" aria-label={`Search chats in ${props.project.name}`} title="Search workspace chats" onClick={props.onSearchChats}><SearchIcon /></button>
              </div>
            </div>
            <Show when={visibleChats().length} fallback={<div class="workspace-dashboard-empty">No chats yet. Start one above.</div>}>
              <div class="project-chat-list">
                <For each={visibleChats()}>{(item) =>
                  <ContextMenu><ContextMenuTrigger as="button" class="project-chat-row" onPointerEnter={() => props.onPrefetchChat(item)} onFocus={() => props.onPrefetchChat(item)} onClick={() => void props.onOpenChat(item, props.project)}>
                    <span class="project-chat-runtime"><RuntimeIndicator process={props.runtime.getProcess(item.id)} stale={props.runtime.stale()} /></span>
                    <span class="project-chat-copy">
                      <strong>{item.title || "Untitled chat"}</strong>
                      <small>{props.project.name}{compactDate(item.createdAt) ? ` · ${compactDate(item.createdAt)}` : ""}</small>
                    </span>
                    <time dateTime={item.updatedAt || item.createdAt}>{relativeActivity(item.updatedAt || item.createdAt, now())}</time>
                    <ArrowRightIcon />
                  </ContextMenuTrigger><ContextMenuContent class="w-60 sidebar-context-menu"><ContextMenuGroup>
                    <ContextMenuItem onSelect={() => props.onContextAction("rename-chat", { chat: item, project: props.project })}><PencilIcon />{commandLabel(COMMAND_IDS.renameChat)}</ContextMenuItem>
                    <ContextMenuItem onSelect={() => props.onContextAction("move-chat", { chat: item, project: props.project })}><FolderOpenIcon />Move to folder…</ContextMenuItem>
                    <ContextMenuItem onSelect={() => props.onContextAction("copy-chat", { chat: item })}><CopyIcon />{commandLabel(COMMAND_IDS.copyTranscript)}</ContextMenuItem>
                    <ContextMenuItem onSelect={() => props.onOpenChatTerminal(item, props.project)}><TerminalIcon />Open terminal</ContextMenuItem>
                    <ContextMenuItem onSelect={() => props.onContextAction("pin-chat", { chat: item })}><Show when={props.isPinned("chat", item.id)} fallback={<><PinIcon />Pin to sidebar</>}><PinOffIcon />Unpin</Show></ContextMenuItem>
                  </ContextMenuGroup><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => props.onContextAction("delete-chat", { chat: item, project: props.project })}><Trash2Icon />{commandLabel(COMMAND_IDS.deleteChat)}</ContextMenuItem></ContextMenuContent></ContextMenu>}
                </For>
              </div>
            </Show>
          </section>

          <aside class="workspace-dashboard-rail">
            <Show when={isWorkspace()} fallback={
              <section class="workspace-dashboard-section workspace-dashboard-scope" aria-labelledby="workspace-scope-title">
                <div class="workspace-dashboard-section-heading"><div><h2 id="workspace-scope-title">Project scope</h2><p>Managed by Conduit</p></div></div>
                <dl>
                  <div><dt>Chats</dt><dd>{payload()?.stats.activeChats ?? props.project.sessions.length}</dd></div>
                  <div><dt>Live now</dt><dd>{payload()?.stats.liveChats ?? 0}</dd></div>
                  <div><dt>Last activity</dt><dd>{relativeActivity(payload()?.stats.lastActivityAt, now())}</dd></div>
                </dl>
              </section>
            }>
              <section class="workspace-dashboard-section workspace-dashboard-repository" aria-labelledby="workspace-repository-title">
                <div class="workspace-dashboard-section-heading">
                  <div><h2 id="workspace-repository-title">Repository</h2><p>{git()?.branch || (payload() ? "No Git repository" : "Loading…")}</p></div>
                  <Show when={git()}><button type="button" onClick={() => props.onOpenView("diff")}>Open changes <ArrowRightIcon /></button></Show>
                </div>
                <Show when={git()} fallback={<div class="workspace-dashboard-empty">No Git repository detected.</div>}>
                  <div class="workspace-dashboard-repository-state">
                    <div><strong>{git()!.branch}</strong><small>{git()!.upstream || "No upstream"}</small></div>
                    <dl>
                      <div><dt>Changed</dt><dd>{git()!.changedFiles}</dd></div>
                      <div><dt>Ahead</dt><dd>{git()!.ahead}</dd></div>
                      <div><dt>Behind</dt><dd>{git()!.behind}</dd></div>
                    </dl>
                  </div>
                </Show>
              </section>

              <section class="workspace-dashboard-section workspace-dashboard-terminals" aria-labelledby="workspace-terminals-title">
                <div class="workspace-dashboard-section-heading">
                  <div><h2 id="workspace-terminals-title">Live terminals</h2><p>{scopedTerminals().length || "No"} running in {props.project.name}</p></div>
                </div>
                <Show when={!terminalsLoading()} fallback={<div class="workspace-dashboard-empty"><Spinner /><span>Loading terminals…</span></div>}>
                  <Show when={liveTerminals().length} fallback={<div class="workspace-dashboard-empty">No live terminals.</div>}>
                    <div class="workspace-dashboard-terminal-list">
                      <For each={liveTerminals()}>{(terminal) =>
                        <ContextMenu><ContextMenuTrigger as="button" type="button" onPointerEnter={props.onPrefetchTerminal} onFocus={props.onPrefetchTerminal} onClick={() => props.onOpenTerminal(terminal)}>
                          <TerminalIcon />
                          <span>
                            <strong>{terminal.title || "Shell"}</strong>
                            <small title={`${terminal.currentCommand || "shell"} · ${terminalActivity(terminal)} · ${terminalCwd(terminal)}`}>
                              {terminal.currentCommand || "shell"} · {terminalActivity(terminal)} · <code>{terminalCwd(terminal)}</code>
                            </small>
                          </span>
                          <ArrowRightIcon />
                        </ContextMenuTrigger><ContextMenuContent class="w-52 sidebar-context-menu"><ContextMenuGroup>
                          <ContextMenuItem onSelect={() => props.onOpenTerminalMaximized(terminal)}><TerminalIcon />Open maximized</ContextMenuItem>
                          <ContextMenuItem onSelect={() => props.onContextAction("rename-terminal", { terminal })}><PencilIcon />Rename</ContextMenuItem>
                          <ContextMenuItem onSelect={() => props.onContextAction("pin-terminal", { terminal })}><Show when={props.isPinned("terminal", terminal.id)} fallback={<><PinIcon />Pin to sidebar</>}><PinOffIcon />Unpin</Show></ContextMenuItem>
                        </ContextMenuGroup><ContextMenuSeparator /><ContextMenuItem variant="destructive" onSelect={() => props.onContextAction("delete-terminal", { terminal })}><Trash2Icon />Destroy shell</ContextMenuItem></ContextMenuContent></ContextMenu>}
                      </For>
                    </div>
                  </Show>
                </Show>
              </section>
            </Show>
          </aside>
        </div>
      </Show>
    </div>

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
  </section>;
}

export default ProjectDashboard;
