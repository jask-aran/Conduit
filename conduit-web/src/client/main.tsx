/// <reference types="vite-plugin-pwa/client" />
import { batch, createEffect, createMemo, createSignal, ErrorBoundary, lazy, onCleanup, onMount, Show, type JSX } from "solid-js";
import { render } from "solid-js/web";
import { Capacitor } from "@capacitor/core";
import {
  EllipsisIcon, MessageSquarePlusIcon, PanelLeftIcon, PanelRightIcon, PencilIcon, RefreshCwIcon, SearchIcon, ShareIcon, TerminalIcon, Trash2Icon, TriangleAlertIcon,
} from "lucide-solid";
import { registerSW } from "virtual:pwa-register";
import { Toaster, toast } from "solid-sonner";
import "solid-sonner/styles.css";
import { DefaultMeteorShower } from "@jask-aran/solid-components/meteor-shower";
import "@jask-aran/solid-components/meteor-shower.css";
import { Button, Dialog, DialogContent, Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/primitives";
import { api, asList, pathChatId, pathProjectId, projectPath } from "./api/client";
import { buildHttpUrl, clearServerOrigin, configuredServerOrigin, loginUrl, logoutUrl, normalizeServerOrigin, saveServerOrigin, transcriptUrl } from "./api/transport";
import { authorizedFetch, clearNativeBearerToken, nativeBearerToken, NATIVE_AUTH_REQUIRED_EVENT, saveNativeBearerToken } from "./api/native-auth-client";
import type { ChatSummary, DashboardChat, Installation, Project, RuntimeIdentity, Template, TranscriptDetail, WorkspaceAppearance, WorkspacePolicy, WorkspaceSuggestion, WorkspaceSuggestionsPayload } from "./api/contracts";
import { createErrorDiagnostic, formatRuntimeDiagnosticPrompt, type ErrorDiagnostic, type ErrorDiagnosticContext } from "./error-diagnostics";
import { Composer, SPINNING_ACTIVITY, type ComposerStatus } from "./chat/composer";
import { AppDashboard } from "./dashboard/app-dashboard";
import { COMPOSER_SURFACE_CHANGE_EVENT, COMPOSER_SURFACE_STORAGE_KEY, selectedComposerSurface, type ComposerSurfaceMode } from "./chat/composer-surface";
import type { VoiceDictationSettings } from "./chat/voice-dictation-types";
import { CONTEXT_METRIC_STORAGE_KEY, contextUsagePercent, formatContextMetrics, saveContextMetrics, selectedContextMetrics, type ContextMetricId } from "./chat/context-metrics";
import { HostUiRequests } from "./chat/host-ui-card";
import {
  MARKDOWN_RENDERER_STORAGE_KEY,
  RENDERER_CONTROLS_VISIBLE_STORAGE_KEY,
  saveMarkdownRenderer,
  saveRendererControlsVisible,
  selectedMarkdownRenderer,
  selectedRendererControlsVisible,
  type MarkdownRendererId,
} from "./chat/markdown-settings";
import { loadVoiceDictationSettings, saveVoiceDictationSettings, VOICE_DICTATION_STORAGE_KEY } from "./chat/voice-dictation";
import { Transcript } from "./chat/transcript";
import { COMMAND_IDS, commandRegistry } from "./commands/command-registry";
import { CommandMenu } from "./navigation/command-menu";
import { LeaderPalette } from "./navigation/leader-palette";
import type { PaletteActions, PaletteContext } from "./palette/command-registry";
import { bindVisualViewportShell, isMobileLayout, MOBILE_LAYOUT_QUERY, setMobileOverlayKind } from "./navigation/mobile-layout";
import { mobileSwipeAction } from "./navigation/mobile-swipe";
import { Sidebar, type SidebarCommand } from "./navigation/sidebar";
import { clampSidebarChatLimit, selectedSidebarChatLimit, SIDEBAR_CHAT_LIMIT_STORAGE_KEY } from "./navigation/sidebar-preferences";
import { CHAT_SORT_STORAGE_KEY, selectedChatSort, useChatSort } from "./preferences/chat-sort";
import { WorkspaceAppearanceEditor } from "./project/workspace-appearance-editor";
import { checkForPwaUpdate, forcePwaUpdate, rememberPwaRegistration, resetPwaAppCache } from "./pwa-update";
import { createActiveChat, type ActiveChatStore } from "./state/active-chat";
import { createAttachments, DEFAULT_MAX_ATTACHMENT_BYTES, filesFromDataTransfer } from "./state/attachments";
import { createCatalogueStore } from "./state/catalogue";
import { createModelSettings } from "./state/model-settings";
import { createRuntimeStore } from "./state/runtime";
import { VoiceWaveform } from "./chat/voice-waveform";
import { browserShortcutEnvironmentProvider } from "./shortcuts/shortcut-environment";
import { ShortcutManager } from "./shortcuts/shortcut-manager";
import { publishUiPreference, saveUiPreference, UI_PREFERENCE_CHANGE_EVENT, type UiPreferenceKey, type UiPreferences } from "./preferences/ui-preferences";
import { applyUiScale, selectedUiScale } from "./preferences/ui-scale";
import { INCREMARK_PACING_STORAGE_KEY } from "./chat/incremark-pacing";
import {
  applyTranscriptAppearance,
  CODE_BLOCK_COLLAPSE_LINES_STORAGE_KEY,
  CODE_BLOCK_COLLAPSE_STORAGE_KEY,
  isCodeBlockCollapseLines,
  isCodeBlockCollapseMode,
  isTranscriptWideBlocksMode,
  isTranscriptWidthMode,
  selectedCodeBlockCollapse,
  selectedCodeBlockCollapseLines,
  selectedCodeBlockWidth,
  isCodeBlockWidthMode,
  CODE_BLOCK_WIDTH_STORAGE_KEY,
  selectedPanelMotion,
  isPanelMotionMode,
  PANEL_MOTION_STORAGE_KEY,
  isUserMessageCollapseMode,
  selectedUserMessageCollapse,
  USER_MESSAGE_COLLAPSE_STORAGE_KEY,
  selectedTranscriptWideBlocks,
  selectedTranscriptWidth,
  TRANSCRIPT_WIDE_BLOCKS_STORAGE_KEY,
  TRANSCRIPT_WIDTH_STORAGE_KEY,
} from "./chat/transcript-appearance";
import "./project/dashboard.css";
import "./chat/composer-geometry.css";
import "./styles.css";

const nativeApp = Capacitor.isNativePlatform();
applyUiScale(selectedUiScale());
// Stamp the reading-surface presets before first paint so the transcript is
// never laid out at the default width and then reflowed to the chosen one.
applyTranscriptAppearance({
  width: selectedTranscriptWidth(),
  wideBlocks: selectedTranscriptWideBlocks(),
  collapse: selectedCodeBlockCollapse(),
  collapseLines: selectedCodeBlockCollapseLines(),
  codeWidth: selectedCodeBlockWidth(),
  userMessageCollapse: selectedUserMessageCollapse(),
});
if (import.meta.env.PROD && !nativeApp) registerSW({ immediate: true, onRegisteredSW: (_url, registration) => rememberPwaRegistration(registration) });

type SettingsSection = "ui" | "shortcuts" | "models" | "runtime" | "workspaces" | "voice" | "search";
type WorkspaceView = "files" | "diff" | "artifacts" | "terminal";
const METEOR_FIELD_STORAGE_KEY = "conduit:meteor-field";
const selectedMeteorField = () => localStorage.getItem(METEOR_FIELD_STORAGE_KEY) !== "false";
const WorkspacePanel = lazy(() => import("./workspace/workspace-panel"));
const ProjectDashboard = lazy(() => import("./project/dashboard"));
const TerminalRoute = lazy(() => import("./remotes/terminal-route").then((module) => ({ default: module.TerminalRoute })));
const Settings = lazy(() => import("./settings/settings").then((module) => ({ default: module.Settings })));
const prefetchProjectDashboard = (project: Project) => void import("./project/dashboard").then((module) => module.prefetchProjectDashboard(project)).catch(() => {});
const prefetchTerminalRoute = () => void import("./remotes/terminal-route");
const prefetchWorkspaceTerminal = () => void import("./workspace/workspace-panel");

function NativeServerSetup(props: { onAuthenticated: () => void }) {
  const [address, setAddress] = createSignal(configuredServerOrigin() || "");
  const [verifiedOrigin, setVerifiedOrigin] = createSignal(configuredServerOrigin());
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      if (!verifiedOrigin()) {
        const origin = normalizeServerOrigin(address());
        const response = await fetch(buildHttpUrl("/healthz", origin), { cache: "no-store" });
        const health = response.ok ? await response.json() as { ok?: boolean } : null;
        if (!response.ok || !health?.ok) throw new Error(`Server health check failed (${response.status}).`);
        saveServerOrigin(origin);
        setAddress(origin);
        setVerifiedOrigin(origin);
        return;
      }
      const response = await fetch(buildHttpUrl("/v0/auth/native-login", verifiedOrigin()!), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ password: password() }),
      });
      const body = await response.json().catch(() => ({})) as { token?: string; message?: string };
      if (!response.ok || !body.token) throw new Error(body.message || "Could not sign in.");
      await saveNativeBearerToken(body.token);
      props.onAuthenticated();
    } catch (cause) {
      setError(cause instanceof TypeError
        ? "Could not reach this Conduit server. Check Tailscale, HTTPS, and the server address."
        : (cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  };
  return <main class="native-server-setup">
    <form class="native-server-card" onSubmit={submit}>
      <span class="native-server-brand">Conduit</span>
      <h1>Connect to your server</h1>
      <p>{verifiedOrigin() ? "Server confirmed. Enter your Conduit password." : "Enter the HTTPS address for your Conduit server."}</p>
      <label for="native-server-address">Server address</label>
      <input id="native-server-address" type="text" inputMode="url" autocomplete="url" autocapitalize="none" spellcheck={false}
        placeholder="https://conduit.your-tailnet.ts.net" value={address()} onInput={(event) => setAddress(event.currentTarget.value)}
        disabled={submitting() || Boolean(verifiedOrigin())} />
      <Show when={verifiedOrigin()}>
        <label for="native-password">Password</label>
        <input id="native-password" type="password" autocomplete="current-password" value={password()}
          onInput={(event) => setPassword(event.currentTarget.value)} disabled={submitting()} autofocus />
      </Show>
      <Show when={error()}><p class="native-server-error" role="alert">{error()}</p></Show>
      <Button type="submit" disabled={submitting() || Boolean(verifiedOrigin() && !password())}>
        {submitting() ? (verifiedOrigin() ? "Signing in…" : "Checking…") : (verifiedOrigin() ? "Sign in" : "Connect")}
      </Button>
      <Show when={verifiedOrigin()}><Button type="button" variant="ghost" onClick={() => {
        void clearNativeBearerToken().finally(() => {
          clearServerOrigin();
          setVerifiedOrigin(null);
          setPassword("");
          setError("");
        });
      }}>Change server</Button></Show>
    </form>
  </main>;
}

function NativeRoot() {
  const [state, setState] = createSignal<"loading" | "login" | "app">("loading");
  onMount(() => {
    const requireLogin = () => setState("login");
    window.addEventListener(NATIVE_AUTH_REQUIRED_EVENT, requireLogin);
    onCleanup(() => window.removeEventListener(NATIVE_AUTH_REQUIRED_EVENT, requireLogin));
    void nativeBearerToken().then(async (token) => {
      const origin = configuredServerOrigin();
      if (!token || !origin) return setState("login");
      try {
        const response = await authorizedFetch(buildHttpUrl("/v0/auth/status", origin));
        setState(response.status === 401 ? "login" : "app");
      } catch {
        setState("app");
      }
    }).catch(() => setState("login"));
  });
  return <Show when={state() !== "loading"} fallback={<main class="native-server-setup"><span class="native-server-brand">Conduit</span></main>}>
    {state() === "app" ? <App /> : <NativeServerSetup onAuthenticated={() => setState("app")} />}
  </Show>;
}

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
  onNewChat: () => void;
  onOpenPalette: () => void;
  onOpenSearch: () => void;
  onTogglePanel: () => void;
  onShare: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onUpdatePwa: () => void;
  pwaUpdating: () => boolean;
  dashboard?: boolean;
  appDashboard?: boolean;
}) {
  const [composerSurface, setComposerSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  const projectLabel = () => props.appDashboard ? "Conduit" : props.project?.slug === "chat" ? "Chats" : props.project?.slug || props.project?.name || "Chats";
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
  const contextPercent = () => {
    const value = props.chat ? contextUsagePercent(props.chat.contextUsage()) : null;
    return value == null ? 0 : Math.max(0, Math.min(100, value));
  };
  const contextTone = () => {
    const value = contextPercent();
    if (value >= 90) return "critical";
    if (value >= 70) return "warning";
    return "normal";
  };
  const contextLabel = () => {
    const value = contextPercent();
    return `Context usage: ${Math.round(value)}%`;
  };
  const contextDashArray = () => `${contextPercent() || 0} 100`;
  const dictationLabel = () => props.composerStatus?.dictationLabel() || "";
  const dictating = () => Boolean(props.composerStatus?.dictating());
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
  const recording = () => Boolean(props.composerStatus?.recording());
  const activityKind = () => activity()?.kind || (props.connectivity === "offline" ? "runtime_failed" : "idle");
  const statusBusy = () => dictating() || SPINNING_ACTIVITY.has(activityKind()) || ["connecting", "reconnecting"].includes(props.connectivity || "");
  const statusFailure = () => props.connectivity === "offline" || ["request_failed", "runtime_failed"].includes(activityKind());
  const statusTone = () => statusFailure() ? "error" : recording() ? "listening" : dictating() ? "active" : statusBusy() ? "active" : "ready";
  const waveformHistory = () => props.composerStatus?.waveform.history() || [];
  const waveformLevel = () => props.composerStatus?.waveform.level() || 0;
  const waveformPeak = () => props.composerStatus?.waveform.peak() || 0;
  const waveformState = () => props.composerStatus?.recorderMonitorState() || "stopped";
  onMount(() => {
    const syncComposerSurface = (event: Event) => setComposerSurface((event as CustomEvent<ComposerSurfaceMode>).detail);
    window.addEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncComposerSurface);
    onCleanup(() => window.removeEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncComposerSurface));
  });
  return <>
    <header class="chat-header">
      <Show when={!props.mobileSidebarOpen}>
        <div class="mobile-header-leading">
          <Button variant="ghost" size="icon-sm" class="mobile-sidebar-trigger" data-mobile-open="false" aria-label="Toggle Sidebar" aria-expanded={false} onClick={props.onToggleMobileSidebar}><PanelLeftIcon /></Button>
          <Button variant="ghost" size="icon-sm" class="mobile-new-chat-trigger" aria-label="New chat" title="New chat" onClick={props.onNewChat}><MessageSquarePlusIcon /></Button>
        </div>
      </Show>
      <nav aria-label="breadcrumb" class="chat-header-title"><span>{projectLabel()}</span><span class="breadcrumb-separator" aria-hidden="true" /><strong>{props.title}</strong></nav>
      <Show when={!props.dashboard && props.chat}>
        <span class="chat-status-line" data-state={statusTone()} role="status" aria-label={`Runtime status: ${statusLabel()}`} aria-live="polite">
          <Show when={recording()} fallback={<span class="chat-status-label">{statusLabel()}</span>}>
            <VoiceWaveform class="chat-status-waveform" history={waveformHistory} level={waveformLevel} peak={waveformPeak} state={waveformState()} variant="compact" barDensity={3} ariaLabel="Microphone input level" />
          </Show>
        </span>
      </Show>
      <HeaderActions composerSurface={composerSurface()}>
        <Button variant="ghost" size="icon-sm" class="search-trigger" aria-label="Search chats" title="Search chats" onClick={props.onOpenSearch}><SearchIcon /></Button>
        <Button variant="ghost" size="icon-sm" class="palette-trigger" aria-label="Open command palette" title="Command palette" onClick={props.onOpenPalette}><TerminalIcon /></Button>
        <Show when={!props.appDashboard}>
          <Button variant="ghost" size="icon-sm" class="chat-header-desktop-action" aria-label={props.dashboard ? "Copy Tailscale workspace link" : "Copy Tailscale chat link"} title={props.dashboard ? "Copy Tailscale workspace link" : "Copy Tailscale chat link"} onClick={props.onShare}><ShareIcon /></Button>
        </Show>
        <Show when={!props.dashboard && props.chat}>
          <Menu modal={false}>
            <MenuTrigger class="chat-context-trigger" data-state={contextTone()} aria-label={contextLabel()} title={contextLabel()}>
              <svg class="chat-context-gauge" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="chat-context-gauge-track" cx="12" cy="12" r="9" pathLength="100" />
                <circle class="chat-context-gauge-value" cx="12" cy="12" r="9" pathLength="100" style={`stroke-dasharray: ${contextDashArray()}`} />
              </svg>
            </MenuTrigger>
            <MenuContent class="chat-context-menu">
              <Show when={line()}>
                <MenuGroup>
                  <MenuLabel class="chat-context-menu-meta">{line()}</MenuLabel>
                </MenuGroup>
                <MenuSeparator />
              </Show>
              <MenuGroup aria-label="Context metrics">
                <MenuLabel>Context metrics</MenuLabel>
                <div class="chat-context-menu-values">{contextDetail() || "No context metrics selected."}</div>
              </MenuGroup>
            </MenuContent>
          </Menu>
        </Show>
        <Button variant="ghost" size="icon-sm" class="chat-header-desktop-action" aria-label="Toggle workspace panel" aria-expanded={props.panelOpen} onClick={props.onTogglePanel}><PanelRightIcon /></Button>
        <Show when={!props.appDashboard}><Menu modal={false}>
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
            <Show when={!props.dashboard && !nativeApp}>
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
        </Menu></Show>
      </HeaderActions>
    </header>
  </>;
}

function HeaderActions(props: { composerSurface: ComposerSurfaceMode; children: JSX.Element }) {
  return <div class="chat-header-actions composer-surface-material" data-composer-surface={props.composerSurface}>
    {props.children}
  </div>;
}

function App() {
  const logout = async () => {
    if (nativeApp) {
      try { await authorizedFetch(logoutUrl(), { method: "POST" }); } catch {}
      await clearNativeBearerToken();
      window.dispatchEvent(new Event(NATIVE_AUTH_REQUIRED_EVENT));
      return;
    }
    await fetch(logoutUrl(), { method: "POST" }).finally(() => { location.href = loginUrl(); });
  };
  const shortcutManager = new ShortcutManager({
    commands: commandRegistry,
    environment: browserShortcutEnvironmentProvider.detect(),
  });
  const catalogue = createCatalogueStore();
  const workspacePanelScope = createMemo(() => catalogue.projectId() ? `project:${catalogue.projectId()}` : null);
  const workspacePanelStateKey = (state: "open" | "expanded") => {
    const scope = workspacePanelScope();
    return scope ? `conduit:workspace-panel:${scope}:${state}` : null;
  };
  const [templates, setTemplates] = createSignal<Template[]>([]);
  const [templatesLoading, setTemplatesLoading] = createSignal(true);
  const [installations, setInstallations] = createSignal<Installation[]>([]);
  const [installationsLoading, setInstallationsLoading] = createSignal(true);
  const [workspaceSuggestions, setWorkspaceSuggestions] = createSignal<WorkspaceSuggestion[]>([]);
  const [workspacePolicy, setWorkspacePolicy] = createSignal<WorkspacePolicy | null>(null);
  const [defaultTemplateId, setDefaultTemplateId] = createSignal("chat");
  const [voiceSettings, setVoiceSettings] = createSignal<VoiceDictationSettings>(loadVoiceDictationSettings());
  const updateVoiceSettings = (next: VoiceDictationSettings) => setVoiceSettings(saveVoiceDictationSettings(next));
  const [partialContinue, setPartialContinue] = createSignal(true);
  const [maxAttachmentBytes, setMaxAttachmentBytes] = createSignal(DEFAULT_MAX_ATTACHMENT_BYTES);
  const [markdownRenderer, setMarkdownRenderer] = createSignal<MarkdownRendererId>(selectedMarkdownRenderer());
  const [rendererControlsVisible, setRendererControlsVisible] = createSignal(selectedRendererControlsVisible());
  const [meteorField, setMeteorField] = createSignal(selectedMeteorField());
  const [sidebarChatLimit, setSidebarChatLimit] = createSignal(selectedSidebarChatLimit());
  const chatSort = useChatSort();
  const [contextMetrics, setContextMetrics] = createSignal<ContextMetricId[]>(selectedContextMetrics());
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [sidebarPins, setSidebarPins] = createSignal<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = createSignal(false);
  const [settingsSection, setSettingsSection] = createSignal<SettingsSection>("models");
  const [settingsWorkspaceId, setSettingsWorkspaceId] = createSignal<string | null>(null);
  const [workspaceIdentityId, setWorkspaceIdentityId] = createSignal<string | null>(null);
  const [workspaceIdentitySaving, setWorkspaceIdentitySaving] = createSignal(false);
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const [palettePage, setPalettePage] = createSignal<string | null>(null);
  const [paletteDirectLaunch, setPaletteDirectLaunch] = createSignal(false);
  const [paletteInitialQuery, setPaletteInitialQuery] = createSignal("");
  const [paletteNonce, setPaletteNonce] = createSignal(0);
  const [sidebarCommand, setSidebarCommand] = createSignal<SidebarCommand | null>(null);
  const [dropActive, setDropActive] = createSignal(false);
  const [panelOpen, setPanelOpen] = createSignal(false);
  const [workspaceExpanded, setWorkspaceExpandedState] = createSignal(false);
  const releaseExpansionWidth = () => {
    if (!workspaceExpanded()) document.querySelector<HTMLElement>(".transcript-motion-shell")?.style.removeProperty("--workspace-transcript-width");
  };
  const setWorkspaceExpanded = (next: boolean, persist = true) => {
    const key = workspacePanelStateKey("expanded");
    if (persist && key) localStorage.setItem(key, String(next));
    if (next === workspaceExpanded()) return;
    if (next && !isMobileLayout()) {
      const shell = document.querySelector<HTMLElement>(".transcript-motion-shell");
      if (shell && !shell.style.getPropertyValue("--workspace-transcript-width")) {
        shell.style.setProperty("--workspace-transcript-width", `${shell.getBoundingClientRect().width}px`);
      }
    }
    setWorkspaceExpandedState(next);
    requestAnimationFrame(() => {
      // Instant geometry changes (close, reduced motion) have no transitionend.
      if (!document.querySelector(".workspace-panel")?.getAnimations().length) releaseExpansionWidth();
    });
  };
  const [workspaceViewRequest, setWorkspaceViewRequest] = createSignal<{ tab: WorkspaceView; terminalId?: string; nonce: number } | null>(null);
  const [workspaceFocusRequest, setWorkspaceFocusRequest] = createSignal(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);
  const initialRouteId = pathChatId();
  const initialProjectRouteId = pathProjectId();
  const initialTerminalRoute = location.pathname === "/terminal";
  const initialDashboardRoute = location.pathname === "/";
  const [routeKind, setRouteKind] = createSignal<"chat" | "project" | "dashboard" | "terminal">(
    initialTerminalRoute ? "terminal" : initialDashboardRoute ? "dashboard" : initialProjectRouteId ? "project" : "chat",
  );
  const [routeBootstrap, setRouteBootstrap] = createSignal<"loading" | "ready" | "error">("loading");
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
      showError(error);
    }
  };
  const runPwaCacheReset = async () => {
    if (pwaUpdating()) return;
    setPwaUpdating(true);
    try {
      await resetPwaAppCache();
    } catch (error) {
      setPwaUpdating(false);
      showError(error);
    }
  };
  const runtime = createRuntimeStore();
  let hasConnected = false;
  createEffect(() => {
    if (runtime.connectivity() !== "online") return;
    if (hasConnected) void checkForPwaUpdate().catch(() => {});
    hasConnected = true;
  });
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
    catalogue.setProjects((current) => current.map((project) => project.id === workspaceId ? { ...project, ...saved, sessions: project.sessions } : project));
    return saved;
  };

  const saveWorkspaceAppearance = async (workspaceId: string, workspaceAppearance: WorkspaceAppearance) => {
    const saved = await api<Project>(`/v0/projects/${encodeURIComponent(workspaceId)}`, { method: "PATCH", body: JSON.stringify({ workspaceAppearance }) });
    catalogue.setProjects((current) => current.map((project) => project.id === workspaceId ? { ...project, ...saved, sessions: project.sessions } : project));
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

  const chat = createActiveChat({
    catalogue,
    runtime,
    models,
    attachments,
    onError: showError,
    onModelRecovered: ({ from, to }) => toast.warning(`This chat's previous model ${from} is no longer scoped. It resumed with ${to}.`, {
      id: "model-scope-recovery",
      duration: 6_000,
    }),
    defaultTemplateId,
    saveWorkspaceDefault,
  });
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
    const openKey = workspacePanelStateKey("open");
    const expandedKey = workspacePanelStateKey("expanded");
    if (!openKey || !expandedKey) return;
    setPanelOpen(localStorage.getItem(openKey) === "true");
    setWorkspaceExpanded(localStorage.getItem(expandedKey) === "true", false);
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
    if (!next && document.activeElement instanceof HTMLElement && document.activeElement.closest(".workspace-panel")) {
      document.querySelector<HTMLElement>(".chat-header [aria-label='Toggle workspace panel']")?.focus({ preventScroll: true });
    }
    const key = workspacePanelStateKey("open");
    if (!next) setWorkspaceExpanded(false);
    setPanelOpen(next);
    if (key) localStorage.setItem(key, String(next));
  };

  /** Phone overlays are exclusive: opening one closes the other. */
  const setMobileSidebar = (open: boolean) => {
    if (open && panelOpen() && isMobileLayout()) setPanelOpenForChat(false);
    setMobileSidebarOpen(open);
  };

  onMount(() => {
    let swipe: { id: number; x: number; y: number } | null = null;
    const start = (event: TouchEvent) => {
      if (!isMobileLayout() || event.touches.length !== 1) return;
      if (event.target instanceof Element && event.target.closest("[data-mobile-swipe-ignore]")) return;
      const touch = event.touches[0]!;
      swipe = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    };
    const end = (event: TouchEvent) => {
      const touch = swipe && [...event.changedTouches].find((item) => item.identifier === swipe!.id);
      if (!swipe || !touch) return;
      const action = mobileSwipeAction({
        startX: swipe.x,
        startY: swipe.y,
        endX: touch.clientX,
        endY: touch.clientY,
        sidebarOpen: mobileSidebarOpen(),
        workspaceOpen: panelOpen(),
      });
      swipe = null;
      if (action === "open-sidebar") setMobileSidebar(true);
      else if (action === "close-sidebar") setMobileSidebar(false);
      else if (action === "open-workspace" && workspacePanelScope()) {
        setMobileSidebar(false);
        setPanelOpenForChat(true);
      } else if (action === "close-workspace") setPanelOpenForChat(false);
    };
    const cancel = () => { swipe = null; };
    window.addEventListener("touchstart", start, { passive: true });
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", cancel, { passive: true });
    onCleanup(() => {
      window.removeEventListener("touchstart", start);
      window.removeEventListener("touchend", end);
      window.removeEventListener("touchcancel", cancel);
    });
  });

  const currentDraftId = () => chat.status() === "draft" ? catalogue.selectedId() : null;

  const discardDraft = async (id = currentDraftId()) => {
    if (id) await api(`/v0/chats/${encodeURIComponent(id)}?ifEmpty=true`, { method: "DELETE" });
  };

  const createChat = async (target?: Project, launch: { templateId?: string; runtimeKind?: string } = {}, options: { reportFailure?: boolean } = {}) => {
    const reportFailure = options.reportFailure !== false;
    const project = target || selectedProject() || catalogue.projects().find((item) => item.slug === "chat") || catalogue.projects()[0];
    if (!project) return null;
    const replacedDraftId = currentDraftId();
    const fromDashboard = routeKind() === "project" || routeKind() === "dashboard";
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

  let dashboardDraftRequest: Promise<void> | null = null;
  const ensureDashboardDraft = () => {
    const route = routeKind();
    if (dashboardDraftRequest || !["dashboard", "project"].includes(route) || chat.loadedId() || templatesLoading()) return;
    const project = route === "project"
      ? selectedProject()
      : catalogue.projects().find((item) => item.slug === "chat") || catalogue.projects()[0];
    if (!project || project.state === "cloning") return;
    const hostDefault = project.defaultTemplateId === "host-pi";
    const templateId = hostDefault ? defaultTemplateId() || "chat" : project.defaultTemplateId || defaultTemplateId() || "chat";
    const expectedRoute = route;
    const expectedProjectId = project.id;
    let scopeChanged = false;
    dashboardDraftRequest = api<ChatSummary>("/v0/chats", {
      method: "POST",
      body: JSON.stringify(hostDefault
        ? { projectId: project.id }
        : { projectId: project.id, templateId, runtimeKind: "conduit_profile" }),
    }).then(async (created) => {
      if (routeKind() !== expectedRoute || (expectedRoute === "project" && selectedProject()?.id !== expectedProjectId)) {
        scopeChanged = true;
        await api(`/v0/chats/${encodeURIComponent(created.id)}?ifEmpty=true`, { method: "DELETE" });
        return;
      }
      chat.initialize({ ...created, templateId: created.templateId || templateId }, project);
    }).catch((error) => { showError(error); }).finally(() => {
      dashboardDraftRequest = null;
      if (scopeChanged) ensureDashboardDraft();
    });
  };

  createEffect(() => {
    routeKind();
    chat.loadedId();
    templatesLoading();
    catalogue.projects();
    ensureDashboardDraft();
  });

  const openDashboard = (historyMode: "push" | "replace" | "none" = "push") => {
    chat.reset();
    const chatRoot = catalogue.projects().find((project) => project.slug === "chat");
    if (chatRoot) catalogue.selectProject(chatRoot);
    setMobileSidebarOpen(false);
    setRouteKind("dashboard");
    setRouteBootstrapError("");
    setRouteBootstrap("ready");
    if (historyMode === "push") history.pushState({}, "", "/");
    else if (historyMode === "replace") history.replaceState({}, "", "/");
  };

  const openTerminalRoute = (historyMode: "push" | "replace" | "none" = "push") => {
    setPanelOpenForChat(false);
    setMobileSidebarOpen(false);
    setRouteKind("terminal");
    setRouteBootstrapError("");
    setRouteBootstrap("ready");
    if (historyMode === "push") history.pushState({}, "", "/terminal");
    else if (historyMode === "replace") history.replaceState({}, "", "/terminal");
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
  const openProjectWithMaximizedWorkspace = (target: Project) => {
    void openProject(target);
    setPanelOpenForChat(true);
    setWorkspaceExpanded(true);
  };

  const focusChatSurface = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(".composer,button,a,input,textarea,select,[contenteditable='true'],[role='button'],[role='link'],[role='option']")) return;
    if (!(event.currentTarget instanceof HTMLElement)) return;
    event.currentTarget.focus({ preventScroll: true });
  };
  const hasComposer = () => Boolean(document.querySelector(".composer textarea:not([disabled])"));
  const focusComposer = () => {
    document.querySelector<HTMLTextAreaElement>(".composer textarea:not([disabled])")?.focus({ preventScroll: true });
  };
  const focusChatPane = () => {
    const target = document.querySelector<HTMLElement>('.chat-main[data-shortcut-scope="chat"]');
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
    focusComposer();
  };
  const focusWorkspacePanel = () => {
    if (!workspacePanelScope()) return;
    if (isMobileLayout()) setMobileSidebarOpen(false);
    if (!panelOpen()) setPanelOpenForChat(true);
    setWorkspaceFocusRequest((request) => request + 1);
  };
  const toggleChatWorkspaceFocus = () => {
    const inWorkspacePanel = document.activeElement instanceof Element && Boolean(document.activeElement.closest('[data-shortcut-scope="workspace-panel"]'));
    if (inWorkspacePanel) focusChatPane();
    else if (panelOpen()) focusWorkspacePanel();
    else focusChatPane();
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
  const autoNameChat = async () => {
    const id = catalogue.selectedId();
    if (!id) return;
    try {
      const saved = await api<ChatSummary>(`/v0/sessions/${id}/auto-name`, { method: "POST" });
      chat.setTitle(saved.title);
      await refresh();
      toast.success(`Renamed chat to ${saved.title}`);
    } catch (error) { showError(error); }
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
    try { const response = await authorizedFetch(transcriptUrl(target.id)); if (!response.ok) throw new Error("Could not load the transcript"); await navigator.clipboard.writeText(await response.text()); }
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
    setSettingsLoaded(true);
    setSettingsOpen(true);
  };
  const switchMarkdownRenderer = (next: MarkdownRendererId) => setMarkdownRenderer(saveMarkdownRenderer(next));
  const switchRendererControlsVisible = (visible: boolean) => setRendererControlsVisible(saveRendererControlsVisible(visible));
  const switchMeteorField = (enabled: boolean) => {
    setMeteorField(enabled);
    localStorage.setItem(METEOR_FIELD_STORAGE_KEY, String(enabled));
    publishUiPreference("meteorField", enabled);
  };
  const switchSidebarChatLimit = (next: number) => {
    const value = clampSidebarChatLimit(next);
    setSidebarChatLimit(value);
    localStorage.setItem(SIDEBAR_CHAT_LIMIT_STORAGE_KEY, String(value));
    publishUiPreference("sidebarChatLimit", value);
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
  const openModelSelector = () => {
    if (paletteOpen() && palettePage() === "model-selector") setPaletteOpen(false);
    else openPalette("model-selector", "", true);
  };
  // Closing drops the maximised flag so reopening always lands docked; without
  // that, "closed -> toggle" would reopen full width and the two shortcuts
  // could no longer reach all three states predictably.
  const closePanel = () => {
    if (!panelOpen()) return;
    setPanelOpenForChat(false);
    setWorkspaceExpanded(false);
  };
  const togglePanel = () => {
    if (panelOpen() && workspaceExpanded()) {
      setWorkspaceExpanded(false);
      focusWorkspacePanel();
      return;
    }
    if (panelOpen()) closePanel();
    else focusWorkspacePanel();
  };
  const maximizeWorkspacePanel = () => {
    if (!workspacePanelScope()) return;
    if (panelOpen() && workspaceExpanded()) {
      closePanel();
      return;
    }
    setWorkspaceExpanded(true);
    focusWorkspacePanel();
  };
  const openWorkspaceView = (view: WorkspaceView, terminalId?: string) => {
    if (!workspacePanelScope()) return;
    setWorkspaceViewRequest({ tab: view, ...(terminalId ? { terminalId } : {}), nonce: Date.now() });
    if (isMobileLayout()) setMobileSidebarOpen(false);
    setPanelOpenForChat(true);
  };
  const toggleWorkspaceExpanded = () => {
    const next = !workspaceExpanded();
    setWorkspaceExpanded(next);
    if (next) focusWorkspacePanel();
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
  const runSidebar = (type: string, target: Omit<SidebarCommand, "type" | "nonce"> = {}) => setSidebarCommand({ type, nonce: Date.now(), ...target });
  const pinRef = (type: "chat" | "project" | "terminal", id: string) => `${type}:${id}`;
  const isSidebarPinned = (type: "chat" | "project" | "terminal", id: string) => sidebarPins().includes(pinRef(type, id));
  const toggleSidebarPin = async (type: "chat" | "project" | "terminal", id: string) => {
    const ref = pinRef(type, id);
    const previous = sidebarPins();
    const next = previous.includes(ref) ? previous.filter((item) => item !== ref) : [...previous, ref];
    setSidebarPins(next);
    try {
      const saved = await api<{ sidebarPins?: unknown }>("/v0/preferences", { method: "PATCH", body: JSON.stringify({ sidebarPins: next }) });
      if (Array.isArray(saved.sidebarPins)) setSidebarPins(saved.sidebarPins.filter((item): item is string => typeof item === "string"));
    } catch (error) {
      setSidebarPins(previous);
      showError(error);
    }
  };
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
    nativeApp,
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
    chatSort: chatSort(),
  }));

  const paletteActions: PaletteActions = {
    logout: () => { void logout(); },
    newChat: (project, launch) => void createChat(project ?? undefined, launch ?? {}),
    newFolder: () => runSidebar("new-folder"),
    newWorkspace: () => runSidebar("new-workspace"),
    openRuntimeChat: () => void createChat(undefined, { templateId: "runtime" }),
    attach: () => attachFileInput?.click(),
    toggleDictation: () => window.dispatchEvent(new Event("conduit:toggle-dictation")),
    toggleSidebar: () => runSidebar("toggle-sidebar"),
    toggleWorkspacePanel: togglePanel,
    maximizeWorkspacePanel,
    focusComposer,
    focusWorkspacePanel,
    toggleChatWorkspaceFocus,
    openWorkspaceView,
    copyTranscript: () => { const id = catalogue.selectedId(); if (id) void copyTranscript({ id } as ChatSummary); },
    rename: () => runSidebar("rename-chat"),
    autoName: () => void autoNameChat(),
    move: () => runSidebar("move-chat"),
    renameFolder: () => runSidebar("rename-folder"),
    stop: () => chat.stop(),
    regenerate: () => { const id = lastUserEntryId(); if (id) void chat.regenerate(id); },
    continue: () => void chat.continueResponse(),
    copy: () => { const content = lastAssistant()?.content; if (content) void navigator.clipboard.writeText(content); },
    retryConnection: () => runtime.retry(),
    reload: () => location.reload(),
    updateApp: () => void runPwaUpdate(),
    resetAppCache: () => void runPwaCacheReset(),
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
      if (mobileSidebarOpen()) { event.preventDefault(); setMobileSidebarOpen(false); return; }
    }
  };

  onMount(() => {
    let hydratingUiPreferences = false;
    let preferenceSave = Promise.resolve<unknown>(undefined);
    const persistUiPreference = (event: Event) => {
      if (hydratingUiPreferences) return;
      const detail = (event as CustomEvent<{ key?: UiPreferenceKey; value?: UiPreferences[UiPreferenceKey] }>).detail;
      if (!detail?.key) return;
      preferenceSave = preferenceSave
        .then(() => saveUiPreference(detail.key!, detail.value!))
        .catch((error) => { showError(error); });
    };
    window.addEventListener(UI_PREFERENCE_CHANGE_EVENT, persistUiPreference);
    onCleanup(() => window.removeEventListener(UI_PREFERENCE_CHANGE_EVENT, persistUiPreference));

    const localVoice = loadVoiceDictationSettings();
    const parseStringArray = (key: string) => {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    };
    const localPreferences: UiPreferences = {
      sidebarChatLimit: selectedSidebarChatLimit(),
      collapsedProjectIds: parseStringArray("conduit.sidebar.collapsed-projects"),
      sidebarCollapsed: localStorage.getItem("conduit.sidebar") === "collapsed",
      markdownRenderer: localStorage.getItem(MARKDOWN_RENDERER_STORAGE_KEY) || selectedMarkdownRenderer(),
      rendererControlsVisible: selectedRendererControlsVisible(),
      composerSurface: selectedComposerSurface(),
      contextMetrics: selectedContextMetrics(),
      meteorField: selectedMeteorField(),
      incremarkPacing: localStorage.getItem(INCREMARK_PACING_STORAGE_KEY) || "buffered",
      transcriptWidth: selectedTranscriptWidth(),
      transcriptWideBlocks: selectedTranscriptWideBlocks(),
      codeBlockCollapse: selectedCodeBlockCollapse(),
      codeBlockCollapseLines: selectedCodeBlockCollapseLines(),
      codeBlockWidth: selectedCodeBlockWidth(),
      panelMotion: selectedPanelMotion(),
      userMessageCollapse: selectedUserMessageCollapse(),
      chatSort: selectedChatSort(),
      shortcutOverrides: shortcutManager.shortcutOverrides(),
      sidebarPins: [],
      voicePreferences: {
        shortcut: localVoice.shortcut,
        activation: localVoice.activation,
        autoSend: localVoice.autoSend,
        captureProfile: localVoice.captureProfile,
      },
    };
    const storageKeys: Partial<Record<UiPreferenceKey, string>> = {
      sidebarChatLimit: SIDEBAR_CHAT_LIMIT_STORAGE_KEY,
      collapsedProjectIds: "conduit.sidebar.collapsed-projects",
      sidebarCollapsed: "conduit.sidebar",
      markdownRenderer: MARKDOWN_RENDERER_STORAGE_KEY,
      rendererControlsVisible: RENDERER_CONTROLS_VISIBLE_STORAGE_KEY,
      composerSurface: COMPOSER_SURFACE_STORAGE_KEY,
      contextMetrics: CONTEXT_METRIC_STORAGE_KEY,
      meteorField: METEOR_FIELD_STORAGE_KEY,
      incremarkPacing: INCREMARK_PACING_STORAGE_KEY,
      transcriptWidth: TRANSCRIPT_WIDTH_STORAGE_KEY,
      transcriptWideBlocks: TRANSCRIPT_WIDE_BLOCKS_STORAGE_KEY,
      codeBlockCollapse: CODE_BLOCK_COLLAPSE_STORAGE_KEY,
      codeBlockCollapseLines: CODE_BLOCK_COLLAPSE_LINES_STORAGE_KEY,
      codeBlockWidth: CODE_BLOCK_WIDTH_STORAGE_KEY,
      panelMotion: PANEL_MOTION_STORAGE_KEY,
      userMessageCollapse: USER_MESSAGE_COLLAPSE_STORAGE_KEY,
      chatSort: CHAT_SORT_STORAGE_KEY,
    };
    // A URL override is a deliberate per-tab experiment, and server preferences
    // arrive after first paint. Applying one here silently undid the override,
    // which is why only markdownRenderer used to survive a reload with a query
    // string on it. Storage still mirrors the server; only the applied value is
    // held back.
    const overrideParams = new URLSearchParams(location.search);
    const overridden = (key: UiPreferenceKey) => overrideParams.has(key);
    const applyPreference = (key: UiPreferenceKey, value: UiPreferences[UiPreferenceKey]) => {
      const storageKey = storageKeys[key];
      if (storageKey) localStorage.setItem(storageKey, key === "sidebarCollapsed"
        ? value ? "collapsed" : "expanded"
        : Array.isArray(value) ? JSON.stringify(value) : String(value));
      if (key === "sidebarChatLimit" && typeof value === "number") setSidebarChatLimit(clampSidebarChatLimit(value));
      else if (key === "sidebarPins" && Array.isArray(value)) setSidebarPins(value.filter((item): item is string => typeof item === "string"));
      else if (key === "markdownRenderer" && typeof value === "string" && !overridden(key)) setMarkdownRenderer(value as MarkdownRendererId);
      else if (key === "rendererControlsVisible" && typeof value === "boolean") setRendererControlsVisible(value);
      else if (key === "contextMetrics" && Array.isArray(value)) setContextMetrics(selectedContextMetrics());
      else if (key === "meteorField" && typeof value === "boolean") setMeteorField(value);
      else if (key === "transcriptWidth" && isTranscriptWidthMode(value) && !overridden(key)) applyTranscriptAppearance({ width: value });
      else if (key === "transcriptWideBlocks" && isTranscriptWideBlocksMode(value) && !overridden(key)) applyTranscriptAppearance({ wideBlocks: value });
      else if (key === "codeBlockCollapse" && isCodeBlockCollapseMode(value) && !overridden(key)) applyTranscriptAppearance({ collapse: value });
      else if (key === "codeBlockCollapseLines" && isCodeBlockCollapseLines(value) && !overridden(key)) applyTranscriptAppearance({ collapseLines: value });
      else if (key === "codeBlockWidth" && isCodeBlockWidthMode(value) && !overridden(key)) applyTranscriptAppearance({ codeWidth: value });
      else if (key === "panelMotion" && isPanelMotionMode(value) && !overridden(key)) publishUiPreference("panelMotion", value);
      else if (key === "userMessageCollapse" && isUserMessageCollapseMode(value) && !overridden(key)) applyTranscriptAppearance({ userMessageCollapse: value });
      else if (key === "shortcutOverrides" && value && typeof value === "object" && !Array.isArray(value)) {
        shortcutManager.replaceOverrides(value as ReturnType<ShortcutManager["shortcutOverrides"]>);
      } else if (key === "voicePreferences" && value && typeof value === "object" && !Array.isArray(value)) {
        const next = { ...localVoice, ...value } as VoiceDictationSettings;
        localStorage.setItem(VOICE_DICTATION_STORAGE_KEY, JSON.stringify(next));
        setVoiceSettings(next);
      }
      window.dispatchEvent(new CustomEvent(UI_PREFERENCE_CHANGE_EVENT, { detail: { key, value } }));
      if (key === "composerSurface") {
        window.dispatchEvent(new CustomEvent(COMPOSER_SURFACE_CHANGE_EVENT, { detail: value }));
      }
    };
    void api<UiPreferences>("/v0/preferences").then(async (serverPreferences) => {
      setSidebarPins(Array.isArray(serverPreferences.sidebarPins) ? serverPreferences.sidebarPins : []);
      const migration: Partial<UiPreferences> = {};
      hydratingUiPreferences = true;
      try {
        for (const key of Object.keys(localPreferences) as UiPreferenceKey[]) {
          const value = serverPreferences[key] == null ? localPreferences[key] : serverPreferences[key];
          if (serverPreferences[key] === null) Object.assign(migration, { [key]: value });
          applyPreference(key, value as never);
        }
      } finally {
        hydratingUiPreferences = false;
      }
      if (Object.keys(migration).length) {
        await api("/v0/preferences", { method: "PATCH", body: JSON.stringify(migration) });
      }
    }).catch((error) => showError(error));

    const releaseApplicationContext = shortcutManager.activateContext("application");
    const releaseShortcutHandlers = [
      shortcutManager.registerHandler(COMMAND_IDS.openCommandPalette, "application", () => {
        if (paletteOpen()) setPaletteOpen(false);
        else openPalette(null);
      }),
      shortcutManager.registerHandler(COMMAND_IDS.searchChats, "application", toggleSearchPalette),
      shortcutManager.registerHandler(COMMAND_IDS.openSettings, "application", () => openSettings("models")),
      shortcutManager.registerHandler(COMMAND_IDS.openModelSelector, "application", openModelSelector),
      shortcutManager.registerHandler(COMMAND_IDS.newChat, "application", () => {
        setMobileSidebarOpen(false);
        void createChat();
      }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleSidebar, "application", () => runSidebar("toggle-sidebar")),
      shortcutManager.registerHandler(COMMAND_IDS.toggleWorkspacePanel, "application", togglePanel),
      shortcutManager.registerHandler(COMMAND_IDS.maximizeWorkspacePanel, "application", maximizeWorkspacePanel),
      shortcutManager.registerHandler(COMMAND_IDS.focusComposer, "application", focusComposer, { when: hasComposer }),
      shortcutManager.registerHandler(COMMAND_IDS.focusComposer, "chat", focusComposer, { when: hasComposer }),
      shortcutManager.registerHandler(COMMAND_IDS.focusWorkspacePanel, "application", focusWorkspacePanel, { when: () => Boolean(workspacePanelScope()) }),
      shortcutManager.registerHandler(COMMAND_IDS.focusWorkspacePanel, "chat", focusWorkspacePanel, { when: () => Boolean(workspacePanelScope()) }),
      shortcutManager.registerHandler(COMMAND_IDS.focusWorkspacePanel, "composer", focusWorkspacePanel),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "application", toggleChatWorkspaceFocus, { when: () => Boolean(workspacePanelScope()) && hasComposer() }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "chat", toggleChatWorkspaceFocus, { when: () => Boolean(workspacePanelScope()) && hasComposer() }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "composer", toggleChatWorkspaceFocus),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "workspace-panel", toggleChatWorkspaceFocus),
    ];
    const uninstallShortcuts = shortcutManager.install(window);
    window.addEventListener("keydown", dismissOpenLayer, { capture: true });
    let releaseFocusedContext: (() => void) | undefined;
    const syncFocusedShortcutContext = (target: EventTarget | null) => {
      releaseFocusedContext?.();
      releaseFocusedContext = undefined;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-shortcut-scope="workspace-panel"]') && panelOpen()) {
        releaseFocusedContext = shortcutManager.activateContext("workspace-panel");
      } else if (target.closest(".composer")) {
        releaseFocusedContext = shortcutManager.activateContext("composer");
      } else if (target.closest('[data-shortcut-scope="chat"]')) {
        releaseFocusedContext = shortcutManager.activateContext("chat");
      }
    };
    const onFocusIn = (event: FocusEvent) => syncFocusedShortcutContext(event.target);
    window.addEventListener("focusin", onFocusIn);
    syncFocusedShortcutContext(document.activeElement);
    onCleanup(() => {
      window.removeEventListener("keydown", dismissOpenLayer, true);
      window.removeEventListener("focusin", onFocusIn);
      releaseFocusedContext?.();
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
        if (location.pathname === "/") {
          openDashboard("none");
          return;
        }
        if (location.pathname === "/terminal") {
          openTerminalRoute("none");
          return;
        }
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
      } else if (initialTerminalRoute) {
        setRouteKind("terminal");
        setRouteBootstrap("ready");
      } else if (initialDashboardRoute) {
        setRouteKind("dashboard");
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
      if (initialRouteId && (error as { error?: string }).error === "chat_not_found") {
        location.replace("/");
        return;
      }
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

  return <>
    <Toaster richColors />
    <input ref={attachFileInput} type="file" multiple hidden aria-hidden="true" onChange={(event) => { if (event.currentTarget.files) attachments.addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <Dialog open={Boolean(workspaceIdentityProject())} onOpenChange={(open) => { if (!open) closeWorkspaceIdentity(); }}>
      <DialogContent class="workspace-appearance-dialog" title="Workspace identity" description="Choose a short mark or a Lucide icon, then choose a preset or custom color.">
        <Show when={workspaceIdentityProject()}>{(project) => <WorkspaceAppearanceEditor compact value={project().workspaceAppearance} saving={workspaceIdentitySaving()} onSave={(appearance) => void saveWorkspaceIdentity(appearance)} />}</Show>
      </DialogContent>
    </Dialog>
    <Show when={routeKind() !== "terminal"}>
    <Sidebar projects={catalogue.projects()} projectId={catalogue.projectId()} selectedId={catalogue.selectedId()} dashboard={routeKind() === "dashboard"} runtime={runtime} chatLimit={sidebarChatLimit()}
      connectivity={runtime.connectivity()} workspaceSuggestions={workspaceSuggestions()} workspacePolicy={workspacePolicy()} command={sidebarCommand()}
      sidebarPins={sidebarPins()} onTogglePin={toggleSidebarPin}
      mobileOpen={mobileSidebarOpen()} onMobileOpenChange={setMobileSidebar}
      onWorkspaceSuggestionsNeeded={() => void loadWorkspaceSuggestions()}
      onNewChat={async (project) => { await createChat(project); }} onPrefetchChat={chat.prefetch} onOpenChat={openChat} onOpenProject={openProject} onAddProject={addProject} onRenameChat={renameChat} onRenameProject={renameProject}
      onOpenProjectMaximized={openProjectWithMaximizedWorkspace}
      onMoveChat={moveChat} onMoveChats={moveChats} onMoveProjectChats={moveProjectChats} onCopyTranscript={copyTranscript} onCopyChatLinks={copyChatLinks}
      onDeleteChat={deleteChat} onDeleteChats={deleteChats} onDeleteProject={deleteProject}
      onOpenTerminal={(target, project) => { void openChat(target, project).then(() => openWorkspaceView("terminal")); }}
      onOpenPty={(terminal) => {
        const project = catalogue.projects().find((item) => item.id === terminal.projectId);
        if (!project) return showError("The terminal scope is no longer available.");
        void createChat(project).then((created) => {
          if (created) openWorkspaceView("terminal", terminal.id);
        });
      }}
      onOpenDashboard={() => openDashboard()}
      onOpenWorkspaceIdentity={openWorkspaceIdentity} onOpenSettings={openSettings} onOpenPalette={(page, initialQuery) => openPalette(page || null, initialQuery || "", page === "chat-search")}
      onChangeServer={nativeApp ? () => { void clearNativeBearerToken().finally(() => { clearServerOrigin(); location.reload(); }); } : undefined}
      onLogout={() => void logout()} />
    <div class="workspace-layout" onTransitionEnd={(event) => {
      if (event.propertyName === "width" && event.target instanceof HTMLElement && event.target.classList.contains("workspace-panel")) releaseExpansionWidth();
    }}>
    <main data-slot="sidebar-inset" data-shortcut-scope="chat" tabIndex={-1} onPointerDown={focusChatSurface} class={`chat-main${routeKind() === "chat" && emptyChat() ? " chat-main-empty" : ""}${workspaceExpanded() ? " workspace-expanded" : ""}`} {...(routeKind() === "chat" ? dropHandlers : {})}>
      <Show when={routeBootstrap() === "ready"} fallback={<div class="chat-bootstrap" role={routeBootstrap() === "error" ? "alert" : "status"}>{routeBootstrap() === "error"
        ? routeBootstrapError() || (routeKind() === "project" ? "This project could not be loaded." : "This chat could not be loaded.")
        : routeKind() === "project" ? "Loading project…" : routeKind() === "dashboard" ? "Loading Conduit…" : "Loading chat…"}</div>}>
        <Show when={routeKind() === "dashboard"}>
          <ChatHeader title="Dashboard" panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void createChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} appDashboard />
          <AppDashboard
            projects={catalogue.projects()}
            composer={<Composer
              chat={chat}
              attachments={attachments}
              models={models}
              profiles={templates().filter((item) => item.defaultable !== false)}
              activeProfile={templates().find((item) => item.id === chat.templateId()) || templates().find((item) => item.id === defaultTemplateId()) || null}
              serverOnline={runtime.connectivity() === "online"}
              voiceSettings={voiceSettings()}
              onChooseProfile={(id) => chat.setTemplateId(id)}
              onOpenSettings={openSettings}
              onOpenAttachments={() => attachFileInput?.click()}
              onStatusChange={setComposerStatus}
              onSendDraft={async (prompt) => {
                const project = catalogue.projects().find((item) => item.slug === "chat");
                const id = chat.loadedId();
                if (!project || !id) return;
                catalogue.setProjects((current) => current.map((item) => item.id === project.id
                  ? { ...item, sessions: [{ id, projectId: project.id, status: "draft", title: chat.title() || "New chat", templateId: chat.templateId() || undefined, pinned: true }, ...item.sessions.filter((session) => session.id !== id)] }
                  : item));
                history.pushState({}, "", `/chat/${id}`);
                setRouteKind("chat");
                chat.setDraft(prompt);
                await chat.send();
              }}
            />}
            runtime={runtime}
            onOpenChat={(target, project) => void openChat(target, project)}
            onPrefetchChat={chat.prefetch}
            onOpenProject={(project) => void openProject(project)}
            onPrefetchProject={prefetchProjectDashboard}
            onContextAction={(type, target) => runSidebar(type, target)}
            isPinned={isSidebarPinned}
            onNewChat={(project) => void createChat(project)}
            onOpenWorkspaceIdentity={openWorkspaceIdentity}
            onOpenWorkspaceSettings={(project) => openSettings("workspaces", project.id)}
            onMoveProjectChats={(source, target) => void moveProjectChats(source, target)}
            onPrefetchTerminalView={prefetchTerminalRoute}
            onOpenTerminalView={() => openTerminalRoute()}
            onOpenChatTerminal={(target, project) => { void openChat(target, project).then(() => openWorkspaceView("terminal")); }}
            onSearchChats={(scope) => openPalette("chat-search", scope === "unscoped" ? "scope:chats " : "", true)}
            onOpenTerminal={(terminal) => {
              const project = catalogue.projects().find((item) => item.id === terminal.projectId);
              if (!project) return showError("The terminal scope is no longer available.");
              void createChat(project).then((created) => {
                if (created) openWorkspaceView("terminal", terminal.id);
              });
            }}
            onOpenTerminalMaximized={(terminal) => {
              const project = catalogue.projects().find((item) => item.id === terminal.projectId);
              if (!project) return showError("The terminal scope is no longer available.");
              void createChat(project).then((created) => {
                if (!created) return;
                openWorkspaceView("terminal", terminal.id);
                setWorkspaceExpanded(true);
              });
            }}
            onPrefetchTerminal={prefetchWorkspaceTerminal}
          />
        </Show>
        <Show when={routeKind() !== "dashboard"}>
        <Show when={routeKind() === "chat" && meteorField()}>
          <div class="chat-meteors" aria-hidden="true">
            <DefaultMeteorShower />
          </div>
        </Show>
        <Show when={routeKind() === "project" && selectedProject()} fallback={<>
          <Show when={dropActive()}><div class="chat-drop-overlay"><div>Drop files to attach</div></div></Show>
          <ChatHeader project={selectedProject()} title={chat.title() || (chat.status() === "active" ? "Untitled chat" : "New chat")} profile={activeProfile()} runtime={chat.runtimeIdentity()} live={chat.live() as unknown as Record<string, unknown>} chat={chat} contextMetrics={contextMetrics} composerStatus={composerStatus()} connectivity={runtime.connectivity()} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void createChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => void shareChat()} onRename={() => runSidebar("rename-chat")} onDelete={() => runSidebar("delete-chat")} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} />
          <Show when={selectedProject()?.kind === "workspace" && [...runtime.processes().values()].some((process) => process.chatId !== catalogue.selectedId() && process.active)}><div class="workspace-warning"><TriangleAlertIcon /><div><strong>Another chat is working in this Workspace</strong><p>Both agents can edit the same files. Conduit does not lock the Workspace or create worktrees automatically.</p></div></div></Show>
          <div class="work-area">
            <section class="work-area-conversation" aria-label="Conversation">
              <Transcript chat={chat} partialContinue={partialContinue()} markdownRenderer={markdownRenderer()} rendererControlsVisible={rendererControlsVisible()} profileLabel={activeProfile()?.label || activeProfile()?.id || chat.templateId() || undefined} />
              <div class="composer-stack"><HostUiRequests requests={chat.hostUiRequests()} onRespond={chat.respondHostUi} />
                <Composer chat={chat} attachments={attachments} models={models} profiles={profiles()} activeProfile={activeProfile()} serverOnline={runtime.connectivity() === "online"} voiceSettings={voiceSettings()} onChooseProfile={(id) => void switchProfile(id)} onOpenSettings={openSettings} onOpenAttachments={() => attachFileInput?.click()} onStatusChange={setComposerStatus} /></div>
            </section>
          </div>
        </>}>
          <ChatHeader project={selectedProject()} title="Dashboard" panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void createChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => void shareProject()} onRename={() => runSidebar("rename-folder")} onDelete={() => runSidebar("delete-project")} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} dashboard />
          <ProjectDashboard project={selectedProject()!} runtime={runtime}
            composer={<Composer
              chat={chat}
              attachments={attachments}
              models={models}
              profiles={profiles()}
              activeProfile={activeProfile()}
              serverOnline={runtime.connectivity() === "online"}
              voiceSettings={voiceSettings()}
              onChooseProfile={(id) => void switchProfile(id)}
              onOpenSettings={openSettings}
              onOpenAttachments={() => attachFileInput?.click()}
              onStatusChange={setComposerStatus}
              onSendDraft={async (prompt) => {
                const project = selectedProject();
                const id = chat.loadedId();
                if (!project || !id) return;
                catalogue.setProjects((current) => current.map((item) => item.id === project.id
                  ? { ...item, sessions: [{ id, projectId: project.id, status: "draft", title: chat.title() || "New chat", templateId: chat.templateId() || undefined, pinned: true }, ...item.sessions.filter((session) => session.id !== id)] }
                  : item));
                history.pushState({}, "", `/chat/${id}`);
                setRouteKind("chat");
                chat.setDraft(prompt);
                await chat.send();
              }}
            />}
            onOpenChat={(target: DashboardChat, project) => openChat(target, project)}
            onOpenChatTerminal={(target, project) => { void openChat(target, project).then(() => openWorkspaceView("terminal")); }}
            onPrefetchChat={chat.prefetch}
            onContextAction={(type, target) => runSidebar(type, target)}
            isPinned={isSidebarPinned}
            onOpenView={(view) => openWorkspaceView(view)}
            onOpenTerminal={(terminal) => openWorkspaceView("terminal", terminal.id)}
            onOpenTerminalMaximized={(terminal) => { openWorkspaceView("terminal", terminal.id); setWorkspaceExpanded(true); }}
            onPrefetchTerminal={prefetchWorkspaceTerminal}
            onSearchChats={() => openPalette("chat-search", `in:${selectedProject()!.id} `, true)}
            onRename={() => runSidebar("rename-folder")} onDelete={() => runSidebar("delete-project")}
            onOpenSettings={openSettings} onSaveAppearance={saveWorkspaceAppearance} onRefresh={refresh} onCancelClone={cancelClone} onDestroyWorkspace={(confirmation) => destroyWorkspace(selectedProject()!, confirmation)} onError={showError} />
        </Show>
        </Show>
      </Show>
    </main>
    <Show when={["chat", "project", "dashboard"].includes(routeKind()) && Boolean(selectedProject()) && Boolean(workspacePanelScope())}><WorkspacePanel projectId={() => selectedProject()!.id} projectName={() => selectedProject()!.name} workingRoot={() => selectedProject()!.workingRoot || selectedProject()!.path || ""} chatId={() => workspacePanelScope()!} open={panelOpen} expanded={workspaceExpanded} focusRequest={workspaceFocusRequest} requestedTab={workspaceViewRequest} onToggleExpanded={toggleWorkspaceExpanded} onClose={closePanel} shortcuts={shortcutManager} /></Show>
    </div>
    </Show>
    <Show when={routeKind() === "terminal" && routeBootstrap() === "ready"}>
      <TerminalRoute onOpenConduit={() => openDashboard()} />
    </Show>
    <CommandMenu open={paletteOpen()} onOpenChange={setPaletteOpen} onPageChange={setPalettePage} initialPage={palettePage()} initialQuery={paletteInitialQuery()} launchNonce={paletteNonce()} directLaunch={paletteDirectLaunch()}
      context={paletteContext()} actions={paletteActions} onChooseModel={(spec) => void models.chooseModel(spec)} scopeModels={models.allModels()} enabledModelSpecs={models.enabledModels()} onToggleModelScope={(spec) => { const enabled = models.enabledModels(); void models.saveScope(enabled.includes(spec) ? enabled.filter((item) => item !== spec) : [...enabled, spec]); }} shortcuts={shortcutManager} />
    <LeaderPalette shortcuts={shortcutManager} />
    <Show when={settingsLoaded()}>
      <Settings open={settingsOpen()} initialSection={settingsSection()} initialWorkspaceId={settingsWorkspaceId()} onOpenChange={setSettingsOpen} models={models} templates={templates()} templatesLoading={templatesLoading()} defaultTemplateId={defaultTemplateId()} projects={catalogue.projects()} installations={installations()} installationsLoading={installationsLoading()} onInstallationsChange={setInstallations} onDefaultTemplateChange={saveDefaultTemplate} onWorkspaceDefaultChange={saveWorkspaceDefault} markdownRenderer={markdownRenderer()} onMarkdownRendererChange={switchMarkdownRenderer} rendererControlsVisible={rendererControlsVisible()} onRendererControlsVisibleChange={switchRendererControlsVisible} meteorField={meteorField()} onMeteorFieldChange={switchMeteorField} voiceSettings={voiceSettings()} onVoiceSettingsSave={updateVoiceSettings} sidebarChatLimit={sidebarChatLimit()} onSidebarChatLimitChange={switchSidebarChatLimit} contextMetrics={contextMetrics()} onContextMetricsChange={switchContextMetrics} onOpenModelSelector={openModelSelector} shortcuts={shortcutManager} />
    </Show>
  </>;
}

render(() => <ErrorBoundary fallback={(error) => <div class="crash-screen"><div class="crash-card"><h1>Conduit hit a UI error</h1><p>{error instanceof Error ? error.message : "Unknown interface error"}</p><Button onClick={() => location.reload()}>Reload Conduit</Button></div></div>}>
  {nativeApp ? <NativeRoot /> : <App />}
</ErrorBoundary>, document.getElementById("root")!);
