import { createEffect, createMemo, createSignal, ErrorBoundary, lazy, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { PanelRightIcon, ShareIcon, TriangleAlertIcon } from "lucide-solid";
import { Toaster, toast } from "solid-sonner";
import "solid-sonner/styles.css";
import { Button, Spinner } from "@/components/primitives";
import { api, asList, pathChatId } from "./api/client";
import type { ChatSummary, Installation, Project, RuntimeIdentity, Template, TranscriptDetail, WorkspaceSuggestion } from "./api/contracts";
import { Composer } from "./chat/composer";
import { HostUiRequests } from "./chat/host-ui-card";
import { Transcript } from "./chat/transcript";
import { CommandMenu } from "./navigation/command-menu";
import type { PaletteActions, PaletteContext } from "./palette/command-registry";
import { Sidebar } from "./navigation/sidebar";
import { Settings } from "./settings/settings";
import { createActiveChat } from "./state/active-chat";
import { createAttachments } from "./state/attachments";
import { createCatalogueStore } from "./state/catalogue";
import { createModelSettings } from "./state/model-settings";
import { createRuntimeStore } from "./state/runtime";
import "./styles.css";

type SettingsSection = "general" | "models" | "profiles" | "runtime" | "workspaces" | "auth";
const WorkspacePanel = lazy(() => import("./workspace/workspace-panel"));

function ChatHeader(props: { project?: Project; title: string; profile?: Template | null; runtime?: RuntimeIdentity | null; live?: Record<string, unknown> | null; panelOpen: boolean; onTogglePanel: () => void; onShare: () => void }) {
  const projectLabel = () => props.project?.slug === "chat" ? "Chats" : props.project?.slug || props.project?.name || "Chats";
  const runtimeLabel = () => props.runtime?.kind === "native_pi" ? "Host Pi" : "Isolated Pi";
  const profileLabel = () => props.runtime?.kind === "native_pi" ? null : props.profile?.label || props.profile?.id;
  const posture = () => props.runtime?.kind === "native_pi"
    ? props.live?.trustPosture === "native_saved_trust" ? "project resources trusted" : "project trust pending"
    : props.profile?.posture || props.profile?.tools?.join(" / ");
  const line = () => [runtimeLabel(), props.live?.binaryVersion || props.runtime?.binaryVersion ? `Pi ${props.live?.binaryVersion || props.runtime?.binaryVersion}` : null, profileLabel(), projectLabel() !== "Chats" ? projectLabel() : null, posture()].filter(Boolean).join(" · ");
  return <header class="chat-header">
    <nav aria-label="breadcrumb" class="chat-header-title"><span>{projectLabel()}</span><span class="breadcrumb-separator" aria-hidden="true" /><strong>{props.title}</strong></nav>
    <Show when={line()}><span class="chat-profile-posture" title={line()}>{line()}</span></Show>
    <Button variant="ghost" size="icon-sm" aria-label="Copy Tailscale chat link" title="Copy Tailscale chat link" onClick={props.onShare}><ShareIcon /></Button>
    <Button variant="ghost" size="icon-sm" class={!line() ? "ml-auto" : ""} aria-label="Toggle workspace panel" aria-expanded={props.panelOpen} onClick={props.onTogglePanel}><PanelRightIcon /></Button>
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
  const initialRouteId = pathChatId();
  const [routeBootstrap, setRouteBootstrap] = createSignal<"loading" | "ready" | "error">(initialRouteId ? "loading" : "ready");
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
    if (selectedProject()?.kind === "workspace" || ["linked", "cloned"].includes(selectedProject()?.origin || "")) {
      return [...ordinary, { id: "host-pi", label: "Host Pi", description: "Use the host Pi installation and native resources", disabled: !hostInstallation()?.available }];
    }
    return ordinary;
  });
  const activeProfile = createMemo(() => chat.runtimeIdentity()?.kind === "native_pi"
    ? profiles().find((item) => item.id === "host-pi")
    : profiles().find((item) => item.id === chat.templateId()) || templates().find((item) => item.id === defaultTemplateId()) || null);
  const emptyChat = createMemo(() => chat.loadedId() === catalogue.selectedId() && !chat.messages().length && !chat.tools().length && !chat.activity()?.label);

  createEffect(() => {
    const id = catalogue.selectedId();
    if (id) setPanelOpen(localStorage.getItem(`conduit:workspace-panel:${id}:open`) === "true");
  });

  const currentDraftId = () => chat.status() === "draft" ? catalogue.selectedId() : null;

  const discardDraft = async (id = currentDraftId()) => {
    if (id) await api(`/v0/chats/${encodeURIComponent(id)}?ifEmpty=true`, { method: "DELETE" });
  };

  const createChat = async (target?: Project, launch: { templateId?: string; runtimeKind?: string } = {}) => {
    const project = target || selectedProject() || catalogue.projects().find((item) => item.slug === "chat") || catalogue.projects()[0];
    if (!project) return;
    const replacedDraftId = currentDraftId();
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
      chat.initialize({ ...created, templateId: created.templateId || profileId || undefined }, project);
      history.replaceState({}, "", `/chat/${created.id}`);
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
    if (target.id === catalogue.selectedId()) return;
    const abandonedDraftId = currentDraftId();
    try { await chat.select(target, project); }
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

  const switchProfile = async (id: string) => {
    const selectedId = catalogue.selectedId();
    if (!selectedId || chat.status() !== "draft") return;
    const project = selectedProject();
    const host = id === "host-pi";
    const payload = await api<ChatSummary>(`/v0/chats/${encodeURIComponent(selectedId)}`, {
      method: "PATCH",
      body: JSON.stringify({ templateId: host ? chat.templateId() : id, ...((project?.kind === "workspace" || ["linked", "cloned"].includes(project?.origin || "")) ? { runtimeKind: host ? "native_pi" : "conduit_profile" } : {}) }),
    });
    chat.setTemplateId(payload.templateId || (host ? chat.templateId() : id));
    chat.setRuntimeIdentity(payload.runtime || null);
    await models.reloadChat(selectedId);
  };

  const refresh = () => catalogue.refresh();
  const addProject = async (input: { mode: string; name?: string; path?: string; cloneUrl?: string; cloneParentPath?: string; cloneDirectoryName?: string }) => {
    try {
      const created = await api<Project>("/v0/projects", { method: "POST", body: JSON.stringify(input) });
      await refresh();
      await createChat(created, { templateId: created.defaultTemplateId || defaultTemplateId() || "chat" });
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
    const id = catalogue.selectedId();
    setPanelOpen((open) => { const next = !open; if (id) localStorage.setItem(`conduit:workspace-panel:${id}:open`, String(next)); return next; });
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
    openChat: (session, project) => void openChat(session, project),
    chooseModel: (spec) => void models.chooseModel(spec),
    chooseEffort: (level) => void models.chooseEffort(level),
    setChatProfile: (id) => void switchProfile(id),
  };

  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return;
    if (event.key === "Escape" && panelOpen() && !paletteOpen() && !settingsOpen()) { event.preventDefault(); togglePanel(); return; }
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "k" && !event.shiftKey) { event.preventDefault(); if (paletteOpen()) setPaletteOpen(false); else openPalette(null); }
    if (key === "o" && event.shiftKey) { event.preventDefault(); openPalette("goto"); }
    if (key === "c" && event.shiftKey) { event.preventDefault(); void createChat(); }
    if (key === "b" && !event.shiftKey) { event.preventDefault(); runSidebar("toggle-sidebar"); }
    if (key === "." && !event.shiftKey) { event.preventDefault(); togglePanel(); }
    if (key === ",") { event.preventDefault(); openSettings("general"); }
  };

  onMount(() => {
    window.addEventListener("keydown", keydown);
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
        setRouteBootstrap("ready");
        if (target.status === "active") await chat.openLive(target.id, project.id);
      } else {
        const templatePayload = await templateRequest;
        const project = projects.find((item) => item.slug === "chat") || projects[0];
        if (!project) throw new Error("Conduit has no chat project");
        const created = await api<ChatSummary>("/v0/chats", { method: "POST", body: JSON.stringify({ projectId: project.id, templateId: templatePayload.defaultTemplateId || "chat" }) });
        history.replaceState({}, "", `/chat/${created.id}`);
        chat.initialize(created, project);
      }
    })().catch((error) => {
      const message = (error as Error).message;
      if (initialRouteId) {
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
      onWorkspaceSuggestionsNeeded={() => void loadWorkspaceSuggestions()}
      onNewChat={createChat} onOpenChat={openChat} onAddProject={addProject} onRenameChat={renameChat} onRenameProject={renameProject}
      onMoveChat={moveChat} onMoveProjectChats={moveProjectChats} onCopyTranscript={copyTranscript} onDeleteChat={deleteChat} onDeleteProject={deleteProject}
      onOpenSettings={openSettings} onOpenPalette={() => setPaletteOpen(true)} />
    <main data-slot="sidebar-inset" class={`chat-main${emptyChat() ? " chat-main-empty" : ""}`} {...dropHandlers}>
      <Show when={routeBootstrap() === "ready"} fallback={<div class="chat-bootstrap" role={routeBootstrap() === "error" ? "alert" : "status"}>{routeBootstrap() === "error" ? routeBootstrapError() || "This chat could not be loaded." : "Loading chat…"}</div>}>
        <Show when={dropActive()}><div class="chat-drop-overlay"><div>Drop files to attach</div></div></Show>
        <div class="chat-ambient" aria-hidden="true" />
        <ChatHeader project={selectedProject()} title={chat.title()} profile={activeProfile()} runtime={chat.runtimeIdentity()} live={chat.live() as unknown as Record<string, unknown>} panelOpen={panelOpen()} onTogglePanel={togglePanel} onShare={() => void shareChat()} />
        <Show when={selectedProject()?.kind === "workspace" && [...runtime.processes().values()].some((process) => process.chatId !== catalogue.selectedId() && process.active)}><div class="workspace-warning"><TriangleAlertIcon /><div><strong>Another chat is working in this Workspace</strong><p>Both agents can edit the same files. Conduit does not lock the Workspace or create worktrees automatically.</p></div></div></Show>
        <Transcript chat={chat} partialContinue={partialContinue()} />
        <div class="composer-stack"><HostUiRequests requests={chat.hostUiRequests()} onRespond={chat.respondHostUi} />
          <Composer chat={chat} attachments={attachments} models={models} profiles={profiles()} activeProfile={activeProfile()} serverOnline={runtime.connectivity() === "online"} onChooseProfile={(id) => void switchProfile(id)} onOpenSettings={openSettings} onOpenAttachments={() => attachFileInput?.click()} /></div>
      </Show>
    </main>
    <Show when={Boolean(selectedProject()) && Boolean(catalogue.selectedId())}><WorkspacePanel projectId={() => selectedProject()!.id} chatId={() => catalogue.selectedId()!} open={panelOpen} onClose={togglePanel} /></Show>
    <CommandMenu open={paletteOpen()} onOpenChange={setPaletteOpen} initialPage={palettePage()} launchNonce={paletteNonce()}
      context={paletteContext()} actions={paletteActions} models={models.models()} currentModel={models.model()} onChooseModel={(spec) => void models.chooseModel(spec)} />
    <Settings open={settingsOpen()} initialSection={settingsSection()} initialWorkspaceId={settingsWorkspaceId()} onOpenChange={setSettingsOpen} models={models} templates={templates()} templatesLoading={templatesLoading()} defaultTemplateId={defaultTemplateId()} projects={catalogue.projects()} installations={installations()} installationsLoading={installationsLoading()} onInstallationsChange={setInstallations} onDefaultTemplateChange={saveDefaultTemplate} onWorkspaceDefaultChange={saveWorkspaceDefault} />
  </>;
}

render(() => <ErrorBoundary fallback={(error) => <div class="crash-screen"><div class="crash-card"><h1>Conduit hit a UI error</h1><p>{error instanceof Error ? error.message : "Unknown interface error"}</p><Button onClick={() => location.reload()}>Reload Conduit</Button></div></div>}><App /></ErrorBoundary>, document.getElementById("root")!);
