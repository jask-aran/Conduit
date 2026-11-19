/// <reference types="vite-plugin-pwa/client" />
import { opensAs } from "./document/artifact-kinds";
import { NOT_SPOKEN } from "../transcript-fold.js";
import { duration, easing, reducedMotion, whenMotionEnds } from "@/components/ui/motion";
import { HarnessMark, StatusDot } from "@/components/ui";
import { Icons } from "@/components/ui";
import { handDrawerOnto, paneDrawn, AppShell, Segmented, LeadInput, DashHeader, DropOverlay, Notice, RiderButton, Sheet, SheetFill, Row, Group, GroupHeading, Note, Empty, Actions, IconButton, Heading, PaneHeader, HeaderButton } from "@/components/ui";
import { buildLabel, clientBuild, isDevClient } from "./platform/build-info.ts";
import { liveTrace } from "./turn-rows";
import { ConnectionScreen, ConnectionRecovery, ConnectionForm, ConnectionChoices, ConnectionChoice, ConnectionGroup, ConnectionAddress, ConnectionStatus, ConnectionPassword, ConnectionSteps, ConnectionEntry, ConnectionGo, ConnectionScan, type AddressState } from "@/components/ui/connection";
import { Field as ConnectionField, Button as ConnectionButton, Spinner as ConnectionSpinner } from "@/components/ui/controls";
import { createDecisionScope, DecisionDialogs } from "@/components/ui/decision-dialog";
import { Dialog } from "@/components/ui/dialog";
import "./motion-rules";
import { applyTranscriptFont } from "./preferences/transcript-font";
applyTranscriptFont();
import { focusSplitSection, splitSections } from "./dashboard/primitives/split-cursor";
import { isConduitManagedProject } from "./navigation/sidebar-preferences";
import type { ItemActions } from "./navigation/item-menus";
import type { ComputerLocation, ComputerPrefetchPayload, PreferencesPayload, ProjectsPayload, Pty, PtysPayload, RuntimeProcess, ShareOriginPayload } from "./api/contracts";
import { batch, createEffect, createMemo, createRenderEffect, createResource, createRoot, createSignal, ErrorBoundary, For, lazy, on, onCleanup, onMount, Show, untrack, useContext, type ComponentProps, type JSX } from "solid-js";
import { Portal, render } from "solid-js/web";
import { androidShell, desktopShell, desktopTitleBar, isInstalledClient } from "./platform/installed-client.ts";
import { setWindowDrags, TitleBar, WindowControls } from "@/components/ui/window";
import { applyStagedInterface, cancelUpdateDownload, interfaceReady, liveUpdateNow, startLiveUpdate, swapInterface } from "./platform/live-update.ts";
import { takeView, trackSidebar } from "./platform/resume-view.ts";
import { prefetchJbotMessages } from "./dashboard/jbot-messages";
import { JbotChip, JbotPanel, JbotPanelControl, JbotWays } from "./dashboard/jbot-status";
import { HeaderPill } from "@/components/ui";
import { keepThisComputerConnected } from "./platform/this-computer.ts";
import { startPush } from "./platform/push.ts";
// Keeps Float told of the hub path in use (and its sign-in), from startup rather than only once Settings has loaded.
import { onFloatOpensSettings } from "./platform/float";
const updateShell = desktopShell ?? androidShell;
import { PanelTopIcon } from "lucide-solid";
import { NotificationToaster, toast } from "@/components/ui/notifications";
import { createMeteorField } from "./chat/meteor-field";
import "@jask-aran/solid-components/meteor-shower.css";
import { phoneLayerOpen } from "@/components/phone-overlays";
import { Button, Spinner } from "@/components/ui/controls";
import { attachRowMenus, DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/ui/menus";
import { HeaderCrumb } from "@/components/ui/header";
import { DragPill, DropWash, ResizeEdge, type EdgeDrag, PaneHome, PaneTab, TabPlace, PaneTabRow, PaneTabs } from "@/components/ui/pane";
import { ChatHeader, Conversation } from "./chat/chat-screen";
import { api, apiWhenServed, asList, chatPath, isUnreachableError, JBOT_THREAD_PATH, type ApiRequestMetadata, pathChatId, pathProjectId, projectMatchesPath, projectPath, readAhead, readShared } from "./api/client";
import { buildHttpUrl, loginUrl, logoutUrl, normalizeServerOrigin, transcriptUrl } from "./api/transport";
import { startPathSelection } from "./platform/path-selector";
import { canDiscoverServers, discoverServers, type FoundServer } from "./platform/discovery";
import { proveServer } from "./platform/server-proof";
import { activeOrigin, activePath, activeServer, addServer, dialOrigin, forgetServer, learnIdentity, mergeServerDirectory, scopeOf, servers, trustedIdentities, setActiveServer, switchToServer } from "./platform/servers";
import { publishTrustedIdentities } from "./platform/certificate-pins.ts";
import { publishServerDirectory } from "./platform/server-directory";
import { canScanQr, parsePairingLink, QrScanner, redeemPairing, type PairingLink } from "./platform/pairing";
import { authorizedFetch, clearNativeBearerToken, nativeBearerToken, NATIVE_AUTH_REQUIRED_EVENT, saveNativeBearerToken } from "./api/native-auth-client";
import { resolveCapability } from "./chat-capabilities";
import type { ChatSummary, DashboardChat, HarnessManifestView, Project, Template, TranscriptDetail, WorkspaceAppearance, WorkspacePolicy, WorkspaceSuggestion, WorkspaceSuggestionsPayload } from "./api/contracts";
import { createErrorDiagnostic, formatDiagnosticPrompt, type ErrorDiagnostic, type ErrorDiagnosticContext } from "./error-diagnostics";
import { Composer } from "./chat/composer";
import { AppDashboard } from "./dashboard/app-dashboard";
import { applyTabFrost } from "./preferences/tab-frost";
import { applyChatArt } from "./preferences/chat-art";
import { createArtWindow } from "@/components/ui/chat-art";
import { watchStrayFrost } from "./platform/stray-frost";
import { applyStreamFade } from "./preferences/stream-fade";
import { installFocusShown } from "./preferences/focus-shown";
import type { VoiceDictationSettings } from "./chat/voice-dictation-types";
import { loadVoiceDictationSettings, saveVoiceDictationSettings } from "./chat/voice-dictation";
import { listAudioInputDevices, onMicrophoneOpened, rememberMicrophones } from "./chat/voice-audio";
import { Transcript } from "./chat/transcript";
import { hasTranscriptFind, openTranscriptFind } from "./chat/transcript-find";
import { landTranscriptCursor } from "./chat/transcript-cursor";
import { isChatContentActivity } from "./chat/transcript-source";
import { ARTIFACT_COMMANDS, COMMAND_IDS, commandRegistry, FEEDBACK_CONTEXTS, getCommandDefinition, LEADER_STROKE, type ArtifactCommand } from "./commands/command-registry";
import { focusedArtifact } from "./document/focused-artifact";
import { CommandMenu } from "./navigation/command-menu";
import { LeaderPalette } from "./navigation/leader-palette";
import { KeyboardTour, keyboardTourActive, startKeyboardTour, watchForTourOffer } from "./tour/keyboard-tour";
import type { TourEnv } from "./tour/tour-steps";
import { isLeaderMenuMode, LEADER_MENU_STORAGE_KEY, selectedLeaderMenu, setLeaderMenu } from "./shortcuts/leader-menu";
import type { PaletteActions, PaletteContext } from "./palette/command-registry";
import { bindVisualViewportShell, focusFirst, isMobileLayout, MOBILE_LAYOUT_QUERY, setMobileOverlayKind } from "./navigation/mobile-layout";
import { toggleKeyboardProbe } from "./navigation/keyboard-probe.ts";
import { composerKind, saveComposerKind } from "./platform/native-composer";
import { drawerSwipe } from "@/components/ui/drawer-swipe";
import { bindOverlayScrollbars } from "./navigation/overlay-scrollbars";

import { Sidebar, type SidebarCommand } from "./navigation/sidebar";
import { clampSidebarChatLimit, selectedSidebarChatLimit, SIDEBAR_CHAT_LIMIT_STORAGE_KEY } from "./navigation/sidebar-preferences";
import { CHAT_SORT_STORAGE_KEY, selectedChatSort, useChatSort } from "./preferences/chat-sort";
import { WorkspaceAppearanceEditor } from "./project/workspace-appearance-editor";
import { applyPwaUpdate, checkForPwaUpdate, arrivedByNewBuild, claimPwaUpdateArrival, forcePwaUpdate, pwaUpdateWaiting, resetPwaAppCache, startPwaUpdates } from "./pwa-update";
import { createChatSession, type ChatSession } from "./state/chat-session";
import { DEFAULT_MAX_ATTACHMENT_BYTES, filesFromDataTransfer } from "./state/attachments";
import { createDrafts } from "./state/drafts";
import { forgetDeviceTranscript } from "./state/device-transcripts";
import { createSingleFlight } from "./state/single-flight";
import { createLatest } from "./state/latest";
import { outboxChats, outboxIsOpen, outboxOf, takeFromOutbox } from "./state/outbox";
import { parseReviewComments } from "./chat/review-comments";
import { clearCachedCatalogue, readCachedCatalogue, writeCachedCatalogue } from "./state/catalogue-cache";
import { createCatalogueStore } from "./state/catalogue";
import { markChatRead } from "./state/read-receipts";
import { createSideChat, type SideChat } from "./state/side-chat";
import { connectionId, createRuntimeStore, deviceLabel, deviceStates } from "./state/runtime";
import { browserShortcutEnvironmentProvider } from "./shortcuts/shortcut-environment";
import { ShortcutManager } from "./shortcuts/shortcut-manager";
import { isShortcutRegion, type ShortcutBinding } from "./shortcuts/shortcut-types";
import { normalizeStoredBinding } from "./shortcuts/shortcut-normalize";
import { acknowledgeRegion } from "./shortcuts/region-cue";
import { globalShortcuts } from "./shortcuts/global-shortcuts";
import { fileEntryKey, formatFileView, parseFileView, sameFileEntry, type FileEntry } from "./workspace/file-documents";
import { dropWash, dropZoneAt } from "./panes/pane-drop";
import type { ReviewNavigationRequest } from "./chat/review-navigation";
import type { FileSlotHandle, FileSummary } from "./workspace/workspace-file-slot";
import { dropScope, pruneWorkspacePanelStorage, readSetting, WORKSPACE_PANEL_GLOBAL_SCOPE, writeSetting } from "./workspace/workspace-panel-storage";
import { PANE_LAYOUTS, WorkspaceRail } from "./workspace/workspace-rail";
import { isSplitView, type SplitView } from "./workspace/workspace-types";
import * as Layouts from "./panes/pane-store";
import { minArtifactPaneWidth, minMainPaneWidth, minSplitPaneWidth } from "./layout-geometry";
import { dispatchPanelGeometryMotion } from "./panel-motion";
import { publishUiPreference, queueUiPreferenceSave, uiPreferenceSaves, UI_PREFERENCE_CHANGE_EVENT, type ClientPreference, type UiPreferenceKey, type UiPreferences } from "./preferences/ui-preferences";
import { applyUiScale, followZoomGestures, selectedUiScale, stepUiScale } from "./preferences/ui-scale";
import { applyTranscriptScale } from "./preferences/transcript-scale";
import { applyMotionScale } from "./preferences/motion-scale";
import { harnessLabelFor } from "./harness-brand";
import { clientId, createAgentUiBridge, type AgentUiCommand } from "./agent-ui";
import { OutsideThreadChip } from "./chat/outside-thread-chip";
import { SubagentNote } from "./chat/subagent-note";
import { OPEN_AGENT_EVENT } from "./chat/agents";
import { agentName, agentNeeds, agentView, refreshAgent, wantNeeds } from "./state/agent";
import { agentDashboardLaidOut, agentPageLaidOut } from "./state/arrival";
import { pathJbotPage } from "./api/routes";
import { ServerSwitcher } from "./navigation/server-switcher";
import { RuntimeIndicator, visibleRuntimeActivity } from "./navigation/runtime-indicator";
import { titleBarShows } from "./settings/title-bar-items";
import type { HarnessChoices, HarnessThreadTarget } from "./dashboard/harness-dashboard";
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
import "./styles.css";
import "@/components/ui/styles";
import { breatheCarets } from "@/components/ui/caret";

const DESKTOP_UPDATE_ROUTE_KEY = "conduit:desktop-update-route";
const FIRST_DESKTOP_UPDATE_CHECK_MS = 10_000;
const UPDATE_SETTLED_HOLD_MS = 8_000;
const INTERFACE_RELOAD_WAIT_MS = 8_000;
const UPDATE_STEP_TIMEOUT_MS = 30_000;
const UPDATE_CHECK_TIMEOUT_MS = 150_000;
if (desktopShell) {
  const route = localStorage.getItem(DESKTOP_UPDATE_ROUTE_KEY);
  if (route?.startsWith("/") && !route.startsWith("//")) history.replaceState({}, "", route);
  localStorage.removeItem(DESKTOP_UPDATE_ROUTE_KEY);
}

const nativeApp = isInstalledClient();
applyUiScale(selectedUiScale(), true);
followZoomGestures();
applyTranscriptScale();
applyMotionScale();
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

type SettingsSection = "ui" | "shortcuts" | "models" | "prompts" | "device" | "devices" | "workspaces" | "voice" | "search";
/**
 * "working" carries its own words because the three clients have different ones: a download percentage, an APK
 * handed to the system installer, a worker taking over.
 */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "updated" }
  | { kind: "ready" }
  | { kind: "working"; label: string; onCancel?: () => void };
type WorkspaceView = "files" | "diff" | "chat" | "terminal" | "jbot";
const METEOR_FIELD_STORAGE_KEY = "conduit:meteor-field";
const selectedMeteorField = () => localStorage.getItem(METEOR_FIELD_STORAGE_KEY) === "true";
const WorkspacePanel = lazy(() => import("./workspace/workspace-panel"));
const FileViewer = lazy(() => import("./workspace/workspace-file-viewer"));
const FolderPane = lazy(() => import("./workspace/folder-viewer"));
const ComputerDashboard = lazy(() => import("./dashboard/computer-dashboard").then((module) => ({ default: module.ComputerDashboard })));
const FeedbackTool = lazy(() => import("./feedback/conduit-feedback"));
const ArtifactPane = lazy(() => import("./document/artifact-pane"));
const ArtifactCreator = lazy(() => import("./document/artifact-creator"));
const AgentPage = lazy(() => import("./dashboard/agent-page").then((module) => ({ default: module.AgentPage })));
const JbotRoom = lazy(() => import("./dashboard/jbot-room").then((module) => ({ default: module.JbotRoom })));
const EnvironmentPage = lazy(() => import("./dashboard/environment-page").then((module) => ({ default: module.EnvironmentPage })));
const ProjectDashboard = lazy(() => import("./project/dashboard"));
const HarnessDashboard = lazy(() => import("./dashboard/harness-dashboard"));
const TerminalPane = lazy(() => import("./remotes/terminal-pane").then((module) => ({ default: module.TerminalPane })));
const TerminalRoute = lazy(() => import("./remotes/terminal-route").then((module) => ({ default: module.TerminalRoute })));
const Settings = lazy(() => import("./settings/settings").then((module) => ({ default: module.Settings })));
const BrowserPane = lazy(() => import("./browser/browser-pane").then((module) => ({ default: module.BrowserPane })));
const MailPane = lazy(() => import("./mail/mail-pane"));
const prefetchProjectDashboard = (project: Project) => void import("./project/dashboard").then((module) => module.prefetchProjectDashboard(project)).catch(() => {});
const prefetchWorkspaceTerminal = () => void import("./workspace/workspace-panel");

const ConnectDialog = lazy(() => import("./navigation/pair-dialog").then((module) => ({ default: module.ConnectDialog })));
const LOCAL_SERVER_ORIGIN = "http://127.0.0.1:4310";
// The least an address check and a look on the network last, so one that ends at once still reads as a look.
const ADDRESS_CHECK_MIN_MS = 700;
const NETWORK_LOOK_MIN_MS = 1200;
const ADDRESS_CHECK_DEBOUNCE_MS = 600;

/**
 * Nothing is remembered until the server has answered: an entry never signed in to is a row that can only fail. A
 * browser cannot reach another origin, so there it records an address and nothing more.
 */
export function ServerConnectForm(props: { adding?: boolean; onDone: (origin: string) => void; onOpened?: () => void }) {
  const recordOnly = !isInstalledClient();
  const [address, setAddress] = createSignal(props.adding ? "" : activeOrigin() || "");
  const [verifiedOrigin, setVerifiedOrigin] = createSignal(props.adding ? null : activeOrigin());
  const [localServer, setLocalServer] = createSignal<string | null>(null);
  const [found, setFound] = createSignal<FoundServer[]>([]);
  const [searching, setSearching] = createSignal(canDiscoverServers());
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [scanning, setScanning] = createSignal(false);
  const [check, setCheck] = createSignal<{ state: AddressState; title: string; detail?: string } | null>(null);
  const hostOf = (origin: string) => origin.replace(/^https?:\/\//, "");

  /*
   * A browser cannot read another server's reply (Conduit answers cross-origin only for its shells), so it learns
   * only that something answered there, and offers to open it in a tab of its own.
   */
  const checkRun = createLatest();
  let checkTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(checkTimer));
  const checkAddress = async () => {
    clearTimeout(checkTimer);
    const text = address().trim();
    if (!text) return setCheck(null);
    let origin: string;
    try { origin = normalizeServerOrigin(text); }
    catch (cause) { return setCheck({ state: "missing", title: "Not an address", detail: (cause as Error).message }); }
    const current = checkRun.next();
    setError("");
    setVerifiedOrigin(null);
    setCheck({ state: "checking", title: `Looking for ${hostOf(origin)}…` });
    const pause = new Promise((resolve) => setTimeout(resolve, ADDRESS_CHECK_MIN_MS));
    const health = await (recordOnly
      ? fetch(buildHttpUrl("/healthz", origin), { mode: "no-cors", cache: "no-store" }).then(() => ({ ok: true }) as { ok?: boolean; name?: string; release?: string })
      : fetch(buildHttpUrl("/healthz", origin), { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ ok?: boolean; name?: string; release?: string }> : null)
    ).catch(() => null);
    await pause;
    if (!current()) return;
    if (!health?.ok) return setCheck({ state: "missing", title: "Nothing answered", detail: hostOf(origin) });
    const release = health.release?.replace(/\.\d{14}\..*$/, "");
    setCheck({ state: "found", title: health.name || hostOf(origin), detail: [health.name ? hostOf(origin) : "", release].filter(Boolean).join(" · ") || undefined });
    setVerifiedOrigin(origin);
  };
  const typeAddress = (value: string) => {
    setAddress(value);
    clearTimeout(checkTimer);
    checkRun.drop();
    setCheck(null);
    setVerifiedOrigin(null);
    setError("");
    if (/[.:]|localhost/.test(value.trim()) && !(!recordOnly && parsePairingLink(value))) checkTimer = setTimeout(() => void checkAddress(), ADDRESS_CHECK_DEBOUNCE_MS);
  };
  const openFound = (origin: string) => {
    addServer(origin);
    void publishServerDirectory(servers());
    window.open(origin, "_blank", "noopener");
    props.onOpened?.();
  };

  const pair = async (link: PairingLink) => {
    setScanning(false);
    setError("");
    setAddress(link.origin);
    setSubmitting(true);
    try {
      const { token, origin } = await redeemPairing(link);
      addServer(origin);
      // The identity is trusted: it came from the paired device's setup.
      if (link.identity) {
        learnIdentity(origin, { id: link.identity.id, publicKey: link.identity.publicKey, tls: true,
          paths: (link.routes ?? []).map((route) => ({ origin: route, scope: scopeOf(route) })) });
      }
      await saveNativeBearerToken(token, origin);
      props.onDone(origin);
    } catch (cause) {
      setError(cause instanceof TypeError ? "Could not reach this Conduit server from here." : (cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const submit = async (event: SubmitEvent) => {
    event.preventDefault();
    setError("");
    const link = !recordOnly && !verifiedOrigin() ? parsePairingLink(address()) : null;
    if (link) return void pair(link);
    if (!verifiedOrigin()) return void checkAddress();
    if (recordOnly) return openFound(verifiedOrigin()!);
    setSubmitting(true);
    try {
      const origin = verifiedOrigin()!;
      const response = await fetch(buildHttpUrl("/v0/auth/native-login", origin), {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ password: password() }),
      });
      const body = await response.json().catch(() => ({})) as { token?: string; message?: string };
      if (!response.ok || !body.token) throw new Error(body.message || "Could not sign in.");
      addServer(origin);
      await saveNativeBearerToken(body.token, origin);
      props.onDone(origin);
    } catch (cause) {
      setError(cause instanceof TypeError
        ? "Could not reach this Conduit server. Check Tailscale, HTTPS, and the server address."
        : (cause as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  /*
   * Looked for again when Change server leaves the server it opened on: while that one is held it is neither offered
   * nor listed, so a look taken only at open finds nothing once it is let go.
   */
  const lookRun = createLatest();
  const look = () => {
    const current = lookRun.next();
    setLocalServer(null);
    setFound([]);
    lookForLocalServer(current);
    lookOnNetwork(current);
  };
  onMount(look);

  const lookForLocalServer = (current: () => boolean) => {
    if (verifiedOrigin() || servers().some((entry) => entry.origin === LOCAL_SERVER_ORIGIN)) return;
    // A browser cannot ask (Conduit answers cross-origin only for its shells), so it offers the address unconfirmed:
    // being wrong costs a row that says Unreachable.
    if (recordOnly) return setLocalServer(LOCAL_SERVER_ORIGIN);
    void fetch(buildHttpUrl("/healthz", LOCAL_SERVER_ORIGIN), { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ ok?: boolean }> : null)
      .then((health) => { if (health?.ok && current()) setLocalServer(LOCAL_SERVER_ORIGIN); })
      .catch(() => { /* nothing is listening, so nothing is offered */ });
  };

  /*
   * A server already held is matched on identity rather than address: the same machine found at a LAN address after
   * being added by its tunnel name is a route this client already has.
   */
  const lookOnNetwork = (current: () => boolean) => {
    if (!canDiscoverServers()) return;
    const heldOrigins = new Set(servers().map((entry) => entry.origin));
    const heldIds = new Set(servers().map((entry) => entry.id).filter(Boolean));
    setSearching(true);
    const beat = new Promise((resolve) => setTimeout(resolve, NETWORK_LOOK_MIN_MS));
    void discoverServers({
      onFound: (server) => {
        if (!current()) return;
        if (heldIds.has(server.id) || server.candidates.some((origin) => heldOrigins.has(origin))) return;
        setFound((list) => list.some((item) => item.id === server.id)
          ? list.map((item) => item.id === server.id ? server : item)
          : [...list, server]);
      },
    }).finally(() => beat).then(() => { if (current()) setSearching(false); });
  };

  /*
   * Proved against the key that came with it: both came from the same advertisement, so this shows only that the
   * thing answering is what published the record. Who the server is, the person settles by signing in.
   */
  const chooseFound = async (server: FoundServer) => {
    // A check like any other: typing while the proofs run, or another pick, supersedes it.
    clearTimeout(checkTimer);
    const latest = checkRun.next();
    setError("");
    setAddress(server.origin);
    const proofs = await Promise.all(server.candidates.map((origin) => proveServer(origin, server.id, server.publicKey)));
    if (!latest()) return;
    const proved = server.candidates.find((_, index) => proofs[index]?.ok);
    if (proved) {
      setAddress(proved);
      setCheck({ state: "found", title: server.name, detail: hostOf(proved) });
      return setVerifiedOrigin(proved);
    }
    const proof = proofs.find((item) => item.reason !== "unreachable") ?? { ok: false, reason: "unreachable" as const };
    if (proof.reason === "unreachable") return setError("That server did not answer. It may have gone since it was found.");
    if (proof.reason === "mismatch") return setError("That address did not prove it is the server that advertised it.");
    // This client cannot check an Ed25519 signature: the address is filled in rather than accepted, so it gets the
    // same health check as a typed one.
  };

  const useLocalServer = () => {
    const origin = localServer();
    if (!origin) return;
    // A check still running for what was typed before would land over this choice.
    clearTimeout(checkTimer);
    checkRun.drop();
    setAddress(origin);
    setCheck({ state: "found", title: "This computer", detail: hostOf(origin) });
    setVerifiedOrigin(origin);
  };

  const status = () => check() ?? (verifiedOrigin() ? { state: "found" as const, title: hostOf(verifiedOrigin()!) } : null);
  const step = () => !verifiedOrigin() ? "find" : recordOnly ? "open" : "password";
  const plainAddress = () => { try { return normalizeServerOrigin(address()); } catch { return ""; } };

  return <ConnectionForm onSubmit={submit}>
    <Show when={!props.adding}><Heading kind="connection" mark={<HarnessMark id="conduit" />}>Connect to your server</Heading></Show>
    {(() => { const field = <ConnectionAddress id="native-server-address" aria-label="Server address" state={check()?.state}
      placeholder={props.adding ? (recordOnly ? "Server address" : "Address or pair link") : recordOnly ? "https://conduit.your-tailnet.ts.net" : "Address, or a link from conduit-server pair"} value={address()} onInput={(event) => typeAddress(event.currentTarget.value)}
      disabled={submitting() || (!props.adding && Boolean(verifiedOrigin()))} />;
      const entry = <ConnectionEntry>{field}
        <Show when={step() === "find"}>
          <Show when={!recordOnly && canScanQr()}><ConnectionScan onClick={() => setScanning(true)} disabled={submitting()} /></Show>
          <ConnectionGo label="Connect" busy={submitting() || check()?.state === "checking"} disabled={!address().trim()} />
        </Show>
      </ConnectionEntry>;
      return props.adding ? entry : <ConnectionField label="Server address">{entry}</ConnectionField>; })()}
    <ConnectionSteps step={status()?.state ?? ""}>
      <Show when={status()}>{(found) => <ConnectionStatus state={found().state} title={found().title} detail={found().detail} />}</Show>
    </ConnectionSteps>
    <ConnectionSteps step={step()} size={`${found().length} ${searching()} ${localServer()} ${error()}`}>
      <Show when={step() === "password"}>
        <ConnectionPassword value={password()} onInput={(event) => setPassword(event.currentTarget.value)} busy={submitting()} error={error() || null}
          ref={(element: HTMLInputElement) => queueMicrotask(() => element.focus({ preventScroll: true }))} />
      </Show>
      <Show when={error() && step() !== "password"}><Note kind="card" tone="error">{error()}</Note></Show>
      <Show when={step() === "find"}>
        {/* A browser on HTTPS cannot look at a plain-HTTP address on this network, though a tab of its own can open it. */}
        <Show when={recordOnly && check()?.state === "missing" && /^http:/.test(plainAddress())}>
          <ConnectionButton type="button" variant="ghost" onClick={() => openFound(normalizeServerOrigin(address()))}><Icons.ExternalLink />Open anyway</ConnectionButton>
        </Show>
        {/* A browser cannot look (no mDNS in a page, no plaintext LAN address from HTTPS): it is told so instead. */}
        <Show when={canDiscoverServers() || localServer()} fallback={props.adding ? null : <Note kind="card">Finding servers on this network needs the Conduit app.</Note>}>
          <ConnectionGroup>On this network<Show when={searching()}><ConnectionSpinner /></Show>
            <Show when={!searching() && !found().length && !localServer()}><small>No servers found</small></Show></ConnectionGroup>
          <Show when={found().length || localServer()}>
            <ConnectionChoices>
              <Show when={localServer()}><ConnectionChoice type="button" onClick={useLocalServer} disabled={submitting()} icon={<Icons.Monitor />} detail={localServer()!.replace(/^https?:\/\//, "")}>This computer</ConnectionChoice></Show>
              <For each={found()}>{(server) => <ConnectionChoice type="button" onClick={() => void chooseFound(server)} disabled={submitting()} icon={<Icons.Server />} detail={server.origin.replace(/^https?:\/\//, "")}>{server.name}</ConnectionChoice>}</For>
            </ConnectionChoices>
          </Show>
        </Show>
        <Show when={!props.adding}>
          <Note kind="card">{recordOnly ? "A browser opens another server in a tab of its own." : "HTTPS, unless the server is on this machine or this network."}</Note>
        </Show>
      </Show>
      <Show when={step() === "open"}>
        <ConnectionButton type="submit"><Icons.ExternalLink />Open in new tab</ConnectionButton>
      </Show>
      <Show when={verifiedOrigin() && !props.adding}><ConnectionButton type="button" variant="ghost" onClick={() => {
        const previous = activeOrigin();
        void clearNativeBearerToken().finally(() => {
          if (previous) forgetServer(previous);
          setVerifiedOrigin(null);
          setCheck(null);
          setAddress("");
          setPassword("");
          setError("");
          look();
        });
      }}>Change server</ConnectionButton></Show>
    </ConnectionSteps>
    <Show when={scanning()}><QrScanner onLink={(link) => void pair(link)} onClose={() => setScanning(false)} /></Show>
  </ConnectionForm>;
}

function NativeServerSetup(props: { onAuthenticated: () => void }) {
  return <ConnectionScreen>
    <ServerConnectForm onDone={(origin) => { setActiveServer(origin); props.onAuthenticated(); }} />
  </ConnectionScreen>;
}

/**
 * Changing server remounts `App` rather than reloading: disposing the tree runs every `onCleanup`, closing the left
 * server's streams, sockets and terminals. Holding a token counts as signed in without asking: a 401 from
 * `authorizedFetch` lands here as `NATIVE_AUTH_REQUIRED`.
 */
const launchMark = document.querySelector(".launch-mark");
const dismissLaunchMark = () => launchMark?.remove();
const showLaunchMark = () => { if (launchMark && !launchMark.isConnected) document.body.append(launchMark); };
const liveUpdateOrigin = () => { const path = activePath(); return path ? dialOrigin(path) : null; };

function NativeRoot() {
  const [state, setState] = createSignal<"loading" | "login" | "app">("loading");
  const [shown, setShown] = createSignal<string | null>(null);
  onMount(() => {
    const requireLogin = () => setState("login");
    window.addEventListener(NATIVE_AUTH_REQUIRED_EVENT, requireLogin);
    onCleanup(() => window.removeEventListener(NATIVE_AUTH_REQUIRED_EVENT, requireLogin));
  });
  createEffect(() => {
    const origin = activeOrigin();
    if (!origin) return setState("login");
    // Only the chosen server's answer counts: a slower check for the one
    // switched away from must not open, or sign out of, this one.
    const switching = untrack(shown) !== null && untrack(shown) !== origin;
    if (switching) setState("loading");
    void nativeBearerToken(origin)
      .then(async (token) => {
        if (activeOrigin() !== origin) return;
        if (!token) return setState("login");
        if (switching) {
          showLaunchMark();
          const server = untrack(liveUpdateOrigin);
          if (server && await swapInterface(server)) return;
          if (activeOrigin() !== origin) return;
        }
        setShown(origin);
        setState("app");
      })
      .catch(() => { if (activeOrigin() === origin) setState("login"); });
  });
  createEffect(() => { if (state() === "login") dismissLaunchMark(); });
  return <Show when={state() !== "loading"}>
    <Show when={state() === "app" ? shown() ?? undefined : undefined} keyed fallback={<NativeServerSetup onAuthenticated={() => { setShown(activeOrigin()); setState("app"); }} />}>
      {(_origin: string) => <App />}
    </Show>
  </Show>;
}

type PaneKey = "main" | number;
type PaneSlot = { index: number; session: SideChat; host: () => HTMLElement | undefined; setHost: (element: HTMLElement | undefined) => void; draft: { id: string; projectId: string } | null };

const ARRIVAL_FALLBACK_MS = 2500;
const PANES_SETTLE_MS = 1500;
const DRAFT_DROP_FALLBACK_MS = 200;
const ENTER_RETRY_MS = 100;
const VIEWER_FOCUS_RETRY_MS = 60;
const UNLISTED_CHAT_RELIST_MS = 1000;

function App() {
  const { confirm: confirmDialog } = createDecisionScope(() => location.href);
  const logout = async () => {
    clearCachedCatalogue();
    if (nativeApp) {
      // The server is told when it can be reached; signing out never waits on one that cannot.
      try { await authorizedFetch(logoutUrl(), { method: "POST", signal: AbortSignal.timeout(4000) }); } catch {}
      await clearNativeBearerToken();
      window.dispatchEvent(new Event(NATIVE_AUTH_REQUIRED_EVENT));
      return;
    }
    await fetch(logoutUrl(), { method: "POST" }).finally(() => { location.href = loginUrl(); });
  };
  const shortcutManager = new ShortcutManager({
    commands: commandRegistry,
    environment: browserShortcutEnvironmentProvider.detect(),
    leader: LEADER_STROKE,
    validate: import.meta.env.DEV,
  });
  window.addEventListener("conduit:keybindings-changed", (event) => {
    const overrides = (event as CustomEvent<Record<string, unknown>>).detail || {};
    shortcutManager.replaceOverrides(Object.fromEntries(Object.entries(overrides).flatMap(([commandId, bindings]) => {
      const normalized = Array.isArray(bindings) ? bindings.map(normalizeStoredBinding) : [];
      return Array.isArray(bindings) && normalized.every(Boolean) ? [[commandId, normalized as ShortcutBinding[]]] : [];
    })));
  });
  const catalogue = createCatalogueStore();
  const [computerLocation, setComputerLocation] = createSignal<ComputerLocation | null>(null);
  const [computerFile, setComputerFile] = createSignal<{ path: string } | null>(null);
  const [computerLoading, setComputerLoading] = createSignal(false);
  const [computerError, setComputerError] = createSignal("");
  const workspacePanelScopes = (projects: Project[]) => {
    const scopes = new Set<string>(["computer"]);
    for (const project of projects) {
      scopes.add(project.id);
      scopes.add(`project:${project.id}`);
      scopes.add(`folder:${project.id}`);
      for (const chat of project.sessions) scopes.add(chat.id);
    }
    return scopes;
  };
  const [templates, setTemplates] = createSignal<Template[]>([]);
  const [externalProfiles, setExternalProfiles] = createSignal<Template[]>([]);
  // Keyed by implementation: a manifest is registered under it and every chat carries it.
  const [harnessCapabilities, setHarnessCapabilities] = createSignal<Record<string, HarnessManifestView>>({});
  const [templatesLoading, setTemplatesLoading] = createSignal(true);
  const [workspaceSuggestions, setWorkspaceSuggestions] = createSignal<WorkspaceSuggestion[]>([]);
  const [workspacePolicy, setWorkspacePolicy] = createSignal<WorkspacePolicy | null>(null);
  const [defaultTemplateId, setDefaultTemplateId] = createSignal("assistant");
  const [voiceSettings, setVoiceSettings] = createSignal<VoiceDictationSettings>(loadVoiceDictationSettings());
  const updateVoiceSettings = (next: VoiceDictationSettings) => setVoiceSettings(saveVoiceDictationSettings(next));
  // Reads the microphones without opening one: at startup opening one takes the phone's audio and pauses the
  // person's music.
  const reconcileMicrophones = () => {
    void listAudioInputDevices({ openForNames: false }).then((devices) => {
      const patch = rememberMicrophones(voiceSettings(), devices);
      if (Object.keys(patch).length) updateVoiceSettings({ ...voiceSettings(), ...patch });
    }).catch(() => {});
  };
  onMount(reconcileMicrophones);
  onCleanup(onMicrophoneOpened(reconcileMicrophones));
  const [maxAttachmentBytes, setMaxAttachmentBytes] = createSignal(DEFAULT_MAX_ATTACHMENT_BYTES);
  const [meteorField, setMeteorField] = createSignal(selectedMeteorField());
  const meteors = createMeteorField();
  const [sidebarChatLimit, setSidebarChatLimit] = createSignal(selectedSidebarChatLimit());
  const chatSort = useChatSort();
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [sidebarPins, setSidebarPins] = createSignal<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = createSignal(false);
  const [settingsSection, setSettingsSection] = createSignal<SettingsSection>("ui");
  const [settingsNamedSection, setSettingsNamedSection] = createSignal(false);
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
  const setWorkspaceExpanded = (next: boolean, persist = true) => {
    if (persist) writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "expanded", String(next));
    if (next === workspaceExpanded()) return;
    setWorkspaceExpandedState(next);
  };
  const [workspaceViewRequest, setWorkspaceViewRequest] = createSignal<{ tab: WorkspaceView; terminalId?: string; nonce: number } | null>(null);
  applyTabFrost();
  applyChatArt();
  applyStreamFade();
  watchStrayFrost();
  installFocusShown();
  // A paper and its mated thread are one tab, showing either: the thread is a chat no list holds, found from its paper.
  // Which chats are mated threads is kept, so a reload on one opens its paper.
  const [matedThreads, setMatedThreads] = createSignal<Record<string, string>>((() => { try { return JSON.parse(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "mated") || "{}") as Record<string, string>; } catch { return {}; } })());
  const matedPaper = (view: string | null | undefined) => view?.startsWith("chat:") ? matedThreads()[view.slice("chat:".length)] : undefined;
  const paperOf = <View extends string | null>(view: View) => { const paper = matedPaper(view); return paper ? `artifact:${paper}` as const : view; };
  const launchUrl = new URL(location.href);
  const atStart = launchUrl.pathname === "/" && !launchUrl.search;
  const SLOT_IDS = [0, 1, 2, 3, 4];
  /** A layout read from an address or storage, its views as the panes hold them: a mated thread as its paper. */
  const readLayout = (params: URLSearchParams) => {
    const found = Layouts.decode(params, isSplitView);
    if (!found) return null;
    for (const pane of Object.values(found.panes)) pane.views = pane.views.map(paperOf).filter((view, index, all) => all.indexOf(view) === index);
    return found;
  };
  // Pane A draws the route, so the first layout's pane A is what the address names until the route settles.
  const panes = Layouts.createPaneStore((() => {
    const seed = readLayout(launchUrl.searchParams) ?? (atStart ? readLayout(new URLSearchParams(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-layout") || "")) : null)
      ?? Layouts.layoutOf(pathChatId() ? `chat:${pathChatId()}` : "page:dashboard");
    // The address of a thread opens its paper in pane A; the other panes, the dock and the tabs it names are kept.
    const paper = matedPaper(`chat:${pathChatId()}`);
    if (!paper) return seed;
    const url = new URL(location.href);
    url.pathname = "/";
    history.replaceState({}, "", url);
    return Layouts.show(seed, seed.row[0]!, `artifact:${paper}`);
  })());
  const layout = panes.layout;
  const paneAShown = createMemo(() => Layouts.shownView(layout().panes[layout().row[0]!]!));
  // Pane A is the row's first pane, drawn by the route; every other placed pane keeps a numbered slot (its `SideChat`)
  // for as long as it is open, so swapping or closing beside it never reloads a pane that did not move.
  const slotOfId = new Map<string, number>();
  const slotIds = createMemo(() => {
    const { row, dock } = layout();
    const others = [...row.slice(1), ...(dock ? [dock] : [])];
    for (const id of [...slotOfId.keys()]) if (!others.includes(id)) slotOfId.delete(id);
    for (const id of others) if (!slotOfId.has(id)) slotOfId.set(id, SLOT_IDS.find((slot) => ![...slotOfId.values()].includes(slot))!);
    return new Map(slotOfId);
  }, new Map<string, number>(), { equals: (a, b) => a.size === b.size && [...a].every(([id, slot]) => b.get(id) === slot) });
  const keyOf = (id: string): PaneKey | null => layout().row[0] === id ? "main" : slotIds().get(id) ?? null;
  const idOf = (pane: PaneKey) => pane === "main" ? layout().row[0]! : [...slotIds()].find(([, slot]) => slot === pane)?.[0] ?? null;
  const paneData = (pane: PaneKey) => { const id = idOf(pane); return id ? layout().panes[id] ?? null : null; };
  const sameList = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((item, index) => item === b[index]);
  const slotOrder = createMemo(() => { const { row, dock } = layout(); return [...row.slice(1), ...(dock ? [dock] : [])].map((id) => slotIds().get(id)!).filter((slot) => slot !== undefined); }, [], { equals: sameList });
  const rowSlots = createMemo(() => layout().row.slice(1).map((id) => slotIds().get(id)).filter((slot) => slot !== undefined), [], { equals: sameList });
  /** The dock's one pane; `dockSlot` is what the dock shows, which may instead be a row pane folded there for room. */
  const dockedSlot = createMemo(() => { const dock = layout().dock; return dock ? slotIds().get(dock) ?? null : null; });
  const [dockSlot, setDockSlot] = createSignal<number | null>(null);
  const dockContents = () => [...(dockedSlot() === null ? [] : [dockedSlot()!]), ...foldedSlots()];
  const inDock = (slot: PaneKey) => slot !== "main" && dockContents().includes(slot);
  const [dockDocHost, setDockDocHost] = createSignal<HTMLElement>();
  const [dockOverlay, setDockOverlayState] = createSignal(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "dock-overlay") === "true");
  const toggleDockOverlay = () => { const next = !dockOverlay(); setDockOverlayState(next); writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "dock-overlay", String(next)); };
  const [splitRatio, setSplitRatio] = createSignal(Math.max(0.2, Math.min(0.8, Number(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split-ratio")) || 0.5)));
  const [splitRatios3, setSplitRatios3] = createSignal<number[]>((() => {
    try {
      const stored = JSON.parse(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split-ratios") || "null");
      if (Array.isArray(stored) && stored.length === 3 && stored.every((value) => typeof value === "number" && value > 0)) return stored;
    } catch {}
    return [0.4, 0.3, 0.3];
  })());
  const [layoutWidth, setLayoutWidth] = createSignal(window.innerWidth);
  const [dockTool, setDockTool] = createSignal<WorkspaceView>((() => {
    const stored = readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "tab");
    return stored === "diff" || stored === "chat" || stored === "terminal" ? stored : stored === "artifacts" ? "chat" : "files";
  })());
  const [workspaceFocusRequest, setWorkspaceFocusRequest] = createSignal(0);
  const resumed = takeView();
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(resumed?.sidebar === true);
  trackSidebar(mobileSidebarOpen);
  const initialRouteId = pathChatId();
  // Asked first: every route waits on it, and behind the browser's six connections per server it queued a round
  // trip. A route cannot finish loading if it fails during an outage, so it keeps retrying.
  const catalogueFresh = apiWhenServed<ProjectsPayload>("/v0/projects", true)
    .then((payload) => { writeCachedCatalogue(payload); return payload; });
  // A chat's address names its project, which a stale cache may not have yet; then that route waits for the server.
  const cachedCatalogue = location.pathname === "/" || initialRouteId ? readCachedCatalogue() : null;
  const catalogueRequest = cachedCatalogue ? Promise.resolve(cachedCatalogue) : catalogueFresh;
  const selectedChatRequest = initialRouteId ? Promise.all([
    apiWhenServed<ChatSummary>(`/v0/chats/${encodeURIComponent(initialRouteId)}`, true),
    apiWhenServed<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(initialRouteId)}`, true),
  ]) : null;
  selectedChatRequest?.catch(() => {});
  if (initialRouteId) {
    const chatPath = `/v0/chats/${encodeURIComponent(initialRouteId)}`;
    readAhead([`${chatPath}/models`, `${chatPath}/permission-profiles`, `${chatPath}/service-levels`, `${chatPath}/attachments`]);
    selectedChatRequest?.then(([summary]) => {
      const projectId = encodeURIComponent(summary.projectId);
      readAhead([`/v0/models?projectId=${projectId}`]);
      readAhead([`/v0/projects/${projectId}/turn-artifact?${new URLSearchParams({ chatId: initialRouteId, timeline: "1" })}`], "no-store");
    }, () => {});
  }
  // The transcript renderer loads in a chain each link of which is found only once the one before runs: asked for
  // all at once here.
  if (initialRouteId) {
    void import("./chat/markdown").catch(() => {});
    void import("./chat/incremark-markdown").catch(() => {});
  }
  const initialProjectRouteId = pathProjectId();
  const initialTerminalRoute = location.pathname === "/terminal";
  const initialComputerRoute = location.pathname === "/computer" || location.pathname.startsWith("/computer/harness/") || location.pathname.startsWith("/computer/environment/");
  const initialDashboardRoute = location.pathname === "/";
  if (location.pathname === "/agent") history.replaceState(history.state, "", `/jbot/page${location.search}${location.hash}`);
  const initialAgentRoute = pathJbotPage() === "agent";
  const initialJbotRoute = pathJbotPage() === "jbot" || (location.pathname === JBOT_THREAD_PATH && !initialRouteId);
  const [routeKind, setRouteKind] = createSignal<"chat" | "project" | "dashboard" | "terminal" | "computer" | "agent" | "jbot">(
    initialJbotRoute ? "jbot" : initialAgentRoute ? "agent" : initialComputerRoute ? "computer" : initialTerminalRoute ? "terminal" : initialDashboardRoute ? "dashboard" : initialProjectRouteId ? "project" : "chat",
  );
  const [computerHarness, setComputerHarness] = createSignal(decodeURIComponent(location.pathname.match(/^\/computer\/harness\/([^/]+)/)?.[1] || ""));
  const [computerEnvironment, setComputerEnvironment] = createSignal(decodeURIComponent(location.pathname.match(/^\/computer\/environment\/([^/]+)/)?.[1] || ""));
  const [terminalRouteId, setTerminalRouteId] = createSignal<string>();
  const [terminalCanReturn, setTerminalCanReturn] = createSignal(false);
  const workspacePanelScope = createMemo(() => routeKind() === "computer" ? "computer"
    : (routeKind() === "agent" || routeKind() === "jbot") ? (agentView()?.projectId ? `project:${agentView()!.projectId}` : null)
    : ["chat", "project", "dashboard"].includes(routeKind()) && catalogue.projectId() ? `project:${catalogue.projectId()}`
      : ["chat", "project", "dashboard"].includes(routeKind()) && agentView()?.projectId ? `project:${agentView()!.projectId}`
      : null);
  const [routeBootstrap, setRouteBootstrap] = createSignal<"loading" | "ready" | "error">("loading");
  const [routeBootstrapError, setRouteBootstrapError] = createSignal("");
  // Decoration waits for the first open: the meteor field costs a phone a tenth of a second of the open it decorates.
  const [arrived, setArrived] = createSignal(false);
  const [revealing, setRevealing] = createSignal(false);
  // A phone's sidebar is off-screen at the first open, and its rows, each with its own menu, are a large part of
  // what that open builds.
  const sidebarFilled = () => arrived() || !isMobileLayout() || mobileSidebarOpen();
  {
    const layoutReady = Promise.all([
      readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "open") === "true" && !isMobileLayout() ? WorkspacePanel.preload() : null,
      initialProjectRouteId ? ProjectDashboard.preload() : null,
      initialComputerRoute ? ComputerDashboard.preload() : null,
    ]).catch(() => undefined);
    const root = document.documentElement;
    let settle: (() => void) | undefined;
    const arrive = () => {
      if (root.dataset.arrival !== "waiting") return;
      root.dataset.arrival = "arriving";
      setRevealing(true);
      settleFocus();
      settle = whenMotionEnds(null, "opacity", "--duration-gentle", () => { delete root.dataset.arrival; dismissLaunchMark(); setArrived(true); attachRowMenus(); });
    };
    root.dataset.arrival = "waiting";
    const fallback = setTimeout(arrive, ARRIVAL_FALLBACK_MS);
    // A long transcript renders in passes, and shown mid-way its bubbles move under the fade: the reveal waits for
    // every pane's chat and then for the layout to hold still.
    const panesLoaded = () => shownSlots().every((slot) => { const id = slotChatId(slot); return !id || paneSlot(slot).session.chat.loadedId() === id; });
    const waitForStill = () => new Promise<void>((resolve) => {
      let last = "";
      let still = 0;
      const check = () => {
        const shape = [...document.querySelectorAll<HTMLElement>(".chat-main, .main-split, .ui-chat-column")].map((element) => { const box = element.getBoundingClientRect(); return `${Math.round(box.width)}x${Math.round(box.height)}`; }).join();
        still = shape === last ? still + 1 : 0;
        last = shape;
        if (still >= 3 || root.dataset.arrival !== "waiting") resolve(); else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    createEffect(() => {
      // Only a transcript renders in passes; three still frames on a busy phone are close to half a second of nothing.
      // The agent's page waits for its messages, the markdown renderer and its home thread, or its bubbles fill and
      // its composer's model changes under the fade.
      if ((routeKind() === "agent" || routeKind() === "jbot") && (agentView() == null || (agentView()!.enabled && (routeKind() === "agent"
        ? !agentDashboardLaidOut()
        : !agentPageLaidOut() || Boolean(agentView()!.home?.chatId) && chat.loadedId() !== agentView()!.home!.chatId)))) return;
      const settled = () => ["dashboard", "project", "agent", "jbot"].includes(routeKind()) && shownSlots().length <= 1
        ? new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        : waitForStill();
      if (routeBootstrap() !== "loading" && panesLoaded()) void layoutReady.then(settled).then(arrive);
    });
    onCleanup(() => { clearTimeout(fallback); settle?.(); delete root.dataset.arrival; dismissLaunchMark(); setArrived(true); attachRowMenus(); });
  }
  let dragDepth = 0;
  let workspaceSuggestionsRequest: Promise<void> | null = null;

  let diagnosticContext: () => ErrorDiagnosticContext = () => ({ route: location.pathname });
  let askChatForError: (diagnostic: ErrorDiagnostic) => Promise<void> = async () => {};
  let suppressDiagnosticActions = false;
  let hubAway = () => false;
  const showPlainError = (error: unknown) => toast.error(error instanceof Error ? error.message : String(error || "Request failed"));
  const showError = (error: unknown) => {
    // The hub is known to be away: the composer already says it cannot be reached, once.
    if (isUnreachableError(error) && hubAway()) return;
    if (suppressDiagnosticActions) return showPlainError(error);
    const diagnostic = createErrorDiagnostic(error, diagnosticContext());
    toast.error(diagnostic.message, {
      duration: 12_000,
      action: { label: "Ask in a chat", onClick: () => void askChatForError(diagnostic) },
    });
  };
  // An unsent draft is deleted when its page is left, which can be while it is
  // still loading; the load then finds no chat, and that is not an error.
  const showDraftError = (error: unknown) => {
    if ((error as { error?: unknown } | null)?.error === "chat_not_found") return;
    showError(error);
  };
  const [updateState, setUpdateState] = createSignal<UpdateState>({ kind: "idle" });
  // Progress arrives per downloaded chunk, several a frame: the row redraws only when what it says changes.
  const sayProgress = (label: string, onCancel?: () => void) => {
    const current = updateState();
    if (current.kind === "working" && current.label === label && current.onCancel === onCancel) return;
    setUpdateState({ kind: "working", label, onCancel });
  };
  const pwaUpdating = () => { const state = updateState().kind; return state === "checking" || state === "working"; };
  let settleTimer = 0;
  const saySettled = (kind: "current" | "updated") => {
    setUpdateState({ kind });
    clearTimeout(settleTimer);
    // Long enough to be read by somebody who pressed the button and looked away while the worker was asked.
    settleTimer = window.setTimeout(() => setUpdateState((state) => state.kind === kind ? { kind: "idle" } : state), UPDATE_SETTLED_HOLD_MS);
  };
  const sayUpToDate = () => saySettled("current");
  /*
   * "Updating" must not outlive the attempt: a build that activated on its own is no longer waiting,
   * `applyPwaUpdate` declines, and the strip would sit on "Updating Conduit..." forever.
   */
  const takePwaUpdate = async (fromButton = false) => {
    if (updateShell) {
      setUpdateState({ kind: "working", label: "Installing Conduit…" });
      try {
        if (desktopShell) localStorage.setItem(DESKTOP_UPDATE_ROUTE_KEY, location.pathname + location.search + location.hash);
        if (!await updateShell.installPreparedUpdate()) setUpdateState({ kind: "idle" });
        // Android's installer can be cancelled, and the APK is still there.
        else if (androidShell) setUpdateState({ kind: "ready" });
      } catch (error) {
        setUpdateState({ kind: "ready" });
        showError(error);
      }
      return;
    }
    setUpdateState({ kind: "working", label: "Updating Conduit…" });
    // Pressed by hand: this tab's own draft does not hold it (the press is the
    // answer), but another tab's unsent draft still does, and says so.
    if (!await (fromButton ? forcePwaUpdate() : applyPwaUpdate())) {
      if (pwaUpdateWaiting()) {
        setUpdateState({ kind: "ready" });
        if (fromButton) toast.error("Another Conduit window has an unsent draft. Send or clear it, then restart.");
      } else sayUpToDate();
    }
  };
  const takeStagedInterface = async () => {
    setUpdateState({ kind: "working", label: "Opening the new interface…" });
    try {
      await applyStagedInterface();
      // The reload takes the page; still here after a while, it did not happen.
      await new Promise((resolve) => setTimeout(resolve, INTERFACE_RELOAD_WAIT_MS));
      setUpdateState({ kind: "idle" });
      toast.error("The new interface did not open. Try Check for updates again.");
    } catch (error) {
      setUpdateState({ kind: "idle" });
      showError(error);
    }
  };
  const setPwaUpdating = (busy: boolean) => setUpdateState(busy ? { kind: "checking" } : { kind: "idle" });
  // A manual check can start while a quiet one runs (the quiet one shows nothing until it downloads); the quiet one
  // then leaves the row to it: neither its progress nor its failure is said over the manual check's.
  let quietCheck = false, manualCheck = false;
  const prepareDesktopUpdate = async (quiet: boolean) => {
    const shell = updateShell;
    if (!shell || pwaUpdating() || (quiet && quietCheck)) return;
    // A background check says nothing until it has something: on Android it
    // waits for Wi-Fi, which can be hours, and a spinner that long is a lie.
    if (quiet) quietCheck = true;
    else { manualCheck = true; setPwaUpdating(true); }
    // A step that never answers would leave the spinner up for good: each gets half a minute (a download, half a
    // minute without progress), then the check gives up and says where it stopped.
    let step = "updating the interface";
    let timer = 0;
    let stalled = (): Promise<never> => new Promise(() => {});
    const touch = () => { if (quiet) return; clearTimeout(timer); timer = window.setTimeout(giveUp, UPDATE_STEP_TIMEOUT_MS); };
    let giveUp = () => {};
    let cancelled = false;
    if (!quiet) stalled = () => new Promise<never>((_, reject) => { giveUp = () => reject(new Error(`The update check stopped while ${step}.`)); touch(); });
    const bounded = <T,>(work: Promise<T>) => Promise.race([work, stalled()]);
    try {
      const cancel = () => { cancelled = true; void cancelUpdateDownload(); giveUp(); };
      const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;
      if (!quiet) {
        setUpdateState({ kind: "working", label: "Checking for a new interface…", onCancel: cancel });
        const live = liveUpdateNow((progress) => {
          touch();
          if (progress.phase === "checking") return;
          step = "downloading the new interface";
          const share = progress.total ? ` ${Math.round((progress.downloaded / progress.total) * 100)}% of ${megabytes(progress.total)}` : ` ${megabytes(progress.downloaded)}`;
          sayProgress(`Downloading the new interface…${share}`, cancel);
        });
        if (live) {
          const outcome = await bounded(live);
          if (outcome === "cancelled") { setUpdateState({ kind: "idle" }); return; }
          if (outcome === "unreachable") { setUpdateState({ kind: "idle" }); toast.error("Could not reach the server to update."); return; }
          if (outcome === "applying") { step = "reloading the new interface"; setUpdateState({ kind: "working", label: "Opening the new interface…" }); await bounded(new Promise(() => {})); }
          setUpdateState({ kind: "checking" });
        }
      }
      step = "looking for a newer app";
      if (!quiet) setUpdateState({ kind: "working", label: "Looking for a newer app…", onCancel: cancel });
      const result = await bounded(shell.prepareUpdate((progress) => {
        if (quiet) {
          if (manualCheck) return;
          const share = progress.total ? Math.round((progress.downloaded / progress.total) * 100) : 0;
          sayProgress(`Update available · downloading ${share}%`);
          return;
        }
        step = `downloading ${progress.version}`;
        touch();
        const share = progress.total ? Math.round((progress.downloaded / progress.total) * 100) : 0;
        sayProgress(`Downloading ${progress.version}… ${share}%`, cancel);
      }, quiet));
      if (result.kind === "ready") setUpdateState({ kind: "ready" });
      else if (!quiet) sayUpToDate();
    } catch (error) {
      if (!quiet) { setUpdateState({ kind: "idle" }); if (!cancelled) showError(error); }
      else if (!manualCheck && updateState().kind === "working") setUpdateState({ kind: "idle" });
    } finally {
      clearTimeout(timer);
      if (quiet) quietCheck = false;
      else manualCheck = false;
    }
  };
  const [addingServer, setAddingServer] = createSignal(false);
  const connectSeen = createMemo<boolean>((seen) => seen || addingServer(), false);
  const runPwaUpdate = async () => {
    if (pwaUpdating()) return;
    if (updateShell) {
      await prepareDesktopUpdate(false);
      return;
    }
    setPwaUpdating(true);
    try {
      // A true return is followed by the reload. An unreachable server can leave the worker's fetch hanging, so it
      // gives up after the two minutes a new build gets to install.
      const updated = await Promise.race([forcePwaUpdate(), new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Could not check for updates. Try again when the server is reachable.")), UPDATE_CHECK_TIMEOUT_MS))]);
      if (!updated) sayUpToDate();
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
  // An upgrade waits until nothing is busy: a route change repaints a terminal and reopens a stream while somebody
  // watches output arrive.
  startPathSelection({
    busy: () => [...runtime.processes().values()].some((process) => process.active || process.waiting),
  });
  let hasConnected = false;
  createEffect(() => {
    if (runtime.connectivity() !== "online") return;
    if (hasConnected) void checkForPwaUpdate().catch(() => {});
    hasConnected = true;
    // Asked while the app is still connecting, it fails and the sidebar loses jbot's row until the next poll.
    void refreshAgent();
  });
  // The first open is shown before the stream's first frame, so the server counts as there until a connection fails.
  const serverReachable = () => !["reconnecting", "offline"].includes(runtime.connectivity());
  hubAway = () => runtime.connectivity() !== "online";
  const drafts = createDrafts(showError);
  /*
   * The waiting messages of chats nobody has open (an open chat sends its own over its stream), one at a time per chat:
   * the next waits until the turn the last started has been seen to run and end. One whose fate is unknown is never
   * sent twice; it goes into the chat's draft instead.
   */
  const sentElsewhere = new Map<string, { at: number; seen: boolean }>();
  const sendWaitingElsewhere = createSingleFlight(async () => {
    if (runtime.connectivity() !== "online") return;
    for (const chatId of outboxChats()) {
      if (outboxIsOpen(chatId)) continue;
      const active = Boolean(runtime.getProcess(chatId)?.active);
      const last = sentElsewhere.get(chatId);
      if (last) {
        if (active) { last.seen = true; continue; }
        if (!last.seen && Date.now() - last.at < 60_000) continue;
        sentElsewhere.delete(chatId);
      }
      if (active) continue;
      const next = outboxOf(chatId)[0];
      const entry = next ? takeFromOutbox(chatId, next.messageId) : null;
      if (!entry) continue;
      const projectId = catalogue.projects().find((project) => project.sessions.some((session) => session.id === chatId))?.id || "";
      try {
        await api(`/v0/chats/${encodeURIComponent(chatId)}/prompt`, { method: "POST", timeout: false,
          body: JSON.stringify({ messageId: entry.messageId, message: entry.message, attachmentIds: [], projectId }) });
        sentElsewhere.set(chatId, { at: Date.now(), seen: false });
      } catch (error) {
        if ((error as { apiRequest?: ApiRequestMetadata }).apiRequest?.status === 404) continue;
        const text = parseReviewComments(entry.message).text;
        const held = drafts.draftFor(chatId)?.text || "";
        drafts.save(chatId, held ? `${held}\n${text}` : text, []);
      }
    }
  });
  createEffect(() => {
    if (runtime.connectivity() !== "online") return;
    runtime.processes();
    untrack(() => void sendWaitingElsewhere());
  });


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

  const profiles = createMemo<Template[]>(() => {
    const ordinary = templates().filter((item) => item.defaultable !== false);
    return [...ordinary, ...externalProfiles()];
  });
  const approvalsFor = (chatId: string | null) => chatId ? {
    asks: () => (agentView()?.asks ?? []).filter((ask) => ask.chatId === chatId),
    answer: async (id: string, choice: "allow" | "always" | "deny") => {
      try { await api(`/v0/agent/asks/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ choice }) }); }
      catch (error) { showError(error); }
      await refreshAgent();
    },
    refresh: () => void refreshAgent(),
  } : undefined;
  const agentThread = (id: string | null | undefined) => { const view = agentView(); return Boolean(id && (view?.home?.chatId === id || view?.sides?.some((side) => side.chatId === id))); };
  const profilesAt = (project?: Project | null) => {
    const allowed = project?.capabilities && !project.capabilities.device.local ? project.capabilities.harnesses : null;
    return allowed ? profiles().filter((profile) => allowed.includes(profile.implementation || "conduit-runtime")) : profiles();
  };
  const session = createChatSession({
    catalogue,
    selectedChat: () => catalogue.selected()?.chat,
    projects: catalogue.projects,
    runtime,
    drafts,
    maxAttachmentBytes,
    harnessCapabilities,
    profiles,
    defaultTemplateId,
    saveWorkspaceDefault,
    onError: showError,
    onThinkingLevelRecovered: ({ from, to }) => {
      const label = (level: string) => level ? level[0]!.toUpperCase() + level.slice(1) : "Off";
      toast.info(`Saved thinking level ${label(from)} is no longer available. Using ${label(to)}.`, {
        id: "thinking-level-recovery",
        duration: 6_000,
      });
    },
    onModelRecovered: ({ from, to, reason }) => toast.warning(`This chat's previous model ${from} is ${reason === "unavailable" ? "no longer available" : "no longer scoped"}. It resumed with ${to}.`, {
      id: "model-scope-recovery",
      duration: 6_000,
    }),
  });
  const { chat, models, permissions, serviceLevels, attachments, activeProfile } = session;
  const paneSlots: PaneSlot[] = SLOT_IDS.map((index) => {
    const [host, setHost] = createSignal<HTMLElement>();
    return {
      index, host, setHost, draft: null,
      session: createSideChat({
        runtime, projects: catalogue.projects, refresh: catalogue.refresh, patchChat: catalogue.patchChat, drafts, maxAttachmentBytes,
        harnessCapabilities, profiles, onError: showError, defaultTemplateId, saveWorkspaceDefault,
      }),
    };
  });
  const paneSlot = (slot: number) => paneSlots[slot]!;
  const jbotSession = createSideChat({
    runtime, projects: catalogue.projects, refresh: catalogue.refresh, patchChat: catalogue.patchChat, drafts, maxAttachmentBytes,
    harnessCapabilities, profiles, onError: showError, defaultTemplateId, saveWorkspaceDefault,
  });
  // Not awaited: a round trip in front of first paint is a poor price for a race that asking again closes.
  void drafts.load().then(() => chat.rehydrateDraft());

  // On a phone it is said when the sidebar first opens, where the row is seen.
  if (arrivedByNewBuild()) {
    if (!isMobileLayout() || mobileSidebarOpen()) saySettled("updated");
    else {
      let said = false;
      createEffect(() => { if (!said && mobileSidebarOpen()) { said = true; saySettled("updated"); } });
    }
  }

  // With something in the composer a new build waits, and the effect below takes it the moment the composer empties,
  // without sending, discarding or clearing having to know this exists.
  if (import.meta.env.PROD && !nativeApp) {
    // An uploading attachment is a local `File` no server draft holds, and a draft write still in the air has to land
    // before the document goes, or the page comes back to a state neither copy agrees on.
    const composerDirty = () => Boolean(chat.draft().trim())
      || attachments.items().length > 0
      || !drafts.settled();
    // Said by the document that arrived, because the one that asked for it is gone.
    if (claimPwaUpdateArrival()) saySettled("updated");
    startPwaUpdates({
      hold: composerDirty,
      onUpdateReady: () => setUpdateState({ kind: "ready" }),
    });
    // Tracks the composer, not the update (`pwaUpdateWaiting` is a plain read): an update arriving while the composer
    // is empty is already handled by `hold`.
    createEffect(() => {
      if (composerDirty() || !pwaUpdateWaiting()) return;
      void takePwaUpdate();
    });
  }
  const selectedProject = createMemo(() => catalogue.projects().find((project) => project.id === catalogue.projectId()));
  const agentProject = () => catalogue.projects().find((project) => project.id === agentView()?.projectId);
  const dockHome = createMemo(() => ((routeKind() === "agent" || routeKind() === "jbot") ? undefined : selectedProject()) ?? agentProject());
  const chatManifest = session.manifest;
  const chatCapability = session.capability;
  const chatHistory = session.history;
  const openingLiveChat = createMemo(() => chat.presentation().kind === "opening_live");
  const withheldLiveChat = createMemo(() => chat.presentation().kind !== "ready");
  // jbot's threads always exist: never the new-chat welcome, even before anything happens in one.
  const emptyChat = createMemo(() => !withheldLiveChat() && chat.loadedId() === catalogue.selectedId() && !agentThread(chat.loadedId()) && !chat.messages().length && !chat.tools().length && !isChatContentActivity(chat.activity()));
  // A send leaves the empty layout at once, not when the agent has started and the message is in the transcript.
  const sendingOut = () => ["submitting", "active"].includes(chat.generation());
  const emptyLayout = createMemo(() => emptyChat() && !sendingOut());
  let chatComposerStack: HTMLDivElement | undefined;
  let emptyComposerTop: number | null = null;
  const noteEmptyComposer = () => {
    if (emptyLayout() && chatComposerStack) emptyComposerTop = chatComposerStack.getBoundingClientRect().top;
  };
  createEffect(on(emptyLayout, (empty, wasEmpty) => {
    if (empty) {
      requestAnimationFrame(noteEmptyComposer);
      return;
    }
    const from = emptyComposerTop;
    emptyComposerTop = null;
    if (!wasEmpty || from == null || !sendingOut() || routeKind() !== "chat") return;
    if (reducedMotion() || !chatComposerStack) return;
    // Measured and started in the same frame as the layout change, so the
    // docked composer is never painted before it sets off.
    const offset = from - chatComposerStack.getBoundingClientRect().top;
    if (Math.abs(offset) < 4) return;
    chatComposerStack.animate([{ transform: `translateY(${offset}px)` }, { transform: "none" }],
      { duration: duration("--duration-travel"), easing: easing("--ease-arrive") });
  }));
  // The composer moved is the inner wrap, so the stack's own rect, which the empty-chat travel measures, is never read
  // mid-flight.
  const leaveDashboard = (): Promise<DOMRect | null> => {
    const wrap = document.querySelector<HTMLElement>('.chat-main :is(.ui-composer-slot, .ui-phone-composer)');
    if (!wrap || reducedMotion()) return Promise.resolve(null);
    const from = wrap.getBoundingClientRect();
    document.documentElement.dataset.routeMotion = "leaving";
    return new Promise((resolve) => setTimeout(() => resolve(from), duration("--duration-quick")));
  };
  const sendFromDashboard = async () => {
    const sending = chat.send().catch(() => undefined);
    const from = await leaveDashboard();
    showRoute({ kind: "chat" });
    arriveInChat(from);
    await sending;
  };
  const arriveInChat = (from: DOMRect | null) => {
    const root = document.documentElement;
    if (!from) return void delete root.dataset.routeMotion;
    requestAnimationFrame(noteEmptyComposer);
    root.dataset.routeMotion = "arriving";
    const wrap = chatComposerStack?.querySelector<HTMLElement>(':is(.ui-composer-slot, .ui-phone-composer)');
    if (wrap) {
      const to = wrap.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top - to.top;
      if (Math.abs(dx) + Math.abs(dy) >= 4) wrap.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: duration("--duration-travel"), easing: easing("--ease-arrive") });
    }
    whenMotionEnds(null, "transform", "--duration-travel", () => { if (root.dataset.routeMotion === "arriving") delete root.dataset.routeMotion; });
  };
  onMount(() => {
    window.addEventListener("resize", noteEmptyComposer);
    onCleanup(() => window.removeEventListener("resize", noteEmptyComposer));
  });
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

  // A render effect, not an ordinary one: an effect runs after the DOM is committed, so the panel would paint closed
  // and then snap open. Resolving during render puts the stored geometry in the first paint.
  createRenderEffect(() => {
    const scope = workspacePanelScope();
    if (!scope) return;
    const globalOpen = readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "open");
    const globalExpanded = readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "expanded");
    const open = globalOpen ?? (scope === "computer" ? "true" : "false");
    const expanded = globalExpanded ?? "false";
    if (globalOpen === null) writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "open", open);
    if (globalExpanded === null) writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "expanded", expanded);
    setPanelOpen(open === "true");
    setWorkspaceExpanded(expanded === "true", false);
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
      if (isMobileLayout()) document.querySelector<HTMLElement>("[data-header-more]")?.focus({ preventScroll: true });
      else focusChatPane();
    }
    if (!next) setWorkspaceExpanded(false);
    setPanelOpen(next);
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "open", String(next));
  };

  const setMobileSidebar = (open: boolean) => {
    if (open && panelOpen() && isMobileLayout()) setPanelOpenForChat(false);
    setMobileSidebarOpen(open);
  };

  onMount(() => onCleanup(drawerSwipe({
    phone: isMobileLayout,
    open: mobileSidebarOpen,
    setOpen: setMobileSidebar,
    other: { open: panelOpen, setOpen: setPanelOpenForChat, available: () => Boolean(workspacePanelScope()) },
  })));

  // A draft whose first message is on its way (its agent still starting) is not abandoned by leaving it: the message
  // is handed over and the chat becomes a real one.
  const currentDraftId = () => chat.status() === "draft" && chat.generation() !== "submitting" ? catalogue.selectedId() : null;

  // A draft is still selected after it is discarded until something else is,
  // so leaving page after page asks to discard it again: once is enough, and a
  // draft already gone is discarded.
  const discarded = new Set<string>();
  const discardDraft = async (id = currentDraftId()) => {
    if (!id || discarded.has(id)) return;
    discarded.add(id);
    await api(`/v0/chats/${encodeURIComponent(id)}?ifEmpty=true`, { method: "DELETE" }).catch((error) => {
      if ((error as { error?: unknown }).error !== "chat_not_found") { discarded.delete(id); throw error; }
    });
    dropScope(id);
  };

  const discardDraftImmediately = (id: string | null) => {
    if (!id) return;
    // Only the folder that lists it changes, and once the chat opening in its place is drawn: its row going re-renders
    // that folder, ~7ms of the open.
    const drop = () => catalogue.setProjects((current) => current.map((project) => project.sessions.some((session) => session.id === id)
      ? { ...project, sessions: project.sessions.filter((session) => session.id !== id) } : project));
    if ("requestIdleCallback" in window) requestIdleCallback(drop, { timeout: 1000 }); else setTimeout(drop, DRAFT_DROP_FALLBACK_MS);
    void discardDraft(id).catch(showError);
  };

  const abandonCurrentDraft = () => discardDraftImmediately(currentDraftId());

  const newChatRequest = createLatest();
  const abandonPendingNewChat = newChatRequest.drop;
  const leaveChat = (preserveDraft: boolean) => {
    abandonPendingNewChat();
    if (!preserveDraft) abandonCurrentDraft();
  };

  // The store holds one profile's models at a time: seeding a launch from another profile's asks for a model it has
  // never heard of and the launch is refused. The server may hand back an untouched draft it kept warm: it is ours
  // again, to discard again.
  const createProfileChat = (project: Project, profileId: string, chosen = models) => api<ChatSummary>("/v0/chats", {
    method: "POST",
    body: JSON.stringify({
      projectId: project.id,
      profileId,
      warm: true,
      ...(chosen.profile() === profileId ? { model: chosen.model(), thinkingLevel: chosen.effort() } : {}),
    }),
  }).then((created) => { discarded.delete(created.id); return created; });

  const activateCreatedChat = async (created: ChatSummary, project: Project, profileId: string) => {
    await chat.initialize({ ...created, templateId: created.templateId || profileId || undefined }, project);
  };

  const projectProfile = (project: Project) => project.defaultTemplateId || defaultTemplateId() || "assistant";
  const createChat = async (target?: Project, launch: { templateId?: string; runtimeKind?: string } = {}, options: { reportFailure?: boolean } = {}) => {
    const reportFailure = options.reportFailure !== false;
    if (!(await leaveHarnessThread())) return null;
    const project = target || selectedProject() || catalogue.projects().find((item) => item.slug === "chat") || catalogue.projects()[0];
    if (!project) return null;
    const current = newChatRequest.next();
    const replacedDraftId = currentDraftId();
    const fromDashboard = routeKind() === "project" || routeKind() === "dashboard" || routeKind() === "computer" || (routeKind() === "agent" || routeKind() === "jbot");
    const profileId = launch.templateId || projectProfile(project);
    discardDraftImmediately(replacedDraftId);
    chat.reset(profileId);
    attachments.clear({ discard: false });
    catalogue.selectProject(project);
    showRoute({ kind: "chat" });
    try {
      const created = await createProfileChat(project, profileId);
      if (!current()) {
        discardDraftImmediately(created.id);
        return null;
      }
      const ownerProject = project;

      const activation = activateCreatedChat(created, ownerProject, profileId);
      batch(() => {
        if (fromDashboard) history.pushState({}, "", chatPath(created.id));
        else history.replaceState({}, "", chatPath(created.id));
      });
      catalogue.setProjects((current) => current.map((item) => {
        if (item.id === ownerProject.id) {
          return { ...item, sessions: [created, ...item.sessions.filter((session) => session.id !== created.id)] };
        }
        return item;
      }));
      await activation;
      return created;
    } catch (error) {
      if (reportFailure) showError(error);
      else throw error;
      return null;
    }
  };

  // A phone keeps a place's new chat on a chat page of its own, since a page is busy to start from there.
  const startNewChat = async (target?: Project) => {
    const project = target || selectedProject();
    if (project && project.slug !== "chat") {
      if (isMobileLayout()) { await createChat(project); return; }
      if (routeKind() !== "project" || selectedProject()?.id !== project.id) await openProject(project);
      requestAnimationFrame(() => requestAnimationFrame(focusComposer));
      return;
    }
    if (routeKind() !== "dashboard") await openDashboard();
    requestAnimationFrame(() => requestAnimationFrame(focusComposer));
  };

  let dashboardDraftRequest: Promise<void> | null = null;
  // The page whose draft could not be made: not asked again on every catalogue change, only once the page is left.
  let draftFailedFor: string | null = null;
  const ensureDashboardDraft = () => {
    const route = routeKind();
    if (!["dashboard", "project"].includes(route)) draftFailedFor = null;
    if (dashboardDraftRequest || !["dashboard", "project"].includes(route)
      || chat.loadedId() || catalogue.selectedId() || templatesLoading()) return;
    const project = route === "project"
      ? selectedProject()
      : catalogue.projects().find((item) => item.slug === "chat") || catalogue.projects()[0];
    if (!project || project.state === "cloning") return;
    const failedKey = `${route}:${project.id}`;
    if (draftFailedFor === failedKey) return;
    const templateId = projectProfile(project);
    const expectedRoute = route;
    const expectedProjectId = project.id;
    let scopeChanged = false;
    dashboardDraftRequest = createProfileChat(project, templateId).then(async (created) => {
      if (routeKind() !== expectedRoute || (expectedRoute === "project" && selectedProject()?.id !== expectedProjectId)) {
        scopeChanged = true;
        await api(`/v0/chats/${encodeURIComponent(created.id)}?ifEmpty=true`, { method: "DELETE" });
        dropScope(created.id);
        return;
      }
      await activateCreatedChat(created, project, templateId);
    }).catch((error) => { draftFailedFor = failedKey; showDraftError(error); }).finally(() => {
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

  const openDashboard = async (historyMode: "push" | "replace" | "none" = "push") => {
    if (routeKind() === "dashboard" && routeBootstrap() === "ready" && historyMode !== "none") {
      setMobileSidebarOpen(false);
      return;
    }
    if (!(await leaveHarnessThread())) return;
    leaveChat(historyMode === "none");
    chat.reset();
    const chatRoot = catalogue.projects().find((project) => project.slug === "chat");
    if (chatRoot) catalogue.selectProject(chatRoot);
    setMobileSidebarOpen(false);
    showRoute({ kind: "dashboard" });
    if (historyMode === "push") history.pushState({}, "", "/");
    else if (historyMode === "replace") history.replaceState({}, "", "/");
  };

  const openJbotPage = async (kind: "agent" | "jbot", historyMode: "push" | "none", preview = false) => {
    if (!preview) {
      clearTimeout(previewTimer);
      const adopting = previewFrom?.jbot && routeKind() === kind;
      previewFrom = null;
      if (adopting) { if (historyMode === "push") history.pushState({}, "", kind === "agent" ? "/jbot/page" : "/jbot"); shutDrawerOnto(Promise.resolve()); return; }
    }
    if (!(await leaveHarnessThread())) return;
    leaveChat(historyMode === "none");
    chat.reset();
    // A phone's drawer shuts onto it once it is drawn, as onto a chat (shutDrawerOnto), not before it is there; drawn
    // under a press on its row (previewJbot), it stays open until the tap.
    if (!preview) shutDrawerOnto(Promise.resolve());
    setWorkspaceViewRequest(null);
    showRoute({ kind: kind });
    if (historyMode === "push") history.pushState({}, "", kind === "agent" ? "/jbot/page" : "/jbot");
  };
  const openAgent = (historyMode: "push" | "none" = "push") => openJbotPage("agent", historyMode);
  const openJbot = (historyMode: "push" | "none" = "push") => openJbotPage("jbot", historyMode);
  const openJbotThread = async () => {
    const id = (await refreshAgent())?.home?.chatId;
    if (!id) return openJbot("none");
    const target = await agentChat(id);
    await openChatHere(target.chat, target.project);
  };
  onMount(() => { if (location.pathname === JBOT_THREAD_PATH && !initialRouteId) void openJbotThread().catch(showError); });

  const computerRequest = createLatest();
  let computerController: AbortController | undefined;
  let computerPrefetchController: AbortController | undefined;
  const computerFolders = new Map<string, ComputerLocation>();
  onCleanup(() => { computerController?.abort(); computerPrefetchController?.abort(); });
  const cacheComputerFolder = (location: ComputerLocation) => {
    computerFolders.delete(location.project.workingRoot);
    computerFolders.set(location.project.workingRoot, location);
    while (computerFolders.size > 24) computerFolders.delete(computerFolders.keys().next().value!);
  };
  const prefetchComputerFolders = (location: ComputerLocation) => {
    const paths = location.listing.entries
      .filter((entry) => entry.type === "directory" && !entry.name.startsWith("."))
      .filter((entry) => !computerFolders.has(`${location.project.workingRoot}/${entry.path}`))
      .slice(0, 8)
      .map((entry) => entry.path);
    computerPrefetchController?.abort();
    if (!paths.length) return;
    computerPrefetchController = new AbortController();
    void api<ComputerPrefetchPayload>("/v0/computer/prefetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: location.project.id, paths }),
      signal: computerPrefetchController.signal,
    }).then((payload) => payload.locations.forEach(cacheComputerFolder)).catch((error) => {
      if ((error as { name?: string }).name !== "AbortError") console.warn("Computer prefetch failed", error);
    });
  };
  const computerPrefetching = new Set<string>();
  const prefetchComputerFolder = (relativePath: string) => {
    const location = computerLocation();
    if (!location) return;
    const absolutePath = `${location.project.workingRoot}/${relativePath}`;
    if (computerFolders.has(absolutePath) || computerPrefetching.has(absolutePath)) return;
    computerPrefetching.add(absolutePath);
    void api<ComputerPrefetchPayload>("/v0/computer/prefetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: location.project.id, paths: [relativePath] }),
    }).then((payload) => payload.locations.forEach(cacheComputerFolder)).catch(() => {}).finally(() => computerPrefetching.delete(absolutePath));
  };
  const browseComputer = async (path?: string) => {
    const current = computerRequest.next();
    computerController?.abort();
    computerController = new AbortController();
    const cached = computerFolders.get(path || computerLocation()?.home || "");
    if (cached) {
      batch(() => { setComputerFile(null); setComputerLocation(cached); });
    }
    setComputerLoading(!cached);
    setComputerError("");
    try {
      const location = await api<ComputerLocation>(`/v0/computer${path ? `?path=${encodeURIComponent(path)}` : ""}`, { signal: computerController.signal });
      if (!current()) return;
      cacheComputerFolder(location);
      batch(() => { setComputerFile(null); setComputerLocation(location); });
      prefetchComputerFolders(location);
      if (routeKind() === "computer") {
        toast.dismiss("computer-workspace-prompt");
        const workspace = catalogue.projects().find((project) => !isConduitManagedProject(project) && project.workingRoot === location.project.workingRoot);
        if (workspace) toast.info(`This folder is the ${workspace.name} workspace.`, {
          id: "computer-workspace-prompt",
          action: { label: "Open workspace", onClick: () => void openProject(workspace) },
        });
      }
    } catch (error) {
      if (current()) setComputerError(error instanceof Error ? error.message : "Folder could not be opened");
    } finally {
      if (current()) setComputerLoading(false);
    }
  };
  const designateComputerWorkspace = async () => {
    const location = computerLocation();
    if (!location) return;
    const existing = catalogue.projects().find((project) => !isConduitManagedProject(project) && project.workingRoot === location.project.workingRoot);
    if (existing) { await openProject(existing); return; }
    try {
      const created = await api<Project>("/v0/projects", { method: "POST", body: JSON.stringify({ mode: "linked", path: location.project.workingRoot }) });
      const projects = await catalogue.refresh();
      await openProject(projects.find((project) => project.id === created.id) || { ...created, sessions: [] });
    } catch (error) { showError(error); }
  };
  const createComputerWorkspace = async (path: string) => {
    const existing = catalogue.projects().find((project) => !isConduitManagedProject(project) && project.workingRoot === path);
    if (existing) return;
    try {
      const created = await api<Project>("/v0/projects", { method: "POST", body: JSON.stringify({ mode: "linked", path }) });
      await refresh();
      toast.success(`${created.name} is now a workspace`);
    } catch (error) { showError(error); }
  };
  const openComputerTerminalHere = async () => {
    const location = computerLocation();
    if (!location) return;
    try {
      const terminal = await api<Pty>("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: "computer", cwd: location.project.workingRoot }) });
      window.dispatchEvent(new Event("conduit:ptys-changed"));
      await openWorkspaceView("terminal", terminal.id);
    } catch (error) { showError(error); }
  };

  const renderEnvironment = (nodeId: string, slot: number | "main") => <EnvironmentPage nodeId={nodeId} projects={catalogue.projects()}
    header={(title) => <ChatHeader title={title} tabActions={paneTabActions(slot)} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} appDashboard alone />}
    onOpenWorkspace={(project) => void openProjectHere(project)}
    onMount={(path) => void addProject({ mode: "node", nodeId, path })}
    onOpenTerminal={() => void openDeviceTerminal({ id: nodeId })} />;
  const renderPaneComputer = (slot: number) => {
    const [location, setLocation] = createSignal<ComputerLocation | null>(computerLocation());
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal("");
    const request = createLatest();
    const browse = async (path?: string) => {
      const current = request.next();
      const cached = computerFolders.get(path || location()?.home || "");
      if (cached) setLocation(cached);
      setLoading(!cached);
      setError("");
      try {
        const next = await api<ComputerLocation>(`/v0/computer${path ? `?path=${encodeURIComponent(path)}` : ""}`);
        if (!current()) return;
        cacheComputerFolder(next);
        setLocation(next);
        prefetchComputerFolders(next);
      } catch (failure) {
        if (current()) setError(failure instanceof Error ? failure.message : "Folder could not be opened");
      } finally {
        if (current()) setLoading(false);
      }
    };
    if (!location()) void browse();
    return <>
      <ChatHeader title={activeServer()?.name || "Hub"} tabActions={paneTabActions(slot)} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} appDashboard alone />
      <ComputerDashboard projects={catalogue.projects()} location={location()} loading={loading()} error={error()} onOpenHarnessHere={(id) => setSlotView(slot, `page:harness:${encodeURIComponent(id)}`)} onOpenHarness={(id) => setSlotView(slot, `page:harness:${encodeURIComponent(id)}`)} onBrowse={(path) => void browse(path)} onPrefetch={prefetchComputerFolder} onMakeWorkspace={() => { const here = location(); if (here) void createComputerWorkspace(here.project.workingRoot); }} onCreateWorkspace={(path) => void createComputerWorkspace(path)} onOpenWorkspace={(project) => void openProjectHere(project)} onManageWorkspace={(action, project) => { if (action === "rename") runSidebar("rename-folder", { project }); else if (action === "identity") openWorkspaceIdentity(project); else runSidebar("delete-project", { project }); }} onStartWorkspaceAction={(action, path) => runSidebar(action === "created" ? "new-workspace-created" : "new-workspace-cloned", { path })} onOpenView={openWorkspaceView} onOpenTerminalView={() => openTerminalRoute()} onOpenTerminalHere={() => void openComputerTerminalHere()} onOpenFile={async (path) => { const here = location(); if (here) await openFileDocument({ projectId: here.project.id, path }, { ...verbNow(), edit: false }); }} />
    </>;
  };
  const HarnessDraftComposer = (props: {
    harnessId: () => string;
    session: ChatSession;
    input: Parameters<NonNullable<ComponentProps<typeof HarnessDashboard>["composer"]>>[0];
    draft: HarnessDraft;
    serviceLevels?: boolean;
    modelSelectorShortcut?: boolean;
  }) => {
    const drafted = () => props.draft.made(props.harnessId());
    const choices = (): HarnessChoices => drafted()
      ? { model: props.session.models.model(), thinkingLevel: props.session.models.effort(), permissionMode: props.session.permissions.selected() }
      : props.input.choices;
    createEffect(on(() => props.input.folder.current, (cwd) => {
      if (untrack(drafted)) void props.draft.ensure(props.harnessId(), cwd, untrack(choices));
    }, { defer: true }));
    const manifest = () => harnessCapabilities()[harnessProfile(props.harnessId())?.implementation || props.harnessId()] || null;
    const use = () => props.draft.ensure(props.harnessId(), props.input.folder.current, choices());
    return <div style={{ display: "contents" }}
      onInput={(event) => { if (event.target instanceof HTMLTextAreaElement) props.draft.setTyped(event.target.value); void use(); }}>
      <Composer shortcuts={shortcutManager} chat={props.session.chat} launches supports={(name) => resolveCapability(manifest(), props.session.chat.capabilities(), name, false)} attachments={props.session.attachments} attachmentsSupported={Boolean(manifest()?.attachments)} models={drafted() ? props.session.models : props.input.models} modelsLoading={drafted() ? undefined : props.input.loading} folder={props.input.folder} permissions={manifest()?.permissionModes ? (drafted() ? props.session.permissions : props.input.permissions) : undefined} serviceLevels={props.serviceLevels && manifest()?.serviceLevels?.length ? props.session.serviceLevels : undefined} profiles={harnessProfile(props.harnessId()) ? [harnessProfile(props.harnessId())!] : []} activeProfile={harnessProfile(props.harnessId())} onOpenModelSelector={openModelSelector} modelSelectorShortcut={props.modelSelectorShortcut ? shortcutManager.formatEffectiveBinding(COMMAND_IDS.openModelSelector) : undefined} serverOnline={serverReachable()} voiceSettings={voiceSettings()} onChooseProfile={() => {}} onOpenSettings={openSettings} onOpenAttachments={() => void use().then(() => props.session.openAttachments())} onSendDraft={(prompt) => props.draft.send(props.harnessId(), props.input.folder.current, choices(), prompt)} />
    </div>;
  };
  const renderPaneHarness = (pane: PaneSlot, harnessId: string) => {
    const side = pane.session;
    const [scope, setScope] = createSignal<string | null>(null);
    const here = () => untrack(() => slotView(pane.index)) === `page:harness:${encodeURIComponent(harnessId)}`;
    const draft = createHarnessDraft({
      chat: side.chat, here, failed: showDraftError,
      open: (opened) => side.open(opened.chat, opened.project),
      start: (made) => { paneThreads.set(pane.index, made.chatId); return setSlotView(pane.index, `chat:${made.chatId}`); },
    });
    onCleanup(() => { const left = draft.current(); if (left) { if (untrack(side.chat.loadedId) === left.chatId) side.close(); draft.drop(left.chatId); } });
    return <>{<ChatHeader title={harnessLabelFor(harnessId) || harnessId} tabActions={paneTabActions(pane.index)} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} appDashboard alone />}<HarnessDashboard harnessId={harnessId} projects={catalogue.projects()} runtime={runtime} scope={scope()} onScope={setScope} home={computerLocation()?.home || ""}
      composer={(input) => <HarnessDraftComposer harnessId={() => harnessId} session={side} input={input} draft={draft} />}
      onStartThread={(launch) => draft.send(harnessId, launch.cwd, launch, launch.prompt)} onOpenThread={(thread) => void openHarnessThread(thread)} onOpenChat={(target, project) => void openChatFromPage(target, project)} /></>;
  };
  const paneThreads = new Map<number, string>();
  // Subagents' transcripts: chats the lists do not show, kept here so a pane holding one finds it as it finds a listed
  // chat.
  const [hiddenChats, setHiddenChats] = createSignal<ReadonlyMap<string, { chat: ChatSummary; project: Project }>>(new Map());
  // `environment` is set with the rest, never "" first: the view would read as the hub's for a moment, and following
  // it would open that.
  const openComputer = async (historyMode: "push" | "none" = "push", environment = "") => {
    if (!(await leaveHarnessThread())) return;
    leaveChat(historyMode === "none");
    chat.reset();
    const chatRoot = catalogue.projects().find((project) => project.slug === "chat");
    if (chatRoot) catalogue.selectProject(chatRoot);
    setMobileSidebarOpen(false);
    setWorkspaceViewRequest(null);
    showRoute({ kind: "computer", environment });
    if (!environment && !computerLocation()) void browseComputer();
    if (historyMode === "push") history.pushState({}, "", environment ? `/computer/environment/${encodeURIComponent(environment)}` : "/computer");
  };
  const openEnvironment = (nodeId: string, historyMode: "push" | "none" = "push") => openComputer(historyMode, nodeId);
  const harnessPath = (id: string, cwd?: string | null) => `/computer/harness/${encodeURIComponent(id)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`;
  // A thread just started has no id of its own yet, so it is addressed by the
  // chat it runs as.
  const threadPath = (thread: HarnessThreadTarget) => `/computer/harness/${encodeURIComponent(thread.harnessId)}/thread/${encodeURIComponent(thread.id || `c:${thread.chatId}`)}?cwd=${encodeURIComponent(thread.path)}`;
  const [harnessScope, setHarnessScope] = createSignal<string | null>(null);
  const [harnessThread, setHarnessThread] = createSignal<HarnessThreadTarget | null>(null);
  const [trackingThread, setTrackingThread] = createSignal(false);
  // Where the page is, written in one step, so no part of the last place is left standing beside the new one.
  type Place = { kind: "chat" | "project" | "dashboard" | "agent" | "jbot" }
    | { kind: "terminal"; terminalId?: string }
    | { kind: "computer"; harness?: string; environment?: string; scope?: string | null };
  const showRoute = (place: Place) => batch(() => {
    const computer = place.kind === "computer" ? place : null;
    setRouteKind(place.kind);
    setComputerHarness(computer?.harness || "");
    setComputerEnvironment(computer?.environment || "");
    setHarnessScope(computer?.scope ?? null);
    if (place.kind === "terminal") setTerminalRouteId(place.terminalId);
    setRouteBootstrapError("");
    setRouteBootstrap("ready");
  });
  const holdUnload = (event: BeforeUnloadEvent) => { if (harnessThread() && chat.streaming()) event.preventDefault(); };
  window.addEventListener("beforeunload", holdUnload);
  onCleanup(() => window.removeEventListener("beforeunload", holdUnload));
  const leaveHarnessThread = async () => {
    const open = harnessThread();
    if (!open) return true;
    if (chat.streaming() && !(await confirmDialog(`${harnessLabelFor(open.harnessId) || "The harness"} is still working in this thread. Leave and stop it?`))) return false;
    if (harnessThread() !== open) return false;
    setHarnessThread(null);
    // Let go of it first, so nothing after this takes it for a draft to discard.
    if (catalogue.selectedId() === open.chatId) { chat.reset(); catalogue.setSelectedId(null); }
    if (open.chatId) void api(`/v0/sessions/${encodeURIComponent(open.chatId)}`, { method: "DELETE" }).catch(() => {});
    return true;
  };
  const openComputerHarness = async (id: string | null, historyMode: "push" | "replace" | "none" = "push", cwd?: string) => {
    if (!id) return await openComputer(historyMode === "none" ? "none" : "push");
    if (!(await leaveHarnessThread())) return;
    leaveChat(historyMode === "none");
    chat.reset();
    setMobileSidebarOpen(false);
    setWorkspaceViewRequest(null);
    showRoute({ kind: "computer", harness: id, scope: cwd || null });
    if (cwd) void browseComputer(cwd);
    else if (!computerLocation()) void browseComputer();
    if (historyMode === "push") history.pushState({}, "", harnessPath(id, cwd));
    else if (historyMode === "replace") history.replaceState({}, "", harnessPath(id, cwd));
  };
  const openComputerHarnessHere = (id: string, cwd: string) => openComputerHarness(id, "push", cwd);
  const scopeHarness = (path: string | null) => {
    setHarnessScope(path);
    history.replaceState({}, "", harnessPath(computerHarness(), path));
    if (path) void browseComputer(path);
  };
  const showHarnessThread = (target: HarnessThreadTarget, historyMode: "push" | "replace" | "none") => {
    leaveChat(historyMode === "none");
    chat.reset();
    setMobileSidebarOpen(false);
    setWorkspaceViewRequest(null);
    batch(() => { showRoute({ kind: "computer", harness: target.harnessId, scope: target.path }); setHarnessThread(target); });
    void browseComputer(target.path);
    if (historyMode === "push") history.pushState({}, "", threadPath(target));
    else if (historyMode === "replace") history.replaceState({}, "", threadPath(target));
  };
  type OpenedThread = { chat: ChatSummary; project: Project; tracked: boolean };
  const openThreadChat = (harnessId: string, body: Record<string, unknown>) => api<OpenedThread>(
    `/v0/harnesses/${encodeURIComponent(harnessId)}/threads/open`, { method: "POST", body: JSON.stringify(body), timeout: false });
  const openHarnessThread = async (target: HarnessThreadTarget, historyMode: "push" | "replace" | "none" = "push") => {
    const open = harnessThread();
    if (open?.harnessId === target.harnessId && (target.id ? open.id === target.id : open.chatId === target.chatId)) return;
    if (!(await leaveHarnessThread())) return;
    showHarnessThread(target, historyMode);
    try {
      const opened = await openThreadChat(target.harnessId, target.chatId ? { chatId: target.chatId } : { path: target.path, sessionId: target.id });
      if (harnessThread() !== target) {
        if (!opened.tracked) void api(`/v0/sessions/${encodeURIComponent(opened.chat.id)}`, { method: "DELETE" }).catch(() => {});
        return;
      }
      if (opened.tracked) {
        const owner = catalogue.projects().find((item) => item.id === opened.chat.projectId) || opened.project;
        await chat.select(opened.chat, owner, { history: "replace", onCommit: () => {
          batch(() => { setHarnessThread(null); showRoute({ kind: "chat" }); });
        } });
        return;
      }
      target = { ...target, chatId: opened.chat.id, title: opened.chat.title || target.title };
      setHarnessThread(target);
      await chat.select(opened.chat, opened.project, { history: "none" });
    } catch (error) {
      if (harnessThread() !== target) return;
      showError(error);
      setHarnessThread(null);
      await openComputerHarness(target.harnessId, "replace", target.path);
    }
  };
  // The draft chat is made when the composer is first used rather than on arrival, so looking through folders leaves
  // nothing behind in them.
  type HarnessDraft = ReturnType<typeof createHarnessDraft>;
  const createHarnessDraft = (on: {
    chat: ChatSession["chat"];
    here: (harnessId: string) => boolean;
    open: (opened: OpenedThread) => Promise<unknown>;
    start: (made: { harnessId: string; cwd: string; chatId: string }, prompt: string) => unknown;
    failed: (error: unknown) => void;
  }) => {
    const [current, setCurrent] = createSignal<{ harnessId: string; cwd: string; chatId: string } | null>(null);
    let request: Promise<void> | null = null;
    // Typing does not wait for the chat: what is typed while it is being made is
    // kept here, since opening the chat starts its composer empty.
    let typed = "";
    const drop = (id: string) => void api(`/v0/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    const made = (harnessId: string) => { const draft = current(); return Boolean(draft && draft.harnessId === harnessId && on.chat.loadedId() === draft.chatId); };
    const ensure = (harnessId: string, cwd: string, choices: HarnessChoices): Promise<void> => {
      if (request) return request.then(() => ensure(harnessId, cwd, choices));
      const before = current();
      if (!cwd || !on.here(harnessId) || (made(harnessId) && before!.cwd === cwd)) return Promise.resolve();
      typed = on.chat.draft();
      const pending: Promise<void> = openThreadChat(harnessId, { path: cwd, newThread: true, ...choices }).then(async (opened) => {
        if (!on.here(harnessId)) { drop(opened.chat.id); return; }
        setCurrent({ harnessId, cwd, chatId: opened.chat.id });
        await on.open(opened);
        if (typed && !on.chat.draft()) on.chat.setDraft(typed);
        typed = "";
        if (before && before.chatId !== opened.chat.id) drop(before.chatId);
      }).catch(on.failed).finally(() => { request = null; });
      request = pending;
      return pending;
    };
    const send = async (harnessId: string, cwd: string, choices: HarnessChoices, prompt: string) => {
      await ensure(harnessId, cwd, choices);
      const draft = current();
      if (!draft || on.chat.loadedId() !== draft.chatId || !on.here(harnessId)) return;
      await batch(() => { setCurrent(null); return on.start(draft, prompt); });
      on.chat.setDraft(prompt);
      await on.chat.send();
    };
    return { current, made, ensure, send, drop, setTyped: (text: string) => { typed = text; } };
  };
  const harnessDraft = createHarnessDraft({
    chat, failed: showError,
    here: (harnessId) => routeKind() === "computer" && computerHarness() === harnessId && !harnessThread(),
    open: (opened) => chat.select(opened.chat, opened.project, { history: "none" }),
    start: (made, prompt) => {
      const target: HarnessThreadTarget = { harnessId: made.harnessId, path: made.cwd, id: "", chatId: made.chatId,
        title: prompt.trim().split("\n")[0]?.slice(0, 80) || "New thread" };
      setHarnessScope(made.cwd);
      setHarnessThread(target);
      history.pushState({}, "", threadPath(target));
    },
  });
  const trackHarnessThread = async () => {
    const open = harnessThread();
    if (!open?.chatId || trackingThread()) return;
    setTrackingThread(true);
    try {
      let project = catalogue.projects().find((item) => !isConduitManagedProject(item) && item.workingRoot === open.path);
      if (!project) {
        const created = await api<Project>("/v0/projects", { method: "POST", body: JSON.stringify({ mode: "linked", path: open.path }) });
        project = (await catalogue.refresh()).find((item) => item.id === created.id) || { ...created, sessions: [] };
      }
      const tracked = await api<ChatSummary>(`/v0/chats/${encodeURIComponent(open.chatId)}/track`, {
        method: "POST", body: JSON.stringify({ projectId: project.id }),
      });
      const owner = (await catalogue.refresh()).find((item) => item.id === tracked.projectId) || project;
      await chat.select(tracked, owner, {
        history: "replace",
        onCommit: () => {
          batch(() => { setHarnessThread(null); showRoute({ kind: "chat" }); });
        },
      });
    } catch (error) { showError(error); }
    finally { setTrackingThread(false); }
  };
  const shareHarnessThread = async () => {
    try {
      const { origin } = await api<ShareOriginPayload>("/v0/share-origin");
      await navigator.clipboard.writeText(`${origin}${location.pathname}${location.search}`);
      toast.success("Tailscale thread link copied");
    } catch (error) { showError(error); }
  };
  const openComputerRoute = async () => {
    const match = location.pathname.match(/^\/computer\/harness\/([^/]+)(?:\/thread\/([^/]+))?$/);
    const cwd = new URLSearchParams(location.search).get("cwd") || undefined;
    const harnessId = match?.[1] ? decodeURIComponent(match[1]) : "";
    const threadId = match?.[2] ? decodeURIComponent(match[2]) : "";
    if (harnessId && threadId && cwd) void openHarnessThread(threadId.startsWith("c:")
      ? { harnessId, path: cwd, id: "", chatId: threadId.slice(2), title: "" }
      : { harnessId, path: cwd, id: threadId, title: "" }, "none");
    else if (harnessId) await openComputerHarness(harnessId, "none", cwd);
    else if (location.pathname.startsWith("/computer/environment/")) await openEnvironment(decodeURIComponent(location.pathname.slice("/computer/environment/".length)), "none");
    else await openComputer("none");
  };
  const harnessProfile = (id: string) => profiles().find((profile) => profile.id === id) || null;
  const openTerminalRoute = async (historyMode: "push" | "replace" | "none" = "push", terminalId?: string) => {
    if (!(await leaveHarnessThread())) return;
    leaveChat(historyMode === "none");
    if (historyMode !== "none" && routeKind() !== "terminal") setTerminalCanReturn(true);
    setMobileSidebarOpen(false);
    showRoute({ kind: "terminal", terminalId });
    if (historyMode === "push") history.pushState({}, "", "/terminal");
    else if (historyMode === "replace") history.replaceState({}, "", "/terminal");
  };
  const openDeviceTerminal = async (node: { id: string; local?: boolean }) => {
    try {
      const terminal = await api<Pty>("/v0/ptys", { method: "POST",
        body: JSON.stringify({ projectId: node.local ? "computer" : `device:${node.id}` }) });
      setSettingsOpen(false);
      await openTerminalRoute("push", terminal.id);
    } catch (error) { showError(error); }
  };
  const leaveTerminalRoute = async () => {
    if (terminalCanReturn()) history.back();
    else await openComputer();
  };

  askChatForError = async (diagnostic) => {
    if (suppressDiagnosticActions) return;
    suppressDiagnosticActions = true;
    try {
      const created = await createChat(catalogue.projects().find((item) => item.slug === "chat"), {}, { reportFailure: false });
      if (!created) throw new Error("No Chats project is available to diagnose in");
      chat.setDraft(formatDiagnosticPrompt(diagnostic));
      await chat.send();
    } catch (error) {
      showPlainError(error);
    } finally {
      suppressDiagnosticActions = false;
    }
  };

  // A press on a drawer row draws its chat ahead of the tap (chat.preview), so the drawer slides the moment the tap
  // lands; the tap adopts it (openChat), and a press that turns into a scroll goes back to the chat it was on.
  let previewFrom: { chat: ChatSummary; project: Project; jbot?: boolean } | null = null;
  let previewTimer = 0;
  const previewBase = () => {
    if (previewFrom) return previewFrom;
    if (!isMobileLayout() || !mobileSidebarOpen() || routeKind() !== "chat" || paneADocument() !== null) return null;
    if (chat.presentation().kind !== "ready" || chat.generation() !== "idle" || chat.draft().trim() || currentDraftId()) return null;
    const fromId = catalogue.selectedId();
    const fromProject = fromId ? catalogue.projects().find((item) => item.sessions.some((session) => session.id === fromId)) : undefined;
    const fromChat = fromProject?.sessions.find((session) => session.id === fromId);
    return fromChat && fromProject ? { chat: fromChat, project: fromProject } : null;
  };
  const previewJbot = () => {
    clearTimeout(previewTimer);
    const from = previewBase();
    if (!from || from.jbot || !agentView()?.enabled) return;
    previewFrom = { ...from, jbot: true };
    void openJbotPage("jbot", "none", true);
  };
  const previewChat = (target: ChatSummary, project: Project) => {
    clearTimeout(previewTimer);
    const base = previewBase();
    if (!base || base.jbot) return;
    const from = base;
    pressing = target.id;
    if (chat.preview(target, project)) { previewFrom = from; return; }
    void chat.whenRead(target).then(() => { if (pressing === target.id && mobileSidebarOpen() && chat.preview(target, project)) previewFrom = from; }).catch(() => {});
  };
  let pressing: string | null = null;
  const releasePreview = (cancelled: boolean) => {
    pressing = null;
    clearTimeout(previewTimer);
    if (!previewFrom) return;
    // A tap's click follows its release at once: nothing by then, and it was a scroll or a hold.
    previewTimer = window.setTimeout(() => {
      const from = previewFrom;
      previewFrom = null;
      if (from?.jbot && (routeKind() === "jbot")) void chat.select(from.chat, from.project, { history: "none",
        onCommit: () => showRoute({ kind: "chat" }) }).catch(showError);
      else if (from && chat.previewing()) void chat.select(from.chat, from.project, { history: "none" }).catch(showError);
    }, cancelled ? 0 : 350);
  };
  const openChat = async (target: ChatSummary, project: Project) => {
    if (previewFrom) {
      clearTimeout(previewTimer);
      previewFrom = null;
      if (chat.adoptPreview(target, project)) { abandonPendingNewChat(); return; }
    }
    if (!(await leaveHarnessThread())) return;
    abandonPendingNewChat();
    // Clicking a chat already open short-circuits below, so the receipt goes
    // first; every other way in is covered inside chat.select.
    markChatRead(catalogue, target);
    if (target.id === catalogue.selectedId() && routeKind() === "chat" && chat.presentation().kind === "ready") return;
    const abandonedDraftId = currentDraftId();
    if (abandonedDraftId !== target.id) discardDraftImmediately(abandonedDraftId);
    try {
      await chat.select(target, project, {
        history: "push",
        onCommit: () => {
          showRoute({ kind: "chat" });
        },
      });
      // A select already under way for this chat (jbot's page loading its thread for the composer) settled without
      // this one's commit: the chat is loaded, so only the route is left to follow.
      if (routeKind() !== "chat" && chat.loadedId() === target.id) {
        showRoute({ kind: "chat" });
        if (location.pathname !== chatPath(target.id)) history.pushState({}, "", chatPath(target.id));
      }
    }
    catch (error) { showError(error); return; }
  };

  const openPlace = async (target?: Project) => { if (target && target.slug !== "chat") void openProject(target); else await openDashboard(); };
  const openProject = async (target: Project, historyMode: "push" | "replace" | "none" = "push") => {
    if (!(await leaveHarnessThread())) return;
    abandonPendingNewChat();
    if (routeKind() === "project" && catalogue.projectId() === target.id) return;
    const abandonedDraftId = currentDraftId();
    if (historyMode !== "none") discardDraftImmediately(abandonedDraftId);
    chat.reset();
    catalogue.selectProject(target);
    showRoute({ kind: "project" });
    if (historyMode === "push") history.pushState({}, "", projectPath(target));
    else if (historyMode === "replace") history.replaceState({}, "", projectPath(target));
  };
  const openProjectWithMaximizedWorkspace = (target: Project) => {
    void openProject(target);
    setPanelOpenForChat(true);
    setWorkspaceExpanded(true);
  };

  const focusChatSurface = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    // A press in a menu or popover belongs to it, and Solid carries portal
    // events up to where the portal was declared, so skip those as well.
    if (target?.closest(".ui-composer-slot,.ui-phone-composer,[role='menu'],button,a,input,textarea,select,[contenteditable='true'],[role='button'],[role='link'],[role='option'],[data-slot='ui-menu-content'],[data-slot='ui-menu-sub-content'],[data-slot='ui-context-menu-content'],[data-slot='ui-context-menu-sub-content'],[data-slot='ui-popover-content']")) return;
    if (!(event.currentTarget instanceof HTMLElement)) return;
    event.currentTarget.focus({ preventScroll: true });
  };
  const hasComposer = () => Boolean(document.querySelector("textarea[data-composer-input]:not([disabled])"));
  const paneKeydown = (event: KeyboardEvent) => {
    if (event.target !== event.currentTarget || event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    const dashboard = routeKind() !== "chat" && routeKind() !== "terminal";
    const rows = () => [...splitSections()].filter((section) => section !== "composer");
    const toComposer = () => { if (!hasComposer()) return false; focusComposer(); return true; };
    let handled = false;
    if (event.key.length === 1) { toComposer(); return; }
    if (event.key === "Enter" || event.key === "Escape") handled = toComposer();
    else if (dashboard && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      const sections = rows();
      handled = focusSplitSection(sections.includes("chats") ? "chats" : sections[0] ?? "composer");
    } else if (event.key === "Tab") {
      const last = rows().at(-1);
      handled = dashboard && event.shiftKey && last ? focusSplitSection(last) : toComposer();
    }
    if (handled) event.preventDefault();
  };
  const focusComposer = () => {
    const composer = "textarea[data-composer-input]:not([disabled])";
    ((keyboardSlot() !== null ? document.querySelector<HTMLTextAreaElement>(`${paneSelector(keyboardSlot()!)} ${composer}`) : null)
      ?? document.querySelector<HTMLTextAreaElement>(`.chat-main ${composer}`)
      ?? document.querySelector<HTMLTextAreaElement>(composer))?.focus({ preventScroll: true });
  };
  const focusChatPane = () => {
    const target = document.querySelector<HTMLElement>(".chat-main");
    if (target) {
      target.focus({ preventScroll: true });
      return;
    }
    focusComposer();
  };
  let heldRegion: HTMLElement | null = null;
  let syncFocusedShortcutContext: ((target: EventTarget | null) => void) | undefined;
  let enteredRegion: HTMLElement | null = null;
  let focusRegion: HTMLElement | null = null;
  // Deferred focus work (a retry until a composer is enabled, a swap's settle) gives way to a newer intent, so it never
  // pulls focus back from where the person went since.
  const focusIntent = createLatest();
  // What the person last used: a press or a key. Focus in the sidebar after a press is a chat being opened (and
  // focus passing through its row), not the keyboard moving there.
  let lastInput: "pointer" | "key" = "key";
  let enterRetry: ReturnType<typeof setTimeout> | undefined;
  const holdRegion = (region: HTMLElement | null) => {
    if (heldRegion === region) return;
    heldRegion?.removeAttribute("data-focus-held");
    heldRegion = region;
    region?.setAttribute("data-focus-held", "");
  };
  const acknowledgeFocusedRegion = (region: HTMLElement | null) => {
    if (!region || !region.contains(document.activeElement)) return;
    // Arriving where focus already was is no arrival, so pressing a go-to twice does not flash. The region given may
    // hold the data-region element or sit inside it.
    const already = !enteredRegion || !(region.contains(enteredRegion) || enteredRegion.contains(region));
    enteredRegion = null;
    holdRegion(region);
    if (!already) acknowledgeRegion(region);
  };
  const acknowledgeWorkspaceFocus = () => acknowledgeFocusedRegion(
    document.activeElement instanceof Element
      ? document.activeElement.closest<HTMLElement>('[data-region="workspace-panel"]')
      : null,
  );
  const focusWorkspacePanel = () => {
    focusIntent.drop();
    if (!workspacePanelScope()) return;
    if (isMobileLayout()) setMobileSidebarOpen(false);
    const docked = dockSlot();
    if (docked !== null && inDock(docked)) {
      if (!panelOpen()) setPanelOpenForChat(true);
      return requestAnimationFrame(() => focusPane(docked));
    }
    if (!panelOpen()) setPanelOpenForChat(true);
    setWorkspaceFocusRequest((request) => request + 1);
  };
  const focusSidebar = () => {
    if (isMobileLayout()) setMobileSidebarOpen(true);
    requestAnimationFrame(() => {
      const sidebar = document.querySelector<HTMLElement>('[data-region="sidebar"]');
      if (!sidebar) return;
      const shown = (element: Element) => element.getClientRects().length > 0;
      const row = [
        ...sidebar.querySelectorAll('[aria-current="page"]'),
        ...sidebar.querySelectorAll("[data-within]"),
        ...sidebar.querySelectorAll(".ui-row[data-density=nav], .ui-icon-button[data-icon-button=rail]"),
      ].find(shown);
      const target = row && (row.matches("button, a") ? row : row.querySelector("button, a"));
      (target as HTMLElement | null | undefined)?.focus({ preventScroll: false });
      acknowledgeFocusedRegion(sidebar);
    });
  };
  // A composer still connecting is disabled, so the pane holds focus until it can take it. Entering is not itself a
  // new intent (a route settling calls it too).
  const enterMainPane = (attempt = 0, from: Element | null = null, intent = focusIntent.join()) => {
    if (attempt === 0) clearTimeout(enterRetry);
    if (!intent()) return;
    if (routeKind() === "terminal") return;
    const pane = document.querySelector<HTMLElement>(".chat-main");
    const active = document.activeElement;
    if (attempt > 0 && active !== from && active !== document.body) return;
    if (hasComposer()) return focusComposer();
    if (active !== pane) pane?.focus({ preventScroll: true });
    if (document.querySelector("textarea[data-composer-input]") && attempt < 20) enterRetry = setTimeout(() => enterMainPane(attempt + 1, pane, intent), ENTER_RETRY_MS);
  };
  const focusMainPane = () => {
    if (isMobileLayout()) setMobileSidebarOpen(false);
    focusIntent.drop();
    if (splitShown() && cyclePaneFocus()) return;
    setKeyboardPane("main");
    enterMainPane();
    acknowledgeFocusedRegion(document.querySelector<HTMLElement>(".chat-main"));
  };
  // A route change that takes the focused element leaves focus on the body. Not on a phone, where focusing the
  // composer raises the keyboard.
  const settleFocus = () => {
    if (isMobileLayout()) return;
    const active = document.activeElement;
    if (active && active !== document.body && !active.matches(".chat-main")) return;
    enterMainPane();
  };
  createEffect(on([routeKind, () => catalogue.selectedId()], () => requestAnimationFrame(() => {
    settleFocus();
    syncFocusedShortcutContext?.(document.activeElement);
  }), { defer: true }));
  const goToSidebar = () => {
    focusIntent.drop();
    const collapsed = document.querySelector('[data-region="sidebar"]')?.getAttribute("data-state") === "collapsed";
    if (!isMobileLayout() && collapsed) runSidebar("toggle-sidebar");
    focusSidebar();
  };
  const hasTranscript = () => Boolean(document.querySelector(".ui-chat-viewport"));
  const focusTranscript = () => {
    if (isMobileLayout()) setMobileSidebarOpen(false);
    ((keyboardSlot() !== null ? document.querySelector<HTMLElement>(`${paneSelector(keyboardSlot()!)} .ui-chat-viewport`) : null)
      ?? document.querySelector<HTMLElement>(".ui-chat-viewport"))?.focus({ preventScroll: true });
  };
  const toggleChatWorkspaceFocus = () => {
    const inWorkspacePanel = document.activeElement instanceof Element && Boolean(document.activeElement.closest('[data-region="workspace-panel"]'));
    if (inWorkspacePanel) focusChatPane();
    else if (panelOpen()) focusWorkspacePanel();
    else focusChatPane();
  };

  const refresh = async () => {
    const projects = await catalogue.refresh();
    pruneWorkspacePanelStorage(workspacePanelScopes(projects));
    return projects;
  };
  const addProject = async (input: { mode: string; name?: string; path?: string; nodeId?: string; rootId?: string; directoryName?: string; cloneUrl?: string; cloneParentPath?: string; cloneDirectoryName?: string }) => {
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
      if (["link", "linked", "create", "created", "node"].includes(input.mode)) await openProject(created);
      else await createChat(created, { templateId: projectProfile(created) });
      return true;
    } catch (error) { showError(error); return false; }
  };
  const renameChat = async (target: ChatSummary, _project: Project, name: string) => {
    try { const saved = await api<ChatSummary>(`/v0/sessions/${target.id}`, { method: "PATCH", body: JSON.stringify({ name }) }); if (catalogue.selectedId() === target.id) chat.setTitle(saved.title); await refresh(); return true; }
    catch (error) { showError(error); return false; }
  };
  const autoNameChat = async () => {
    const id = focusedChatId();
    const target = focusedChat();
    if (!id) return;
    try {
      const saved = await api<ChatSummary>(`/v0/sessions/${id}/auto-name`, { method: "POST", timeout: false });
      // The pane may have moved to another chat while the name was made: that chat's header keeps its own.
      if (target.loadedId() === id) target.setTitle(saved.title);
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
      // Each distinct reason once, so one cause is not read as every failure's.
      const reasons = [...new Set(failures.map(({ error }) => error instanceof Error ? error.message : String(error || "Request failed")))];
      const detail = reasons.length > 3 ? `${reasons.slice(0, 3).join("; ")}; and ${reasons.length - 3} more` : reasons.join("; ");
      showError(Object.assign(new Error(`${failures.length} of ${targets.length} chats could not be moved: ${detail}`), {
        code: "bulk_move_failed",
        apiRequest: (first as { apiRequest?: unknown })?.apiRequest,
      }));
    }
    return failures.map((failure) => failure.id);
  };
  const chatOwner = () => catalogue.projects().find((project) => project.sessions.some((session) => session.id === chat.loadedId()));
  const placeChat = async (destination: Project, target: ChatSession = session) => {
    const id = target.chat.loadedId();
    if (!id) return;
    try {
      await api(`/v0/sessions/${id}/move`, { method: "POST", body: JSON.stringify({ projectId: destination.id }) });
      await refresh();
      const pane = paneSlots.find((item) => item.session === target);
      if (pane) {
        const moved = pane.session.selected();
        if (moved) await pane.session.open(moved.chat, moved.project);
      } else if (routeKind() === "chat") catalogue.selectProject(destination);
    } catch (error) { showError(error); }
  };
  const chatPlace = (target: ChatSession = session) => {
    const id = target.chat.loadedId();
    return { projects: catalogue.projects(), current: target === session ? chatOwner() : catalogue.projects().find((project) => project.sessions.some((item) => item.id === id)), disabled: !id || runtime.connectivity() !== "online", onChoose: (project: Project) => void placeChat(project, target) };
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
      const { origin } = await api<ShareOriginPayload>("/v0/share-origin");
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
    try {
      await api(`/v0/sessions/${target.id}`, { method: "DELETE" });
      // Local copy too: the server drops its own with the chat, but this one
      // lives in storage on every device that ever opened it.
      drafts.forget(target.id);
      void forgetDeviceTranscript(target.id);
      dropScope(target.id);
      if (catalogue.selectedId() === target.id) await createChat(project);
      await refresh();
    }
    catch (error) { showError(error); }
  };
  const deleteChats = async (targets: Array<{ chat: ChatSummary; project: Project }>) => {
    const displayedId = catalogue.selectedId();
    const displayedTarget = targets.find((target) => target.chat.id === displayedId);
    const results = await Promise.all(targets.map(async (target) => {
      try {
        await api(`/v0/sessions/${target.chat.id}`, { method: "DELETE" });
        drafts.forget(target.chat.id);
        void forgetDeviceTranscript(target.chat.id);
        dropScope(target.chat.id);
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
      // Each distinct reason once, so one cause is not read as every failure's.
      const reasons = [...new Set(failures.map(({ error }) => error instanceof Error ? error.message : String(error || "Request failed")))];
      const detail = reasons.length > 3 ? `${reasons.slice(0, 3).join("; ")}; and ${reasons.length - 3} more` : reasons.join("; ");
      showError(Object.assign(new Error(`${failures.length} of ${targets.length} chats could not be deleted: ${detail}`), {
        code: "bulk_delete_failed",
        apiRequest: (first as { apiRequest?: unknown })?.apiRequest,
      }));
    }
    return failures.map((failure) => failure.id);
  };
  const dropProjectPanelState = (target: Project) => {
    dropScope(target.id);
    dropScope(`project:${target.id}`);
    for (const chat of target.sessions) dropScope(chat.id);
  };
  const deleteProject = async (target: Project) => {
    try { await api(`/v0/projects/${target.id}`, { method: "DELETE" }); dropProjectPanelState(target); if (catalogue.projectId() === target.id) await createChat(catalogue.projects().find((item) => item.slug === "chat")); await refresh(); }
    catch (error) { showError(error); }
  };
  const destroyWorkspace = async (target: Project, confirmation: string) => {
    try {
      await api(`/v0/projects/${encodeURIComponent(target.id)}`, { method: "DELETE", body: JSON.stringify({ mode: "destroy_workspace", confirmation }), replay: false });
      dropProjectPanelState(target);
      if (catalogue.projectId() === target.id) await createChat(catalogue.projects().find((item) => item.slug === "chat"));
      await refresh();
      return true;
    } catch (error) { showError(error); return false; }
  };
  const cancelClone = async (operationId: string) => {
    await api(`/v0/workspace-operations/${encodeURIComponent(operationId)}`, { method: "DELETE", replay: false });
  };

  // Asking for no section is a real answer: on a phone Settings opens on the list of sections.
  const openSettings = (section: string | null = null, workspaceId: string | null = null) => {
    setSettingsSection((section || "ui") as SettingsSection);
    setSettingsNamedSection(Boolean(section));
    setSettingsWorkspaceId(workspaceId);
    setSettingsLoaded(true);
    setSettingsOpen(true);
  };
  // A surface the app hands no props (an artifact's) opens Settings by event.
  const openSettingsFromEvent = (event: Event) => openSettings((event as CustomEvent<string>).detail);
  window.addEventListener("conduit:open-settings", openSettingsFromEvent);
  onCleanup(() => window.removeEventListener("conduit:open-settings", openSettingsFromEvent));
  // Float's notification (screen context to set up) opens a section from outside the page's own controls, once the
  // first route is up (opened earlier, it is lost under the connecting screen).
  let floatSettingsWired = false;
  createEffect(() => {
    if (routeBootstrap() !== "ready" || floatSettingsWired) return;
    floatSettingsWired = true;
    onFloatOpensSettings((section) => openSettings(section));
  });
  const switchMeteorField = (enabled: boolean) => {
    setMeteorField(enabled);
    localStorage.setItem(METEOR_FIELD_STORAGE_KEY, String(enabled));
  };
  const switchSidebarChatLimit = (next: number) => {
    const value = clampSidebarChatLimit(next);
    setSidebarChatLimit(value);
    localStorage.setItem(SIDEBAR_CHAT_LIMIT_STORAGE_KEY, String(value));
    publishUiPreference("sidebarChatLimit", value);
  };
  createEffect(() => {
    const state = uiPreferenceSaves.state();
    if (state.kind === "failed" && !untrack(settingsOpen)) showError(new Error(`Preferences not saved: ${state.message}`));
  });
  const saveDefaultTemplate = async (id: string) => {
    const saved = await api<PreferencesPayload>("/v0/preferences", { method: "PATCH", body: JSON.stringify({ defaultTemplateId: id }) });
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
    panes.replace((current) => current.summon ? { ...current, summon: null } : current);
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
  const openWorkspaceView = async (view: WorkspaceView, terminalId?: string, verb: Layouts.Verb = {}) => {
    if (view === "terminal" && terminalId && (verb.beside || verb.tab) && canOpenFilePanes()) return await openTerminalDocument(terminalId, verb);
    if (!workspacePanelScope()) return;
    batch(() => {
      setDockSlot(null);
      setWorkspaceViewRequest({ tab: view, ...(terminalId ? { terminalId } : {}), nonce: Date.now() });
      if (!isMobileLayout()) panes.replace((current) => ({ ...current, summon: view === "jbot" || view === "terminal" || view === "files" ? view : null }));
    });
    if (isMobileLayout()) setMobileSidebarOpen(false);
    setPanelOpenForChat(true);
  };
  const dockAvailable = () => routeKind() === "computer" ? Boolean(computerLocation()) : ["chat", "project", "dashboard", "agent", "jbot"].includes(routeKind()) && Boolean(dockHome()) && Boolean(workspacePanelScope());
  const slotView = (slot: number) => { const pane = paneData(slot); return pane ? Layouts.shownView(pane) : null; };
  const rowFull = () => layout().row.length >= Layouts.ROW_MAX;
  const dockMinWidth = () => { const slot = dockSlot(); return slot !== null && inDock(slot) ? viewMinWidth(slotView(slot)) : minSplitPaneWidth(); };
  const isPaneView = (view: SplitView | null) => Boolean(view && /^(chat|page):/.test(view));
  const [agentPageNeed, setAgentPageNeed] = createSignal(0);
  const viewMinWidth = (view: SplitView | null) => view === "page:jbot" ? minMainPaneWidth()
    : view === "page:agent" ? Math.max(minMainPaneWidth(), agentPageNeed())
    : view?.startsWith("artifact:") ? minArtifactPaneWidth()
    : !view || isPaneView(view) ? minMainPaneWidth() : minSplitPaneWidth();
  const paneMinWidth = (pane: PaneKey) => viewMinWidth(pane === "main" ? paneAView() : slotView(pane));
  const viewsFit = (views: (SplitView | null)[]) => layoutWidth() - (panelOpen() && dockAvailable() && !dockOverlay() ? dockMinWidth() + 8 : 0)
    >= views.reduce((sum, view) => sum + viewMinWidth(view) + 16, viewMinWidth(paneAView()));
  const splitFits = (extra: number) => viewsFit(Array(extra).fill("files:"));
  const shownSlots = createMemo(() => {
    if (!dockAvailable() || isMobileLayout()) return [];
    const shown: number[] = [];
    for (const slot of rowSlots().filter(slotView)) {
      if (!viewsFit([...shown, slot].map(slotView))) break;
      shown.push(slot);
    }
    return shown;
  }, [], { equals: (a, b) => a.length === b.length && a.every((slot, index) => slot === b[index]) });
  const renderSlots = shownSlots;
  const splitShown = () => shownSlots().length > 0;
  const weightsFor = (count: number) => count === 3 ? splitRatios3() : count === 2 ? [1 - splitRatio(), splitRatio()] : [1];
  const [weightOverride, setWeightOverride] = createSignal<number[] | null>(null);
  const [paneMotion, setPaneMotion] = createSignal<{ slot: PaneKey; phase: "arriving" | "leaving"; collapsed?: boolean; width?: number } | null>(null);
  const paneWeights = () => weightOverride() ?? weightsFor(renderSlots().length + 1);
  const fileHandles = new Map<PaneKey, (FileSlotHandle | undefined)[]>();
  const handlesOf = (pane: PaneKey) => { let list = fileHandles.get(pane); if (!list) fileHandles.set(pane, list = []); return list; };
  // A swap or a close moving a document to another pane is not leaving it.
  let movingDocuments = false;
  /** A file document or a folder viewer with an unsaved edit, about to show something else. */
  const leavesUnsaved = (current: SplitView | null, next: SplitView | null, pane: PaneKey) => {
    const before = parseFileView(current)?.[0], after = parseFileView(next)?.[0];
    return !movingDocuments && Boolean(before || current?.startsWith("folder:")) && current !== next && (!before || !after || !sameFileEntry(before, after)) && handlesOf(pane).some((handle) => handle?.hasUnsavedChanges());
  };
  /** What stands before a pane stops showing its view: unsaved edits, an artifact arriving. */
  const gate = async (pane: PaneKey, next: SplitView | null) => {
    const previous = viewOf(pane);
    if (leavesUnsaved(previous, next, pane) && !(await confirmDialog("Discard unsaved changes and close this file?", { destructive: true, confirmLabel: "Discard", valid: () => viewOf(pane) === previous }))) return false;
    if (viewOf(pane) !== previous) return false;
    if (arrives(pane, previous, next) && !(await arrive(pane, next!, () => viewOf(pane) === previous))) return false;
    // Passed: the artifact made behind takes the pane with the change the caller makes next, so it is no longer arriving.
    leaves(pane);
    return true;
  };
  // Pane A draws the route: a change that leaves it showing a route view sends the route there, one drive at a time.
  let drivingRoute = false;
  const followPaneA = async (before: SplitView | null, inPaneA?: () => unknown) => {
    const after = paneAView();
    if (!after || after === before || !isPaneView(after) || after === settledRoute()) return;
    drivingRoute = true;
    try { await (inPaneA ? inPaneA() : openInPaneA(after)); } finally { drivingRoute = false; }
    // A route that did not follow (a harness thread kept, a chat gone): pane A goes back to what the route shows.
    const route = settledRoute();
    if (route && route !== after && paneAView() === after) panes.replace((current) => fromRoute(current, route));
  };
  /** Every change to the layout: `record` makes it a step Undo pane change goes back over. */
  const changeLayout = async (change: (current: Layouts.Layout) => Layouts.Layout, options: { record?: boolean; inPaneA?: () => unknown } = {}) => {
    const before = paneAView();
    if (options.record === false) panes.replace(change); else panes.apply(change);
    await followPaneA(before, options.inPaneA);
  };
  /** Shows `next` in a pane in place (no step in pane history), or closes it (`null`, a step). */
  const setSlotView = async (slot: number, next: SplitView | null) => {
    if (!(await gate(slot, next))) return false;
    const id = idOf(slot);
    if (!id) return false;
    batch(() => {
      leaves(slot);
      if (!next && dockSlot() === slot) { setDockSlot(null); closePanel(); }
      if (next) panes.replace((current) => Layouts.show(current, id, next)); else panes.apply((current) => Layouts.closePane(current, id));
    });
    return true;
  };
  const viewOf = (pane: PaneKey) => pane === "main" ? paneAView() : slotView(pane);
  const panesShown = (): PaneKey[] => ["main", ...shownSlots()];
  const setPaneView = async (pane: PaneKey, next: SplitView | null) => {
    if (pane !== "main") return await setSlotView(pane, next);
    if (!(await gate("main", next))) return false;
    leaves("main");
    await changeLayout((current) => next ? Layouts.show(current, current.row[0]!, next) : Layouts.closePane(current, current.row[0]!), { record: !next });
    return true;
  };
  // An artifact taking the place of what a pane shows is made behind it (pending) and takes its place in the frame it is
  // drawn, so the pane never shows it opening. One that is slow says so in the pane's header from SAY_MS, and takes its
  // place at ARRIVE_MS saying it is opening. Meanwhile what the pane shows takes no input (main: the effect over `arriving`).
  const SAY_MS = 400, ARRIVE_MS = 1500;
  const [arriving, setArriving] = createSignal<Partial<Record<PaneKey, string>>>({});
  const [said, setSaid] = createSignal<Partial<Record<PaneKey, string>>>({});
  const drawnArtifacts = new Set<string>();
  const arrives = (pane: PaneKey, previous: SplitView | null, next: SplitView | null) => Boolean(previous && previous !== next && next?.startsWith("artifact:") && !/^artifact:new\b/.test(next) && paneElement(pane));
  const leaves = (pane: PaneKey) => setArriving(({ [pane]: _, ...rest }) => rest);
  /** Asked to show `view`, a pane drops what was arriving in it unless that is `view`: the last asked for is the one shown. */
  const asked = (pane: PaneKey, view: SplitView) => { if (arriving()[pane] !== undefined && `artifact:${arriving()[pane]}` !== view) leaves(pane); };
  /** True once the artifact is drawn (or ARRIVE_MS has passed), unless another took its place or the pane changed meanwhile (`unchanged`). */
  const arrive = async (pane: PaneKey, view: SplitView, unchanged: () => boolean) => {
    const id = view.slice("artifact:".length);
    setArriving((now) => ({ ...now, [pane]: id }));
    const say = setTimeout(() => { if (arriving()[pane] === id) setSaid((now) => ({ ...now, [pane]: id })); }, SAY_MS);
    await waitFor(() => drawnArtifacts.has(`${pane}:${id}`) || arriving()[pane] !== id, ARRIVE_MS);
    clearTimeout(say);
    if (said()[pane] === id) setSaid(({ [pane]: _, ...rest }) => rest);
    if (arriving()[pane] !== id) return false;
    if (!unchanged()) leaves(pane);
    return unchanged();
  };
  /** The artifacts a pane holds: the one it shows, and one arriving in its place. */
  const artifactsIn = (pane: PaneKey) => [viewOf(pane)?.startsWith("artifact:") ? viewOf(pane)!.slice("artifact:".length) : undefined, arriving()[pane]].filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);
  const paneSelector = (pane: PaneKey) => pane === "main" ? ".chat-main" : `.main-split[data-pane-slot="${pane}"]`;
  const paneOf = (element: Element | null | undefined): PaneKey | null => {
    const section = element?.closest<HTMLElement>(".main-split");
    if (section) return Number(section.dataset.paneSlot);
    return element?.closest(".chat-main") ? "main" : null;
  };
  const focusSplit = (slot: number | null = shownSlots()[0] ?? null) => requestAnimationFrame(() => {
    const hold = slot === null ? undefined : heldSlots.get(slot);
    if (hold) return void (hold.focus = () => focusSplit(slot));
    const content = slot === null ? null : paneSlot(slot).host()?.querySelector<HTMLElement>(".ui-tool-content, textarea[data-composer-input]:not([disabled]), .file-viewer-surface");
    focusFirst(content);
    if (!content?.contains(document.activeElement)) content?.focus({ preventScroll: true });
  });
  const keyboardPane = createMemo<PaneKey>(() => keyOf(layout().focus) ?? "main");
  const setKeyboardPane = (pane: PaneKey) => { const id = idOf(pane); if (id && id !== untrack(layout).focus) panes.replace((current) => Layouts.focus(current, id)); };
  const keyboardSlot = () => { const pane = keyboardPane(); return pane !== "main" && (shownSlots().includes(pane) || (dockSlot() === pane && inDock(pane))) && isPaneView(slotView(pane)) ? pane : null; };
  const sideHasKeyboard = () => keyboardSlot() !== null;
  const slotHasKeyboard = (slot: number) => keyboardSlot() === slot;
  const focusPane = (slot: number) => { setKeyboardPane(slot); focusSplit(slot); };
  /** The modifiers of the click or key being handled. Called only as a handler's first, synchronous step: after an
   *  await the event is gone. */
  const verbNow = (): Layouts.Verb => {
    const event = window.event;
    if (isMobileLayout() || !(event instanceof MouseEvent || event instanceof KeyboardEvent)) return {};
    return event.altKey ? { beside: true } : event.ctrlKey || event.metaKey ? { tab: true } : {};
  };
  const openRules: Layouts.Rules = { held: (view) => view.startsWith("chat:") && Boolean(drafts.draftFor(view.slice("chat:".length))), document: (view) => Boolean(matedPaper(view)) };
  /** Opening, from anywhere: plain replaces what the focused pane shows (its tabs with it, offering Undo), `tab` adds a
   *  chat or terminal as a tab of the nearest session pane, `beside` opens a pane beside and leaves the keyboard. A
   *  view open already is gone to. `inPaneA` draws pane A's route when the caller has more than its view to go on. */
  const openView = async (view: SplitView, verb: Layouts.Verb, inPaneA?: () => unknown) => {
    if (isMobileLayout()) { verb = {}; setKeyboardPane("main"); }
    const before = layout();
    const focused = before.panes[before.focus]!;
    const focusedPane = keyOf(before.focus) ?? "main";
    asked(focusedPane, view);
    const after = Layouts.open(before, view, verb, openRules);
    if (Object.values(after.panes).some((pane) => pane.views.length > Layouts.TAB_CAP && pane.views.length > (before.panes[pane.id]?.views.length ?? 0))) return void toast.info("Every tab in this pane has an unsent draft; close one to open another.");
    const at = Layouts.findView(before, view);
    if (!at) {
      // The pane giving up what it shows: the focused one replaced, or a full row's neighbour.
      const gone = Layouts.findView(after, Layouts.shownView(focused)) ? Object.keys(before.panes).find((id) => !after.panes[id]) : before.focus;
      const pane = gone ? keyOf(gone) : null;
      if (pane !== null && !(await gate(pane, gone === before.focus ? view : null))) return;
    }
    await changeLayout((current) => Layouts.open(current, view, verb, openRules), { record: !at, inPaneA });
    const now = layout();
    if (!at && !verb.beside && now.focus === before.focus && Layouts.kindOf(focused) === "session" && focused.views.length > 1 && !now.panes[before.focus]?.views.includes(Layouts.shownView(focused))) {
      toast(`Closed ${focused.views.length} tabs`, { action: { label: "Undo", onClick: () => void stepPanes(-1) } });
    }
    if (verb.beside && !at) return;
    const target = keyOf(now.focus);
    if (target === null) return;
    if (target !== "main" && now.dock === now.focus) return showDocked(target);
    focusAnyPane(target);
    if (target !== "main" && !at) void keepKeyboard(target, view);
  };
  /** The document arriving can take the focused element with it; the pane keeps the keyboard, unless the person has
   *  since gone elsewhere. */
  const keepKeyboard = async (slot: number, view: SplitView) => {
    const id = view.startsWith("chat:") ? view.slice("chat:".length) : null;
    let moved = false;
    const note = () => { moved = true; };
    window.addEventListener("pointerdown", note, true);
    window.addEventListener("keydown", note, true);
    const session = paneSlot(slot).session.chat;
    const drafting = view === "page:dashboard" || view.startsWith("page:project:");
    await waitFor(() => id ? session.loadedId() === id && session.presentation().kind === "ready" && chatDrawn(slot)
      : !drafting || Boolean(paneSlot(slot).draft && session.loadedId() === paneSlot(slot).draft!.id), 3000);
    window.removeEventListener("pointerdown", note, true);
    window.removeEventListener("keydown", note, true);
    if (!moved && shownSlots().includes(slot) && !paneElement(slot)?.contains(document.activeElement)) focusPane(slot);
  };
  /** Pane undo and redo step whole layouts; an unsaved edit a step would close is asked about first, as any change's. */
  const stepPanes = async (step: -1 | 1) => {
    const target = panes.target(step);
    if (!target) return;
    const nextView = (pane: PaneKey) => {
      const id = pane === "main" ? target.row[0] : idOf(pane);
      return id && (target.row.includes(id) || target.dock === id) ? Layouts.shownView(target.panes[id]!) : null;
    };
    const dirty = [...fileHandles.keys()].filter((pane) => leavesUnsaved(viewOf(pane), nextView(pane), pane));
    if (dirty.length) {
      if (!(await confirmDialog("Discard unsaved changes and close this file?", { destructive: true, confirmLabel: "Discard", valid: () => panes.target(step) === target }))) return;
      dirty.forEach((pane) => handlesOf(pane).forEach((handle) => { if (handle?.hasUnsavedChanges()) handle.discardChanges(); }));
    }
    const before = paneAView();
    if (step < 0) panes.undo(); else panes.redo();
    await followPaneA(before);
    focusAnyPane(keyboardPane());
  };
  /** Beside, for the places that always open beside. */
  const openBeside = async (view: SplitView, focus = true): Promise<PaneKey | undefined> => {
    await openView(view, { beside: true });
    const at = Layouts.findView(layout(), view);
    const pane = at ? keyOf(at.id) ?? undefined : undefined;
    if (focus && pane !== undefined) focusAnyPane(pane);
    return pane;
  };
  /** What a summon shows, opened as a pane: the summon goes first, and undoing the open brings it back. */
  const fromSummon = async (open: () => Promise<unknown>) => {
    const before = layout(), last = panes.target(-1);
    if (before.summon) dismissSummon();
    await open();
    if (before.summon && panes.target(-1) !== last) panes.amend(before);
  };
  /** The dock's folder viewer or terminal taken to a pane of its own: the summon goes, the pane keeps the workspace. */
  const moveToRow = (view: SplitView) => fromSummon(() => openBeside(view));
  const closeSlot = async (slot: number | null, focus = true) => {
    if (slot === null) return;
    const previous = slotView(slot);
    const dirty = handlesOf(slot).filter((handle) => handle?.hasUnsavedChanges());
    if (dirty.length) {
      if (!(await confirmDialog("Discard unsaved changes and close this file?", { destructive: true, confirmLabel: "Discard", valid: () => slotView(slot) === previous }))) return;
      dirty.forEach((handle) => handle?.discardChanges());
    }
    if (slotView(slot) !== previous) return;
    const element = paneSlot(slot).host();
    const index = shownSlots().indexOf(slot);
    // After an eased close, focus moves on the next frame: focusing in the task that unmounts the pane forced its
    // layout there (~8 ms over budget), where the frame lays it out anyway.
    const close = async (later = false) => { if ((await setSlotView(slot, null)) && focus) later ? requestAnimationFrame(focusChatPane) : focusChatPane(); };
    if (!element || index < 0 || !animatePanes()) return await close();
    setWeightOverride(paneShares());
    setPaneMotion({ slot, phase: "leaving", width: element.getBoundingClientRect().width });
    const fade = documentsOf(element).map((part) => part.animate([{ opacity: 1 }, { opacity: 0 }],
      { duration: duration("--duration-fold") * 0.55, easing: easing("--ease-leave"), fill: "forwards" }));
    const target = weightsFor(shownSlots().length);
    target.splice(index + 1, 0, 0);
    // Unmounting it is a long task (a transcript's worth of nodes): after the last frame of the ease is drawn, where
    // it moves nothing.
    easePaneWeights(normalized(target), () => window.setTimeout(() => {
      batch(() => { void close(true); setWeightOverride(null); setPaneMotion(null); });
      for (const animation of fade) animation.cancel();
    }));
  };
  const chooseRailTool = async (tool: WorkspaceView, beside: boolean) => {
    const jbotPane = tool === "jbot" ? shownSlots().find((slot) => slotView(slot) === "page:jbot") : undefined;
    if (jbotPane !== undefined) return focusPane(jbotPane);
    if (panelOpen() && dockSlot() === null && (dockTool() === tool || (tool === "files" && dockTool() === "diff"))) dismissSummon();
    else if (tool === "terminal" && beside && canOpenFilePanes()) void openTerminalTool(true);
    else await openWorkspaceView(tool);
  };
  const [fileWraps, setFileWraps] = createSignal<Record<string, boolean>>({});
  const fileWrap = (pane: PaneKey) => fileWraps()[viewOf(pane) ?? ""] ?? (readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "wrap-lines") === "true");
  const toggleFileWrap = (pane: PaneKey) => setFileWraps((current) => ({ ...current, [viewOf(pane)!]: !fileWrap(pane) }));
  let pendingFileEdit: FileEntry | null = null;
  const canOpenFilePanes = () => dockAvailable() && !isMobileLayout() && splitFits(1);
  const openTerminalDocument = (id: string, verb: Layouts.Verb) => openView(`term:${id}`, verb);
  const openTerminalTool = async (beside: boolean) => {
    const showing = panesShown().find((pane) => viewOf(pane)?.startsWith("term:"));
    if (!beside && showing !== undefined) {
      focusAnyPane(showing);
      return void document.querySelector<HTMLElement>(`${paneSelector(showing)} .pane-terminal .xterm-helper-textarea`)?.focus({ preventScroll: true });
    }
    const id = await pickShell();
    if (id) await openView(`term:${id}`, beside ? { beside: true } : {});
  };
  const pickShell = async (): Promise<string | null> => {
    const computer = routeKind() === "computer";
    const projectId = computer ? "computer" : dockProject()?.id;
    if (!projectId) return null;
    const open = new Set(panesShown().map(viewOf).filter((view) => view?.startsWith("term:")).map((view) => view!.slice("term:".length)));
    try {
      const { ptys = [] } = await api<PtysPayload>(`/v0/ptys?projectId=${encodeURIComponent(projectId)}`);
      let id = ptys.find((item) => item.status === "running" && !open.has(item.id))?.id;
      if (!id) {
        id = (await api<Pty>("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId, ...(computer && computerLocation() ? { cwd: computerLocation()!.project.workingRoot } : {}) }) })).id;
        window.dispatchEvent(new Event("conduit:ptys-changed"));
      }
      return id;
    } catch (error) { showError(error); return null; }
  };
  const DOC_DRAG_TYPE = "application/x-conduit-doc";
  let draggedView: string | null = null;
  let draggedPane: PaneKey | null = null;
  let draggedGroup: { pane: PaneKey; ids: string[] } | null = null;
  const armHeaderDrag = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    const header = target?.closest<HTMLElement>("header");
    if (!header || !splitShown() || isMobileLayout() || paneOf(header) === null) return;
    if (target!.closest("button,a,input,textarea,select,[role='button'],[role='menuitem'],[contenteditable='true']")) return;
    header.draggable = true;
    header.dataset.paneDrag = "true";
    const disarm = () => { window.removeEventListener("pointerup", disarm); window.removeEventListener("dragend", disarm); header.draggable = false; delete header.dataset.paneDrag; };
    window.addEventListener("pointerup", disarm);
    window.addEventListener("dragend", disarm);
  };
  document.addEventListener("pointerdown", armHeaderDrag, true);
  onCleanup(() => document.removeEventListener("pointerdown", armHeaderDrag, true));
  type DragHintIcon = "left" | "right" | "tab" | "swap" | "here";
  // The pill's place follows the pointer by transform alone: a layout per dragover makes it trail the pointer.
  const [dragHintContent, setDragHintContent] = createSignal<{ text: string; icon: DragHintIcon } | null>(null, { equals: (a, b) => a?.text === b?.text && a?.icon === b?.icon });
  let dragHintElement: HTMLDivElement | undefined;
  let dragHintAt = { x: 0, y: 0 };
  const placeDragHint = () => { if (dragHintElement) dragHintElement.style.transform = `translate3d(${dragHintAt.x + 14}px, ${dragHintAt.y + 18}px, 0)`; };
  const setDragHint = (hint: { x: number; y: number; text: string; icon: DragHintIcon } | null) => {
    setDragHintContent(hint && { text: hint.text, icon: hint.icon });
    if (hint) { dragHintAt = { x: hint.x, y: hint.y }; placeDragHint(); }
  };
  const [docDrop, setDocDrop] = createSignal<{ pane: PaneKey; zone: "left" | "middle" | "right" | "dock"; rect: { left: number; top: number; width: number; height: number } } | null>(null);
  const docDragView = (target: Element): string | null => {
    const source = target.closest<HTMLElement>("[data-doc-view]");
    if (source) return source.dataset.docView || null;
    const file = target.closest<HTMLElement>('[role="treeitem"][data-path]:not([aria-expanded])');
    const project = file?.closest<HTMLElement>("[data-doc-project]")?.dataset.docProject;
    return file && project ? formatFileView([{ projectId: project, path: file.dataset.path! }]) : null;
  };
  const roomBeside = (view: string) => shownSlots().length < 2 && viewsFit([...shownSlots().map(slotView), (view.startsWith("tool:") ? "term:" : view) as SplitView]);
  const onDocDragStart = (event: DragEvent) => {
    if (isMobileLayout() || !(event.target instanceof Element) || !event.dataTransfer) return;
    const header = event.target.closest<HTMLElement>("header[data-pane-drag]");
    const fromPane = header ? paneOf(header) : null;
    const view = fromPane !== null ? viewOf(fromPane) : docDragView(event.target);
    if (!view) return;
    draggedPane = fromPane;
    draggedView = view;
    const group = fromPane === null ? event.target.closest<HTMLElement>("[data-tab-group]") : null;
    const groupPane = group ? paneOf(group) : null;
    draggedGroup = group && groupPane !== null ? { pane: groupPane, ids: group.dataset.tabGroup!.split(",") } : null;
    event.dataTransfer.setData(DOC_DRAG_TYPE, view);
    event.dataTransfer.effectAllowed = "copyMove";
  };
  const onDocDragOver = (event: DragEvent) => {
    if (!draggedView || !event.dataTransfer?.types.includes(DOC_DRAG_TYPE)) return;
    const dockTarget = draggedPane !== null && event.target instanceof Element ? event.target.closest<HTMLElement>(".ui-dock[data-open], [data-region=\"workspace-rail\"]") : null;
    if (dockTarget && draggedPane !== null && canDock(draggedPane)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragHint({ x: event.clientX, y: event.clientY, text: "Move to the dock", icon: "right" });
      const box = (dockTarget.querySelector(".ui-dock-surface") ?? dockTarget).getBoundingClientRect();
      if (docDrop()?.zone !== "dock") setDocDrop({ pane: draggedPane, zone: "dock", rect: { left: box.left, top: box.top, width: box.width, height: box.height } });
      return;
    }
    const pane = paneOf(event.target instanceof Element ? event.target : null);
    const element = pane === null ? null : paneElement(pane);
    if (pane === null || !element) { setDragHint(null); return void setDocDrop(null); }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const box = element.getBoundingClientRect();
    const third = (event.clientX - box.left) / box.width;
    if (pane === draggedPane) { setDragHint(null); return void setDocDrop(null); }
    const edges = draggedPane !== null || roomBeside(draggedView);
    const { zone, edge } = dropZoneAt(third, edges);
    if (draggedPane !== null && nearEdge(draggedPane, pane, zone)) { setDragHint(null); return void setDocDrop(null); }
    if (draggedGroup?.pane === pane && zone === "middle") { setDragHint(null); return void setDocDrop(null); }
    const named = (view: SplitView | null) => `“${viewName(view)}”`;
    const hint: { text: string; icon: DragHintIcon } = zone !== "middle"
      ? { text: draggedPane !== null ? `Move to the ${zone} of ${named(viewOf(pane))}` : draggedGroup ? `Open these tabs in a new pane on the ${zone}` : `Open in a new pane on the ${zone}`, icon: zone }
      : draggedPane !== null ? { text: `Swap with ${named(viewOf(pane))}`, icon: "swap" }
      : draggedGroup ? { text: "Move these tabs here", icon: "tab" }
      : panesShown().some((other) => viewOf(other) === draggedView) ? { text: "Already open: go to it", icon: "here" }
      : Layouts.sessionView(draggedView as SplitView) && tabsOf(pane) ? { text: "Add as a tab here", icon: "tab" }
      : parseFileView(viewOf(pane))?.length === 0 ? { text: "Open in this pane", icon: "here" }
      : { text: `Open here in place of ${named(viewOf(pane))}`, icon: "here" };
    setDragHint({ x: event.clientX, y: event.clientY, ...hint });
    const rect = dropWash(box, zone, edge, edges);
    const current = docDrop();
    if (current?.pane === pane && current.zone === zone) return;
    setDocDrop({ pane, zone, rect: { ...rect, top: box.top, height: box.height } });
  };
  // Any drag's end, wherever it ended: the attach overlay and the split wash it raised go with it (a route change
  // mid-drag sends its leaves nowhere that counts them).
  const endDocDrag = () => { draggedView = null; draggedPane = null; draggedGroup = null; setDocDrop(null); setDragHint(null); dragDepth = 0; setDropActive(false); };
  const movePaneDocument = async (from: PaneKey, target: { pane: PaneKey; zone: "left" | "middle" | "right" }) => {
    const keep = paneBeforePress ?? keyboardPane();
    if (target.zone === "middle") return void await swapPanes(from, false, target.pane, true, keep);
    const panes = panesShown();
    const kept = panes.indexOf(keep);
    let at = panes.indexOf(from);
    const to = panes.indexOf(target.pane);
    const involved = panes.slice(Math.min(at, to), Math.max(at, to) + 1).map(paneElement).filter((element): element is HTMLElement => Boolean(element));
    await crossfadeUnder(involved, async () => {
      while (at !== to) {
        const next = at < to ? at + 1 : at - 1;
        const now = panesShown();
        await swapPanes(now[Math.min(at, next)]!, false, now[Math.max(at, next)]!, false, null);
        at = next;
      }
    });
    focusAnyPane(panesShown()[kept >= 0 ? kept : to]!);
  };
  const nearEdge = (from: PaneKey, pane: PaneKey, zone: "left" | "middle" | "right") => {
    const panes = panesShown();
    return zone === (panes.indexOf(from) < panes.indexOf(pane) ? "left" : "right");
  };
  /** A tab group dragged out of its pane: into a session pane's tabs (the middle), or a new pane on an edge. */
  const moveTabGroup = async (group: { pane: PaneKey; ids: string[] }, target: { pane: PaneKey; zone: "left" | "middle" | "right" }, recent: SplitView) => {
    const from = idOf(group.pane), to = idOf(target.pane);
    if (!from || !to || (target.zone === "middle" && !tabsOf(target.pane))) return;
    const at = layout().row.indexOf(to);
    await changeLayout((current) => Layouts.moveViews(current, from, group.ids as SplitView[], target.zone === "middle" ? to : target.zone === "right" ? at + 1 : at));
    const placed = Layouts.findView(layout(), recent);
    if (!placed) return;
    await changeLayout((current) => Layouts.switchTab(current, placed.id, placed.index), { record: false });
    const pane = keyOf(placed.id);
    if (pane !== null) focusAnyPane(pane);
  };
  const onDocDrop = async (event: DragEvent) => {
    const target = docDrop();
    let view = draggedView;
    const fromPane = draggedPane;
    const group = draggedGroup;
    endDocDrag();
    if (!target || !view || !event.dataTransfer?.types.includes(DOC_DRAG_TYPE)) return;
    event.preventDefault();
    if (target.zone === "dock") return await dockPane(target.pane);
    const placed = { ...target, zone: target.zone };
    if (fromPane !== null) return void await movePaneDocument(fromPane, placed);
    if (group) return void await moveTabGroup(group, placed, view as SplitView);
    return /^(folder:|tool:files$)/.test(view) && layout().summon === "files" ? fromSummon(() => dropDocument(placed, view)) : dropDocument(placed, view);
  };
  const dropDocument = async (target: { pane: PaneKey; zone: "left" | "middle" | "right" }, view: string) => {
    if (view === "tool:terminal") { const id = await pickShell(); if (!id) return; view = `term:${id}`; }
    if (view === "tool:files") { const project = dockProject(); if (!project) return; view = `folder:${project.id}`; }
    const next = view as SplitView;
    const docked = dockedSlot();
    if (docked !== null && slotView(docked) === next) {
      if (!undockPane(docked, false) || !shownSlots().includes(docked)) return;
      if (target.pane === docked) return focusPane(docked);
      return void await movePaneDocument(docked, target);
    }
    if (Layouts.findView(layout(), next)) return void await openView(next, {});
    if (target.zone === "middle") {
      setKeyboardPane(target.pane);
      return void await openView(next, Layouts.sessionView(next) && tabsOf(target.pane) ? { tab: true } : {});
    }
    const id = idOf(target.pane);
    if (!id) return;
    const at = layout().row.indexOf(id);
    await changeLayout((current) => Layouts.place(current, next, target.zone === "right" ? at + 1 : at));
    const placed = Layouts.findView(layout(), next);
    const pane = placed ? keyOf(placed.id) : null;
    if (pane !== null) focusAnyPane(pane);
  };
  document.addEventListener("dragstart", onDocDragStart);
  document.addEventListener("dragover", onDocDragOver);
  document.addEventListener("drop", onDocDrop);
  document.addEventListener("dragend", endDocDrag);
  onCleanup(() => {
    document.removeEventListener("dragstart", onDocDragStart);
    document.removeEventListener("dragover", onDocDragOver);
    document.removeEventListener("drop", onDocDrop);
    document.removeEventListener("dragend", endDocDrag);
  });
  const homeProjects = () => catalogue.projects().filter((project) => project.slug !== "chat" && project.origin !== "linked" && project.origin !== "created" && project.origin !== "cloned" && project.kind !== "workspace");
  const renderHome = (pane: PaneKey) => {
    const fill = async (view: SplitView) => { if (await setPaneView(pane, view)) focusAnyPane(pane); };
    const terminal = async () => { const id = await pickShell(); if (id) await fill(`term:${id}`); else toast.info("Open a workspace first: a terminal starts in one."); };
    const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; };
    const projects = () => homeProjects().slice(0, 5);
    const recent = () => catalogue.projects().flatMap((project) => project.sessions.map((chat) => ({ chat, project })))
      .sort((a, b) => (b.chat.updatedAt ?? "").localeCompare(a.chat.updatedAt ?? "")).slice(0, 5);
    return <>
      <PaneHeader actions={paneTabActions(pane)}><Show when={documentTab(pane)} fallback={<HeaderCrumb title="New tab" />}>{(tabs) => <PaneTabRow>{tabs()}</PaneTabRow>}</Show></PaneHeader>
      <PaneHome label="New tab">
        <header><DashHeader title={greeting()} context={[activeServer()?.name || "Hub", buildLabel(clientBuild)]} /></header>
        <Actions kind="rider">
          <RiderButton show="label" icon={<Icons.NewChat />} label="New chat" onClick={() => void fill("page:dashboard")} />
          <RiderButton show="label" icon={<Icons.Terminal />} label="New terminal" onClick={() => void terminal()} />
          <RiderButton show="label" icon={<Icons.Browser />} label="Browser" onClick={() => void fill("browser:hub")} />
          <RiderButton show="label" icon={<Icons.Mail />} label="Mail" onClick={() => void fill("mail:default")} />
          <RiderButton show="label" icon={<Icons.WriteFile />} label="New artifact" onClick={() => void fill(dockProject() ? `artifact:new:${dockProject()!.id}` : "artifact:new")} />
        </Actions>
        <Show when={recent().length}>
          <Group kind="dash" id="Continue" heading={<GroupHeading>Continue</GroupHeading>}>
            <For each={recent()}>{(item) => <Row density="list" element="button" lead={<Icons.Chat />} label={item.chat.title || "New chat"} context={placeLabelOf(item.project.id)} onClick={() => void fill(`chat:${item.chat.id}`)} />}</For>
          </Group>
        </Show>
        <Show when={projects().length}>
          <Group kind="dash" id="Projects" heading={<GroupHeading>Projects</GroupHeading>}>
            <For each={projects()}>{(project) => <Row density="list" element="button" lead={<Icons.Folder />} label={project.name || project.slug} onClick={() => void fill(`page:project:${project.id}`)} />}</For>
          </Group>
        </Show>
      </PaneHome>
    </>;
  };
  const [browserTitles, setBrowserTitles] = createSignal<Record<string, string>>({});
  const [termTitles, setTermTitles] = createSignal<Record<string, string>>({});
  /** Terminal views whose shell is live, for their tab's dot. */
  const [termLive, setTermLive] = createSignal<Record<string, boolean>>({});
  const [artifactNames, setArtifactNames] = createSignal<Record<string, { name: string; label: string }>>({});
  const nameArtifact = (view: string, name: string, label: string) => setArtifactNames((current) => current[view]?.name === name && current[view]?.label === label ? current : { ...current, [view]: { name, label } });
  // A tab is named before its pane is first shown: the hub is asked, once, and again for every tab drawn when an artifact changes, as one not shown may be the one renamed.
  const namedArtifacts = new Set<string>(), [artifactsChanged, setArtifactsChanged] = createSignal(undefined, { equals: false });
  const askArtifactName = (view: string) => {
    artifactsChanged();
    if (namedArtifacts.has(view)) return;
    namedArtifacts.add(view);
    void import("./document/artifacts").then(({ artifactAbout, artifactLabel }) => artifactAbout(view.slice("artifact:".length)).then((found) => nameArtifact(view, found.name, artifactLabel(found.kind)))).catch(() => {});
  };
  const renameArtifacts = () => { namedArtifacts.clear(); setArtifactsChanged(); };
  window.addEventListener("conduit:artifacts-changed", renameArtifacts);
  onCleanup(() => window.removeEventListener("conduit:artifacts-changed", renameArtifacts));
  /** The paper's pane turns to its mated thread, which the hub makes if there is none: the same tab, as a chat. A chat the paper leads to instead opens beside it as itself, keeping its place in the sidebar. */
  const showThread = async (pane: PaneKey, paper: string) => {
    try {
      const { lead } = await api<{ lead: string | null }>(`/v0/document/${encodeURIComponent(paper)}/connections`);
      if (lead) {
        const listed = catalogue.projects().flatMap((project) => project.sessions.map((chat) => ({ chat, project }))).find((one) => one.chat.id === lead) ?? await agentChat(lead);
        return void await openChatBeside(listed.chat, listed.project);
      }
      const { chat } = await api<{ chat: ChatSummary }>(`/v0/document/${encodeURIComponent(paper)}/thread`, { method: "POST" });
      setMatedThreads((current) => { const next = { ...current, [chat.id]: paper }; writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "mated", JSON.stringify(next)); return next; });
      await agentChat(chat.id);
      const thread: SplitView = `chat:${chat.id}`;
      if (!(await setPaneView(pane, thread))) return;
      focusAnyPane(pane);
      if (pane !== "main") void keepKeyboard(pane, thread);
    } catch (error) { showError(error); }
  };
  const paperModes = (pane: PaneKey, paper: string, shown: "paper" | "thread") => <Segmented label="View" size="sm" value={shown} options={[{ value: "paper", label: (askArtifactName(`artifact:${paper}`), artifactNames()[`artifact:${paper}`]?.label) ?? "Artifact" }, { value: "thread", label: "Thread" }]}
    onChange={(next) => { if (next !== shown) void (next === "thread" ? showThread(pane, paper) : setPaneView(pane, `artifact:${paper}`)); }} />;
  /** The switch on a chat's header, where the chat is a paper's mated thread. */
  const threadModes = (pane: PaneKey) => { const paper = matedPaper(viewOf(pane)); return paper ? paperModes(pane, paper, "thread") : undefined; };
  const openArtifactFromEvent = (event: Event) => { const { id, beside } = (event as CustomEvent<{ id: string; beside?: boolean }>).detail; void openArtifact(id, beside ? { beside } : {}); };
  window.addEventListener("conduit:open-artifact", openArtifactFromEvent);
  onCleanup(() => window.removeEventListener("conduit:open-artifact", openArtifactFromEvent));
  // `artifact:new[:<project>]` is the creator, so it is a tab with a name that survives a reload; ids are hex, so never "new".
  const renderArtifactDocument = (pane: PaneKey, id: string) => (onCleanup(() => drawnArtifacts.delete(`${pane}:${id}`)), id === "new" || id.startsWith("new:") ? <SheetFill tabIndex={-1} onPointerDown={focusChatSurface}>
    <PaneHeader actions={paneTabActions(pane)}><HeaderCrumb title="New artifact" /></PaneHeader>
    <ArtifactCreator project={id.slice("new:".length) || undefined} projects={catalogue.projects().filter((item) => item.id === id.slice("new:".length) || homeProjects().includes(item))}
      onBack={() => void setPaneView(pane, "home")} onMade={(made) => void setPaneView(pane, `artifact:${made.id}`).then(() => focusAnyPane(pane))} />
  </SheetFill> : <ArtifactPane id={id} pending={arriving()[pane] === id} said={said()[pane] === id} moving={paneMotion()?.slot === pane} onDrawn={() => drawnArtifacts.add(`${pane}:${id}`)} onThread={() => void showThread(pane, id)} shortcuts={shortcutManager} onAbout={(found, label) => nameArtifact(`artifact:${id}`, found.name, label)}
    chats={(project) => (catalogue.projects().find((item) => item.id === project)?.sessions ?? []).map((chat) => ({ id: chat.id, title: chat.title || "Untitled chat" }))}
    header={(extra) => <PaneHeader modes={paperModes(pane, id, "paper")} actions={<>{extra}{paneTabActions(pane)}</>}><HeaderCrumb title={viewName(`artifact:${id}`)} /></PaneHeader>} />);
  const renderBrowserDocument = (pane: PaneKey, id: string) => <SheetFill class="pane-browser">
    <BrowserPane id={id} onTitle={(title) => setBrowserTitles((current) => ({ ...current, [`browser:${id}`]: title }))}
      header={<PaneHeader actions={paneTabActions(pane)}><HeaderCrumb title={viewName(`browser:${id}`)} /></PaneHeader>} />
  </SheetFill>;
  const renderMailDocument = (pane: PaneKey, account: string) => <MailPane account={account} onAccount={(id) => void setPaneView(pane, `mail:${id}`)} onSettings={() => openSettings("mail")}
    header={(parts) => <PaneHeader modes={parts.modes} actions={<>{parts.actions}{paneTabActions(pane)}</>}>{parts.title}</PaneHeader>} />;
  const renderTerminalDocument = (pane: PaneKey, shell: string) => {
    const [record, setRecord] = createSignal<{ projectId: string; cwd?: string | null; title?: string | null } | null | undefined>(undefined);
    void api<PtysPayload>("/v0/ptys")
      .then(({ ptys = [] }) => {
        const found = ptys.find((item) => item.id === shell && item.status === "running") ?? null;
        setRecord(found);
        if (found?.title) setTermTitles((current) => ({ ...current, [`term:${shell}`]: found.title! }));
      })
      .catch(() => setRecord(null));
    const placeName = (projectId: string) => projectId === "computer" || projectId.startsWith("computer:") ? "Computer" : catalogue.projects().find((item) => item.id === projectId)?.name || "Chats";
    const tabbed = () => !inDock(pane) && !isMobileLayout();
    // One row: the tab row, the terminal's controls at its right (they fold before a tab's title cuts).
    const tabRow = (controls?: JSX.Element) =>
      <PaneHeader actions={<>{controls}{paneTabActions(pane)}</>}><Show when={documentTab(pane)}>{(tabs) => <PaneTabRow>{tabs()}</PaneTabRow>}</Show></PaneHeader>;
    onCleanup(() => setTermLive((current) => { const { [`term:${shell}`]: _, ...rest } = current; return rest; }));
    return <SheetFill ref={createArtWindow(true)} class="pane-terminal">
      <Show when={tabbed() && !record()}>{tabRow()}</Show>
      <Show when={record()} fallback={<Show when={record() === null}>
        <Show when={!tabbed()}><PaneHeader actions={paneTabActions(pane)}><HeaderCrumb title="Terminal" /></PaneHeader></Show><Empty>This terminal has ended.</Empty>
      </Show>}>{(found) =>
        <TerminalPane projectId={found().projectId} projectName={placeName(found().projectId)} workingRoot={found().cwd || undefined} terminalId={shell} onShown={(next) => { if (next !== shell) void setPaneView(pane, `term:${next}`); }}
          headerActions={tabbed() ? undefined : paneTabActions(pane)} header={tabbed() ? tabRow : undefined}
          onLive={(live) => setTermLive((current) => current[`term:${shell}`] === live ? current : { ...current, [`term:${shell}`]: live })}
          onClose={tabbed() || inDock(pane) || isMobileLayout() ? undefined : () => void closeDocument(pane)} />
      }</Show>
    </SheetFill>;
  };
  const focusAnyPane = (pane: PaneKey) => {
    if (parseFileView(viewOf(pane))) return focusFileViewer(pane);
    if (viewOf(pane)?.startsWith("folder:")) { setKeyboardPane(pane); return void requestAnimationFrame(() => focusFirst(paneElement(pane)?.querySelector<HTMLElement>(".ui-tool-content"))); }
    if (pane === "main") { setKeyboardPane("main"); enterMainPane(); } else focusPane(pane);
  };
  function focusFileViewer(pane: PaneKey) {
    setKeyboardPane(pane);
    let tries = 0;
    const land = () => {
      const surface = paneElement(pane)?.querySelector<HTMLElement>(".file-viewer-surface");
      const column = surface?.querySelector<HTMLElement>(".ui-file-viewer > .ui-file");
      const active = document.activeElement;
      if (column?.contains(active) && active !== column) return;
      // Focus taken elsewhere meanwhile is left there; the pane's own frame or a column is not elsewhere.
      const idle = !active || active === document.body || Boolean(paneElement(pane)?.contains(active) && active.matches(".file-viewer-surface, .ui-file-viewer > .ui-file"));
      if (tries && !idle) return;
      const editor = column?.querySelector<HTMLElement>(".cm-content");
      (editor ?? column ?? surface)?.focus({ preventScroll: true });
      // A viewer's first load (its chunks) or a large file draws late: up to 6s, never taking focus back.
      if (!editor && tries++ < 100) setTimeout(land, VIEWER_FOCUS_RETRY_MS);
    };
    requestAnimationFrame(land);
  }
  const folderProject = (id: string) => { const found = catalogue.projects().find((item) => item.id === id); const computer = computerLocation(); return found ? { ...found, repository: found.kind === "workspace" } : computer?.project.id === id ? { ...computer.project, repository: computer.repository } : null; };
  const renderFolderViewer = (pane: PaneKey, id: string) => <Show when={folderProject(id)} fallback={<SheetFill><PaneHeader actions={paneTabActions(pane)}><HeaderCrumb title="Files" /></PaneHeader><Empty>This workspace is not open here.</Empty></SheetFill>}>{(project) => {
    // A file document taking the pane is drawn before this viewer goes: its going clears only its own handle.
    let mine: FileSlotHandle | undefined;
    return <FolderPane projectId={id} projectName={project().name} workingRoot={project().workingRoot} sourceControlEnabled={project().repository} commentChatId={focusedChat().loadedId()} actions={paneTabActions(pane)}
      onOpenFile={(entry, options) => void openFileDocument(entry, { ...options, beside: true, tab: Boolean(verbNow().tab), edit: false })} openFiles={openFileKeys}
      onHandle={(handle) => { const list = handlesOf(pane); if (handle) list[0] = mine = handle; else if (list[0] === mine) list[0] = undefined; }} />;
  }}</Show>;
  const [fileReveal, setFileReveal] = createSignal<{ entry: FileEntry; request: ReviewNavigationRequest } | null>(null);
  const openFileDocument = async (entry: FileEntry, options: { beside?: boolean; tab?: boolean; edit: boolean; reveal?: ReviewNavigationRequest; /** Open it as the artifact kind it may be when asked (artifact-kinds `opens`). */ adopt?: boolean }) => {
    // A paper or a site is an artifact: its file opens as the artifact, never in the file viewer.
    if (options.adopt || entry.path.endsWith(".paper") || entry.path.endsWith(".site.html")) return void await import("./document/artifacts").then(({ artifactAt }) => artifactAt(entry.projectId, entry.path, options.adopt)).then(
      ({ id }) => openArtifact(id, { beside: options.beside }),
      (error) => toast.error(error instanceof Error ? error.message : String(error)));
    // A file that is an artifact only once asked (a Markdown file) opens as one if it already is; otherwise in the file viewer.
    if (!options.edit && !options.reveal && opensAs(entry.path)) { const made = await import("./document/artifacts").then(({ artifactFor }) => artifactFor(entry.projectId, entry.path)); if (made) return void openArtifact(made.id, { beside: options.beside }); }
    // Every open sets it, so one without edit retires an earlier edit's that never loaded.
    pendingFileEdit = options.edit ? entry : null;
    setFileReveal(options.reveal ? { entry, request: options.reveal } : null);
    const existing = Object.values(layout().panes).flatMap((pane) => pane.views).find((view) => {
      const shown = parseFileView(view)?.[0];
      return shown && sameFileEntry(shown, entry);
    });
    const view = existing ?? formatFileView([entry]);
    await openView(view, { beside: options.beside, tab: options.tab });
    if (options.edit && existing) {
      const found = Layouts.findView(layout(), view);
      const pane = found ? keyOf(found.id) : null;
      if (pane !== null && handlesOf(pane)[0]?.edit()) pendingFileEdit = null;
    }
  };
  const noteFileLoaded = (pane: PaneKey, index: number, file: FileSummary | null) => {
    const entry = parseFileView(viewOf(pane))?.[index];
    if (!file || !entry || file.path !== entry.path || !pendingFileEdit || !sameFileEntry(pendingFileEdit, entry)) return;
    if (handlesOf(pane)[index]?.edit()) pendingFileEdit = null;
  };
  const setFileMode = async (pane: PaneKey, index: number, mode: FileEntry["mode"]) => {
    const current = parseFileView(viewOf(pane));
    if (current) await setPaneView(pane, formatFileView(current.map((item, at) => at === index ? { projectId: item.projectId, path: item.path, ...(mode ? { mode } : {}) } : item)));
  };
  const renderFileViewer = (pane: PaneKey) => {
    const entries = () => parseFileView(viewOf(pane)) ?? [];
    // Focusable itself, so an image or PDF side still takes the keyboard (a click, Ctrl+Shift+2).
    return <SheetFill class="file-viewer-surface" tabIndex={-1}>
      <Show when={entries().length} fallback={<>
        <PaneHeader actions={paneTabActions(pane)}><HeaderCrumb title="No file open" /></PaneHeader>
        <Empty kind="file" role="status">Open a file from Files.</Empty>
      </>}>
        <FileViewer entries={entries()} closable={!inDock(pane) && !splitShown()} wrap={() => fileWrap(pane)} onToggleWrap={() => toggleFileWrap(pane)} commentChatId={focusedChat().loadedId()}
          paneActions={() => paneTabActions(pane)} onFocusEntry={() => setKeyboardPane(pane)} onCloseEntry={() => void closeDocument(pane)}
          onSetMode={(index, mode) => setFileMode(pane, index, mode)}
          onLoaded={(index, file) => noteFileLoaded(pane, index, file)} reveal={fileReveal()} ref={(index, handle) => { handlesOf(pane)[index] = handle; }} />
      </Show>
    </SheetFill>;
  };

  const slotChatId = (slot: number) => { const view = slotView(slot); return view?.startsWith("chat:") ? view.slice("chat:".length) : null; };
  const slotPage = (slot: number) => { const view = slotView(slot); return view?.startsWith("page:") ? view.slice("page:".length) : null; };
  const slotPageProject = (slot: number) => {
    const page = slotPage(slot);
    if (!page) return null;
    if (page === "dashboard") return catalogue.projects().find((item) => item.slug === "chat") || catalogue.projects()[0] || null;
    return catalogue.projects().find((item) => item.id === page.slice("project:".length)) || null;
  };
  const lastPaneFocus = new Map<PaneKey, HTMLElement>();
  const noteKeyboardSide = (event: FocusEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const pane = paneOf(target);
    if (pane === null || !target) return;
    setKeyboardPane(pane);
    lastPaneFocus.set(pane, target);
  };
  const cyclePaneFocus = (step = 1) => {
    const panes: PaneKey[] = ["main", ...shownSlots()];
    const from = paneOf(document.activeElement);
    const at = from === null ? -1 : panes.indexOf(from);
    const to: PaneKey = at >= 0 ? panes[(at + step + panes.length) % panes.length]! : panes.includes(keyboardPane()) ? keyboardPane() : "main";
    if (parseFileView(viewOf(to))) { focusAnyPane(to); return true; }
    const last = lastPaneFocus.get(to);
    if (last?.isConnected && last.closest(paneSelector(to)) && last.getClientRects().length) {
      last.focus({ preventScroll: true });
      if (to === "main") acknowledgeFocusedRegion(document.querySelector<HTMLElement>(".chat-main"));
      return true;
    }
    if (to !== "main") { focusPane(to); return true; }
    const viewer = document.querySelector<HTMLElement>(".chat-main .file-viewer-surface");
    if (viewer) { viewer.focus({ preventScroll: true }); return true; }
    return false;
  };
  document.addEventListener("focusin", noteKeyboardSide);
  let paneBeforePress: PaneKey | null = null;
  const notePanePress = (event: PointerEvent) => { paneBeforePress = keyboardPane(); const pane = paneOf(event.target instanceof Element ? event.target : null); if (pane !== null) setKeyboardPane(pane); };
  const noteFrameFocus = () => setTimeout(() => { const frame = document.activeElement; if (frame instanceof HTMLIFrameElement || frame instanceof HTMLEmbedElement || frame instanceof HTMLObjectElement) { const pane = paneOf(frame); if (pane !== null) setKeyboardPane(pane); } });
  document.addEventListener("pointerdown", notePanePress, true);
  window.addEventListener("blur", noteFrameFocus);
  onCleanup(() => { document.removeEventListener("focusin", noteKeyboardSide); document.removeEventListener("pointerdown", notePanePress, true); window.removeEventListener("blur", noteFrameFocus); });
  const mainChatId = () => routeKind() === "chat" && !paneADocument() ? catalogue.selectedId() : null;
  const openChatBeside = (target: ChatSummary, project: Project) => openChatHere(target, project, { beside: true });
  const openSubagentChat = async (chatId: string) => {
    try {
      const summary = hiddenChats().get(chatId)?.chat || await api<ChatSummary>(`/v0/chats/${encodeURIComponent(chatId)}`);
      const project = catalogue.projects().find((item) => item.id === summary.projectId);
      if (!project) return;
      setHiddenChats((current) => new Map(current).set(summary.id, { chat: summary, project }));
      await openChatBeside(summary, project);
    } catch (error) { showError(error); }
  };
  const agentChat = async (id: string) => {
    const cached = hiddenChats().get(id);
    if (cached) return cached;
    const summary = await api<ChatSummary>(`/v0/chats/${encodeURIComponent(id)}`);
    const project = catalogue.projects().find((item) => item.id === summary.projectId)
      || (await catalogue.refresh()).find((item) => item.id === summary.projectId);
    if (!project) throw new Error("Agent chat project not found");
    const found = { chat: summary, project };
    setHiddenChats((current) => new Map(current).set(id, found));
    return found;
  };
  const openSubagentFromEvent = (event: Event) => { const chatId = (event as CustomEvent<{ chatId?: string }>).detail?.chatId; if (chatId) void openSubagentChat(chatId); };
  window.addEventListener(OPEN_AGENT_EVENT, openSubagentFromEvent);
  onCleanup(() => window.removeEventListener(OPEN_AGENT_EVENT, openSubagentFromEvent));
  const subagentParent = (chatId: string | null) => {
    const parentId = chatId ? hiddenChats().get(chatId)?.chat.backend?.parentChatId : null;
    if (parentId && parentId === agentView()?.home?.chatId) return { title: agentName(), open: () => void openJbotHere() };
    const parent = parentId ? catalogue.projects().flatMap((project) => project.sessions.map((item) => ({ chat: item, project }))).find((item) => item.chat.id === parentId) || hiddenChats().get(parentId) : null;
    return { title: parent?.chat.title || "another chat", open: parent ? () => void openChatHere(parent.chat, parent.project) : undefined };
  };
  const openChatHere = async (target: ChatSummary, project: Project, verb: Layouts.Verb = {}) => {
    if (keyboardPane() !== "main" || verb.beside || verb.tab) markChatRead(catalogue, target);
    await openView(`chat:${target.id}`, verb, () => openChat(target, project));
  };
  const openProjectHere = (project: Project, verb: Layouts.Verb = {}) => openView(`page:project:${project.id}`, verb, () => openProject(project));
  const openDashboardHere = (verb: Layouts.Verb = {}) => openView("page:dashboard", verb, () => openDashboard());
  const openComputerHere = (verb: Layouts.Verb = {}) => openView("page:computer", verb, () => openComputer());
  const openArtifact = async (id: string, verb: Layouts.Verb = {}) => {
    const view = `artifact:${id}` as const;
    const threaded = (["main", ...slotOrder()] as PaneKey[]).find((pane) => matedPaper(viewOf(pane)) === id);
    if (threaded !== undefined) { await setPaneView(threaded, view); return focusAnyPane(threaded); }
    await openView(view, verb);
  };
  const openHarnessHere = (id: string, verb: Layouts.Verb = {}) => openView(`page:harness:${encodeURIComponent(id)}`, verb, () => openComputerHarness(id));
  const openAgentHere = (verb: Layouts.Verb = {}) => openView("page:agent", verb, () => openAgent());
  const openJbotHere = (verb: Layouts.Verb = {}) => openView("page:jbot", verb, () => openJbot());
  const openEnvironmentHere = (id: string, verb: Layouts.Verb = {}) => openView(`page:environment:${encodeURIComponent(id)}`, verb, () => openEnvironment(id));
  const warmJbot = () => {
    prefetchJbotMessages();
    const home = agentView()?.home?.chatId;
    if (home) void agentChat(home).then((target) => chat.prefetch(target.chat)).catch(() => {});
  };
  createEffect(on(mobileSidebarOpen, (open) => { if (open && isMobileLayout() && agentView()?.enabled) warmJbot(); }, { defer: true }));
  const pageDrawn = () => paneDrawn(document.querySelector(".chat-main"));
  const shutDrawerOnto = (opening: Promise<unknown>, shown: () => boolean = () => true) => {
    void opening.catch(() => {});
    if (!isMobileLayout() || !mobileSidebarOpen()) { setMobileSidebarOpen(false); return; }
    handDrawerOnto({ opening, open: mobileSidebarOpen, shut: () => setMobileSidebarOpen(false), drawn: () => shown() && pageDrawn(), at: () => `${routeKind()}:${mainChatId()}` });
  };
  /** For the pages' chat lists, which hand over the chat alone; called from their click. */
  const openChatFromPage = (target: ChatSummary, project: Project) => openChatHere(target, project, verbNow());
  for (const pane of paneSlots) {
    const slot = pane.index;
    const side = pane.session;
    // The pane follows its view. A missing chat in the loaded catalogue is
    // gone even if it was deleted before this page restored the saved pane.
    createEffect(on(() => slotChatId(slot), (id) => {
      const thread = paneThreads.get(slot);
      if (thread && id !== thread) { paneThreads.delete(slot); void api(`/v0/sessions/${encodeURIComponent(thread)}`, { method: "DELETE" }).catch(() => {}); }
    }));
    createEffect(on(() => [slotChatId(slot), catalogue.loaded(), catalogue.projects(), hiddenChats()] as const, ([id, loaded, projects, hidden]) => {
      if (!id) {
        if (!untrack(() => slotPage(slot)) && untrack(side.selectedId)) side.close();
        return;
      }
      if (!loaded) return;
      const found = projects.flatMap((project) => project.sessions.map((item) => ({ chat: item, project }))).find((item) => item.chat.id === id) || hidden.get(id);
      if (!found) {
        // setProjects marks the catalogue loaded before publishing its list.
        // Recheck after both writes, and never close a pane that moved on.
        queueMicrotask(async () => {
          if (slotChatId(slot) !== id || !catalogue.loaded() || hiddenChats().has(id)
            || catalogue.projects().some((project) => project.sessions.some((item) => item.id === id))) return;
          const at = Layouts.findView(layout(), `chat:${id}`);
          if (at) panes.replace((current) => Layouts.closeTab(current, at.id, at.index));
        });
        return;
      }
      if (untrack(side.selectedId) !== id) void side.open(found.chat, found.project).catch(showError);
    }));
    createEffect(on(() => [slotPage(slot), catalogue.loaded(), templatesLoading(), shownSlots().includes(slot)] as const, ([page, loaded, loading, shown]) => {
      // A page giving way to a chat: the chat is already opening in the session, so the draft goes without closing it.
      if (!page || page === "computer" || page === "agent" || page === "jbot" || page.startsWith("harness:")) return discardPaneDraft(pane, Boolean(untrack(() => slotChatId(slot))));
      if (!loaded || loading || !shown) return;
      const project = untrack(() => slotPageProject(slot));
      if (!project) return void setSlotView(slot, null);
      if (pane.draft?.projectId === project.id && untrack(side.selectedId) === pane.draft.id) return;
      discardPaneDraft(pane);
      const templateId = project.defaultTemplateId || untrack(defaultTemplateId) || "assistant";
      void createProfileChat(project, templateId, side.models).then(async (created) => {
        if (untrack(() => slotPage(slot)) !== page) {
          await api(`/v0/chats/${encodeURIComponent(created.id)}?ifEmpty=true`, { method: "DELETE" });
          return;
        }
        pane.draft = { id: created.id, projectId: project.id };
        await side.chat.initialize({ ...created, templateId: created.templateId || templateId || undefined }, project);
      }).catch(showDraftError);
    }));
  }
  function discardPaneDraft(pane: PaneSlot, keepSession = false) {
    const draft = pane.draft;
    if (!draft) return;
    pane.draft = null;
    if (!keepSession && untrack(pane.session.selectedId) === draft.id) pane.session.close();
    void api(`/v0/chats/${encodeURIComponent(draft.id)}?ifEmpty=true`, { method: "DELETE" }).catch(() => {});
  }
  const sendFromPanePage = async (pane: PaneSlot, prompt: string) => {
    const side = pane.session;
    const project = chatPlace(side).current || untrack(() => slotPageProject(pane.index));
    const id = side.chat.loadedId();
    if (!project || !id) return;
    catalogue.setProjects((current) => current.map((item) => item.id === project.id
      ? { ...item, sessions: [{ id, projectId: project.id, status: "active", title: side.chat.title() || "New chat", templateId: side.chat.templateId() || undefined }, ...item.sessions.filter((existing) => existing.id !== id)] }
      : item));
    side.chat.setDraft(prompt);
    pane.draft = null;
    await setSlotView(pane.index, `chat:${id}`);
    await side.chat.send();
  };
  const focusedSlot = () => { const slot = keyboardSlot(); return slot !== null && paneSlot(slot).session.selectedId() ? paneSlot(slot) : null; };
  const focusedSession = (): ChatSession => focusedSlot()?.session ?? session;
  const focusedChat = () => focusedSession().chat;
  const focusedModels = () => focusedSession().models;
  const sideFocused = () => focusedSlot() !== null;
  const focusedChatId = () => focusedSlot()?.session.selectedId() ?? catalogue.selectedId();
  const focusedTarget = () => focusedSlot()?.session.selected() ?? {};
  type PlaceSelection = { project: Project } | NonNullable<ReturnType<ReturnType<typeof paneSlot>["session"]["selected"]>>;
  const placeOf = (pane: PaneKey): PlaceSelection | "route" | null => {
    if (!panesShown().includes(pane)) return null;
    if (pane === "main" && !paneADocument()) return "route";
    const view = viewOf(pane);
    const byId = (id: string | undefined) => catalogue.projects().find((item) => item.id === id);
    const files = parseFileView(view);
    if (files) { const project = byId(files[0]?.projectId); return project ? { project } : null; }
    if (view === "page:dashboard") { const project = catalogue.projects().find((item) => item.slug === "chat") ?? catalogue.projects()[0]; return project ? { project } : null; }
    if (view?.startsWith("page:project:")) { const project = byId(view.slice("page:project:".length)); return project ? { project } : null; }
    if (view?.startsWith("chat:")) {
      if (pane !== "main") return paneSlot(pane).session.selected() ?? null;
      const id = view.slice("chat:".length);
      const project = catalogue.projects().find((item) => item.sessions.some((chat) => chat.id === id));
      return project ? { project } : null;
    }
    return null;
  };
  const [heldPlace, setHeldPlace] = createSignal<PlaceSelection | "route">("route");
  createEffect(() => { const place = placeOf(keyboardPane()); if (place) setHeldPlace(() => place); });
  const dockSelection = (): PlaceSelection | null => { const place = heldPlace(); return place === "route" ? null : place; };
  const dockProject = () => dockSelection()?.project ?? dockHome();
  const dockScope = () => dockSelection() ? `project:${dockSelection()!.project.id}` : workspacePanelScope();
  let swappingPanes = false;
  function paneAView(): SplitView { return paneAShown(); }
  /** What pane A draws itself rather than through the route. */
  const paneADocument = () => { const view = paneAView(); return isPaneView(view) ? null : view; };
  /** The route's view once it has settled; jbot's home thread is its page's, never a chat of its own (leaving the page
   *  for a chat, the route turns to the chat a moment before the selection does). */
  const settledRoute = createMemo(() => {
    const settling = (routeKind() === "project" && !selectedProject()) || (routeKind() === "chat" && !catalogue.selectedId() && !catalogue.loaded());
    const view = routeBootstrap() === "ready" && !settling ? paneARouteView() : null;
    return view && view === `chat:${agentView()?.home?.chatId}` ? null : view;
  });
  /** Pane A showing the route's view, which stands nowhere else: a view is open once. */
  const fromRoute = (current: Layouts.Layout, route: SplitView) => {
    const at = Layouts.findView(current, route);
    const cleared = at && at.id !== current.row[0] ? Layouts.closeTab(current, at.id, at.index) : current;
    return Layouts.show(cleared, cleared.row[0]!, route);
  };
  function paneARouteView(): SplitView | null {
    if (routeKind() === "chat" && catalogue.selectedId()) return `chat:${catalogue.selectedId()}`;
    if (routeKind() === "dashboard") return "page:dashboard";
    if (routeKind() === "agent") return "page:agent";
    if (routeKind() === "jbot") return "page:jbot";
    if (routeKind() === "computer" && computerEnvironment() && !computerHarness()) return `page:environment:${encodeURIComponent(computerEnvironment())}`;
    if (routeKind() === "computer" && !computerHarness()) return "page:computer";
    if (routeKind() === "computer" && !harnessThread()) return `page:harness:${encodeURIComponent(computerHarness())}`;
    if (routeKind() === "project" && selectedProject()) return `page:project:${selectedProject()!.id}`;
    return null;
  };
  const openInPaneA = async (view: SplitView) => {
    if (view === "page:dashboard") return await openDashboard();
    if (view === "page:agent") return await openAgent();
    if (view === "page:jbot") return await openJbot();
    if (view === "page:computer") return await openComputer();
    if (view.startsWith("page:environment:")) return await openEnvironment(decodeURIComponent(view.slice("page:environment:".length)));
    if (view.startsWith("page:harness:")) return await openComputerHarness(decodeURIComponent(view.slice("page:harness:".length)));
    if (view.startsWith("page:project:")) {
      const project = catalogue.projects().find((item) => item.id === view.slice("page:project:".length));
      return project ? (await openProject(project)) : undefined;
    }
    const id = view.slice("chat:".length);
    const hidden = hiddenChats().get(id);
    if (hidden) return await openChat(hidden.chat, hidden.project);
    for (const project of catalogue.projects()) {
      const found = project.sessions.find((item) => item.id === id);
      if (found) return await openChat(found, project);
    }
  };
  const swapPartner = (pane: PaneKey): PaneKey | null => {
    const shown = shownSlots();
    if (pane === "main") return shown[0] !== undefined && paneAView() ? shown[0] : null;
    const at = shown.indexOf(pane);
    if (at === 0) return paneAView() ? "main" : null;
    return at > 0 ? shown[at - 1]! : null;
  };
  let keyboardBeforePress: PaneKey | null = null;
  let previousPane: PaneKey | null = null;
  createEffect(on(keyboardPane, (now, before) => { if (before !== undefined && before !== now) previousPane = before; }));
  const swapTarget = (pane: PaneKey): PaneKey | null => {
    const shown = panesShown();
    const from = keyboardBeforePress;
    if (from !== null && from !== pane && shown.includes(from)) return from;
    if (shown.length === 3 && shown.indexOf(pane) === 1 && previousPane !== null && previousPane !== pane && shown.includes(previousPane)) return previousPane;
    return swapPartner(pane);
  };
  const paneElement = (pane: PaneKey) => pane === "main" ? document.querySelector<HTMLElement>(".chat-main") : paneSlot(pane).host();
  // The time out is a timer: a background tab runs no frames.
  const waitFor = (ready: () => boolean, timeout = 800) => new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { done = true; clearTimeout(cap); resolve(); };
    const cap = setTimeout(finish, timeout);
    const check = () => { if (!done) ready() ? finish() : requestAnimationFrame(check); };
    check();
  });
  // A chat is drawn once its transcript is in the pane, not merely loaded:
  // it renders a moment after, and a crossfade before then shows it arrive.
  const chatDrawn = (pane: PaneKey) => Boolean(paneElement(pane)?.querySelector(".ui-chat-column"));
  const ghostOf = (element: HTMLElement) => {
    const box = element.getBoundingClientRect();
    const ghost = element.cloneNode(true) as HTMLElement;
    ghost.removeAttribute("data-pane-slot");
    Object.assign(ghost.style, { position: "fixed", left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, margin: "0", zIndex: "40", pointerEvents: "none" });
    document.body.append(ghost);
    // A clone starts scrolled to the top; hold each scroller where it was.
    const from = [...element.querySelectorAll<HTMLElement>("*")];
    const to = [...ghost.querySelectorAll<HTMLElement>("*")];
    from.forEach((source, index) => { if (source.scrollTop || source.scrollLeft) { to[index]!.scrollTop = source.scrollTop; to[index]!.scrollLeft = source.scrollLeft; } });
    // A clone's canvas is blank; paint in what the original shows (a terminal).
    from.forEach((source, index) => {
      if (!(source instanceof HTMLCanvasElement) || !source.width || !source.height) return;
      try { (to[index] as HTMLCanvasElement).getContext("2d")?.drawImage(source, 0, 0); } catch { /* left blank */ }
    });
    return ghost;
  };
  const crossfadeUnder = async (elements: HTMLElement[], place: () => Promise<void>) => {
    const still = reducedMotion();
    const ghosts = elements.map(ghostOf);
    for (const element of elements) element.style.opacity = "0";
    try { await place(); } finally {
      // The panes come back whole under their ghosts, and only the ghosts
      // fade: both layers at half opacity let the background through.
      for (const element of elements) element.style.opacity = "";
      await Promise.all(ghosts.map(async (ghost) => { if (!still) await ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration("--duration-follow"), easing: easing("--ease-arrive"), fill: "forwards" }).finished.catch(() => undefined); ghost.remove(); }));
    }
  };
  const crossfadeSwap = (left: HTMLElement, right: HTMLElement, place: () => Promise<void>) => crossfadeUnder([left, right], place);
  // A pane moved in the DOM loses its scrollers' places; hold them across the move and put them back.
  const holdScroll = (elements: HTMLElement[]) => {
    const held = elements.flatMap((element) => [...element.querySelectorAll<HTMLElement>("*")].filter((node) => node.scrollTop || node.scrollLeft).map((node) => [node, node.scrollTop, node.scrollLeft] as const));
    return () => held.forEach(([node, top, left]) => { node.scrollTop = top; node.scrollLeft = left; });
  };
  const animateSwap = async (left: HTMLElement, right: HTMLElement, reorder: boolean, placeRight: () => Promise<void> | void, placeLeft: () => Promise<void> | void) => {
    const still = reducedMotion();
    if (!still) {
      await right.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration("--duration-quick"), easing: easing("--ease-leave"), fill: "forwards" }).finished;
      left.style.zIndex = "5";
      await left.animate([{ transform: "none" }, { transform: `translateX(${right.getBoundingClientRect().left - left.getBoundingClientRect().left}px)` }], { duration: duration("--duration-fold"), easing: easing("--ease-fold"), fill: "forwards" }).finished;
    }
    await placeRight();
    const incoming = reorder ? right : left;
    incoming.style.opacity = "0";
    for (const element of [left, right]) { element.getAnimations().forEach((animation) => animation.cancel()); element.style.zIndex = ""; }
    await placeLeft();
    if (!still) await incoming.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration("--duration-follow"), easing: easing("--ease-arrive") }).finished;
    incoming.style.opacity = "";
  };
  const swapPanes = async (pane: PaneKey, slide = false, withPane?: PaneKey, fade = true, keep: PaneKey | null = keyboardPane()) => {
    const partner = withPane ?? swapPartner(pane);
    if (partner === null || swappingPanes) return;
    const place = keep === null ? -1 : panesShown().indexOf(keep);
    const intent = focusIntent.next();
    const settleFocus = () => { if (!intent()) return; const target = panesShown()[place]; if (place >= 0 && target !== undefined) focusAnyPane(target); };
    const [leftPane, rightPane] = pane === "main" || (partner !== "main" && shownSlots().indexOf(partner) > shownSlots().indexOf(pane as number)) ? [pane, partner] : [partner, pane];
    const left = paneElement(leftPane);
    const right = paneElement(rightPane);
    if (!left || !right) return;
    swappingPanes = true;
    try {
      if (leftPane === "main") {
        const slot = rightPane as number;
        const aView = paneAView();
        const unsaved = [...handlesOf("main"), ...handlesOf(slot)].some((handle) => handle?.hasUnsavedChanges());
        if (unsaved && !(await confirmDialog("Discard unsaved changes to swap these panes?"))) return;
        movingDocuments = true;
        const a = layout().row[0]!, b = idOf(slot)!;
        // One change trades both: the slot (kept by the pane moving out of A) loads A's view, and A's route follows.
        const trade = async () => {
          await changeLayout((current) => Layouts.swap(current, a, b));
          const id = aView.startsWith("chat:") ? aView.slice("chat:".length) : null;
          await waitFor(() => !id || (paneSlot(slot).session.chat.loadedId() === id && chatDrawn(slot)), 1500);
        };
        if (slide) await animateSwap(left, right, false, trade, settleFocus);
        else if (!fade) await trade();
        else await crossfadeSwap(left, right, async () => { await trade(); settleFocus(); });
      } else {
        const a = idOf(leftPane)!, b = idOf(rightPane)!;
        const reorder = () => {
          const restore = holdScroll([left, right]);
          panes.apply((current) => Layouts.swap(current, a, b));
          restore();
        };
        if (slide) await animateSwap(left, right, true, reorder, settleFocus);
        else if (!fade) reorder();
        else await crossfadeSwap(left, right, async () => { reorder(); settleFocus(); });
      }
    } finally {
      swappingPanes = false;
      movingDocuments = false;
      if (fade || slide) settleFocus();
    }
  };
  const foldedSlots = () => !dockAvailable() || isMobileLayout() ? [] : rowSlots().filter((slot) => slotView(slot) && !shownSlots().includes(slot));
  const viewName = (view: SplitView | null): string => {
    if (!view) return "";
    if (matedPaper(view)) return viewName(paperOf(view));
    if (view.startsWith("chat:")) {
      const id = view.slice("chat:".length);
      const found = catalogue.projects().flatMap((project) => project.sessions).find((item) => item.id === id) || hiddenChats().get(id)?.chat;
      return found?.title || "New chat";
    }
    if (view === "home") return "New tab";
    if (view === "page:dashboard") return "Conduit Dashboard";
    if (view === "page:agent") return `${agentName()}'s page`;
    if (view === "page:jbot") return agentName();
    if (view === "page:computer") return activeServer()?.name || "Hub";
    if (view.startsWith("page:environment:")) { const state = deviceStates().get(decodeURIComponent(view.slice("page:environment:".length))); return state ? deviceLabel(state) : "Environment"; }
    if (view.startsWith("page:harness:")) { const id = decodeURIComponent(view.slice("page:harness:".length)); return harnessLabelFor(id) || id; }
    if (view.startsWith("page:project:")) return catalogue.projects().find((item) => item.id === view.slice("page:project:".length))?.name || "Project";
    const files = parseFileView(view);
    if (files) return files.length ? files.map((entry) => entry.path.split("/").pop()).join(", ") : "File viewer";
    if (view.startsWith("term:")) return termTitles()[view] || "Terminal";
    if (view.startsWith("browser:")) return browserTitles()[view] || "Browser";
    if (view.startsWith("mail:")) return "Mail";
    if (view === "artifact:new" || view.startsWith("artifact:new:")) return "New artifact";
    if (view.startsWith("artifact:")) { askArtifactName(view); return artifactNames()[view]?.name || "Artifact"; }
    if (view.startsWith("folder:")) return `Files · ${folderProject(view.slice("folder:".length))?.name ?? "Workspace"}`;
    return "Pane";
  };
  /** A session pane's tabs are its views; a document pane (a paper's thread among them) has none. */
  const tabsOf = (pane: PaneKey) => { const data = paneData(pane); return data && data.views.every((view) => Layouts.sessionView(view) && !matedPaper(view)) ? data.views : null; };
  const chatOfTab = (view: SplitView) => view.startsWith("chat:") ? view.slice("chat:".length) : null;
  const tabPlace = (view: SplitView) => {
    if (view.startsWith("page:project:")) return view.slice("page:project:".length);
    const id = chatOfTab(view);
    if (!id) return `doc:${view.split(":")[0]}`;
    return hiddenChats().get(id)?.chat.status === "subagent" ? `sub:${hiddenChats().get(id)!.chat.backend?.parentChatId ?? ""}`
      : catalogue.projects().find((item) => item.sessions.some((chat) => chat.id === id))?.id ?? "chats";
  };
  const keyboardPaneSlot = () => { const pane = keyboardPane(); return pane !== "main" && shownSlots().includes(pane) ? pane : null; };
  const tabsToStep = () => { const pane: PaneKey = keyboardPaneSlot() ?? "main"; const list = tabsOf(pane); return !isMobileLayout() && list && list.length > 1 ? { pane, list } : null; };
  const stepTab = async (step: number) => {
    const found = tabsToStep();
    if (!found) return;
    const at = paneData(found.pane)!.active;
    void switchTab(found.pane, (at + step + found.list.length) % found.list.length);
  };
  const stepPane = (step: number) => { if (!cyclePaneFocus(step)) focusAnyPane("main"); };

  const switchTab = async (pane: PaneKey, index: number) => {
    const id = idOf(pane);
    if (!id || !(await gate(pane, paneData(pane)?.views[index] ?? null))) return;
    await changeLayout((current) => Layouts.switchTab(current, id, index), { record: false });
    focusAnyPane(pane);
  };
  const closeTab = async (pane: PaneKey, index: number) => {
    const id = idOf(pane);
    const data = paneData(pane);
    if (!id || !data) return;
    if (data.views.length < 2) return await closeDocument(pane);
    if (index === data.active && !(await gate(pane, data.views[index === 0 ? 1 : index - 1] ?? null))) return;
    await changeLayout((current) => Layouts.closeTab(current, id, index));
  };
  const openFileKeys = createMemo(() => {
    const keys = new Map<string, "focused" | "shown">();
    for (const pane of panesShown()) for (const entry of parseFileView(viewOf(pane)) ?? []) {
      const key = fileEntryKey(entry);
      if (pane === keyboardPane()) keys.set(key, "focused"); else if (!keys.has(key)) keys.set(key, "shown");
    }
    return keys;
  }, new Map(), { equals: (a, b) => a.size === b.size && [...a].every(([key, value]) => b.get(key) === value) });
  type TabStripOptions = {
    keys: () => string[] | null;
    place: (key: string) => string;
    placeLabel: (key: string) => string;
    title: (key: string) => string;
    icon: (key: string) => JSX.Element;
    lit: () => string | null;
    used: () => string[];
    live: (key: string) => boolean;
    select: (key: string) => void;
    close: (key: string) => void;
    dragView: (key: string) => string;
    groupDrag: (keys: string[]) => Record<string, string>;
    add: () => void;
  };
  const createTabStrip = (options: TabStripOptions) => {
    const groups = createMemo(() => {
      const runs: { place: string; keys: string[] }[] = [];
      for (const key of options.keys() ?? []) {
        const place = options.place(key);
        if (runs.at(-1)?.place === place) runs.at(-1)!.keys.push(key);
        else runs.push({ place, keys: [key] });
      }
      return runs;
    }, [], { equals: (a, b) => a.length === b.length && a.every((run, index) => run.place === b[index]!.place && run.keys.join() === b[index]!.keys.join()) });
    const [folded, setFolded] = createSignal<string[]>([]);
    const has = createMemo(() => Boolean(options.keys()));
    return createMemo(() => has() ? untrack(() => <PaneTabs onFold={setFolded}>
      <For each={groups()}>{(run) => {
        const current = () => run.keys.includes(options.lit() ?? "");
        const label = () => options.placeLabel(run.keys[0]!);
        const recent = () => options.used().find((key) => run.keys.includes(key)) ?? run.keys[0]!;
        return <TabPlace current={current()} label={label()} onLabel={() => { if (!current()) options.select(recent()); }}
          labelProps={{ draggable: "true", "data-doc-view": options.dragView(recent()), ...options.groupDrag(run.keys) } as JSX.ButtonHTMLAttributes<HTMLButtonElement>}>
          <For each={run.keys}>{(key) => {
            const lit = () => options.lit() === key;
            const name = () => options.title(key);
            return <PaneTab id={key} lit={lit()}
              drag={{ draggable: lit() ? undefined : "true", "data-doc-view": lit() ? undefined : options.dragView(key) }}
              icon={options.icon(key)} live={options.live(key)} title={name()} hint={`${label()} / ${name()}`}
              closeTitle="Close tab"
              onOpen={() => { if (!lit()) options.select(key); }} onClose={() => options.close(key)} />;
          }}</For>
        </TabPlace>;
      }}</For>
      <Show when={folded().length}>
        <DropdownMenu modal={false} placement="bottom-end">
          <MenuControl kind="pane" as={IconButton} label={`${folded().length} more tabs`}><Icons.More /></MenuControl>
          <MenuContent>
            <For each={groups().filter((run) => run.keys.some((key) => folded().includes(key)))}>{(run) =>
              <MenuSection title={options.placeLabel(run.keys[0]!)}>
                <For each={run.keys.filter((key) => folded().includes(key))}>{(key) => <MenuRow onSelect={() => options.select(key)}>{options.title(key)}</MenuRow>}</For>
              </MenuSection>}
            </For>
          </MenuContent>
        </DropdownMenu>
      </Show>
      <IconButton kind="pane" label="New tab" onClick={options.add}><Icons.Add /></IconButton>
    </PaneTabs>) : undefined);
  };
  const placeLabelOf = (projectId: string) => { const project = catalogue.projects().find((item) => item.id === projectId); return !project || project.slug === "chat" ? "Chats" : project.name || project.slug; };
  const paneTabRow = (pane: PaneKey) => {
    const views = () => tabsOf(pane) ?? [];
    const row = createTabStrip({
      keys: () => { const list = tabsOf(pane); return list && !isMobileLayout() ? list : null; },
      place: (view) => tabPlace(view as SplitView),
      placeLabel: (view) => { const place = tabPlace(view as SplitView); return place === "doc:term" ? "Terminal" : place.startsWith("doc:") ? "Conduit" : place.startsWith("sub:") ? subagentParent(chatOfTab(view as SplitView)).title : placeLabelOf(place); },
      title: (view) => viewName(view as SplitView),
      icon: (view) => hiddenChats().get(chatOfTab(view as SplitView) ?? "")?.chat.status === "subagent" ? <Icons.Agent /> : undefined,
      lit: () => { const data = paneData(pane); return data ? Layouts.shownView(data) : null; },
      used: () => { const data = paneData(pane); return data ? [Layouts.shownView(data), ...data.views] : []; },
      live: (view) => Boolean(runtime.getProcess(chatOfTab(view as SplitView) ?? "")) || Boolean(termLive()[view]),
      select: (view) => void switchTab(pane, views().indexOf(view as SplitView)),
      close: (view) => void closeTab(pane, views().indexOf(view as SplitView)),
      add: () => void newTab(pane),
      dragView: (view) => view,
      groupDrag: (keys) => ({ "data-tab-group": keys.join(",") }),
    });
    return { get tabs() { return row(); } };
  };
  // One strip per pane for the headers that take it, made once: rebuilt on each layout change it would lose its folding.
  const strips = new Map<PaneKey, ReturnType<typeof paneTabRow>>();
  const stripOf = (pane: PaneKey) => { let strip = strips.get(pane); if (!strip) createRoot(() => strips.set(pane, strip = paneTabRow(pane))); return strip!; };
  /** The tab row a header takes: a session pane's; a document's header is its own. */
  const documentTab = (pane: PaneKey) => tabsOf(pane) && !isMobileLayout() ? stripOf(pane).tabs : undefined;
  /** The launcher, as a new tab of a session pane. */
  const newTab = async (pane: PaneKey) => {
    const id = idOf(pane);
    if (isMobileLayout() || !id) return;
    const at = paneData(pane)!.views.indexOf("home");
    if (at >= 0) return void switchTab(pane, at);
    panes.replace((current) => Layouts.focus(current, id));
    await changeLayout((current) => Layouts.open(current, "home", { tab: true }, openRules));
    focusAnyPane(pane);
  };
  const closeDocument = async (pane: PaneKey) => {
    if (viewOf(pane) === "home") return await closePane(pane);
    // The slide-over dock never shows an empty pane: a document closed there closes its docked pane, as the dock's
    // own Close does (and with it the dock, when it was showing it).
    if (inDock(pane)) return await closeSlot(pane as number);
    // A chat's pane is wider than an empty one may be: held at the shares it has now, then eased to the row's own, so
    // the room it gives back glides to the panes beside rather than jumping in one frame.
    const held = splitShown() && animatePanes() ? paneShares() : null;
    if (held) setWeightOverride(held);
    if (await setPaneView(pane, "home")) focusAnyPane(pane);
    if (!held) return;
    requestAnimationFrame(() => easePaneWeights(normalized(weightsFor(panesShown().length)), () => setWeightOverride(null)));
  };
  const [windowMaximized, setWindowMaximized] = createSignal(false);
  if (desktopShell) {
    void desktopShell.settings().catch(() => {});
    void desktopShell.window.watchMaximized(setWindowMaximized).then((stop) => onCleanup(stop)).catch(() => {});
  }
  createEffect(() => {
    const mode = desktopShell ? desktopTitleBar() : "native";
    if (mode === "native") delete document.documentElement.dataset.titleBar; else document.documentElement.dataset.titleBar = mode;
    setWindowDrags(mode !== "native");
  });
  // A new chat is started warm, before anything is said in it: not a chat the person has going until it has a message.
  const liveChats = createMemo(() => {
    const chats = new Map(catalogue.projects().flatMap((project) => project.sessions.map((chat) => [chat.id, chat] as const)));
    // jbot's threads are not in the catalogue; any other process whose chat is not there is one left from a chat that
    // is gone (a discarded draft): nothing to open, so not a live chat.
    const agent = agentView();
    const jbots = new Set([agent?.home?.chatId, ...(agent?.sides || []).map((side) => side.chatId)].filter(Boolean));
    return [...runtime.processes().values()].filter((process) => {
      if (!visibleRuntimeActivity(process)) return false;
      if (jbots.has(process.chatId)) return true;
      const chat = chats.get(process.chatId);
      return Boolean(chat) && (Boolean(chat!.lastMessageAt || chat!.lastUserMessageAt) || generating(process));
    });
  });
  function generating(process: RuntimeProcess) { const activity = visibleRuntimeActivity(process); return activity !== "idle" && activity !== "failed"; }
  const runningTurns = createMemo(() => liveChats().filter(generating).map((process) => process.chatId));
  const runningName = (id: string) => id === agentView()?.home?.chatId ? agentName()
    : (agentView()?.sides || []).find((side) => side.chatId === id)?.title || viewName(`chat:${id}` as SplitView);
  const openRunning = async (id: string) => {
    if (id === agentView()?.home?.chatId) return openJbotHere();
    const project = catalogue.projects().find((item) => item.sessions.some((chat) => chat.id === id));
    const target = project ? { chat: project.sessions.find((chat) => chat.id === id)!, project } : await agentChat(id).catch(() => null);
    if (target) await openChatHere(target.chat, target.project); else showError("That chat is no longer available.");
  };
  const windowControls = (kind: "bar" | "rail") => desktopShell && <WindowControls kind={kind} maximized={windowMaximized()}
    onMinimize={() => void desktopShell!.window.minimize()} onMaximize={() => void desktopShell!.window.toggleMaximize()} onClose={() => void desktopShell!.window.close()} />;
  const openBrowser = () => void openBeside("browser:hub");
  const openMail = () => {
    const at = layout().row.find((id) => Layouts.shownView(layout().panes[id]!).startsWith("mail:"));
    const pane = at ? keyOf(at) : null;
    if (pane !== null) return focusAnyPane(pane);
    void openBeside("mail:default");
  };
  const openEmptyPane = () => {
    if (rowFull() || !viewsFit([...shownSlots().map(slotView), "home"])) return void toast.info("There is no room for another pane.");
    void openBeside("home");
  };
  const closePane = async (pane: PaneKey) => {
    if (pane !== "main") return await closeSlot(pane);
    const element = paneElement("main");
    if (!element || shownSlots()[0] === undefined || !animatePanes()) return await closePaneA();
    setWeightOverride(paneShares());
    setPaneMotion({ slot: "main", phase: "leaving", width: element.getBoundingClientRect().width });
    const leaving = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration("--duration-fold") * 0.55, easing: easing("--ease-leave"), fill: "forwards" });
    void Promise.resolve().then(() => {
      const target = weightsFor(shownSlots().length);
      target.unshift(0);
      easePaneWeights(normalized(target), async () => {
        leaving.cancel();
        const beside = paneSlot(shownSlots()[0]!).host();
        // Pane A takes the next pane's place at once, under a ghost of it that alone fades: two layers crossfading each
        // at half opacity let the background through.
        const ghost = beside ? ghostOf(beside) : null;
        try {
          const closing = closePaneA();
          batch(() => { setWeightOverride(null); setPaneMotion(null); });
          await closing;
          const id = chatOfTab(paneAView());
          await waitFor(() => !id || (chat.loadedId() === id && chatDrawn("main")), 1500);
          await ghost?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: duration("--duration-follow"), easing: easing("--ease-arrive"), fill: "forwards" }).finished.catch(() => undefined);
        } finally { ghost?.remove(); }
      });
    });
  };
  /** Pane A closing: the pane beside it becomes pane A, keeping its document. */
  const closePaneA = async () => {
    const next = rowSlots()[0];
    if (next === undefined) return;
    movingDocuments = true;
    try { await changeLayout((current) => Layouts.closePane(current, current.row[0]!)); } finally { movingDocuments = false; }
  };
  createAgentUiBridge({
    connection: connectionId,
    route: () => routeKind(),
    panes: () => panesShown().map((pane) => { const view = viewOf(pane); return { pane, view, title: view ? viewName(view) : "Empty pane", focused: keyboardPane() === pane }; }),
    actions: (() => {
      const paneOf = (command: AgentUiCommand, mustShow = true) => {
        const shown = panesShown();
        const pane = command.pane ?? keyboardPane();
        if (mustShow && !shown.includes(pane)) throw new Error(`No pane ${String(pane)} is open; open ones: ${shown.map(String).join(", ")}`);
        return { shown, pane };
      };
      return {
        focus: (command) => { const { pane } = paneOf(command); focusAnyPane(pane); return `Focused pane ${String(pane)}.`; },
        close: async (command) => {
          const { pane } = paneOf(command);
          if (command.pane === undefined) throw new Error("Say which pane to close (main or its number, from look).");
          await closeDocument(pane); return `Closed what pane ${String(pane)} showed.`;
        },
        open: async (command) => {
          const { shown, pane } = paneOf(command, false);
          let view = command.view;
          // An agent asks for the focused workspace's Files or a terminal; a pane holds them as documents.
          if (view === "files") { const project = dockProject(); if (!project) throw new Error("No workspace is focused to show its files."); view = `folder:${project.id}`; }
          if (view === "terminal") { const id = await pickShell(); if (!id) throw new Error("No terminal could be started here."); view = `term:${id}`; }
          // The hub has checked it against the declared views; this is the client's own check of its form.
          if (!view || !isSplitView(view)) throw new Error(`Not something a pane can show: ${String(view)}.`);
          if (command.beside || !(isPaneView(view) || view === "page:dashboard")) {
            const placed = await openBeside(view, true);
            await new Promise((resolve) => requestAnimationFrame(resolve));
            const at = panesShown().find((candidate) => viewOf(candidate) === view);
            if (at !== undefined) return `Opened ${viewName(view)} in pane ${String(at)}.`;
            return typeof placed === "number" ? `Opened ${viewName(view)} in the dock: the window has no room for another pane beside.` : `Could not open ${viewName(view)} beside.`;
          }
          const into = shown.includes(pane) ? pane : "main";
          setKeyboardPane(into);
          await openView(view, {});
          const at = Layouts.findView(layout(), view);
          return `Opened ${viewName(view)} in pane ${String(at ? keyOf(at.id) : into)}.`;
        },
      };
    })(),
  });
  const renderSlot = (slot: number, position: () => number, docked: boolean) => {
      const pane = paneSlot(slot);
      const side = pane.session;
      const owns = () => slotHasKeyboard(slot);
      const page = () => slotPage(slot);
      // conventions-ok: a hidden file input the attach control opens; the library has no file-picker piece
      const attachInput = () => <input ref={side.setAttachInput} type="file" multiple hidden aria-hidden="true" onChange={(event) => { if (event.currentTarget.files) side.attachments.addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />;
      // A pane about to ease open (the one slot just added) holds its document until it has its room.
      const [held, setHeld] = createSignal(!docked && untrack(() => animatePanes() && !shownAsSeen.includes(slot) && shownSlots().length === shownAsSeen.length + 1));
      if (held()) {
        const hold: { release: () => void; focus?: () => void } = { release: () => { heldSlots.delete(slot); setHeld(false); hold.focus?.(); } };
        heldSlots.set(slot, hold);
        onCleanup(() => { if (heldSlots.get(slot) === hold) heldSlots.delete(slot); });
      }
      return <Sheet ref={(element) => { pane.setHost(element); onCleanup(() => { if (pane.host() === element) pane.setHost(undefined); }); }} class="main-split" pane={paneLetter(slot)} docked={docked ? (dockSlot() !== slot ? "hidden" : true) : false} backdrop={<Show when={!docked && meteorField() && (revealing() || arrived()) && Boolean(slotChatId(slot) || page() === "dashboard" || slotPageProject(slot))}><meteors.Window /></Show>} data-pane-slot={slot} data-region={slotChatId(slot) ? "chat" : page() ? "dashboard" : "workspace-panel"} aria-label={docked ? "Docked pane" : position() === 0 ? "Pane B" : "Pane C"} style={docked ? undefined : { flex: `${paneWeights()[position() + 1] ?? 0.5} 1 0`, "min-width": paneMotion()?.slot === slot ? "0px" : `${paneMinWidth(slot)}px`, ...(paneMotion()?.slot === slot ? { overflow: "hidden", ...(paneMotion()!.width ? { "--pane-document-width": `${paneMotion()!.width}px` } : {}) } : {}), ...(paneMotion()?.slot === slot && paneMotion()!.collapsed ? { "margin-right": "0px" } : {}) }}
        data-moving={paneMotion()?.slot === slot ? paneMotion()!.phase : undefined}>
        <Show when={!docked}><ResizeEdge kind="pane" aria-label="Resize panes" startDrag={() => startSplitResize(position() + 1)} /></Show>
        <Show when={!held()}>
        <Show when={parseFileView(slotView(slot))}>{renderFileViewer(slot)}</Show>
        <Show when={slotView(slot)?.startsWith("term:") ? slotView(slot)!.slice("term:".length) : undefined} keyed>{(shell) => renderTerminalDocument(slot, shell)}</Show>
        <Show when={slotView(slot)?.startsWith("folder:") ? slotView(slot)!.slice("folder:".length) : undefined} keyed>{(project) => renderFolderViewer(slot, project)}</Show>
        <Show when={slotView(slot)?.startsWith("browser:") ? slotView(slot)!.slice("browser:".length) : undefined} keyed>{(id) => renderBrowserDocument(slot, id)}</Show>
        <Show when={slotView(slot)?.startsWith("mail:") ? slotView(slot)!.slice("mail:".length) : undefined} keyed>{(account) => renderMailDocument(slot, account)}</Show>
        <For each={artifactsIn(slot)}>{(id) => renderArtifactDocument(slot, id)}</For>
        <Show when={slotView(slot) === "home"}><SheetFill tabIndex={-1} onPointerDown={focusChatSurface}>{renderHome(slot)}</SheetFill></Show>
        <Show when={page() === "computer"}>
          <SheetFill tabIndex={-1} onPointerDown={focusChatSurface}>{renderPaneComputer(slot)}</SheetFill>
        </Show>
        <Show when={page()?.startsWith("harness:")}>
          <SheetFill tabIndex={-1} onPointerDown={focusChatSurface}>{attachInput()}{renderPaneHarness(pane, decodeURIComponent(page()!.slice("harness:".length)))}</SheetFill>
        </Show>
        <Show when={page() === "agent"}>
          <SheetFill tabIndex={-1} onPointerDown={focusChatSurface}>{renderAgent(slot)}</SheetFill>
        </Show>
        <Show when={page() === "jbot"}>
          <SheetFill tabIndex={-1} onPointerDown={focusChatSurface}>{attachInput()}{renderJbot(slot)}</SheetFill>
        </Show>
        <Show when={page()?.startsWith("environment:")}>
          <SheetFill tabIndex={-1} onPointerDown={focusChatSurface}>{renderEnvironment(decodeURIComponent(page()!.slice("environment:".length)), slot)}</SheetFill>
        </Show>
        <Show when={page() && page() !== "computer" && page() !== "agent" && page() !== "jbot" && !page()!.startsWith("harness:") && !page()!.startsWith("environment:")}>
          <SheetFill tabIndex={-1} onPointerDown={focusChatSurface}>
            {attachInput()}
            <Show when={page() === "dashboard"} fallback={<Show when={slotPageProject(slot)}>{(project) =>
              <ProjectPage session={side} project={project()} target={{ project: project() }} keyboardOwner={owns} onSendDraft={(prompt) => sendFromPanePage(pane, prompt)} onOpenChat={openChatFromPage} tabActions={paneTabActions(slot)} tabs={documentTab(slot)} />
            }</Show>}>
              <AppDashboardPage session={side} place={chatPlace(side)} keyboardOwner={owns} onSendDraft={(prompt) => sendFromPanePage(pane, prompt)} onOpenChat={(target, project) => void openChatFromPage(target, project)} tabActions={paneTabActions(slot)} tabs={documentTab(slot)} />
            </Show>
          </SheetFill>
        </Show>
        <Show when={slotChatId(slot)}>
          <SheetFill>
            {attachInput()}
            <Show when={side.chat.loadedId()} fallback={<Empty role="status">Loading chat…</Empty>}>
            <ChatSurface session={side} opening={side.chat.presentation().kind !== "ready" || side.chat.loadedId() !== slotChatId(slot)} project={side.project()}
              {...paneTabRow(slot)} modes={threadModes(slot)} keyboardOwner={owns} place={chatPlace(side)} modelSelector onShare={() => void shareChat(side.selectedId())}
              onRename={() => runSidebar("rename-chat", side.selected() ?? {})} onDelete={() => runSidebar("delete-chat", side.selected() ?? {})}
              notice={workspaceNotice(side.project(), side.selectedId())}
              tabActions={paneTabActions(slot)} />
            </Show>
          </SheetFill>
        </Show>
        </Show>
      </Sheet>;
  };
  // Pane A always shows something, so it docks only while another pane can take its place.
  const canDock = (pane: PaneKey) => !isMobileLayout() && dockAvailable() && dockedSlot() !== pane && (pane !== "main" || layout().row.length > 1);
  const freshlyDocked = new Set<number>();
  const [dockWidthRequest, setDockWidthRequest] = createSignal<{ width: number; nonce: number } | null>(null);
  const showDocked = (slot: number) => {
    batch(() => {
      panes.replace((current) => current.summon ? { ...current, summon: null } : current);
      setDockSlot(slot);
      setPanelOpenForChat(true);
      if (freshlyDocked.delete(slot)) setDockWidthRequest({ width: viewMinWidth(slotView(slot)), nonce: Date.now() });
    });
    requestAnimationFrame(() => focusPane(slot));
  };
  /** The dock holds one pane: docking another sends the one it held away. */
  const dockPane = async (pane: PaneKey) => {
    const id = idOf(pane);
    if (!canDock(pane) || !id) return void toast.info("Pane A docks only while another pane can take its place.");
    const held = dockedSlot();
    if (held !== null && !(await gate(held, null))) return;
    // Pane A docking: the pane beside it becomes pane A, and the docked pane takes that pane's slot.
    movingDocuments = true;
    try { await changeLayout((current) => Layouts.moveToDock(current, id)); } finally { movingDocuments = false; }
    // Shown at once: the dock's one pane, not a pane put away out of sight.
    const slot = keyOf(id);
    if (typeof slot === "number") { freshlyDocked.add(slot); showDocked(slot); }
  };
  const undockPane = (slot: number, focus = true) => {
    const id = idOf(slot);
    if (!id) return false;
    if (rowFull()) { toast.info("There is no room for another pane."); return false; }
    batch(() => {
      if (dockSlot() === slot) { setDockSlot(null); closePanel(); }
      panes.apply((current) => Layouts.moveToRow(current, id));
    });
    if (focus && shownSlots().includes(slot)) focusPane(slot);
    return true;
  };
  createEffect(on(dockContents, (contents) => {
    const slot = dockSlot();
    if (slot !== null && !contents.includes(slot)) batch(() => { setDockSlot(null); closePanel(); });
  }, { defer: true }));
  const chooseDocked = (slot: number, alt: boolean) => {
    if (alt) return void (dockedSlot() === slot ? undockPane(slot) : toast.info("It comes back by itself once the window has room for it."));
    if (panelOpen() && dockSlot() === slot) return closePanel();
    showDocked(slot);
  };
  const jbotShownInDock = () => panelOpen() && dockSlot() === null && dockTool() === "jbot";
  const dismissSummon = () => {
    const held = dockedSlot();
    if (!isMobileLayout() && held !== null) return showDocked(held);
    closePanel();
  };
  createEffect(on(() => layout().summon, (summon, before) => {
    if (isMobileLayout()) return;
    if (summon) {
      batch(() => {
        setDockSlot(null);
        if (workspaceViewRequest()?.tab !== summon) setWorkspaceViewRequest({ tab: summon, nonce: Date.now() });
        setPanelOpenForChat(true);
      });
    } else if (before && workspaceViewRequest()?.tab === before) dismissSummon();
    else if (!before && dockedSlot() !== null) showDocked(dockedSlot()!);
  }));
  const showJbot = async () => {
    if (isMobileLayout()) return void openJbotHere();
    if (jbotShownInDock()) return focusWorkspacePanel();
    const inRow = shownSlots().find((slot) => slotView(slot) === "page:jbot");
    if (inRow !== undefined) return focusPane(inRow);
    if (!workspacePanelScope()) return void openJbotHere();
    await openWorkspaceView("jbot");
    focusWorkspacePanel();
  };
  const toggleJbot = async () => jbotShownInDock() ? dismissSummon() : showJbot();
  const [devClient] = createResource(isDevClient);
  const [feedbackMode, setFeedbackMode] = createSignal<"select" | "use" | null>(null);
  const toggleFeedback = () => setFeedbackMode(feedbackMode() === "select" ? "use" : "select");
  const paneTabActions = (pane: PaneKey) => <Show when={inDock(pane)} fallback={paneRowActions(pane)}>
    <Actions kind="pane">
      <Show when={dockedSlot() === pane}><IconButton kind="pane" label="Move to a pane" onClick={() => void undockPane(pane as number)}><Icons.Split /></IconButton></Show>
      <IconButton kind="pane" aria-label="Close this pane" title="Close" onClick={() => closeSlot(pane as number)}><Icons.Close /></IconButton>
    </Actions>
  </Show>;
  const paneRowActions = (pane: PaneKey) => <Show when={splitShown()}>
    <Actions kind="pane">
      <Show when={canDock(pane)}><IconButton kind="pane" label="Move to dock" onClick={() => dockPane(pane)}><Icons.Workspace /></IconButton></Show>
      <Show when={swapPartner(pane) !== null}><IconButton kind="pane" aria-label="Swap with the pane beside" title="Swap" onPointerDown={() => { keyboardBeforePress = keyboardPane(); }} onClick={(event) => { const target = swapTarget(pane); keyboardBeforePress = null; if (target !== null) void swapPanes(pane, event.shiftKey, target, true, paneBeforePress ?? keyboardPane()); }}><Icons.Swap /></IconButton></Show>
      <Show when={pane !== "main" || shownSlots()[0] !== undefined}><IconButton kind="pane" aria-label="Close this pane" title="Close" onClick={() => closePane(pane)}><Icons.Close /></IconButton></Show>
    </Actions>
  </Show>;
  // Every address the app writes goes through here, so a route change carries the panes and Back restores them. A lone
  // pane showing the route says nothing the path does not.
  const PANE_PARAMS = ["panes", "dock", "summon", "focus", "ftabs", "a", "pane", "tabs"];
  const withPanes = (address: string | URL) => {
    const url = new URL(address, location.href);
    for (const name of PANE_PARAMS) url.searchParams.delete(name);
    const current = layout();
    const lone = current.row.length === 1 && !current.dock && !current.summon && current.panes[current.row[0]!]!.views.length === 1 && isPaneView(paneAView());
    if (!lone) for (const [name, value] of Layouts.encode(current)) url.searchParams.set(name, value);
    return `${url.pathname}${url.search}${url.hash}`;
  };
  const routeAddress = () => { const url = new URL(location.href); for (const name of PANE_PARAMS) url.searchParams.delete(name); return `${url.pathname}${url.search}`; };
  const nativePushState = history.pushState.bind(history);
  const nativeReplaceState = history.replaceState.bind(history);
  history.pushState = (data, unused, url) => nativePushState(data, unused, url == null ? url : withPanes(url));
  history.replaceState = (data, unused, url) => nativeReplaceState(data, unused, url == null ? url : withPanes(url));
  onCleanup(() => { history.pushState = nativePushState; history.replaceState = nativeReplaceState; });
  // While pane A's route is on its way the address is the old route's, and keeps the layout it had.
  createEffect(on(() => [Layouts.encode(layout()).toString(), settledRoute()] as const, ([encoded, route]) => {
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-layout", encoded);
    if (route && isPaneView(paneAView()) && paneAView() !== route) return;
    const next = withPanes(location.href);
    if (next !== `${location.pathname}${location.search}${location.hash}`) nativeReplaceState(history.state, "", next);
  }, { defer: true }));
  // Back or forward restoring an address sets pane A's route and the layout together; the route changing then is not
  // pane A being sent away.
  let restoringPanes = false;
  let routeSeen: SplitView | null = null;
  // A route reached other than through the panes (a link, a new chat, a chat deleted) is what pane A shows. The first
  // settled route leaves a document pane A was restored with in place.
  createEffect(on(settledRoute, (route) => {
    if (!route) return;
    const first = routeSeen === null, moved = route !== routeSeen;
    routeSeen = route;
    if (drivingRoute || restoringPanes || swappingPanes) return;
    const shown = untrack(paneAView);
    if (shown === route || (!isPaneView(shown) && (first || !moved))) return;
    panes.replace((current) => fromRoute(current, route));
  }));
  const applyPanesFromUrl = () => {
    const params = new URLSearchParams(location.search);
    const found = readLayout(params) ?? Layouts.layoutOf(pathChatId() ? `chat:${pathChatId()}` : "page:dashboard");
    batch(() => {
      panes.replace((current) => Layouts.adopt(current, found));
      setDockSlot(found.summon ? null : dockedSlot());
      if (found.summon || found.dock) setPanelOpenForChat(true);
      else closePanel();
    });
  };
  const paneOrder = createMemo((): PaneKey[] => {
    const docked = dockContents().filter((slot) => slotView(slot) && !shownSlots().includes(slot));
    return ["main", ...shownSlots(), ...docked];
  });
  const paneLetter = (pane: PaneKey) => { const order = paneOrder().filter((slot) => slot === "main" || !(inDock(slot) && slotView(slot) === "page:jbot")); const at = order.indexOf(pane); return order.length > 1 && at >= 0 ? String.fromCharCode(65 + at) : undefined; };
  const chatPlaces = createMemo(() => {
    const places = new Map<string, { pane: string; shown: boolean }>();
    paneOrder().forEach((pane, index) => {
      const data = paneData(pane);
      if (!data) return;
      const shown = Layouts.shownView(data);
      for (const view of data.views) {
        const id = chatOfTab(view);
        if (id && (!places.has(id) || view === shown)) places.set(id, { pane: String.fromCharCode(65 + index), shown: view === shown });
      }
    });
    return places;
  });
  const openChatIds = () => {
    if (!splitShown()) return [];
    const current = keyboardSlot() !== null ? slotChatId(keyboardSlot()!) : mainChatId();
    return [mainChatId(), ...shownSlots().map(slotChatId)].filter((id): id is string => Boolean(id) && id !== current);
  };
  // The transcript learns its width only from geometry motion, so the panes
  // announce every change of the room they take from pane A.
  let splitMotionId = 0;
  let splitSize = 0;
  // Open from a drag's or ease's begin to its end: the weights effect below stays out of the way meanwhile, or it
  // starts a motion of its own each frame, relaying out every transcript.
  let splitMotionOpen = false;
  const announceSplit = (phase: "begin" | "change" | "end", size: number, panes?: { element: HTMLElement; width: number }[], landing?: { element: HTMLElement; width: number }[]) => {
    splitMotionOpen = phase !== "end";
    dispatchPanelGeometryMotion({ phase, id: splitMotionId, source: "workspace", size, panes, landing });
  };
  const besideWidth = () => shownSlots().reduce((sum, slot) => sum + (paneSlot(slot).host()?.getBoundingClientRect().width ?? 0), 0);
  createEffect(on(() => [shownSlots(), paneWeights().join()] as const, () => {
    requestAnimationFrame(() => {
      if (splitMotionOpen) return;
      const next = besideWidth();
      if (Math.abs(next - splitSize) < 0.5) return;
      splitMotionId += 1;
      announceSplit("begin", splitSize);
      announceSplit("end", next);
      splitSize = next;
    });
  }, { defer: true }));
  let panesSettled = false;
  window.setTimeout(() => { panesSettled = true; }, PANES_SETTLE_MS);
  // A pane easing open is unseen until it lands: mounting a chat inside the click that opened it holds the panes still
  // ~45 ms before they move.
  let shownAsSeen = untrack(shownSlots);
  const shownAsSeenAtLoad = shownAsSeen;
  const ARTIFACT_EASE_MS = 500;
  const heldSlots = new Map<number, { release: () => void; focus?: () => void }>();
  // A pane opened beside is held unseen until what it shows is drawn, eased in or (reduced motion) shown at once.
  const holdPanes = () => panesSettled && !isMobileLayout() && !swappingPanes && !restoringPanes && !paneMotion();
  const animatePanes = () => holdPanes() && !reducedMotion();
  const normalized = (weights: number[]) => { const total = weights.reduce((sum, weight) => sum + weight, 0) || 1; return weights.map((weight) => weight / total); };
  const paneShares = () => normalized(panesShown().map((pane) => paneElement(pane)?.getBoundingClientRect().width ?? 0));
  const [panesSettling, setPanesSettling] = createSignal(false);
  const documentsOf = (element: HTMLElement) => [...element.children]
    .filter((child): child is HTMLElement => child instanceof HTMLElement && !child.matches(".ui-resize-edge, .ui-sheet-backdrop"));
  // From the moment an artifact is asked for in a pane, what the pane shows takes no input: keys typed while it is made are written nowhere.
  createEffect(() => {
    for (const key of Object.keys(arriving())) {
      const element = paneElement(key === "main" ? "main" : Number(key));
      for (const part of element ? documentsOf(element).filter((part) => part.dataset.pending === undefined) : []) {
        part.inert = true;
        // Inert lets go of the keyboard only at the next frame; a key pressed before it would still be written.
        if (part.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
        onCleanup(() => { part.inert = false; });
      }
    }
  });
  const landingWidth = (target: number[], index: number, arriving: HTMLElement | undefined) => {
    const panes = panesShown().map((pane) => paneElement(pane)).filter((element): element is HTMLElement => Boolean(element));
    const room = panes.reduce((sum, element) => sum + element.getBoundingClientRect().width, 0)
      + (arriving ? parseFloat(getComputedStyle(arriving).marginRight) || 0 : 0);
    const gutter = parseFloat(getComputedStyle(panes[0] ?? document.body).marginRight) || 0;
    return Math.max(0, Math.round((room - gutter) * (target[index] ?? 0)));
  };
  /** Each pane's width once eased to `to`: the room they take now, less the gutter an arriving pane opens (collapsed until it moves) or plus the one a leaving pane gives back. */
  const landings = (to: number[]) => {
    const panes = panesShown().map((pane) => paneElement(pane)).filter((element): element is HTMLElement => Boolean(element));
    const gutter = parseFloat(getComputedStyle(panes[0] ?? document.body).marginRight) || 0, phase = paneMotion()?.phase;
    const room = panes.reduce((sum, element) => sum + element.getBoundingClientRect().width, 0) + (phase === "arriving" ? -gutter : phase === "leaving" ? gutter : 0);
    return panes.map((element, index) => ({ element, width: Math.max(0, Math.round(room * (to[index] ?? 0))) }));
  };
  const easePaneWeights = (to: number[], done: () => void) => {
    splitMotionId += 1;
    announceSplit("begin", besideWidth(), undefined, landings(to));
    document.body.classList.add("panes-settling"); setPanesSettling(true);
    batch(() => {
      setWeightOverride(to);
      const motion = paneMotion();
      if (motion) setPaneMotion({ ...motion, collapsed: motion.phase === "leaving" });
    });
    const started = performance.now();
    const follow = () => {
      if (performance.now() - started < 240) { announceSplit("change", besideWidth()); requestAnimationFrame(follow); return; }
      document.body.classList.remove("panes-settling"); setPanesSettling(false);
      done();
      splitSize = besideWidth();
      announceSplit("end", splitSize);
    };
    requestAnimationFrame(follow);
  };
  createEffect(on(shownSlots, (now, before) => {
    shownAsSeen = now;
    // The first change after load has no previous value (the effect is deferred): it was the row before, empty or
    // as restored, so the first pane opened eases in like any other. The load itself is not (panesSettled).
    const previous = before ?? shownAsSeenAtLoad;
    const added = now.filter((slot) => !previous.includes(slot));
    const opened = added.length === 1 && holdPanes() ? added[0]! : null, eased = !reducedMotion();
    for (const [held, hold] of [...heldSlots]) if (held !== opened) hold.release();
    if (opened === null) return;
    const slot = opened;
    const index = now.indexOf(slot);
    const start = weightsFor(previous.length + 1).slice();
    start.splice(index + 1, 0, 0);
    const target = normalized(weightsFor(now.length + 1));
    setWeightOverride(normalized(start));
    // Mounted a frame before anything moves (its long task moves nothing), and the ease waits a moment for a chat to
    // have loaded, so nothing renders mid-motion.
    setPaneMotion({ slot, phase: "arriving", collapsed: true, width: landingWidth(target, index + 1, paneSlot(slot).host()) });
    requestAnimationFrame(() => {
      heldSlots.get(slot)?.release();
      requestAnimationFrame(() => {
        const element = paneSlot(slot).host();
        const id = slotChatId(slot), artifact = artifactsIn(slot)[0];
        // An artifact eases in drawn, or after ARTIFACT_EASE_MS saying it is opening: never filling in as it moves.
        void waitFor(() => artifact ? drawnArtifacts.has(`${slot}:${artifact}`) : !id || paneSlot(slot).session.chat.loadedId() === id, artifact ? ARTIFACT_EASE_MS : 150).then(() => {
          if (paneMotion()?.slot !== slot) return;
          if (!element || paneSlot(slot).host() !== element || !eased) return void batch(() => { setWeightOverride(null); setPaneMotion(null); });
          const fade = documentsOf(element).map((part) => part.animate([{ opacity: 0 }, { opacity: 1 }],
            { delay: duration("--duration-fold") * 0.3, duration: duration("--duration-fold") * 0.7, easing: easing("--ease-arrive"), fill: "both" }));
          easePaneWeights(target, () => {
            batch(() => { setWeightOverride(null); setPaneMotion(null); });
            for (const animation of fade) animation.cancel();
          });
        });
      });
    });
  }, { defer: true }));
  const applyPaneLayout = (weights: number[]) => {
    const count = shownSlots().length + 1;
    if (weights.length !== count) return;
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const next = weights.map((weight) => weight / total);
    splitMotionId += 1;
    announceSplit("begin", besideWidth(), undefined, landings(next));
    document.body.classList.add("panes-settling"); setPanesSettling(true);
    if (count === 2) { setSplitRatio(next[1]!); writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split-ratio", String(next[1]!)); }
    else { setSplitRatios3(next); writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split-ratios", JSON.stringify(next)); }
    // Each frame of the ease is a change, so transcripts follow their panes
    // (sliding while they have room, then rewrapping) rather than snapping.
    const started = performance.now();
    const follow = () => {
      if (performance.now() - started < 240) {
        announceSplit("change", besideWidth());
        requestAnimationFrame(follow);
        return;
      }
      document.body.classList.remove("panes-settling"); setPanesSettling(false);
      splitSize = besideWidth();
      announceSplit("end", splitSize);
    };
    requestAnimationFrame(follow);
  };
  const startSplitResize = (position: number): EdgeDrag | undefined => {
    const shown = shownSlots();
    const paneAt = (index: number) => index === 0 ? document.querySelector<HTMLElement>(".chat-main") : index <= shown.length ? paneSlot(shown[index - 1]!).host() : undefined;
    const panes = Array.from({ length: shown.length + 1 }, (_, index) => paneAt(index));
    if (panes.some((pane) => !pane)) return;
    const widths = panes.map((pane) => pane!.getBoundingClientRect().width);
    const minimums = panes.map((pane) => parseFloat(getComputedStyle(pane!).minWidth) || minSplitPaneWidth());
    const weights = paneWeights();
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    const widthSum = widths.reduce((sum, width) => sum + width, 0);
    let pending = [...weights];
    const apply = (next: number[]) => { if (next.length === 2) setSplitRatio(next[1]!); else setSplitRatios3(next); };
    splitMotionId += 1;
    const sized = (list: number[]) => panes.map((element, index) => ({ element: element!, width: list[index]! }));
    // The room the panes beside A will take, from the widths just worked out:
    // announcing it needs no measuring after the weights are written.
    announceSplit("begin", widths.slice(1).reduce((sum, width) => sum + width, 0), sized(widths));
    return {
      move: (delta) => {
        const next = [...widths];
        let owed = Math.abs(delta);
        const order = delta > 0 ? next.map((_, index) => index).slice(position) : next.map((_, index) => index).slice(0, position).reverse();
        for (const index of order) {
          const taken = Math.min(owed, Math.max(0, next[index]! - minimums[index]!));
          next[index]! -= taken;
          owed -= taken;
        }
        next[delta > 0 ? position - 1 : position]! += Math.abs(delta) - owed;
        pending = next.map((width) => width / widthSum * weightSum);
        apply(pending);
        announceSplit("change", next.slice(1).reduce((sum, width) => sum + width, 0), sized(next));
      },
      end: () => {
        if (pending.length === 2) writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split-ratio", String(pending[1]!));
        else writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split-ratios", JSON.stringify(pending));
        requestAnimationFrame(() => { splitSize = besideWidth(); announceSplit("end", splitSize); });
      },
    };
  };
  // Only the Terminal is maximised in the dock (its header alone offers it): showing anything else there restores it.
  createEffect(() => { if (workspaceExpanded() && !(dockSlot() === null && dockTool() === "terminal")) setWorkspaceExpanded(false); });
  const toggleWorkspaceExpanded = () => {
    const next = !workspaceExpanded();
    setWorkspaceExpanded(next);
    if (next) focusWorkspacePanel();
  };
  const shareChat = async (chatId = catalogue.selectedId()) => {
    if (!chatId) return;
    try {
      const { origin } = await api<ShareOriginPayload>("/v0/share-origin");
      await navigator.clipboard.writeText(`${origin}/chat/${encodeURIComponent(chatId)}`);
      toast.success("Tailscale chat link copied");
    } catch (error) {
      showError(error);
    }
  };
  const shareProject = async (project = selectedProject()) => {
    if (!project) return;
    try {
      const { origin } = await api<ShareOriginPayload>("/v0/share-origin");
      await navigator.clipboard.writeText(`${origin}${projectPath(project)}`);
      toast.success("Tailscale workspace link copied");
    } catch (error) { showError(error); }
  };
  const runSidebar = (type: string, target: Omit<SidebarCommand, "type" | "nonce"> = {}) => setSidebarCommand({ type, nonce: Date.now(), ...target });
  const stopChatProcess = async (chatId = catalogue.selectedId()) => {
    const process = runtime.getProcess(chatId);
    if (!chatId || !process?.id) return;
    try {
      await api(`/v0/live-sessions/${encodeURIComponent(process.id)}/process`, { method: "DELETE", replay: false });
      runtime.forget(chatId);
      toast.success("Process stopped");
    } catch (error) { showError(error); }
  };
  const pinRef = (type: "chat" | "project" | "terminal", id: string) => `${type}:${id}`;
  const isSidebarPinned = (type: "chat" | "project" | "terminal", id: string) => sidebarPins().includes(pinRef(type, id));
  const toggleSidebarPin = async (type: "chat" | "project" | "terminal", id: string) => {
    const project = catalogue.projects().find((item) => type === "project" ? item.id === id : item.sessions.some((chat) => chat.id === id));
    if (type === "terminal" || !project || !isConduitManagedProject(project)) return;
    const ref = pinRef(type, id);
    const previous = sidebarPins();
    const next = previous.includes(ref) ? previous.filter((item) => item !== ref) : [...previous, ref];
    setSidebarPins(next);
    try {
      const saved = await api<PreferencesPayload>("/v0/preferences", { method: "PATCH", body: JSON.stringify({ sidebarPins: next }) });
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
    const list = focusedChat().messages();
    for (let index = list.length - 1; index >= 0; index -= 1) if (list[index]!.role === "assistant") return list[index]!;
    return undefined;
  });
  const lastUserEntryId = createMemo(() => {
    const list = focusedChat().messages();
    // A message the server has not stated yet -- sent, and interrupted before
    // it was written -- cannot be forked, so it cannot be the target of
    // regenerate or edit.
    for (let index = list.length - 1; index >= 0; index -= 1) { const message = list[index]!; if (message.role === "user" && !message.local) return message.id; }
    return null;
  });
  const thinkingLevels = createMemo(() => focusedModels().models().find((item) => item.spec === focusedModels().model())?.thinkingLevels ?? []);

  const paletteContext = createMemo<PaletteContext>(() => ({
    nativeApp,
    devClient: Boolean(devClient()),
    chatId: focusedChatId(),
    artifact: focusedArtifact(),
    project: dockProject(),
    projects: catalogue.projects(),
    templates: templates(),
    templateId: focusedChat().templateId(),
    chatStatus: focusedChat().status(),
    streaming: focusedChat().streaming(),
    liveProcess: Boolean(runtime.getProcess(focusedChatId())),
    connectivity: runtime.connectivity(),
    effort: focusedModels().effort(),
    thinkingLevels: thinkingLevels(),
    canRegenerate: focusedSession().capability("regenerate") && Boolean(lastUserEntryId()) && !focusedChat().streaming() && !focusedChat().stopping(),
    canCompact: focusedSession().capability("compaction") && !focusedChat().streaming() && !focusedChat().compacting() && focusedChat().messages().length > 0,
    canCopy: Boolean(lastAssistant()?.content),
    chatSort: chatSort(),
  }));

  const restoreStash = async (id: string) => {
    const { chat, attachments } = focusedSession();
    const entry = await drafts.restore(id);
    if (!entry) return;
    chat.setDraft(chat.draft() ? `${chat.draft()}\n${entry.text}` : entry.text);
    // Attachments stay with the chat that uploaded them. Restoring elsewhere
    // brings the prose only, and says so rather than pretending otherwise.
    if (!entry.attachmentIds.length) return;
    if (entry.chatId && entry.chatId === chat.loadedId()) void attachments.select(entry.chatId);
    else toast(`${entry.attachmentIds.length} attached file${entry.attachmentIds.length === 1 ? "" : "s"} stayed with the original chat.`);
  };

  const stashPrompt = () => {
    const { chat, attachments } = focusedSession();
    const chatId = chat.loadedId();
    if (!chatId) return;
    const text = chat.draft();
    const pending = attachments.pendingIds();
    if (text.trim() || pending.length) {
      if (attachments.items().some((item) => item.status === "queued" || item.status === "uploading")) {
        return showError("Wait for uploads to finish before stashing this prompt.");
      }
      void drafts.park(chatId, text, pending).then((entry) => {
        if (!entry) return;
        chat.setDraft("");
        // Drops the rows from the composer without deleting them: the stash
        // entry still references those uploads.
        attachments.markAnnounced(pending);
        toast("Prompt stashed", { action: { label: "Undo", onClick: () => void restoreStash(entry.id) } });
      });
      return;
    }
    const entries = drafts.stash();
    if (!entries.length) return;
    void restoreStash(entries[0]!.id);
  };

  const paletteActions: PaletteActions = {
    logout: () => { void logout(); },
    newChat: (project, launch) => void createChat(project ?? undefined, launch ?? {}),
    newArtifact: () => runSidebar("new-artifact", { project: dockProject() ?? undefined }),
    artifact: (command) => focusedArtifact()?.offers[command]?.(),
    newFolder: () => runSidebar("new-folder"),
    newWorkspace: () => runSidebar("new-workspace"),
    attach: () => focusedSession().openAttachments(),
    stashPrompt,
    toggleDictation: () => window.dispatchEvent(new Event("conduit:toggle-dictation")),
    toggleSidebar: () => runSidebar("toggle-sidebar"),
    toggleFeedback,
    toggleWorkspacePanel: togglePanel,
    maximizeWorkspacePanel,
    focusComposer,
    focusWorkspacePanel,
    toggleChatWorkspaceFocus,
    openWorkspaceView,
    copyTranscript: () => { const id = focusedChatId(); if (id) void copyTranscript({ id } as ChatSummary); },
    rename: () => runSidebar("rename-chat", focusedTarget()),
    autoName: () => void autoNameChat(),
    move: () => runSidebar("move-chat", focusedTarget()),
    renameFolder: () => runSidebar("rename-folder"),
    stop: () => focusedChat().stop(),
    stopProcess: () => void stopChatProcess(focusedChatId()),
    regenerate: () => { const id = lastUserEntryId(); if (id) void focusedChat().regenerate(id); },
    compact: () => void focusedChat().compact(),
    copy: () => { const content = lastAssistant()?.content; if (content) void navigator.clipboard.writeText(content); },
    retryConnection: () => runtime.retry(),
    reload: () => location.reload(),
    updateApp: () => void runPwaUpdate(),
    resetAppCache: () => void runPwaCacheReset(),
    keyboardProbe: () => toast.success(toggleKeyboardProbe()
      ? "Keyboard measurements on. Open a chat and tap the composer."
      : "Keyboard measurements off."),
    composerPath: () => {
      const next = saveComposerKind(composerKind() === "web" ? "native" : "web");
      toast.success(next === "native" ? "Composer: Native while typing." : "Composer: Web.");
    },
    keyboardTour: startKeyboardTour,
    delete: () => runSidebar("delete-chat", focusedTarget()),
    deleteFolder: () => runSidebar("delete-project"),
    settings: (section) => openSettings(section),
    workspaceSettings: (id) => openSettings("workspaces", id),
    openChat: (session, project) => shutDrawerOnto(openChatHere(session, project), () => chat.loadedId() === session.id),
    openProject: (project) => shutDrawerOnto(openProjectHere(project)),
    renameChat,
    moveChats,
    copyChatLinks,
    deleteChats,
    chooseModel: (spec) => void focusedModels().chooseModel(spec),
    chooseEffort: (level) => void focusedModels().chooseEffort(level),
    setChatProfile: (id) => void focusedSession().switchProfile(id).catch(showError),
  };

  const dismissOpenLayer = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.key !== "Escape") return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-shortcut-exclusive='terminal']")) return;
    // A menu opened from the drawer is the top layer. Escape, including the
    // one an outside tap synthesises, closes that menu and leaves the drawer.
    if (phoneLayerOpen()) return;
    if (event.key === "Escape" && !paletteOpen() && !settingsOpen()) {
      // One step at a time: chats selected in the drawer are cleared first (the sidebar's own Escape), the drawer next.
      if (mobileSidebarOpen() && !document.querySelector(".ui-nav-pane [data-selected]")) { event.preventDefault(); setMobileSidebarOpen(false); return; }
    }
  };

  // The shell dispatches the tray's New chat rather than opening anything itself, so there is one new-chat path.
  onMount(() => {
    if (!updateShell) return;
    const firstCheck = window.setTimeout(() => void prepareDesktopUpdate(true), FIRST_DESKTOP_UPDATE_CHECK_MS);
    // The hub pushes the installer it offers (runtime stream): a new one is downloaded as soon as it is there. The
    // hourly check is only for a hub that does not push (a release's, whose updates come from GitHub).
    const laterChecks = window.setInterval(() => void prepareDesktopUpdate(true), 60 * 60_000);
    let offered: string | null | undefined;
    const onOffer = (event: Event) => {
      const desktop = (event as CustomEvent<{ desktop?: string | null }>).detail?.desktop ?? null;
      if (offered !== undefined && desktop && desktop !== offered) void prepareDesktopUpdate(true);
      offered = desktop;
    };
    window.addEventListener("conduit:updates-offered", onOffer);
    onCleanup(() => { clearTimeout(firstCheck); clearInterval(laterChecks); window.removeEventListener("conduit:updates-offered", onOffer); });
    if (!desktopShell) return;
    const stops: Array<() => void> = [];
    const remember = (unlisten: () => void) => stops.push(unlisten);
    void desktopShell.onNewChat(() => { void createChat(); }).then(remember);
    void desktopShell.onCheckForUpdates(() => { void runPwaUpdate(); }).then(remember);
    void desktopShell.onCommand((commandId) => {
      if (commandId === COMMAND_IDS.newChatGlobally) void startNewChat();
    }).then(remember);
    onCleanup(() => {
      for (const stop of stops) stop();
    });
  });

  // A chord another application already owns is reported and changes nothing: the shell's guarantee, not re-checked
  // here.
  onMount(() => {
    if (!desktopShell) return;
    const shell = desktopShell;
    // Only a changed set: the registry changes as panes mount their commands (twice per chat opened), the global
    // keys almost never, and each send is a round trip to the shell on the main thread.
    let sent = "";
    const publish = () => {
      const shortcuts = globalShortcuts(shortcutManager.commands, shortcutManager.shortcutOverrides());
      const key = JSON.stringify(shortcuts);
      if (key === sent) return;
      sent = key;
      void shell.setGlobalShortcuts(shortcuts).catch((error) => { sent = ""; showPlainError(error); });
    };
    publish();
    onCleanup(shortcutManager.subscribe(publish));
  });

  createEffect(on(keyboardTourActive, (running) => { if (running) setSettingsOpen(false); }, { defer: true }));
  onCleanup(watchForTourOffer(shortcutManager, () => toast("Conduit has a keyboard tour", {
    description: "Learn the regions, lists, the leader and panes by pressing the keys.",
    action: { label: "Take the tour", onClick: () => startKeyboardTour() },
  })));
  const tourEnv: TourEnv = {
    hasDock: () => Boolean(workspacePanelScope()) && !isMobileLayout(),
    canStepTabs: () => Boolean(tabsToStep()),
    splitShown: () => splitShown() && !isMobileLayout(),
  };

  onMount(() => {
    let hydratingUiPreferences = false;
    const persistUiPreference = (event: Event) => {
      if (hydratingUiPreferences) return;
      const detail = (event as CustomEvent<{ key?: UiPreferenceKey; value?: UiPreferences[UiPreferenceKey] }>).detail;
      if (!detail?.key) return;
      queueUiPreferenceSave(detail.key, detail.value!);
    };
    window.addEventListener(UI_PREFERENCE_CHANGE_EVENT, persistUiPreference);
    const watching = (chatId: string) => chatId === catalogue.selectedId()
      && routeKind() === "chat" && document.visibilityState === "visible";
    const unlisted = new Set<string>();
    const applyChangedChat = (event: Event) => {
      const changed = (event as CustomEvent<ChatSummary>).detail;
      if (!changed?.id) return;
      const read = watching(changed.id);
      // A second later, so a chat this app made itself (it lists its own) costs no second read. Once for each: one the
      // list still leaves out (untracked, archived) is not asked for again at its every change.
      const listed = () => catalogue.projects().some((project) => project.sessions.some((session) => session.id === changed.id));
      if (!listed()) {
        if (read) markChatRead(catalogue, changed);
        if (changed.status !== "active" || unlisted.has(changed.id)) return;
        return void setTimeout(() => { if (!listed()) { unlisted.add(changed.id); relist(); } }, UNLISTED_CHAT_RELIST_MS);
      }
      catalogue.patchChat(changed.id, read ? { ...changed, unread: false } : changed);
      if (read) markChatRead(catalogue, changed);
    };
    // Coming back to a tab is reading it too: the completion that landed while
    // this was in the background has nothing else left to clear it.
    const readOnFocus = () => {
      if (document.visibilityState !== "visible" || routeKind() !== "chat") return;
      markChatRead(catalogue, catalogue.selected()?.chat);
    };
    let relisting: Promise<unknown> | null = null;
    const relist = () => { relisting ??= catalogue.refresh().catch(() => {}).finally(() => { relisting = null; }); };
    window.addEventListener("conduit:chat-changed", applyChangedChat);
    window.addEventListener("conduit:runtime-resynced", relist);
    onCleanup(() => window.removeEventListener("conduit:runtime-resynced", relist));
    document.addEventListener("visibilitychange", readOnFocus);
    window.addEventListener("focus", readOnFocus);
    onCleanup(() => {
      window.removeEventListener(UI_PREFERENCE_CHANGE_EVENT, persistUiPreference);
      window.removeEventListener("conduit:chat-changed", applyChangedChat);
      document.removeEventListener("visibilitychange", readOnFocus);
      window.removeEventListener("focus", readOnFocus);
    });

    const parseStringArray = (key: string) => {
      try {
        const value = JSON.parse(localStorage.getItem(key) || "null");
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    };
    // A URL override is a deliberate per-tab experiment, and server preferences arrive after first paint: applying one
    // would silently undo it. Storage still mirrors the server; only the applied value is held back.
    const overrideParams = new URLSearchParams(location.search);
    const overridden = (key: UiPreferenceKey) => overrideParams.has(key);
    // A row with no `apply` is only announced: its owner listens for the change itself.
    const clientPreferences = {
      sidebarChatLimit: {
        storage: SIDEBAR_CHAT_LIMIT_STORAGE_KEY, local: selectedSidebarChatLimit,
        apply: (value) => { if (typeof value === "number") setSidebarChatLimit(clampSidebarChatLimit(value)); },
      },
      collapsedProjectIds: { storage: "conduit.sidebar.collapsed-projects", local: () => parseStringArray("conduit.sidebar.collapsed-projects") },
      sidebarCollapsed: {
        storage: "conduit.sidebar", store: (value) => value ? "collapsed" : "expanded",
        local: () => localStorage.getItem("conduit.sidebar") === "collapsed",
      },
      meteorField: {
        storage: METEOR_FIELD_STORAGE_KEY, local: selectedMeteorField,
        apply: (value) => { if (typeof value === "boolean") setMeteorField(value); },
      },
      transcriptWidth: {
        storage: TRANSCRIPT_WIDTH_STORAGE_KEY, local: () => selectedTranscriptWidth(),
        apply: (value) => { if (isTranscriptWidthMode(value) && !overridden("transcriptWidth")) applyTranscriptAppearance({ width: value }); },
      },
      transcriptWideBlocks: {
        storage: TRANSCRIPT_WIDE_BLOCKS_STORAGE_KEY, local: () => selectedTranscriptWideBlocks(),
        apply: (value) => { if (isTranscriptWideBlocksMode(value) && !overridden("transcriptWideBlocks")) applyTranscriptAppearance({ wideBlocks: value }); },
      },
      codeBlockCollapse: {
        storage: CODE_BLOCK_COLLAPSE_STORAGE_KEY, local: () => selectedCodeBlockCollapse(),
        apply: (value) => { if (isCodeBlockCollapseMode(value) && !overridden("codeBlockCollapse")) applyTranscriptAppearance({ collapse: value }); },
      },
      codeBlockCollapseLines: {
        storage: CODE_BLOCK_COLLAPSE_LINES_STORAGE_KEY, local: () => selectedCodeBlockCollapseLines(),
        apply: (value) => { if (isCodeBlockCollapseLines(value) && !overridden("codeBlockCollapseLines")) applyTranscriptAppearance({ collapseLines: value }); },
      },
      codeBlockWidth: {
        storage: CODE_BLOCK_WIDTH_STORAGE_KEY, local: () => selectedCodeBlockWidth(),
        apply: (value) => { if (isCodeBlockWidthMode(value) && !overridden("codeBlockWidth")) applyTranscriptAppearance({ codeWidth: value }); },
      },
      panelMotion: {
        storage: PANEL_MOTION_STORAGE_KEY, local: () => selectedPanelMotion(),
        apply: (value) => { if (isPanelMotionMode(value) && !overridden("panelMotion")) publishUiPreference("panelMotion", value); },
      },
      leaderMenu: {
        storage: LEADER_MENU_STORAGE_KEY, local: () => selectedLeaderMenu(),
        apply: (value) => { if (isLeaderMenuMode(value)) setLeaderMenu(value); },
      },
      userMessageCollapse: {
        storage: USER_MESSAGE_COLLAPSE_STORAGE_KEY, local: () => selectedUserMessageCollapse(),
        apply: (value) => { if (isUserMessageCollapseMode(value) && !overridden("userMessageCollapse")) applyTranscriptAppearance({ userMessageCollapse: value }); },
      },
      chatSort: { storage: CHAT_SORT_STORAGE_KEY, local: selectedChatSort },
      shortcutOverrides: {
        local: () => shortcutManager.shortcutOverrides(),
        apply: (value) => {
          if (value && typeof value === "object" && !Array.isArray(value)) shortcutManager.replaceOverrides(value as ReturnType<ShortcutManager["shortcutOverrides"]>);
        },
      },
      sidebarPins: {
        local: () => [],
        apply: (value) => { if (Array.isArray(value)) setSidebarPins(value.filter((item): item is string => typeof item === "string")); },
      },
    } satisfies { [K in UiPreferenceKey]: ClientPreference<K> };
    const preferenceKeys = (Object.keys(clientPreferences) as UiPreferenceKey[]).filter((key) => key !== "meteorField");
    const preferenceRow = <K extends UiPreferenceKey>(key: K) => clientPreferences[key] as ClientPreference<K>;
    const localPreferences = Object.fromEntries(preferenceKeys.map((key) => [key, preferenceRow(key).local()])) as UiPreferences;
    const applyPreference = <K extends UiPreferenceKey>(key: K, value: UiPreferences[K]) => {
      const { storage, store, apply } = preferenceRow(key);
      // A value that has not moved is not announced: the transcript reads a width or collapse change as a reason to
      // drop every cached block size and measure the whole thread again. Only keys seeded from storage can be compared.
      if (storage) {
        const stored = store ? store(value) : Array.isArray(value) ? JSON.stringify(value) : String(value);
        if (localStorage.getItem(storage) === stored) return;
        localStorage.setItem(storage, stored);
      }
      apply?.(value);
      window.dispatchEvent(new CustomEvent(UI_PREFERENCE_CHANGE_EVENT, { detail: { key, value } }));
    };
    const serverIdentityRequest = apiWhenServed<{ id?: string; name?: string; publicKey?: string; paths?: unknown }>("/v0/server")
      .catch(() => null);
    void readShared<PreferencesPayload>("/v0/preferences").then(async (serverPreferences) => {
      setSidebarPins(Array.isArray(serverPreferences.sidebarPins) ? serverPreferences.sidebarPins : []);
      const directory = mergeServerDirectory(serverPreferences.knownServers || []);
      void publishServerDirectory(directory, serverPreferences.knownServers);
      // Asked over this authenticated connection, the only kind that may be believed about identity.
      void serverIdentityRequest.then((identity) => {
        if (!identity) return;
        const origin = activeOrigin();
        if (!origin) return;
        // The identity key learned over this authenticated connection is
        // what the shell will let vouch for this server's TLS certificate.
        learnIdentity(origin, identity);
        void publishTrustedIdentities(trustedIdentities());
      })
        .catch(() => { /* an older server has no identity, and needs none */ });
      const migration: Partial<UiPreferences> = {};
      hydratingUiPreferences = true;
      try {
        for (const key of preferenceKeys) {
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
      shortcutManager.registerHandler(COMMAND_IDS.openSettings, "application", () => openSettings()),
      shortcutManager.registerHandler(COMMAND_IDS.biggerInterface, "application", () => void stepUiScale(1)),
      shortcutManager.registerHandler(COMMAND_IDS.toggleJbot, "application", () => void toggleJbot(), { when: () => Boolean(agentView()?.enabled) }),
      ...FEEDBACK_CONTEXTS.map((context) => shortcutManager.registerHandler(COMMAND_IDS.toggleFeedback, context, toggleFeedback, { when: () => Boolean(devClient()) })),
      shortcutManager.registerHandler(COMMAND_IDS.smallerInterface, "application", () => void stepUiScale(-1)),
      shortcutManager.registerHandler(COMMAND_IDS.resetInterfaceSize, "application", () => void stepUiScale(0)),
      shortcutManager.registerHandler(COMMAND_IDS.openModelSelector, "application", openModelSelector),
      shortcutManager.registerHandler(COMMAND_IDS.newChat, "application", () => {
        setMobileSidebarOpen(false);
        void startNewChat();
      }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleSidebar, "application", () => runSidebar("toggle-sidebar")),
      ...(Object.keys(ARTIFACT_COMMANDS) as ArtifactCommand[]).map((name) => shortcutManager.registerHandler(ARTIFACT_COMMANDS[name][0], "application", () => focusedArtifact()?.offers[name]?.(), { when: () => Boolean(focusedArtifact()?.offers[name]) })),
      shortcutManager.registerHandler(COMMAND_IDS.toggleWorkspacePanel, "application", togglePanel),
      shortcutManager.registerHandler(COMMAND_IDS.focusSidebar, "application", goToSidebar),
      shortcutManager.registerHandler(COMMAND_IDS.maximizeWorkspacePanel, "application", maximizeWorkspacePanel),
      shortcutManager.registerHandler(COMMAND_IDS.stashPrompt, "chat", stashPrompt),
      ...(["chat", "dashboard"] as const).map((context) => shortcutManager.registerHandler(COMMAND_IDS.stopResponse, context,
        () => { const { chat } = focusedSession(); if (chat.streaming()) void chat.stop(); }, { when: () => focusedSession().chat.streaming() })),
      ...getCommandDefinition(COMMAND_IDS.focusComposer).contexts.map((context) =>
        shortcutManager.registerHandler(COMMAND_IDS.focusComposer, context, focusComposer, { when: hasComposer })),
      ...getCommandDefinition(COMMAND_IDS.focusWorkspacePanel).contexts.map((context) =>
        shortcutManager.registerHandler(COMMAND_IDS.focusWorkspacePanel, context, focusWorkspacePanel, { when: () => Boolean(workspacePanelScope()) })),
      ...getCommandDefinition(COMMAND_IDS.focusTranscript).contexts.map((context) =>
        shortcutManager.registerHandler(COMMAND_IDS.focusTranscript, context, () => { focusTranscript(); landTranscriptCursor(document.activeElement); }, { when: hasTranscript })),
      shortcutManager.registerHandler(COMMAND_IDS.focusMainPane, "application", focusMainPane),
      shortcutManager.registerHandler(COMMAND_IDS.nextTab, "application", () => stepTab(1), { when: () => Boolean(tabsToStep()) }),
      shortcutManager.registerHandler(COMMAND_IDS.previousTab, "application", () => stepTab(-1), { when: () => Boolean(tabsToStep()) }),
      shortcutManager.registerHandler(COMMAND_IDS.nextPane, "application", () => stepPane(1), { when: () => splitShown() && !isMobileLayout() }),
      shortcutManager.registerHandler(COMMAND_IDS.newPane, "application", () => openEmptyPane(), { when: () => !isMobileLayout() }),
      shortcutManager.registerHandler(COMMAND_IDS.undoPaneChange, "application", () => void stepPanes(-1), { when: () => !isMobileLayout() && panes.canUndo() }),
      shortcutManager.registerHandler(COMMAND_IDS.redoPaneChange, "application", () => void stepPanes(1), { when: () => !isMobileLayout() && panes.canRedo() }),
      shortcutManager.registerHandler(COMMAND_IDS.openBrowser, "application", () => openBrowser()),
      shortcutManager.registerHandler(COMMAND_IDS.openMail, "application", () => openMail()),
      shortcutManager.registerHandler(COMMAND_IDS.previousPane, "application", () => stepPane(-1), { when: () => splitShown() && !isMobileLayout() }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "application", toggleChatWorkspaceFocus, { when: () => Boolean(workspacePanelScope()) && hasComposer() }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "chat", toggleChatWorkspaceFocus, { when: () => Boolean(workspacePanelScope()) && hasComposer() }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "workspace-panel", toggleChatWorkspaceFocus),
      shortcutManager.registerHandler(COMMAND_IDS.workspaceMoveToMain, "workspace-panel", () => moveToRow(`folder:${dockProject()!.id}`), { when: () => !isMobileLayout() && panelOpen() && (dockTool() === "files" || dockTool() === "diff") && Boolean(dockProject()) && !document.activeElement?.closest(".main-split") }),
      shortcutManager.registerHandler(COMMAND_IDS.workspaceMoveToDock, "workspace-panel", async () => { const pane = paneOf(document.activeElement); if (pane !== null && canDock(pane)) await dockPane(pane); }, { when: () => splitShown() && Boolean(document.activeElement?.closest(".main-split")) }),
      ...(["chat"] as const).map((context) => shortcutManager.registerHandler(COMMAND_IDS.workspaceMoveToDock, context, async () => { const pane = paneOf(document.activeElement); if (pane !== null) await dockPane(pane); }, { when: () => { const pane = paneOf(document.activeElement); return pane !== null && canDock(pane); } })),
      shortcutManager.registerHandler(COMMAND_IDS.stashPrompt, "dashboard", stashPrompt),
      ...([["dashboardComposer", "composer"], ["dashboardChats", "chats"], ["dashboardProjects", "projects"], ["dashboardWorkspaces", "workspaces"], ["dashboardTerminals", "terminals"], ["dashboardChanges", "changes"], ["dashboardFiles", "files"]] as const)
        .map(([id, section]) => shortcutManager.registerHandler(COMMAND_IDS[id], "dashboard", () => { focusSplitSection(section); }, { when: () => splitSections().has(section) })),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "dashboard", toggleChatWorkspaceFocus, { when: () => Boolean(workspacePanelScope()) && hasComposer() }),
      ...(() => {
        const panesAt = ["chat", "dashboard", "workspace-panel"] as const;
        const here = () => isMobileLayout() ? null : paneOf(document.activeElement);
        const closeTabHere = async (pane: PaneKey) => {
          const tabs = tabsOf(pane);
          if (tabs && tabs.length > 1) return await closeTab(pane, paneData(pane)!.active);
          await closeDocument(pane);
        };
        const hasTab = (pane: PaneKey) => Boolean(parseFileView(viewOf(pane))?.length || tabsOf(pane)?.length || !viewOf(pane)?.startsWith("chat:"));
        const canClosePane = (pane: PaneKey) => inDock(pane) || (splitShown() && (pane !== "main" || shownSlots()[0] !== undefined));
        const canSwap = (pane: PaneKey) => splitShown() && !inDock(pane) && swapPartner(pane) !== null;
        const layouts = () => PANE_LAYOUTS[splitShown() ? shownSlots().length + 1 : 1];
        const nextLayout = () => {
          const presets = layouts()!.map(normalized);
          const shares = paneShares();
          const distance = (weights: number[]) => weights.reduce((sum, weight, index) => sum + Math.abs(weight - (shares[index] ?? 0)), 0);
          const at = presets.reduce((best, weights, index) => distance(weights) < distance(presets[best]!) ? index : best, 0);
          applyPaneLayout(layouts()![(at + 1) % presets.length]!);
        };
        const railDocked = () => dockContents().filter((slot) => slotView(slot));
        return [
          ...panesAt.flatMap((context) => [
            shortcutManager.registerHandler(COMMAND_IDS.closeTab, context, () => { const pane = here(); if (pane !== null) void closeTabHere(pane); }, { when: () => { const pane = here(); return pane !== null && hasTab(pane); } }),
            shortcutManager.registerHandler(COMMAND_IDS.closePane, context, () => { const pane = here(); if (pane !== null) void (inDock(pane) ? closeSlot(pane as number) : closePane(pane)); }, { when: () => { const pane = here(); return pane !== null && canClosePane(pane); } }),
            shortcutManager.registerHandler(COMMAND_IDS.swapPanes, context, () => { const pane = here(); const target = pane === null ? null : swapTarget(pane); if (pane !== null && target !== null) void swapPanes(pane, false, target, true, keyboardPane()); }, { when: () => { const pane = here(); return pane !== null && canSwap(pane); } }),
            shortcutManager.registerHandler(COMMAND_IDS.equalisePanes, context, () => applyPaneLayout(layouts()![0]!), { when: () => !isMobileLayout() && Boolean(layouts()) }),
            shortcutManager.registerHandler(COMMAND_IDS.nextPaneLayout, context, nextLayout, { when: () => !isMobileLayout() && Boolean(layouts()) }),
          ]),
          shortcutManager.registerHandler(COMMAND_IDS.toggleDockOverlay, "workspace-panel", toggleDockOverlay, { when: () => !isMobileLayout() && dockAvailable() }),
          ...([COMMAND_IDS.dockedPane1, COMMAND_IDS.dockedPane2, COMMAND_IDS.dockedPane3] as const).map((id, index) =>
            shortcutManager.registerHandler(id, "workspace-panel", () => { const slot = railDocked()[index]; if (slot !== undefined) chooseDocked(slot, false); }, { when: () => !isMobileLayout() && railDocked()[index] !== undefined })),
          shortcutManager.registerHandler(COMMAND_IDS.workspaceMoveToMain, "workspace-panel", () => { const pane = here(); if (pane !== null) undockPane(pane as number); }, { when: () => { const pane = here(); return pane !== null && dockedSlot() === pane && !rowFull(); } }),
          shortcutManager.registerHandler(COMMAND_IDS.sidebarNewChat, "sidebar", () => { setMobileSidebarOpen(false); void startNewChat(); }),
          shortcutManager.registerHandler(COMMAND_IDS.sidebarNewFolder, "sidebar", () => runSidebar("new-folder")),
          shortcutManager.registerHandler(COMMAND_IDS.sidebarSearchChats, "sidebar", toggleSearchPalette),
        ];
      })(),
      // Not claimed from an editor with its own find, nor from the find bar's own field: pressed again there, the
      // browser's find opens.
      ...((here: () => HTMLElement | null) => (["chat", "dashboard"] as const).map((context) => shortcutManager.registerHandler(COMMAND_IDS.findInChat, context, () => { openTranscriptFind(here()); }, {
        when: () => !document.activeElement?.closest(".ui-find-bar, .cm-editor") && hasTranscriptFind(here()),
      })))(() => {
        // The pane's own transcript (a split pane sits inside the main one's element), else the region's.
        const active = document.activeElement, pane = paneOf(active) ?? keyboardPane();
        return [...document.querySelectorAll<HTMLElement>(`${paneSelector(pane)} .ui-chat-viewport`)].find((viewport) => paneOf(viewport) === pane)
          ?? active?.closest("[data-region]")?.querySelector<HTMLElement>(".ui-chat-viewport") ?? null;
      }),
    ];
    const uninstallShortcuts = shortcutManager.install(window);
    window.addEventListener("keydown", dismissOpenLayer, { capture: true });
    // Bubble phase, so menus, fields and editors answer first. Terminals keep Escape for their program.
    const escapeHome = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.key !== "Escape" || event.repeat || paletteOpen() || settingsOpen()) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest("[data-shortcut-exclusive='terminal'], [role='dialog'], [role='menu'], [role='listbox'], input, textarea, select, [contenteditable='true']:not(.cm-content)")) return;
      const fromDock = target.closest("[data-region='workspace-panel']");
      if (!fromDock && !target.closest("[data-part='transcript'], .ui-chat-viewport, .file-viewer-surface, .cm-editor")) return;
      const pane = fromDock ? null : paneOf(target);
      const composer = (pane !== null ? document.querySelector<HTMLTextAreaElement>(`${paneSelector(pane)} textarea[data-composer-input]:not([disabled])`) : null)
        ?? document.querySelector<HTMLTextAreaElement>(".chat-main textarea[data-composer-input]:not([disabled])");
      if (!composer) return;
      event.preventDefault();
      composer.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", escapeHome);
    let releaseFocusedContexts: Array<() => void> = [];
    syncFocusedShortcutContext = (target: EventTarget | null) => {
      for (const release of releaseFocusedContexts) release();
      releaseFocusedContexts = [];
      const regions: Array<{ name: string; element: Element }> = [];
      for (let node = target instanceof Element ? target.closest("[data-region]") : null; node; node = node.parentElement?.closest("[data-region]") ?? null) {
        const name = node.getAttribute("data-region");
        if (isShortcutRegion(name) && (name !== "workspace-panel" || panelOpen() || node.classList.contains("main-split"))) regions.push({ name, element: node });
      }
      releaseFocusedContexts = regions.map((region) => shortcutManager.activateContext(region.name));
      // The sidebar is the exception: a click there opens a chat and focus only passes through its row on the way to
      // the pane, so the line stays where it was.
      const outermost = regions.at(-1);
      if (!outermost || !(outermost.element instanceof HTMLElement)) return;
      if (outermost.element !== focusRegion) { enteredRegion = outermost.element; focusRegion = outermost.element; }
      if (outermost.name === "sidebar" && lastInput === "pointer") return;
      holdRegion(outermost.element);
    };
    const onFocusIn = (event: FocusEvent) => syncFocusedShortcutContext?.(event.target);
    window.addEventListener("focusin", onFocusIn);
    const notePress = () => { focusIntent.drop(); lastInput = "pointer"; };
    const noteKey = () => { lastInput = "key"; };
    window.addEventListener("keydown", noteKey, true);
    window.addEventListener("pointerdown", notePress, true);
    syncFocusedShortcutContext(document.activeElement);
    onCleanup(() => {
      syncFocusedShortcutContext = undefined;
      holdRegion(null);
      window.removeEventListener("keydown", dismissOpenLayer, true);
      window.removeEventListener("keydown", escapeHome);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("pointerdown", notePress, true);
      window.removeEventListener("keydown", noteKey, true);
      for (const release of releaseFocusedContexts) release();
      uninstallShortcuts();
      for (const release of releaseShortcutHandlers) release();
      releaseApplicationContext();
    });
    onCleanup(bindVisualViewportShell());
    onCleanup(bindOverlayScrollbars());
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
      restoringPanes = true;
      applyPanesFromUrl();
      void (async () => {
        const open = harnessThread();
        if (open && routeAddress() !== threadPath(open) && !(await leaveHarnessThread())) {
          history.pushState({}, "", threadPath(open));
          return;
        }
        if (location.pathname === "/") {
          await openDashboard("none");
          return;
        }
        if (location.pathname === JBOT_THREAD_PATH && !pathChatId()) {
          await openJbotThread();
          return;
        }
        const jbotPage = pathJbotPage();
        if (jbotPage) {
          if (location.pathname === "/agent") history.replaceState(history.state, "", `/jbot/page${location.search}${location.hash}`);
          await openJbotPage(jbotPage, "none");
          return;
        }
        if (location.pathname === "/computer" || location.pathname.startsWith("/computer/harness/") || location.pathname.startsWith("/computer/environment/")) {
          await openComputerRoute();
          return;
        }
        if (location.pathname === "/terminal") {
          await openTerminalRoute("none");
          return;
        }
        const projectRouteId = pathProjectId();
        if (projectRouteId) {
          let project = catalogue.projects().find((item) => projectMatchesPath(item, projectRouteId));
          if (!project) project = (await catalogue.refresh()).find((item) => projectMatchesPath(item, projectRouteId));
          if (!project) throw new Error("Project not found");
          await openProject(project, "none");
          return;
        }
        const chatId = pathChatId();
        if (!chatId) return;
        let owner = catalogue.projects().find((project) => project.sessions.some((item) => item.id === chatId));
        if (!owner) owner = (await catalogue.refresh()).find((project) => project.sessions.some((item) => item.id === chatId));
        const target = owner?.sessions.find((item) => item.id === chatId);
        const hidden = !owner || !target ? await agentChat(chatId) : null;
        if (hidden) { owner = hidden.project; }
        const resolvedTarget = target || hidden?.chat;
        if (!owner || !resolvedTarget) throw Object.assign(new Error("Chat not found"), { error: "chat_not_found" });
        await chat.select(resolvedTarget, owner, {
          history: "none",
          onCommit: () => {
            showRoute({ kind: "chat" });
          },
        });
      })().catch(async (error) => {
        // Back or forward onto a chat deleted since: the address said it while
        // the last chat stayed on screen. It goes to the dashboard instead.
        if ((error as { error?: unknown } | null)?.error === "chat_not_found" && pathChatId()) {
          history.replaceState(history.state, "", "/");
          await openDashboard("none");
          showPlainError("That chat no longer exists");
          return;
        }
        showError(error);
      }).finally(() => { requestAnimationFrame(() => { restoringPanes = false; }); });
    };
    window.addEventListener("popstate", onPopState);
    onCleanup(() => window.removeEventListener("popstate", onPopState));
    const templateRequest = apiWhenServed<{ templates: Template[]; defaultTemplateId?: string }>("/v0/templates")
      .catch(() => ({ templates: [], defaultTemplateId: "assistant" }))
      .then((payload) => {
        setTemplates(asList<Template>(payload.templates));
        setDefaultTemplateId(payload.defaultTemplateId || "assistant");
        setTemplatesLoading(false);
        return payload;
      });
    void apiWhenServed<{
      profiles: Array<{ id: string; label: string; description?: string; management: string; disabled?: boolean; drive?: boolean; agent: { protocol: string; implementation: string } }>;
      harnesses?: Record<string, HarnessManifestView>;
    }>("/v0/profiles")
      .then((payload) => {
        setHarnessCapabilities(payload.harnesses || {});
        setExternalProfiles((Array.isArray(payload.profiles) ? payload.profiles : [])
          .filter((profile) => profile.management === "agent" && Boolean(profile.agent?.implementation))
          .map((profile) => ({ id: profile.id, label: profile.label, description: profile.description,
            disabled: profile.disabled, implementation: profile.agent?.implementation, drive: profile.drive })));
      })
      .catch(() => { setExternalProfiles([]); setHarnessCapabilities({}); });
    void apiWhenServed<{ maxAttachmentBytes?: number }>("/v0/capabilities")
      .then((payload) => {
        const maxBytes = payload.maxAttachmentBytes;
        if (typeof maxBytes === "number" && Number.isSafeInteger(maxBytes) && maxBytes > 0) setMaxAttachmentBytes(maxBytes);
      })
      .catch(() => {});

    // Where the page was opened. A click while it loads has already set its own
    // route; what loaded then fills the catalogue but does not take the page back.
    const bootPath = location.pathname;
    const navigated = () => location.pathname !== bootPath;
    let hubAwayOnBoot: (away: "away") => void = () => {};
    const awayOnBoot = new Promise<"away">((resolve) => { hubAwayOnBoot = resolve; });
    if (initialRouteId && cachedCatalogue) createEffect(() => {
      if (["reconnecting", "offline"].includes(runtime.connectivity())) hubAwayOnBoot("away");
    });
    void (async () => {
      const [cataloguePayload, selectedChat] = await Promise.all([
        catalogueRequest,
        selectedChatRequest && cachedCatalogue ? Promise.race([selectedChatRequest, awayOnBoot]) : selectedChatRequest || Promise.resolve(null),
      ]);
      const projects = asList<Project>(cataloguePayload.projects).map((project) => ({ ...project, sessions: asList<ChatSummary>(project.sessions) }));
      pruneWorkspacePanelStorage(workspacePanelScopes(projects));
      catalogue.setProjects(projects);
      // Usually the server says what the cache did; replacing every row with an equal one costs a phone a tenth of a
      // second.
      if (cachedCatalogue) void catalogueFresh.then((fresh) => {
        if (JSON.stringify(fresh) === JSON.stringify(cachedCatalogue)) return;
        catalogue.setProjects(asList<Project>(fresh.projects).map((project) => ({ ...project, sessions: asList<ChatSummary>(project.sessions) })));
      }).catch(() => {});
      if (navigated()) return;
      const offlineTarget = selectedChat === "away"
        ? projects.flatMap((project) => project.sessions.map((session) => ({ project, session }))).find((item) => item.session.id === initialRouteId)
        : undefined;
      if (offlineTarget) {
        await chat.openOffline(offlineTarget.session, offlineTarget.project);
        if (navigated()) return;
        showRoute({ kind: "chat" });
        return;
      }
      const reached = selectedChat === "away" ? await selectedChatRequest : selectedChat;
      if (reached) {
        const [target, detail] = reached;
        let project = projects.find((item) => item.id === target.projectId);
        if (!project && cachedCatalogue) {
          const fresh = asList<Project>((await catalogueFresh).projects).map((item) => ({ ...item, sessions: asList<ChatSummary>(item.sessions) }));
          catalogue.setProjects(fresh);
          project = fresh.find((item) => item.id === target.projectId) || fresh[0];
        }
        project ||= projects[0];
        if (!project) throw new Error("Conduit has no chat project");
        await chat.initialize(target, project, detail);
        if (navigated()) return;
        showRoute({ kind: "chat" });
      } else if (initialProjectRouteId) {
        const project = projects.find((item) => projectMatchesPath(item, initialProjectRouteId));
        if (!project) throw new Error("Project not found");
        catalogue.selectProject(project);
        showRoute({ kind: "project" });
      } else if (initialAgentRoute || initialJbotRoute) {
        showRoute({ kind: initialJbotRoute ? "jbot" : "agent" });
      } else if (initialComputerRoute) {
        await openComputerRoute();
      } else if (initialTerminalRoute) {
        showRoute({ kind: "terminal" });
      } else if (initialDashboardRoute) {
        showRoute({ kind: "dashboard" });
      } else {
        const templatePayload = await templateRequest;
        const project = projects.find((item) => item.slug === "chat") || projects[0];
        if (!project) throw new Error("Conduit has no chat project");
        const created = await api<ChatSummary>("/v0/chats", { method: "POST", body: JSON.stringify({ projectId: project.id, templateId: templatePayload.defaultTemplateId || "assistant" }) });
        if (navigated()) return;
        history.replaceState({}, "", chatPath(created.id));
        await chat.initialize(created, project);
        showRoute({ kind: "chat" });
      }
    })().catch((error) => {
      if (initialRouteId && (error as { error?: string }).error === "chat_not_found") {
        location.replace("/");
        return;
      }
      const message = (error as Error).message;
      if (routeBootstrap() === "loading" && !navigated()) {
        setRouteBootstrapError(message);
        setRouteBootstrap("error");
      }
      showError(message);
    });
  });

  const mainDropHandlers = {
    onDragEnter: (event: DragEvent) => { if (routeKind() === "chat" || harnessThread()) dropHandlers.onDragEnter(event); },
    onDragOver: (event: DragEvent) => { if (routeKind() === "chat" || harnessThread()) dropHandlers.onDragOver(event); },
    onDragLeave: (event: DragEvent) => { if (routeKind() === "chat" || harnessThread()) dropHandlers.onDragLeave(event); },
    onDrop: (event: DragEvent) => { if (routeKind() === "chat" || harnessThread()) dropHandlers.onDrop(event); },
  };
  const dropHandlers = {
    onDragEnter: (event: DragEvent) => { if (!event.dataTransfer?.types.includes("Files")) return; event.preventDefault(); dragDepth += 1; setDropActive(true); },
    onDragOver: (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); },
    onDragLeave: (event: DragEvent) => { if (!event.dataTransfer?.types.includes("Files")) return; event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) setDropActive(false); },
    onDrop: (event: DragEvent) => { event.preventDefault(); dragDepth = 0; setDropActive(false); const files = filesFromDataTransfer(event.dataTransfer); if (files.length) attachments.addFiles(files); },
  };

  const PageComposer = (props: { session: ChatSession; place?: ReturnType<typeof chatPlace>; workspace?: Project; keyboardOwner: () => boolean; onSendDraft?: (prompt: string) => Promise<void>; contextControl?: JSX.Element }) => {
    const current = props.session;
    return <Composer shortcuts={shortcutManager} contextControl={props.contextControl}
      chat={current.chat}
      place={props.place}
      workspace={props.workspace}
      supports={current.capability}
      attachments={current.attachments}
      attachmentsSupported={current.capability("attachments", true)}
      models={current.models}
      permissions={current.capability("permissionModes") ? current.permissions : undefined}
      serviceLevels={current.manifest()?.serviceLevels?.length ? current.serviceLevels : undefined}
      profiles={agentThread(current.chat.loadedId()) ? [] : profilesAt(props.place?.current ?? props.workspace)}
      activeProfile={current.activeProfile()}
     
      serverOnline={serverReachable()}
      voiceSettings={voiceSettings()}
      keyboardOwner={props.keyboardOwner}
      onChooseProfile={(id) => void current.switchProfile(id)}
      onOpenSettings={openSettings}
      onOpenModelSelector={openModelSelector}
      modelSelectorShortcut={shortcutManager.formatEffectiveBinding(COMMAND_IDS.openModelSelector)}
      onOpenAttachments={current.openAttachments}
      onSendDraft={props.onSendDraft}
    />;
  };
  const agentHeader = (slot: number | "main") => (title: string, pill?: JSX.Element, actions?: JSX.Element) => <ChatHeader title={title} pill={pill} actions={actions} tabActions={actions ? undefined : paneTabActions(slot)} tabs={documentTab(slot)} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} appDashboard alone />;
  const openAgentThread = () => {
    const id = agentView()?.home?.chatId;
    if (id) void agentChat(id).then((target) => openChatHere(target.chat, target.project)).catch(showError);
  };
  const openAgentChatFromPage = (id: string, event?: MouseEvent) => {
    const verb: Layouts.Verb = event?.altKey ? { beside: true } : event && (event.ctrlKey || event.metaKey) ? { tab: true } : {};
    void agentChat(id).then((target) => openChatHere(target.chat, target.project, verb)).catch(showError);
  };
  const renderAgent = (slot: number | "main") => <AgentPage
    onNeed={(width) => { if (!isMobileLayout()) setAgentPageNeed(Math.ceil(width)); }}
    header={agentHeader(slot)}
    onOpenThread={agentView()?.home?.chatId ? openAgentThread : undefined}
    onOpenMessages={() => void openJbotHere(verbNow())}
    onOpenFile={(path) => { const projectId = agentView()?.projectId; if (projectId) void openFileDocument({ projectId, path }, { ...verbNow(), edit: false }); }}
    onOpenSettings={() => openSettings("agent")}
    onOpenChat={openAgentChatFromPage} />;
  const renderJbot = (slot: number | "main" | "tool") => {
    const tool = slot === "tool";
    const current = tool ? jbotSession : slot === "main" ? session : paneSlot(slot).session;
    const owns = tool ? () => Boolean(document.activeElement?.closest("[data-region='workspace-panel']"))
      : slot === "main" ? () => !sideHasKeyboard() : () => slotHasKeyboard(slot);
    // Kept loaded while the page shows: opening the page again clears the session's chat, as any route to a page does,
    // and the composer would go with it.
    let loading: string | null = null;
    let active = true;
    onCleanup(() => { active = false; });
    createEffect(on([() => agentView()?.home?.chatId, current.chat.loadedId] as const, ([id, loaded]) => {
      if (!id || loaded === id || loading === id || current.chat.navigatingId()) return;
      loading = id;
      // A chat switch clears loadedId before its route commit closes this page. Do not select home over that switch,
      // including when its lookup finishes after the page has closed.
      void agentChat(id).then((target) => {
        if (active && !current.chat.navigatingId()) return current.chat.select(target.chat, target.project, { history: "none" });
      }).catch(showError).finally(() => { loading = null; });
    }));
    const openFile = (path: string) => { const projectId = agentView()?.projectId; if (projectId) void openFileDocument({ projectId, path }, { ...verbNow(), edit: false }); };
    const jbotPill = () => { const control = useContext(JbotPanelControl); return <HeaderPill opens label={agentName()}
      count={control?.needs && control.needs.count() ? { value: control.needs.count(), label: `${control.needs.count()} need you`, open: control.needs.open(), onClick: control.needs.toggle } : undefined}
      icon={<HarnessMark id="conduit" />} aria-expanded={control?.open()} aria-label={`${agentName()}'s panel`} onClick={() => control?.toggle()} />; };
    const docked = () => !tool && !isMobileLayout() && inDock(slot as PaneKey);
    const dockActions = () => <>
      <HeaderButton label="Move to a pane" icon={<Icons.Split />} onClick={() => void undockPane(slot as number)} />
      <HeaderButton label={`Put ${agentName()} away`} icon={<Icons.Close />} onClick={() => void dismissSummon()} />
    </>;
    return <JbotRoom header={(title) => tool ? undefined : agentHeader(slot as PaneKey)(title, jbotPill(), docked() ? dockActions() : undefined)}
      presentation={tool ? "narrow" : docked() ? "phone" : undefined}
      panelActions={(done) => <JbotWays onOpenSettings={() => openSettings("agent")} onDone={done} />}
      panel={(state) => <JbotPanel tab={state.tab} onTab={state.onTab} onOpenChat={openAgentChatFromPage} onOpenFile={openFile} onOpenSettings={() => openSettings("agent")} onDone={state.done} needsMount={state.needsMount}
        onOpenThread={agentView()?.home?.chatId ? openAgentThread : undefined} />}
      working={current.chat.loadedId() === agentView()?.home?.chatId && current.chat.streaming()}
      live={current.chat.loadedId() === agentView()?.home?.chatId && current.chat.streaming() ? liveTrace(current.chat.messages(), current.chat.tools(), current.chat.activeGeneration()) : null}
      sent={(() => {
        if (current.chat.loadedId() !== agentView()?.home?.chatId) return null;
        // The person's own last message there (not a run's report, a beat, a steer or an approval's answer Conduit wrote:
        // the log never has those, so one would stay drawn as theirs).
        const mine = current.chat.messages().findLast((message) => message.role === "user" && message.origin !== "harness" && !message.run && !message.id.startsWith("beat:")
          && !NOT_SPOKEN.test(message.content || ""));
        return mine?.content ? { text: mine.content, at: mine.timestamp || new Date().toISOString() } : null;
      })()}
      threadChanged={current.chat.loadedId() === agentView()?.home?.chatId ? `${current.chat.messages().length}:${current.chat.streaming()}` : null}
      composerReady={!agentView()?.home?.chatId || current.chat.loadedId() === agentView()?.home?.chatId}
      composer={<Show when={current.chat.loadedId() && current.chat.loadedId() === agentView()?.home?.chatId}>
        <PageComposer session={current} keyboardOwner={owns} contextControl={<JbotChip />} /></Show>} />;
  };
  const openTerminalFromPage = async (terminal: { id: string; projectId: string; cwd?: string | null }, maximized: boolean) => {
    if (terminal.projectId.startsWith("device:")) return openTerminalRoute("push", terminal.id);
    if ((terminal.projectId === "computer" || terminal.projectId.startsWith("computer:")) && terminal.cwd) {
      await openComputer();
      void browseComputer(terminal.cwd).then(async () => { await openWorkspaceView("terminal", terminal.id); if (maximized) setWorkspaceExpanded(true); });
      return;
    }
    const project = catalogue.projects().find((item) => item.id === terminal.projectId);
    if (!project) return showError("The terminal scope is no longer available.");
    void createChat(project).then(async (created) => {
      if (!created) return;
      await openWorkspaceView("terminal", terminal.id);
      if (maximized) setWorkspaceExpanded(true);
    });
  };
  const itemMenus: ItemActions = {
    places: () => catalogue.projects(),
    renameChat: (chat, project) => runSidebar("rename-chat", { chat, project }),
    moveChat: (chat, from, to) => void moveChat(chat, from, to),
    copyChat: (chat) => runSidebar("copy-chat", { chat }),
    get openBeside() { return isMobileLayout() ? undefined : (chat: ChatSummary, project: Project) => void openChatBeside(chat, project); },
    openTerminal: async (target, project) => { await openChat(target, project); if (!harnessThread() && catalogue.selectedId() === target.id) await openWorkspaceView("terminal"); },
    running: (chat) => !!runtime.getProcess(chat.id)?.id,
    stop: (chat) => void stopChatProcess(chat.id),
    pinned: isSidebarPinned,
    togglePin: (type, id) => void toggleSidebarPin(type, id),
    deleteChat: (chat, project) => runSidebar("delete-chat", { chat, project }),
    newChat: (project) => void startNewChat(project),
    openMaximized: openProjectWithMaximizedWorkspace,
    renamePlace: (project) => runSidebar("rename-folder", { project }),
    identity: openWorkspaceIdentity,
    settings: (project) => openSettings("workspaces", project.id),
    moveChats: (from, to) => void moveProjectChats(from, to),
    deletePlace: (project) => runSidebar("delete-project", { project }),
  };
  const AppDashboardPage = (props: { session: ChatSession; place?: ReturnType<typeof chatPlace>; keyboardOwner: () => boolean; onSendDraft: (prompt: string) => Promise<void>; onOpenChat: (target: ChatSummary, project: Project) => void; actions?: JSX.Element; tabActions?: JSX.Element; tabs?: JSX.Element }) => <>
    <ChatHeader title="Conduit Dashboard" panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} appDashboard actions={props.actions}  tabActions={props.tabActions} tabs={props.tabs} />
    <AppDashboard
      projects={catalogue.projects()}
      composer={<PageComposer session={props.session} place={props.place} keyboardOwner={props.keyboardOwner} onSendDraft={props.onSendDraft} />}
      runtime={runtime}
      onOpenChat={props.onOpenChat}
      onPrefetchChat={chat.prefetch}
      onOpenProject={(project) => void openProject(project)}
      onPrefetchProject={prefetchProjectDashboard}
      onContextAction={(type, target) => runSidebar(type, target)}
      isPinned={isSidebarPinned}
      menus={itemMenus}
      onSearchChats={(scope) => openPalette("chat-search", scope === "unscoped" ? "scope:chats " : "", true)}
      onOpenTerminalView={() => openTerminalRoute()}
      onOpenSettings={() => openSettings()}
      profiles={profiles()}
      onOpenTerminal={(terminal) => openTerminalFromPage(terminal, false)}
      onOpenTerminalMaximized={(terminal) => openTerminalFromPage(terminal, true)}
      onPrefetchTerminal={prefetchWorkspaceTerminal}
    />
  </>;
  const ProjectPage = (props: { session: ChatSession; project: Project; keyboardOwner: () => boolean; onSendDraft: (prompt: string) => Promise<void>; onOpenChat: (target: DashboardChat, project: Project) => Promise<void>; target?: { project: Project }; actions?: JSX.Element; tabActions?: JSX.Element; tabs?: JSX.Element }) => <>
    <ChatHeader project={props.project} title={props.project.name} tabs={props.tabs} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => void shareProject(props.project)} onRename={() => runSidebar("rename-folder", props.target ?? {})} onDelete={() => runSidebar("delete-project", props.target ?? {})} dashboard actions={props.actions}  tabActions={props.tabActions} />
    <ProjectDashboard project={props.project} runtime={runtime} profiles={profiles()} onOpenHarnessThread={(harnessId, path, id, title) => void openHarnessThread({ harnessId, path, id, title })}
      composer={<PageComposer session={props.session} workspace={props.project} keyboardOwner={props.keyboardOwner} onSendDraft={props.onSendDraft} />}
      onOpenChat={props.onOpenChat}
      menus={itemMenus}
      onPrefetchChat={chat.prefetch}
      onContextAction={(type, target) => runSidebar(type, target)}
      isPinned={isSidebarPinned}
      onOpenView={(view) => openWorkspaceView(view)}
      onOpenFile={canOpenFilePanes() ? (path) => openFileDocument({ projectId: props.project.id, path }, { ...verbNow(), edit: false }) : undefined}
      fileView={canOpenFilePanes() ? (path) => formatFileView([{ projectId: props.project.id, path }]) : undefined}
      onOpenTerminal={(terminal) => openWorkspaceView("terminal", terminal.id, verbNow())}
      onOpenTerminalMaximized={async (terminal) => { await openWorkspaceView("terminal", terminal.id); setWorkspaceExpanded(true); }}
      onPrefetchTerminal={prefetchWorkspaceTerminal}
      onSearchChats={() => openPalette("chat-search", `in:${props.project.id} `, true)}
      onRename={() => runSidebar("rename-folder", props.target ?? {})} onDelete={() => runSidebar("delete-project", props.target ?? {})}
      onOpenSettings={openSettings} onSaveAppearance={saveWorkspaceAppearance} onRefresh={refresh} onCancelClone={cancelClone} onDestroyWorkspace={(confirmation) => destroyWorkspace(props.project, confirmation)} onError={showError} />
  </>;
  const workspaceNotice = (project: Project | undefined, chatId: string | null) => <Show when={project?.kind === "workspace" && [...runtime.processes().values()].some((process) => process.chatId !== chatId && process.active)}><Notice icon={<Icons.Warning />} title="Another chat is working in this Workspace">Both agents can edit the same files. Conduit does not lock the Workspace or create worktrees automatically.</Notice></Show>;
  const ChatSurface = (props: {
    session: ChatSession;
    opening?: boolean;
    empty?: boolean;
    sending?: boolean;
    project?: Project;
    keyboardOwner: () => boolean;
    onShare: () => void;
    onRename?: () => void;
    onDelete?: () => void;
    actions?: JSX.Element;
    tabActions?: JSX.Element;
    tabs?: JSX.Element;
    modes?: JSX.Element;
    notice?: JSX.Element;
    place?: ReturnType<typeof chatPlace>;
    modelSelector?: boolean;
    stackRef?: (element: HTMLDivElement) => void;
  }) => {
    const current = props.session;
    const surfaceChat = current.chat;
    const subagent = () => surfaceChat.status() === "subagent";
    const parent = () => subagentParent(surfaceChat.loadedId());
    createEffect(() => { const id = surfaceChat.loadedId(); if (id && subagent() && !hiddenChats().has(id)) void agentChat(id).catch(() => {}); });
    return <>
      <ChatHeader project={props.project} onOpenPlace={openPlace} parent={subagent() ? parent() : undefined} title={surfaceChat.title() || (surfaceChat.status() === "draft" ? "New chat" : "Untitled chat")} profile={current.activeProfile()} runtime={surfaceChat.runtimeIdentity()} live={surfaceChat.live() as unknown as Record<string, unknown>} chat={surfaceChat} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={props.onShare} onRename={props.onRename} onDelete={props.onDelete} actions={props.actions} tabActions={props.tabActions} tabs={props.tabs} modes={props.modes} />
      {props.notice}
      <Conversation chat={surfaceChat} busy={surfaceChat.presentation().kind === "opening_live"} empty={props.empty} sending={props.sending} opening={props.opening} stackRef={props.stackRef}
        transcript={<Transcript readOnly={subagent()} chat={surfaceChat} supports={current.capability} agentThread={agentThread(surfaceChat.loadedId())} profileLabel={current.activeProfile()?.label || current.activeProfile()?.id || surfaceChat.templateId() || undefined} projectId={props.project?.id} approvals={approvalsFor(surfaceChat.loadedId())} />}
        composer={<Show when={!subagent()} fallback={<SubagentNote parent={parent().title} onOpenParent={parent().open} />}><Composer shortcuts={shortcutManager} chat={surfaceChat} opening={props.opening} place={props.place} supports={current.capability} attachments={current.attachments} attachmentsSupported={current.capability("attachments", true)} models={current.models} permissions={current.capability("permissionModes") ? current.permissions : undefined} serviceLevels={current.manifest()?.serviceLevels?.length ? current.serviceLevels : undefined} profiles={agentThread(current.chat.loadedId()) ? [] : profilesAt(props.place?.current)} activeProfile={current.activeProfile()} onOpenModelSelector={props.modelSelector ? openModelSelector : undefined} modelSelectorShortcut={props.modelSelector ? shortcutManager.formatEffectiveBinding(COMMAND_IDS.openModelSelector) : undefined} serverOnline={serverReachable()} voiceSettings={voiceSettings()} keyboardOwner={props.keyboardOwner} onChooseProfile={(id) => void current.switchProfile(id).catch(showError)} onOpenSettings={openSettings} onOpenAttachments={current.openAttachments} /></Show>} />
    </>;
  };

  return <>
    <NotificationToaster />
    <Show when={feedbackMode()}><FeedbackTool mode={feedbackMode() ?? "use"} onMode={setFeedbackMode} onClose={() => setFeedbackMode(null)} client={clientId} keys={() => shortcutManager.formatEffectiveBinding(COMMAND_IDS.toggleFeedback)?.split(" ") ?? []} /></Show>
    <DecisionDialogs />
    {/* conventions-ok: a hidden file input the attach control opens; the library has no file-picker piece */}
    <input ref={session.setAttachInput} type="file" multiple hidden aria-hidden="true" onChange={(event) => { if (event.currentTarget.files) attachments.addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <Dialog open={Boolean(workspaceIdentityProject())} onOpenChange={(open) => { if (!open) closeWorkspaceIdentity(); }} close size="wide" title="Workspace identity" description="Choose a short mark or a Lucide icon, then choose a preset or custom color.">
        <Show when={workspaceIdentityProject()}>{(project) => <WorkspaceAppearanceEditor compact value={project().workspaceAppearance} saving={workspaceIdentitySaving()} onSave={(appearance) => void saveWorkspaceIdentity(appearance)} />}</Show>
    </Dialog>
    <Show when={routeKind() !== "terminal"}>
    <Sidebar onPreviewChat={previewChat} onPreviewJbot={previewJbot} onPreviewRelease={releasePreview} projects={sidebarFilled() ? catalogue.projects() : []} catalogueLoaded={sidebarFilled() && catalogue.loaded()} projectId={catalogue.projectId()} selectedId={catalogue.selectedId()} focusedId={keyboardSlot() !== null ? slotChatId(keyboardSlot()!) : null} openIds={openChatIds()} placeOf={(id: string) => chatPlaces().get(id)} onOpenChatBeside={isMobileLayout() ? undefined : openChatBeside} focusedView={viewOf(keyboardPane())} onOpenArtifact={(artifact, beside) => openArtifact(artifact.id, beside ? { beside } : verbNow())} onNewPane={isMobileLayout() ? undefined : openEmptyPane} navigatingId={chat.navigatingId()} dashboard={routeKind() === "dashboard" && !paneADocument()} agent={routeKind() === "jbot" && !paneADocument()} project={routeKind() === "project"} computer={routeKind() === "computer" && !paneADocument()} routeCovered={paneADocument() !== null} terminal={false} runtime={runtime} chatLimit={sidebarChatLimit()}
      connectivity={runtime.connectivity()} workspaceSuggestions={workspaceSuggestions()} workspacePolicy={workspacePolicy()} command={sidebarCommand()}
      sidebarPins={sidebarPins()} onTogglePin={toggleSidebarPin}
      serverInTitleBar={Boolean(desktopShell) && desktopTitleBar() === "conduit" && titleBarShows("server")}
      mobileOpen={mobileSidebarOpen()} onMobileOpenChange={setMobileSidebar}
      onMobileShutOnto={(opening) => shutDrawerOnto(opening, () => routeKind() !== "chat" || !mainChatId() || chat.loadedId() === mainChatId())}
      onWorkspaceSuggestionsNeeded={() => void loadWorkspaceSuggestions()}
      onNewChat={async (project) => { await startNewChat(project); }} onPrefetchChat={chat.prefetch} onOpenChat={(target, project) => openChatHere(target, project, verbNow())} onFocusMainPane={focusMainPane} onEnterMainPane={() => { if (!isMobileLayout() && !document.activeElement?.closest(".main-split") && keyboardPaneSlot() === null) enterMainPane(); }} onOpenProject={(project) => openProjectHere(project, verbNow())} onAddProject={addProject} onRenameChat={renameChat} onRenameProject={renameProject}
      onOpenProjectMaximized={openProjectWithMaximizedWorkspace}
      onMoveChat={moveChat} onMoveChats={moveChats} onMoveProjectChats={moveProjectChats} onCopyTranscript={copyTranscript} onCopyChatLinks={copyChatLinks}
      onDeleteChat={deleteChat} onDeleteChats={deleteChats} onDeleteProject={deleteProject}
      onStopProcess={(target) => stopChatProcess(target.id)}
      onOpenTerminal={async (target, project) => { await openChat(target, project); if (!harnessThread() && catalogue.selectedId() === target.id) await openWorkspaceView("terminal"); }}
      onOpenPty={async (terminal) => {
        if (terminal.projectId.startsWith("computer:") || terminal.projectId.startsWith("device:")) {
          await openTerminalRoute("push", terminal.id);
          return;
        }
        if ((terminal.projectId === "computer" || terminal.projectId.startsWith("computer:")) && terminal.cwd) {
          await openComputer();
          void browseComputer(terminal.cwd).then(() => openWorkspaceView("terminal", terminal.id));
          return;
        }
        const project = catalogue.projects().find((item) => item.id === terminal.projectId);
        if (!project) return showError("The terminal scope is no longer available.");
        void createChat(project).then(async (created) => {
          if (created) await openWorkspaceView("terminal", terminal.id);
        });
      }}
      onOpenComputer={() => openComputerHere(verbNow())}
      onOpenHarness={(id) => openHarnessHere(id, verbNow())}
      onOpenEnvironmentTerminal={(id) => void openDeviceTerminal({ id })}
      onOpenEnvironment={(id) => openEnvironmentHere(id, verbNow())}
      environment={routeKind() === "computer" && !computerHarness() ? computerEnvironment() || undefined : undefined} selectedHarness={paneADocument() ? undefined : computerHarness()}
      onOpenTerminalView={() => openTerminalRoute()}
      onOpenAgent={() => { const verb = verbNow(); return isMobileLayout() || verb.beside || verb.tab ? openJbotHere(verb) : showJbot(); }}
      onOpenDashboard={() => openDashboardHere(verbNow())}
      onOpenWorkspaceIdentity={openWorkspaceIdentity} onOpenSettings={openSettings} onOpenPalette={(page, initialQuery) => openPalette(page || null, initialQuery || "", page === "chat-search")}
      onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating()}
      updateState={updateState()} onTakeUpdate={() => void takePwaUpdate(true)}
      onAddServer={() => setAddingServer(true)}
      onLogout={() => void logout()} />
    {/* Fetched on first use, then kept: shut, it stays to play its leave. */}
    <Show when={connectSeen()}><ConnectDialog open={addingServer()} onOpenChange={setAddingServer} addServer={
      <ServerConnectForm adding onOpened={() => setAddingServer(false)} onDone={(origin) => {
        setAddingServer(false);
        // Told to the server being left, before leaving it: otherwise the one
        // that was asked to remember this address is the only one that never
        // hears about it.
        void publishServerDirectory(servers()).finally(() => switchToServer(origin, isInstalledClient()));
      }} />
    } /></Show>
    <Show when={desktopShell && desktopTitleBar() === "conduit"}>
      <TitleBar
        lead={<>
          <Show when={titleBarShows("server")}><ServerSwitcher inline connectivity={runtime.connectivity()} pwaUpdating={pwaUpdating()} onOpenSettings={openSettings} onUpdatePwa={() => void runPwaUpdate()}
            onAddServer={() => setAddingServer(true)} onLogout={() => void logout()} /></Show>
          <Show when={titleBarShows("update") && (updateState().kind === "ready" || (interfaceReady() && updateState().kind === "idle"))}>
            <Button variant="secondary" size="sm" title={updateState().kind === "ready" ? "A new version of Conduit is ready: restart into it" : "A new interface is ready: reload into it"}
              onClick={() => void (updateState().kind === "ready" ? takePwaUpdate(true) : takeStagedInterface())}><Icons.Download />Update</Button>
          </Show>
          <Show when={titleBarShows("update") && (updateState().kind === "current" || updateState().kind === "updated")}>
            <Button variant="ghost" size="sm" disabled><Icons.Check />{updateState().kind === "updated" ? "Conduit updated" : "Up to date"}</Button>
          </Show>
          <Show when={titleBarShows("update") && (() => { const state = updateState(); return state.kind === "checking" || state.kind === "working" ? state : null; })()}>{(state) => {
            const words = () => {
              const current = state();
              if (current.kind !== "working") return "Checking for updates…";
              const share = current.label.match(/(\d+)\s*%/);
              return current.label.startsWith("Downloading") ? `Downloading…${share ? ` ${share[1]}%` : ""}` : current.label;
            };
            return <>
              <Button variant="ghost" size="sm" disabled title={state().kind === "working" ? (state() as { label: string }).label : "Checking for updates"}><Spinner />{words()}</Button>
              <Show when={(() => { const current = state(); return current.kind === "working" ? current.onCancel : undefined; })()}>{(cancel) =>
                <Button variant="ghost" size="sm" onClick={() => cancel()()}>Cancel</Button>}</Show>
            </>;
          }}</Show>
          <Show when={titleBarShows("history")}>
            <IconButton kind="pane" label="Back" onClick={() => history.back()}><Icons.Back /></IconButton>
            <IconButton kind="pane" label="Forward" onClick={() => history.forward()}><Icons.Forward /></IconButton>
          </Show>
        </>}
        middle={<Show when={titleBarShows("search")}><LeadInput kind="web" readOnly aria-label="Search or run a command" placeholder="Search or run a command"
          onFocus={(event) => { event.currentTarget.blur(); openPalette(null); }} /></Show>}
        end={<>
          <Show when={titleBarShows("live") && liveChats().length}>
            <DropdownMenu modal={false} placement="bottom-end">
              <MenuControl as={Button} variant="ghost" size="sm" title="Live chats: a harness held for each until it is reclaimed">
                <StatusDot label={runningTurns().length ? "Running" : "Live"} tone={runningTurns().length ? "active" : "success"} spinning={runningTurns().length > 0} />
                {liveChats().length} live<Show when={runningTurns().length}>{(count) => <> · {count()} running</>}</Show>
              </MenuControl>
              <MenuContent>
                <MenuSection title="Live chats">
                  <For each={[...liveChats()].sort((a, b) => Number(generating(b)) - Number(generating(a)))}>{(process) =>
                    <MenuRow icon={<RuntimeIndicator process={process} />} onSelect={() => void openRunning(process.chatId)}>{runningName(process.chatId)}</MenuRow>}</For>
                </MenuSection>
              </MenuContent>
            </DropdownMenu>
          </Show>
          <Show when={titleBarShows("agent") && agentView()?.enabled && agentNeeds()}>{(needs) =>
            <Button variant="ghost" size="sm" title={`${agentName()} wants you`} onClick={() => void openAgentHere()}>{agentName()} · {needs()}</Button>}</Show>
          <Show when={titleBarShows("panels")}>
            <IconButton kind="pane" label="Sidebar" onClick={() => runSidebar("toggle-sidebar")}><Icons.Sidebar /></IconButton>
            <IconButton kind="pane" label="Dock" onClick={() => togglePanel()}><Icons.Workspace /></IconButton>
          </Show>
          <Show when={titleBarShows("layout") && splitShown()}><IconButton kind="pane" label="Equalise panes" onClick={() => applyPaneLayout(Array(shownSlots().length + 1).fill(1))}><Icons.Split /></IconButton></Show>
          {windowControls("bar")}
        </>} />
    </Show>
    <AppShell class="workspace-layout" settling={panesSettling()} drawer={mobileSidebarOpen() ? "open" : "shut"} ref={(element) => { meteors.observe(element); const observer = new ResizeObserver(() => setLayoutWidth(element.clientWidth)); observer.observe(element); onCleanup(() => observer.disconnect()); }}>
    <Sheet as="main" lead under={workspaceExpanded()} pane={paneLetter("main")} data-moving={paneMotion()?.slot === "main" ? paneMotion()!.phase : undefined} backdrop={<Show when={!paneADocument() && routeBootstrap() === "ready" && ["chat", "dashboard", "project", "agent", "jbot"].includes(routeKind()) && meteorField() && (revealing() || arrived())}><meteors.Window /></Show>} data-slot="sidebar-inset" data-region={paneADocument() ? "workspace-panel" : routeKind() === "chat" || harnessThread() ? "chat" : routeKind() === "terminal" ? "terminal" : "dashboard"} tabIndex={-1} onPointerDown={focusChatSurface} onKeyDown={paneKeydown} class="chat-main" style={{ ...(splitShown() ? { flex: `${paneWeights()[0]} 1 0`, "min-width": paneMotion()?.slot === "main" ? "0px" : `${paneMinWidth("main")}px` } : {}), ...(paneMotion()?.slot === "main" ? { opacity: 0, ...(paneMotion()!.width ? { "--pane-document-width": `${paneMotion()!.width}px` } : {}) } : {}), ...(paneMotion()?.slot === "main" && paneMotion()!.collapsed ? { "margin-left": "0px", "margin-right": "0px" } : {}) }} {...mainDropHandlers}>
      <Show when={parseFileView(paneADocument())}>{renderFileViewer("main")}</Show>
      <Show when={paneADocument()?.startsWith("term:") ? paneADocument()!.slice("term:".length) : undefined} keyed>{(shell) => renderTerminalDocument("main", shell)}</Show>
      <Show when={paneADocument()?.startsWith("browser:") ? paneADocument()!.slice("browser:".length) : undefined} keyed>{(id) => renderBrowserDocument("main", id)}</Show>
      <Show when={paneADocument()?.startsWith("mail:") ? paneADocument()!.slice("mail:".length) : undefined} keyed>{(account) => renderMailDocument("main", account)}</Show>
      <For each={artifactsIn("main")}>{(id) => renderArtifactDocument("main", id)}</For>
      <Show when={paneADocument() === "home"}><SheetFill tabIndex={-1} onPointerDown={focusChatSurface}>{renderHome("main")}</SheetFill></Show>
      <Show when={paneADocument()?.startsWith("folder:") ? paneADocument()!.slice("folder:".length) : undefined} keyed>{(project) => renderFolderViewer("main", project)}</Show>
      <Show when={!paneADocument() && routeBootstrap() === "ready"} fallback={paneADocument() ? null : <Empty role={routeBootstrap() === "error" ? "alert" : "status"}>{routeBootstrap() === "error"
        ? routeBootstrapError() || (routeKind() === "project" ? "This project could not be loaded." : "This chat could not be loaded.")
        : routeKind() === "project" ? "Loading project…" : routeKind() === "dashboard" ? "Loading Conduit…" : (routeKind() === "agent" || routeKind() === "jbot") ? "Loading…" : "Loading chat…"}</Empty>}>
        <Show when={routeKind() === "dashboard"}>
          <AppDashboardPage session={session} place={chatPlace()} tabActions={paneTabActions("main")} tabs={documentTab("main")} keyboardOwner={() => !sideHasKeyboard()} onOpenChat={(target, project) => void openChatFromPage(target, project)}
            onSendDraft={async (prompt) => {
              const project = chatOwner() || catalogue.projects().find((item) => item.slug === "chat");
              const id = chat.loadedId();
              if (!project || !id) return;
              // The server flips the status on the prompt itself, so the row goes in active: as a draft it hides
              // behind the New chat row until the first turn checkpoints.
              catalogue.setProjects((current) => current.map((item) => item.id === project.id
                ? { ...item, sessions: [{ id, projectId: project.id, status: "active", title: chat.title() || "New chat", templateId: chat.templateId() || undefined }, ...item.sessions.filter((session) => session.id !== id)] }
                : item));
              history.pushState({}, "", chatPath(id));
              chat.setDraft(prompt);
              await sendFromDashboard();
            }} />
        </Show>
        <Show when={routeKind() === "agent"}>{renderAgent("main")}</Show>
        <Show when={routeKind() === "jbot"}>{renderJbot("main")}</Show>
        <Show when={routeKind() === "computer"}>
          <Show when={harnessThread()} fallback={<Show when={computerHarness()} fallback={<Show when={computerEnvironment()} fallback={<>
            <ChatHeader title={activeServer()?.name || "Hub"} tabActions={paneTabActions("main")} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} appDashboard alone />
            <ComputerDashboard projects={catalogue.projects()} location={computerLocation()} loading={computerLoading()} error={computerError()} onOpenHarnessHere={openComputerHarnessHere} onOpenHarness={(id) => void openHarnessHere(id)} onBrowse={(path) => void browseComputer(path)} onPrefetch={prefetchComputerFolder} onMakeWorkspace={() => void designateComputerWorkspace()} onCreateWorkspace={(path) => void createComputerWorkspace(path)} onOpenWorkspace={(project) => void openProject(project)} onManageWorkspace={(action, project) => { if (action === "rename") runSidebar("rename-folder", { project }); else if (action === "identity") openWorkspaceIdentity(project); else runSidebar("delete-project", { project }); }} onStartWorkspaceAction={(action, path) => runSidebar(action === "created" ? "new-workspace-created" : "new-workspace-cloned", { path })} onOpenView={openWorkspaceView} onOpenTerminalView={() => openTerminalRoute()} onOpenTerminalHere={() => void openComputerTerminalHere()} onOpenFile={async (path) => { setComputerFile({ path }); await openWorkspaceView("files"); }} />
          </>}>{(nodeId) => renderEnvironment(nodeId(), "main")}</Show>}>{(harnessId) => <>
            <ChatHeader title={harnessLabelFor(harnessId()) || harnessId()} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} appDashboard alone />
            <HarnessDashboard harnessId={harnessId()} projects={catalogue.projects()} runtime={runtime} scope={harnessScope()} onScope={scopeHarness} home={computerLocation()?.home || ""}
              composer={(input) => <HarnessDraftComposer harnessId={harnessId} session={session} input={input} draft={harnessDraft} serviceLevels modelSelectorShortcut />}
              onStartThread={(launch) => harnessDraft.send(launch.harnessId, launch.cwd, launch, launch.prompt)} onOpenThread={(thread) => void openHarnessThread(thread)} onOpenChat={(target, project) => void openChat(target, project)} />
          </>}</Show>}>{(thread) => {
            const workspace = () => catalogue.projects().find((project) => !isConduitManagedProject(project) && project.workingRoot === thread().path);
            const label = () => harnessLabelFor(thread().harnessId) || thread().harnessId;
            return <>
              <Show when={dropActive()}><DropOverlay>Drop files to attach</DropOverlay></Show>
              <ChatHeader project={workspace()} placeLabel={label()} onOpenPlace={() => openComputerHarness(thread().harnessId, "push", thread().path)} title={chat.title() || thread().title || "Untitled thread"} badge={<OutsideThreadChip harness={label()} folder={thread().path} workspace={Boolean(workspace())} busy={trackingThread()} onTrack={() => void trackHarnessThread()} />} profile={activeProfile()} runtime={chat.runtimeIdentity()} live={chat.live() as unknown as Record<string, unknown>} chat={chat} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => openComputerHarness(thread().harnessId, "push", thread().path)} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => void shareHarnessThread()} />
              <Conversation chat={chat} busy={openingLiveChat()} empty={routeKind() === "chat" && emptyLayout()} sending={routeKind() === "chat" && emptyChat() && !emptyLayout()} opening={routeKind() === "chat" && withheldLiveChat()} stackRef={(element) => { chatComposerStack = element; }}
                transcript={<Transcript chat={chat} supports={chatCapability} agentThread={agentThread(chat.loadedId())} profileLabel={label()} projectId={catalogue.projectId()} approvals={approvalsFor(chat.loadedId())} />}
                composer={<Composer shortcuts={shortcutManager} chat={chat} supports={chatCapability} attachments={attachments} attachmentsSupported={chatCapability("attachments", true)} models={models} permissions={chatCapability("permissionModes") ? permissions : undefined} serviceLevels={chatManifest()?.serviceLevels?.length ? serviceLevels : undefined} profiles={profiles()} activeProfile={activeProfile()} onOpenModelSelector={openModelSelector} modelSelectorShortcut={shortcutManager.formatEffectiveBinding(COMMAND_IDS.openModelSelector)} serverOnline={serverReachable()} voiceSettings={voiceSettings()} onChooseProfile={() => {}} onOpenSettings={openSettings} onOpenAttachments={session.openAttachments} />} />
            </>;
          }}</Show>
        </Show>
        <Show when={routeKind() !== "dashboard" && routeKind() !== "computer" && routeKind() !== "agent" && routeKind() !== "jbot"}>
        <Show when={routeKind() === "project" && selectedProject()} fallback={<>
          <Show when={dropActive()}><DropOverlay>Drop files to attach</DropOverlay></Show>
          <ChatSurface session={session} opening={withheldLiveChat()} empty={routeKind() === "chat" && emptyLayout()} sending={routeKind() === "chat" && emptyChat() && !emptyLayout()} project={selectedProject()} tabActions={paneTabActions("main")} modes={threadModes("main")} {...paneTabRow("main")} keyboardOwner={() => !sideHasKeyboard()} place={chatPlace()} modelSelector stackRef={(element) => { chatComposerStack = element; }}
            onShare={() => void shareChat()} onRename={() => runSidebar("rename-chat")} onDelete={() => runSidebar("delete-chat")}
            notice={workspaceNotice(selectedProject(), catalogue.selectedId())} />
        </>}>
          <ProjectPage session={session} project={selectedProject()!} tabActions={paneTabActions("main")} tabs={documentTab("main")} keyboardOwner={() => !sideHasKeyboard()} onOpenChat={(target, project) => openChatFromPage(target, project)}
            onSendDraft={async (prompt) => {
              const project = selectedProject();
              const id = chat.loadedId();
              if (!project || !id) return;
              // The server flips the status on the prompt itself, so the row goes in active: as a draft it hides
              // behind the New chat row until the first turn checkpoints.
              catalogue.setProjects((current) => current.map((item) => item.id === project.id
                ? { ...item, sessions: [{ id, projectId: project.id, status: "active", title: chat.title() || "New chat", templateId: chat.templateId() || undefined }, ...item.sessions.filter((session) => session.id !== id)] }
                : item));
              history.pushState({}, "", chatPath(id));
              chat.setDraft(prompt);
              await sendFromDashboard();
            }} />
        </Show>
        </Show>
      </Show>
    </Sheet>
    <For each={renderSlots()}>{(slot, position) => renderSlot(slot, position, false)}</For>
    {/* Docked panes stay mounted, so each keeps its state and tabs; the dock shows one. */}
    <Show when={dockDocHost()} keyed>{(host) =>
      <For each={dockContents()}>{(slot) => <Portal mount={host}>{renderSlot(slot, () => 0, true)}</Portal>}</For>}</Show>
    <Show when={routeKind() === "computer" && computerLocation()}><WorkspacePanel jbotView={() => renderJbot("tool")} connectivity={runtime.connectivity} projectId={() => computerLocation()!.project.id} projectName={() => computerLocation()!.project.name} sourceControlEnabled={() => computerLocation()!.repository} workingRoot={() => computerLocation()!.project.workingRoot} chatId={() => "computer"} settingsScope={() => "computer"} initialDirectory={() => computerLocation()!.listing} requestedFile={computerFile} open={panelOpen} expanded={workspaceExpanded} focusRequest={workspaceFocusRequest} onFocusRequestComplete={acknowledgeWorkspaceFocus} requestedTab={workspaceViewRequest} onTabChange={setDockTool} documentShown={() => dockSlot() !== null} widthRequest={dockWidthRequest} documentHost={(element) => setDockDocHost((current) => element ?? (current?.isConnected ? current : undefined))} minWidth={dockMinWidth} overlay={dockOverlay} onMoveToRow={isMobileLayout() ? undefined : moveToRow} onOpenFile={canOpenFilePanes() ? (entry, options) => void openFileDocument(entry, { ...options, tab: Boolean(verbNow().tab) }) : undefined} openFiles={openFileKeys} onToggleExpanded={toggleWorkspaceExpanded} onClose={() => void dismissSummon()} shortcuts={shortcutManager} onBrowseDirectory={(path) => void browseComputer(`${computerLocation()!.project.workingRoot}/${path}`)} onBrowseParent={() => void browseComputer(computerLocation()!.parent)} /></Show>
    <Show when={["chat", "project", "dashboard", "agent", "jbot"].includes(routeKind()) && Boolean(dockHome()) && Boolean(workspacePanelScope())}><WorkspacePanel connectivity={runtime.connectivity} projectId={() => dockProject()!.id} projectName={() => dockProject()!.name} sourceControlEnabled={() => dockProject()!.kind === "workspace"} workingRoot={() => dockProject()!.workingRoot} chatId={() => dockScope()!} artifactChatId={() => sideFocused() ? focusedChat().loadedId() : routeKind() === "chat" ? chat.loadedId() : null} commentChatId={() => focusedChat().loadedId()} historyAvailable={() => sideFocused() ? focusedSession().history() !== "none" : routeKind() !== "chat" || chatHistory() !== "none"} open={panelOpen} expanded={workspaceExpanded} focusRequest={workspaceFocusRequest} onFocusRequestComplete={acknowledgeWorkspaceFocus} requestedTab={workspaceViewRequest} onTabChange={setDockTool} documentShown={() => dockSlot() !== null} widthRequest={dockWidthRequest} documentHost={(element) => setDockDocHost((current) => element ?? (current?.isConnected ? current : undefined))} minWidth={dockMinWidth} overlay={dockOverlay} onMoveToRow={isMobileLayout() ? undefined : moveToRow} onOpenFile={canOpenFilePanes() ? (entry, options) => void openFileDocument(entry, { ...options, tab: Boolean(verbNow().tab) }) : undefined} openFiles={openFileKeys} onRequestOpen={() => setPanelOpenForChat(true)} onToggleExpanded={toggleWorkspaceExpanded} onClose={() => void dismissSummon()} shortcuts={shortcutManager}
      jbotView={() => renderJbot("tool")}
 /></Show>
    </AppShell>
    <Show when={dragHintContent()}>{(hint) => <DragPill ref={(element) => { dragHintElement = element; placeDragHint(); onCleanup(() => { if (dragHintElement === element) dragHintElement = undefined; }); }}
      icon={<Show when={hint().icon} keyed>{(icon) => ({ left: <Icons.Sidebar />, right: <Icons.Workspace />, tab: <PanelTopIcon />, swap: <Icons.Swap />, here: <PanelTopIcon /> })[icon]}</Show>}>{hint().text}</DragPill>}</Show>
    <Show when={docDrop() && ["left", "middle", "right", "dock"].includes(docDrop()!.zone) ? docDrop() : null}>{(drop) => <DropWash style={{ left: `${drop().rect.left}px`, top: `${drop().rect.top}px`, width: `${drop().rect.width}px`, height: `${drop().rect.height}px` }} />}</Show>
    <WorkspaceRail windowControls={desktopShell && desktopTitleBar() === "none" ? windowControls("rail") : undefined} onOpenBrowser={openBrowser} onOpenMail={openMail} tools={Boolean(routeKind() === "computer" ? computerLocation() : ["chat", "project", "dashboard", "agent", "jbot"].includes(routeKind()) && dockHome() && workspacePanelScope())} onOpenSearch={toggleSearchPalette} onOpenPalette={() => openPalette(null)}
      panes={splitShown() ? shownSlots().length + 1 : 1} onLayout={applyPaneLayout}
      docked={dockContents().filter((slot) => slotView(slot)).map((slot) => ({ slot, view: slotView(slot)!, name: dockedSlot() === slot ? viewName(slotView(slot)) : `${viewName(slotView(slot))} (no room; returns when there is)` }))} currentDocked={panelOpen() ? dockSlot() : null} onChooseDocked={chooseDocked} dockOverlay={dockOverlay()} onToggleDockOverlay={toggleDockOverlay}
      jbot={agentView()?.enabled ? { name: agentName(), needs: agentNeeds(), current: jbotShownInDock(),
        onOpen: () => { if (agentNeeds() && !jbotShownInDock()) wantNeeds(); void chooseRailTool("jbot", false); } } : undefined}
      feedback={devClient() ? { open: feedbackMode() !== null, onToggle: () => setFeedbackMode(feedbackMode() ? null : "select") } : undefined}
      current={panelOpen() && dockSlot() === null ? dockTool() : null} onChoose={(tool) => void chooseRailTool(tool, Boolean(verbNow().beside))} />
    </Show>
    <Show when={routeKind() === "terminal" && routeBootstrap() === "ready"}>
      <TerminalRoute terminalId={terminalRouteId()} connectivity={runtime.connectivity} onOpenConduit={leaveTerminalRoute} />
    </Show>
    <CommandMenu open={paletteOpen()} onOpenChange={setPaletteOpen} onPageChange={setPalettePage} initialPage={palettePage()} initialQuery={paletteInitialQuery()} launchNonce={paletteNonce()} directLaunch={paletteDirectLaunch()}
      context={paletteContext()} runtime={runtime} actions={paletteActions} onChooseModel={(spec) => void focusedModels().chooseModel(spec)} currentModel={focusedModels().model()} scopeModels={focusedModels().allModels()} enabledModelSpecs={focusedModels().enabledModels()} onToggleModelScope={(spec) => { const models = focusedModels(); const enabled = models.enabledModels(); void models.saveScope(enabled.includes(spec) ? enabled.filter((item) => item !== spec) : [...enabled, spec]); }} shortcuts={shortcutManager} />
    <LeaderPalette shortcuts={shortcutManager} />
    <KeyboardTour shortcuts={shortcutManager} env={tourEnv} />
    <Show when={settingsLoaded()}>
      <Settings open={settingsOpen()} initialSection={settingsSection()} sectionWasNamed={settingsNamedSection()} initialWorkspaceId={settingsWorkspaceId()} onOpenChange={setSettingsOpen} models={models} templates={templates()} templatesLoading={templatesLoading()} defaultTemplateId={defaultTemplateId()} projects={catalogue.projects()} onDefaultTemplateChange={saveDefaultTemplate} onWorkspaceDefaultChange={saveWorkspaceDefault} meteorField={meteorField()} onMeteorFieldChange={switchMeteorField} voiceSettings={voiceSettings()} onVoiceSettingsSave={updateVoiceSettings} sidebarChatLimit={sidebarChatLimit()} onSidebarChatLimitChange={switchSidebarChatLimit} onOpenModelSelector={openModelSelector} onAddWorkspace={addProject} onOpenDeviceTerminal={(node) => void openDeviceTerminal(node)} onOpenDeviceBrowser={(nodeId) => { setSettingsOpen(false); void openBeside(`browser:${nodeId}`, true); }} onOpenWorkspace={(project) => { setSettingsOpen(false); void openProjectHere(project); }} shortcuts={shortcutManager} />
    </Show>
  </>;
}

// Before anything is dialled: a pin that arrives after the connection it was for is no pin at all.
void publishTrustedIdentities(trustedIdentities());

const mount = document.getElementById("root")!;
// A chunk that cannot be fetched means the server restarted under the page (the old file names are gone) or is down:
// shown without its styles the page is broken, so wait for the server and reload into the build it now serves.
const CHUNK_RELOAD_RETRY_MS = 1000;
let reloadingForChunk = false;
window.addEventListener("vite:preloadError", (event) => {
  event.preventDefault();
  if (reloadingForChunk) return;
  reloadingForChunk = true;
  const tryReload = () => void fetch("/healthz", { cache: "no-store" })
    .then((response) => { if (response.ok) location.reload(); else setTimeout(tryReload, CHUNK_RELOAD_RETRY_MS); })
    .catch(() => setTimeout(tryReload, CHUNK_RELOAD_RETRY_MS));
  tryReload();
});

void startLiveUpdate(liveUpdateOrigin).catch(() => {});
void startPush().catch(() => {});
void keepThisComputerConnected().catch(() => {});

breatheCarets();
render(() => <ErrorBoundary fallback={(error) => { dismissLaunchMark(); return <ConnectionRecovery title="Conduit hit a UI error" error={error instanceof Error ? error.message : "Unknown interface error"} onRetry={() => location.reload()} retryLabel="Reload Conduit" />; }}>
  {nativeApp ? <NativeRoot /> : <App />}
</ErrorBoundary>, mount);
