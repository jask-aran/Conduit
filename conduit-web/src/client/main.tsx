import { batch, createEffect, createMemo, createSignal, ErrorBoundary, lazy, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { PanelLeftIcon, PanelRightIcon, SearchIcon, ShareIcon, TriangleAlertIcon } from "lucide-solid";
import { Toaster, toast } from "solid-sonner";
import "solid-sonner/styles.css";
import { DefaultMeteorShower } from "@jask-aran/solid-components/meteor-shower";
import "@jask-aran/solid-components/meteor-shower.css";
import { Button, Spinner } from "@/components/primitives";
import { api, asList, pathChatId, pathProjectId, projectPath } from "./api/client";
import type { ChatSummary, DashboardChat, Installation, Project, RuntimeIdentity, Template, TranscriptDetail, WorkspaceSuggestion } from "./api/contracts";
import { Composer } from "./chat/composer";
import { HostUiRequests } from "./chat/host-ui-card";
import { Transcript } from "./chat/transcript";
import { CommandMenu } from "./navigation/command-menu";
import type { PaletteActions, PaletteContext } from "./palette/command-registry";
import { bindVisualViewportShell, isMobileLayout, MOBILE_LAYOUT_QUERY, setMobileOverlayKind } from "./navigation/mobile-layout";
import { Sidebar } from "./navigation/sidebar";
import { Settings } from "./settings/settings";
import { createActiveChat } from "./state/active-chat";
import { createAttachments } from "./state/attachments";
import { createCatalogueStore } from "./state/catalogue";
import { createModelSettings } from "./state/model-settings";
import { createRuntimeStore } from "./state/runtime";
import "./styles.css";

type SettingsSection = "general" | "models" | "profiles" | "runtime" | "workspaces" | "auth";
type WorkspaceView = "files" | "diff" | "artifacts" | "terminal";
const WorkspacePanel = lazy(() => import("./workspace/workspace-panel"));
const ProjectDashboard = lazy(() => import("./project/dashboard"));

function ChatHeader(props: {
  project?: Project;
  title: string;
  profile?: Template | null;
  runtime?: RuntimeIdentity | null;
  live?: Record<string, unknown> | null;
  panelOpen: boolean;
  mobileSidebarOpen: boolean;
  onToggleMobileSidebar: () => void;
  onOpenPalette: () => void;
  onTogglePanel: () => void;
  onShare: () => void;
  dashboard?: boolean;
}) {
  const projectLabel = () => props.project?.slug === "chat" ? "Chats" : props.project?.slug || props.project?.name || "Chats";
  const runtimeLabel = () => props.runtime?.kind === "native_pi" ? "Host Pi" : "Isolated Pi";
  const profileLabel = () => props.runtime?.kind === "native_pi" ? null : props.profile?.label || props.profile?.id;
  const posture = () => props.runtime?.kind === "native_pi"
    ? props.live?.trustPosture === "native_saved_trust" ? "project resources trusted" : "project trust pending"
    : props.profile?.posture || props.profile?.tools?.join(" / ");
  const line = () => props.dashboard ? "" : [runtimeLabel(), props.live?.binaryVersion || props.runtime?.binaryVersion ? `Pi ${props.live?.binaryVersion || props.runtime?.binaryVersion}` : null, profileLabel(), projectLabel() !== "Chats" ? projectLabel() : null, posture()].filter(Boolean).join(" · ");
  return <header class="chat-header">
    <Show when={!props.mobileSidebarOpen}>
      <Button variant="ghost" size="icon-sm" class="mobile-sidebar-trigger" data-mobile-open="false" aria-label="Toggle Sidebar" aria-expanded={false} onClick={props.onToggleMobileSidebar}><PanelLeftIcon /></Button>
    </Show>
    <nav aria-label="breadcrumb" class="chat-header-title"><span>{projectLabel()}</span><span class="breadcrumb-separator" aria-hidden="true" /><strong>{props.title}</strong></nav>
    <Show when={line()}><span class="chat-profile-posture" title={line()}>{line()}</span></Show>
    <div class="chat-header-actions">
      <Button variant="ghost" size="icon-sm" class="palette-trigger" aria-label="Open command palette" title="Command palette" onClick={props.onOpenPalette}><SearchIcon /></Button>
      <Button variant="ghost" size="icon-sm" aria-label={props.dashboard ? "Copy Tailscale workspace link" : "Copy Tailscale chat link"} title={props.dashboard ? "Copy Tailscale workspace link" : "Copy Tailscale chat link"} onClick={props.onShare}><ShareIcon /></Button>
      <Show when={!props.panelOpen}>
        <Button variant="ghost" size="icon-sm" aria-label="Toggle workspace panel" aria-expanded={false} onClick={props.onTogglePanel}><PanelRightIcon /></Button>
      </Show>
    </div>
  </header>;
}

function App() {
  const [templates, setTemplates] = createSignal<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = createSignal(true);
  const [installations, setInstallations] = createSignal<Installation[]>([]);
  const [installationsLoading, setInstallationsLoading] = createSignal(true);
  const [workspaceSuggestions, setWorkspaceSuggestions] = createSignal<WorkspaceSuggestion[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = createSignal("chat");
  const [partialContinue, setPartialContinue] = createSignal(true);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [settingsSection, setSettingsSection] = createSignal<SettingsSection>("models");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = createSignal<string | null>(null);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [palettePage, setPalettePage] = createSignal<string | null>(null);
  const [paletteNonce, setPaletteNonce] = createSignal(0);
  const [sidebarCommand, setSidebarCommand] = createSignal<{ type: string; nonce: number } | null>(null);
  const [dropActive, setDropActive] = createSignal(false);
  const [panelOpen, setPanelOpen] = createSignal(false);
  const [workspaceViewRequest, setWorkspaceViewRequest] = createSignal<{ tab: WorkspaceView; nonce: number } | null>(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);
  const initialRouteId = pathChatId();
  const initialProjectRouteId = pathProjectId();
  const [routeKind, setRouteKind] = createSignal<"chat" | "project">(initialProjectRouteId ? "project" : "chat");
  const [routeBootstrap, setRouteBootstrap] = createSignal<"loading" | "ready" | "error">(initialRouteId || initialProjectRouteId ? "loading" : "ready");
  const [routeBootstrapError, setRouteBootstrapError] = createSignal("");
  let dragDepth = 0;
  let attachFileInput: HTMLInputElement | undefined;
  let workspaceSuggestionsRequest: Promise<void> | null = null;

  const showError = (message: string) => toast.error(message);
  const catalogue = createCatalogueStore();
  const runtime = createRuntimeStore();
  const models = createModelSettings(showError);
  const attachments = createAttachments(showError);

  const saveWorkspaceDefault = async (workspaceId: string, templateId: string | null) => {
    const saved = await api<Project>(`/v0/projects/${encodeURIComponent(workspaceId)}`, { method: "PATCH", body: JSON.stringify({ defaultTemplateId: templateId }) });
    catalogue.setProjects((current) => current.map((project) => project.id === workspaceId ? { ...project, ...saved, sessions: project.sessions } : project));
    return saved;
  };

  const chat = createActiveChat({ catalogue, runtime, models, attachments, onError: showError, defaultTemplateId, saveWorkspaceDefault });
  const selectedProject = createMemo(() => catalogue.projects().find((project) => project.id === catalogue.projectId()));
  const hostInstallation = createMemo(() => installations().find((item) => item.id === "host-pi"));
  const profiles = createMemo<Template[]>(() => {
    const ordinary = templates().filter((item) => item.defaultable !== false);
    if (selectedProject()?.kind === "workspace" || ["linked", "created", "cloned"].includes(selectedProject()?.origin || "")) {
      return [...ordinary, { id: "host-pi", label: "Host Pi", description: "Use the host Pi installation and native resources", disabled: !hostInstallation()?.available }];
    }
    return ordinary;
  });
  const activeProfile = createMemo(() => chat.runtimeIdentity()?.kind === "native_pi"
    ? profiles().find((item) => item.id === "host-pi")
    : profiles().find((item) => item.id === chat.templateId()) || templates().find((item) => item.id === defaultTemplateId()) || null);
  const emptyChat = createMemo(() => chat.loadedId() === catalogue.selectedId() && !chat.messages().length && !chat.tools().length && !chat.activity()?.label);
  const workspacePanelScope = createMemo(() => catalogue.selectedId() || (routeKind() === "project" && catalogue.projectId() ? `project:${catalogue.projectId()}` : null));

  createEffect(() => {
    const id = workspacePanelScope();
    if (!id) return;
    setPanelOpen(localStorage.getItem(`conduit:workspace-panel:${id}:open`) === "true");
  });

  createEffect(() => {
    if (!isMobileLayout()) {
      setMobileOverlayKind(null);
      return;
    }
    if (panelOpen()) setMobileOverlayKind("workspace");
    else if (mobileSidebarOpen()) setMobileOverlayKind("sidebar");
    else setMobileOverlayKind(null);
  });

  const setPanelOpenForChat = (next: boolean) => {
    const id = workspacePanelScope();
    setPanelOpen(next);
    if (id) localStorage.setItem(`conduit:workspace-panel:${id}:open`, String(next));
  };

  /** Phone overlays are exclusive: opening one closes the other. */
  const setMobileSidebar = (open: boolean) => {
    if (open && panelOpen() && isMobileLayout()) setPanelOpenForChat(false);
    setMobileSidebarOpen(open);
  };

  const currentDraftId = () => chat.status() === "draft" ? catalogue.selectedId() : null;

  const discardDraft = async (id = currentDraftId()) => {
    if (id) await api(`/v0/chats/${encodeURIComponent(id)}?ifEmpty=true`, { method: "DELETE" });
  };

  const createChat = async (target?: Project, launch: { templateId?: string; runtimeKind?: string } = {}) => {
    const project = target || selectedProject() || catalogue.projects().find((item) => item.slug === "chat") || catalogue.projects()[0];
    if (!project) return;
    const replacedDraftId = currentDraftId();
    const fromDashboard = routeKind() === "project";
    try {
      const hostDefault = project.defaultTemplateId === "host-pi" && !launch.templateId && !launch.runtimeKind;
      const profileId = launch.templateId || (project.defaultTemplateId === "host-pi" ? null : project.defaultTemplateId) || defaultTemplateId() || "chat";
      const created = await api<ChatSummary>(profileId === "runtime" ? "/v0/runtime/chats" : "/v0/chats", {
        method: "POST",
        body: JSON.stringify(profileId === "runtime" ? {} : hostDefault ? { projectId: project.id } : { projectId: project.id, templateId: profileId, runtimeKind: launch.runtimeKind || "conduit_profile" }),
      });

      // Commit the visible transition only after the durable replacement exists.
      // initialize() first: it resets the previous chat's live socket, and the
      // URL must not advertise the new chat while a send could still target the old one.
      batch(() => {
        chat.initialize({ ...created, templateId: created.templateId || profileId || undefined }, project);
        if (fromDashboard) history.pushState({}, "", `/chat/${created.id}`);
        else history.replaceState({}, "", `/chat/${created.id}`);
        setRouteKind("chat");
      });
      // Show the new chat in the sidebar immediately instead of waiting for the
      // first server checkpoint refresh; drop the empty draft it replaced.
      catalogue.setProjects((current) => current.map((item) => item.id === project.id
        ? { ...item, sessions: [{ ...created, pinned: true }, ...item.sessions.filter((session) => session.id !== created.id && session.id !== replacedDraftId)] }
        : item));

      if (replacedDraftId && replacedDraftId !== created.id) {
        try { await discardDraft(replacedDraftId); }
        catch (error) {
          const detail = error as Error & { error?: string };
          if (detail.error !== "chat_not_found") showError(`The new chat was created, but the old empty draft could not be removed: ${detail.message}`);
        }
      }
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const openChat = async (target: ChatSummary, project: Project) => {
    if (target.id === catalogue.selectedId() && routeKind() === "chat") return;
    const abandonedDraftId = currentDraftId();
    try {
      await chat.select(target, project, {
        history: "push",
        onCommit: () => setRouteKind("chat"),
      });
    }
    catch (error) { showError((error as Error).message); return; }
    if (!abandonedDraftId || abandonedDraftId === target.id) return;
    try {
      await discardDraft(abandonedDraftId);
      catalogue.setProjects((current) => current.map((item) => ({ ...item, sessions: item.sessions.filter((session) => session.id !== abandonedDraftId) })));
    } catch (error) {
      const detail = error as Error & { error?: string };
      if (detail.error === "chat_not_found") {
        // Already discarded server-side: finish the local cleanup instead of
        // rolling back a successful target navigation.
        catalogue.setProjects((current) => current.map((item) => ({ ...item, sessions: item.sessions.filter((session) => session.id !== abandonedDraftId) })));
      } else showError(`Opened ${target.title || "chat"}, but the abandoned draft could not be removed: ${detail.message}`);
    }
  };

  const openProject = async (target: Project, historyMode: "push" | "replace" | "none" = "push") => {
    if (routeKind() === "project" && catalogue.projectId() === target.id) return;
    const abandonedDraftId = currentDraftId();
    chat.reset();
    catalogue.selectProject(target);
    setRouteKind("project");
    setPanelOpen(false);
    if (historyMode === "push") history.pushState({}, "", projectPath(target));
    else if (historyMode === "replace") history.replaceState({}, "", projectPath(target));
    // A history traversal may return to this draft with Forward. Keep it in
    // the catalogue and on disk until an explicit navigation abandons it.
    if (!abandonedDraftId || historyMode === "none") return;
    try {
      await discardDraft(abandonedDraftId);
      catalogue.setProjects((current) => current.map((project) => ({
        ...project,
        sessions: project.sessions.filter((session) => session.id !== abandonedDraftId),
      })));
    } catch (error) {
      const detail = error as Error & { error?: string };
      if (detail.error !== "chat_not_found") showError(`Opened ${target.name}, but the abandoned draft could not be removed: ${detail.message}`);
    }
  };

  const switchProfile = async (id: string) => {
    const selectedId = catalogue.selectedId();
    if (!selectedId || chat.status() !== "draft") return;
    const project = selectedProject();
    const host = id === "host-pi";
    const payload = await api<ChatSummary>(`/v0/chats/${encodeURIComponent(selectedId)}`, {
      method: "PATCH",
      body: JSON.stringify({ templateId: host ? chat.templateId() : id, ...((project?.kind === "workspace" || ["linked", "created", "cloned"].includes(project?.origin || "")) ? { runtimeKind: host ? "native_pi" : "conduit_profile" } : {}) }),
    });
    chat.setTemplateId(payload.templateId || (host ? chat.templateId() : id));
    chat.setRuntimeIdentity(payload.runtime || null);
    await models.reloadChat(selectedId);
  };

  const refresh = () => catalogue.refresh();
  const addProject = async (input: { mode: string; name?: string; path?: string; directoryName?: string; cloneUrl?: string; cloneParentPath?: string; cloneDirectoryName?: string }) => {
    try {
      const result = await api<Project | { project: Project; operation: { id: string; state: string } }>("/v0/projects", { method: "POST", body: JSON.stringify(input) });
      const created = "project" in result ? result.project : result;
      await refresh();
      if (["clone", "cloned"].includes(input.mode)) return true;
      if (["link", "linked", "create", "created"].includes(input.mode)) await openProject(created);
      else await createChat(created, { templateId: created.defaultTemplateId || defaultTemplateId() || "chat" });
      return true;
    } catch (error) { showError((error as Error).message); return false; }
  };
  const renameChat = async (target: ChatSummary, _project: Project, name: string) => {
    try { const saved = await api<ChatSummary>(`/v0/sessions/${target.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); if (catalogue.selectedId() === target.id) chat.setTitle(saved.title); await refresh(); return true; }
    catch (error) { showError((error as Error).message); return false; }
  };
  const renameProject = async (target: Project, name: string) => {
    try { await api(`/v0/projects/${target.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); await refresh(); return true; }
    catch (error) { showError((error as Error).message); return false; }
  };
  const moveChat = async (target: ChatSummary, _source: Project, destination: Project) => {
    try { await api(`/v0/sessions/${target.id}/move`, { method: "POST", body: JSON.stringify({ projectId: destination.id }) }); await refresh(); }
    catch (error) { showError((error as Error).message); }
  };
  const moveProjectChats = async (source: Project, destination: Project) => {
    try { await api(`/v0/projects/${source.id}/move-sessions`, { method: "POST", body: JSON.stringify({ projectId: destination.id }) }); await refresh(); }
    catch (error) { showError((error as Error).message); }
  };
  const copyTranscript = async (target: ChatSummary) => {
    try { const response = await fetch(`/v0/sessions/${target.id}/transcript`); if (!response.ok) throw new Error("Could not load the transcript"); await navigator.clipboard.writeText(await response.text()); }
    catch (error) { showError((error as Error).message); }
  };
  const deleteChat = async (target: ChatSummary, project: Project) => {
    try { await api(`/v0/sessions/${target.id}`, { method: "DELETE" }); if (catalogue.selectedId() === target.id) await createChat(project); await refresh(); }
    catch (error) { showError((error as Error).message); }
  };
  const deleteProject = async (target: Project) => {
    try { await api(`/v0/projects/${target.id}`, { method: "DELETE" }); if (catalogue.projectId() === target.id) await createChat(catalogue.projects().find((item) => item.slug === "chat")); await refresh(); }
    catch (error) { showError((error as Error).message); }
  };
  const cancelClone = async (operationId: string) => {
    await api(`/v0/workspace-operations/${encodeURIComponent(operationId)}`, { method: "DELETE" });
  };

  const openSettings = (section: string = "models", workspaceId: string | null = null) => {
    setSettingsSection(section as SettingsSection);
    setSettingsWorkspaceId(workspaceId);
    setSettingsOpen(true);
  };
  const saveDefaultTemplate = async (id: string) => {
    const saved = await api<{ defaultTemplateId: string }>("/v0/preferences", { method: "PATCH", body: JSON.stringify({ defaultTemplateId: id }) });
    setDefaultTemplateId(saved.defaultTemplateId || id);
    return saved;
  };
  const openPalette = (page: string | null = null) => { setPalettePage(page); setPaletteNonce((value) => value + 1); setPaletteOpen(true); };
  const togglePanel = () => {
    const next = !panelOpen();
    if (next && isMobileLayout()) setMobileSidebarOpen(false);
    setPanelOpenForChat(next);
  };
  const openWorkspaceView = (view: WorkspaceView) => {
    if (!workspacePanelScope()) return;
    setWorkspaceViewRequest({ tab: view, nonce: Date.now() });
    if (isMobileLayout()) setMobileSidebarOpen(false);
    setPanelOpenForChat(true);
  };
  const shareChat = async () => {
    const chatId = catalogue.selectedId();
    if (!chatId) return;
    try {
      const { origin } = await api<{ origin: string }>("/v0/share-origin");
      await navigator.clipboard.writeText(`${origin}/chat/${encodeURIComponent(chatId)}`);
      toast.success("Tailscale chat link copied");
    } catch (error) {
      showError((error as Error).message);
    }
  };
  const shareProject = async () => {
    const project = selectedProject();
    if (!project) return;
    try {
      const { origin } = await api<{ origin: string }>("/v0/share-origin");
      await navigator.clipboard.writeText(`${origin}${projectPath(project)}`);
      toast.success("Tailscale workspace link copied");
    } catch (error) { showError((error as Error).message); }
  };
  const runSidebar = (type: string) => setSidebarCommand({ type, nonce: Date.now() });
  const loadWorkspaceSuggestions = () => {
    if (workspaceSuggestionsRequest) return workspaceSuggestionsRequest;
    workspaceSuggestionsRequest = api<{ folders: WorkspaceSuggestion[] }>("/v0/workspaces/suggestions")
      .then((payload) => { setWorkspaceSuggestions(asList<WorkspaceSuggestion>(payload.folders)); })
      .catch(() => { setWorkspaceSuggestions([]); });
    return workspaceSuggestionsRequest;
  };

  const lastAssistant = createMemo(() => {
    const list = chat.messages();
    for (let index = list.length - 1; index >= 0; index -= 1) if (list[index]!.role === "assistant") return list[index]!;
    return undefined;
  });
  const lastUserEntryId = createMemo(() => {
    const list = chat.messages();
    for (let index = list.length - 1; index >= 0; index -= 1) { const message = list[index]!; if (message.role === "user" && !message.pending) return message.id; }
    return null;
  });
  const thinkingLevels = createMemo(() => models.models().find((item) => item.spec === models.model())?.thinkingLevels ?? []);

  const paletteContext = createMemo<PaletteContext>(() => ({
    chatId: catalogue.selectedId(),
    project: selectedProject(),
    projects: catalogue.projects(),
    templates: templates(),
    templateId: chat.templateId(),
    chatStatus: chat.status(),
    streaming: chat.streaming(),
    connectivity: runtime.connectivity(),
    effort: models.effort(),
    thinkingLevels: thinkingLevels(),
    canRegenerate: Boolean(lastUserEntryId()) && !chat.streaming() && !chat.stopping(),
    canContinue: partialContinue() && Boolean(lastAssistant()?.stopped) && !chat.streaming(),
    canCopy: Boolean(lastAssistant()?.content),
    commands: [],
  }));

  const paletteActions: PaletteActions = {
    logout: () => { void fetch("/v0/auth/logout", { method: "POST" }).finally(() => { location.href = "/login"; }); },
    newChat: (project, launch) => void createChat(project ?? undefined, launch ?? {}),
    newFolder: () => runSidebar("new-folder"),
    newWorkspace: () => runSidebar("new-workspace"),
    openRuntimeChat: () => void createChat(undefined, { templateId: "runtime" }),
    attach: () => attachFileInput?.click(),
    toggleSidebar: () => runSidebar("toggle-sidebar"),
    toggleWorkspacePanel: togglePanel,
    openWorkspaceView,
    copyTranscript: () => { const id = catalogue.selectedId(); if (id) void copyTranscript({ id } as ChatSummary); },
    rename: () => runSidebar("rename-chat"),
    move: () => runSidebar("move-chat"),
    renameFolder: () => runSidebar("rename-folder"),
    stop: () => chat.stop(),
    regenerate: () => { const id = lastUserEntryId(); if (id) void chat.regenerate(id); },
    continue: () => void chat.continueResponse(),
    copy: () => { const content = lastAssistant()?.content; if (content) void navigator.clipboard.writeText(content); },
    retryConnection: () => runtime.retry(),
    reload: () => location.reload(),
    delete: () => runSidebar("delete-chat"),
    deleteFolder: () => runSidebar("delete-project"),
    settings: (section) => openSettings(section),
    workspaceSettings: (id) => openSettings("workspaces", id),
    openChat: (session, project) => { setMobileSidebarOpen(false); void openChat(session, project); },
    chooseModel: (spec) => void models.chooseModel(spec),
    chooseEffort: (level) => void models.chooseEffort(level),
    setChatProfile: (id) => void switchProfile(id),
  };

  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape" && !paletteOpen() && !settingsOpen()) {
      if (panelOpen()) { event.preventDefault(); togglePanel(); return; }
      if (mobileSidebarOpen()) { event.preventDefault(); setMobileSidebarOpen(false); return; }
    }
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "k" && !event.shiftKey) { event.preventDefault(); if (paletteOpen()) setPaletteOpen(false); else openPalette(null); }
    if (key === "o" && event.shiftKey) { event.preventDefault(); openPalette("goto"); }
    if (key === "c" && event.shiftKey) { event.preventDefault(); setMobileSidebarOpen(false); void createChat(); }
    if (key === "b" && !event.shiftKey) { event.preventDefault(); runSidebar("toggle-sidebar"); }
    if (key === "." && !event.shiftKey) { event.preventDefault(); togglePanel(); }
    if (key === ",") { event.preventDefault(); openSettings("general"); }
  };

  onMount(() => {
    window.addEventListener("keydown", keydown);
    onCleanup(bindVisualViewportShell());
    const media = typeof matchMedia === "function" ? matchMedia(MOBILE_LAYOUT_QUERY) : null;
    const onViewportChange = () => {
      if (!media?.matches) {
        setMobileSidebarOpen(false);
        setMobileOverlayKind(null);
      } else if (panelOpen()) setMobileOverlayKind("workspace");
      else if (mobileSidebarOpen()) setMobileOverlayKind("sidebar");
    };
    media?.addEventListener("change", onViewportChange);
    onCleanup(() => media?.removeEventListener("change", onViewportChange));
    const onPopState = () => {
      void (async () => {
        const projectRouteId = pathProjectId();
        if (projectRouteId) {
          let project = catalogue.projects().find((item) => item.id === projectRouteId);
          if (!project) project = (await catalogue.refresh()).find((item) => item.id === projectRouteId);
          if (!project) throw new Error("Project not found");
          await openProject(project, "none");
          return;
        }
        const chatId = pathChatId();
        if (!chatId) return;
        let owner = catalogue.projects().find((project) => project.sessions.some((item) => item.id === chatId));
        if (!owner) owner = (await catalogue.refresh()).find((project) => project.sessions.some((item) => item.id === chatId));
        const target = owner?.sessions.find((item) => item.id === chatId);
        if (!owner || !target) throw new Error("Chat not found");
        await chat.select(target, owner, { history: "none", onCommit: () => setRouteKind("chat") });
      })().catch((error) => showError((error as Error).message));
    };
    window.addEventListener("popstate", onPopState);
    onCleanup(() => window.removeEventListener("popstate", onPopState));
    const templateRequest = api<{ templates: Template[]; defaultTemplateId?: string }>("/v0/templates")
      .catch(() => ({ templates: [], defaultTemplateId: "chat" }))
      .then((payload) => {
        setTemplates(asList<Template>(payload.templates));
        setDefaultTemplateId(payload.defaultTemplateId || "chat");
        setTemplatesLoading(false);
        return payload;
      });
    void api<{ partialContinue?: boolean }>("/v0/capabilities")
      .then((payload) => setPartialContinue(payload.partialContinue !== false))
      .catch(() => setPartialContinue(true));
    void api<{ installations: Installation[] }>("/v0/pi-installations")
      .then((payload) => setInstallations(asList<Installation>(payload.installations)))
      .catch(() => setInstallations([]))
      .finally(() => setInstallationsLoading(false));

    const routeId = initialRouteId;
    const catalogueRequest = api<{ projects: Project[] }>("/v0/projects");
    const selectedChatRequest = routeId ? Promise.all([
      api<ChatSummary>(`/v0/chats/${encodeURIComponent(routeId)}`),
      api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(routeId)}`),
    ]) : null;
    void (async () => {
      const [cataloguePayload, selectedChat] = await Promise.all([
        catalogueRequest,
        selectedChatRequest || Promise.resolve(null),
      ]);
      const projects = asList<Project>(cataloguePayload.projects).map((project) => ({ ...project, sessions: asList<ChatSummary>(project.sessions) }));
      catalogue.setProjects(projects);
      if (selectedChat) {
        const [target, detail] = selectedChat;
        const project = projects.find((item) => item.id === target.projectId) || projects[0];
        if (!project) throw new Error("Conduit has no chat project");
        chat.initialize(target, project, detail);
        setRouteKind("chat");
        setRouteBootstrap("ready");
        if (target.status === "active") await chat.openLive(target.id, project.id);
      } else if (initialProjectRouteId) {
        const project = projects.find((item) => item.id === initialProjectRouteId);
        if (!project) throw new Error("Project not found");
        catalogue.selectProject(project);
        setRouteKind("project");
        setRouteBootstrap("ready");
      } else {
        const templatePayload = await templateRequest;
        const project = projects.find((item) => item.slug === "chat") || projects[0];
        if (!project) throw new Error("Conduit has no chat project");
        const created = await api<ChatSummary>("/v0/chats", { method: "POST", body: JSON.stringify({ projectId: project.id, templateId: templatePayload.defaultTemplateId || "chat" }) });
        history.replaceState({}, "", `/chat/${created.id}`);
        chat.initialize(created, project);
        setRouteKind("chat");
      }
    })().catch((error) => {
      const message = (error as Error).message;
      if (initialRouteId || initialProjectRouteId) {
        setRouteBootstrapError(message);
        setRouteBootstrap("error");
      }
      showError(message);
    });
  });
  onCleanup(() => window.removeEventListener("keydown", keydown));

  const dropHandlers = {
    onDragEnter: (event: DragEvent) => { if (!event.dataTransfer?.types.includes("Files")) return; event.preventDefault(); dragDepth += 1; setDropActive(true); },
    onDragOver: (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); },
    onDragLeave: (event: DragEvent) => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) setDropActive(false); },
    onDrop: (event: DragEvent) => { event.preventDefault(); dragDepth = 0; setDropActive(false); if (event.dataTransfer?.files) attachments.addFiles(event.dataTransfer.files); },
  };

  return <>
    <Toaster richColors />
    <input ref={attachFileInput} type="file" multiple hidden aria-hidden="true" onChange={(event) => { if (event.currentTarget.files) attachments.addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <Sidebar projects={catalogue.projects()} projectId={catalogue.projectId()} selectedId={catalogue.selectedId()} runtime={runtime}
      connectivity={runtime.connectivity()} workspaceSuggestions={workspaceSuggestions()} command={sidebarCommand()}
      mobileOpen={mobileSidebarOpen()} onMobileOpenChange={setMobileSidebar}
      onWorkspaceSuggestionsNeeded={() => void loadWorkspaceSuggestions()}
      onNewChat={createChat} onOpenChat={openChat} onOpenProject={openProject} onAddProject={addProject} onRenameChat={renameChat} onRenameProject={renameProject}
      onMoveChat={moveChat} onMoveProjectChats={moveProjectChats} onCopyTranscript={copyTranscript} onDeleteChat={deleteChat} onDeleteProject={deleteProject}
      onOpenTerminal={(target, project) => { void openChat(target, project).then(() => openWorkspaceView("terminal")); }}
      onOpenSettings={openSettings} onOpenPalette={() => openPalette(null)} />
    <main data-slot="sidebar-inset" class={`chat-main${routeKind() === "chat" && emptyChat() ? " chat-main-empty" : ""}`} {...(routeKind() === "chat" ? dropHandlers : {})}>
      <Show when={routeBootstrap() === "ready"} fallback={<div class="chat-bootstrap" role={routeBootstrap() === "error" ? "alert" : "status"}>{routeBootstrap() === "error"
        ? routeBootstrapError() || (routeKind() === "project" ? "This project could not be loaded." : "This chat could not be loaded.")
        : routeKind() === "project" ? "Loading project…" : "Loading chat…"}</div>}>
        <Show when={routeKind() === "chat"}>
          <div class="chat-meteors" aria-hidden="true">
            <DefaultMeteorShower />
          </div>
        </Show>
        <Show when={routeKind() === "project" && selectedProject()} fallback={<>
          <Show when={dropActive()}><div class="chat-drop-overlay"><div>Drop files to attach</div></div></Show>
          <ChatHeader project={selectedProject()} title={chat.title()} profile={activeProfile()} runtime={chat.runtimeIdentity()} live={chat.live() as unknown as Record<string, unknown>} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onOpenPalette={() => openPalette(null)} onTogglePanel={togglePanel} onShare={() => void shareChat()} />
          <Show when={selectedProject()?.kind === "workspace" && [...runtime.processes().values()].some((process) => process.chatId !== catalogue.selectedId() && process.active)}><div class="workspace-warning"><TriangleAlertIcon /><div><strong>Another chat is working in this Workspace</strong><p>Both agents can edit the same files. Conduit does not lock the Workspace or create worktrees automatically.</p></div></div></Show>
          <div class="work-area">
            <section class="work-area-conversation" aria-label="Conversation">
              <Transcript chat={chat} partialContinue={partialContinue()} />
              <div class="composer-stack"><HostUiRequests requests={chat.hostUiRequests()} onRespond={chat.respondHostUi} />
                <Composer chat={chat} attachments={attachments} models={models} profiles={profiles()} activeProfile={activeProfile()} serverOnline={runtime.connectivity() === "online"} onChooseProfile={(id) => void switchProfile(id)} onOpenSettings={openSettings} onOpenAttachments={() => attachFileInput?.click()} /></div>
            </section>
          </div>
        </>}>
          <ChatHeader project={selectedProject()} title="Dashboard" panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onOpenPalette={() => openPalette(null)} onTogglePanel={togglePanel} onShare={() => void shareProject()} dashboard />
          <ProjectDashboard project={selectedProject()!} templates={templates()} runtime={runtime}
            onNewChat={createChat} onOpenChat={(target: DashboardChat, project) => openChat(target, project)}
            onRename={() => runSidebar("rename-folder")} onDelete={() => runSidebar("delete-project")}
            onOpenSettings={openSettings} onSaveDefault={saveWorkspaceDefault} onRefresh={refresh} onCancelClone={cancelClone} onError={showError} />
        </Show>
      </Show>
    </main>
    <Show when={Boolean(selectedProject()) && Boolean(workspacePanelScope())}><WorkspacePanel projectId={() => selectedProject()!.id} chatId={() => workspacePanelScope()!} open={panelOpen} requestedTab={workspaceViewRequest} onClose={togglePanel} /></Show>
    <CommandMenu open={paletteOpen()} onOpenChange={setPaletteOpen} initialPage={palettePage()} launchNonce={paletteNonce()}
      context={paletteContext()} actions={paletteActions} models={models.models()} currentModel={models.model()} onChooseModel={(spec) => void models.chooseModel(spec)} />
    <Settings open={settingsOpen()} initialSection={settingsSection()} initialWorkspaceId={settingsWorkspaceId()} onOpenChange={setSettingsOpen} models={models} templates={templates()} templatesLoading={templatesLoading()} defaultTemplateId={defaultTemplateId()} projects={catalogue.projects()} installations={installations()} installationsLoading={installationsLoading()} onInstallationsChange={setInstallations} onDefaultTemplateChange={saveDefaultTemplate} onWorkspaceDefaultChange={saveWorkspaceDefault} />
  </>;
}

render(() => <ErrorBoundary fallback={(error) => <div class="crash-screen"><div class="crash-card"><h1>Conduit hit a UI error</h1><p>{error instanceof Error ? error.message : "Unknown interface error"}</p><Button onClick={() => location.reload()}>Reload Conduit</Button></div></div>}><App /></ErrorBoundary>, document.getElementById("root")!);
