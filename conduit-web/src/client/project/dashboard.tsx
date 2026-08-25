import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import {
  ArrowRightIcon,
  CalendarDaysIcon,
  ChevronDownIcon,
  Clock3Icon,
  CopyIcon,
  FolderGit2Icon,
  GitBranchIcon,
  MessageSquarePlusIcon,
  PaletteIcon,
  PencilIcon,
  Settings2Icon,
  Trash2Icon,
  XIcon,
} from "lucide-solid";
import {
  Badge,
  Button,
  Field,
  FieldLabel,
  Input,
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
  Spinner,
  Dialog,
  DialogContent,
} from "@/components/primitives";
import { api } from "../api/client";
import type { DashboardChat, Project, ProjectDashboardPayload, Template, WorkspaceAppearance, WorkspaceOperation } from "../api/contracts";
import type { RuntimeStore } from "../state/runtime";
import { RuntimeIndicator } from "../navigation/runtime-indicator";
import { WorkspaceGlyph } from "./workspace-appearance";
import { WorkspaceAppearanceEditor } from "./workspace-appearance-editor";
import "./dashboard.css";

function workspaceProject(project: Project) {
  return project.kind === "workspace" || ["linked", "created", "cloned"].includes(project.origin || "");
}

function kindLabel(project: Project) {
  if (project.origin === "cloned") return "Cloned workspace";
  if (project.origin === "created") return "Created workspace";
  if (workspaceProject(project)) return "Linked workspace";
  return "Managed folder";
}

function formatDate(value?: string | null, includeTime = false) {
  if (!value) return "No activity yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }).format(date);
}

function relativeDate(value?: string | null) {
  if (!value) return "No messages";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  const delta = date.getTime() - Date.now();
  const units = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
  ] as const;
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(delta) >= size || unit === "minute") return formatter.format(Math.round(delta / size), unit);
  }
  return "now";
}

export function ProjectDashboard(props: {
  project: Project;
  templates: Template[];
  runtime: RuntimeStore;
  onNewChat: (project: Project) => Promise<void>;
  onOpenChat: (chat: DashboardChat, project: Project) => Promise<void>;
  onRename: () => void;
  onDelete: () => void;
  onOpenSettings: (section: string, workspaceId?: string | null) => void;
  onSaveDefault: (projectId: string, templateId: string | null) => Promise<Project>;
  onSaveAppearance: (projectId: string, appearance: WorkspaceAppearance) => Promise<Project>;
  onRefresh: () => Promise<unknown>;
  onCancelClone: (operationId: string) => Promise<void>;
  onDestroyWorkspace: (confirmation: string) => Promise<boolean>;
  onError: (message: string) => void;
}) {
  const [payload, setPayload] = createSignal<ProjectDashboardPayload | null>(null);
  const [error, setError] = createSignal("");
  const [showAll, setShowAll] = createSignal(false);
  const [savingProfile, setSavingProfile] = createSignal(false);
  const [savedDefault, setSavedDefault] = createSignal<{ projectId: string; value: string | null } | null>(null);
  const [savingAppearance, setSavingAppearance] = createSignal(false);
  const [savedAppearance, setSavedAppearance] = createSignal<{ projectId: string; value: WorkspaceAppearance | null } | null>(null);
  const [appearanceOpen, setAppearanceOpen] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [refreshVersion, setRefreshVersion] = createSignal(0);
  const [operation, setOperation] = createSignal<WorkspaceOperation | null>(null);
  const [cancellingClone, setCancellingClone] = createSignal(false);
  const [destroyOpen, setDestroyOpen] = createSignal(false);
  const [destroyConfirmation, setDestroyConfirmation] = createSignal("");
  const [destroying, setDestroying] = createSignal(false);
  const projectId = createMemo(() => props.project.id);
  const cloning = createMemo(() => props.project.state === "cloning" && Boolean(props.project.cloneOperationId));

  onMount(() => {
    const refresh = () => setRefreshVersion((version) => version + 1);
    window.addEventListener("conduit:ptys-changed", refresh);
    onCleanup(() => window.removeEventListener("conduit:ptys-changed", refresh));
  });

  createEffect(() => {
    const id = projectId();
    refreshVersion();
    if (cloning()) return;
    const controller = new AbortController();
    setPayload(null);
    setError("");
    setShowAll(false);
    setSavedDefault(null);
    setSavedAppearance(null);
    void api<ProjectDashboardPayload>(`/v0/projects/${encodeURIComponent(id)}/dashboard`, { signal: controller.signal })
      .then((next) => { if (!controller.signal.aborted) setPayload(next); })
      .catch((requestError) => {
        if (!controller.signal.aborted) setError((requestError as Error).message);
      });
    onCleanup(() => controller.abort());
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
    onCleanup(() => { disposed = true; if (timer) clearTimeout(timer); });
  });

  const activeDefault = createMemo(() => {
    const saved = savedDefault();
    if (saved?.projectId === projectId()) return saved.value;
    return payload()?.identity.defaultTemplateId ?? props.project.defaultTemplateId ?? null;
  });
  const activeAppearance = createMemo(() => {
    const saved = savedAppearance();
    if (saved?.projectId === projectId()) return saved.value;
    return payload()?.identity.workspaceAppearance ?? props.project.workspaceAppearance ?? null;
  });
  const defaultLabel = createMemo(() => {
    if (activeDefault() === "host-pi") return "Host Pi";
    if (!activeDefault()) return "Use app default";
    return props.templates.find((item) => item.id === activeDefault())?.label || activeDefault();
  });
  const recentById = createMemo(() => new Map((payload()?.recentChats || []).map((chat) => [chat.id, chat])));
  const visibleChats = createMemo<DashboardChat[]>(() => {
    if (!showAll()) return payload()?.recentChats || [];
    return [...props.project.sessions]
      .filter((chat) => chat.status === "active")
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
      .map((chat) => ({ ...chat, ...recentById().get(chat.id) }));
  });
  const liveCount = createMemo(() => {
    const current = props.project.sessions.filter((chat) => Boolean(props.runtime.getProcess(chat.id))).length;
    return props.runtime.connectivity() === "online" ? current : payload()?.stats.liveChats || 0;
  });

  const chooseDefault = async (value: string) => {
    if (savingProfile()) return;
    const next = value === "__inherit" ? null : value;
    if (next === activeDefault()) return;
    setSavingProfile(true);
    try {
      const saved = await props.onSaveDefault(props.project.id, next);
      setSavedDefault({ projectId: props.project.id, value: saved.defaultTemplateId || null });
      setPayload((current) => current ? {
        ...current,
        identity: { ...current.identity, defaultTemplateId: saved.defaultTemplateId || null },
      } : current);
    } catch (saveError) {
      props.onError((saveError as Error).message);
    } finally {
      setSavingProfile(false);
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

  const copyPath = async () => {
    const projectPath = payload()?.identity.path || props.project.path;
    if (!projectPath) return;
    try {
      await navigator.clipboard.writeText(projectPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (copyError) {
      props.onError((copyError as Error).message);
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

  return <section class="project-dashboard" aria-label={`${props.project.name} dashboard`}>
    <div class="project-dashboard-content">
      <header class="project-identity">
        <div class="project-identity-title">
          <div class="project-kind-icon"><Show when={workspaceProject(props.project)} fallback={<FolderGit2Icon />}><WorkspaceGlyph appearance={activeAppearance()} /></Show></div>
          <div>
            <div class="project-title-line">
              <h1>{props.project.name}</h1>
              <Badge variant="secondary">{kindLabel(props.project)}</Badge>
            </div>
            <button class="project-path" title="Copy working path" onClick={() => void copyPath()}>
              <code>{payload()?.identity.path || props.project.path || "Working path unavailable"}</code>
              <CopyIcon />
              <Show when={copied()}><span>Copied</span></Show>
            </button>
          </div>
        </div>
        <div class="project-identity-actions">
          <Show when={workspaceProject(props.project)}><Button class="workspace-identity-action" variant="outline" size="sm" onClick={() => setAppearanceOpen(true)}><PaletteIcon />Identity</Button></Show>
          <Button variant="outline" size="sm" onClick={props.onRename}><PencilIcon />Rename</Button>
          <Show when={cloning()} fallback={<Button size="sm" onClick={() => void props.onNewChat(props.project)}><MessageSquarePlusIcon />New chat</Button>}>
            <Button variant="destructive" size="sm" disabled={cancellingClone()} onClick={() => void cancelClone()}><XIcon />{cancellingClone() ? "Cancelling…" : "Cancel clone"}</Button>
          </Show>
        </div>
      </header>

      <Show when={cloning()}>
        <section class="clone-progress" aria-live="polite">
          <div class="clone-progress-heading"><Spinner /><div><strong>{operation()?.state === "cancelling" ? "Cancelling clone" : "Cloning Workspace"}</strong><p>Conduit owns this operation; closing this tab does not stop it.</p></div></div>
          <div class="clone-progress-path"><span>Destination</span><code>{props.project.path || props.project.externalPath}</code></div>
          <pre aria-label="Clone output preview">{operation()?.diagnostic || "Preparing clone…"}</pre>
        </section>
      </Show>

      <Show when={!cloning() && workspaceProject(props.project)}>
        <Dialog open={appearanceOpen()} onOpenChange={(open) => { if (!savingAppearance()) setAppearanceOpen(open); }}>
          <DialogContent class="workspace-appearance-dialog" title="Workspace identity" description="Choose a short mark or a Lucide icon, then choose a preset or custom color.">
            <Show when={appearanceOpen()}>
              <WorkspaceAppearanceEditor compact value={activeAppearance()} saving={savingAppearance()} onSave={(appearance) => void saveAppearance(appearance)} />
            </Show>
          </DialogContent>
        </Dialog>
      </Show>

      <Show when={error() && !cloning()}>
        <div class="project-dashboard-error" role="alert">
          <strong>Dashboard details could not be loaded</strong>
          <span>{error()}</span>
        </div>
      </Show>

      <Show when={!cloning()}><div class="project-stats" aria-label="Project summary">
        <article>
          <span>Chats</span>
          <strong>{payload()?.stats.totalChats ?? props.project.sessions.length}</strong>
          <small>{payload()
            ? `${payload()!.stats.activeChats} active · ${payload()!.stats.totalChats - payload()!.stats.activeChats} drafts`
            : "Loading registry…"}</small>
        </article>
        <article>
          <span>Live now</span>
          <strong>{liveCount()}</strong>
          <small>{liveCount() === 1 ? "running process" : "running processes"}</small>
        </article>
        <Show when={workspaceProject(props.project)}>
          <article>
            <span>Terminals</span>
            <strong>{payload()?.stats.liveTerminals ?? 0}</strong>
            <small>{(payload()?.stats.liveTerminals || 0) === 1 ? "resident PTY" : "resident PTYs"}</small>
          </article>
        </Show>
        <article>
          <span>Last activity</span>
          <strong class="project-stat-date">{relativeDate(payload()?.stats.lastActivityAt)}</strong>
          <small>{formatDate(payload()?.stats.lastActivityAt, true)}</small>
        </article>
        <Show when={workspaceProject(props.project)}>
          <article>
            <span>Repository</span>
            <strong class="project-stat-branch">{payload()?.git?.branch || (payload() ? "Not a Git repo" : "Loading…")}</strong>
            <small><Show when={payload()?.git} fallback="No repository detected">
              {payload()!.git!.ahead} ahead · {payload()!.git!.behind} behind · {payload()!.git!.changedFiles} changed
            </Show></small>
          </article>
        </Show>
      </div></Show>

      <Show when={!cloning()}><section class="project-dashboard-section">
        <div class="project-section-heading">
          <div><h2>Recent chats</h2><p>Active conversations in this {workspaceProject(props.project) ? "Workspace" : "Project"}.</p></div>
          <Show when={(payload()?.stats.activeChats || 0) > (payload()?.recentChats.length || 0)}>
            <Button variant="ghost" size="sm" onClick={() => setShowAll((value) => !value)}>
              {showAll() ? "Show recent" : "View all chats"}<ChevronDownIcon class={showAll() ? "rotate-180" : ""} />
            </Button>
          </Show>
        </div>
        <Show when={payload()} fallback={<div class="project-list-loading"><Spinner />Loading recent chats…</div>}>
          <Show when={visibleChats().length} fallback={<div class="project-empty">
            <MessageSquarePlusIcon />
            <strong>No chats yet</strong>
            <p>Start one to begin working in this {workspaceProject(props.project) ? "Workspace" : "Project"}.</p>
            <Button onClick={() => void props.onNewChat(props.project)}>Start a chat</Button>
          </div>}>
            <div class="project-chat-list">
              <For each={visibleChats()}>{(item) => {
                const process = () => props.runtime.getProcess(item.id);
                return <button class="project-chat-row" onClick={() => void props.onOpenChat(item, props.project)}>
                  <span class="project-chat-runtime"><RuntimeIndicator process={process()} stale={props.runtime.stale()} /></span>
                  <span class="project-chat-copy">
                    <strong>{item.title || (item.status === "active" ? "Untitled chat" : "New chat")}</strong>
                    <small>{item.lastMessagePreview || "Open chat to continue the conversation"}</small>
                  </span>
                  <time dateTime={item.lastMessageAt || item.updatedAt}>{relativeDate(item.lastMessageAt || item.updatedAt)}</time>
                  <ArrowRightIcon />
                </button>;
              }}</For>
            </div>
          </Show>
        </Show>
      </section></Show>

      <Show when={!cloning()}><details class="project-config" open>
        <summary><span><Settings2Icon /><strong>Environment & config</strong></span><ChevronDownIcon /></summary>
        <div class="project-config-grid">
          <div>
            <span>Default profile</span>
            <p>Used when a new chat starts in this scope.</p>
          </div>
          <Menu>
            <MenuTrigger class="project-profile-trigger" disabled={savingProfile()}>
              <span>{savingProfile() ? "Saving…" : defaultLabel()}</span><ChevronDownIcon />
            </MenuTrigger>
            <MenuContent class="w-72">
              <MenuGroup><MenuLabel>Default profile</MenuLabel>
                <MenuRadioGroup value={activeDefault() || "__inherit"} onChange={(value) => void chooseDefault(value)}>
                  <MenuRadioItem value="__inherit">Use app default</MenuRadioItem>
                  <For each={props.templates.filter((item) => item.defaultable !== false)}>
                    {(item) => <MenuRadioItem value={item.id}>{item.label}</MenuRadioItem>}
                  </For>
                  <Show when={activeDefault() === "host-pi"}><MenuRadioItem value="host-pi" disabled>Host Pi · change in Workspace settings</MenuRadioItem></Show>
                </MenuRadioGroup>
              </MenuGroup>
              <MenuSeparator />
              <MenuItem onSelect={() => props.onOpenSettings("profiles")}>Manage profiles…</MenuItem>
            </MenuContent>
          </Menu>

          <div>
            <span>Working path</span>
            <p class="project-config-path">{payload()?.identity.path || props.project.path}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void copyPath()}><CopyIcon />Copy path</Button>

          <Show when={workspaceProject(props.project)}>
            <div>
              <span>Workspace runtime</span>
              <p>{activeDefault() === "host-pi" ? "Host Pi is the current default." : "New chats use an Isolated Pi profile."}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => props.onOpenSettings("workspaces", props.project.id)}>Workspace settings</Button>
          </Show>

          <div>
            <span>Model catalogue</span>
            <p>Models remain managed centrally rather than copied into this Project.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => props.onOpenSettings("models")}>Manage models</Button>
        </div>
      </details></Show>

      <Show when={!cloning()}><details class="project-danger">
        <summary><span><Trash2Icon /><strong>Danger zone</strong></span><ChevronDownIcon /></summary>
        <div class="project-danger-row">
          <p>{props.project.deletesFilesOnRemove === false || workspaceProject(props.project)
            ? "Remove this Workspace from Conduit. Its folder and files stay on disk."
            : "Delete this Project, its working files, and all of its chats."}</p>
          <Button variant="destructive" size="sm" onClick={props.onDelete}>
            <Trash2Icon />{props.project.deletesFilesOnRemove === false || workspaceProject(props.project) ? "Unlink workspace" : "Delete project"}
          </Button>
        </div>
        <Show when={workspaceProject(props.project)}>
          <div class="project-danger-destructive">
            <div><strong>Delete Workspace and files</strong><p>Permanently erase the working directory. This cannot be undone.</p></div>
            <Button variant="destructive" size="sm" onClick={() => setDestroyOpen(true)}><Trash2Icon />Delete Workspace and files</Button>
          </div>
        </Show>
      </details></Show>

      <KAlertDialog.Root open={destroyOpen()} onOpenChange={(open) => { if (!destroying()) setDestroyOpen(open); }}>
        <KAlertDialog.Portal><KAlertDialog.Content class="conduit-modal" onEscapeKeyDown={(event) => { if (destroying()) event.preventDefault(); }}>
          <div class="conduit-modal-card workspace-destroy-dialog">
            <KAlertDialog.Title>Delete Workspace and files?</KAlertDialog.Title>
            <KAlertDialog.Description>This removes <strong>{props.project.name}</strong> from Conduit and permanently erases its working directory. Type the exact Workspace name to continue.</KAlertDialog.Description>
            <Field>
              <FieldLabel for="workspace-destroy-confirmation">Workspace name</FieldLabel>
              <Input id="workspace-destroy-confirmation" value={destroyConfirmation()} onInput={(event) => setDestroyConfirmation(event.currentTarget.value)} autocomplete="off" />
            </Field>
            <div class="conduit-modal-actions">
              <Button variant="outline" size="sm" disabled={destroying()} onClick={() => setDestroyOpen(false)}>Cancel</Button>
              <Button class="workspace-destroy-confirm" variant="destructive" size="sm" disabled={destroying() || destroyConfirmation() !== props.project.name} onClick={() => void destroyWorkspace()}><Trash2Icon />{destroying() ? "Deleting…" : "Delete Workspace and files"}</Button>
            </div>
          </div>
        </KAlertDialog.Content></KAlertDialog.Portal>
      </KAlertDialog.Root>

      <Show when={!cloning()}><footer class="project-dashboard-meta">
        <span><CalendarDaysIcon />Created {formatDate(payload()?.identity.createdAt || props.project.createdAt)}</span>
        <Show when={payload()?.git?.lastCommitAt}><span><Clock3Icon />Last commit {formatDate(payload()!.git!.lastCommitAt, true)}</span></Show>
        <Show when={payload()?.git}><span><GitBranchIcon />{payload()!.git!.upstream || "No upstream"}</span></Show>
      </footer></Show>
    </div>
  </section>;
}

export default ProjectDashboard;
