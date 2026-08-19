/// <reference types="vite-plugin-pwa/client" />
import { batch, createEffect, createMemo, createSignal, ErrorBoundary, lazy, onCleanup, onMount, Show } from "solid-js";
import { render } from "solid-js/web";
import {
  EllipsisIcon, PanelLeftIcon, PanelRightIcon, PencilIcon, RefreshCwIcon, SearchIcon, ShareIcon, TerminalIcon, Trash2Icon, TriangleAlertIcon,
} from "lucide-solid";
import { registerSW } from "virtual:pwa-register";
import { Toaster, toast } from "solid-sonner";
import "solid-sonner/styles.css";
import { DefaultMeteorShower } from "@jask-aran/solid-components/meteor-shower";
import "@jask-aran/solid-components/meteor-shower.css";
import { Button, Dialog, DialogContent, Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Spinner } from "@/components/primitives";
import { api, asList, pathChatId, pathProjectId, projectPath } from "./api/client";
import type { ChatSummary, DashboardChat, Installation, Project, RuntimeIdentity, Template, TranscriptDetail, WorkspaceAppearance, WorkspacePolicy, WorkspaceSuggestion, WorkspaceSuggestionsPayload } from "./api/contracts";
import { createErrorDiagnostic, formatRuntimeDiagnosticPrompt, type ErrorDiagnostic, type ErrorDiagnosticContext } from "./error-diagnostics";
import { Composer, SPINNING_ACTIVITY, type ComposerStatus } from "./chat/composer";
import { selectedComposerSurface, saveComposerSurface, type ComposerSurfaceMode } from "./chat/composer-surface";
import { formatContextMetrics, saveContextMetrics, selectedContextMetrics, type ContextMetricId } from "./chat/context-metrics";
import { HostUiRequests } from "./chat/host-ui-card";
import { MARKDOWN_RENDERER_STORAGE_KEY, selectedMarkdownRenderer, type MarkdownRendererId } from "./chat/markdown-settings";
import { loadVoiceDictationSettings, saveVoiceDictationSettings } from "./chat/voice-dictation";
import { Transcript } from "./chat/transcript";
import { COMMAND_IDS, commandRegistry } from "./commands/command-registry";
import { CommandMenu } from "./navigation/command-menu";
import type { PaletteActions, PaletteContext } from "./palette/command-registry";
import { bindVisualViewportShell, isMobileLayout, MOBILE_LAYOUT_QUERY, setMobileOverlayKind } from "./navigation/mobile-layout";
import { Sidebar } from "./navigation/sidebar";
import { clampSidebarChatLimit, selectedSidebarChatLimit, SIDEBAR_CHAT_LIMIT_STORAGE_KEY } from "./navigation/sidebar-preferences";
import { WorkspaceAppearanceEditor } from "./project/workspace-appearance-editor";
import { Settings } from "./settings/settings";
import { createActiveChat, type ActiveChatStore } from "./state/active-chat";
import { createAttachments, DEFAULT_MAX_ATTACHMENT_BYTES, filesFromDataTransfer } from "./state/attachments";
import { createCatalogueStore } from "./state/catalogue";
import { createModelSettings } from "./state/model-settings";
import { createRuntimeStore } from "./state/runtime";
import { VoiceWaveform } from "./chat/voice-waveform";
import { preloadVoiceCaptureWorklet } from "./chat/voice-dictation-client";
import { forcePwaUpdate, rememberPwaRegistration } from "./pwa-update";
import { browserShortcutEnvironmentProvider } from "./shortcuts/shortcut-environment";
import { ShortcutManager } from "./shortcuts/shortcut-manager";
import "./project/dashboard.css";
import "./chat/composer-geometry.css";
import "./styles.css";

if (import.meta.env.PROD) registerSW({ immediate: true, onRegisteredSW: (_url, registration) => rememberPwaRegistration(registration) });

type SettingsSection = "general" | "ui" | "shortcuts" | "models" | "profiles" | "runtime" | "workspaces" | "voice" | "search" | "auth";
type WorkspaceView = "files" | "diff" | "artifacts" | "terminal";
type VoiceDictationSettings = { shortcut: string; activation: "push_to_talk" | "toggle"; autoSend: boolean; inputDeviceId: string; captureProfile: "raw" | "processed"; warmMicrophone: boolean };
const METEOR_FIELD_STORAGE_KEY = "conduit:meteor-field";
const selectedMeteorField = () => localStorage.getItem(METEOR_FIELD_STORAGE_KEY) !== "false";
const WorkspacePanel = lazy(() => import("./workspace/workspace-panel"));
const ProjectDashboard = lazy(() => import("./project/dashboard"));

function ChatHeader(props: {
  project?: Project;
  title: string;
  profile?: Template | null;
  runtime?: RuntimeIdentity | null;
  live?: Record<string, unknown> | null;
  chat?: ActiveChatStore;
  contextMetrics?: () => readonly ContextMetricId[];
  composerStatus?: ComposerStatus | null;
  connectivity?: "connecting" | "online" | "reconnecting" | "offline";
  panelOpen: boolean;
  mobileSidebarOpen: boolean;
  onToggleMobileSidebar: () => void;
  onOpenPalette: () => void;
  onOpenSearch: () => void;
  onTogglePanel: () => void;
  onShare: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onUpdatePwa: () => void;
  pwaUpdating: () => boolean;
  dashboard?: boolean;
}) {
  const projectLabel = () => props.project?.slug === "chat" ? "Chats" : props.project?.slug || props.project?.name || "Chats";
  const runtimeLabel = () => !props.runtime ? null : props.runtime.kind === "native_pi" ? "Host Pi" : "Isolated Pi";
  const profileLabel = () => props.runtime?.kind === "native_pi" ? null : props.profile?.label || props.profile?.id;
  const posture = () => props.runtime?.kind === "native_pi"
    ? props.live?.trustPosture === "native_saved_trust" ? "project resources trusted" : "project trust pending"
    : props.profile?.posture || props.profile?.tools?.join(" / ");
  const line = () => props.dashboard ? "" : [runtimeLabel(), props.live?.binaryVersion || props.runtime?.binaryVersion ? `Pi ${props.live?.binaryVersion || props.runtime?.binaryVersion}` : null, profileLabel(), projectLabel() !== "Chats" ? projectLabel() : null, posture()].filter(Boolean).join(" · ");
  const menuLine = () => [projectLabel(), runtimeLabel(), props.live?.binaryVersion || props.runtime?.binaryVersion ? `Pi ${props.live?.binaryVersion || props.runtime?.binaryVersion}` : null, profileLabel(), posture()].filter(Boolean).join(" · ");
  const activity = () => props.chat?.activity();
  const contextDetail = () => props.chat && props.contextMetrics
    ? formatContextMetrics({
      enabled: props.contextMetrics(),
      contextUsage: props.chat.contextUsage(),
      sessionStats: props.chat.sessionStats(),
      cacheStats: props.chat.cacheStats(),
    })
    : "";
  const dictationLabel = () => props.composerStatus?.dictationLabel() || "";
  const dictating = () => Boolean(props.composerStatus?.dictating());
  const recording = () => Boolean(props.composerStatus?.recording());
  const statusLabel = () => {
    const currentDictation = dictationLabel();
    if (currentDictation) return currentDictation;
    const currentActivity = activity();
    if (currentActivity?.label) return currentActivity.label;
    if (props.connectivity === "offline") return "Offline";
    if (props.connectivity === "reconnecting") return "Reconnecting…";
    if (props.connectivity === "connecting") return "Connecting…";
    return "Ready";
  };
  const activityKind = () => activity()?.kind || (props.connectivity === "offline" ? "runtime_failed" : "idle");
  const statusBusy = () => dictating() || SPINNING_ACTIVITY.has(activityKind()) || ["connecting", "reconnecting"].includes(props.connectivity || "");
  const statusFailure = () => props.connectivity === "offline" || ["request_failed", "runtime_failed"].includes(activityKind());
  const statusTone = () => statusFailure() ? "error" : recording() ? "listening" : dictating() ? "active" : statusBusy() ? "active" : "ready";
  const waveformHistory = () => props.composerStatus?.waveform.history() || [];
  const waveformLevel = () => props.composerStatus?.waveform.level() || 0;
  const waveformPeak = () => props.composerStatus?.waveform.peak() || 0;
  const waveformState = () => props.composerStatus?.recorderMonitorState() || "stopped";
  return <>
    <header class="chat-header">
      <Show when={!props.mobileSidebarOpen}>
        <Button variant="ghost" size="icon-sm" class="mobile-sidebar-trigger" data-mobile-open="false" aria-label="Toggle Sidebar" aria-expanded={false} onClick={props.onToggleMobileSidebar}><PanelLeftIcon /></Button>
      </Show>
      <nav aria-label="breadcrumb" class="chat-header-title"><span>{projectLabel()}</span><span class="breadcrumb-separator" aria-hidden="true" /><strong>{props.title}</strong></nav>
      <Show when={line()}><span class="chat-profile-posture" title={line()}>{line()}</span></Show>
      <Show when={!props.dashboard && props.chat}>
        <span class="chat-status-line" data-state={statusTone()} role="status" aria-label={`Runtime status: ${statusLabel()}`} aria-live="polite">
          <Show when={recording()} fallback={<span class="chat-status-label">{statusLabel()}</span>}>
            <VoiceWaveform class="chat-status-waveform" history={waveformHistory} level={waveformLevel} peak={waveformPeak} state={waveformState()} variant="compact" barDensity={3.5} ariaLabel="Microphone input level" />
          </Show>
        </span>
      </Show>
      <div class="chat-header-actions">
        <Button variant="ghost" size="icon-sm" class="search-trigger" aria-label="Search chats" title="Search chats" onClick={props.onOpenSearch}><SearchIcon /></Button>
        <Button variant="ghost" size="icon-sm" class="palette-trigger" aria-label="Open command palette" title="Command palette" onClick={props.onOpenPalette}><TerminalIcon /></Button>
        <Button variant="ghost" size="icon-sm" class="chat-header-desktop-action" aria-label={props.dashboard ? "Copy Tailscale workspace link" : "Copy Tailscale chat link"} title={props.dashboard ? "Copy Tailscale workspace link" : "Copy Tailscale chat link"} onClick={props.onShare}><ShareIcon /></Button>
        <Show when={!props.panelOpen}>
          <Button variant="ghost" size="icon-sm" class="chat-header-desktop-action" aria-label="Toggle workspace panel" aria-expanded={false} onClick={props.onTogglePanel}><PanelRightIcon /></Button>
        </Show>
        <Menu>
          <MenuTrigger class="chat-header-more" aria-label="More chat options" title="More chat options"><EllipsisIcon /></MenuTrigger>
          <MenuContent class="chat-header-menu">
            <MenuGroup>
              <MenuLabel class="chat-header-menu-title">{props.title}</MenuLabel>
              <MenuLabel class="chat-header-menu-meta">{menuLine()}</MenuLabel>
            </MenuGroup>
            <Show when={!props.dashboard}>
              <MenuGroup class="chat-header-menu-context" aria-label="Context metrics">
                <MenuLabel class="chat-header-menu-section-label">Context metrics</MenuLabel>
                <div class="chat-header-menu-context-values">{contextDetail() || "No context metrics available yet."}</div>
              </MenuGroup>
            </Show>
            <MenuSeparator />
            <Show when={!props.dashboard}>
              <MenuItem disabled={props.pwaUpdating()} onSelect={props.onUpdatePwa}><RefreshCwIcon class={props.pwaUpdating() ? "pwa-update-icon pwa-update-icon-active" : "pwa-update-icon"} />{props.pwaUpdating() ? "Updating app…" : "Update app"}</MenuItem>
              <MenuSeparator />
            </Show>
            <MenuItem onSelect={props.onTogglePanel}><PanelRightIcon />Workspace panel</MenuItem>
            <MenuItem onSelect={props.onShare}><ShareIcon />Share</MenuItem>
            <Show when={props.onRename}>
              <MenuItem onSelect={() => props.onRename?.()}><PencilIcon />{props.dashboard ? "Rename workspace" : "Rename"}</MenuItem>
            </Show>
            <Show when={props.onDelete}>
              <MenuItem variant="destructive" onSelect={() => props.onDelete?.()}><Trash2Icon />{props.dashboard ? "Delete workspace" : "Delete"}</MenuItem>
            </Show>
          </MenuContent>
        </Menu>
      </div>
    </header>
  </>;
}

function App() {
  const shortcutManager = new ShortcutManager({
    commands: commandRegistry,
    environment: browserShortcutEnvironmentProvider.detect(),
  });
  const [templates, setTemplates] = createSignal<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = createSignal(true);
  const [installations, setInstallations] = createSignal<Installation[]>([]);
  const [installationsLoading, setInstallationsLoading] = createSignal(true);
  const [workspaceSuggestions, setWorkspaceSuggestions] = createSignal<WorkspaceSuggestion[]>([]);
  const [workspacePolicy, setWorkspacePolicy] = createSignal<WorkspacePolicy | null>(null);
  const [defaultTemplateId, setDefaultTemplateId] = createSignal("chat");
  const [voiceSettings, setVoiceSettings] = createSignal<VoiceDictationSettings>(loadVoiceDictationSettings() as VoiceDictationSettings);
  const updateVoiceSettings = (next: VoiceDictationSettings) => setVoiceSettings(saveVoiceDictationSettings(next) as VoiceDictationSettings);
  const [partialContinue, setPartialContinue] = createSignal(true);
  const [maxAttachmentBytes, setMaxAttachmentBytes] = createSignal(DEFAULT_MAX_ATTACHMENT_BYTES);
  const [markdownRenderer, setMarkdownRenderer] = createSignal<MarkdownRendererId>(selectedMarkdownRenderer());
  const [meteorField, setMeteorField] = createSignal(selectedMeteorField());
  const [composerSurface, setComposerSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  const [sidebarChatLimit, setSidebarChatLimit] = createSignal(selectedSidebarChatLimit());
  const [contextMetrics, setContextMetrics] = createSignal<ContextMetricId[]>(selectedContextMetrics());
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [settingsSection, setSettingsSection] = createSignal<SettingsSection>("models");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = createSignal<string | null>(null);
  const [workspaceIdentityId, setWorkspaceIdentityId] = createSignal<string | null>(null);
  const [workspaceIdentitySaving, setWorkspaceIdentitySaving] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [palettePage, setPalettePage] = createSignal<string | null>(null);
  const [paletteDirectLaunch, setPaletteDirectLaunch] = createSignal(false);
  const [paletteInitialQuery, setPaletteInitialQuery] = createSignal("");
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

  let diagnosticContext: () => ErrorDiagnosticContext = () => ({ route: location.pathname });
  let askRuntimeForError: (diagnostic: ErrorDiagnostic) => Promise<void> = async () => {};
  let suppressDiagnosticActions = false;
  const showPlainError = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error || "Request failed"));
  const showError = (error: unknown) => {
    if (suppressDiagnosticActions) return showPlainError(error);
    const diagnostic = createErrorDiagnostic(error, diagnosticContext());
    toast.error(diagnostic.message, {
      duration: 12_000,
      action: { label: "Ask Runtime", onClick: () => void askRuntimeForError(diagnostic) },
    });
  };
  const [pwaUpdating, setPwaUpdating] = createSignal(false);
  const runPwaUpdate = async () => {
    if (pwaUpdating()) return;
    setPwaUpdating(true);
    try {
      await forcePwaUpdate();
    } catch (error) {
      setPwaUpdating(false);
      toast.error("Could not update the app", { description: error instanceof Error ? error.message : "Reload Conduit and try again." });
    }
  };
  const catalogue = createCatalogueStore();
  const runtime = createRuntimeStore();
  const [composerStatus, setComposerStatus] = createSignal<ComposerStatus | null>(null);
  const models = createModelSettings(showError, ({ from, to }) => {
    const label = (level: string) => level ? level[0]!.toUpperCase() + level.slice(1) : "Off";
    toast.info(`Saved thinking level ${label(from)} is no longer available. Using ${label(to)}.`, {
      id: "thinking-level-recovery",
      duration: 6_000,
    });
  });
  const attachments = createAttachments(showError, maxAttachmentBytes);

  const saveWorkspaceDefault = async (workspaceId: string, templateId: string | null) => {
    const saved = await api<Project>(`/v0/projects/${encodeURIComponent(workspaceId)}`, { method: "PATCH", body: JSON.stringify({ defaultTemplateId: templateId }) });
    catalogue.setProjects((current) => current.map((item) => item.id === workspaceId ? { ...item, ...saved, sessions: item.sessions } : item));
    return saved;
  };

  const saveWorkspaceAppearance = async (workspaceId: string, workspaceAppearance: WorkspaceAppearance) => {
    const saved = await api<Project>(`/v0/projects/${encodeURIComponent(workspaceId)}`, { method: "PATCH", body: JSON.stringify({ workspaceAppearance }) });
    catalogue.setProjects((current) => current.map((item) => item.id === workspaceId ? { ...item, ...saved, sessions: item.sessions } : item));
    return saved;
  };

  const workspaceIdentityProject = createMemo(() => {
    const id = workspaceIdentityId();
    return id ? catalogue.projects().find((project) => project.id === id) : undefined;
  });
  const openWorkspaceIdentity = (project: Project) => setWorkspaceIdentityId(project.id);
  const closeWorkspaceIdentity = () => {
    if (!workspaceIdentitySaving()) setWorkspaceIdentityId(null);
  };
  const saveWorkspaceIdentity = async (appearance: WorkspaceAppearance) => {
    const project = workspaceIdentityProject();
    if (!project || workspaceIdentitySaving()) return;
    setWorkspaceIdentitySaving(true);
    try {
      await saveWorkspaceAppearance(project.id, appearance);
      setWorkspaceIdentityId(null);
    } catch (error) {
      showError(error);
    } finally {
      setWorkspaceIdentitySaving(false);
    }
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
    : templates().find((item) => item.id === chat.templateId()) || templates().find((item) => item.id === defaultTemplateId()) || null);
  const emptyChat = createMemo(() => chat.loadedId() === catalogue.selectedId() && !chat.messages().length && !chat.tools().length && !chat.activity()?.label);
  const workspacePanelScope = createMemo(() => catalogue.selectedId() || (routeKind() === "project" && catalogue.projectId() ? `project:${catalogue.projectId()}` : null));

  diagnosticContext = () => {
    const identity = chat.runtimeIdentity();
    return {
      route: location.pathname,
      chat: { id: catalogue.selectedId(), projectId: catalogue.projectId(), status: chat.status() },
      runtime: {
        kind: identity?.kind,
        installationId: identity?.installationId,
        binaryVersion: identity?.binaryVersion,
        profileId: chat.templateId(),
      },
      model: models.model(),
      thinkingLevel: models.effort(),
      connectivity: runtime.connectivity(),
    };
  };

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

  const createChat = async (target?: Project, launch: { templateId?: string; runtimeKind?: string } = {}, options: { reportFailure?: boolean } = {}) => {
    const reportFailure = options.reportFailure !== false;
    const project = target || selectedProject() || catalogue.projects().find((item) => item.slug === "chat") || catalogue.projects()[0];
    if (!project) return null;
    const replacedDraftId = currentDraftId();
    const fromDashboard = routeKind() === "project";
    try {
      const hostDefault = project.defaultTemplateId === "host-pi" && !launch.templateId && !launch.runtimeKind;
      const profileId = launch.templateId || (project.defaultTemplateId === "host-pi" ? null : project.defaultTemplateId) || defaultTemplateId() || "chat";
      const created = await api<ChatSummary>(profileId === "runtime" ? "/v0/runtime/chats" : "/v0/chats", {
        method: "POST",
        body: JSON.stringify(profileId === "runtime" ? {} : hostDefault ? { projectId: project.id } : { projectId: project.id, templateId: profileId, runtimeKind: launch.runtimeKind || "conduit_profile" }),
      });
      const ownerProject = profileId === "runtime"
        ? catalogue.projects().find((item) => item.id === created.projectId)
          || catalogue.projects().find((item) => item.slug === "chat")
        : project;
      if (!ownerProject) throw new Error("The Runtime chat project is not available");

      // Commit the visible transition only after the durable replacement exists.
      // initialize() first: it resets the previous chat's live socket, and the
      // URL must not advertise the new chat while a send could still target the old one.
      batch(() => {
        chat.initialize({ ...created, templateId: created.templateId || profileId || undefined }, ownerProject);
        if (fromDashboard) history.pushState({}, "", `/chat/${created.id}`);
        else history.replaceState({}, "", `/chat/${created.id}`);
        setRouteKind("chat");
        setRouteBootstrapError("");
        setRouteBootstrap("ready");
      });
      // Show the new chat in the sidebar immediately instead of waiting for the
      // first server checkpoint refresh; drop the empty draft it replaced.
      catalogue.setProjects((current) => current.map((item) => {
        if (item.id === ownerProject.id) {
          return { ...item, sessions: [{ ...created, pinned: true }, ...item.sessions.filter((session) => session.id !== created.id && session.id !== replacedDraftId)] };
        }
        if (item.id === project.id && item.id !== ownerProject.id && replacedDraftId) {
          return { ...item, sessions: item.sessions.filter((session) => session.id !== replacedDraftId) };
        }
        return item;
      }));

      if (replacedDraftId && replacedDraftId !== created.id) {
        try { await discardDraft(replacedDraftId); }
        catch (error) {
          const detail = error as Error & { error?: string };
          if (detail.error !== "chat_not_found") (reportFailure ? showError : showPlainError)(`The new chat was created, but the old empty draft could not be removed: ${detail.message}`);
        }
      }
      return created;
    } catch (error) {
      if (reportFailure) showError(error);
      else throw error;
      return null;
    }
  };

  askRuntimeForError = async (diagnostic) => {
    if (suppressDiagnosticActions) return;
    suppressDiagnosticActions = true;
    try {
      const created = await createChat(undefined, { templateId: "runtime" }, { reportFailure: false });
      if (!created) throw new Error("No Chats project is available for a Runtime chat");
      chat.setDraft(formatRuntimeDiagnosticPrompt(diagnostic));
      await chat.send();
    } catch (error) {
      showPlainError(error);
    } finally {
      suppressDiagnosticActions = false;
    }
  };

  const openChat = async (target: ChatSummary, project: Project) => {
    if (target.id === catalogue.selectedId() && routeKind() === "chat") return;
    const abandonedDraftId = currentDraftId();
    try {
      await chat.select(target, project, {
        history: "push",
        onCommit: () => {
          setRouteKind("chat");
          setRouteBootstrapError("");
          setRouteBootstrap("ready");
        },
      });
    }
    catch (error) { showError(error); return; }
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
    setRouteBootstrapError("");
    setRouteBootstrap("ready");
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
      if (["clone", "cloned"].includes(input.mode)) {
        const provisional = { ...created, sessions: [] };
        catalogue.setProjects((current) => [...current.filter((project) => project.id !== provisional.id), provisional]);
        await openProject(provisional);
        return true;
      }
      await refresh();
      if (["link", "linked", "create", "created"].includes(input.mode)) await openProject(created);
      else await createChat(created, { templateId: created.defaultTemplateId || defaultTemplateId() || "chat" });
      return true;
    } catch (error) { showError(error); return false; }
  };
  const renameChat = async (target: ChatSummary, _project: Project, name: string) => {
    try { const saved = await api<ChatSummary>(`/v0/sessions/${target.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); if (catalogue.selectedId() === target.id) chat.setTitle(saved.title); await refresh(); return true; }
    catch (error) { showError(error); return false; }
  };
  const renameProject = async (target: Project, name: string) => {
    try { await api(`/v0/projects/${target.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); await refresh(); return true; }
    catch (error) { showError(error); return false; }
  };
  const moveChat = async (target: ChatSummary, _source: Project, destination: Project) => {
    try { await api(`/v0/sessions/${target.id}/move`, { method: "POST", body: JSON.stringify({ projectId: destination.id }) }); await refresh(); }
    catch (error) { showError(error); }
  };
  const moveChats = async (targets: Array<{ chat: ChatSummary; project: Project }>, destination: Project) => {
    const candidates = targets.filter((target) => target.project.id !== destination.id);
    const results = await Promise.all(candidates.map(async (target) => {
      try {
        await api(`/v0/sessions/${target.chat.id}/move`, { method: "POST", body: JSON.stringify({ projectId: destination.id }) });
        return null;
      } catch (error) {
        return { id: target.chat.id, error };
      }
    }));
    const failures = results.filter((result): result is { id: string; error: unknown } => Boolean(result));
    await refresh();
    if (failures.length) {
      const first = failures[0]!.error;
      const detail = first instanceof Error ? first.message : String(first || "Request failed");
      showError(Object.assign(new Error(`${failures.length} of ${targets.length} chats could not be moved: ${detail}`), {
        code: "bulk_move_failed",
        apiRequest: (first as { apiRequest?: unknown })?.apiRequest,
      }));
    }
    return failures.map((failure) => failure.id);
  };
  const moveProjectChats = async (source: Project, destination: Project) => {
    try { await api(`/v0/projects/${source.id}/move-sessions`, { method: "POST", body: JSON.stringify({ projectId: destination.id }) }); await refresh(); }
    catch (error) { showError(error); }
  };
  const copyTranscript = async (target: ChatSummary) => {
    try { const response = await fetch(`/v0/sessions/${target.id}/transcript`); if (!response.ok) throw new Error("Could not load the transcript"); await navigator.clipboard.writeText(await response.text()); }
    catch (error) { showError(error); }
  };
  const copyChatLinks = async (targets: Array<{ chat: ChatSummary; project: Project }>) => {
    try {
      const { origin } = await api<{ origin: string }>("/v0/share-origin");
      const links = targets.map((target) => `${origin}/chat/${encodeURIComponent(target.chat.id)}`);
      await navigator.clipboard.writeText(links.join("\n"));
      toast.success(`${links.length} chat links copied`);
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  };
  const deleteChat = async (target: ChatSummary, project: Project) => {
    try { await api(`/v0/sessions/${target.id}`, { method: "DELETE" }); if (catalogue.selectedId() === target.id) await createChat(project); await refresh(); }
    catch (error) { showError(error); }
  };
  const deleteChats = async (targets: Array<{ chat: ChatSummary; project: Project }>) => {
    const displayedId = catalogue.selectedId();
    const displayedTarget = targets.find((target) => target.chat.id === displayedId);
    const results = await Promise.all(targets.map(async (target) => {
      try {
        await api(`/v0/sessions/${target.chat.id}`, { method: "DELETE" });
        return null;
      } catch (error) {
        return { id: target.chat.id, error };
      }
    }));
    const failures = results.filter((result): result is { id: string; error: unknown } => Boolean(result));
    if (displayedTarget && !failures.some((failure) => failure.id === displayedId)) await createChat(displayedTarget.project);
    await refresh();
    if (failures.length) {
      const first = failures[0]!.error;
      const detail = first instanceof Error ? first.message : String(first || "Request failed");
      showError(Object.assign(new Error(`${failures.length} of ${targets.length} chats could not be deleted: ${detail}`), {
        code: "bulk_delete_failed",
        apiRequest: (first as { apiRequest?: unknown })?.apiRequest,
      }));
    }
    return failures.map((failure) => failure.id);
  };
  const deleteProject = async (target: Project) => {
    try { await api(`/v0/projects/${target.id}`, { method: "DELETE" }); if (catalogue.projectId() === target.id) await createChat(catalogue.projects().find((item) => item.slug === "chat")); await refresh(); }
    catch (error) { showError(error); }
  };
  const destroyWorkspace = async (target: Project, confirmation: string) => {
    try {
      await api(`/v0/projects/${encodeURIComponent(target.id)}`, { method: "DELETE", body: JSON.stringify({ mode: "destroy_workspace", confirmation }) });
      if (catalogue.projectId() === target.id) await createChat(catalogue.projects().find((item) => item.slug === "chat"));
      await refresh();
      return true;
    } catch (error) { showError(error); return false; }
  };
  const cancelClone = async (operationId: string) => {
    await api(`/v0/workspace-operations/${encodeURIComponent(operationId)}`, { method: "DELETE" });
  };

  const openSettings = (section: string = "models", workspaceId: string | null = null) => {
    setSettingsSection(section as SettingsSection);
    setSettingsWorkspaceId(workspaceId);
    setSettingsOpen(true);
  };
  const switchMarkdownRenderer = (next: MarkdownRendererId) => {
    setMarkdownRenderer(next);
    localStorage.setItem(MARKDOWN_RENDERER_STORAGE_KEY, next);
  };
  const switchMeteorField = (enabled: boolean) => {
    setMeteorField(enabled);
    localStorage.setItem(METEOR_FIELD_STORAGE_KEY, String(enabled));
  };
  const switchComposerSurface = (surface: ComposerSurfaceMode) => {
    setComposerSurface(saveComposerSurface(surface));
  };
  const switchSidebarChatLimit = (next: number) => {
    const value = clampSidebarChatLimit(next);
    setSidebarChatLimit(value);
    localStorage.setItem(SIDEBAR_CHAT_LIMIT_STORAGE_KEY, String(value));
  };
  const switchContextMetrics = (next: ContextMetricId[]) => setContextMetrics(saveContextMetrics(next));
  const saveDefaultTemplate = async (id: string) => {
    const saved = await api<{ defaultTemplateId: string }>("/v0/preferences", { method: "PATCH", body: JSON.stringify({ defaultTemplateId: id }) });
    setDefaultTemplateId(saved.defaultTemplateId || id);
    return saved;
  };
  const openPalette = (page: string | null = null, initialQuery = "", direct = false) => {
    setPalettePage(page);
    setPaletteInitialQuery(initialQuery);
    setPaletteDirectLaunch(direct);
    setPaletteNonce((value) => value + 1);
    setPaletteOpen(true);
  };
  const toggleSearchPalette = () => {
    if (paletteOpen() && palettePage() === "chat-search") {
      setPaletteOpen(false);
      return;
    }
    openPalette("chat-search", "", true);
  };
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
      showError(error);
    }
  };
  const shareProject = async () => {
    const project = selectedProject();
    if (!project) return;
    try {
      const { origin } = await api<{ origin: string }>("/v0/share-origin");
      await navigator.clipboard.writeText(`${origin}${projectPath(project)}`);
      toast.success("Tailscale workspace link copied");
    } catch (error) { showError(error); }
  };
  const runSidebar = (type: string) => setSidebarCommand({ type, nonce: Date.now() });
  const loadWorkspaceSuggestions = () => {
    if (workspaceSuggestionsRequest) return workspaceSuggestionsRequest;
    workspaceSuggestionsRequest = api<WorkspaceSuggestionsPayload>("/v0/workspaces/suggestions")
      .then((payload) => {
        setWorkspaceSuggestions(asList<WorkspaceSuggestion>(payload.folders));
        setWorkspacePolicy({
          allowlist: asList<string>(payload.allowlist),
          defaultRoot: payload.defaultRoot || null,
          defaultInputPath: payload.defaultInputPath || null,
          suggestionRoot: String(payload.suggestionRoot || payload.root || ""),
          modes: asList<string>(payload.modes),
        });
      })
      .catch(() => {
        setWorkspaceSuggestions([]);
        setWorkspacePolicy(null);
      });
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
  }));

  const paletteActions: PaletteActions = {
    logout: () => { void fetch("/v0/auth/logout", { method: "POST" }).finally(() => { location.href = "/login"; }); },
    newChat: (project, launch) => void createChat(project ?? undefined, launch ?? {}),
    newFolder: () => runSidebar("new-folder"),
    newWorkspace: () => runSidebar("new-workspace"),
    openRuntimeChat: () => void createChat(undefined, { templateId: "runtime" }),
    attach: () => attachFileInput?.click(),
    toggleDictation: () => window.dispatchEvent(new Event("conduit:toggle-dictation")),
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
    renameChat,
    moveChats,
    copyChatLinks,
    deleteChats,
    chooseModel: (spec) => void models.chooseModel(spec),
    chooseEffort: (level) => void models.chooseEffort(level),
    setChatProfile: (id) => void switchProfile(id),
  };

  const dismissOpenLayer = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key !== "Escape") return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-shortcut-exclusive='terminal']")) return;
    if (event.key === "Escape" && !paletteOpen() && !settingsOpen()) {
      if (panelOpen()) { event.preventDefault(); togglePanel(); return; }
      if (mobileSidebarOpen()) { event.preventDefault(); setMobileSidebarOpen(false); return; }
    }
  };

  onMount(() => {
    void preloadVoiceCaptureWorklet().catch(() => {});
    const releaseApplicationContext = shortcutManager.activateContext("application");
    const releaseShortcutHandlers = [
      shortcutManager.registerHandler(COMMAND_IDS.openCommandPalette, "application", () => {
        if (paletteOpen()) setPaletteOpen(false);
        else openPalette(null);
      }),
      shortcutManager.registerHandler(COMMAND_IDS.searchChats, "application", toggleSearchPalette),
      shortcutManager.registerHandler(COMMAND_IDS.openSettings, "application", () => openSettings("general")),
      shortcutManager.registerHandler(COMMAND_IDS.newChat, "application", () => {
        setMobileSidebarOpen(false);
        void createChat();
      }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleSidebar, "application", () => runSidebar("toggle-sidebar")),
      shortcutManager.registerHandler(COMMAND_IDS.toggleWorkspacePanel, "application", togglePanel),
    ];
    const uninstallShortcuts = shortcutManager.install(window);
    window.addEventListener("keydown", dismissOpenLayer, { capture: true });
    onCleanup(() => {
      window.removeEventListener("keydown", dismissOpenLayer, true);
      uninstallShortcuts();
      for (const release of releaseShortcutHandlers) release();
      releaseApplicationContext();
    });
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
        await chat.select(target, owner, {
          history: "none",
          onCommit: () => {
            setRouteKind("chat");
            setRouteBootstrapError("");
            setRouteBootstrap("ready");
          },
        });
      })().catch((error) => showError(error));
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
    void api<{ partialContinue?: boolean; maxAttachmentBytes?: number }>("/v0/capabilities")
      .then((payload) => {
        setPartialContinue(payload.partialContinue !== false);
        const maxBytes = payload.maxAttachmentBytes;
        if (typeof maxBytes === "number" && Number.isSafeInteger(maxBytes) && maxBytes > 0) setMaxAttachmentBytes(maxBytes);
      })
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
        if (target.status === "active") {
          try {
            await chat.openLive(target.id, project.id);
          } catch (error) {
            showError(error);
          }
        }
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

  const dropHandlers = {
    onDragEnter: (event: DragEvent) => { if (!event.dataTransfer?.types.includes("Files")) return; event.preventDefault(); dragDepth += 1; setDropActive(true); },
    onDragOver: (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); },
    onDragLeave: (event: DragEvent) => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) setDropActive(false); },
    onDrop: (event: DragEvent) => { event.preventDefault(); dragDepth = 0; setDropActive(false); const files = filesFromDataTransfer(event.dataTransfer); if (files.length) attachments.addFiles(files); },
  };

  const renderComposerStack = () => <div class={`composer-stack${composerSurface() === "static-experimental" ? " composer-stack-experimental" : ""}`}>
    <HostUiRequests requests={chat.hostUiRequests()} onRespond={chat.respondHostUi} />
    <Composer chat={chat} attachments={attachments} models={models} profiles={profiles()} activeProfile={activeProfile()} serverOnline={runtime.connectivity() === "online"} composerSurface={composerSurface()} voiceSettings={voiceSettings()} onChooseProfile={(id) => void switchProfile(id)} onOpenSettings={openSettings} onOpenAttachments={() => attachFileInput?.click()} onStatusChange={setComposerStatus} />
  </div>;

  return <>
    <Toaster richColors />
    <input ref={attachFileInput} type="file" multiple hidden aria-hidden="true" onChange={(event) => { if (event.currentTarget.files) attachments.addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <Dialog open={Boolean(workspaceIdentityProject())} onOpenChange={(open) => { if (!open) closeWorkspaceIdentity(); }}>
      <DialogContent class="workspace-appearance-dialog" title="Workspace identity" description="Choose a short mark or a Lucide icon, then choose a preset or custom color.">
        <Show when={workspaceIdentityProject()}>{(project) => <WorkspaceAppearanceEditor compact value={project().workspaceAppearance} saving={workspaceIdentitySaving()} onSave={(appearance) => void saveWorkspaceIdentity(appearance)} />}</Show>
      </DialogContent>
    </Dialog>
    <Sidebar projects={catalogue.projects()} projectId={catalogue.projectId()} selectedId={catalogue.selectedId()} runtime={runtime} chatLimit={sidebarChatLimit()}
      connectivity={runtime.connectivity()} workspaceSuggestions={workspaceSuggestions()} workspacePolicy={workspacePolicy()} command={sidebarCommand()}
      mobileOpen={mobileSidebarOpen()} onMobileOpenChange={setMobileSidebar}
      onWorkspaceSuggestionsNeeded={() => void loadWorkspaceSuggestions()}
      onNewChat={async (project) => { await createChat(project); }} onOpenChat={openChat} onOpenProject={openProject} onAddProject={addProject} onRenameChat={renameChat} onRenameProject={renameProject}
      onMoveChat={moveChat} onMoveChats={moveChats} onMoveProjectChats={moveProjectChats} onCopyTranscript={copyTranscript} onCopyChatLinks={copyChatLinks}
      onDeleteChat={deleteChat} onDeleteChats={deleteChats} onDeleteProject={deleteProject}
      onOpenTerminal={(target, project) => { void openChat(target, project).then(() => openWorkspaceView("terminal")); }}
      onOpenWorkspaceIdentity={openWorkspaceIdentity} onOpenSettings={openSettings} onOpenPalette={(page, initialQuery) => openPalette(page || null, initialQuery || "", page === "chat-search")} />
    <main data-slot="sidebar-inset" data-composer-surface={routeKind() === "chat" ? composerSurface() : undefined} class={`chat-main${routeKind() === "chat" && emptyChat() ? " chat-main-empty" : ""}`} {...(routeKind() === "chat" ? dropHandlers : {})}>
      <Show when={routeBootstrap() === "ready"} fallback={<div class="chat-bootstrap" role={routeBootstrap() === "error" ? "alert" : "status"}>{routeBootstrap() === "error"
        ? routeBootstrapError() || (routeKind() === "project" ? "This project could not be loaded." : "This chat could not be loaded.")
        : routeKind() === "project" ? "Loading project…" : "Loading chat…"}</div>}>
        <Show when={routeKind() === "chat" && meteorField()}>
          <div class="chat-meteors" aria-hidden="true">
            <DefaultMeteorShower />
          </div>
        </Show>
        <Show when={routeKind() === "project" && selectedProject()} fallback={<>
          <Show when={dropActive()}><div class="chat-drop-overlay"><div>Drop files to attach</div></div></Show>
          <ChatHeader project={selectedProject()} title={chat.title()} profile={activeProfile()} runtime={chat.runtimeIdentity()} live={chat.live() as unknown as Record<string, unknown>} chat={chat} contextMetrics={contextMetrics} composerStatus={composerStatus()} connectivity={runtime.connectivity()} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => void shareChat()} onRename={() => runSidebar("rename-chat")} onDelete={() => runSidebar("delete-chat")} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} />
          <Show when={selectedProject()?.kind === "workspace" && [...runtime.processes().values()].some((process) => process.chatId !== catalogue.selectedId() && process.active)}><div class="workspace-warning"><TriangleAlertIcon /><div><strong>Another chat is working in this Workspace</strong><p>Both agents can edit the same files. Conduit does not lock the Workspace or create worktrees automatically.</p></div></div></Show>
          <div class="work-area">
            <section class="work-area-conversation" aria-label="Conversation">
              <Transcript chat={chat} partialContinue={partialContinue()} markdownRenderer={markdownRenderer()} profileLabel={activeProfile()?.label || activeProfile()?.id || chat.templateId() || undefined} stickyFooter={composerSurface() === "static-experimental" ? undefined : renderComposerStack()} />
              <Show when={composerSurface() === "static-experimental"}>{renderComposerStack()}</Show>
            </section>
          </div>
        </>}>
          <ChatHeader project={selectedProject()} title="Dashboard" panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => void shareProject()} onRename={() => runSidebar("rename-folder")} onDelete={() => runSidebar("delete-project")} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} dashboard />
          <ProjectDashboard project={selectedProject()!} templates={templates()} runtime={runtime}
            onNewChat={async (project) => { await createChat(project); }} onOpenChat={(target: DashboardChat, project) => openChat(target, project)}
            onRename={() => runSidebar("rename-folder")} onDelete={() => runSidebar("delete-project")}
            onOpenSettings={openSettings} onSaveDefault={saveWorkspaceDefault} onSaveAppearance={saveWorkspaceAppearance} onRefresh={refresh} onCancelClone={cancelClone} onDestroyWorkspace={(confirmation) => destroyWorkspace(selectedProject()!, confirmation)} onError={showError} />
        </Show>
      </Show>
    </main>
    <Show when={Boolean(selectedProject()) && Boolean(workspacePanelScope())}><WorkspacePanel projectId={() => selectedProject()!.id} chatId={() => workspacePanelScope()!} open={panelOpen} requestedTab={workspaceViewRequest} onClose={togglePanel} /></Show>
    <CommandMenu open={paletteOpen()} onOpenChange={setPaletteOpen} onPageChange={setPalettePage} initialPage={palettePage()} initialQuery={paletteInitialQuery()} launchNonce={paletteNonce()} directLaunch={paletteDirectLaunch()}
      context={paletteContext()} actions={paletteActions} models={models.models()} currentModel={models.model()} onChooseModel={(spec) => void models.chooseModel(spec)} shortcuts={shortcutManager} />
                <Settings open={settingsOpen()} initialSection={settingsSection()} initialWorkspaceId={settingsWorkspaceId()} onOpenChange={setSettingsOpen} models={models} templates={templates()} templatesLoading={templatesLoading()} defaultTemplateId={defaultTemplateId()} projects={catalogue.projects()} installations={installations()} installationsLoading={installationsLoading()} onInstallationsChange={setInstallations} onDefaultTemplateChange={saveDefaultTemplate} onWorkspaceDefaultChange={saveWorkspaceDefault} markdownRenderer={markdownRenderer()} onMarkdownRendererChange={switchMarkdownRenderer} meteorField={meteorField()} onMeteorFieldChange={switchMeteorField} composerSurface={composerSurface()} onComposerSurfaceChange={switchComposerSurface} voiceSettings={voiceSettings()} onVoiceSettingsSave={updateVoiceSettings} sidebarChatLimit={sidebarChatLimit()} onSidebarChatLimitChange={switchSidebarChatLimit} contextMetrics={contextMetrics()} onContextMetricsChange={switchContextMetrics} shortcuts={shortcutManager} />
  </>;
}

render(() => <ErrorBoundary fallback={(error) => <div class="crash-screen"><div class="crash-card"><h1>Conduit hit a UI error</h1><p>{error instanceof Error ? error.message : "Unknown interface error"}</p><Button onClick={() => location.reload()}>Reload Conduit</Button></div></div>}><App /></ErrorBoundary>, document.getElementById("root")!);
