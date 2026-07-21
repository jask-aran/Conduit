import { createMemo, createSignal, ErrorBoundary, For, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import { ShareIcon, TriangleAlertIcon } from "lucide-solid";
import { Toaster, toast } from "solid-sonner";
import "solid-sonner/styles.css";
import { Button } from "@/components/primitives";
import { api, asList, pathChatId } from "./api/client";
import type { ChatSummary, Installation, Project, RuntimeIdentity, Template, TranscriptDetail } from "./api/contracts";
import { Composer } from "./chat/composer";
import { HostUiRequests } from "./chat/host-ui-card";
import { Transcript } from "./chat/transcript";
import { CommandMenu } from "./navigation/command-menu";
import { Sidebar } from "./navigation/sidebar";
import { Settings } from "./settings/settings";
import { createActiveChat } from "./state/active-chat";
import { createAttachments } from "./state/attachments";
import { createCatalogueStore } from "./state/catalogue";
import { createModelSettings } from "./state/model-settings";
import { createRuntimeStore } from "./state/runtime";
import "./styles.css";

type SettingsSection = "general" | "models" | "profiles" | "runtime" | "workspaces" | "auth";

function ChatHeader(props: { project?: Project; title: string; profile?: Template | null; runtime?: RuntimeIdentity | null; live?: Record<string, unknown> | null }) {
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
    <Button variant="ghost" size="icon-sm" class={!line() ? "ml-auto" : ""} aria-label="Share chat"><ShareIcon /></Button>
  </header>;
}

function App() {
  const [templates, setTemplates] = createSignal<Template[]>([]);
  const [installations, setInstallations] = createSignal<Installation[]>([]);
  const [workspaceSuggestions, setWorkspaceSuggestions] = createSignal<string[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = createSignal("chat");
  const [partialContinue, setPartialContinue] = createSignal(true);
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [settingsSection, setSettingsSection] = createSignal<SettingsSection>("models");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = createSignal<string | null>(null);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [sidebarCommand, setSidebarCommand] = createSignal<{ type: string; nonce: number } | null>(null);
  const [dropActive, setDropActive] = createSignal(false);
  let dragDepth = 0;

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
      history.replaceState({}, "", `/chat/${created.id}`);
      chat.initialize({ ...created, templateId: created.templateId || profileId || undefined }, project);

      if (replacedDraftId && replacedDraftId !== created.id) {
        try { await discardDraft(replacedDraftId); }
        catch (error) { showError(`The new chat was created, but the old empty draft could not be removed: ${(error as Error).message}`); }
      }
    } catch (error) {
      showError((error as Error).message);
    }
  };

  const openChat = async (target: ChatSummary, project: Project) => {
    try { await discardDraft(); await chat.select(target, project); }
    catch (error) { showError((error as Error).message); }
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
  const addProject = async (input: { mode: string; name?: string; path?: string; cloneUrl?: string }) => {
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
  const openPaletteChat = (chatId: string) => {
    for (const project of catalogue.projects()) {
      const target = project.sessions.find((item) => item.id === chatId);
      if (target) { void openChat(target, project); return; }
    }
  };

  const keydown = (event: KeyboardEvent) => {
    if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "k" && !event.shiftKey) { event.preventDefault(); setPaletteOpen((value) => !value); }
    if (key === "o" && event.shiftKey) { event.preventDefault(); setPaletteOpen(true); }
    if (key === "c" && event.shiftKey) { event.preventDefault(); void createChat(); }
    if (key === ",") { event.preventDefault(); openSettings("general"); }
  };

  onMount(() => {
    window.addEventListener("keydown", keydown);
    void Promise.all([
      api<{ projects: Project[] }>("/v0/projects"),
      api<{ partialContinue?: boolean }>("/v0/capabilities").catch(() => ({ partialContinue: true })),
      api<{ templates: Template[]; defaultTemplateId?: string }>("/v0/templates").catch(() => ({ templates: [], defaultTemplateId: "chat" })),
      api<{ folders: string[] }>("/v0/workspaces/suggestions").catch(() => ({ folders: [] })),
      api<{ installations: Installation[] }>("/v0/pi-installations").catch(() => ({ installations: [] })),
    ]).then(async ([cataloguePayload, capabilities, templatePayload, workspacePayload, installationPayload]) => {
      const projects = asList<Project>(cataloguePayload.projects).map((project) => ({ ...project, sessions: asList<ChatSummary>(project.sessions) }));
      catalogue.setProjects(projects);
      setPartialContinue(capabilities.partialContinue !== false);
      setTemplates(asList<Template>(templatePayload.templates));
      setWorkspaceSuggestions(asList<string>(workspacePayload.folders));
      setInstallations(asList<Installation>(installationPayload.installations));
      setDefaultTemplateId(templatePayload.defaultTemplateId || "chat");
      const routeId = pathChatId();
      if (routeId) {
        const target = await api<ChatSummary>(`/v0/chats/${encodeURIComponent(routeId)}`);
        const project = projects.find((item) => item.id === target.projectId) || projects[0];
        if (!project) throw new Error("Conduit has no chat project");
        const detail = await api<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(target.id)}`);
        chat.initialize(target, project, detail);
        if (target.status === "active") await chat.openLive(target.id, project.id);
      } else {
        const project = projects.find((item) => item.slug === "chat") || projects[0];
        if (!project) throw new Error("Conduit has no chat project");
        const created = await api<ChatSummary>("/v0/chats", { method: "POST", body: JSON.stringify({ projectId: project.id, templateId: templatePayload.defaultTemplateId || "chat" }) });
        history.replaceState({}, "", `/chat/${created.id}`);
        chat.initialize(created, project);
      }
    }).catch((error) => showError((error as Error).message));
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
    <Sidebar projects={catalogue.projects()} projectId={catalogue.projectId()} selectedId={catalogue.selectedId()} runtime={runtime}
      connectivity={runtime.connectivity()} workspaceSuggestions={workspaceSuggestions()} command={sidebarCommand()}
      onNewChat={createChat} onOpenChat={openChat} onAddProject={addProject} onRenameChat={renameChat} onRenameProject={renameProject}
      onMoveChat={moveChat} onMoveProjectChats={moveProjectChats} onCopyTranscript={copyTranscript} onDeleteChat={deleteChat} onDeleteProject={deleteProject}
      onOpenSettings={openSettings} onOpenPalette={() => setPaletteOpen(true)} />
    <main data-slot="sidebar-inset" class={`chat-main${emptyChat() ? " chat-main-empty" : ""}`} {...dropHandlers}>
      <Show when={dropActive()}><div class="chat-drop-overlay"><div>Drop files to attach</div></div></Show>
      <div class="chat-meteors" aria-hidden="true"><For each={Array.from({ length: 30 })}>{(_, index) => <span style={{ left: `calc(${(index() * 37) % 101}% + ${(index() % 5) * 0.1}dvh)`, "animation-delay": `-${(index() * 0.73).toFixed(2)}s`, "animation-duration": `${12 + (index() % 9)}s` }} />}</For></div>
      <ChatHeader project={selectedProject()} title={chat.title()} profile={activeProfile()} runtime={chat.runtimeIdentity()} live={chat.live() as unknown as Record<string, unknown>} />
      <Show when={selectedProject()?.kind === "workspace" && [...runtime.processes().values()].some((process) => process.chatId !== catalogue.selectedId() && process.active)}><div class="workspace-warning"><TriangleAlertIcon /><div><strong>Another chat is working in this Workspace</strong><p>Both agents can edit the same files. Conduit does not lock the Workspace or create worktrees automatically.</p></div></div></Show>
      <Transcript chat={chat} partialContinue={partialContinue()} />
      <div class="composer-stack"><HostUiRequests requests={chat.hostUiRequests()} onRespond={chat.respondHostUi} />
        <Composer chat={chat} attachments={attachments} models={models} profiles={profiles()} activeProfile={activeProfile()} serverOnline={runtime.connectivity() === "online"} onChooseProfile={(id) => void switchProfile(id)} onOpenSettings={openSettings} /></div>
    </main>
    <CommandMenu open={paletteOpen()} onOpenChange={setPaletteOpen} projects={catalogue.projects()} models={models.models()} onSettings={openSettings}
      onNewChat={() => void createChat()} onNewFolder={() => setSidebarCommand({ type: "new-folder", nonce: Date.now() })} onNewWorkspace={() => setSidebarCommand({ type: "new-workspace", nonce: Date.now() })}
      onOpenChat={openPaletteChat} onChooseModel={(spec) => void models.chooseModel(spec)} onDeleteChat={() => setSidebarCommand({ type: "delete-chat", nonce: Date.now() })} />
    <Settings open={settingsOpen()} initialSection={settingsSection()} initialWorkspaceId={settingsWorkspaceId()} onOpenChange={setSettingsOpen} models={models} templates={templates()} defaultTemplateId={defaultTemplateId()} projects={catalogue.projects()} installations={installations()} onInstallationsChange={setInstallations} onDefaultTemplateChange={saveDefaultTemplate} onWorkspaceDefaultChange={saveWorkspaceDefault} />
  </>;
}

render(() => <ErrorBoundary fallback={(error) => <div class="crash-screen"><div class="crash-card"><h1>Conduit hit a UI error</h1><p>{error instanceof Error ? error.message : "Unknown interface error"}</p><Button onClick={() => location.reload()}>Reload Conduit</Button></div></div>}><App /></ErrorBoundary>, document.getElementById("root")!);
