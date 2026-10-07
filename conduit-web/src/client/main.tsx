/// <reference types="vite-plugin-pwa/client" />
import "./motion-rules";
import { focusSplitSection, splitSections } from "./dashboard/primitives/split-cursor";
import { isConduitManagedProject } from "./navigation/sidebar-preferences";
import type { ComputerLocation, ComputerPrefetchPayload } from "./api/contracts";
import { batch, createEffect, createMemo, createRenderEffect, createSignal, ErrorBoundary, For, lazy, on, onCleanup, onMount, Show, untrack, type JSX } from "solid-js";
import { Portal, render } from "solid-js/web";
import { androidShell, desktopShell, isInstalledClient } from "./platform/installed-client.ts";
// The clients that stage a downloaded update and install it on request.
const updateShell = desktopShell ?? androidShell;
import {
  ArrowLeftRightIcon, Columns2Icon, PanelTopIcon, EllipsisIcon, MessageSquarePlusIcon, PanelLeftIcon, PanelRightIcon, PencilIcon, RefreshCwIcon, SearchIcon, ServerIcon, QrCodeIcon, MonitorIcon, ShareIcon, TerminalIcon, Trash2Icon, TriangleAlertIcon, XIcon,
  ChevronRightIcon,
} from "lucide-solid";
import { Toaster, toast } from "solid-sonner";
import "solid-sonner/styles.css";
import { DefaultMeteorShower } from "@jask-aran/solid-components/meteor-shower";
import "@jask-aran/solid-components/meteor-shower.css";
import { phoneLayerOpen } from "@/components/phone-overlays";
import { Button, Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Spinner } from "@/components/primitives";
import { ContextBar, ContextBreakdown } from "./chat/context-gauge";
import { contextUsagePercent } from "./chat/context-metrics";
import { api, apiWhenServed, asList, pathChatId, pathProjectId, projectMatchesPath, projectPath } from "./api/client";
import { buildHttpUrl, loginUrl, logoutUrl, normalizeServerOrigin, transcriptUrl } from "./api/transport";
import { startPathSelection } from "./platform/path-selector";
import { canDiscoverServers, discoverServers, type FoundServer } from "./platform/discovery";
import { proveServer } from "./platform/server-proof";
import { activeOrigin, addServer, forgetServer, learnIdentity, mergeServerDirectory, scopeOf, servers, trustedIdentities, setActiveServer, switchToServer } from "./platform/servers";
import { publishTrustedIdentities } from "./platform/certificate-pins.ts";
import { publishServerDirectory } from "./platform/server-directory";
import { canScanQr, parsePairingLink, QrScanner, redeemPairing, type PairingLink } from "./platform/pairing";
import { authorizedFetch, clearNativeBearerToken, nativeBearerToken, NATIVE_AUTH_REQUIRED_EVENT, saveNativeBearerToken } from "./api/native-auth-client";
import { resolveCapability } from "./chat-capabilities";
import type { ChatSummary, DashboardChat, HarnessManifestView, Installation, Project, RuntimeIdentity, Template, TranscriptDetail, WorkspaceAppearance, WorkspacePolicy, WorkspaceSuggestion, WorkspaceSuggestionsPayload } from "./api/contracts";
import { createErrorDiagnostic, formatRuntimeDiagnosticPrompt, type ErrorDiagnostic, type ErrorDiagnosticContext } from "./error-diagnostics";
import { Composer, SPINNING_ACTIVITY, type ComposerStatus } from "./chat/composer";
import { AppDashboard } from "./dashboard/app-dashboard";
import { COMPOSER_SURFACE_CHANGE_EVENT, COMPOSER_SURFACE_STORAGE_KEY, selectedComposerSurface } from "./chat/composer-surface";
import { applyTabFrost } from "./preferences/tab-frost";
import { applyStreamFade } from "./preferences/stream-fade";
import { installFocusShown } from "./preferences/focus-shown";
import type { VoiceDictationSettings } from "./chat/voice-dictation-types";
import { HostUiRequests } from "./chat/host-ui-card";
import { isWorkspace } from "./chat/place-picker";
import {
  MARKDOWN_RENDERER_STORAGE_KEY,
  saveMarkdownRenderer,
  selectedMarkdownRenderer,
  type MarkdownRendererId,
} from "./chat/markdown-settings";
import { loadVoiceDictationSettings, saveVoiceDictationSettings, VOICE_DICTATION_STORAGE_KEY } from "./chat/voice-dictation";
import { Transcript } from "./chat/transcript";
import { isChatContentActivity } from "./chat/transcript-source";
import { COMMAND_IDS, commandRegistry, getCommandDefinition, LEADER_STROKE } from "./commands/command-registry";
import { CommandMenu } from "./navigation/command-menu";
import { LeaderPalette } from "./navigation/leader-palette";
import { isLeaderMenuMode, LEADER_MENU_STORAGE_KEY, selectedLeaderMenu, setLeaderMenu } from "./shortcuts/leader-menu";
import type { PaletteActions, PaletteContext } from "./palette/command-registry";
import { bindVisualViewportShell, focusFirst, isMobileLayout, MOBILE_LAYOUT_QUERY, setMobileOverlayKind } from "./navigation/mobile-layout";
import { toggleKeyboardProbe } from "./navigation/keyboard-probe.ts";
import { mobileSwipeAction } from "./navigation/mobile-swipe";
import { bindOverlayScrollbars } from "./navigation/overlay-scrollbars";
import { FrostDialog } from "@/components/frost";
import { Sidebar, type SidebarCommand } from "./navigation/sidebar";
import { clampSidebarChatLimit, selectedSidebarChatLimit, SIDEBAR_CHAT_LIMIT_STORAGE_KEY } from "./navigation/sidebar-preferences";
import { CHAT_SORT_STORAGE_KEY, selectedChatSort, useChatSort } from "./preferences/chat-sort";
import { WorkspaceAppearanceEditor } from "./project/workspace-appearance-editor";
import { applyPwaUpdate, checkForPwaUpdate, claimPwaUpdateArrival, forcePwaUpdate, pwaUpdateWaiting, resetPwaAppCache, startPwaUpdates } from "./pwa-update";
import type { ActiveChatStore } from "./state/active-chat";
import { createChatSession, type ChatSession } from "./state/chat-session";
import { DEFAULT_MAX_ATTACHMENT_BYTES, filesFromDataTransfer } from "./state/attachments";
import { createDrafts } from "./state/drafts";
import { clearCachedCatalogue, readCachedCatalogue, writeCachedCatalogue } from "./state/catalogue-cache";
import { createCatalogueStore } from "./state/catalogue";
import { markChatRead } from "./state/read-receipts";
import { createSideChat, type SideChat } from "./state/side-chat";
import { createRuntimeStore } from "./state/runtime";
import { VoiceWaveform } from "./chat/voice-waveform";
import { browserShortcutEnvironmentProvider } from "./shortcuts/shortcut-environment";
import { ShortcutManager } from "./shortcuts/shortcut-manager";
import { isShortcutRegion } from "./shortcuts/shortcut-types";
import { acknowledgeRegion } from "./shortcuts/region-cue";
import { globalShortcuts } from "./shortcuts/global-shortcuts";
import { EMPTY_FILE_VIEW, fileEntryKey, formatFileView, parseFileView, sameFileEntry, type FileEntry } from "./workspace/file-documents";
import { dropWash, dropZoneAt, fileTabParam, fileTabsFromParams, moveKey, nextShownTab, reconcileSide, swapRecordKeys, withoutTab, type FileTabs } from "./workspace/file-tabs";
import type { ReviewNavigationRequest } from "./chat/review-navigation";
import type { FileSlotHandle, FileSummary } from "./workspace/workspace-file-slot";
import { dropScope, migrateWorkspacePanelStorage, readSetting, WORKSPACE_PANEL_GLOBAL_SCOPE, writeSetting } from "./workspace/workspace-panel-storage";
import { readToolDrag, TOOL_DRAG_TYPE, WORKSPACE_TOOL_LABELS, WorkspaceRail } from "./workspace/workspace-rail";
import { isPanelTab, isSplitView, type SplitView } from "./workspace/workspace-types";
import { MIN_MAIN_PANE_WIDTH, MIN_SPLIT_PANE_WIDTH } from "./layout-geometry";
import { dispatchPanelGeometryMotion } from "./panel-motion";
import { publishUiPreference, queueUiPreferenceSave, uiPreferenceSaves, UI_PREFERENCE_CHANGE_EVENT, type UiPreferenceKey, type UiPreferences } from "./preferences/ui-preferences";
import { applyUiScale, selectedUiScale } from "./preferences/ui-scale";
import { INCREMARK_PACING_STORAGE_KEY } from "./chat/incremark-pacing";
import { harnessLabelFor, HarnessMark } from "./harness-brand";
import { NO_ATTACHMENTS } from "./chat/composer-attachments";
import { OutsideThreadChip } from "./chat/outside-thread-chip";
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
import "./project/dashboard.css";
import "./chat/composer-geometry.css";
import "./styles.css";

const DESKTOP_UPDATE_ROUTE_KEY = "conduit:desktop-update-route";
if (desktopShell) {
  const route = localStorage.getItem(DESKTOP_UPDATE_ROUTE_KEY);
  if (route?.startsWith("/") && !route.startsWith("//")) history.replaceState({}, "", route);
  localStorage.removeItem(DESKTOP_UPDATE_ROUTE_KEY);
}

const nativeApp = isInstalledClient();
applyUiScale(selectedUiScale(), true);
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

type SettingsSection = "ui" | "shortcuts" | "models" | "prompts" | "runtime" | "servers" | "workspaces" | "voice" | "search";
/**
 * Idle says nothing and shows nothing. "ready" is a build installed and
 * waiting for a quiet moment, which is a state that can last minutes and has
 * to survive being ignored. "working" carries its own words because the three
 * clients have different ones -- a download percentage, an APK handed to the
 * system installer, a worker taking over.
 */
export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "updated" }
  | { kind: "ready" }
  | { kind: "working"; label: string };
type WorkspaceView = "files" | "diff" | "chat" | "terminal";
const METEOR_FIELD_STORAGE_KEY = "conduit:meteor-field";
const selectedMeteorField = () => localStorage.getItem(METEOR_FIELD_STORAGE_KEY) !== "false";
const WorkspacePanel = lazy(() => import("./workspace/workspace-panel"));
const FileViewer = lazy(() => import("./workspace/workspace-file-viewer"));
const FileTypeIcon = lazy(() => import("./workspace/file-type-icon").then((module) => ({ default: module.FileTypeIcon })));
const ComputerDashboard = lazy(() => import("./dashboard/computer-dashboard").then((module) => ({ default: module.ComputerDashboard })));
const ProjectDashboard = lazy(() => import("./project/dashboard"));
const HarnessDashboard = lazy(() => import("./dashboard/harness-dashboard"));
const TerminalPane = lazy(() => import("./remotes/terminal-pane").then((module) => ({ default: module.TerminalPane })));
const TerminalRoute = lazy(() => import("./remotes/terminal-route").then((module) => ({ default: module.TerminalRoute })));
const Settings = lazy(() => import("./settings/settings").then((module) => ({ default: module.Settings })));
const prefetchProjectDashboard = (project: Project) => void import("./project/dashboard").then((module) => module.prefetchProjectDashboard(project)).catch(() => {});
const prefetchWorkspaceTerminal = () => void import("./workspace/workspace-panel");

// The desktop client is often installed on the machine the server runs on, and
// that address is one nobody should have to type. It is offered only when the
// probe answers as Conduit, so the button never points at nothing.
const LOCAL_SERVER_ORIGIN = "http://127.0.0.1:4310";

/**
 * Address, then password. The two steps are separate because the first one is
 * the only chance to say "that is not a Conduit server" before asking for a
 * password, and because a browser can only ever do the first: it has no way to
 * reach another origin, so there it records an address and nothing more.
 *
 * Nothing is remembered until the server has actually answered. A half-added
 * entry that was never signed in to is a row that can only fail.
 */
function ServerConnectForm(props: { adding?: boolean; onDone: (origin: string) => void }) {
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

  const pair = async (link: PairingLink) => {
    setScanning(false);
    setError("");
    setAddress(link.origin);
    setSubmitting(true);
    try {
      const { token, origin } = await redeemPairing(link);
      addServer(origin);
      // Saved knowing who it is: the identity came from the paired device's
      // trusted setup, and the routes are the ones it offered.
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
    // A pasted pairing link pairs; the address it carries is the server.
    const link = !recordOnly && !verifiedOrigin() ? parsePairingLink(address()) : null;
    if (link) return void pair(link);
    setSubmitting(true);
    try {
      if (recordOnly) {
        const origin = normalizeServerOrigin(address());
        addServer(origin);
        props.onDone(origin);
        return;
      }
      if (!verifiedOrigin()) {
        const origin = normalizeServerOrigin(address());
        const response = await fetch(buildHttpUrl("/healthz", origin), { cache: "no-store" });
        const health = response.ok ? await response.json() as { ok?: boolean } : null;
        if (!response.ok || !health?.ok) throw new Error(`Server health check failed (${response.status}).`);
        setAddress(origin);
        setVerifiedOrigin(origin);
        return;
      }
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

  onMount(() => {
    if (verifiedOrigin() || servers().some((entry) => entry.origin === LOCAL_SERVER_ORIGIN)) return;
    // A browser cannot ask: Conduit answers a cross-origin request only for
    // the two shells it ships, so the probe would be refused rather than
    // answered. It offers the address anyway, as something to fill in rather
    // than something confirmed -- being wrong costs a row that says
    // Unreachable, and being silent costs the address nobody should have to
    // type.
    if (recordOnly) return setLocalServer(LOCAL_SERVER_ORIGIN);
    void fetch(buildHttpUrl("/healthz", LOCAL_SERVER_ORIGIN), { cache: "no-store" })
      .then((response) => response.ok ? response.json() as Promise<{ ok?: boolean }> : null)
      .then((health) => { if (health?.ok) setLocalServer(LOCAL_SERVER_ORIGIN); })
      .catch(() => { /* nothing is listening, so nothing is offered */ });
  });

  /*
   * What is on this network, asked once when the form opens.
   *
   * A server already held is not offered as though it were new, and that is
   * matched on identity rather than address: the same machine found at
   * 192.168.0.128 having been added by its tunnel name is a route this client
   * already has, not a server it is missing.
   */
  onMount(() => {
    if (!canDiscoverServers()) return;
    const heldOrigins = new Set(servers().map((entry) => entry.origin));
    const heldIds = new Set(servers().map((entry) => entry.id).filter(Boolean));
    // Rows arrive as servers resolve and keep their place: a server seen
    // again at another address updates its row rather than moving it.
    void discoverServers({
      onFound: (server) => {
        if (heldIds.has(server.id) || server.candidates.some((origin) => heldOrigins.has(origin))) return;
        setFound((list) => list.some((item) => item.id === server.id)
          ? list.map((item) => item.id === server.id ? server : item)
          : [...list, server]);
      },
    }).finally(() => setSearching(false));
  });

  /*
   * Take a found address as far as the password, and no further.
   *
   * Proved first, against the key that came with it. That is a weaker claim
   * than proving a server this client already knows -- both halves came from
   * the same advertisement -- but it is the one that matters here: it says the
   * thing answering at this address is the thing that published the record,
   * rather than a record pointing at somebody else's machine. Who the server
   * is, the person settles by signing in to it.
   */
  const chooseFound = async (server: FoundServer) => {
    setError("");
    setAddress(server.origin);
    // Every address it was found at, asked at once; the first that proves
    // itself is the one kept. An unreachable interface costs nothing then.
    const proofs = await Promise.all(server.candidates.map((origin) => proveServer(origin, server.id, server.publicKey)));
    const proved = server.candidates.find((_, index) => proofs[index]?.ok);
    if (proved) {
      setAddress(proved);
      return setVerifiedOrigin(proved);
    }
    const proof = proofs.find((item) => item.reason !== "unreachable") ?? { ok: false, reason: "unreachable" as const };
    if (proof.reason === "unreachable") return setError("That server did not answer. It may have gone since it was found.");
    if (proof.reason === "mismatch") return setError("That address did not prove it is the server that advertised it.");
    // Unverifiable: this client cannot check an Ed25519 signature at all. The
    // address is filled in rather than accepted, so it goes through the same
    // health check as one that was typed.
  };

  const useLocalServer = () => {
    const origin = localServer();
    if (!origin) return;
    setAddress(origin);
    setVerifiedOrigin(origin);
  };

  return <form class="native-server-card" onSubmit={submit}>
    <Show when={!props.adding}><HarnessMark id="conduit" class="native-server-mark" /><h1>Connect to your server</h1></Show>
    {/* One line, and in the dialog only when it says something the title
        and the fields do not (DESIGN.md: a dialog is the title and the choice). */}
    <Show when={verifiedOrigin() || recordOnly || !props.adding}>
      <p class="native-server-lede">{verifiedOrigin() ? "Server confirmed. Enter your Conduit password."
        : recordOnly ? "A browser opens another server in place of this one."
          : "HTTPS, unless the server is on this machine or this network."}</p>
    </Show>

    {/*
      * What is on this network, offered before the address field rather than
      * beside it: a server found is the answer to the question the field asks,
      * and the field is what is left when there is no answer.
      *
      * A browser is told plainly that this needs the app. There is no mDNS in
      * a page and an HTTPS document cannot reach a plaintext LAN address, so
      * the alternative is a search that spins forever over something that was
      * never going to work.
      */}
    <Show when={!verifiedOrigin() && ((!recordOnly && canScanQr()) || localServer())}>
      <ul class="native-server-found">
        <Show when={!recordOnly && canScanQr()}><li><button type="button" onClick={() => setScanning(true)} disabled={submitting()}><QrCodeIcon /><span>Scan QR code</span><code>conduit-server pair</code></button></li></Show>
        <Show when={localServer()}><li><button type="button" onClick={useLocalServer} disabled={submitting()}><MonitorIcon /><span>This computer</span><code>{localServer()!.replace(/^https?:\/\//, "")}</code></button></li></Show>
      </ul>
    </Show>
    <Show when={!verifiedOrigin()}>
      <Show when={canDiscoverServers()} fallback={<p class="native-server-hint">Finding servers on this network needs the Conduit app.</p>}>
        <p class="native-server-group">On this network<Show when={searching()}><Spinner class="native-server-searching" /></Show></p>
        <Show when={found().length} fallback={<Show when={!searching()}><p class="native-server-hint">Nothing here yet.</p></Show>}>
          <ul class="native-server-found">
            <For each={found()}>{(server) => <li>
              <button type="button" onClick={() => void chooseFound(server)} disabled={submitting()}>
                <ServerIcon />
                <span>{server.name}</span>
                <code>{server.origin.replace(/^https?:\/\//, "")}</code>
              </button>
            </li>}</For>
          </ul>
        </Show>
      </Show>
    </Show>
    <Show when={scanning()}><QrScanner onLink={(link) => void pair(link)} onClose={() => setScanning(false)} /></Show>
    <label for="native-server-address">Server address</label>
    <input id="native-server-address" type="text" inputMode="url" autocomplete="url" autocapitalize="none" spellcheck={false}
      placeholder={recordOnly ? "https://conduit.your-tailnet.ts.net" : "Address, or a link from conduit-server pair"} value={address()} onInput={(event) => setAddress(event.currentTarget.value)}
      disabled={submitting() || Boolean(verifiedOrigin())} />
    <Show when={verifiedOrigin()}>
      <label for="native-password">Password</label>
      <input id="native-password" type="password" autocomplete="current-password" value={password()}
        onInput={(event) => setPassword(event.currentTarget.value)} disabled={submitting()} autofocus />
    </Show>
    <Show when={error()}><p class="native-server-error" role="alert">{error()}</p></Show>
    <Button type="submit" disabled={submitting() || Boolean(verifiedOrigin() && !password())}>
      {submitting() ? (verifiedOrigin() ? "Signing in…" : "Checking…") : recordOnly ? "Remember server" : verifiedOrigin() ? "Sign in" : "Connect"}
    </Button>
    <Show when={verifiedOrigin() && !props.adding}><Button type="button" variant="ghost" onClick={() => {
      const previous = activeOrigin();
      void clearNativeBearerToken().finally(() => {
        if (previous) forgetServer(previous);
        setVerifiedOrigin(null);
        setAddress("");
        setPassword("");
        setError("");
      });
    }}>Change server</Button></Show>
  </form>;
}

function NativeServerSetup(props: { onAuthenticated: () => void }) {
  return <main class="native-server-setup">
    <ServerConnectForm onDone={(origin) => { setActiveServer(origin); props.onAuthenticated(); }} />
  </main>;
}

/**
 * Which server this client is on, and whether it can get in.
 *
 * Changing server remounts `App` rather than reloading the window. A reload
 * re-parses the whole bundle to arrive at the same place, and the assets are
 * on disk: nothing about the new server is in them. Disposing the tree runs
 * every `onCleanup` there is, which closes the streams, sockets and terminals
 * belonging to the server being left -- so this is a cold start in the only
 * sense that matters, minus the part that costs.
 *
 * Holding a token is taken as being signed in, without asking. The check cost
 * a round trip in front of a blank window -- a fifth of a second over a tunnel
 * -- to learn something the next request reveals anyway: every response goes
 * through `authorizedFetch`, and a 401 lands here as `NATIVE_AUTH_REQUIRED`.
 */
/** Take down index.html's launch screen, once whatever replaces it is drawn. */
const dismissLaunchMark = () => document.querySelector(".launch-mark")?.remove();

function NativeRoot() {
  const [state, setState] = createSignal<"loading" | "login" | "app">("loading");
  onMount(() => {
    const requireLogin = () => setState("login");
    window.addEventListener(NATIVE_AUTH_REQUIRED_EVENT, requireLogin);
    onCleanup(() => window.removeEventListener(NATIVE_AUTH_REQUIRED_EVENT, requireLogin));
  });
  createEffect(() => {
    const origin = activeOrigin();
    if (!origin) return setState("login");
    void nativeBearerToken(origin)
      .then((token) => setState(token ? "app" : "login"))
      .catch(() => setState("login"));
  });
  // Sign-in has no arrival to wait for; it fades in on its own.
  createEffect(() => { if (state() === "login") dismissLaunchMark(); });
  // The launch screen covers the wait for the token.
  return <Show when={state() !== "loading"}>
    <Show when={state() === "app" ? activeOrigin() ?? undefined : undefined} keyed fallback={<NativeServerSetup onAuthenticated={() => setState("app")} />}>
      {(_origin: string) => <App />}
    </Show>
  </Show>;
}

function ChatHeader(props: {
  project?: Project;
  title: string;
  profile?: Template | null;
  runtime?: RuntimeIdentity | null;
  live?: Record<string, unknown> | null;
  chat?: ActiveChatStore;
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
  /** Opens the place the page sits under, making its crumb a link. */
  onOpenPlace?: (project?: Project) => void;
  /** Names the crumb when the page sits under something other than a place: a harness, for its threads. */
  placeLabel?: string;
  /** Beside the breadcrumb: what the page is, when that needs saying. */
  badge?: JSX.Element;
  dashboard?: boolean;
  appDashboard?: boolean;
  /** The page is a place of its own (Computer): no crumb before its title. */
  alone?: boolean;
  /** Last in the actions: a chat beside the main one swaps or closes here. */
  actions?: JSX.Element;
  /** After the title: the pane's own swap and close, with two or more panes. */
  tabActions?: JSX.Element;
  /** A pane's chat tabs, when it has two or more (6c): they stand in for the
   *  breadcrumb, and the active tab's place moves to the right. */
  tabs?: JSX.Element;
}) {
  // What a project or workspace page calls itself in its own menu.
  const placeKind = () => props.project && isWorkspace(props.project) ? "workspace" : "project";
  const projectLabel = () => props.placeLabel || (props.appDashboard ? "Conduit" : props.project?.slug === "chat" ? "Chats" : props.project?.name || props.project?.slug || "Chats");
  const runtimeLabel = () => props.runtime ? harnessLabelFor(props.chat?.backendImplementation() || "conduit_pi") : null;
  const profileLabel = () => props.profile?.label || props.profile?.id;
  const posture = () => props.profile?.posture || props.profile?.tools?.join(" / ");
  const menuLine = () => [projectLabel(), runtimeLabel(), props.live?.binaryVersion || props.runtime?.binaryVersion ? `v${props.live?.binaryVersion || props.runtime?.binaryVersion}` : null, profileLabel(), posture()].filter(Boolean).join(" · ");
  const activity = () => props.chat?.activity();
  const sessionId = () => typeof props.live?.sessionId === "string" ? props.live.sessionId : "";
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
  return <>
    <header class="chat-header">
      <Show when={!props.mobileSidebarOpen}>
        <div class="mobile-header-leading">
          <Button variant="ghost" size="icon-sm" class="mobile-sidebar-trigger" data-mobile-open="false" aria-label="Toggle Sidebar" aria-expanded={false} onClick={props.onToggleMobileSidebar}><PanelLeftIcon /></Button>
          <Button variant="ghost" size="icon-sm" class="mobile-new-chat-trigger" aria-label="New chat" title="New chat" onClick={props.onNewChat}><MessageSquarePlusIcon /></Button>
        </div>
      </Show>
      {/* A project or workspace page is that place, named as the sidebar names it; a
          chat or the Conduit dashboard sits under its place. */}
      <Show when={props.tabs} fallback={<nav aria-label="breadcrumb" class="chat-header-title"><Show when={!props.dashboard && !props.alone}><Show when={props.onOpenPlace} fallback={<span class="chat-header-place">{projectLabel()}</span>}><button type="button" class="breadcrumb-link chat-header-place" tabIndex={-1} onClick={() => props.onOpenPlace!(props.project)}>{projectLabel()}</button></Show></Show><strong>{props.title}</strong></nav>}>
        <nav aria-label="Tabs" class="chat-header-title chat-header-tabs">{props.tabs}</nav>
      </Show>
      {props.badge}
      <Show when={!props.dashboard && props.chat}>
        <span class="chat-status-line" data-state={statusTone()} role="status" aria-label={`Runtime status: ${statusLabel()}`} aria-live="polite">
          <Show when={recording()} fallback={<span class="chat-status-label">{statusLabel()}</span>}>
            <VoiceWaveform class="chat-status-waveform" history={waveformHistory} level={waveformLevel} peak={waveformPeak} state={waveformState()} variant="compact" barDensity={3} ariaLabel="Microphone input level" />
          </Show>
        </span>
      </Show>
      <HeaderActions>
        <Button variant="ghost" size="icon-sm" class="search-trigger" tabIndex={-1} aria-label="Search chats" title="Search chats" onClick={props.onOpenSearch}><SearchIcon /></Button>
        <Button variant="ghost" size="icon-sm" class="palette-trigger" tabIndex={-1} aria-label="Open command palette" title="Command palette" onClick={props.onOpenPalette}><TerminalIcon /></Button>
        <Show when={!props.appDashboard}>
          <Button variant="ghost" size="icon-sm" class="chat-header-desktop-action" tabIndex={-1} aria-label={props.dashboard ? `Copy Tailscale ${placeKind()} link` : "Copy Tailscale chat link"} title={props.dashboard ? `Copy Tailscale ${placeKind()} link` : "Copy Tailscale chat link"} onClick={props.onShare}><ShareIcon /></Button>
        </Show>
        <Show when={!props.appDashboard}><Menu modal={false}>
          <MenuTrigger class="chat-header-more" tabIndex={-1} aria-label={props.dashboard ? `More ${placeKind()} options` : "More chat options"} title={props.dashboard ? `More ${placeKind()} options` : "More chat options"}><EllipsisIcon /></MenuTrigger>
          <MenuContent class="chat-header-menu">
            <MenuGroup>
              <MenuLabel class="chat-header-menu-title">{props.title}</MenuLabel>
              <MenuLabel class="chat-header-menu-meta">{menuLine()}</MenuLabel>
            </MenuGroup>
            <Show when={!props.dashboard}>
              <Show when={props.chat}>{(chat) => {
                // Opens in place: a submenu has nowhere to go beside a menu that fills a phone.
                const [expanded, setExpanded] = createSignal(false);
                const used = () => contextUsagePercent(chat().contextUsage());
                return <div class="chat-header-menu-context-block">
                  <button type="button" class="chat-header-menu-context-trigger" aria-expanded={expanded()}
                    onClick={() => { if (!expanded()) chat().refreshContext(); setExpanded(!expanded()); }}>
                    <span class="chat-header-menu-context-line"><span class="chat-header-menu-section-label">Context</span>
                      <span>{used() == null ? "Unavailable" : `${Math.round(used()!)}% used`}</span><ChevronRightIcon class="chat-header-menu-context-chevron" /></span>
                    <Show when={!expanded()}><ContextBar chat={chat()} /></Show>
                  </button>
                  <Show when={expanded()}><ContextBreakdown chat={chat()} bare canCompact={chat().capabilities()?.compaction !== false} /></Show>
                </div>;
              }}</Show>
              <Show when={sessionId()}><MenuGroup class="chat-header-menu-context" aria-label="Session"><MenuLabel class="chat-header-menu-section-label">Session ID</MenuLabel><div class="chat-header-menu-context-values"><code>{sessionId()}</code></div></MenuGroup></Show>
            </Show>
            <MenuSeparator />
            <Show when={!props.dashboard && !nativeApp}>
              <MenuItem disabled={props.pwaUpdating()} onSelect={props.onUpdatePwa}><RefreshCwIcon class={props.pwaUpdating() ? "pwa-update-icon pwa-update-icon-active" : "pwa-update-icon"} />{props.pwaUpdating() ? "Updating app…" : "Update app"}</MenuItem>
              <MenuSeparator />
            </Show>
            <Show when={isMobileLayout()}><MenuItem onSelect={props.onTogglePanel}><PanelRightIcon />Workspace panel</MenuItem></Show>
            <MenuItem onSelect={props.onShare}><ShareIcon />Share</MenuItem>
            <Show when={props.onRename}>
              <MenuItem onSelect={() => props.onRename?.()}><PencilIcon />{props.dashboard ? `Rename ${placeKind()}` : "Rename"}</MenuItem>
            </Show>
            <Show when={props.onDelete}>
              <MenuItem variant="destructive" onSelect={() => props.onDelete?.()}><Trash2Icon />{props.dashboard ? (placeKind() === "workspace" ? "Unlink workspace" : "Delete project") : "Delete"}</MenuItem>
            </Show>
          </MenuContent>
        </Menu></Show>
        {props.actions}
        {/* The pane's own swap and close, at its right edge: they act on the pane. */}
        {props.tabActions}
      </HeaderActions>
    </header>
  </>;
}

/** A chat's transcript with its composer over it: a Conduit chat's and an
 *  untracked harness thread's alike. */
function Conversation(props: { chat: ActiveChatStore; busy?: boolean; transcript: JSX.Element; composer: JSX.Element; stackRef?: (element: HTMLDivElement) => void }) {
  return <div class="work-area">
    <section class="work-area-conversation" aria-label="Conversation" aria-busy={props.busy}>
      {props.transcript}
      <div ref={(element) => props.stackRef?.(element)} class="composer-stack" data-question={props.chat.hostUiRequests().length ? "true" : undefined}>
        <HostUiRequests requests={props.chat.hostUiRequests()} onRespond={props.chat.respondHostUi} onStop={() => props.chat.stop()} />
        {props.composer}
      </div>
    </section>
  </div>;
}

function HeaderActions(props: { children: JSX.Element }) {
  return <div class="chat-header-actions">
    {props.children}
  </div>;
}

/** Pane A, or the slot of a pane beside it (docs/design/panes-and-rail.md, 6b). */
type PaneKey = "main" | number;
/** A pane beside pane A: its chat session, its host element, and a page's unsent chat. */
type PaneSlot = { index: number; session: SideChat; host: () => HTMLElement | undefined; setHost: (element: HTMLElement | undefined) => void; draft: { id: string; projectId: string } | null };

function App() {
  const logout = async () => {
    clearCachedCatalogue();
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
    leader: LEADER_STROKE,
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
      for (const chat of project.sessions) scopes.add(chat.id);
    }
    return scopes;
  };
  const [templates, setTemplates] = createSignal<Template[]>([]);
  const [externalProfiles, setExternalProfiles] = createSignal<Template[]>([]);
  // Keyed by implementation, because that is what a manifest is registered
  // under and what every chat carries. A profile elects a harness; the harness
  // is what declares what it can do.
  const [harnessCapabilities, setHarnessCapabilities] = createSignal<Record<string, HarnessManifestView>>({});
  const [templatesLoading, setTemplatesLoading] = createSignal(true);
  const [installations, setInstallations] = createSignal<Installation[]>([]);
  const [installationsLoading, setInstallationsLoading] = createSignal(true);
  const [workspaceSuggestions, setWorkspaceSuggestions] = createSignal<WorkspaceSuggestion[]>([]);
  const [workspacePolicy, setWorkspacePolicy] = createSignal<WorkspacePolicy | null>(null);
  const [defaultTemplateId, setDefaultTemplateId] = createSignal("assistant");
  const [voiceSettings, setVoiceSettings] = createSignal<VoiceDictationSettings>(loadVoiceDictationSettings());
  const updateVoiceSettings = (next: VoiceDictationSettings) => setVoiceSettings(saveVoiceDictationSettings(next));
  const [partialContinue, setPartialContinue] = createSignal(true);
  const [maxAttachmentBytes, setMaxAttachmentBytes] = createSignal(DEFAULT_MAX_ATTACHMENT_BYTES);
  const [markdownRenderer, setMarkdownRenderer] = createSignal<MarkdownRendererId>(selectedMarkdownRenderer());
  const [meteorField, setMeteorField] = createSignal(selectedMeteorField());
  const [sidebarChatLimit, setSidebarChatLimit] = createSignal(selectedSidebarChatLimit());
  const chatSort = useChatSort();
  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [sidebarPins, setSidebarPins] = createSignal<string[]>([]);
  const [settingsLoaded, setSettingsLoaded] = createSignal(false);
  const [settingsSection, setSettingsSection] = createSignal<SettingsSection>("ui");
  /** Whether a caller asked for that section, or merely opened Settings. */
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
  // The tool the dock shows, as the dock reports it, so the rail can mark it
  // before the dock's chunk has loaded.
  // What the panes beside pane A hold, by slot -- a tool moved out of the
  // dock, a file or terminal opened beside, a chat or a page -- their order
  // left to right, and the shares of the main pane they take; per device.
  // Where the layout comes from (5f): a URL naming panes restores exactly
  // those; the app opened at its start page restores this device's last
  // layout; any other URL -- an old link, someone else's share -- pane A alone.
  applyTabFrost();
  applyStreamFade();
  installFocusShown();
  const launchUrl = new URL(location.href);
  const urlNamesPanes = launchUrl.searchParams.has("pane") || launchUrl.searchParams.has("a");
  const atStart = launchUrl.pathname === "/" && !launchUrl.search;
  // Pane slots: two for the row beside pane A, three more for panes in the dock.
  const SLOT_IDS = [0, 1, 2, 3, 4];
  const MAX_DOCKED = 3;
  const storedViews = (urlNamesPanes ? launchUrl.searchParams.getAll("pane").slice(0, 2)
    : atStart ? [readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split"), readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split-2")] : [])
    .map((value) => isSplitView(value) ? value : null);
  const storedDocked = (urlNamesPanes ? launchUrl.searchParams.getAll("dock") : atStart ? (readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-docked") || "").split("\n") : []).filter(isSplitView).slice(0, MAX_DOCKED);
  const initialViews: (SplitView | null)[] = [...(storedViews[0] ? [storedViews[0], storedViews[1] ?? null] : [storedViews[1] ?? null, null]), ...[0, 1, 2].map((index) => storedDocked[index] ?? null)];
  // Pane A shows its route's chat or page, or, over it, any other view.
  const storedPaneA = urlNamesPanes ? launchUrl.searchParams.get("a") : atStart ? readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-a") : null;
  const [paneAOverride, setPaneAOverrideState] = createSignal<SplitView | null>(isSplitView(storedPaneA) && !/^(chat|page):/.test(storedPaneA) ? storedPaneA : null);
  const setPaneAOverride = (view: SplitView | null) => { setPaneAOverrideState(view); writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-a", view ?? ""); };
  const [slotViews, setSlotViews] = createSignal(initialViews);
  const [slotOrder, setSlotOrder] = createSignal<number[]>(SLOT_IDS.filter((slot) => initialViews[slot]));
  // Panes moved into the dock: their slots keep their documents and sessions,
  // drawn in the dock rather than the row. The dock shows one at a time, or a tool.
  const [dockedSlots, setDockedSlots] = createSignal<number[]>([2, 3, 4].filter((slot) => initialViews[slot]));
  const [dockSlot, setDockSlot] = createSignal<number | null>(null);
  const isDocked = (slot: PaneKey) => slot !== "main" && dockedSlots().includes(slot);
  // What the dock holds: panes docked by hand, then those the row has no room for.
  const dockContents = () => [...dockedSlots(), ...foldedSlots()];
  const inDock = (slot: PaneKey) => slot !== "main" && dockContents().includes(slot);
  const [dockDocHost, setDockDocHost] = createSignal<HTMLElement>();
  // The dock beside the panes, taking its room, or over them; per device.
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
  const [splitDropActive, setSplitDropActive] = createSignal(false);
  const [dockTool, setDockTool] = createSignal<WorkspaceView>((() => {
    const stored = readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "tab");
    return stored === "diff" || stored === "chat" || stored === "terminal" ? stored : stored === "artifacts" ? "chat" : "files";
  })());
  const [workspaceFocusRequest, setWorkspaceFocusRequest] = createSignal(0);
  const [mobileSidebarOpen, setMobileSidebarOpen] = createSignal(false);
  const initialRouteId = pathChatId();
  // Asked for before anything else on the way in: every route waits on it,
  // and behind the browser's six connections to a server it queued for a
  // whole round trip behind reads nothing waits on. A route cannot finish
  // loading if it fails during a long outage, so it keeps retrying.
  const catalogueFresh = apiWhenServed<{ projects: Project[] }>("/v0/projects", true)
    .then((payload) => { writeCachedCatalogue(payload); return payload; });
  // The dashboard is drawn from the last catalogue this device saw, if it has
  // one, and corrected when the server answers: a cold open no longer waits
  // a round trip (or a fresh TLS handshake) to show what it showed last time.
  // Other routes name something the cache may not have, so they wait.
  const cachedCatalogue = location.pathname === "/" ? readCachedCatalogue() : null;
  const catalogueRequest = cachedCatalogue ? Promise.resolve(cachedCatalogue) : catalogueFresh;
  const initialProjectRouteId = pathProjectId();
  const initialTerminalRoute = location.pathname === "/terminal";
  const initialComputerRoute = location.pathname === "/computer" || location.pathname.startsWith("/computer/harness/");
  const initialDashboardRoute = location.pathname === "/";
  const [routeKind, setRouteKind] = createSignal<"chat" | "project" | "dashboard" | "terminal" | "computer">(
    initialComputerRoute ? "computer" : initialTerminalRoute ? "terminal" : initialDashboardRoute ? "dashboard" : initialProjectRouteId ? "project" : "chat",
  );
  const [computerHarness, setComputerHarness] = createSignal(decodeURIComponent(location.pathname.match(/^\/computer\/harness\/([^/]+)/)?.[1] || ""));
  const [terminalRouteId, setTerminalRouteId] = createSignal<string>();
  const [terminalCanReturn, setTerminalCanReturn] = createSignal(false);
  const workspacePanelScope = createMemo(() => routeKind() === "computer" ? "computer"
    : ["chat", "project", "dashboard"].includes(routeKind()) && catalogue.projectId() ? `project:${catalogue.projectId()}`
      : null);
  const [routeBootstrap, setRouteBootstrap] = createSignal<"loading" | "ready" | "error">("loading");
  const [routeBootstrapError, setRouteBootstrapError] = createSignal("");
  // The first open. Nothing but the frame shows until the route is ready and
  // laid out; then the composer is simply there and everything around it
  // fades in, once, rather than each part appearing as its data lands. Laid out
  // means the lazy parts that shape the page are in it: the workspace panel,
  // when it was left open, narrows the main pane and moves the composer, and a
  // project or Computer route draws its own dashboard. Their chunks are asked
  // for now, beside the route's data, rather than once the route is ready. A
  // route that never settles is shown anyway after a moment.
  // Whether the first open has been shown. Decoration waits for it: the
  // meteor field cost a phone a tenth of a second of the open it decorates.
  const [arrived, setArrived] = createSignal(false);
  // A phone's sidebar is off-screen at the first open, and its rows -- each
  // with its own menu -- were a large part of what that open built. They are
  // filled in once it has been shown, or at once if the sidebar is opened.
  const sidebarFilled = () => arrived() || !isMobileLayout() || mobileSidebarOpen();
  {
    const layoutReady = Promise.all([
      readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "open") === "true" && !isMobileLayout() ? WorkspacePanel.preload() : null,
      initialProjectRouteId ? ProjectDashboard.preload() : null,
      initialComputerRoute ? ComputerDashboard.preload() : null,
    ]).catch(() => undefined);
    const root = document.documentElement;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const arrive = () => {
      if (root.dataset.arrival !== "waiting") return;
      root.dataset.arrival = "arriving";
      settleFocus();
      settle = setTimeout(() => { delete root.dataset.arrival; dismissLaunchMark(); setArrived(true); }, 400);
    };
    root.dataset.arrival = "waiting";
    const fallback = setTimeout(arrive, 2500);
    // Two frames: the lazy parts render as their chunks resolve, and the page
    // lays out once before it is shown.
    // Every pane is part of it: the reveal waits for the chats beside pane A
    // to load too, then for the layout to hold still -- a long transcript
    // renders in passes, and shown mid-way its bubbles move under the fade.
    const panesLoaded = () => shownSlots().every((slot) => { const id = slotChatId(slot); return !id || paneSlot(slot).session.chat.loadedId() === id; });
    const waitForStill = () => new Promise<void>((resolve) => {
      let last = "";
      let still = 0;
      const check = () => {
        const shape = [...document.querySelectorAll<HTMLElement>(".chat-main, .main-split, .thread")].map((element) => { const box = element.getBoundingClientRect(); return `${Math.round(box.width)}x${Math.round(box.height)}`; }).join();
        still = shape === last ? still + 1 : 0;
        last = shape;
        if (still >= 3 || root.dataset.arrival !== "waiting") resolve(); else requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });
    createEffect(() => {
      // Only a transcript renders in passes. A dashboard or project page is
      // laid out in one, and three still frames on a phone still busy with
      // the rest of the open were close to half a second of nothing.
      const settled = () => ["dashboard", "project"].includes(routeKind()) && shownSlots().length <= 1
        ? new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        : waitForStill();
      if (routeBootstrap() !== "loading" && panesLoaded()) void layoutReady.then(settled).then(arrive);
    });
    onCleanup(() => { clearTimeout(fallback); clearTimeout(settle); delete root.dataset.arrival; dismissLaunchMark(); setArrived(true); });
  }
  let dragDepth = 0;
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
  // An unsent draft is deleted when its page is left, which can be while it is
  // still loading; the load then finds no chat, and that is not an error.
  const showDraftError = (error: unknown) => {
    if ((error as { error?: unknown } | null)?.error === "chat_not_found") return;
    showError(error);
  };
  /*
   * What the app is doing about its own version, said out loud.
   *
   * Updating used to be visible only as a spinner inside a menu nobody has
   * open, and a toast whose button reloaded so fast it read as doing nothing.
   * Neither survives the moment it happens in. This is durable: it sits above
   * the server footer for as long as it is true, so a build waiting to be
   * taken, or an install in progress, is a thing on screen rather than an
   * event you had to be watching for.
   */
  const [updateState, setUpdateState] = createSignal<UpdateState>({ kind: "idle" });
  const pwaUpdating = () => { const state = updateState().kind; return state === "checking" || state === "working"; };
  /*
   * "Nothing to install" is an answer, and it was only ever given in a toast.
   * Somebody who pressed Check for updates is owed a conclusion in the place
   * they pressed it, and then owed their sidebar back.
   */
  let settleTimer = 0;
  const saySettled = (kind: "current" | "updated") => {
    setUpdateState({ kind });
    clearTimeout(settleTimer);
    // Long enough to be read by somebody who pressed the button and then looked
    // away: a check can sit silent for several seconds while the worker is
    // asked, and a four-second answer landed while the menu was still open.
    settleTimer = window.setTimeout(() => setUpdateState((state) => state.kind === kind ? { kind: "idle" } : state), 8_000);
  };
  const sayUpToDate = () => saySettled("current");
  /*
   * Taking the waiting build. "Updating" is a promise that the page is about
   * to go, so it must not outlive the attempt: a build that was announced and
   * then activated on its own is no longer waiting, `applyPwaUpdate` declines,
   * and the strip would otherwise sit on "Updating Conduit..." forever with
   * the one state that has no timer and no button.
   */
  const takePwaUpdate = async () => {
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
    if (!await applyPwaUpdate()) {
      if (pwaUpdateWaiting()) setUpdateState({ kind: "ready" });
      else sayUpToDate();
    }
  };
  const setPwaUpdating = (busy: boolean) => setUpdateState(busy ? { kind: "checking" } : { kind: "idle" });
  const prepareDesktopUpdate = async (quiet: boolean) => {
    const shell = updateShell;
    if (!shell || pwaUpdating()) return;
    setPwaUpdating(true);
    const notice = quiet ? null : toast.loading("Checking for updates…");
    try {
      const result = await shell.prepareUpdate((progress) => {
        const share = progress.total ? Math.round((progress.downloaded / progress.total) * 100) : 0;
        const label = `Downloading ${progress.version}… ${share}%`;
        setUpdateState({ kind: "working", label });
        if (notice) toast.loading(label, { id: notice });
      }, quiet);
      if (result.kind === "ready") {
        setUpdateState({ kind: "ready" });
        if (notice) toast.success(`Conduit ${result.version} is ready to ${androidShell ? "install" : "restart"}`, { id: notice });
      } else if (quiet) {
        setUpdateState({ kind: "idle" });
      } else {
        sayUpToDate();
        if (notice) toast.success("Conduit is up to date", { id: notice });
      }
    } catch (error) {
      setUpdateState({ kind: "idle" });
      if (notice) { toast.dismiss(notice); showError(error); }
    }
  };
  const [addingServer, setAddingServer] = createSignal(false);
  const runPwaUpdate = async () => {
    if (pwaUpdating()) return;
    if (updateShell) {
      await prepareDesktopUpdate(false);
      return;
    }
    setPwaUpdating(true);
    try {
      // Stays "checking" until it resolves: a true return is followed by the
      // reload, so there is no install to narrate.
      if (!await forcePwaUpdate()) {
        sayUpToDate();
        toast.success("Conduit is up to date");
      }
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
  /*
   * Take the nearest route to this server that is there and can prove it is
   * this server, and stop taking one that is not.
   *
   * "Busy" is a generation running or a harness waiting on one. A route change
   * repaints a terminal and reopens a stream, which is a poor trade against a
   * few milliseconds while somebody is watching output arrive -- so an upgrade
   * waits for a quiet moment. Losing a route does not wait, and nothing here
   * decides that.
   */
  startPathSelection({
    busy: () => [...runtime.processes().values()].some((process) => process.active || process.waiting),
  });
  let hasConnected = false;
  createEffect(() => {
    if (runtime.connectivity() !== "online") return;
    if (hasConnected) void checkForPwaUpdate().catch(() => {});
    hasConnected = true;
  });
  const drafts = createDrafts(showError);


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
  // The main pane's chat, and everything it drives (state/chat-session.ts).
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
    onModelRecovered: ({ from, to }) => toast.warning(`This chat's previous model ${from} is no longer scoped. It resumed with ${to}.`, {
      id: "model-scope-recovery",
      duration: 6_000,
    }),
  });
  const { chat, models, permissions, serviceLevels, attachments, activeProfile, composerStatus, setComposerStatus } = session;
  // Panes B and C: a slot each, with its own chat session (6b).
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
  // Not awaited: a round trip in front of first paint is a poor price for a
  // race that asking again closes. A chat that opened before this landed is
  // told to look once more, and a composer with something in it is left alone.
  void drafts.load().then(() => chat.rehydrateDraft());

  /*
   * When a new build is allowed to replace this page.
   *
   * With nothing typed there is nothing to interrupt, so it is taken at once
   * and the reload is invisible. With something in the composer the build is
   * left waiting and the person is told, and the effect below takes it the
   * moment the composer empties -- which is sending, discarding, or clearing
   * it by hand, without any of those three having to know this exists.
   */
  if (import.meta.env.PROD && !nativeApp) {
    /*
     * Anything the reload would destroy.
     *
     * Text is the obvious one. An attachment is the one that actually cannot
     * be recovered: the file being uploaded is a local `File` that no server
     * draft holds, so a reload mid-upload loses the thing itself rather than a
     * copy of it. And a draft write still in the air has to land before the
     * document goes, or the page comes back to a state neither copy agrees on.
     */
    const composerDirty = () => Boolean(chat.draft().trim())
      || attachments.items().length > 0
      || !drafts.settled();
    // Said by the document that arrived, because the one that asked for it is
    // gone. Without this a hand-pressed check that found something looked like
    // a reload for no reason -- the update was the reason.
    if (claimPwaUpdateArrival()) saySettled("updated");
    startPwaUpdates({
      hold: composerDirty,
      // No toast. It said a version was ready in a thing that disappears, and
      // its button reloaded so quickly that it read as having done nothing.
      onUpdateReady: () => setUpdateState({ kind: "ready" }),
    });
    // Tracks the composer, not the update: `pwaUpdateWaiting` is a plain read.
    // That is the right way round -- the update arriving while the composer is
    // empty is already handled by `hold`, and what this waits for is the
    // composer emptying afterwards.
    createEffect(() => {
      if (composerDirty() || !pwaUpdateWaiting()) return;
      void takePwaUpdate();
    });
  }
  const selectedProject = createMemo(() => catalogue.projects().find((project) => project.id === catalogue.projectId()));
  const chatManifest = session.manifest;
  const chatCapability = session.capability;
  const chatHistory = session.history;
  const openingLiveChat = createMemo(() => chat.presentation().kind === "opening_live");
  const withheldLiveChat = createMemo(() => chat.presentation().kind !== "ready");
  const emptyChat = createMemo(() => !withheldLiveChat() && chat.loadedId() === catalogue.selectedId() && !chat.messages().length && !chat.tools().length && !isChatContentActivity(chat.activity()));
  // A send leaves the empty layout at once, not when the agent has started
  // and the message is in the transcript: the composer goes to the foot and
  // holds the message there, beside "Starting agent…", until it lands.
  const sendingOut = () => ["submitting", "active"].includes(chat.generation());
  const emptyLayout = createMemo(() => emptyChat() && !sendingOut());
  /*
   * A new chat holds its composer in the middle of the pane; the first send
   * moves it to the foot of the transcript, straight away. It travels there
   * rather than cutting: where it sat is noted while the chat is empty, and
   * when a send ends the empty layout it starts from that spot and settles
   * into its place.
   * Leaving an empty chat any other way -- opening another chat -- just cuts.
   */
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
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !chatComposerStack) return;
    // Measured and started in the same frame as the layout change, so the
    // docked composer is never painted before it sets off.
    const offset = from - chatComposerStack.getBoundingClientRect().top;
    if (Math.abs(offset) < 4) return;
    chatComposerStack.animate([{ transform: `translateY(${offset}px)` }, { transform: "none" }],
      { duration: 420, easing: "cubic-bezier(.2, .8, .2, 1)" });
  }));
  /*
   * Sending from a dashboard. The send goes at once; then the dashboard
   * around the composer leaves, quick and accelerating, and the chat arrives
   * as soon as it has gone: its composer starts where the dashboard's sat and
   * settles into its place at the foot, and the rest of the pane fades in.
   * The agent starting is not waited on: the send has already left the empty
   * layout (emptyLayout), so the composer makes one move and waits at the
   * foot, holding the message until it lands in the transcript. The sidebar
   * and workspace panel are not changing place, so they stay. The composer
   * moved is the inner wrap, so the stack's own rect -- which the empty-chat
   * travel measures -- is never read mid-flight. Focus goes with the composer.
   */
  const DASHBOARD_LEAVE_MS = 200;
  const leaveDashboard = (): Promise<DOMRect | null> => {
    const wrap = document.querySelector<HTMLElement>('.chat-main [data-part="composer"]');
    if (!wrap || matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve(null);
    const from = wrap.getBoundingClientRect();
    document.documentElement.dataset.routeMotion = "leaving";
    return new Promise((resolve) => setTimeout(() => resolve(from), DASHBOARD_LEAVE_MS));
  };
  const sendFromDashboard = async () => {
    const sending = chat.send().catch(() => undefined);
    const from = await leaveDashboard();
    setRouteKind("chat");
    arriveInChat(from);
    await sending;
  };
  const arriveInChat = (from: DOMRect | null) => {
    const root = document.documentElement;
    if (!from) return void delete root.dataset.routeMotion;
    requestAnimationFrame(noteEmptyComposer);
    root.dataset.routeMotion = "arriving";
    const wrap = chatComposerStack?.querySelector<HTMLElement>('[data-part="composer"]');
    if (wrap) {
      const to = wrap.getBoundingClientRect();
      const dx = from.left + from.width / 2 - (to.left + to.width / 2);
      const dy = from.top - to.top;
      if (Math.abs(dx) + Math.abs(dy) >= 4) wrap.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
        { duration: 420, easing: "cubic-bezier(.2, .8, .2, 1)" });
    }
    setTimeout(() => { if (root.dataset.routeMotion === "arriving") delete root.dataset.routeMotion; }, 450);
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

  // A render effect, not an ordinary one: these settings come from
  // localStorage, which is synchronous, but an effect runs after the DOM is
  // committed. Reading them there meant the panel painted closed and the shell
  // painted unexpanded, then both snapped into place on the next frame for
  // anyone who had left the panel open. Resolving during render puts the stored
  // geometry in the first paint instead.
  createRenderEffect(() => {
    const scope = workspacePanelScope();
    if (!scope) return;
    const globalOpen = readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "open");
    const globalExpanded = readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "expanded");
    const open = globalOpen ?? readSetting(scope, "open") ?? (scope === "computer" ? "true" : "false");
    const expanded = globalExpanded ?? readSetting(scope, "expanded") ?? "false";
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
      if (isMobileLayout()) document.querySelector<HTMLElement>(".chat-header .chat-header-more")?.focus({ preventScroll: true });
      else focusChatPane();
    }
    if (!next) setWorkspaceExpanded(false);
    setPanelOpen(next);
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "open", String(next));
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

  // Remove an abandoned draft from the local UI and begin stopping its process
  // in the same event turn. The server remains responsible for serialized
  // process teardown and durable deletion.
  const discardDraftImmediately = (id: string | null) => {
    if (!id) return;
    catalogue.setProjects((current) => current.map((project) => ({
      ...project,
      sessions: project.sessions.filter((session) => session.id !== id),
    })));
    void discardDraft(id).catch(showError);
  };

  const abandonCurrentDraft = () => discardDraftImmediately(currentDraftId());

  let newChatRequestEpoch = 0;
  const abandonPendingNewChat = () => { newChatRequestEpoch += 1; };
  const leaveChat = (preserveDraft: boolean) => {
    abandonPendingNewChat();
    if (!preserveDraft) abandonCurrentDraft();
  };

  // The store holds one profile's models at a time, and a new chat is often
  // started from somewhere else entirely - a dashboard, or the chat you were
  // just reading on another profile. Seeding the launch from it then asks the
  // new profile for a model it has never heard of and the launch is refused,
  // so the selection only travels when it is this profile's to give.
  // The server keeps an untouched draft warm when its page lets go of it, and
  // may hand that same chat back here: it is ours again, to discard again.
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

  const createChat = async (target?: Project, launch: { templateId?: string; runtimeKind?: string } = {}, options: { reportFailure?: boolean } = {}) => {
    const reportFailure = options.reportFailure !== false;
    if (!leaveHarnessThread()) return null;
    const project = target || selectedProject() || catalogue.projects().find((item) => item.slug === "chat") || catalogue.projects()[0];
    if (!project) return null;
    const requestEpoch = ++newChatRequestEpoch;
    const replacedDraftId = currentDraftId();
    const fromDashboard = routeKind() === "project" || routeKind() === "dashboard" || routeKind() === "computer";
    const profileId = launch.templateId || project.defaultTemplateId || defaultTemplateId() || "assistant";
    discardDraftImmediately(replacedDraftId);
    chat.reset(profileId);
    attachments.clear({ discard: false });
    catalogue.selectProject(project);
    setRouteKind("chat");
    try {
      const created = profileId === "runtime"
        ? await api<ChatSummary>("/v0/runtime/chats", { method: "POST", body: JSON.stringify({}) })
        : await createProfileChat(project, profileId);
      if (requestEpoch !== newChatRequestEpoch) {
        discardDraftImmediately(created.id);
        return null;
      }
      const ownerProject = profileId === "runtime"
        ? catalogue.projects().find((item) => item.id === created.projectId)
          || catalogue.projects().find((item) => item.slug === "chat")
        : project;
      if (!ownerProject) throw new Error("The Runtime chat project is not available");

      const activation = activateCreatedChat(created, ownerProject, profileId);
      batch(() => {
        if (fromDashboard) history.pushState({}, "", `/chat/${created.id}`);
        else history.replaceState({}, "", `/chat/${created.id}`);
      });
      // Show the durable draft without waiting for its scoped controls to load.
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

  // New chat without a project of its own lands on the Conduit dashboard with
  // the composer focused: the dashboard is the new-chat screen.
  // A new chat starts where its composer already waits: the Conduit dashboard
  // for a loose chat, and on desktop a project's or workspace's own page. A
  // phone keeps a place's new chat on a chat page of its own, since a page is
  // busy to start from there.
  const startNewChat = async (target?: Project) => {
    const project = target || selectedProject();
    if (project && project.slug !== "chat") {
      if (isMobileLayout()) { await createChat(project); return; }
      if (routeKind() !== "project" || selectedProject()?.id !== project.id) await openProject(project);
      requestAnimationFrame(() => requestAnimationFrame(focusComposer));
      return;
    }
    if (routeKind() !== "dashboard") openDashboard();
    requestAnimationFrame(() => requestAnimationFrame(focusComposer));
  };

  let dashboardDraftRequest: Promise<void> | null = null;
  const ensureDashboardDraft = () => {
    const route = routeKind();
    if (dashboardDraftRequest || !["dashboard", "project"].includes(route)
      || chat.loadedId() || catalogue.selectedId() || templatesLoading()) return;
    const project = route === "project"
      ? selectedProject()
      : catalogue.projects().find((item) => item.slug === "chat") || catalogue.projects()[0];
    if (!project || project.state === "cloning") return;
    const templateId = project.defaultTemplateId || defaultTemplateId() || "assistant";
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
    }).catch(showDraftError).finally(() => {
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
    // Already here: keep the composer's draft and its agent as they are.
    if (routeKind() === "dashboard" && routeBootstrap() === "ready" && historyMode !== "none") {
      setMobileSidebarOpen(false);
      return;
    }
    if (!leaveHarnessThread()) return;
    leaveChat(historyMode === "none");
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

  let computerRequest = 0;
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
    const request = ++computerRequest;
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
      if (request !== computerRequest) return;
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
      if (request === computerRequest) setComputerError(error instanceof Error ? error.message : "Folder could not be opened");
    } finally {
      if (request === computerRequest) setComputerLoading(false);
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
      const terminal = await api<{ id: string }>("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId: "computer", cwd: location.project.workingRoot }) });
      window.dispatchEvent(new Event("conduit:ptys-changed"));
      openWorkspaceView("terminal", terminal.id);
    } catch (error) { showError(error); }
  };

  /*
   * The Computer page in a pane beside pane A browses on its own: a folder
   * of its own, sharing the folder cache; what it opens goes where pane A's
   * Computer page sends it.
   */
  const renderPaneComputer = (slot: number) => {
    const [location, setLocation] = createSignal<ComputerLocation | null>(computerLocation());
    const [loading, setLoading] = createSignal(false);
    const [error, setError] = createSignal("");
    let request = 0;
    const browse = async (path?: string) => {
      const mine = ++request;
      const cached = computerFolders.get(path || location()?.home || "");
      if (cached) setLocation(cached);
      setLoading(!cached);
      setError("");
      try {
        const next = await api<ComputerLocation>(`/v0/computer${path ? `?path=${encodeURIComponent(path)}` : ""}`);
        if (mine !== request) return;
        cacheComputerFolder(next);
        setLocation(next);
        prefetchComputerFolders(next);
      } catch (failure) {
        if (mine === request) setError(failure instanceof Error ? failure.message : "Folder could not be opened");
      } finally {
        if (mine === request) setLoading(false);
      }
    };
    if (!location()) void browse();
    return <>
      <ChatHeader title="Computer" tabActions={paneTabActions(slot)} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} appDashboard alone />
      <ComputerDashboard projects={catalogue.projects()} location={location()} loading={loading()} error={error()} onOpenHarnessHere={(id) => setSlotView(slot, `page:harness:${encodeURIComponent(id)}`)} onBrowse={(path) => void browse(path)} onPrefetch={prefetchComputerFolder} onMakeWorkspace={() => { const here = location(); if (here) void createComputerWorkspace(here.project.workingRoot); }} onCreateWorkspace={(path) => void createComputerWorkspace(path)} onOpenWorkspace={(project) => void openProjectHere(project)} onManageWorkspace={(action, project) => { if (action === "rename") runSidebar("rename-folder", { project }); else if (action === "identity") openWorkspaceIdentity(project); else runSidebar("delete-project", { project }); }} onStartWorkspaceAction={(action, path) => runSidebar(action === "created" ? "new-workspace-created" : "new-workspace-cloned", { path })} onOpenView={openWorkspaceView} onOpenTerminalView={() => openTerminalRoute()} onOpenTerminalHere={() => void openComputerTerminalHere()} onOpenFile={(path) => { const here = location(); if (here) openFileDocument({ projectId: here.project.id, path }, { beside: altActivation(), edit: false }); }} />
    </>;
  };
  /*
   * A harness page in a pane beside pane A: its composer's draft is a hidden
   * chat on that pane's session, as pane A's is on its own; sending runs the
   * thread in the same pane, and the pane letting go of it ends that chat.
   */
  const renderPaneHarness = (pane: PaneSlot, harnessId: string) => {
    const side = pane.session;
    const [scope, setScope] = createSignal<string | null>(null);
    const [draft, setDraft] = createSignal<{ cwd: string; chatId: string } | null>(null);
    let request: Promise<void> | null = null;
    let typed = "";
    const drop = (id: string) => void api(`/v0/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    const ensure = (cwd: string, choices: HarnessChoices): Promise<void> => {
      if (request) return request.then(() => ensure(cwd, choices));
      const current = draft();
      if (!cwd || (current?.cwd === cwd && side.chat.loadedId() === current.chatId)) return Promise.resolve();
      typed = side.chat.draft();
      const pending: Promise<void> = openThreadChat(harnessId, { path: cwd, newThread: true, ...choices }).then(async (opened) => {
        if (untrack(() => slotView(pane.index)) !== `page:harness:${encodeURIComponent(harnessId)}`) { drop(opened.chat.id); return; }
        setDraft({ cwd, chatId: opened.chat.id });
        await side.open(opened.chat, opened.project);
        if (typed && !side.chat.draft()) side.chat.setDraft(typed);
        typed = "";
        if (current && current.chatId !== opened.chat.id) drop(current.chatId);
      }).catch(showDraftError).finally(() => { request = null; });
      request = pending;
      return pending;
    };
    const send = async (cwd: string, choices: HarnessChoices, prompt: string) => {
      await ensure(cwd, choices);
      const made = draft();
      if (!made || side.chat.loadedId() !== made.chatId) return;
      setDraft(null);
      paneThreads.set(pane.index, made.chatId);
      setSlotView(pane.index, `chat:${made.chatId}`);
      side.chat.setDraft(prompt);
      await side.chat.send();
    };
    onCleanup(() => { const left = draft(); if (left) { if (untrack(side.chat.loadedId) === left.chatId) side.close(); drop(left.chatId); } });
    return <>{<ChatHeader title={harnessLabelFor(harnessId) || harnessId} tabActions={paneTabActions(pane.index)} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} appDashboard alone />}<HarnessDashboard harnessId={harnessId} projects={catalogue.projects()} runtime={runtime} scope={scope()} onScope={setScope} home={computerLocation()?.home || ""}
      composer={(input) => {
        const drafted = () => Boolean(draft() && side.chat.loadedId() === draft()!.chatId);
        const choices = (): HarnessChoices => drafted()
          ? { model: side.models.model(), thinkingLevel: side.models.effort(), permissionMode: side.permissions.selected() }
          : input.choices;
        createEffect(on(() => input.folder.current, (cwd) => { if (untrack(drafted)) void ensure(cwd, untrack(choices)); }, { defer: true }));
        const manifest = () => harnessCapabilities()[harnessProfile(harnessId)?.implementation || harnessId] || null;
        const use = () => ensure(input.folder.current, choices());
        return <div style={{ display: "contents" }}
          onInput={(event) => { if (event.target instanceof HTMLTextAreaElement) typed = event.target.value; void use(); }}>
          <Composer chat={side.chat} launches supports={(name) => resolveCapability(manifest(), side.chat.capabilities(), name, false)} attachments={side.attachments} attachmentsSupported={Boolean(manifest()?.attachments)} models={drafted() ? side.models : input.models} modelsLoading={drafted() ? undefined : input.loading} folder={input.folder} permissions={manifest()?.permissionModes ? (drafted() ? side.permissions : input.permissions) : undefined} profiles={harnessProfile(harnessId) ? [harnessProfile(harnessId)!] : []} activeProfile={harnessProfile(harnessId)} onOpenModelSelector={openModelSelector} serverOnline={runtime.connectivity() === "online"} voiceSettings={voiceSettings()} onChooseProfile={() => {}} onOpenSettings={openSettings} onOpenAttachments={() => void use().then(() => side.openAttachments())} onSendDraft={(prompt) => send(input.folder.current, choices(), prompt)} />
        </div>;
      }}
      onStartThread={(launch) => send(launch.cwd, launch, launch.prompt)} onOpenThread={(thread) => void openHarnessThread(thread)} onOpenChat={(target, project) => void openChatFromPage(target, project)} /></>;
  };
  // Threads started in a pane beside A run as hidden chats that end when the
  // pane lets go of them.
  const paneThreads = new Map<number, string>();
  const openComputer = (historyMode: "push" | "none" = "push") => {
    if (!leaveHarnessThread()) return;
    leaveChat(historyMode === "none");
    chat.reset();
    const chatRoot = catalogue.projects().find((project) => project.slug === "chat");
    if (chatRoot) catalogue.selectProject(chatRoot);
    setMobileSidebarOpen(false);
    setWorkspaceViewRequest(null);
    setRouteKind("computer");
    setComputerHarness("");
    setRouteBootstrapError("");
    setRouteBootstrap("ready");
    if (!computerLocation()) void browseComputer();
    if (historyMode === "push") history.pushState({}, "", "/computer");
  };
  // A harness's page, scoped to one of the folders it ran in or to all of
  // them, and under it each thread Conduit does not keep, at an address of its
  // own.
  const harnessPath = (id: string, cwd?: string | null) => `/computer/harness/${encodeURIComponent(id)}${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ""}`;
  // A thread just started has no id of its own yet, so it is addressed by the
  // chat it runs as.
  const threadPath = (thread: HarnessThreadTarget) => `/computer/harness/${encodeURIComponent(thread.harnessId)}/thread/${encodeURIComponent(thread.id || `c:${thread.chatId}`)}?cwd=${encodeURIComponent(thread.path)}`;
  const [harnessScope, setHarnessScope] = createSignal<string | null>(null);
  const [harnessThread, setHarnessThread] = createSignal<HarnessThreadTarget | null>(null);
  const [trackingThread, setTrackingThread] = createSignal(false);
  // An untracked thread runs as a Conduit chat that no list shows, on the same
  // store and the same page parts as any chat. A reload or a closed tab asks
  // first while a turn is running.
  const holdUnload = (event: BeforeUnloadEvent) => { if (harnessThread() && chat.streaming()) event.preventDefault(); };
  window.addEventListener("beforeunload", holdUnload);
  onCleanup(() => window.removeEventListener("beforeunload", holdUnload));
  // Leaving ends that chat, and its process with it -- asking first while a
  // turn is still running. The thread itself stays with the harness.
  const leaveHarnessThread = () => {
    const open = harnessThread();
    if (!open) return true;
    if (chat.streaming() && !window.confirm(`${harnessLabelFor(open.harnessId) || "The harness"} is still working in this thread. Leave and stop it?`)) return false;
    setHarnessThread(null);
    // Let go of it first, so nothing after this takes it for a draft to discard.
    if (catalogue.selectedId() === open.chatId) { chat.reset(); catalogue.setSelectedId(null); }
    if (open.chatId) void api(`/v0/sessions/${encodeURIComponent(open.chatId)}`, { method: "DELETE" }).catch(() => {});
    return true;
  };
  const openComputerHarness = (id: string | null, historyMode: "push" | "replace" | "none" = "push", cwd?: string) => {
    if (!id) return openComputer(historyMode === "none" ? "none" : "push");
    if (!leaveHarnessThread()) return;
    leaveChat(historyMode === "none");
    chat.reset();
    setMobileSidebarOpen(false);
    setWorkspaceViewRequest(null);
    setRouteKind("computer");
    setComputerHarness(id);
    setHarnessScope(cwd || null);
    setRouteBootstrapError("");
    setRouteBootstrap("ready");
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
    setRouteKind("computer");
    setComputerHarness(target.harnessId);
    setHarnessScope(target.path);
    setHarnessThread(target);
    setRouteBootstrapError("");
    setRouteBootstrap("ready");
    void browseComputer(target.path);
    if (historyMode === "push") history.pushState({}, "", threadPath(target));
    else if (historyMode === "replace") history.replaceState({}, "", threadPath(target));
  };
  type OpenedThread = { chat: ChatSummary; project: Project; tracked: boolean };
  const openThreadChat = (harnessId: string, body: Record<string, unknown>) => api<OpenedThread>(
    `/v0/harnesses/${encodeURIComponent(harnessId)}/threads/open`, { method: "POST", body: JSON.stringify(body) });
  const openHarnessThread = async (target: HarnessThreadTarget, historyMode: "push" | "replace" | "none" = "push") => {
    const open = harnessThread();
    if (open?.harnessId === target.harnessId && (target.id ? open.id === target.id : open.chatId === target.chatId)) return;
    if (!leaveHarnessThread()) return;
    showHarnessThread(target, historyMode);
    try {
      const opened = await openThreadChat(target.harnessId, target.chatId ? { chatId: target.chatId } : { path: target.path, sessionId: target.id });
      // Left before it opened: nobody is here to use it.
      if (harnessThread() !== target) {
        if (!opened.tracked) void api(`/v0/sessions/${encodeURIComponent(opened.chat.id)}`, { method: "DELETE" }).catch(() => {});
        return;
      }
      // Conduit keeps this one already, so it opens as that chat.
      if (opened.tracked) {
        const owner = catalogue.projects().find((item) => item.id === opened.chat.projectId) || opened.project;
        await chat.select(opened.chat, owner, { history: "replace", onCommit: () => {
          batch(() => { setHarnessThread(null); setRouteKind("chat"); setRouteBootstrapError(""); setRouteBootstrap("ready"); });
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
      openComputerHarness(target.harnessId, "replace", target.path);
    }
  };
  /*
   * A harness page's composer belongs to the thread it will start, as a
   * dashboard's belongs to the chat it will start: a hidden chat in the folder
   * the thread will run in, so it attaches files and picks a model, a
   * permission mode and a speed exactly as a chat does. It is made when the
   * composer is first used -- typed in, attached to, sent -- rather than on
   * arrival, so looking through folders leaves nothing behind in them; until
   * then the page's own pickers stand in, and what they chose goes into it. It
   * moves when the folder changes, taking its text along.
   */
  const [harnessDraft, setHarnessDraft] = createSignal<{ harnessId: string; cwd: string; chatId: string } | null>(null);
  let harnessDraftRequest: Promise<void> | null = null;
  // Typing does not wait for the chat: what is typed while it is being made is
  // kept here, since opening the chat starts its composer empty.
  let typedBeforeDraft = "";
  const ensureHarnessDraft = (harnessId: string, cwd: string, choices: HarnessChoices): Promise<void> => {
    if (harnessDraftRequest) return harnessDraftRequest.then(() => ensureHarnessDraft(harnessId, cwd, choices));
    const current = harnessDraft();
    if (!cwd || harnessThread() || computerHarness() !== harnessId
      || (current?.harnessId === harnessId && current.cwd === cwd && chat.loadedId() === current.chatId)) return Promise.resolve();
    typedBeforeDraft = chat.draft();
    const request = openThreadChat(harnessId, { path: cwd, newThread: true, ...choices }).then(async (opened) => {
      if (routeKind() !== "computer" || computerHarness() !== harnessId || harnessThread()) {
        void api(`/v0/sessions/${encodeURIComponent(opened.chat.id)}`, { method: "DELETE" }).catch(() => {});
        return;
      }
      setHarnessDraft({ harnessId, cwd, chatId: opened.chat.id });
      await chat.select(opened.chat, opened.project, { history: "none" });
      if (typedBeforeDraft && !chat.draft()) chat.setDraft(typedBeforeDraft);
      typedBeforeDraft = "";
      if (current && current.chatId !== opened.chat.id) void api(`/v0/sessions/${encodeURIComponent(current.chatId)}`, { method: "DELETE" }).catch(() => {});
    }).catch((error) => { showError(error); }).finally(() => { harnessDraftRequest = null; });
    harnessDraftRequest = request;
    return request;
  };
  // Sending turns the page's draft into the thread, on a page of its own.
  const sendHarnessDraft = async (harnessId: string, cwd: string, choices: HarnessChoices, prompt: string) => {
    await ensureHarnessDraft(harnessId, cwd, choices);
    const draft = harnessDraft();
    if (!draft || chat.loadedId() !== draft.chatId || harnessThread()) return;
    const target: HarnessThreadTarget = { harnessId, path: draft.cwd, id: "", chatId: draft.chatId,
      title: prompt.trim().split("\n")[0]?.slice(0, 80) || "New thread" };
    batch(() => { setHarnessDraft(null); setHarnessScope(draft.cwd); setHarnessThread(target); });
    history.pushState({}, "", threadPath(target));
    chat.setDraft(prompt);
    await chat.send();
  };
  // Tracking keeps the chat the thread already runs as, and makes it Conduit's
  // in the workspace its folder is -- made one first when it is not.
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
          batch(() => { setHarnessThread(null); setRouteKind("chat"); setRouteBootstrapError(""); setRouteBootstrap("ready"); });
        },
      });
    } catch (error) { showError(error); }
    finally { setTrackingThread(false); }
  };
  const shareHarnessThread = async () => {
    try {
      const { origin } = await api<{ origin: string }>("/v0/share-origin");
      await navigator.clipboard.writeText(`${origin}${location.pathname}${location.search}`);
      toast.success("Tailscale thread link copied");
    } catch (error) { showError(error); }
  };
  const openComputerRoute = () => {
    const match = location.pathname.match(/^\/computer\/harness\/([^/]+)(?:\/thread\/([^/]+))?$/);
    const cwd = new URLSearchParams(location.search).get("cwd") || undefined;
    const harnessId = match?.[1] ? decodeURIComponent(match[1]) : "";
    const threadId = match?.[2] ? decodeURIComponent(match[2]) : "";
    if (harnessId && threadId && cwd) void openHarnessThread(threadId.startsWith("c:")
      ? { harnessId, path: cwd, id: "", chatId: threadId.slice(2), title: "" }
      : { harnessId, path: cwd, id: threadId, title: "" }, "none");
    else if (harnessId) openComputerHarness(harnessId, "none", cwd);
    else openComputer("none");
  };
  const harnessProfile = (id: string) => profiles().find((profile) => profile.id === id) || null;
  const openTerminalRoute = (historyMode: "push" | "replace" | "none" = "push", terminalId?: string) => {
    if (!leaveHarnessThread()) return;
    leaveChat(historyMode === "none");
    if (historyMode !== "none" && routeKind() !== "terminal") setTerminalCanReturn(true);
    setMobileSidebarOpen(false);
    setRouteKind("terminal");
    setTerminalRouteId(terminalId);
    setRouteBootstrapError("");
    setRouteBootstrap("ready");
    if (historyMode === "push") history.pushState({}, "", "/terminal");
    else if (historyMode === "replace") history.replaceState({}, "", "/terminal");
  };
  const leaveTerminalRoute = () => {
    if (terminalCanReturn()) history.back();
    else openComputer();
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
    if (!leaveHarnessThread()) return;
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
          setRouteKind("chat");
          setRouteBootstrapError("");
          setRouteBootstrap("ready");
        },
      });
    }
    catch (error) { showError(error); return; }
  };

  // A breadcrumb's place: a project or workspace opens its page, loose chats the dashboard.
  const openPlace = (target?: Project) => { if (target && target.slug !== "chat") void openProject(target); else openDashboard(); };
  const openProject = async (target: Project, historyMode: "push" | "replace" | "none" = "push") => {
    if (!leaveHarnessThread()) return;
    abandonPendingNewChat();
    if (routeKind() === "project" && catalogue.projectId() === target.id) return;
    const abandonedDraftId = currentDraftId();
    if (historyMode !== "none") discardDraftImmediately(abandonedDraftId);
    chat.reset();
    catalogue.selectProject(target);
    setRouteKind("project");
    setRouteBootstrapError("");
    setRouteBootstrap("ready");
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
    if (target?.closest(".composer,button,a,input,textarea,select,[contenteditable='true'],[role='button'],[role='link'],[role='option'],[data-slot='menu-content'],[data-slot='menu-sub-content'],[data-slot='context-menu-content'],[data-slot='context-menu-sub-content'],[data-slot='popover-content']")) return;
    if (!(event.currentTarget instanceof HTMLElement)) return;
    event.currentTarget.focus({ preventScroll: true });
  };
  const hasComposer = () => Boolean(document.querySelector(".composer textarea:not([disabled])"));
  // A click on empty space leaves focus on the main pane itself; the next key
  // decides where it goes. Typing, Enter and Esc go to the composer (the
  // character typed lands there); on a dashboard ↑/↓ start the cursor in the
  // chats list, else the first section with rows, and Tab starts the round.
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
    const composer = ".composer textarea:not([disabled])";
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
  // Shortcut contexts follow DOM focus. This one owner controls only the
  // persistent bottom line; a menu can take focus without changing it.
  let heldRegion: HTMLElement | null = null;
  let syncFocusedShortcutContext: ((target: EventTarget | null) => void) | undefined;
  const holdRegion = (region: HTMLElement | null) => {
    if (heldRegion === region) return;
    heldRegion?.removeAttribute("data-focus-held");
    heldRegion = region;
    region?.setAttribute("data-focus-held", "");
  };
  const acknowledgeFocusedRegion = (region: HTMLElement | null) => {
    if (!region || !region.contains(document.activeElement)) return;
    holdRegion(region);
    acknowledgeRegion(region);
  };
  const acknowledgeWorkspaceFocus = () => acknowledgeFocusedRegion(
    document.activeElement instanceof Element
      ? document.activeElement.closest<HTMLElement>('[data-region="workspace-panel"]')
      : null,
  );
  const focusWorkspacePanel = () => {
    if (!workspacePanelScope()) return;
    if (isMobileLayout()) setMobileSidebarOpen(false);
    // The dock showing a docked pane: that pane is what it holds, so it takes the keyboard.
    const docked = dockSlot();
    if (docked !== null && inDock(docked)) {
      if (!panelOpen()) setPanelOpenForChat(true);
      return requestAnimationFrame(() => focusPane(docked));
    }
    if (!panelOpen()) setPanelOpenForChat(true);
    setWorkspaceFocusRequest((request) => request + 1);
  };
  // The go-to jumps. The sidebar is entered at the row for where you are --
  // the current page, else the folder holding it -- or its first row; the
  // main pane at its composer; the transcript at its scroller.
  const focusSidebar = () => {
    if (isMobileLayout()) setMobileSidebarOpen(true);
    requestAnimationFrame(() => {
      const sidebar = document.querySelector<HTMLElement>('[data-region="sidebar"]');
      if (!sidebar) return;
      const shown = (element: Element) => element.getClientRects().length > 0;
      const row = [
        ...sidebar.querySelectorAll('[aria-current="page"]'),
        ...sidebar.querySelectorAll("[data-holds-current]"),
        ...sidebar.querySelectorAll(".sidebar-row, .sidebar-rail-action"),
      ].find(shown);
      const target = row && (row.matches("button, a") ? row : row.querySelector("button, a"));
      (target as HTMLElement | null | undefined)?.focus({ preventScroll: false });
      acknowledgeFocusedRegion(sidebar);
    });
  };
  // Entering the main pane with nothing more specific in mind goes to its
  // composer -- what is wanted nine times in ten -- else the pane. A composer
  // still connecting is disabled, so the pane holds focus until it can take
  // it, unless something else has taken focus by then. The terminal page
  // focuses its own.
  const enterMainPane = (attempt = 0, from: Element | null = null) => {
    if (routeKind() === "terminal") return;
    const pane = document.querySelector<HTMLElement>(".chat-main");
    const active = document.activeElement;
    if (attempt > 0 && active !== from && active !== document.body) return;
    if (hasComposer()) return focusComposer();
    if (active !== pane) pane?.focus({ preventScroll: true });
    if (document.querySelector(".composer textarea") && attempt < 20) setTimeout(() => enterMainPane(attempt + 1, pane), 100);
  };
  const focusMainPane = () => {
    if (isMobileLayout()) setMobileSidebarOpen(false);
    if (splitShown() && cyclePaneFocus()) return;
    enterMainPane();
    acknowledgeFocusedRegion(document.querySelector<HTMLElement>(".chat-main"));
  };
  // A route change that takes the focused element with it leaves focus on the
  // body, where no key does anything; the new page is entered instead. Never
  // taken from somewhere it still is, and not on a phone, where focusing the
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
  // Ctrl+Shift+1: open a collapsed sidebar and focus it; never close it --
  // Ctrl+B stays the toggle.
  const goToSidebar = () => {
    const collapsed = document.querySelector('[data-region="sidebar"]')?.getAttribute("data-state") === "collapsed";
    if (!isMobileLayout() && collapsed) runSidebar("toggle-sidebar");
    focusSidebar();
  };
  const hasTranscript = () => Boolean(document.querySelector(".message-scroller-viewport"));
  const focusTranscript = () => {
    if (isMobileLayout()) setMobileSidebarOpen(false);
    ((keyboardSlot() !== null ? document.querySelector<HTMLElement>(`${paneSelector(keyboardSlot()!)} .message-scroller-viewport`) : null)
      ?? document.querySelector<HTMLElement>(".message-scroller-viewport"))?.focus({ preventScroll: true });
  };
  const toggleChatWorkspaceFocus = () => {
    const inWorkspacePanel = document.activeElement instanceof Element && Boolean(document.activeElement.closest('[data-region="workspace-panel"]'));
    if (inWorkspacePanel) focusChatPane();
    else if (panelOpen()) focusWorkspacePanel();
    else focusChatPane();
  };

  const switchProfile = (id: string) => session.switchProfile(id);

  const refresh = async () => {
    const projects = await catalogue.refresh();
    migrateWorkspacePanelStorage(workspacePanelScopes(projects));
    return projects;
  };
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
      else await createChat(created, { templateId: created.defaultTemplateId || defaultTemplateId() || "assistant" });
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
      const saved = await api<ChatSummary>(`/v0/sessions/${id}/auto-name`, { method: "POST" });
      target.setTitle(saved.title);
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
  // The composer's folder button: the open chat, draft or not, moves to the
  // chosen place and stays open there.
  const chatOwner = () => catalogue.projects().find((project) => project.sessions.some((session) => session.id === chat.loadedId()));
  // Either pane's chat. Pane B's store is re-entered in its new place, as
  // pane A's catalogue selection follows it.
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
    try {
      await api(`/v0/sessions/${target.id}`, { method: "DELETE" });
      // Local copy too: the server drops its own with the chat, but this one
      // lives in storage on every device that ever opened it.
      drafts.forget(target.id);
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
      await api(`/v0/projects/${encodeURIComponent(target.id)}`, { method: "DELETE", body: JSON.stringify({ mode: "destroy_workspace", confirmation }) });
      dropProjectPanelState(target);
      if (catalogue.projectId() === target.id) await createChat(catalogue.projects().find((item) => item.slug === "chat"));
      await refresh();
      return true;
    } catch (error) { showError(error); return false; }
  };
  const cancelClone = async (operationId: string) => {
    await api(`/v0/workspace-operations/${encodeURIComponent(operationId)}`, { method: "DELETE" });
  };

  /*
   * `section` is what was asked for, and asking for nothing is a real answer:
   * on a phone Settings opens on the list of sections, and only a caller that
   * names one skips it. Everything used to name "models" by default, so the
   * list could never be the thing you arrived at.
   */
  const openSettings = (section: string | null = null, workspaceId: string | null = null) => {
    setSettingsSection((section || "ui") as SettingsSection);
    setSettingsNamedSection(Boolean(section));
    setSettingsWorkspaceId(workspaceId);
    setSettingsLoaded(true);
    setSettingsOpen(true);
  };
  const switchMarkdownRenderer = (next: MarkdownRendererId) => setMarkdownRenderer(saveMarkdownRenderer(next));
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
  // Settings says a failed preference save in its header; elsewhere it is a toast.
  createEffect(() => {
    const state = uiPreferenceSaves.state();
    if (state.kind === "failed" && !untrack(settingsOpen)) showError(new Error(`Preferences not saved: ${state.message}`));
  });
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
    if (view === "terminal" && terminalId && altActivation() && canOpenFilePanes()) return openTerminalDocument(terminalId, true);
    if (!workspacePanelScope()) return;
    setDockSlot(null);
    setWorkspaceViewRequest({ tab: view, ...(terminalId ? { terminalId } : {}), nonce: Date.now() });
    if (isMobileLayout()) setMobileSidebarOpen(false);
    setPanelOpenForChat(true);
  };
  const dockAvailable = () => routeKind() === "computer" ? Boolean(computerLocation()) : ["chat", "project", "dashboard"].includes(routeKind()) && Boolean(selectedProject()) && Boolean(workspacePanelScope());
  /*
   * The panes beside pane A (docs/design/panes-and-rail.md, 6b): up to two,
   * B and C, each a slot with its own view, session and host, shown left to
   * right in `slotOrder`. A slot is in the order exactly when it holds a view.
   * The panes show while the main pane can hold them at their minimums;
   * narrower, the dock gives way first (its own clamp), then the last pane
   * folds, then the split. At most one pane holds a tool: the dock's views
   * move to it, as they did to the one split.
   */
  const slotView = (slot: number) => slotViews()[slot] ?? null;
  // Panes in the row (folded ones included): two at most beside pane A.
  const rowSlots = () => slotOrder().filter((slot) => slotView(slot) && !isDocked(slot));
  // A free slot for a pane in the row or, `docked`, in the dock -- each has its own room.
  const freeSlot = (docked = false) => (docked ? dockedSlots().length < MAX_DOCKED : rowSlots().length < 2) ? SLOT_IDS.find((slot) => !slotOrder().includes(slot)) ?? null : null;
  // The dock is as narrow as what it shows may go: a docked pane's document, else a tool.
  const dockMinWidth = () => { const slot = dockSlot(); return slot !== null && inDock(slot) ? viewMinWidth(slotView(slot)) : MIN_SPLIT_PANE_WIDTH; };
  /*
   * Each document declares the narrowest its pane may go: one with a
   * composer, a chat or a page, the dashboard composer's least; a file viewer
   * or a tool, the dock's. Panes show while the room holds pane A and each
   * pane beside at their documents' minimums.
   */
  const isPaneView = (view: SplitView | null) => Boolean(view && /^(chat|page):/.test(view));
  const viewMinWidth = (view: SplitView | null) => !view || isPaneView(view) ? MIN_MAIN_PANE_WIDTH : MIN_SPLIT_PANE_WIDTH;
  const paneMinWidth = (pane: PaneKey) => viewMinWidth(pane === "main" ? paneAView() : slotView(pane));
  // The open dock keeps its own minimum; panes fold before it is pushed out.
  const viewsFit = (views: (SplitView | null)[]) => layoutWidth() - (panelOpen() && dockAvailable() && !dockOverlay() ? dockMinWidth() + 8 : 0)
    >= views.reduce((sum, view) => sum + viewMinWidth(view) + 16, viewMinWidth(paneAView()));
  const splitFits = (extra: number) => viewsFit(Array(extra).fill("files:"));
  const shownSlots = createMemo(() => {
    if (!dockAvailable() || isMobileLayout()) return [];
    const shown: number[] = [];
    for (const slot of slotOrder().filter((slot) => slotView(slot) && !isDocked(slot)).slice(0, 2)) {
      if (!viewsFit([...shown, slot].map(slotView))) break;
      shown.push(slot);
    }
    return shown;
  }, [], { equals: (a, b) => a.length === b.length && a.every((slot, index) => slot === b[index]) });
  // The panes drawn in the row. One the window can no longer hold goes to the
  // dock (foldedSlots), so nothing lingers here to fade.
  const renderSlots = shownSlots;
  const splitShown = () => shownSlots().length > 0;
  // A tool the dock lends a pane (a whole tool, the legacy file beside, a
  // terminal) -- not a chat, a page or a file viewer, which panes draw themselves.
  const isToolView = (view: SplitView | null) => Boolean(view && !isPaneView(view) && !/^(files|term):/.test(view));
  const toolSlot = () => shownSlots().find((slot) => isToolView(slotView(slot))) ?? null;
  // Pane A can hold the dock's tool too, over its route.
  const toolInPaneA = () => isToolView(paneAOverride());
  const toolView = () => { if (toolInPaneA()) return paneAOverride(); const slot = toolSlot(); return slot === null ? null : slotView(slot); };
  const toolHost = () => { if (toolInPaneA()) return paneAToolHost(); const slot = toolSlot(); return slot === null ? undefined : paneSlot(slot).host(); };
  const splitToolShown = () => { const view = toolView(); return isPanelTab(view) ? view : null; };
  // Pane A's share and each pane's beside it, by position; per device.
  const weightsFor = (count: number) => count === 3 ? splitRatios3() : count === 2 ? [1 - splitRatio(), splitRatio()] : [1];
  // While a pane opens or closes, the shares ease through an override.
  const [weightOverride, setWeightOverride] = createSignal<number[] | null>(null);
  const [paneMotion, setPaneMotion] = createSignal<{ slot: PaneKey; phase: "arriving" | "leaving"; collapsed?: boolean } | null>(null);
  const paneWeights = () => weightOverride() ?? weightsFor(renderSlots().length + 1);
  // The file beside is the dock's, so leaving it asks the dock first: an
  // unsaved edit, or the file moving into the dock's Files.
  let releaseSplitFile: ((toDock: boolean) => boolean) | undefined;
  const bindSplit = (release: (toDock: boolean) => boolean) => {
    releaseSplitFile = release;
    return () => { if (releaseSplitFile === release) releaseSplitFile = undefined; };
  };
  const persistSlots = () => {
    const views = rowSlots().map(slotView);
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split", views[0] ?? "");
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split-2", views[1] ?? "");
    writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-docked", dockedSlots().map(slotView).filter(Boolean).join("\n"));
  };
  // Each file viewer's editors, by pane, for its unsaved guard.
  const fileHandles = new Map<PaneKey, (FileSlotHandle | undefined)[]>();
  // Handles arrive as sides mount; a tab's unsaved dot reads them again.
  const [handlesChanged, setHandlesChanged] = createSignal(0);
  const handlesOf = (pane: PaneKey) => { let list = fileHandles.get(pane); if (!list) fileHandles.set(pane, list = []); return list; };
  // A swap or a close moving a document to another pane is not leaving it.
  let movingDocuments = false;
  const leavesUnsaved = (current: SplitView | null, next: SplitView | null, pane: PaneKey) => !movingDocuments && Boolean(parseFileView(current)) && !next?.startsWith("files:")
    && handlesOf(pane).some((handle) => handle?.hasUnsavedChanges()) && !window.confirm("Discard unsaved changes and close this file?");
  // A slot's view; null closes the pane. `position` places a new pane in the order.
  const setSlotView = (slot: number, next: SplitView | null, toDock = false, position?: number) => {
    if (slotView(slot) === "file" && next !== "file" && releaseSplitFile && !releaseSplitFile(toDock)) return false;
    if (leavesUnsaved(slotView(slot), next, slot)) return false;
    batch(() => {
      if (!next && isDocked(slot)) {
        setDockedSlots((current) => current.filter((item) => item !== slot));
        // Closing the pane the dock shows closes the dock, rather than baring its tools.
        if (dockSlot() === slot) { setDockSlot(null); closePanel(); }
      }
      setSlotViews((current) => current.map((view, index) => index === slot ? next : view));
      setSlotOrder((current) => {
        if (!next) return current.filter((item) => item !== slot);
        if (current.includes(slot)) return current;
        const order = [...current];
        order.splice(position ?? order.length, 0, slot);
        return order;
      });
    });
    persistSlots();
    return true;
  };
  // Any pane's view, and setting it: pane A's chats and pages go by its route,
  // anything else shows over the route until pane A is sent somewhere (5f).
  const viewOf = (pane: PaneKey) => pane === "main" ? paneAView() : slotView(pane);
  const panesShown = (): PaneKey[] => ["main", ...shownSlots()];
  const setPaneView = (pane: PaneKey, next: SplitView | null, toDock = false) => {
    if (pane !== "main") return setSlotView(pane, next, toDock);
    if (leavesUnsaved(paneAOverride(), next, "main")) return false;
    if (!next || isPaneView(next)) {
      setPaneAOverride(null);
      if (next) void openInPaneA(next);
    } else setPaneAOverride(next);
    return true;
  };
  const [paneAToolHost, setPaneAToolHost] = createSignal<HTMLElement>();
  const paneSelector = (pane: PaneKey) => pane === "main" ? ".chat-main" : `.main-split[data-pane-slot="${pane}"]`;
  const paneOf = (element: Element | null | undefined): PaneKey | null => {
    const section = element?.closest<HTMLElement>(".main-split");
    if (section) return Number(section.dataset.paneSlot);
    return element?.closest(".chat-main") ? "main" : null;
  };
  const focusSplit = (slot: number | null = toolSlot() ?? shownSlots()[0] ?? null) => requestAnimationFrame(() => {
    const content = slot === null ? null : paneSlot(slot).host()?.querySelector<HTMLElement>(".workspace-panel-content, .composer textarea:not([disabled]), .file-viewer-surface");
    focusFirst(content);
    if (!content?.contains(document.activeElement)) content?.focus({ preventScroll: true });
  });
  const [keyboardPane, setKeyboardPane] = createSignal<PaneKey>("main");
  // The pane beside A with the keyboard, when it holds a chat or a page.
  const keyboardSlot = () => { const pane = keyboardPane(); return pane !== "main" && (shownSlots().includes(pane) || (dockSlot() === pane && inDock(pane))) && isPaneView(slotView(pane)) ? pane : null; };
  const sideHasKeyboard = () => keyboardSlot() !== null;
  const slotHasKeyboard = (slot: number) => keyboardSlot() === slot;
  const focusPane = (slot: number) => { setKeyboardPane(slot); focusSplit(slot); };
  /*
   * Open beside the pane with the keyboard: a new pane just right of it when
   * the width holds one, or else the pane to its right, or, from the last
   * pane, that pane itself -- beside it there is nothing further right. A view a pane already shows is gone to there;
   * a tool goes to the pane that holds one. Whatever a tool displaces goes
   * back to the dock, which opens on it when that is where the reader was
   * working. A tool moved from the dock takes the keyboard; a chat or page
   * opened beside from a list leaves it where it was, so opening several
   * beside in a row lands each in the same place.
   */
  const openBeside = (view: SplitView, focus = true) => {
    const shown = shownSlots();
    const showing = shown.find((slot) => slotView(slot) === view);
    if (showing !== undefined) return focusPane(showing);
    const from = paneOf(document.activeElement);
    const pane = from ?? keyboardPane();
    const position = pane === "main" ? 0 : Math.max(0, shown.indexOf(pane) + 1);
    if (isToolView(view) && toolInPaneA()) { setPaneAOverride(view); if (panelOpen() && dockTool() === view) closePanel(); return; }
    if (switchToTab(view)) return;
    // A chat with no room for another pane joins the focused pane of chats as a kept tab (6c).
    if (view.startsWith("chat:") && panesShown().includes(pane) && activeChatOf(pane) && (shown.length >= 2 || !viewsFit([...shown.map(slotView), view]))) {
      keepNext.add(String(pane));
      if (pane === "main") void openInPaneA(view); else setSlotView(pane, view);
      if (focus) focusAnyPane(pane);
      return;
    }
    let slot = isToolView(view) ? toolSlot() : null;
    if (slot === null && (shown.length >= 2 || !viewsFit([...shown.map(slotView), view]))) slot = shown[position] ?? shown[position - 1] ?? shown[shown.length - 1] ?? null;
    const displaced = slot === null ? null : slotView(slot);
    if (slot === null) slot = freeSlot();
    if (slot === null) return;
    if (!setSlotView(slot, view, false, slotOrder().includes(slot) ? undefined : position)) return;
    if (panelOpen() && dockTool() === view) closePanel();
    if (from !== null && from !== "main" && displaced !== view && isPanelTab(displaced)) openWorkspaceView(displaced);
    if (focus) focusPane(slot);
  };
  const moveToDock = (view: SplitView) => {
    const slot = slotOrder().find((candidate) => slotView(candidate) === view);
    if (paneAOverride() === view) setPaneAOverride(null);
    else if (slot !== undefined && !setSlotView(slot, null, true)) return;
    openWorkspaceView(view === "file" ? "files" : isPanelTab(view) ? view : "terminal", view.startsWith("shell:") ? view.slice("shell:".length) : undefined);
    focusWorkspacePanel();
  };
  const closeSlot = (slot: number | null, focus = true) => {
    if (slot === null) return;
    const element = paneSlot(slot).host();
    const index = shownSlots().indexOf(slot);
    const close = () => { if (setSlotView(slot, null) && focus) focusChatPane(); };
    if (!element || index < 0 || !animatePanes()) return close();
    // It fades out, then the panes left ease into its room.
    setPaneMotion({ slot, phase: "leaving" });
    void element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SWAP_FADE_MS, easing: "ease-out", fill: "forwards" }).finished.then(() => {
      const target = weightsFor(shownSlots().length);
      target.splice(index + 1, 0, 0);
      setWeightOverride(paneShares());
      requestAnimationFrame(() => requestAnimationFrame(() => easePaneWeights(normalized(target), () => {
        batch(() => { close(); setWeightOverride(null); setPaneMotion(null); });
        element.getAnimations().forEach((animation) => animation.cancel());
      })));
    });
  };
  // The dock's own close: the pane holding its tool.
  const closeSplit = (focus = true) => toolInPaneA() ? void setPaneAOverride(null) : closeSlot(toolSlot(), focus);
  // A rail icon opens the dock on its tool, or goes to it in its pane; the
  // tool the dock already shows closes it.
  const chooseRailTool = (tool: WorkspaceView) => {
    if (splitToolShown() === tool && toolInPaneA()) focusFirst(paneAToolHost()?.querySelector<HTMLElement>(".workspace-panel-content"));
    else if (splitToolShown() === tool) focusSplit(toolSlot());
    else if (panelOpen() && dockSlot() === null && dockTool() === tool) closePanel();
    else if (dockSlot() !== null && !(tool === "terminal" && altActivation())) { setDockSlot(null); openWorkspaceView(tool); }
    else if (tool === "terminal" && altActivation() && canOpenFilePanes()) void openTerminalTool(true);
    else openWorkspaceView(tool);
  };
  /*
   * File viewers (6d-2). The navigator opens a file into the **file pane** --
   * the pane that last showed a file viewer, wherever the keyboard is -- so
   * opening files never replaces the chat being typed in; into the viewer's
   * focused entry when it shows two. With no file pane, or with Alt, it opens
   * a new pane beside, as a chat opened beside does.
   */
  const [filePane, setFilePane] = createSignal<PaneKey | null>(null);
  const [fileFocus, setFileFocus] = createSignal<Record<string, number>>({});
  const [fileWrap] = createSignal(readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "wrap-lines") === "true");
  // Each side of a viewer wraps on its own; the setting is where a side starts.
  const [sideWraps, setSideWraps] = createSignal<Record<string, boolean>>({});
  const sideWrap = (pane: PaneKey, side: number) => sideWraps()[`${pane}#${side}`] ?? fileWrap();
  const toggleSideWrap = (pane: PaneKey, side: number) => setSideWraps((current) => ({ ...current, [`${pane}#${side}`]: !sideWrap(pane, side) }));
  let pendingFileEdit: FileEntry | null = null;
  createEffect(() => { const pane = keyboardPane(); if (parseFileView(viewOf(pane))) setFilePane(pane); });
  const focusFileEntry = (pane: PaneKey, index: number) => setFileFocus((current) => ({ ...current, [String(pane)]: index }));
  const canOpenFilePanes = () => dockAvailable() && !isMobileLayout() && splitFits(1);
  /*
   * A shell is a document (6d): a click opens it over the pane already
   * showing a terminal, or beside when none does; Alt always beside. The pane
   * draws it; closing the pane leaves the shell running for the navigator.
   */
  const openTerminalDocument = (id: string, beside: boolean) => {
    const view: SplitView = `term:${id}`;
    const showing = panesShown().find((pane) => viewOf(pane) === view);
    if (showing !== undefined) return focusAnyPane(showing);
    const pane = beside ? undefined : panesShown().find((candidate) => viewOf(candidate)?.startsWith("term:"));
    if (pane !== undefined) { if (setPaneView(pane, view)) focusAnyPane(pane); return; }
    openBeside(view, true);
  };
  /*
   * The rail's Terminal opens in the dock; Alt (or dragging it from the rail)
   * opens a shell as a pane instead. That takes a running shell of the place no pane
   * shows, or starts one; the terminal's own menu manages shells from there.
   * With no room for a pane it says so; on a phone the dock keeps it.
   */
  const openTerminalTool = async (beside: boolean) => {
    const showing = panesShown().find((pane) => viewOf(pane)?.startsWith("term:"));
    if (!beside && showing !== undefined) {
      focusAnyPane(showing);
      return void document.querySelector<HTMLElement>(`${paneSelector(showing)} .pane-terminal .xterm-helper-textarea`)?.focus({ preventScroll: true });
    }
    if (shownSlots().length >= 2 || !viewsFit([...shownSlots().map(slotView), "term:"])) return void toast.info("There is no room for another pane.");
    const id = await pickShell();
    if (id) openBeside(`term:${id}`, true);
  };
  // A running shell of the place no pane shows, else a new one.
  const pickShell = async (): Promise<string | null> => {
    const computer = routeKind() === "computer";
    const projectId = computer ? "computer" : dockProject()?.id;
    if (!projectId) return null;
    const open = new Set(panesShown().map(viewOf).filter((view) => view?.startsWith("term:")).map((view) => view!.slice("term:".length)));
    try {
      const { ptys = [] } = await api<{ ptys: { id: string; status: string }[] }>(`/v0/ptys?projectId=${encodeURIComponent(projectId)}`);
      let id = ptys.find((item) => item.status === "running" && !open.has(item.id))?.id;
      if (!id) {
        id = (await api<{ id: string }>("/v0/ptys", { method: "POST", body: JSON.stringify({ projectId, ...(computer && computerLocation() ? { cwd: computerLocation()!.project.workingRoot } : {}) }) })).id;
        window.dispatchEvent(new Event("conduit:ptys-changed"));
      }
      return id;
    } catch (error) { showError(error); return null; }
  };
  /*
   * Drag to a pane (6e): a sidebar row, a page's chat, a file in the
   * navigator or a rail tool dragged over a pane washes where it will land --
   * its left or right third a new pane on that side while the width holds
   * one, its middle the pane's own document (a file joining a viewer holding
   * one; a chat joining a pane of chats as a tab, 6c). A document a pane
   * already shows is focused there instead. A background tab drags as its
   * chat does, leaving its pane's tabs for wherever it lands.
   */
  const DOC_DRAG_TYPE = "application/x-conduit-doc";
  let draggedView: string | null = null;
  // A pane's header dragged moves its document (draggedPane).
  let draggedPane: PaneKey | null = null;
  // A place's label dragged takes all its tabs (draggedGroup).
  let draggedGroup: { pane: PaneKey; ids: string[] } | null = null;
  // A file tab dragged moves: its side lets it go once it lands (draggedFileTab).
  let draggedFileTab: { pane: PaneKey; side: number; key: string } | null = null;
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
  // Over a file viewer, a file dragged onto a column says what it will do in a pill by the pointer, not a wash.
  // Every drop says what it will do in a pill by the pointer; a wash marks only where a pane target lies.
  type DragHintIcon = "left" | "right" | "column" | "tab" | "swap" | "here";
  // The pill's words change with the target; its place follows the pointer by transform
  // alone, written straight to it -- a layout per dragover made it trail the pointer.
  const [dragHintContent, setDragHintContent] = createSignal<{ text: string; icon: DragHintIcon } | null>(null, { equals: (a, b) => a?.text === b?.text && a?.icon === b?.icon });
  let dragHintElement: HTMLDivElement | undefined;
  let dragHintAt = { x: 0, y: 0 };
  const placeDragHint = () => { if (dragHintElement) dragHintElement.style.transform = `translate3d(${dragHintAt.x + 14}px, ${dragHintAt.y + 18}px, 0)`; };
  const setDragHint = (hint: { x: number; y: number; text: string; icon: DragHintIcon } | null) => {
    setDragHintContent(hint && { text: hint.text, icon: hint.icon });
    if (hint) { dragHintAt = { x: hint.x, y: hint.y }; placeDragHint(); }
  };
  const [docDrop, setDocDrop] = createSignal<{ pane: PaneKey; zone: "left" | "middle" | "right" | "side" | "column" | "fill" | "dock"; side?: number; rect: { left: number; top: number; width: number; height: number } } | null>(null);
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
    const fileTab = fromPane === null ? event.target.closest<HTMLElement>("[data-file-side] [data-tab]") : null;
    const fileTabPane = fileTab ? paneOf(fileTab) : null;
    draggedFileTab = fileTab && fileTabPane !== null ? { pane: fileTabPane, side: Number(fileTab.closest<HTMLElement>("[data-file-side]")!.dataset.fileSide), key: fileTab.dataset.tab! } : null;
    event.dataTransfer.setData(DOC_DRAG_TYPE, view);
    event.dataTransfer.effectAllowed = "copyMove";
  };
  const onDocDragOver = (event: DragEvent) => {
    if (!draggedView || !event.dataTransfer?.types.includes(DOC_DRAG_TYPE)) return;
    const dockTarget = draggedPane !== null && event.target instanceof Element ? event.target.closest<HTMLElement>(".workspace-panel-open, .workspace-rail") : null;
    if (dockTarget && draggedPane !== null && canDock(draggedPane)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setDragHint({ x: event.clientX, y: event.clientY, text: "Move to the dock", icon: "right" });
      const box = (dockTarget.querySelector(".workspace-panel-surface") ?? dockTarget).getBoundingClientRect();
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
    const viewer = draggedPane === null && Boolean(parseFileView(viewOf(pane))?.length);
    const { zone, edge } = dropZoneAt(third, { edges, viewer });
    if (draggedPane !== null && nearEdge(draggedPane, pane, zone)) { setDragHint(null); return void setDocDrop(null); }
    /*
     * A file over a file viewer: only its outer fifths are panes (washed); within,
     * the column under the pointer takes it as its showing tab -- or, beside a lone
     * column's file (the right half of its body), a new column; an empty column
     * shows it. Where it came from is no target.
     */
    const held = draggedPane === null && parseFileView(draggedView) ? parseFileView(viewOf(pane)) : null;
    const fifth = viewer && zone !== "middle" ? zone : null;
    if (held?.length && !fifth && event.target instanceof Element) {
      const column = event.target.closest<HTMLElement>(".workspace-file-viewer > .workspace-preview");
      const hint = (next: { zone: "side" | "column" | "fill"; side?: number; text: string } | null) => {
        if (!next) { setDocDrop(null); return void setDragHint(null); }
        setDragHint({ x: event.clientX, y: event.clientY, text: next.text, icon: next.zone === "column" ? "column" : "tab" });
        const current = docDrop();
        if (current?.pane === pane && current.zone === next.zone && current.side === next.side) return;
        setDocDrop({ pane, zone: next.zone, side: next.side, rect: { left: 0, top: 0, width: 0, height: 0 } });
      };
      if (!column) return hint(null);
      if (column.classList.contains("file-viewer-empty-side")) return hint({ zone: "fill", text: "Open in this column" });
      const side = [...column.parentElement!.children].filter((child) => child.classList.contains("workspace-preview") && !child.classList.contains("file-viewer-empty-side")).indexOf(column);
      const own = draggedFileTab?.pane === pane ? draggedFileTab : null;
      const rect = column.getBoundingClientRect();
      const beside = held.length === 1 && !hasEmptySide(pane) && !event.target.closest(".workspace-preview-header") && event.clientX > rect.left + rect.width / 2;
      if (beside) return hint(own && (fileTabsOf(pane, own.side)?.entries.length ?? 1) < 2 ? null : { zone: "column", text: "Open in a new column" });
      return hint(own?.side === side ? null : { zone: "side", side, text: "Add as a tab here" });
    }
    // A place's tabs dropped on their own pane: only its edges, a pane of their own.
    if ((draggedGroup ?? draggedFileTab)?.pane === pane && zone === "middle") { setDragHint(null); return void setDocDrop(null); }
    const named = (view: SplitView | null) => `“${viewName(view)}”`;
    const hint: { text: string; icon: DragHintIcon } = zone !== "middle"
      ? { text: draggedPane !== null ? `Move to the ${zone} of ${named(viewOf(pane))}` : draggedGroup ? `Open these tabs in a new pane on the ${zone}` : `Open in a new pane on the ${zone}`, icon: zone }
      : draggedPane !== null ? { text: `Swap with ${named(viewOf(pane))}`, icon: "swap" }
      : draggedGroup ? { text: "Move these tabs here", icon: "tab" }
      : panesShown().some((other) => viewOf(other) === draggedView) ? { text: "Already open: go to it", icon: "here" }
      : draggedView.startsWith("chat:") && activeChatOf(pane) ? { text: "Add as a tab here", icon: "tab" }
      : parseFileView(viewOf(pane))?.length === 0 ? { text: "Open in this pane", icon: "here" }
      : { text: `Open here in place of ${named(viewOf(pane))}`, icon: "here" };
    setDragHint({ x: event.clientX, y: event.clientY, ...hint });
    // The wash is the target itself: an edge's band, else the pane between them.
    const rect = dropWash(box, zone, edge, edges);
    const current = docDrop();
    if (current?.pane === pane && current.zone === zone) return;
    setDocDrop({ pane, zone, rect: { ...rect, top: box.top, height: box.height } });
  };
  const endDocDrag = () => { draggedView = null; draggedPane = null; draggedGroup = null; draggedFileTab = null; setDocDrop(null); setDragHint(null); };
  /*
   * A pane's document moved by its header, among the panes already open: onto
   * another pane's middle the two swap; onto its far edge the document moves
   * past it, each pane between shifting one place back -- a swap when they are
   * neighbours; its near edge is where the document already is, so nothing.
   */
  const movePaneDocument = async (from: PaneKey, target: { pane: PaneKey; zone: "left" | "middle" | "right" }) => {
    if (target.zone === "middle") return void await swapPanes(from, false, target.pane);
    const panes = panesShown();
    let at = panes.indexOf(from);
    const to = panes.indexOf(target.pane);
    // Neighbour by neighbour, each a swap, by position (a swap of two panes
    // beside A reorders their keys) -- all within one fade of the panes
    // involved, the old layout showing until the documents have loaded.
    const involved = panes.slice(Math.min(at, to), Math.max(at, to) + 1).map(paneElement).filter((element): element is HTMLElement => Boolean(element));
    await crossfadeUnder(involved, async () => {
      while (at !== to) {
        const next = at < to ? at + 1 : at - 1;
        const now = panesShown();
        await swapPanes(now[Math.min(at, next)]!, false, now[Math.max(at, next)]!, false);
        at = next;
      }
    });
    focusAnyPane(panesShown()[to]!);
  };
  const nearEdge = (from: PaneKey, pane: PaneKey, zone: "left" | "middle" | "right") => {
    const panes = panesShown();
    return zone === (panes.indexOf(from) < panes.indexOf(pane) ? "left" : "right");
  };
  /*
   * A place's tabs moved together: onto a pane's middle they join its tabs
   * (taking the pane, if it shows something else); onto an edge they open a
   * pane there. The pane they leave shows its tab used last; one left with
   * none closes.
   */
  const moveTabGroup = async (group: { pane: PaneKey; ids: string[] }, target: { pane: PaneKey; zone: "left" | "middle" | "right" }, recent: string) => {
    const source = tabsOf(group.pane);
    if (!source) return;
    const remaining = source.ids.filter((id) => !group.ids.includes(id));
    let pane: PaneKey = target.pane;
    // Moving: the new pane briefly shows the chat its source still shows.
    swappingPanes = true;
    try {
      if (target.zone !== "middle") {
        const free = freeSlot() ?? undefined;
        if (free === undefined) return;
        const index = panesShown().indexOf(target.pane);
        pane = free;
        if (!setSlotView(free, `chat:${recent}`, false, target.zone === "right" ? index : Math.max(0, index - 1))) return;
      }
      const held = pane === target.pane ? tabsOf(pane)?.ids.filter((id) => !group.ids.includes(id)) ?? [] : [];
      const ids = [...held, ...group.ids].slice(-TAB_CAP);
      setPaneTabs((current) => ({
        ...current,
        [String(group.pane)]: { ids: remaining, used: source.used.filter((id) => remaining.includes(id)) },
        [String(pane)]: { ids, used: [recent, ...ids.filter((id) => id !== recent)] },
      }));
      if (remaining.length && group.ids.includes(activeChatOf(group.pane) ?? "")) await switchTab(group.pane, source.used.find((id) => remaining.includes(id)) ?? remaining[0]!);
      if (pane === target.pane) await switchTab(pane, recent);
    } finally {
      swappingPanes = false;
    }
    if (!remaining.length) closePane(group.pane);
    reconcileTabs();
    focusAnyPane(pane);
  };
  const onDocDrop = async (event: DragEvent) => {
    const target = docDrop();
    let view = draggedView;
    const fromPane = draggedPane;
    const group = draggedGroup;
    const fileTab = draggedFileTab;
    endDocDrag();
    if (!target || !view || !event.dataTransfer?.types.includes(DOC_DRAG_TYPE)) return;
    event.preventDefault();
    if (target.zone === "dock") return dockPane(target.pane);
    if (target.zone === "side" || target.zone === "column" || target.zone === "fill") {
      const entry = parseFileView(view)?.[0];
      const shown = parseFileView(viewOf(target.pane)) ?? [];
      if (!entry || !shown.length) return;
      if (target.zone === "fill") fillEmptySide(target.pane, entry);
      else if (target.zone === "column") { setPaneView(target.pane, formatFileView([shown[0]!, entry])); focusColumn(target.pane, 1); }
      else {
        const side = target.side ?? 0;
        if (!shown[side]) return;
        if (!sameFileEntry(shown[side]!, entry)) {
          if (handlesOf(target.pane)[side]?.hasUnsavedChanges() && !window.confirm("Discard unsaved changes and show another file?")) return;
          handlesOf(target.pane)[side]?.discardChanges();
          keepFileNext.add(sideKey(target.pane, side));
          setPaneView(target.pane, formatFileView(shown.map((item, at) => at === side ? entry : item)));
        }
        focusColumn(target.pane, side);
      }
      if (fileTab) queueMicrotask(() => leaveSide(fileTab.pane, fileTab.side, fileTab.key));
      return;
    }
    const placed = { ...target, zone: target.zone };
    if (fromPane !== null) return void await movePaneDocument(fromPane, placed);
    if (group) return void await moveTabGroup(group, placed, view.slice("chat:".length));
    if (fileTab) {
      await dropDocument(placed, view);
      return leaveSide(fileTab.pane, fileTab.side, fileTab.key);
    }
    return dropDocument(placed, view);
  };
  const dropDocument = async (target: { pane: PaneKey; zone: "left" | "middle" | "right" }, view: string) => {
    if (view === "tool:terminal") { const id = await pickShell(); if (!id) return; view = `term:${id}`; }
    const next = view as SplitView;
    const docked = dockedSlots().find((slot) => slotView(slot) === next);
    if (docked !== undefined) {
      if (!undockPane(docked, false) || !shownSlots().includes(docked)) return;
      if (target.pane === docked) return focusPane(docked);
      return void await movePaneDocument(docked, target);
    }
    const showing = panesShown().find((pane) => viewOf(pane) === next);
    if (showing !== undefined) return focusAnyPane(showing);
    if (isToolView(next) && panelOpen() && dockTool() === next) closePanel();
    if (target.zone === "middle") {
      const held = parseFileView(viewOf(target.pane));
      const adding = parseFileView(next);
      if (held?.length === 1 && adding && !sameFileEntry(held[0]!, adding[0]!)) setPaneView(target.pane, formatFileView([held[0]!, adding[0]!]));
      else {
        // A chat on a pane of chats joins it as a kept tab (6c).
        if (next.startsWith("chat:") && activeChatOf(target.pane)) keepNext.add(String(target.pane));
        setPaneView(target.pane, next);
      }
      return focusAnyPane(target.pane);
    }
    const free = freeSlot() ?? undefined;
    if (free === undefined) return;
    const index = panesShown().indexOf(target.pane);
    if (target.zone === "right") { if (setSlotView(free, next, false, index)) focusPane(free); return; }
    if (index > 0) { if (setSlotView(free, next, false, index - 1)) focusPane(free); return; }
    // Left of pane A: the new document takes pane A, and pane A's moves right.
    if (setSlotView(free, next, false, 0)) await swapPanes("main");
    focusAnyPane("main");
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
  // Not remounted when the shell changes: the terminal switches shells itself.
  const renderTerminalDocument = (pane: PaneKey, id: () => string) => {
    const [record, setRecord] = createSignal<{ projectId: string; cwd?: string | null } | null | undefined>(undefined);
    createEffect(on(id, (shell) => {
      if (untrack(record)) return;
      void api<{ ptys: { id: string; projectId: string; cwd?: string | null; status: string }[] }>("/v0/ptys")
        .then(({ ptys = [] }) => { if (id() === shell) setRecord(ptys.find((item) => item.id === shell && item.status === "running") ?? null); })
        .catch(() => setRecord(null));
    }));
    const placeName = (projectId: string) => projectId === "computer" || projectId.startsWith("computer:") ? "Computer" : catalogue.projects().find((item) => item.id === projectId)?.name || "Chats";
    return <div class="pane-terminal">
      <Show when={record()} fallback={<Show when={record() === null}>
        <div class="pane-terminal-gone"><span>This terminal has ended.</span>{paneTabActions(pane)}</div>
      </Show>}>{(found) =>
        <TerminalPane projectId={found().projectId} projectName={placeName(found().projectId)} workingRoot={found().cwd || undefined} terminalId={id()} onShown={(next) => setPaneView(pane, `term:${next}`)} headerActions={paneTabActions(pane)} />
      }</Show>
    </div>;
  };
  const focusAnyPane = (pane: PaneKey) => {
    if (parseFileView(viewOf(pane))) return focusColumn(pane, fileFocus()[String(pane)] ?? 0);
    if (pane === "main") { setKeyboardPane("main"); enterMainPane(); } else focusPane(pane);
  };
  /*
   * Focus is a pane's; a file viewer's current column is where in it. This one
   * setter moves both and puts DOM focus in the column -- its editor once it has
   * drawn (a tab switch redraws it), else the column, else the viewer -- so
   * nothing else decides which pane has the keyboard.
   */
  function focusColumn(pane: PaneKey, side: number) {
    setKeyboardPane(pane);
    focusFileEntry(pane, side);
    setFilePane(pane);
    let tries = 0;
    const land = () => {
      const surface = paneElement(pane)?.querySelector<HTMLElement>(".file-viewer-surface");
      const columns = [...(surface?.querySelectorAll<HTMLElement>(".workspace-file-viewer > .workspace-preview:not(.file-viewer-empty-side)") ?? [])];
      const column = side >= columns.length ? surface?.querySelector<HTMLElement>(".file-viewer-empty-side") : columns[side];
      const active = document.activeElement;
      if (column?.contains(active) && active !== column) return;
      // Focus taken elsewhere meanwhile is left there; the pane's own frame or a column is not elsewhere.
      const idle = !active || active === document.body || Boolean(paneElement(pane)?.contains(active) && active.matches(".file-viewer-surface, .workspace-file-viewer > .workspace-preview"));
      if (tries && !idle) return;
      const editor = column?.querySelector<HTMLElement>(".cm-content");
      (editor ?? column ?? surface)?.focus({ preventScroll: true });
      // A viewer's first load (its chunks) or a large file draws late: up to 6s, never taking focus back.
      if (!editor && tries++ < 100) setTimeout(land, 60);
    };
    requestAnimationFrame(land);
  }
  // A review comment on a file, for the viewer that shows it to scroll to.
  const [fileReveal, setFileReveal] = createSignal<{ entry: FileEntry; request: ReviewNavigationRequest } | null>(null);
  const openFileDocument = (entry: FileEntry, options: { beside: boolean; edit: boolean; reveal?: ReviewNavigationRequest }) => {
    if (options.edit) pendingFileEdit = entry;
    setFileReveal(options.reveal ? { entry, request: options.reveal } : null);
    for (const pane of panesShown()) {
      const index = parseFileView(viewOf(pane))?.findIndex((item) => sameFileEntry(item, entry)) ?? -1;
      if (index < 0) continue;
      focusFileEntry(pane, index);
      setFilePane(pane);
      focusAnyPane(pane);
      if (options.edit) { pendingFileEdit = null; handlesOf(pane)[index]?.edit(); }
      return;
    }
    // Open as a tab already: shown there.
    if (!options.beside) for (const pane of panesShown()) for (const side of [0, 1]) {
      if (fileTabsOf(pane, side)?.entries.some((item) => sameFileEntry(item, entry))) return showFileTab(pane, side, fileEntryKey(entry));
    }
    const shownFilePane = () => { const pane = filePane(); return pane !== null && panesShown().includes(pane) && parseFileView(viewOf(pane)) ? pane : null; };
    // Alt: beside a file already open -- the second side of a viewer with
    // one, the file pane's first -- and only a new pane once they are full.
    if (options.beside) {
      const roomy = [shownFilePane(), ...panesShown()].find((pane) => pane !== null && (parseFileView(viewOf(pane))?.length ?? 2) < 2);
      if (roomy !== undefined && roomy !== null) {
        setPaneView(roomy, formatFileView([...parseFileView(viewOf(roomy))!, entry]));
        return focusColumn(roomy, 1);
      }
    }
    const pane = options.beside ? null : shownFilePane();
    if (pane === null) {
      const view = formatFileView([entry]);
      openBeside(view, false);
      const placed = shownSlots().find((slot) => slotView(slot) === view);
      if (placed !== undefined) focusColumn(placed, 0);
      return;
    }
    const target = parseFileView(viewOf(pane))!;
    if (!target.length) { setPaneView(pane, formatFileView([entry])); return focusColumn(pane, 0); }
    if (emptyFocused(pane)) return fillEmptySide(pane, entry);
    const index = Math.min(fileFocus()[String(pane)] ?? 0, target.length - 1);
    if (handlesOf(pane)[index]?.hasUnsavedChanges() && !window.confirm("Discard unsaved changes and open another file?")) return;
    handlesOf(pane)[index]?.discardChanges();
    // Ctrl keeps the file it replaces as a tab (6c).
    if (tabActivation()) keepFileNext.add(sideKey(pane, index));
    setPaneView(pane, formatFileView(target.map((item, at) => at === index ? entry : item)));
    focusColumn(pane, index);
  };
  // The split opens an empty second side, which the next file opened into the viewer fills.
  // An empty column beside a viewer's one file: at 1 (the split) or 0 (its last tab dragged away).
  const [emptySides, setEmptySides] = createSignal<Record<string, 0 | 1>>({});
  const hasEmptySide = (pane: PaneKey) => emptySides()[String(pane)] !== undefined && parseFileView(viewOf(pane))?.length === 1;
  const emptyFirst = (pane: PaneKey) => hasEmptySide(pane) && emptySides()[String(pane)] === 0;
  // The empty column is focused as index 1, past the one file, wherever it sits.
  const emptyFocused = (pane: PaneKey) => hasEmptySide(pane) && fileFocus()[String(pane)] === 1;
  // A file into the empty column: the viewer holds two again, in their places.
  const fillEmptySide = (pane: PaneKey, entry: FileEntry) => {
    const held = parseFileView(viewOf(pane)) ?? [];
    if (held.length !== 1) return;
    const first = emptyFirst(pane);
    if (first) moveSideTabs(sideKey(pane, 0), sideKey(pane, 1));
    setPaneView(pane, formatFileView(first ? [entry, held[0]!] : [held[0]!, entry]));
    focusColumn(pane, first ? 0 : 1);
  };
  const closeEmptySide = (pane: PaneKey) => { setEmptySides((current) => { const next = { ...current }; delete next[String(pane)]; return next; }); focusFileEntry(pane, 0); };
  createEffect(() => { for (const key of Object.keys(emptySides())) { const pane: PaneKey = key === "main" ? "main" : Number(key); if (!panesShown().includes(pane) || parseFileView(viewOf(pane))?.length !== 1) untrack(() => closeEmptySide(pane)); } });
  const [sideShares, setSideShares] = createSignal<Record<string, number>>({});
  const splitFileViewer = (pane: PaneKey) => {
    const entries = parseFileView(viewOf(pane));
    if (!entries || entries.length !== 1) return;
    setEmptySides((current) => ({ ...current, [String(pane)]: 1 }));
    focusFileEntry(pane, 1);
    setFilePane(pane);
  };

  const noteFileLoaded = (pane: PaneKey, index: number, file: FileSummary | null) => {
    const entry = parseFileView(viewOf(pane))?.[index];
    if (!file || !entry || !pendingFileEdit || !sameFileEntry(pendingFileEdit, entry)) return;
    pendingFileEdit = null;
    handlesOf(pane)[index]?.edit();
  };
  const setFileMode = (pane: PaneKey, index: number, mode: FileEntry["mode"]) => {
    const current = parseFileView(viewOf(pane));
    if (current) setPaneView(pane, formatFileView(current.map((item, at) => at === index ? { projectId: item.projectId, path: item.path, ...(mode ? { mode } : {}) } : item)));
  };
  // Each side is headed by its tabs (6c); a viewer with none says how to fill it.
  const renderFileViewer = (pane: PaneKey) => {
    const entries = () => parseFileView(viewOf(pane)) ?? [];
    // Focusable itself, so an image or PDF side still takes the keyboard (a click, Ctrl+Shift+2).
    return <div class="workspace-split-surface file-viewer-surface" tabIndex={-1}>
      <Show when={entries().length} fallback={<>
        <header class="chat-header file-tabs-header"><nav class="chat-header-title"><strong>No file open</strong></nav><div class="chat-header-actions">{paneTabActions(pane)}</div></header>
        <div class="file-viewer-empty" role="status">Open a file from Files, or Ctrl-click one to add it as a tab.</div>
      </>}>
        <FileViewer entries={entries()} focused={keyboardPane() === pane ? fileFocus()[String(pane)] ?? 0 : -1} wrap={(side) => sideWrap(pane, side)} onToggleWrap={(side) => toggleSideWrap(pane, side)} commentChatId={focusedChat().loadedId()}
          tabs={(side) => fileSideTabs(pane, side)} paneActions={() => paneTabActions(pane)}
          sideMenu={(side) => fileSideMenu(pane, side)} onSwapSides={() => swapSides(pane)}
          share={sideShares()[String(pane)]} onShare={(share) => setSideShares((current) => ({ ...current, [String(pane)]: share }))}
          splitEmpty={hasEmptySide(pane)} emptyFirst={emptyFirst(pane)}
          emptySide={<Show when={hasEmptySide(pane)}>
            <section class="workspace-preview file-viewer-empty-side" tabIndex={-1} style={emptyFirst(pane) ? { order: -1 } : undefined} data-focused={keyboardPane() === pane && emptyFocused(pane)} onPointerDown={() => { focusFileEntry(pane, 1); setFilePane(pane); }}>
              <header class="workspace-preview-header">
                <nav aria-label="Tabs" class="chat-header-title chat-header-tabs file-side-tabs"><div class="pane-tabs"><span class="pane-tab pane-tab-active pane-tab-none">
                  <span class="pane-tab-open"><span class="pane-tab-title"><span>No file open</span></span></span>
                  <button type="button" class="pane-tab-close" tabIndex={-1} aria-label="Close this side" title="Close this side" onClick={() => closeEmptySide(pane)}><XIcon /></button>
                </span></div></nav>
                <Show when={!emptyFirst(pane)}>{paneTabActions(pane)}</Show>
              </header>
              <div class="file-viewer-empty" role="status">Open a file from Files to show it here.</div>
            </section>
          </Show>}
          onFocusEntry={(index) => { focusFileEntry(pane, index); setFilePane(pane); }} onSplit={() => splitFileViewer(pane)} onCloseEntry={(index) => { const entry = entries()[index]; if (entry) closeFileTab(pane, index, fileEntryKey(entry)); }}
          onSetMode={(index, mode) => setFileMode(pane, index, mode)}
          onLoaded={(index, file) => noteFileLoaded(pane, index, file)} reveal={fileReveal()} ref={(index, handle) => { handlesOf(pane)[index] = handle; setHandlesChanged((count) => count + 1); }} />
      </Show>
    </div>;
  };

  /*
   * A chat or page in a pane beside A (stages 4, 5, 6b). Pane A keeps the URL
   * and the catalogue's selection; the pane with the keyboard owns the
   * composer's keys, dictation and the sidebar's current row, and the other
   * panes' chats are marked open there.
   */
  const slotChatId = (slot: number) => { const view = slotView(slot); return view?.startsWith("chat:") ? view.slice("chat:".length) : null; };
  // A page in a pane: "dashboard", or "project:<id>" (stage 5d).
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
  // Ctrl+Shift+2 with panes beside A: from elsewhere, back to the pane last
  // used; from a pane, to the next, round. Each lands where its focus last was.
  // `step` -1 goes the other way round (Previous pane).
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
  // A press on what takes no focus (an image), or into a frame (a PDF), still gives its pane the keyboard.
  const notePanePress = (event: PointerEvent) => { const pane = paneOf(event.target instanceof Element ? event.target : null); if (pane !== null) setKeyboardPane(pane); };
  const noteFrameFocus = () => setTimeout(() => { const frame = document.activeElement; if (frame instanceof HTMLIFrameElement || frame instanceof HTMLEmbedElement || frame instanceof HTMLObjectElement) { const pane = paneOf(frame); if (pane !== null) setKeyboardPane(pane); } });
  document.addEventListener("pointerdown", notePanePress, true);
  window.addEventListener("blur", noteFrameFocus);
  onCleanup(() => { document.removeEventListener("focusin", noteKeyboardSide); document.removeEventListener("pointerdown", notePanePress, true); window.removeEventListener("blur", noteFrameFocus); });
  const mainChatId = () => routeKind() === "chat" && !paneAOverride() ? catalogue.selectedId() : null;
  const openChatBeside = (target: ChatSummary, project: Project) => {
    if (isMobileLayout()) return void openChat(target, project);
    if (target.id === mainChatId()) return;
    markChatRead(catalogue, target);
    openBeside(`chat:${target.id}`, false);
  };
  // Alt on the click or key that opened a chat, from a page that has no way
  // to say so itself.
  const altActivation = () => { const event = window.event; return (event instanceof MouseEvent || event instanceof KeyboardEvent) && event.altKey; };
  // Ctrl (Cmd) on the click that opened a chat: as a tab in the focused pane.
  const tabActivation = () => { const event = window.event; return !isMobileLayout() && (event instanceof MouseEvent || event instanceof KeyboardEvent) && (event.ctrlKey || event.metaKey); };
  // A kept tab in the focused pane of chats; false when that pane shows something else.
  const openChatAsTab = (target: ChatSummary, project: Project) => {
    const view: SplitView = `chat:${target.id}`;
    if (target.id === mainChatId() || focusPaneShowing(view) || switchToTab(view)) return true;
    const pane = keyboardPaneSlot() ?? "main";
    if (!activeChatOf(pane)) return false;
    markChatRead(catalogue, target);
    keepNext.add(String(pane));
    if (pane === "main") void openChat(target, project); else setSlotView(pane, view);
    focusAnyPane(pane);
    return true;
  };
  // What a pane beside A already shows is gone to there, not opened again in pane A.
  const focusPaneShowing = (view: SplitView) => {
    const slot = shownSlots().find((candidate) => slotView(candidate) === view);
    if (slot === undefined) return false;
    focusPane(slot);
    return true;
  };
  /*
   * Open where the reader is working: a sidebar row, a chat search result or
   * a page's chat replaces the document of the pane with the keyboard --
   * pane A's by the route, another pane's by its view. What a pane already
   * shows is gone to there instead.
   */
  const keyboardPaneSlot = () => { const pane = keyboardPane(); return pane !== "main" && shownSlots().includes(pane) ? pane : null; };
  const openInFocusedPane = async (view: SplitView, inPaneA: () => unknown) => {
    if (focusPaneShowing(view) || switchToTab(view)) return;
    const slot = keyboardPaneSlot();
    // Pane A goes by its route, and the route changing clears what showed
    // over it; only going to the route it already has needs clearing here.
    if (slot === null) {
      if (paneAOverride() && view === paneARouteView()) setPaneAOverride(null);
      return void await inPaneA();
    }
    if (!setSlotView(slot, view)) return;
    focusPane(slot);
    // The document arriving can take the focused element with it; the pane
    // keeps the keyboard.
    // keeps the keyboard, unless the person has since gone elsewhere.
    const id = view.startsWith("chat:") ? view.slice("chat:".length) : null;
    let moved = false;
    const note = () => { moved = true; };
    window.addEventListener("pointerdown", note, true);
    window.addEventListener("keydown", note, true);
    const session = paneSlot(slot).session.chat;
    // A dashboard or project page is ready once its unsent chat is in the composer.
    const drafts = view === "page:dashboard" || view.startsWith("page:project:");
    await waitFor(() => id ? session.loadedId() === id && session.presentation().kind === "ready" && chatDrawn(slot)
      : !drafts || Boolean(paneSlot(slot).draft && session.loadedId() === paneSlot(slot).draft!.id), 3000);
    window.removeEventListener("pointerdown", note, true);
    window.removeEventListener("keydown", note, true);
    if (!moved && shownSlots().includes(slot) && !paneElement(slot)?.contains(document.activeElement)) focusPane(slot);
  };
  const openChatHere = async (target: ChatSummary, project: Project) => {
    if (tabActivation() && openChatAsTab(target, project)) return;
    if (keyboardPaneSlot() !== null && target.id === mainChatId()) { setKeyboardPane("main"); return enterMainPane(); }
    if (keyboardPaneSlot() !== null) markChatRead(catalogue, target);
    await openInFocusedPane(`chat:${target.id}`, () => openChat(target, project));
  };
  const openProjectHere = (project: Project) => openInFocusedPane(`page:project:${project.id}`, () => openProject(project));
  const openDashboardHere = () => openInFocusedPane("page:dashboard", () => openDashboard());
  const openComputerHere = () => openInFocusedPane("page:computer", () => openComputer());
  const openHarnessHere = (id: string) => openInFocusedPane(`page:harness:${encodeURIComponent(id)}`, () => openComputerHarness(id));
  const openChatFromPage = async (target: ChatSummary, project: Project) => {
    if (altActivation()) openChatBeside(target, project); else await openChatHere(target, project);
  };
  for (const pane of paneSlots) {
    const slot = pane.index;
    const side = pane.session;
    // The pane follows its view. A missing chat in the loaded catalogue is
    // gone even if it was deleted before this page restored the saved pane.
    createEffect(on(() => slotChatId(slot), (id) => {
      const thread = paneThreads.get(slot);
      if (thread && id !== thread) { paneThreads.delete(slot); void api(`/v0/sessions/${encodeURIComponent(thread)}`, { method: "DELETE" }).catch(() => {}); }
    }));
    createEffect(on(() => [slotChatId(slot), catalogue.loaded(), catalogue.projects()] as const, ([id, loaded, projects]) => {
      if (!id) {
        if (!untrack(() => slotPage(slot)) && untrack(side.selectedId)) side.close();
        return;
      }
      if (!loaded) return;
      const found = projects.flatMap((project) => project.sessions.map((item) => ({ chat: item, project }))).find((item) => item.chat.id === id);
      if (!found) {
        // setProjects marks the catalogue loaded before publishing its list.
        // Recheck after both writes, and never close a pane that moved on.
        queueMicrotask(() => {
          if (slotChatId(slot) !== id || !catalogue.loaded()
            || catalogue.projects().some((project) => project.sessions.some((item) => item.id === id))) return;
          if ((tabsOf(slot)?.ids.length ?? 0) > 1) void closeTab(slot, id);
          else setSlotView(slot, null);
        });
        return;
      }
      if (untrack(side.selectedId) !== id) void side.open(found.chat, found.project).catch(showError);
    }));
    /*
     * A page in a pane holds an unsent chat of its own for its composer, as
     * pane A's dashboard does: made when the page opens, discarded when it
     * closes unsent, and the pane's chat once it is sent.
     */
    createEffect(on(() => [slotPage(slot), catalogue.loaded(), templatesLoading(), shownSlots().includes(slot)] as const, ([page, loaded, loading, shown]) => {
      if (!page || page === "computer" || page.startsWith("harness:")) return discardPaneDraft(pane);
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
  function discardPaneDraft(pane: PaneSlot) {
    const draft = pane.draft;
    if (!draft) return;
    pane.draft = null;
    if (untrack(pane.session.selectedId) === draft.id) pane.session.close();
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
    setSlotView(pane.index, `chat:${id}`);
    await side.chat.send();
  };
  const openPageBeside = (page: "dashboard" | "computer" | `project:${string}` | `harness:${string}`) => { if (!isMobileLayout()) openBeside(`page:${page}`, false); };
  // The same chat in two panes is one chat: pane A taking it closes the other.
  createEffect(() => { const id = mainChatId(); if (swappingPanes) return; for (const slot of shownSlots()) if (id && slotChatId(slot) === id) setSlotView(slot, null); });
  /*
   * The pane with the keyboard, and its chat: what the palette, the leader's
   * chat commands, the model selector and the dock act on, as if each pane
   * were a Conduit tab of its own. Pane A (the main pane) unless a pane
   * beside it holds a chat and was the last to have focus.
   */
  const focusedSlot = () => { const slot = keyboardSlot(); return slot !== null && paneSlot(slot).session.selectedId() ? paneSlot(slot) : null; };
  const focusedSession = (): ChatSession => focusedSlot()?.session ?? session;
  const focusedChat = () => focusedSession().chat;
  const focusedModels = () => focusedSession().models;
  const sideFocused = () => focusedSlot() !== null;
  const focusedChatId = () => focusedSlot()?.session.selectedId() ?? catalogue.selectedId();
  // A sidebar command's target when it is another pane's chat; pane A's is the sidebar's own.
  const focusedTarget = () => focusedSlot()?.session.selected() ?? {};
  /*
   * The dock follows places, not panes (6d-1), and its place is read from the
   * pane with the keyboard -- what that pane shows, never a remembered pane or
   * the route beneath pane A: a chat's or page's project, a file viewer's
   * current file's. A terminal or tool has no place, so it leaves the dock
   * where it was; pane A showing its own route gives the route's place.
   */
  type PlaceSelection = { project: Project } | NonNullable<ReturnType<ReturnType<typeof paneSlot>["session"]["selected"]>>;
  const placeOf = (pane: PaneKey): PlaceSelection | "route" | null => {
    if (!panesShown().includes(pane)) return null;
    if (pane === "main" && !paneAOverride()) return "route";
    const view = viewOf(pane);
    const byId = (id: string | undefined) => catalogue.projects().find((item) => item.id === id);
    const files = parseFileView(view);
    if (files) { const project = byId(files[Math.min(fileFocus()[String(pane)] ?? 0, files.length - 1)]?.projectId); return project ? { project } : null; }
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
  const dockProject = () => dockSelection()?.project ?? selectedProject();
  const dockScope = () => dockSelection() ? `project:${dockSelection()!.project.id}` : workspacePanelScope();
  /*
   * Swapping and closing panes, from each pane's breadcrumb. Pane A swaps with
   * the pane to its right and the others with the pane to their left. Pane A
   * holds only chats and pages, so a swap or a close that would put a file or
   * a tool there is not offered. Between panes beside A the panes themselves
   * change places; with pane A the documents move, the panes stay.
   */
  let swappingPanes = false;
  function paneAView(): SplitView | null { return paneAOverride() ?? paneARouteView(); }
  // Pane A's route as a view, whatever shows over it.
  function paneARouteView(): SplitView | null {
    if (routeKind() === "chat" && catalogue.selectedId()) return `chat:${catalogue.selectedId()}`;
    if (routeKind() === "dashboard") return "page:dashboard";
    if (routeKind() === "computer" && !computerHarness()) return "page:computer";
    if (routeKind() === "computer" && !harnessThread()) return `page:harness:${encodeURIComponent(computerHarness())}`;
    if (routeKind() === "project" && selectedProject()) return `page:project:${selectedProject()!.id}`;
    return null;
  };
  const openInPaneA = async (view: SplitView) => {
    if (view === "page:dashboard") return openDashboard();
    if (view === "page:computer") return openComputer();
    if (view.startsWith("page:harness:")) return openComputerHarness(decodeURIComponent(view.slice("page:harness:".length)));
    if (view.startsWith("page:project:")) {
      const project = catalogue.projects().find((item) => item.id === view.slice("page:project:".length));
      return project ? openProject(project) : undefined;
    }
    const id = view.slice("chat:".length);
    for (const project of catalogue.projects()) {
      const found = project.sessions.find((item) => item.id === id);
      if (found) return openChat(found, project);
    }
  };
  const swapPartner = (pane: PaneKey): PaneKey | null => {
    const shown = shownSlots();
    if (pane === "main") return shown[0] !== undefined && paneAView() ? shown[0] : null;
    const at = shown.indexOf(pane);
    if (at === 0) return paneAView() ? "main" : null;
    return at > 0 ? shown[at - 1]! : null;
  };
  /*
   * Which pane a swap button trades with: the pane that had the keyboard when
   * it was pressed; pressed in the pane that has it, the neighbour above --
   * but the middle of three trades with the pane used before it, else its left.
   */
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
  const waitFor = (ready: () => boolean, timeout = 800) => new Promise<void>((resolve) => {
    const start = performance.now();
    const check = () => ready() || performance.now() - start > timeout ? resolve() : requestAnimationFrame(check);
    check();
  });
  /*
   * The swap's motion. By default both panes' last frames stay up while the
   * documents change places and load under them, then the two crossfade. With Shift, the
   * slide being compared: the right pane fades out, the left slides over into
   * its place unchanged -- no width change, so nothing re-renders while it
   * moves -- and what was on the right fades in on the left. Either way the
   * panes keep their widths: a width belongs to the position, not the document.
   */
  const SWAP_FADE_MS = 100;
  // A chat is drawn once its transcript is in the pane, not merely loaded:
  // it renders a moment after, and a crossfade before then shows it arrive.
  const chatDrawn = (pane: PaneKey) => Boolean(paneElement(pane)?.querySelector(".thread, .empty-thread"));
  // A pane's last frame, held over its place while what is under it changes.
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
  // The panes' last frames stay up while the documents move and load under
  // them, then the ghosts fade off them (~100ms).
  const crossfadeUnder = async (elements: HTMLElement[], place: () => Promise<void>) => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ghosts = elements.map(ghostOf);
    for (const element of elements) element.style.opacity = "0";
    try { await place(); } finally {
      // The panes come back whole under their ghosts, and only the ghosts
      // fade: both layers at half opacity let the background through.
      for (const element of elements) element.style.opacity = "";
      await Promise.all(ghosts.map(async (ghost) => { if (!still) await ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SWAP_FADE_MS, easing: "ease-out", fill: "forwards" }).finished.catch(() => undefined); ghost.remove(); }));
    }
  };
  const crossfadeSwap = (left: HTMLElement, right: HTMLElement, place: () => Promise<void>) => crossfadeUnder([left, right], place);
  const animateSwap = async (left: HTMLElement, right: HTMLElement, reorder: boolean, placeRight: () => Promise<void> | void, placeLeft: () => Promise<void> | void) => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!still) {
      await right.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-out", fill: "forwards" }).finished;
      left.style.zIndex = "5";
      await left.animate([{ transform: "none" }, { transform: `translateX(${right.getBoundingClientRect().left - left.getBoundingClientRect().left}px)` }], { duration: 220, easing: "cubic-bezier(.2,.7,.2,1)", fill: "forwards" }).finished;
    }
    await placeRight();
    // Reordered, the slid pane now lives on the right and the other on the
    // left; otherwise the right pane now shows what slid over it, and the
    // left goes home unseen to take what was on the right.
    const incoming = reorder ? right : left;
    incoming.style.opacity = "0";
    for (const element of [left, right]) { element.getAnimations().forEach((animation) => animation.cancel()); element.style.zIndex = ""; }
    await placeLeft();
    if (!still) await incoming.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SWAP_FADE_MS, easing: "ease-out" }).finished;
    incoming.style.opacity = "";
  };
  // `fade: false` places the documents at once, for a caller fading around several swaps.
  const swapPanes = async (pane: PaneKey, slide = false, withPane?: PaneKey, fade = true) => {
    const partner = withPane ?? swapPartner(pane);
    if (partner === null || swappingPanes) return;
    const [leftPane, rightPane] = pane === "main" || (partner !== "main" && shownSlots().indexOf(partner) > shownSlots().indexOf(pane as number)) ? [pane, partner] : [partner, pane];
    const left = paneElement(leftPane);
    const right = paneElement(rightPane);
    if (!left || !right) return;
    swappingPanes = true;
    try {
      if (leftPane === "main") {
        const slot = rightPane as number;
        const aView = paneAView()!;
        const bView = slotView(slot)!;
        const unsaved = [...handlesOf("main"), ...handlesOf(slot)].some((handle) => handle?.hasUnsavedChanges());
        if (unsaved && !window.confirm("Discard unsaved changes to swap these panes?")) return;
        movingDocuments = true;
        swapTabs("main", slot);
        const placeRight = async () => {
          setSlotView(slot, aView);
          const id = aView.startsWith("chat:") ? aView.slice("chat:".length) : null;
          await waitFor(() => !id || (paneSlot(slot).session.chat.loadedId() === id && chatDrawn(slot)), 1500);
        };
        const placeLeft = async () => { if (isPaneView(bView)) { setPaneAOverride(null); await openInPaneA(bView); } else setPaneView("main", bView); };
        if (slide) await animateSwap(left, right, false, placeRight, placeLeft);
        else if (!fade) await Promise.all([placeRight(), placeLeft()]);
        else await crossfadeSwap(left, right, async () => { await Promise.all([placeRight(), placeLeft()]); });
      } else {
        const a = leftPane as number;
        const b = rightPane as number;
        const reorder = () => {
          setSlotOrder((order) => order.map((slot) => slot === a ? b : slot === b ? a : slot));
          persistSlots();
        };
        if (slide) await animateSwap(left, right, true, reorder, () => {});
        else if (!fade) reorder();
        else await crossfadeSwap(left, right, async () => reorder());
      }
    } finally {
      swappingPanes = false;
      movingDocuments = false;
      reconcileTabs();
    }
  };
  /*
   * Panes the window is too narrow for move to the dock, as a docked pane
   * does -- a rail icon, shown there on a click -- and come back to the row on
   * their own once it widens. Nothing marks them: a pane in the row that does
   * not fit is simply drawn in the dock until it does.
   */
  const foldedSlots = () => !dockAvailable() || isMobileLayout() ? [] : slotOrder().filter((slot) => slotView(slot) && !isDocked(slot)).slice(0, 2).filter((slot) => !shownSlots().includes(slot));
  const viewName = (view: SplitView | null): string => {
    if (!view) return "";
    if (view.startsWith("chat:")) {
      const id = view.slice("chat:".length);
      const found = catalogue.projects().flatMap((project) => project.sessions).find((item) => item.id === id);
      return found?.title || "New chat";
    }
    if (view === "page:dashboard") return "Conduit Dashboard";
    if (view === "page:computer") return "Computer";
    if (view.startsWith("page:harness:")) { const id = decodeURIComponent(view.slice("page:harness:".length)); return harnessLabelFor(id) || id; }
    if (view.startsWith("page:project:")) return catalogue.projects().find((item) => item.id === view.slice("page:project:".length))?.name || "Project";
    const files = parseFileView(view);
    if (files) return files.length ? files.map((entry) => entry.path.split("/").pop()).join(", ") : "File viewer";
    if (view.startsWith("term:")) return "Terminal";
    return isPanelTab(view) ? WORKSPACE_TOOL_LABELS[view] : "Pane";
  };
  /*
   * Chat tabs (panes-and-rail.md, 6c). A pane showing a chat holds up to
   * five; its view is the active one, the only one mounted, and switching is
   * a document switch in place. A plain open replaces the active tab; Ctrl, a
   * drop on the pane or Alt with no room adds one. Anything but a chat takes
   * the pane and its tabs close. Drafts are kept per chat and each pane's
   * transcript keeps scroll positions, so a tab keeps what a remount would lose.
   */
  type PaneTabs = { ids: string[]; used: string[] };
  const TAB_CAP = 5;
  // The address's tabs, or at a bare start the device's, beside its saved panes.
  const launchTabs = () => {
    if (urlNamesPanes || !atStart) return tabsFromParams(launchUrl.searchParams);
    const params = new URLSearchParams();
    for (const view of initialViews) if (view) params.append("pane", view);
    for (const value of (readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-tabs") || "").split("|").filter(Boolean)) params.append("tabs", value);
    return tabsFromParams(params);
  };
  const [paneTabs, setPaneTabs] = createSignal<Record<string, PaneTabs>>(launchTabs());
  const tabsOf = (pane: PaneKey) => paneTabs()[String(pane)] ?? null;
  // The place a chat tab belongs to, which groups it.
  const tabPlace = (id: string) => catalogue.projects().find((item) => item.sessions.some((chat) => chat.id === id))?.id ?? "chats";
  const activeChatOf = (pane: PaneKey) => { const view = viewOf(pane); return view?.startsWith("chat:") ? view.slice("chat:".length) : null; };
  // The next chat opened into these panes is added as a tab rather than replacing the active one.
  const keepNext = new Set<string>();
  function tabsFromParams(params: URLSearchParams): Record<string, PaneTabs> {
    const order = params.getAll("pane").filter(isSplitView).map((_, index) => index);
    const found: Record<string, PaneTabs> = {};
    for (const value of params.getAll("tabs")) {
      const [position, list] = value.split(":");
      const at = Number(position);
      const key = at === 0 ? "main" : order[at - 1] === undefined ? null : String(order[at - 1]);
      if (key === null || !list) continue;
      const ids = list.split(",").filter(Boolean).slice(0, TAB_CAP);
      found[key] = { ids, used: [...ids] };
    }
    return found;
  }
  const tabParams = () => {
    const panes: PaneKey[] = ["main", ...slotOrder().filter((slot) => slotView(slot))];
    return panes.flatMap((pane, position) => {
      const tabs = tabsOf(pane);
      return tabs && tabs.ids.length > 1 ? [`${position}:${tabs.ids.join(",")}`] : [];
    });
  };
  const reconcileTabs = () => {
    const next = { ...untrack(paneTabs) };
    const panes: PaneKey[] = ["main", ...untrack(slotOrder).filter((slot) => untrack(() => slotView(slot)))];
    for (const key of Object.keys(next)) if (!panes.some((pane) => String(pane) === key)) delete next[key];
    for (const pane of panes) {
      const view = untrack(() => viewOf(pane));
      const key = String(pane);
      if (pane === "main" && !view) continue;
      if (!view?.startsWith("chat:")) { delete next[key]; continue; }
      const id = view.slice("chat:".length);
      const tabs = next[key] ?? { ids: [], used: [] };
      if (tabs.ids.includes(id)) { if (tabs.used[0] !== id) next[key] = { ...tabs, used: [id, ...tabs.used.filter((item) => item !== id)] }; continue; }
      let ids = [...tabs.ids];
      let used = tabs.used.filter((item) => ids.includes(item));
      // A plain open replaces the active tab; only Ctrl (keepNext) adds one.
      const adding = keepNext.delete(key);
      const replaced = adding ? undefined : used.find((item) => ids.includes(item));
      if (replaced) {
        ids = ids.filter((item) => item !== replaced);
        used = used.filter((item) => item !== replaced);
      }
      // Tabs from one place stay together: beside the active tab when it is
      // from there, else at the end of that place's run, else after the
      // active tab's run.
      const place = tabPlace(id);
      const lastOf = (placeId: string) => ids.reduce((last, item, index) => tabPlace(item) === placeId ? index : last, -1);
      const current = used.find((item) => ids.includes(item));
      const at = current && tabPlace(current) === place ? ids.indexOf(current) + 1
        : lastOf(place) >= 0 ? lastOf(place) + 1
        : current ? lastOf(tabPlace(current)) + 1 : ids.length;
      ids.splice(at, 0, id);
      used = [id, ...used];
      while (ids.length > TAB_CAP) {
        const drop = [...used].reverse().find((item) => item !== id && !drafts.draftFor(item));
        if (!drop) { toast.info("Every tab in this pane has an unsent draft; close one to open another."); break; }
        ids = ids.filter((item) => item !== drop);
        used = used.filter((item) => item !== drop);
      }
      next[key] = { ids, used };
      // A chat is a tab in one pane at a time.
      for (const [other, list] of Object.entries(next)) {
        if (other === key || !list.ids.includes(id)) continue;
        next[other] = { ids: list.ids.filter((item) => item !== id), used: list.used.filter((item) => item !== id) };
      }
    }
    setPaneTabs(next);
    reconcileFileTabs();
  };
  createEffect(on(() => [paneAView(), slotOrder().map((slot) => `${slot}=${slotView(slot)}`).join()] as const, () => { if (!swappingPanes) reconcileTabs(); }));
  createEffect(on(() => tabParams().join("|"), (value) => writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-tabs", value), { defer: true }));
  // Stepping round the focused pane's tabs, in the row's order, and the
  // panes (the shortcuts Next/Previous tab and pane).
  // A file viewer's step skips the file showing on its other side.
  // A viewer's tabs in the order they read: its first column's, then its second's.
  const fileTabsToStep = () => {
    const pane: PaneKey = keyboardPaneSlot() ?? "main";
    const shown = parseFileView(viewOf(pane)) ?? [];
    const items = shown.flatMap((entry, side) => (fileTabsOf(pane, side)?.entries ?? [entry]).map((item) => ({ side, key: fileEntryKey(item) })));
    return !isMobileLayout() && items.length > 1 ? { pane, shown, items } : null;
  };
  const tabsToStep = () => { const pane: PaneKey = keyboardPaneSlot() ?? "main"; const list = tabsOf(pane); return !isMobileLayout() && list && list.ids.length > 1 && list.ids.includes(activeChatOf(pane) ?? "") ? { pane, list } : null; };
  const stepTab = (step: number) => {
    const files = fileTabsToStep();
    if (files) {
      const side = shownFileSide(files.pane);
      const at = files.items.findIndex((item) => item.side === side && item.key === fileEntryKey(files.shown[side]!));
      const next = files.items[(at + step + files.items.length) % files.items.length]!;
      return showFileTab(files.pane, next.side, next.key);
    }
    const found = tabsToStep();
    if (!found) return;
    const at = found.list.ids.indexOf(activeChatOf(found.pane)!);
    void switchTab(found.pane, found.list.ids[(at + step + found.list.ids.length) % found.list.ids.length]!);
  };
  // False only on the way to pane A with no focus of its own to go back to.
  const stepPane = (step: number) => { if (!cyclePaneFocus(step)) focusAnyPane("main"); };

  const switchTab = async (pane: PaneKey, id: string) => {
    setKeyboardPane(pane);
    if (pane === "main") await openInPaneA(`chat:${id}`);
    else setSlotView(pane, `chat:${id}`);
    focusAnyPane(pane);
  };
  const closeTab = async (pane: PaneKey, id: string) => {
    const tabs = tabsOf(pane);
    if (!tabs || tabs.ids.length < 2) return closePane(pane);
    if (activeChatOf(pane) === id) {
      await switchTab(pane, tabs.used.find((item) => item !== id && tabs.ids.includes(item)) ?? tabs.ids.find((item) => item !== id)!);
    }
    setPaneTabs((current) => {
      const list = current[String(pane)];
      return list ? { ...current, [String(pane)]: { ids: list.ids.filter((item) => item !== id), used: list.used.filter((item) => item !== id) } } : current;
    });
  };
  // A chat open as a background tab anywhere is gone to, not opened again.
  const switchToTab = (view: SplitView) => {
    if (!view.startsWith("chat:")) return false;
    const id = view.slice("chat:".length);
    const pane = panesShown().find((candidate) => tabsOf(candidate)?.ids.includes(id) && activeChatOf(candidate) !== id);
    if (pane === undefined) return false;
    void switchTab(pane, id);
    return true;
  };
  // Documents moving between pane A and a pane beside it take their tabs.
  const swapKeys = <T,>(current: Record<string, T>, a: PaneKey, b: PaneKey) => {
    const next = { ...current };
    const first = current[String(a)];
    const second = current[String(b)];
    delete next[String(a)];
    delete next[String(b)];
    if (second) next[String(a)] = second;
    if (first) next[String(b)] = first;
    return next;
  };
  const swapTabs = (a: PaneKey, b: PaneKey) => batch(() => {
    setPaneTabs((current) => swapKeys(current, a, b));
    for (const side of [0, 1]) {
      setFileTabs((current) => swapKeys(current, sideKey(a, side) as unknown as PaneKey, sideKey(b, side) as unknown as PaneKey));
      const first = lastShownFiles.get(sideKey(a, side));
      const second = lastShownFiles.get(sideKey(b, side));
      lastShownFiles.delete(sideKey(a, side));
      lastShownFiles.delete(sideKey(b, side));
      if (second) lastShownFiles.set(sideKey(a, side), second);
      if (first) lastShownFiles.set(sideKey(b, side), first);
    }
  });
  /*
   * File tabs (6c): a file viewer shows one or two files side by side (its
   * view's entries), and each side holds up to five as its own tabs, which
   * head it in place of the file's name. A file opened into a side replaces
   * the one there; Ctrl keeps that one as a tab. Closing a side's showing tab
   * shows the tab it used last, else the side goes; the last leaves the viewer
   * empty. Tab lists go by `<pane>#<side>`.
   */
  const sideKey = (pane: PaneKey, side: number) => `${pane}#${side}`;
  const launchFileTabs = () => {
    if (urlNamesPanes || !atStart) return fileTabsFromParams(launchUrl.searchParams);
    const params = new URLSearchParams();
    for (const view of initialViews) if (view) params.append("pane", view);
    for (const value of (readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-file-tabs") || "").split("\n").filter(Boolean)) params.append("ftabs", value);
    return fileTabsFromParams(params);
  };
  const [fileTabs, setFileTabs] = createSignal<Record<string, FileTabs>>(launchFileTabs());
  const fileTabsOf = (pane: PaneKey, side: number) => fileTabs()[sideKey(pane, side)] ?? null;
  // What each side showed when last reconciled: what leaves it was replaced.
  const lastShownFiles = new Map<string, FileEntry>();
  const keepFileNext = new Set<string>();
  const fileTabParams = () => {
    const panes: PaneKey[] = ["main", ...slotOrder().filter((slot) => slotView(slot))];
    return panes.flatMap((pane, position) => [0, 1].flatMap((side) => fileTabParam(position, side, fileTabsOf(pane, side)) ?? []));
  };
  function reconcileFileTabs() {
    const next = { ...untrack(fileTabs) };
    const panes: PaneKey[] = ["main", ...untrack(slotOrder).filter((slot) => untrack(() => slotView(slot)))];
    const live = new Set<string>();
    for (const pane of panes) {
      const shown = parseFileView(untrack(() => viewOf(pane)));
      if (!shown) continue;
      shown.forEach((entry, side) => {
        const key = sideKey(pane, side);
        live.add(key);
        next[key] = reconcileSide(next[key], entry, lastShownFiles.get(key), keepFileNext.delete(key));
        lastShownFiles.set(key, entry);
      });
    }
    for (const key of Object.keys(next)) if (!live.has(key)) { delete next[key]; lastShownFiles.delete(key); }
    setFileTabs(next);
  }
  createEffect(on(() => fileTabParams().join("\n"), (value) => writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-file-tabs", value), { defer: true }));
  const shownFileSide = (pane: PaneKey) => { const shown = parseFileView(viewOf(pane)) ?? []; return Math.max(0, Math.min(fileFocus()[String(pane)] ?? 0, shown.length - 1)); };
  // A side's tabs moved to another side (a side closing shifts the next one down).
  const moveSideTabs = (from: string, to: string) => {
    setFileTabs((current) => moveKey(current, from, to));
    const shown = lastShownFiles.get(from);
    lastShownFiles.delete(from);
    if (shown) lastShownFiles.set(to, shown); else lastShownFiles.delete(to);
  };
  const showFileTab = (pane: PaneKey, side: number, key: string) => {
    const entry = fileTabsOf(pane, side)?.entries.find((item) => fileEntryKey(item) === key);
    const shown = parseFileView(viewOf(pane)) ?? [];
    if (!entry || !shown[side]) return;
    if (fileEntryKey(shown[side]!) !== key) {
      if (handlesOf(pane)[side]?.hasUnsavedChanges() && !window.confirm("Discard unsaved changes and show another file?")) return;
      handlesOf(pane)[side]?.discardChanges();
      keepFileNext.add(sideKey(pane, side));
      setPaneView(pane, formatFileView(shown.map((item, at) => at === side ? entry : item)));
    }
    focusColumn(pane, side);
  };
  const closeFileTab = (pane: PaneKey, side: number, key: string) => {
    const tabs = fileTabsOf(pane, side);
    const shown = parseFileView(viewOf(pane)) ?? [];
    const forget = () => setFileTabs((current) => {
      const list = current[sideKey(pane, side)];
      return list ? { ...current, [sideKey(pane, side)]: withoutTab(list, key) } : current;
    });
    if (!shown[side] || fileEntryKey(shown[side]!) !== key) return forget();
    if (handlesOf(pane)[side]?.hasUnsavedChanges() && !window.confirm("Discard unsaved changes and close this file?")) return;
    handlesOf(pane)[side]?.discardChanges();
    const replacement = nextShownTab(tabs, key);
    forget();
    movingDocuments = true;
    if (replacement) {
      keepFileNext.add(sideKey(pane, side));
      setPaneView(pane, formatFileView(shown.map((item, at) => at === side ? replacement : item)));
    } else {
      handlesOf(pane)[side] = undefined;
      // The side goes; a second side becomes the first.
      if (side === 0 && shown.length === 2) moveSideTabs(sideKey(pane, 1), sideKey(pane, 0));
      else { setFileTabs((current) => { const next = { ...current }; delete next[sideKey(pane, side)]; return next; }); lastShownFiles.delete(sideKey(pane, side)); }
      setPaneView(pane, formatFileView(shown.filter((_, at) => at !== side)));
      focusFileEntry(pane, 0);
    }
    movingDocuments = false;
  };
  // The files the viewers show, for the navigator to mark: "focused" in the viewer with the keyboard.
  const openFileKeys = createMemo(() => {
    const keys = new Map<string, "focused" | "shown">();
    for (const pane of panesShown()) (parseFileView(viewOf(pane)) ?? []).forEach((entry, side) => {
      const key = fileEntryKey(entry);
      if (pane === keyboardPane() && side === shownFileSide(pane) && !emptyFocused(pane)) keys.set(key, "focused"); else if (!keys.has(key)) keys.set(key, "shown");
    });
    return keys;
  }, new Map(), { equals: (a, b) => a.size === b.size && [...a].every(([key, value]) => b.get(key) === value) });
  // Two sides trade places, their tabs, wrapping and focus with them.
  const swapSides = (pane: PaneKey) => {
    const shown = parseFileView(viewOf(pane)) ?? [];
    if (shown.length !== 2) return;
    const [a, b] = [sideKey(pane, 0), sideKey(pane, 1)];
    setFileTabs((current) => swapRecordKeys(current, a, b));
    const [first, second] = [lastShownFiles.get(a), lastShownFiles.get(b)];
    if (second) lastShownFiles.set(a, second); else lastShownFiles.delete(a);
    if (first) lastShownFiles.set(b, first); else lastShownFiles.delete(b);
    setSideWraps((current) => swapRecordKeys(current, a, b));
    setPaneView(pane, formatFileView([shown[1]!, shown[0]!]));
    focusFileEntry(pane, 1 - shownFileSide(pane));
  };
  // A side goes with all its tabs; the last leaves the viewer empty.
  const closeSide = (pane: PaneKey, side: number) => {
    const shown = parseFileView(viewOf(pane)) ?? [];
    if (!shown[side]) return;
    if (handlesOf(pane)[side]?.hasUnsavedChanges() && !window.confirm("Discard unsaved changes and close this side?")) return;
    handlesOf(pane)[side]?.discardChanges();
    handlesOf(pane)[side] = undefined;
    movingDocuments = true;
    if (side === 0 && shown.length === 2) moveSideTabs(sideKey(pane, 1), sideKey(pane, 0));
    else { setFileTabs((current) => { const next = { ...current }; delete next[sideKey(pane, side)]; return next; }); lastShownFiles.delete(sideKey(pane, side)); }
    setPaneView(pane, formatFileView(shown.filter((_, at) => at !== side)));
    focusFileEntry(pane, 0);
    movingDocuments = false;
  };
  // A tab dragged away: a hidden one is forgotten, a showing one gives way to its
  // column's last used; a column's last leaves it empty -- a move never closes one.
  const leaveSide = (pane: PaneKey, side: number, key: string) => {
    const shown = parseFileView(viewOf(pane)) ?? [];
    const others = (fileTabsOf(pane, side)?.entries ?? []).filter((entry) => fileEntryKey(entry) !== key);
    if (!shown[side] || fileEntryKey(shown[side]!) !== key || others.length) return closeFileTab(pane, side, key);
    handlesOf(pane)[side]?.discardChanges();
    handlesOf(pane)[side] = undefined;
    movingDocuments = true;
    if (side === 0 && shown.length === 2) moveSideTabs(sideKey(pane, 1), sideKey(pane, 0));
    else { setFileTabs((current) => { const next = { ...current }; delete next[sideKey(pane, side)]; return next; }); lastShownFiles.delete(sideKey(pane, side)); }
    if (shown.length === 2) {
      setPaneView(pane, formatFileView(shown.filter((_, at) => at !== side)));
      setEmptySides((current) => ({ ...current, [String(pane)]: side as 0 | 1 }));
      focusFileEntry(pane, 0);
    } else setPaneView(pane, EMPTY_FILE_VIEW);
    movingDocuments = false;
  };
  const closeOtherTabs = (pane: PaneKey, side: number) => {
    const shown = parseFileView(viewOf(pane))?.[side];
    if (!shown) return;
    setFileTabs((current) => ({ ...current, [sideKey(pane, side)]: { entries: [shown], used: [fileEntryKey(shown)] } }));
  };
  // A side, tabs and all, lifted into a pane of its own beside this one.
  const moveSideToPane = (pane: PaneKey, side: number) => {
    const shown = parseFileView(viewOf(pane)) ?? [];
    const entry = shown[side];
    const free = freeSlot() ?? undefined;
    if (!entry || free === undefined) return;
    const tabs = fileTabsOf(pane, side);
    if (handlesOf(pane)[side]?.hasUnsavedChanges() && !window.confirm("Discard unsaved changes and move this side?")) return;
    handlesOf(pane)[side]?.discardChanges();
    const view = formatFileView([entry]);
    if (!setSlotView(free, view, false, panesShown().indexOf(pane))) return;
    if (tabs) setFileTabs((current) => ({ ...current, [sideKey(free, 0)]: tabs }));
    lastShownFiles.set(sideKey(free, 0), entry);
    closeSide(pane, side);
    setFilePane(free);
    focusFileEntry(free, 0);
    focusPane(free);
  };
  const fileSideMenu = (pane: PaneKey, side: number) => <>
    <Show when={(fileTabsOf(pane, side)?.entries.length ?? 0) > 1}><MenuItem onSelect={() => closeOtherTabs(pane, side)}><XIcon />Close other tabs</MenuItem></Show>
    <Show when={(parseFileView(viewOf(pane))?.length ?? 0) === 2 && roomBeside(formatFileView([parseFileView(viewOf(pane))![side]!]))}><MenuItem onSelect={() => moveSideToPane(pane, side)}><PanelRightIcon />Move to new pane</MenuItem></Show>
    <MenuItem onSelect={() => closeSide(pane, side)}><XIcon />Close side</MenuItem>
  </>;
  const fileSideTabs = (pane: PaneKey, side: number) => {
    const row = createTabStrip({
      keys: () => { const list = fileTabsOf(pane, side); return list?.entries.length ? list.entries.map(fileEntryKey) : null; },
      place: (key) => key.slice(0, key.indexOf(":")),
      title: (key) => key.slice(key.indexOf(":") + 1).split("/").pop() || key,
      hint: (key) => `${placeLabelOf(key.slice(0, key.indexOf(":")))} / ${key.slice(key.indexOf(":") + 1)}`,
      icon: (key) => <FileTypeIcon name={key.slice(key.indexOf(":") + 1)} />,
      // Lit on the side with the keyboard; the other side's showing file in the text colour.
      lit: () => { const shown = parseFileView(viewOf(pane)) ?? []; return shownFileSide(pane) === side && shown[side] && !emptyFocused(pane) ? fileEntryKey(shown[side]!) : null; },
      shown: (key) => { const shown = parseFileView(viewOf(pane)) ?? []; return Boolean(shown[side] && fileEntryKey(shown[side]!) === key); },
      used: () => fileTabsOf(pane, side)?.used ?? [],
      // Only a showing file can hold edits: leaving one discards them.
      unsaved: (key) => { handlesChanged(); const shown = parseFileView(viewOf(pane)) ?? []; return Boolean(shown[side] && fileEntryKey(shown[side]!) === key && handlesOf(pane)[side]?.hasUnsavedChanges()); },
      select: (key) => showFileTab(pane, side, key),
      close: (key) => closeFileTab(pane, side, key),
      dragView: (key) => { const entry = fileTabsOf(pane, side)?.entries.find((item) => fileEntryKey(item) === key); return entry ? formatFileView([entry]) : ""; },
      dragLit: true,
    });
    return <nav aria-label="Tabs" class="chat-header-title chat-header-tabs file-side-tabs" data-file-side={side}>{row()}</nav>;
  };
  /*
   * A pane's tab row, for chats and files alike (6c): tabs keep their order
   * and width, so switching changes only which is lit; runs from one place
   * share its caps label; what does not fit folds, from the end, into a menu
   * at the row's end -- never the lit tab, and a place's label only with all
   * its tabs. A tab `shown` but not lit is a file on the viewer's other side.
   */
  type TabStripOptions = {
    keys: () => string[] | null;
    place: (key: string) => string;
    // Without a place label the tabs are one run, unlabelled (a file viewer's).
    placeLabel?: (key: string) => string;
    title: (key: string) => string;
    hint?: (key: string) => string;
    icon?: (key: string) => JSX.Element;
    lit: () => string | null;
    shown?: (key: string) => boolean;
    used: () => string[];
    live?: (key: string) => boolean;
    unsaved?: (key: string) => boolean;
    select: (key: string) => void;
    close: (key: string) => void;
    dragView?: (key: string) => string;
    // The lit tab drags too (a file's; a chat's header moves its pane instead).
    dragLit?: boolean;
    groupDrag?: (keys: string[]) => Record<string, string>;
  };
  const createTabStrip = (options: TabStripOptions) => {
    const groups = createMemo(() => {
      const runs: { place: string; keys: string[] }[] = [];
      for (const key of options.keys() ?? []) {
        const place = options.placeLabel ? options.place(key) : "";
        if (runs.at(-1)?.place === place) runs.at(-1)!.keys.push(key);
        else runs.push({ place, keys: [key] });
      }
      return runs;
    }, [], { equals: (a, b) => a.length === b.length && a.every((run, index) => run.place === b[index]!.place && run.keys.join() === b[index]!.keys.join()) });
    const [folded, setFolded] = createSignal<string[]>([]);
    let strip: HTMLDivElement | undefined;
    const fit = () => {
      if (!strip) return;
      const groupElements = [...strip.querySelectorAll<HTMLElement>(".pane-tab-group")];
      const tabElements = [...strip.querySelectorAll<HTMLElement>(".pane-tab")];
      for (const element of [...groupElements, ...tabElements]) element.style.display = "";
      for (const element of tabElements) element.removeAttribute("data-lead");
      const runs = groups();
      if (!options.keys() || groupElements.length !== runs.length) return setFolded([]);
      const room = strip.clientWidth;
      // What every tab needs, for a header that folds its own actions first.
      // Tabs give way to a squeeze by cutting their titles, so each is measured with its whole title.
      // A tab's own cap (max-width) still holds.
      const whole = (tab: HTMLElement) => { const title = tab.querySelector<HTMLElement>(".pane-tab-title > span"); const width = tab.getBoundingClientRect().width; return Math.min(width + (title ? title.scrollWidth - title.clientWidth : 0), Math.max(width, parseFloat(getComputedStyle(tab).maxWidth) || Infinity)); };
      const natural = (element: HTMLElement) => element.classList.contains("pane-tab") ? whole(element) : element.getBoundingClientRect().width + [...element.querySelectorAll<HTMLElement>(".pane-tab")].reduce((sum, tab) => sum + whole(tab) - tab.getBoundingClientRect().width, 0);
      const all = groupElements.reduce((sum, element) => sum + natural(element) + (element === groupElements[0] ? 0 : 33), 0);
      // What must stay -- the lit and showing tabs, their labels and the ⋯ -- for a header
      // that folds its own actions only after the other tabs have folded.
      const litKey = options.lit();
      const staying = tabElements.filter((element) => element.dataset.tab === litKey || options.shown?.(element.dataset.tab!));
      const need = String(Math.ceil(staying.reduce((sum, element) => sum + natural(element) + 10, 0) + (staying.length < tabElements.length ? 28 : 0)
        + groupElements.filter((group) => staying.some((element) => group.contains(element))).reduce((sum, group) => sum + (group.querySelector<HTMLElement>(".pane-tab-group-label")?.getBoundingClientRect().width ?? 0), 0)));
      if (strip.dataset.need !== need) strip.dataset.need = need;
      if (all <= room) return setFolded([]);
      // Each tab with the gap and middot before it; each place with its label and the rule before it.
      const width = new Map(tabElements.map((element) => [element.dataset.tab!, natural(element) + 10]));
      const labels = groupElements.map((element, index) => (element.querySelector<HTMLElement>(".pane-tab-group-label")?.getBoundingClientRect().width ?? 0) + 8 + (index ? 33 : 0));
      // The lit tab and any other showing (a viewer's other side) never fold.
      const lit = options.lit();
      const reserved = (options.keys() ?? []).filter((key) => key === lit || options.shown?.(key));
      const kept = new Set(runs.flatMap((run, index) => run.keys.some((key) => reserved.includes(key)) ? [index] : []));
      let budget = room - 28 - reserved.reduce((sum, key) => sum + (width.get(key) ?? 0), 0) - [...kept].reduce((sum, index) => sum + (labels[index] ?? 0), 0);
      const hidden: string[] = [];
      runs.forEach((run, index) => run.keys.forEach((key) => {
        if (reserved.includes(key)) return;
        const cost = (width.get(key) ?? 0) + (kept.has(index) ? 0 : labels[index]!);
        if (hidden.length === 0 && cost <= budget) { budget -= cost; kept.add(index); } else hidden.push(key);
      }));
      tabElements.forEach((element) => { if (hidden.includes(element.dataset.tab!)) element.style.display = "none"; });
      // A folded tab's middot goes with it: the first tab left in a place leads it.
      groupElements.forEach((group) => { let lead = true; group.querySelectorAll<HTMLElement>(".pane-tab").forEach((element) => { const shown = element.style.display !== "none"; element.toggleAttribute("data-lead", shown && lead); if (shown) lead = false; }); });
      groupElements.forEach((element, index) => { if (!kept.has(index)) element.style.display = "none"; });
      setFolded(hidden);
    };
    const has = createMemo(() => Boolean(options.keys()));
    return createMemo(() => has() ? untrack(() => <div class="pane-tabs" ref={(element) => {
      strip = element;
      const observer = new ResizeObserver(() => fit());
      observer.observe(element);
      onCleanup(() => observer.disconnect());
      createEffect(on(() => [groups(), options.lit()] as const, () => requestAnimationFrame(fit)));
    }}>
      <For each={groups()}>{(run) => {
        const current = () => run.keys.includes(options.lit() ?? "");
        const label = () => options.placeLabel?.(run.keys[0]!) ?? "";
        // The place's label goes to the tab of it used last.
        const recent = () => options.used().find((key) => run.keys.includes(key)) ?? run.keys[0]!;
        return <span class="pane-tab-group" classList={{ "pane-tab-group-current": current() }}>
          <Show when={options.placeLabel}><button type="button" class="pane-tab-group-label chat-header-place" tabIndex={-1} title={label()} {...(options.groupDrag ? { draggable: "true", "data-doc-view": options.dragView?.(recent()), ...options.groupDrag(run.keys) } : {})} onClick={() => { if (!current()) options.select(recent()); }}><span>{label()}</span></button></Show>
          <For each={run.keys}>{(key) => {
            const lit = () => options.lit() === key;
            const name = () => options.title(key);
            return <span class="pane-tab" role="tab" data-tab={key} aria-selected={lit()} classList={{ "pane-tab-active": lit(), "pane-tab-shown": !lit() && Boolean(options.shown?.(key)), "pane-tab-unsaved": Boolean(options.unsaved?.(key)) }} draggable={(lit() && !options.dragLit) || !options.dragView ? undefined : "true"} data-doc-view={lit() && !options.dragLit ? undefined : options.dragView?.(key)}>
              <button type="button" class="pane-tab-open" tabIndex={-1} title={options.hint?.(key) ?? `${label()} / ${name()}`} onClick={() => { if (!lit()) options.select(key); }}>
                {options.icon?.(key)}
                <Show when={options.live?.(key)}><i class="pane-tab-live" aria-label="Running" /></Show>
                <span class="pane-tab-title" data-text={name()}><span>{name()}</span></span>
              </button>
              <button type="button" class="pane-tab-close" tabIndex={-1} aria-label={`Close ${name()}`} title={options.unsaved?.(key) ? "Unsaved changes: close tab" : "Close tab"} onClick={() => options.close(key)}><XIcon /></button>
            </span>;
          }}</For>
        </span>;
      }}</For>
      <Show when={folded().length}>
        <Menu modal={false} placement="bottom-end">
          <MenuTrigger class="pane-tab-action pane-tabs-more" tabIndex={-1} aria-label={`${folded().length} more tabs`} title={`${folded().length} more tabs`}><EllipsisIcon /></MenuTrigger>
          <MenuContent class="pane-tabs-menu">
            <For each={groups().filter((run) => run.keys.some((key) => folded().includes(key)))}>{(run) =>
              <MenuGroup><Show when={options.placeLabel}><MenuLabel>{options.placeLabel?.(run.keys[0]!)}</MenuLabel></Show>
                <For each={run.keys.filter((key) => folded().includes(key))}>{(key) => <MenuItem textValue={options.title(key)} onSelect={() => options.select(key)}>{options.title(key)}</MenuItem>}</For>
              </MenuGroup>}
            </For>
          </MenuContent>
        </Menu>
      </Show>
    </div>) : undefined);
  };
  const placeLabelOf = (projectId: string) => { const project = catalogue.projects().find((item) => item.id === projectId); return !project || project.slug === "chat" ? "Chats" : project.name || project.slug; };
  const paneTabRow = (pane: PaneKey) => {
    const row = createTabStrip({
      keys: () => { const list = tabsOf(pane); return list && list.ids.length > 1 && !isMobileLayout() ? list.ids : null; },
      place: tabPlace,
      placeLabel: (id) => placeLabelOf(tabPlace(id)),
      title: (id) => viewName(`chat:${id}`),
      lit: () => activeChatOf(pane),
      used: () => tabsOf(pane)?.used ?? [],
      live: (id) => Boolean(runtime.getProcess(id)),
      select: (id) => void switchTab(pane, id),
      close: (id) => void closeTab(pane, id),
      dragView: (id) => `chat:${id}`,
      groupDrag: (ids) => ({ "data-tab-group": ids.join(",") }),
    });
    return { get tabs() { return row(); } };
  };
  // Pane A's close hands it the next pane's chat or page.
  const closePane = (pane: PaneKey) => {
    if (pane !== "main") return closeSlot(pane);
    const element = paneElement("main");
    if (!element || shownSlots()[0] === undefined || !animatePanes()) return closePaneA();
    // As any pane closes: pane A fades out and the others ease into its room;
    // then, unseen, it takes the next pane's document at that pane's width and
    // fades in once it has loaded.
    setPaneMotion({ slot: "main", phase: "leaving" });
    void element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SWAP_FADE_MS, easing: "ease-out" }).finished.then(() => {
      const target = weightsFor(shownSlots().length);
      target.unshift(0);
      setWeightOverride(paneShares());
      requestAnimationFrame(() => requestAnimationFrame(() => easePaneWeights(normalized(target), async () => {
        const next = shownSlots()[0]!;
        const view = slotView(next);
        const beside = paneSlot(next).host();
        if (!view || !beside) { closePaneA(); setWeightOverride(null); setPaneMotion(null); return; }
        // The next pane stays showing while pane A, collapsed, loads its
        // document; then the two crossfade -- the pane's last frame, held
        // over its place, out as pane A comes in there.
        swappingPanes = true;
        swapTabs("main", next);
        try {
          if (isPaneView(view)) { setPaneAOverride(null); await openInPaneA(view); } else setPaneAOverride(view);
          const id = view.startsWith("chat:") ? view.slice("chat:".length) : null;
          await waitFor(() => !id || (chat.loadedId() === id && chatDrawn("main")), 1500);
          const ghost = ghostOf(beside);
          batch(() => {
            movingDocuments = true;
            setSlotView(next, null);
            movingDocuments = false;
            setWeightOverride(null);
            setPaneMotion(null);
          });
          // Pane A is whole under the ghost, which alone fades: two layers
          // crossfading each at half opacity let the background through.
          await ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: SWAP_FADE_MS, easing: "ease-out", fill: "forwards" }).finished.catch(() => undefined);
          ghost.remove();
        } finally {
          swappingPanes = false;
          reconcileTabs();
        }
      })));
    });
  };
  const closePaneA = () => {
    const next = shownSlots()[0];
    const view = next === undefined ? null : slotView(next);
    if (next === undefined || !view) return;
    swappingPanes = true;
    swapTabs("main", next);
    movingDocuments = true;
    setSlotView(next, null);
    movingDocuments = false;
    if (!isPaneView(view)) { setPaneAOverride(view); swappingPanes = false; reconcileTabs(); return; }
    setPaneAOverride(null);
    void Promise.resolve(openInPaneA(view)).finally(() => { swappingPanes = false; reconcileTabs(); });
  };
  // A pane beside A, in the row or (docked) in the dock.
  const renderSlot = (slot: number, position: () => number, docked: boolean) => {
      const pane = paneSlot(slot);
      const side = pane.session;
      const owns = () => slotHasKeyboard(slot);
      const page = () => slotPage(slot);
      const attachInput = () => <input ref={side.setAttachInput} type="file" multiple hidden aria-hidden="true" onChange={(event) => { if (event.currentTarget.files) side.attachments.addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />;
      return <section ref={(element) => { pane.setHost(element); onCleanup(() => { if (pane.host() === element) pane.setHost(undefined); }); }} class="main-split" classList={{ "main-split-docked": docked, "main-split-docked-hidden": docked && dockSlot() !== slot }} data-pane-slot={slot} data-region={slotChatId(slot) ? "chat" : page() ? "dashboard" : "workspace-panel"} aria-label={docked ? "Docked pane" : position() === 0 ? "Pane B" : "Pane C"} style={docked ? undefined : { flex: `${paneWeights()[position() + 1] ?? 0.5} 1 0`, "min-width": paneMotion()?.slot === slot ? "0px" : `${paneMinWidth(slot)}px`, ...(paneMotion()?.slot === slot ? { opacity: 0, overflow: "hidden" } : {}), ...(paneMotion()?.slot === slot && paneMotion()!.collapsed ? { "margin-right": "0px" } : {}) }}>
        <Show when={!docked}><div class="main-split-resize" role="separator" aria-label="Resize panes" aria-orientation="vertical" onPointerDown={(event) => startSplitResize(event, position() + 1)} /></Show>
        <Show when={parseFileView(slotView(slot))}>{renderFileViewer(slot)}</Show>
        <Show when={slotView(slot)?.startsWith("term:")}>{renderTerminalDocument(slot, () => slotView(slot)!.slice("term:".length))}</Show>
        <Show when={page() === "computer"}>
          <div class="main-split-chat main-split-page" tabIndex={-1} onPointerDown={focusChatSurface}>{renderPaneComputer(slot)}</div>
        </Show>
        <Show when={page()?.startsWith("harness:")}>
          <div class="main-split-chat main-split-page" tabIndex={-1} onPointerDown={focusChatSurface}>{attachInput()}{renderPaneHarness(pane, decodeURIComponent(page()!.slice("harness:".length)))}</div>
        </Show>
        <Show when={page() && page() !== "computer" && !page()!.startsWith("harness:")}>
          <div class="main-split-chat main-split-page" tabIndex={-1} onPointerDown={focusChatSurface}>
            {attachInput()}
            <Show when={page() === "dashboard"} fallback={<Show when={slotPageProject(slot)}>{(project) =>
              <ProjectPage session={side} project={project()} target={{ project: project() }} keyboardOwner={owns} onSendDraft={(prompt) => sendFromPanePage(pane, prompt)} onOpenChat={openChatFromPage} tabActions={paneTabActions(slot)} />
            }</Show>}>
              <AppDashboardPage session={side} place={chatPlace(side)} keyboardOwner={owns} onSendDraft={(prompt) => sendFromPanePage(pane, prompt)} onOpenChat={(target, project) => void openChatFromPage(target, project)} tabActions={paneTabActions(slot)} />
            </Show>
          </div>
        </Show>
        <Show when={slotChatId(slot)}>
          <div class="main-split-chat" classList={{ "chat-main-live-opening": side.chat.presentation().kind !== "ready" || side.chat.loadedId() !== slotChatId(slot) }}>
            {attachInput()}
            {/* With no chat in the session yet the pane says it is loading;
                after that it switches in place, as pane A does -- the surface
                stays (and keeps focus), its transcript withheld while a live
                chat opens rather than showing an empty chat's welcome. */}
            <Show when={side.chat.loadedId()} fallback={<div class="chat-bootstrap" role="status">Loading chat…</div>}>
            <ChatSurface session={side} project={side.selected()?.project} {...paneTabRow(slot)} keyboardOwner={owns} place={chatPlace(side)} modelSelector onShare={() => void shareChat(side.selectedId())}
              onRename={() => runSidebar("rename-chat", side.selected() ?? {})} onDelete={() => runSidebar("delete-chat", side.selected() ?? {})}
              notice={workspaceNotice(side.selected()?.project, side.selectedId())}
              tabActions={paneTabActions(slot)} />
            </Show>
          </div>
        </Show>
      </section>;
  };
  /*
   * Any pane's document can move into the dock: it keeps its slot and session,
   * drawn in the dock instead of the row, with an icon of its own on the rail.
   * Pane A always shows something, so it docks only while another pane can
   * take its place, and only into a free slot.
   */
  const canDock = (pane: PaneKey) => !isMobileLayout() && dockAvailable() && !isDocked(pane)
    && dockedSlots().length < MAX_DOCKED && (pane !== "main" || (shownSlots()[0] !== undefined && Boolean(paneAView())));
  // A pane just docked opens at its document's minimum the first time it shows.
  const freshlyDocked = new Set<number>();
  const [dockWidthRequest, setDockWidthRequest] = createSignal<{ width: number; nonce: number } | null>(null);
  const showDocked = (slot: number) => {
    batch(() => {
      setDockSlot(slot);
      setPanelOpenForChat(true);
      if (freshlyDocked.delete(slot)) setDockWidthRequest({ width: viewMinWidth(slotView(slot)), nonce: Date.now() });
    });
    requestAnimationFrame(() => focusPane(slot));
  };
  const dockPane = (pane: PaneKey) => {
    if (!canDock(pane)) return void toast.info(pane === "main" ? "Pane A docks only while another pane can take its place." : "The dock holds three panes at most.");
    if (pane !== "main") {
      freshlyDocked.add(pane);
      setDockedSlots((current) => [...current, pane]);
      persistSlots();
      return focusChatPane();
    }
    const free = freeSlot(true)!;
    freshlyDocked.add(free);
    movingDocuments = true;
    batch(() => {
      setSlotView(free, paneAView());
      setDockedSlots((current) => [...current, free]);
    });
    movingDocuments = false;
    // Its tabs go with it.
    swapTabs("main", free);
    closePaneA();
    persistSlots();
  };
  // Back out of the dock into the row, at the end, folding if there is no room.
  const undockPane = (slot: number, focus = true) => {
    if (rowSlots().length >= 2) { toast.info("There is no room for another pane."); return false; }
    batch(() => {
      setDockedSlots((current) => current.filter((item) => item !== slot));
      if (dockSlot() === slot) { setDockSlot(null); closePanel(); }
    });
    persistSlots();
    if (focus && shownSlots().includes(slot)) focusPane(slot);
    return true;
  };
  createEffect(on(dockContents, (contents) => {
    const slot = dockSlot();
    if (slot !== null && !contents.includes(slot)) batch(() => { setDockSlot(null); closePanel(); });
  }, { defer: true }));
  const chooseDocked = (slot: number, alt: boolean) => {
    if (alt) return void (isDocked(slot) ? undockPane(slot) : toast.info("It comes back by itself once the window has room for it."));
    if (panelOpen() && dockSlot() === slot) return closePanel();
    showDocked(slot);
  };
  const paneTabActions = (pane: PaneKey) => <Show when={inDock(pane)} fallback={paneRowActions(pane)}>
    <span class="pane-tab-actions">
      <Show when={isDocked(pane)}><button type="button" class="pane-tab-action" tabIndex={-1} aria-label="Move to a pane" title="Move to a pane" onClick={() => void undockPane(pane as number)}><Columns2Icon /></button></Show>
      <button type="button" class="pane-tab-action" tabIndex={-1} aria-label="Close this pane" title="Close" onClick={() => closeSlot(pane as number)}><XIcon /></button>
    </span>
  </Show>;
  const paneRowActions = (pane: PaneKey) => <Show when={splitShown()}>
    <span class="pane-tab-actions">
      <Show when={canDock(pane)}><button type="button" class="pane-tab-action" tabIndex={-1} aria-label="Move to dock" title="Move to dock" onClick={() => dockPane(pane)}><PanelRightIcon /></button></Show>
      <Show when={swapPartner(pane) !== null}><button type="button" class="pane-tab-action" tabIndex={-1} aria-label="Swap with the pane beside" title="Swap" onPointerDown={() => { keyboardBeforePress = keyboardPane(); }} onClick={(event) => { const target = swapTarget(pane); keyboardBeforePress = null; if (target !== null) void swapPanes(pane, event.shiftKey, target); }}><ArrowLeftRightIcon /></button></Show>
      <Show when={pane !== "main" || shownSlots()[0] !== undefined}><button type="button" class="pane-tab-action" tabIndex={-1} aria-label="Close this pane" title="Close" onClick={() => closePane(pane)}><XIcon /></button></Show>
    </span>
  </Show>;
  /*
   * The URL carries every pane (5f). The path stays pane A's route; `a` is a
   * view pane A shows over it, each `pane` a pane beside A in order, and
   * `focus` the position of the pane with the keyboard. Widths and the dock
   * stay per device. Every address the app writes goes through here, so a
   * route change carries the panes and Back restores them.
   */
  const PANE_PARAMS = ["a", "pane", "dock", "tabs", "ftabs", "focus"];
  const withPanes = (address: string | URL) => {
    const url = new URL(address, location.href);
    for (const name of PANE_PARAMS) url.searchParams.delete(name);
    if (paneAOverride()) url.searchParams.set("a", paneAOverride()!);
    for (const view of rowSlots().map(slotView)) if (view) url.searchParams.append("pane", view);
    for (const slot of dockedSlots()) { const view = slotView(slot); if (view) url.searchParams.append("dock", view); }
    for (const value of tabParams()) url.searchParams.append("tabs", value);
    for (const value of fileTabParams()) url.searchParams.append("ftabs", value);
    const focus = panesShown().indexOf(keyboardPane());
    if (focus > 0) url.searchParams.set("focus", String(focus));
    return `${url.pathname}${url.search}${url.hash}`;
  };
  // Where pane A is, without the panes: what route comparisons read.
  const routeAddress = () => { const url = new URL(location.href); for (const name of PANE_PARAMS) url.searchParams.delete(name); return `${url.pathname}${url.search}`; };
  const nativePushState = history.pushState.bind(history);
  const nativeReplaceState = history.replaceState.bind(history);
  history.pushState = (data, unused, url) => nativePushState(data, unused, url == null ? url : withPanes(url));
  history.replaceState = (data, unused, url) => nativeReplaceState(data, unused, url == null ? url : withPanes(url));
  onCleanup(() => { history.pushState = nativePushState; history.replaceState = nativeReplaceState; });
  createEffect(on(() => [paneAOverride(), slotOrder().map(slotView).join("\n"), dockedSlots().join(), keyboardPane(), shownSlots().length, tabParams().join(), fileTabParams().join()] as const, () => {
    const next = withPanes(location.href);
    if (next !== `${location.pathname}${location.search}${location.hash}`) nativeReplaceState(history.state, "", next);
  }, { defer: true }));
  // Pane A sent somewhere by its route -- a new chat, a link -- leaves what
  // showed over it; a swap or close moving a document there does not.
  let paneARoute: string | null = null;
  // Back or forward restoring an address sets pane A's route and what shows
  // over it together; the route changing then is not pane A being sent away.
  let restoringPanes = false;
  createEffect(() => {
    // Only a settled route counts: a project or chat still resolving (as on
    // the first open, the catalogue arriving) is not pane A being sent away.
    const settling = (routeKind() === "project" && !selectedProject()) || (routeKind() === "chat" && !catalogue.selectedId() && !catalogue.loaded());
    // What names pane A's route: the chat, the project, or just the page.
    const key = routeBootstrap() === "ready" && !settling ? `${routeKind()}:${routeKind() === "chat" ? catalogue.selectedId() : routeKind() === "project" ? selectedProject()?.id : ""}:${harnessThread() ? "thread" : ""}` : null;
    if (key === null) return;
    if (paneARoute !== null && key !== paneARoute && !swappingPanes && !restoringPanes && untrack(paneAOverride)) setPaneAOverride(null);
    paneARoute = key;
  });
  // Back and forward: the panes the address names.
  const applyPanesFromUrl = () => {
    const params = new URLSearchParams(location.search);
    const views = params.getAll("pane").filter(isSplitView).slice(0, 2);
    const docked = params.getAll("dock").filter(isSplitView).slice(0, MAX_DOCKED);
    const a = params.get("a");
    batch(() => {
      const next = [views[0] ?? null, views[1] ?? null, ...[0, 1, 2].map((index) => docked[index] ?? null)];
      setSlotViews(next);
      setSlotOrder(SLOT_IDS.filter((slot) => next[slot]));
      setDockedSlots([2, 3, 4].filter((slot) => next[slot]));
      if (dockSlot() !== null && !next[dockSlot()!]) setDockSlot(null);
      setPaneAOverride(isSplitView(a) && !/^(chat|page):/.test(a) ? a : null);
      setPaneTabs(tabsFromParams(params));
      setFileTabs(fileTabsFromParams(params));
    });
    persistSlots();
  };
  // The pane the address says has the keyboard, once the panes are drawn.
  const launchFocus = Number(launchUrl.searchParams.get("focus")) || 0;
  if (launchFocus > 0) createEffect(on(() => shownSlots().length, (count) => { const slot = shownSlots()[launchFocus - 1]; if (count && slot !== undefined) setKeyboardPane(slot); }));
  // The chats the panes show other than the one with the keyboard, marked open in the sidebar.
  const openChatIds = () => {
    if (!splitShown()) return [];
    const current = keyboardSlot() !== null ? slotChatId(keyboardSlot()!) : mainChatId();
    return [mainChatId(), ...shownSlots().map(slotChatId)].filter((id): id is string => Boolean(id) && id !== current);
  };
  // The transcript learns its width only from geometry motion, so the panes
  // announce every change of the room they take from pane A.
  let splitMotionId = 0;
  let splitSize = 0;
  // Open from a drag's or ease's begin to its end: the weights effect below
  // stays out of the way meanwhile. Firing on every frame's new weights, it
  // started a motion of its own each frame -- every transcript measured,
  // pinned and relaid out with its anchor, and the drag's own changes, now
  // under a stale id, ignored (docs/design/performance-pass.md, 3).
  let splitMotionOpen = false;
  const announceSplit = (phase: "begin" | "change" | "end", size: number, panes?: { element: HTMLElement; width: number }[]) => {
    splitMotionOpen = phase !== "end";
    dispatchPanelGeometryMotion({ phase, id: splitMotionId, source: "workspace", size, panes });
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
  // The edge on the left of the pane at `position` shares the room of that
  // pane and the one before it between them.
  /*
   * A pane opening: the panes there ease to the widths they will have, then
   * it fades in; closing, the reverse (closeSlot). Not on first load, a phone,
   * Back, a swap, or with reduced motion.
   */
  let panesSettled = false;
  window.setTimeout(() => { panesSettled = true; }, 1500);
  const animatePanes = () => panesSettled && !isMobileLayout() && !swappingPanes && !restoringPanes && !paneMotion()
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const normalized = (weights: number[]) => { const total = weights.reduce((sum, weight) => sum + weight, 0) || 1; return weights.map((weight) => weight / total); };
  const paneShares = () => normalized(panesShown().map((pane) => paneElement(pane)?.getBoundingClientRect().width ?? 0));
  const easePaneWeights = (to: number[], done: () => void) => {
    splitMotionId += 1;
    announceSplit("begin", besideWidth());
    document.body.classList.add("panes-settling");
    batch(() => {
      setWeightOverride(to);
      // Its margin eases with it, so nothing jumps when it comes or goes.
      const motion = paneMotion();
      if (motion) setPaneMotion({ ...motion, collapsed: motion.phase === "leaving" });
    });
    const started = performance.now();
    const follow = () => {
      if (performance.now() - started < 240) { announceSplit("change", besideWidth()); requestAnimationFrame(follow); return; }
      document.body.classList.remove("panes-settling");
      done();
      splitSize = besideWidth();
      announceSplit("end", splitSize);
    };
    requestAnimationFrame(follow);
  };
  createEffect(on(shownSlots, (now, before) => {
    const added = now.filter((slot) => !(before ?? []).includes(slot));
    if (added.length !== 1 || !before || !animatePanes()) return;
    const slot = added[0]!;
    const index = now.indexOf(slot);
    const start = weightsFor(before.length + 1).slice();
    start.splice(index + 1, 0, 0);
    setWeightOverride(normalized(start));
    setPaneMotion({ slot, phase: "arriving", collapsed: true });
    requestAnimationFrame(() => requestAnimationFrame(() => easePaneWeights(normalized(weightsFor(now.length + 1)), () => {
      setWeightOverride(null);
      const element = paneSlot(slot).host();
      if (!element) return void setPaneMotion(null);
      element.style.opacity = "0";
      setPaneMotion(null);
      void element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: SWAP_FADE_MS, easing: "ease-out" }).finished.finally(() => { element.style.opacity = ""; });
    })));
  }, { defer: true }));
  // A share preset from the rail (Equalise is the even one): the panes ease to
  // it, each still held at its document's minimum.
  const applyPaneLayout = (weights: number[]) => {
    const count = shownSlots().length + 1;
    if (weights.length !== count) return;
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const next = weights.map((weight) => weight / total);
    splitMotionId += 1;
    announceSplit("begin", besideWidth());
    document.body.classList.add("panes-settling");
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
      document.body.classList.remove("panes-settling");
      splitSize = besideWidth();
      announceSplit("end", splitSize);
    };
    requestAnimationFrame(follow);
  };
  const startSplitResize = (event: PointerEvent, position: number) => {
    const shown = shownSlots();
    const paneAt = (index: number) => index === 0 ? document.querySelector<HTMLElement>(".chat-main") : index <= shown.length ? paneSlot(shown[index - 1]!).host() : undefined;
    const panes = Array.from({ length: shown.length + 1 }, (_, index) => paneAt(index));
    if (panes.some((pane) => !pane)) return;
    event.preventDefault();
    // Captured, the handle keeps its col-resize cursor and the pointer (over a
    // PDF's frame too), and the prevented press starts no text selection -- no
    // class on body, whose inherited cursor and user-select restyled the whole
    // page as the drag began and again as it ended (~7ms each).
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    // Dragging an edge takes room from the pane beside it down to its
    // document's minimum, then from the next one on, and gives it to the pane
    // on the other side.
    const widths = panes.map((pane) => pane!.getBoundingClientRect().width);
    const minimums = panes.map((pane) => parseFloat(getComputedStyle(pane!).minWidth) || MIN_SPLIT_PANE_WIDTH);
    const startX = event.clientX;
    const weights = paneWeights();
    const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
    const widthSum = widths.reduce((sum, width) => sum + width, 0);
    let pending = [...weights];
    // The room the panes beside A will take, from the widths just worked out:
    // announcing it needs no measuring after the weights are written.
    let pendingBeside = widths.slice(1).reduce((sum, width) => sum + width, 0);
    let frame = 0;
    const apply = (next: number[]) => { if (next.length === 2) setSplitRatio(next[1]!); else setSplitRatios3(next); };
    splitMotionId += 1;
    const sized = (list: number[]) => panes.map((element, index) => ({ element: element!, width: list[index]! }));
    let pendingWidths = widths;
    announceSplit("begin", pendingBeside, sized(widths));
    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
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
      pendingBeside = next.slice(1).reduce((sum, width) => sum + width, 0);
      pendingWidths = next;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        apply(pending);
        announceSplit("change", pendingBeside, sized(pendingWidths));
      });
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      apply(pending);
      if (pending.length === 2) writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split-ratio", String(pending[1]!));
      else writeSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "main-split-ratios", JSON.stringify(pending));
      requestAnimationFrame(() => { splitSize = besideWidth(); announceSplit("end", splitSize); });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };
  // A view dragged from the dock onto the main pane lands in its split.
  const dockDragging = (event: DragEvent) => document.body.dataset.toolDrag === "dock" && Boolean(event.dataTransfer?.types.includes(TOOL_DRAG_TYPE)) && !isMobileLayout();
  const toggleWorkspaceExpanded = () => {
    const next = !workspaceExpanded();
    setWorkspaceExpanded(next);
    if (next) focusWorkspacePanel();
  };
  const shareChat = async (chatId = catalogue.selectedId()) => {
    if (!chatId) return;
    try {
      const { origin } = await api<{ origin: string }>("/v0/share-origin");
      await navigator.clipboard.writeText(`${origin}/chat/${encodeURIComponent(chatId)}`);
      toast.success("Tailscale chat link copied");
    } catch (error) {
      showError(error);
    }
  };
  const shareProject = async (project = selectedProject()) => {
    if (!project) return;
    try {
      const { origin } = await api<{ origin: string }>("/v0/share-origin");
      await navigator.clipboard.writeText(`${origin}${projectPath(project)}`);
      toast.success("Tailscale workspace link copied");
    } catch (error) { showError(error); }
  };
  const runSidebar = (type: string, target: Omit<SidebarCommand, "type" | "nonce"> = {}) => setSidebarCommand({ type, nonce: Date.now(), ...target });
  const stopChatProcess = async (chatId = catalogue.selectedId()) => {
    const process = runtime.getProcess(chatId);
    if (!chatId || !process?.id) return;
    try {
      await api(`/v0/live-sessions/${encodeURIComponent(process.id)}/process`, { method: "DELETE" });
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
    chatId: focusedChatId(),
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
    canContinue: partialContinue() && Boolean(lastAssistant()?.stopped) && !focusedChat().streaming(),
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
    newFolder: () => runSidebar("new-folder"),
    newWorkspace: () => runSidebar("new-workspace"),
    openRuntimeChat: () => void createChat(undefined, { templateId: "runtime" }),
    attach: () => focusedSession().openAttachments(),
    stashPrompt,
    toggleDictation: () => window.dispatchEvent(new Event("conduit:toggle-dictation")),
    toggleSidebar: () => runSidebar("toggle-sidebar"),
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
    continue: () => void focusedChat().continueResponse(),
    compact: () => void focusedChat().compact(),
    copy: () => { const content = lastAssistant()?.content; if (content) void navigator.clipboard.writeText(content); },
    retryConnection: () => runtime.retry(),
    reload: () => location.reload(),
    updateApp: () => void runPwaUpdate(),
    resetAppCache: () => void runPwaCacheReset(),
    keyboardProbe: () => toast.success(toggleKeyboardProbe()
      ? "Keyboard measurements on. Open a chat and tap the composer."
      : "Keyboard measurements off."),
    delete: () => runSidebar("delete-chat", focusedTarget()),
    deleteFolder: () => runSidebar("delete-project"),
    settings: (section) => openSettings(section),
    workspaceSettings: (id) => openSettings("workspaces", id),
    openChat: (session, project) => { setMobileSidebarOpen(false); void openChatHere(session, project); },
    openProject: (project) => { setMobileSidebarOpen(false); void openProjectHere(project); },
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
      if (mobileSidebarOpen()) { event.preventDefault(); setMobileSidebarOpen(false); return; }
    }
  };

  // The tray's New chat is the same command the palette and the sidebar run.
  // The shell dispatches it rather than opening anything itself, so there is
  // one new-chat path however it was asked for.
  onMount(() => {
    if (!updateShell) return;
    // Stage a signed update while the window remains usable. The button and
    // tray command can still ask for an immediate check at any time.
    const firstCheck = window.setTimeout(() => void prepareDesktopUpdate(true), 10_000);
    const laterChecks = window.setInterval(() => void prepareDesktopUpdate(true), 60 * 60_000);
    onCleanup(() => { clearTimeout(firstCheck); clearInterval(laterChecks); });
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

  // The system-wide keys follow the registry: whatever is bound now is what the
  // shell holds, and rebinding one in Settings re-sends the whole set. A chord
  // another application already owns is reported and changes nothing, which is
  // the shell's guarantee, not something to re-check here.
  onMount(() => {
    if (!desktopShell) return;
    const shell = desktopShell;
    const publish = () => {
      void shell.setGlobalShortcuts(globalShortcuts(shortcutManager.commands, shortcutManager.shortcutOverrides()))
        .catch(showPlainError);
    };
    publish();
    onCleanup(shortcutManager.subscribe(publish));
  });

  onMount(() => {
    let hydratingUiPreferences = false;
    const persistUiPreference = (event: Event) => {
      if (hydratingUiPreferences) return;
      const detail = (event as CustomEvent<{ key?: UiPreferenceKey; value?: UiPreferences[UiPreferenceKey] }>).detail;
      if (!detail?.key) return;
      queueUiPreferenceSave(detail.key, detail.value!);
    };
    window.addEventListener(UI_PREFERENCE_CHANGE_EVENT, persistUiPreference);
    // One reducer for every channel that hands over a chat row: the global
    // stream, and the open chat's own socket.
    const watching = (chatId: string) => chatId === catalogue.selectedId()
      && routeKind() === "chat" && document.visibilityState === "visible";
    const applyChangedChat = (event: Event) => {
      const changed = (event as CustomEvent<ChatSummary>).detail;
      if (!changed?.id) return;
      const read = watching(changed.id);
      catalogue.patchChat(changed.id, read ? { ...changed, unread: false } : changed);
      if (read) markChatRead(catalogue, changed);
    };
    // Coming back to a tab is reading it too: the completion that landed while
    // this was in the background has nothing else left to clear it.
    const readOnFocus = () => {
      if (document.visibilityState !== "visible" || routeKind() !== "chat") return;
      markChatRead(catalogue, catalogue.selected()?.chat);
    };
    window.addEventListener("conduit:chat-changed", applyChangedChat);
    document.addEventListener("visibilitychange", readOnFocus);
    window.addEventListener("focus", readOnFocus);
    onCleanup(() => {
      window.removeEventListener(UI_PREFERENCE_CHANGE_EVENT, persistUiPreference);
      window.removeEventListener("conduit:chat-changed", applyChangedChat);
      document.removeEventListener("visibilitychange", readOnFocus);
      window.removeEventListener("focus", readOnFocus);
    });

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
      composerSurface: selectedComposerSurface(),
      meteorField: selectedMeteorField(),
      incremarkPacing: localStorage.getItem(INCREMARK_PACING_STORAGE_KEY) || "buffered",
      transcriptWidth: selectedTranscriptWidth(),
      transcriptWideBlocks: selectedTranscriptWideBlocks(),
      codeBlockCollapse: selectedCodeBlockCollapse(),
      codeBlockCollapseLines: selectedCodeBlockCollapseLines(),
      codeBlockWidth: selectedCodeBlockWidth(),
      panelMotion: selectedPanelMotion(),
      leaderMenu: selectedLeaderMenu(),
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
      composerSurface: COMPOSER_SURFACE_STORAGE_KEY,
      meteorField: METEOR_FIELD_STORAGE_KEY,
      incremarkPacing: INCREMARK_PACING_STORAGE_KEY,
      transcriptWidth: TRANSCRIPT_WIDTH_STORAGE_KEY,
      transcriptWideBlocks: TRANSCRIPT_WIDE_BLOCKS_STORAGE_KEY,
      codeBlockCollapse: CODE_BLOCK_COLLAPSE_STORAGE_KEY,
      codeBlockCollapseLines: CODE_BLOCK_COLLAPSE_LINES_STORAGE_KEY,
      codeBlockWidth: CODE_BLOCK_WIDTH_STORAGE_KEY,
      panelMotion: PANEL_MOTION_STORAGE_KEY,
      leaderMenu: LEADER_MENU_STORAGE_KEY,
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
      const stored = key === "sidebarCollapsed"
        ? value ? "collapsed" : "expanded"
        : Array.isArray(value) ? JSON.stringify(value) : String(value);
      // Hydration replays every preference the server holds, and almost all of
      // them are already on screen: localStorage seeded each signal, and the
      // reading-surface presets were stamped, before the first paint. Replaying
      // one is not free -- the transcript reads a width or collapse change as a
      // reason to drop every cached block size and measure the whole thread
      // again -- so a value that has not moved is not announced at all.
      //
      // Only keys with a storage key can be compared, and those are exactly the
      // ones seeded from storage. The rest (pins, shortcut overrides, voice)
      // fall through and are applied as before.
      if (storageKey && localStorage.getItem(storageKey) === stored) return;
      if (storageKey) localStorage.setItem(storageKey, stored);
      if (key === "sidebarChatLimit" && typeof value === "number") setSidebarChatLimit(clampSidebarChatLimit(value));
      else if (key === "sidebarPins" && Array.isArray(value)) setSidebarPins(value.filter((item): item is string => typeof item === "string"));
      else if (key === "markdownRenderer" && typeof value === "string" && !overridden(key)) setMarkdownRenderer(value as MarkdownRendererId);
      else if (key === "meteorField" && typeof value === "boolean") setMeteorField(value);
      else if (key === "transcriptWidth" && isTranscriptWidthMode(value) && !overridden(key)) applyTranscriptAppearance({ width: value });
      else if (key === "transcriptWideBlocks" && isTranscriptWideBlocksMode(value) && !overridden(key)) applyTranscriptAppearance({ wideBlocks: value });
      else if (key === "codeBlockCollapse" && isCodeBlockCollapseMode(value) && !overridden(key)) applyTranscriptAppearance({ collapse: value });
      else if (key === "codeBlockCollapseLines" && isCodeBlockCollapseLines(value) && !overridden(key)) applyTranscriptAppearance({ collapseLines: value });
      else if (key === "codeBlockWidth" && isCodeBlockWidthMode(value) && !overridden(key)) applyTranscriptAppearance({ codeWidth: value });
      else if (key === "panelMotion" && isPanelMotionMode(value) && !overridden(key)) publishUiPreference("panelMotion", value);
      else if (key === "leaderMenu" && isLeaderMenuMode(value)) setLeaderMenu(value);
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
    void apiWhenServed<UiPreferences & { knownServers?: Array<{ origin?: unknown; name?: unknown }> }>("/v0/preferences").then(async (serverPreferences) => {
      setSidebarPins(Array.isArray(serverPreferences.sidebarPins) ? serverPreferences.sidebarPins : []);
      // Every server keeps the directory, and every client that reaches one
      // both reads it and tops it up. Two addresses for the same machine share
      // it outright; two machines learn each other the first time one client
      // has been to both. Either way an address is typed once, anywhere.
      const directory = mergeServerDirectory(serverPreferences.knownServers || []);
      void publishServerDirectory(directory, serverPreferences.knownServers);
      // Ask the server it just signed in to who it is and where else it
      // answers. This connection is authenticated, which is the only kind that
      // may be believed about identity: an open endpoint saying "I am the
      // server you hold a token for" is the thing worth being unable to say.
      // A server too old to answer leaves the list exactly as it was.
      void api<{ id?: string; name?: string; publicKey?: string; paths?: unknown }>("/v0/server")
        .then((identity) => {
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
      shortcutManager.registerHandler(COMMAND_IDS.openSettings, "application", () => openSettings()),
      shortcutManager.registerHandler(COMMAND_IDS.openModelSelector, "application", openModelSelector),
      shortcutManager.registerHandler(COMMAND_IDS.newChat, "application", () => {
        setMobileSidebarOpen(false);
        void startNewChat();
      }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleSidebar, "application", () => runSidebar("toggle-sidebar")),
      shortcutManager.registerHandler(COMMAND_IDS.toggleWorkspacePanel, "application", togglePanel),
      shortcutManager.registerHandler(COMMAND_IDS.focusSidebar, "application", goToSidebar),
      shortcutManager.registerHandler(COMMAND_IDS.maximizeWorkspacePanel, "application", maximizeWorkspacePanel),
      shortcutManager.registerHandler(COMMAND_IDS.stashPrompt, "chat", stashPrompt),
      // The go-to jumps, from every region the leader can start in.
      ...getCommandDefinition(COMMAND_IDS.focusComposer).contexts.map((context) =>
        shortcutManager.registerHandler(COMMAND_IDS.focusComposer, context, focusComposer, { when: hasComposer })),
      ...getCommandDefinition(COMMAND_IDS.focusWorkspacePanel).contexts.map((context) =>
        shortcutManager.registerHandler(COMMAND_IDS.focusWorkspacePanel, context, focusWorkspacePanel, { when: () => Boolean(workspacePanelScope()) })),
      ...getCommandDefinition(COMMAND_IDS.focusTranscript).contexts.map((context) =>
        shortcutManager.registerHandler(COMMAND_IDS.focusTranscript, context, focusTranscript, { when: hasTranscript })),
      shortcutManager.registerHandler(COMMAND_IDS.focusMainPane, "application", focusMainPane),
      shortcutManager.registerHandler(COMMAND_IDS.nextTab, "application", () => stepTab(1), { when: () => Boolean(tabsToStep() || fileTabsToStep()) }),
      shortcutManager.registerHandler(COMMAND_IDS.previousTab, "application", () => stepTab(-1), { when: () => Boolean(tabsToStep() || fileTabsToStep()) }),
      shortcutManager.registerHandler(COMMAND_IDS.nextPane, "application", () => stepPane(1), { when: () => splitShown() && !isMobileLayout() }),
      shortcutManager.registerHandler(COMMAND_IDS.previousPane, "application", () => stepPane(-1), { when: () => splitShown() && !isMobileLayout() }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "application", toggleChatWorkspaceFocus, { when: () => Boolean(workspacePanelScope()) && hasComposer() }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "chat", toggleChatWorkspaceFocus, { when: () => Boolean(workspacePanelScope()) && hasComposer() }),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "workspace-panel", toggleChatWorkspaceFocus),
      // Moving acts on the tool that has the keyboard: the dock's, or the split's.
      shortcutManager.registerHandler(COMMAND_IDS.workspaceMoveToMain, "workspace-panel", () => openBeside(dockTool()), { when: () => !isMobileLayout() && panelOpen() && !document.activeElement?.closest(".main-split") }),
      shortcutManager.registerHandler(COMMAND_IDS.workspaceMoveToDock, "workspace-panel", () => { const pane = paneOf(document.activeElement); const view = toolView(); if (pane !== null && !isToolView(viewOf(pane)) && canDock(pane)) dockPane(pane); else if (view) moveToDock(view); }, { when: () => splitShown() && Boolean(document.activeElement?.closest(".main-split")) }),
      ...(["chat"] as const).map((context) => shortcutManager.registerHandler(COMMAND_IDS.workspaceMoveToDock, context, () => { const pane = paneOf(document.activeElement); if (pane !== null) dockPane(pane); }, { when: () => { const pane = paneOf(document.activeElement); return pane !== null && canDock(pane); } })),
      // A dashboard is the chat's sibling region and keeps what the main pane
      // could do there before regions had names.
      shortcutManager.registerHandler(COMMAND_IDS.stashPrompt, "dashboard", stashPrompt),
      // Each page declares its sections; the leader offers the ones it has.
      ...([["dashboardComposer", "composer"], ["dashboardChats", "chats"], ["dashboardProjects", "projects"], ["dashboardWorkspaces", "workspaces"], ["dashboardTerminals", "terminals"], ["dashboardChanges", "changes"], ["dashboardFiles", "files"]] as const)
        .map(([id, section]) => shortcutManager.registerHandler(COMMAND_IDS[id], "dashboard", () => { focusSplitSection(section); }, { when: () => splitSections().has(section) })),
      shortcutManager.registerHandler(COMMAND_IDS.toggleChatWorkspaceFocus, "dashboard", toggleChatWorkspaceFocus, { when: () => Boolean(workspacePanelScope()) && hasComposer() }),
    ];
    const uninstallShortcuts = shortcutManager.install(window);
    window.addEventListener("keydown", dismissOpenLayer, { capture: true });
    // The regions around focus, innermost first, each an active context: focus
    // in the composer makes composer, chat and application active in that
    // order (SHORTCUT_REGION_PARENTS). A closed workspace panel is not a place.
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
      // Main and workspace show their line whenever focus enters. The sidebar
      // shows it only after its go-to shortcut. Focus outside a region keeps
      // the last owner until another region receives focus.
      const outermost = regions.at(-1);
      if (!outermost || !(outermost.element instanceof HTMLElement)) return;
      if (outermost.name === "sidebar") {
        if (heldRegion !== outermost.element) holdRegion(null);
      } else holdRegion(outermost.element);
    };
    const onFocusIn = (event: FocusEvent) => syncFocusedShortcutContext?.(event.target);
    window.addEventListener("focusin", onFocusIn);
    syncFocusedShortcutContext(document.activeElement);
    onCleanup(() => {
      syncFocusedShortcutContext = undefined;
      holdRegion(null);
      window.removeEventListener("keydown", dismissOpenLayer, true);
      window.removeEventListener("focusin", onFocusIn);
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
        // Back off an untracked thread still at work asks first, as any other
        // way off it does; staying puts its address back.
        const open = harnessThread();
        if (open && routeAddress() !== threadPath(open) && !leaveHarnessThread()) {
          history.pushState({}, "", threadPath(open));
          return;
        }
        if (location.pathname === "/") {
          openDashboard("none");
          return;
        }
        if (location.pathname === "/computer" || location.pathname.startsWith("/computer/harness/")) {
          openComputerRoute();
          return;
        }
        if (location.pathname === "/terminal") {
          openTerminalRoute("none");
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
        if (!owner || !target) throw new Error("Chat not found");
        await chat.select(target, owner, {
          history: "none",
          onCommit: () => {
            setRouteKind("chat");
            setRouteBootstrapError("");
            setRouteBootstrap("ready");
          },
        });
      })().catch((error) => showError(error)).finally(() => { requestAnimationFrame(() => { restoringPanes = false; }); });
    };
    window.addEventListener("popstate", onPopState);
    onCleanup(() => window.removeEventListener("popstate", onPopState));
    // Everything read on the way in waits out a server that is still starting
    // (apiWhenServed), rather than failing once and leaving the page loading.
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
    void apiWhenServed<{ partialContinue?: boolean; maxAttachmentBytes?: number }>("/v0/capabilities")
      .then((payload) => {
        setPartialContinue(payload.partialContinue !== false);
        const maxBytes = payload.maxAttachmentBytes;
        if (typeof maxBytes === "number" && Number.isSafeInteger(maxBytes) && maxBytes > 0) setMaxAttachmentBytes(maxBytes);
      })
      .catch(() => setPartialContinue(true));
    void apiWhenServed<{ installations: Installation[] }>("/v0/pi-installations")
      .then((payload) => setInstallations(asList<Installation>(payload.installations)))
      .catch(() => setInstallations([]))
      .finally(() => setInstallationsLoading(false));

    const routeId = initialRouteId;
    const selectedChatRequest = routeId ? Promise.all([
      apiWhenServed<ChatSummary>(`/v0/chats/${encodeURIComponent(routeId)}`, true),
      apiWhenServed<TranscriptDetail>(`/v0/sessions/${encodeURIComponent(routeId)}`, true),
    ]) : null;
    void (async () => {
      const [cataloguePayload, selectedChat] = await Promise.all([
        catalogueRequest,
        selectedChatRequest || Promise.resolve(null),
      ]);
      const projects = asList<Project>(cataloguePayload.projects).map((project) => ({ ...project, sessions: asList<ChatSummary>(project.sessions) }));
      migrateWorkspacePanelStorage(workspacePanelScopes(projects));
      catalogue.setProjects(projects);
      // Usually the server says what the cache did; then there is nothing to
      // redraw, and replacing every row with an equal one was a phone's
      // tenth of a second.
      if (cachedCatalogue) void catalogueFresh.then((fresh) => {
        if (JSON.stringify(fresh) === JSON.stringify(cachedCatalogue)) return;
        catalogue.setProjects(asList<Project>(fresh.projects).map((project) => ({ ...project, sessions: asList<ChatSummary>(project.sessions) })));
      }).catch(() => {});
      if (selectedChat) {
        const [target, detail] = selectedChat;
        const project = projects.find((item) => item.id === target.projectId) || projects[0];
        if (!project) throw new Error("Conduit has no chat project");
        await chat.initialize(target, project, detail);
        setRouteKind("chat");
        setRouteBootstrap("ready");
      } else if (initialProjectRouteId) {
        const project = projects.find((item) => projectMatchesPath(item, initialProjectRouteId));
        if (!project) throw new Error("Project not found");
        catalogue.selectProject(project);
        setRouteKind("project");
        setRouteBootstrap("ready");
      } else if (initialComputerRoute) {
        openComputerRoute();
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
        const created = await api<ChatSummary>("/v0/chats", { method: "POST", body: JSON.stringify({ projectId: project.id, templateId: templatePayload.defaultTemplateId || "assistant" }) });
        history.replaceState({}, "", `/chat/${created.id}`);
        await chat.initialize(created, project);
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

  const mainDropHandlers = {
    onDragEnter: (event: DragEvent) => { if (dockDragging(event)) { event.preventDefault(); setSplitDropActive(true); return; } if (routeKind() === "chat" || harnessThread()) dropHandlers.onDragEnter(event); },
    onDragOver: (event: DragEvent) => { if (dockDragging(event)) { event.preventDefault(); setSplitDropActive(true); return; } if (routeKind() === "chat" || harnessThread()) dropHandlers.onDragOver(event); },
    onDragLeave: (event: DragEvent) => { if (splitDropActive()) { if (!(event.relatedTarget instanceof Node && (event.currentTarget as Node).contains(event.relatedTarget))) setSplitDropActive(false); return; } if (routeKind() === "chat" || harnessThread()) dropHandlers.onDragLeave(event); },
    onDrop: (event: DragEvent) => {
      const drag = readToolDrag(event);
      if (drag) { event.preventDefault(); setSplitDropActive(false); if (drag.from === "dock") openBeside(drag.tool); return; }
      if (routeKind() === "chat" || harnessThread()) dropHandlers.onDrop(event);
    },
  };
  const dropHandlers = {
    onDragEnter: (event: DragEvent) => { if (!event.dataTransfer?.types.includes("Files")) return; event.preventDefault(); dragDepth += 1; setDropActive(true); },
    onDragOver: (event: DragEvent) => { if (event.dataTransfer?.types.includes("Files")) event.preventDefault(); },
    onDragLeave: (event: DragEvent) => { event.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) setDropActive(false); },
    onDrop: (event: DragEvent) => { event.preventDefault(); dragDepth = 0; setDropActive(false); const files = filesFromDataTransfer(event.dataTransfer); if (files.length) attachments.addFiles(files); },
  };

  /*
   * One chat's surface -- its header, transcript and composer -- drawn from
   * its session, for whichever pane shows it (docs/design/panes-and-rail.md,
   * stage 5). What differs by pane comes in as props: the actions only the
   * main chat has yet, and the side's swap and close.
   */
  /*
   * The pages either pane can show, drawn from the pane's session: its
   * composer is the page's unsent chat, and sending makes it that pane's chat
   * (docs/design/panes-and-rail.md, stage 5d).
   */
  const PageComposer = (props: { session: ChatSession; place?: ReturnType<typeof chatPlace>; keyboardOwner: () => boolean; onSendDraft: (prompt: string) => Promise<void> }) => {
    const current = props.session;
    return <Composer
      chat={current.chat}
      place={props.place}
      supports={current.capability}
      attachments={current.attachments}
      attachmentsSupported={current.capability("attachments", true)}
      models={current.models}
      permissions={current.capability("permissionModes") ? current.permissions : undefined}
      serviceLevels={current.manifest()?.serviceLevels?.length ? current.serviceLevels : undefined}
      profiles={profiles()}
      activeProfile={current.activeProfile()}
     
      serverOnline={runtime.connectivity() === "online"}
      voiceSettings={voiceSettings()}
      keyboardOwner={props.keyboardOwner}
      onChooseProfile={(id) => void current.switchProfile(id)}
      onOpenSettings={openSettings}
      onOpenModelSelector={openModelSelector}
      modelSelectorShortcut={shortcutManager.formatEffectiveBinding(COMMAND_IDS.openModelSelector)}
      onOpenAttachments={current.openAttachments}
      onStatusChange={current.setComposerStatus}
      onSendDraft={props.onSendDraft}
    />;
  };
  const openTerminalFromPage = (terminal: { id: string; projectId: string; cwd?: string | null }, maximized: boolean) => {
    if ((terminal.projectId === "computer" || terminal.projectId.startsWith("computer:")) && terminal.cwd) {
      openComputer();
      void browseComputer(terminal.cwd).then(() => { openWorkspaceView("terminal", terminal.id); if (maximized) setWorkspaceExpanded(true); });
      return;
    }
    const project = catalogue.projects().find((item) => item.id === terminal.projectId);
    if (!project) return showError("The terminal scope is no longer available.");
    void createChat(project).then((created) => {
      if (!created) return;
      openWorkspaceView("terminal", terminal.id);
      if (maximized) setWorkspaceExpanded(true);
    });
  };
  const AppDashboardPage = (props: { session: ChatSession; place?: ReturnType<typeof chatPlace>; keyboardOwner: () => boolean; onSendDraft: (prompt: string) => Promise<void>; onOpenChat: (target: ChatSummary, project: Project) => void; actions?: JSX.Element; tabActions?: JSX.Element }) => <>
    <ChatHeader title="Conduit Dashboard" panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} appDashboard actions={props.actions}  tabActions={props.tabActions} />
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
      onNewChat={(project) => void startNewChat(project)}
      onOpenWorkspaceIdentity={openWorkspaceIdentity}
      onOpenWorkspaceSettings={(project) => openSettings("workspaces", project.id)}
      onMoveProjectChats={(source, target) => void moveProjectChats(source, target)}
      onOpenChatTerminal={(target, project) => { void openChat(target, project).then(() => openWorkspaceView("terminal")); }}
      onSearchChats={(scope) => openPalette("chat-search", scope === "unscoped" ? "scope:chats " : "", true)}
      onOpenTerminalView={() => openTerminalRoute()}
      onOpenSettings={() => openSettings()}
      profiles={profiles()}
      onOpenTerminal={(terminal) => openTerminalFromPage(terminal, false)}
      onOpenTerminalMaximized={(terminal) => openTerminalFromPage(terminal, true)}
      onPrefetchTerminal={prefetchWorkspaceTerminal}
    />
  </>;
  const ProjectPage = (props: { session: ChatSession; project: Project; keyboardOwner: () => boolean; onSendDraft: (prompt: string) => Promise<void>; onOpenChat: (target: DashboardChat, project: Project) => Promise<void>; target?: { project: Project }; actions?: JSX.Element; tabActions?: JSX.Element }) => <>
    <ChatHeader project={props.project} title={props.project.name} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => void shareProject(props.project)} onRename={() => runSidebar("rename-folder", props.target ?? {})} onDelete={() => runSidebar("delete-project", props.target ?? {})} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} dashboard actions={props.actions}  tabActions={props.tabActions} />
    <ProjectDashboard project={props.project} runtime={runtime} profiles={profiles()} onOpenHarnessThread={(harnessId, path, id, title) => void openHarnessThread({ harnessId, path, id, title })}
      composer={<PageComposer session={props.session} keyboardOwner={props.keyboardOwner} onSendDraft={props.onSendDraft} />}
      onOpenChat={props.onOpenChat}
      onOpenChatTerminal={(target, project) => { void openChat(target, project).then(() => openWorkspaceView("terminal")); }}
      onPrefetchChat={chat.prefetch}
      onContextAction={(type, target) => runSidebar(type, target)}
      isPinned={isSidebarPinned}
      onOpenView={(view) => openWorkspaceView(view)}
      onOpenFile={canOpenFilePanes() ? (path) => openFileDocument({ projectId: props.project.id, path }, { beside: altActivation(), edit: false }) : undefined}
      fileView={canOpenFilePanes() ? (path) => formatFileView([{ projectId: props.project.id, path }]) : undefined}
      onOpenTerminal={(terminal) => openWorkspaceView("terminal", terminal.id)}
      onOpenTerminalMaximized={(terminal) => { openWorkspaceView("terminal", terminal.id); setWorkspaceExpanded(true); }}
      onPrefetchTerminal={prefetchWorkspaceTerminal}
      onSearchChats={() => openPalette("chat-search", `in:${props.project.id} `, true)}
      onRename={() => runSidebar("rename-folder", props.target ?? {})} onDelete={() => runSidebar("delete-project", props.target ?? {})}
      onOpenSettings={openSettings} onSaveAppearance={saveWorkspaceAppearance} onRefresh={refresh} onCancelClone={cancelClone} onDestroyWorkspace={(confirmation) => destroyWorkspace(props.project, confirmation)} onError={showError} />
  </>;
  // A workspace's other agents: two chats editing the same files.
  const workspaceNotice = (project: Project | undefined, chatId: string | null) => <Show when={project?.kind === "workspace" && [...runtime.processes().values()].some((process) => process.chatId !== chatId && process.active)}><div class="workspace-warning"><TriangleAlertIcon /><div><strong>Another chat is working in this Workspace</strong><p>Both agents can edit the same files. Conduit does not lock the Workspace or create worktrees automatically.</p></div></div></Show>;
  const ChatSurface = (props: {
    session: ChatSession;
    project?: Project;
    keyboardOwner: () => boolean;
    onShare: () => void;
    onRename?: () => void;
    onDelete?: () => void;
    actions?: JSX.Element;
    tabActions?: JSX.Element;
    tabs?: JSX.Element;
    notice?: JSX.Element;
    place?: ReturnType<typeof chatPlace>;
    modelSelector?: boolean;
    stackRef?: (element: HTMLDivElement) => void;
  }) => {
    const current = props.session;
    const surfaceChat = current.chat;
    return <>
      <ChatHeader project={props.project} onOpenPlace={openPlace} title={surfaceChat.title() || (surfaceChat.status() === "active" ? "Untitled chat" : "New chat")} profile={current.activeProfile()} runtime={surfaceChat.runtimeIdentity()} live={surfaceChat.live() as unknown as Record<string, unknown>} chat={surfaceChat} composerStatus={current.composerStatus()} connectivity={runtime.connectivity()} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={props.onShare} onRename={props.onRename} onDelete={props.onDelete} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} actions={props.actions} tabActions={props.tabActions} tabs={props.tabs} />
      {props.notice}
      <Conversation chat={surfaceChat} busy={surfaceChat.presentation().kind === "opening_live"} stackRef={props.stackRef}
        transcript={<Transcript chat={surfaceChat} supports={current.capability} partialContinue={partialContinue()} markdownRenderer={markdownRenderer()} profileLabel={current.activeProfile()?.label || current.activeProfile()?.id || surfaceChat.templateId() || undefined} projectId={props.project?.id} />}
        composer={<Composer chat={surfaceChat} place={props.place} supports={current.capability} attachments={current.attachments} attachmentsSupported={current.capability("attachments", true)} models={current.models} permissions={current.capability("permissionModes") ? current.permissions : undefined} serviceLevels={current.manifest()?.serviceLevels?.length ? current.serviceLevels : undefined} profiles={profiles()} activeProfile={current.activeProfile()} onOpenModelSelector={props.modelSelector ? openModelSelector : undefined} modelSelectorShortcut={props.modelSelector ? shortcutManager.formatEffectiveBinding(COMMAND_IDS.openModelSelector) : undefined} serverOnline={runtime.connectivity() === "online"} voiceSettings={voiceSettings()} keyboardOwner={props.keyboardOwner} onChooseProfile={(id) => void current.switchProfile(id).catch(showError)} onOpenSettings={openSettings} onOpenAttachments={current.openAttachments} onStatusChange={current.setComposerStatus} />} />
    </>;
  };

  return <>
    <Toaster richColors />
    <input ref={session.setAttachInput} type="file" multiple hidden aria-hidden="true" onChange={(event) => { if (event.currentTarget.files) attachments.addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} />
    <FrostDialog open={Boolean(workspaceIdentityProject())} onOpenChange={(open) => { if (!open) closeWorkspaceIdentity(); }} close size="wide" class="workspace-appearance-dialog" title="Workspace identity" description="Choose a short mark or a Lucide icon, then choose a preset or custom color.">
        <Show when={workspaceIdentityProject()}>{(project) => <WorkspaceAppearanceEditor compact value={project().workspaceAppearance} saving={workspaceIdentitySaving()} onSave={(appearance) => void saveWorkspaceIdentity(appearance)} />}</Show>
    </FrostDialog>
    <Show when={routeKind() !== "terminal"}>
    <Sidebar projects={sidebarFilled() ? catalogue.projects() : []} catalogueLoaded={sidebarFilled() && catalogue.loaded()} projectId={catalogue.projectId()} selectedId={catalogue.selectedId()} focusedId={keyboardSlot() !== null ? slotChatId(keyboardSlot()!) : null} openIds={openChatIds()} onOpenChatBeside={isMobileLayout() ? undefined : openChatBeside} navigatingId={chat.navigatingId()} dashboard={routeKind() === "dashboard" && !paneAOverride()} project={routeKind() === "project"} computer={routeKind() === "computer" && !paneAOverride()} routeCovered={paneAOverride() !== null} terminal={false} runtime={runtime} chatLimit={sidebarChatLimit()}
      connectivity={runtime.connectivity()} workspaceSuggestions={workspaceSuggestions()} workspacePolicy={workspacePolicy()} command={sidebarCommand()}
      sidebarPins={sidebarPins()} onTogglePin={toggleSidebarPin}
      mobileOpen={mobileSidebarOpen()} onMobileOpenChange={setMobileSidebar}
      onWorkspaceSuggestionsNeeded={() => void loadWorkspaceSuggestions()}
      onNewChat={async (project) => { await startNewChat(project); }} onPrefetchChat={chat.prefetch} onOpenChat={openChatHere} onFocusMainPane={focusMainPane} onEnterMainPane={() => { if (!isMobileLayout() && !document.activeElement?.closest(".main-split") && keyboardPaneSlot() === null) enterMainPane(); }} onOpenProject={async (project) => { if (altActivation()) openPageBeside(`project:${project.id}`); else await openProjectHere(project); }} onAddProject={addProject} onRenameChat={renameChat} onRenameProject={renameProject}
      onOpenProjectMaximized={openProjectWithMaximizedWorkspace}
      onMoveChat={moveChat} onMoveChats={moveChats} onMoveProjectChats={moveProjectChats} onCopyTranscript={copyTranscript} onCopyChatLinks={copyChatLinks}
      onDeleteChat={deleteChat} onDeleteChats={deleteChats} onDeleteProject={deleteProject}
      onStopProcess={(target) => stopChatProcess(target.id)}
      onOpenTerminal={(target, project) => { void openChat(target, project).then(() => openWorkspaceView("terminal")); }}
      onOpenPty={(terminal) => {
        if (terminal.projectId.startsWith("computer:")) {
          openTerminalRoute("push", terminal.id);
          return;
        }
        if ((terminal.projectId === "computer" || terminal.projectId.startsWith("computer:")) && terminal.cwd) {
          openComputer();
          void browseComputer(terminal.cwd).then(() => openWorkspaceView("terminal", terminal.id));
          return;
        }
        const project = catalogue.projects().find((item) => item.id === terminal.projectId);
        if (!project) return showError("The terminal scope is no longer available.");
        void createChat(project).then((created) => {
          if (created) openWorkspaceView("terminal", terminal.id);
        });
      }}
      onOpenComputer={() => { if (altActivation()) openPageBeside("computer"); else void openComputerHere(); }}
      onOpenHarness={(id) => { if (altActivation()) openPageBeside(`harness:${encodeURIComponent(id)}`); else void openHarnessHere(id); }} selectedHarness={paneAOverride() ? undefined : computerHarness()}
      onOpenTerminalView={() => openTerminalRoute()}
      onOpenDashboard={() => { if (altActivation()) openPageBeside("dashboard"); else void openDashboardHere(); }}
      onOpenWorkspaceIdentity={openWorkspaceIdentity} onOpenSettings={openSettings} onOpenPalette={(page, initialQuery) => openPalette(page || null, initialQuery || "", page === "chat-search")}
      onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating()}
      updateState={updateState()} onTakeUpdate={() => void takePwaUpdate()}
      onAddServer={() => setAddingServer(true)}
      onLogout={() => void logout()} />
    <FrostDialog open={addingServer()} title="Add server" close size="wide" onOpenChange={setAddingServer} class="add-server-dialog">
      <ServerConnectForm adding onDone={(origin) => {
        setAddingServer(false);
        // Told to the server being left, before leaving it: otherwise the one
        // that was asked to remember this address is the only one that never
        // hears about it.
        void publishServerDirectory(servers()).finally(() => switchToServer(origin, isInstalledClient()));
      }} />
    </FrostDialog>
    <div class="workspace-layout" ref={(element) => { const observer = new ResizeObserver(() => setLayoutWidth(element.clientWidth)); observer.observe(element); onCleanup(() => observer.disconnect()); }}>
    <main data-slot="sidebar-inset" data-region={paneAOverride() ? "workspace-panel" : routeKind() === "chat" || harnessThread() ? "chat" : routeKind() === "terminal" ? "terminal" : "dashboard"} tabIndex={-1} onPointerDown={focusChatSurface} onKeyDown={paneKeydown} class={`chat-main${routeKind() === "chat" && emptyLayout() ? " chat-main-empty" : ""}${routeKind() === "chat" && emptyChat() && !emptyLayout() ? " chat-main-sending" : ""}${routeKind() === "chat" && withheldLiveChat() ? " chat-main-live-opening" : ""}${workspaceExpanded() ? " workspace-expanded" : ""}`} style={{ ...(splitShown() ? { flex: `${paneWeights()[0]} 1 0`, "min-width": paneMotion()?.slot === "main" ? "0px" : `${paneMinWidth("main")}px` } : {}), ...(paneMotion()?.slot === "main" ? { opacity: 0 } : {}), ...(paneMotion()?.slot === "main" && paneMotion()!.collapsed ? { "margin-left": "0px", "margin-right": "0px" } : {}) }} {...mainDropHandlers}>
      <Show when={splitDropActive()}><div class="main-split-drop" aria-hidden="true" /></Show>
      {/* Pane A holding a file viewer or a tool, over its route (5f). */}
      <Show when={parseFileView(paneAOverride())}>{renderFileViewer("main")}</Show>
      <Show when={paneAOverride()?.startsWith("term:")}>{renderTerminalDocument("main", () => paneAOverride()!.slice("term:".length))}</Show>
      <Show when={toolInPaneA()}><div ref={(element) => { setPaneAToolHost(element); onCleanup(() => setPaneAToolHost(undefined)); }} class="pane-a-tool-host" /></Show>
      <Show when={!paneAOverride() && routeBootstrap() === "ready"} fallback={paneAOverride() ? null : <div class="chat-bootstrap" role={routeBootstrap() === "error" ? "alert" : "status"}>{routeBootstrap() === "error"
        ? routeBootstrapError() || (routeKind() === "project" ? "This project could not be loaded." : "This chat could not be loaded.")
        : routeKind() === "project" ? "Loading project…" : routeKind() === "dashboard" ? "Loading Conduit…" : "Loading chat…"}</div>}>
        <Show when={["chat", "dashboard", "project"].includes(routeKind()) && meteorField() && arrived()}>
          <div class="chat-meteors" aria-hidden="true">
            <DefaultMeteorShower />
          </div>
        </Show>
        <Show when={routeKind() === "dashboard"}>
          <AppDashboardPage session={session} place={chatPlace()} tabActions={paneTabActions("main")} keyboardOwner={() => !sideHasKeyboard()} onOpenChat={(target, project) => void openChatFromPage(target, project)}
            onSendDraft={async (prompt) => {
              const project = chatOwner() || catalogue.projects().find((item) => item.slug === "chat");
              const id = chat.loadedId();
              if (!project || !id) return;
              // Sending is what ends a draft -- the server flips the status
              // on the prompt itself -- so the row goes in active. Listing it
              // as a draft hid it behind the New chat row until the first
              // turn checkpointed, which on a long or interrupted answer left
              // the sidebar saying "No chats" over an open conversation.
              catalogue.setProjects((current) => current.map((item) => item.id === project.id
                ? { ...item, sessions: [{ id, projectId: project.id, status: "active", title: chat.title() || "New chat", templateId: chat.templateId() || undefined }, ...item.sessions.filter((session) => session.id !== id)] }
                : item));
              history.pushState({}, "", `/chat/${id}`);
              chat.setDraft(prompt);
              await sendFromDashboard();
            }} />
        </Show>
        <Show when={routeKind() === "computer"}>
          <Show when={harnessThread()} fallback={<Show when={computerHarness()} fallback={<>
            <ChatHeader title="Computer" tabActions={paneTabActions("main")} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} appDashboard alone />
            <ComputerDashboard projects={catalogue.projects()} location={computerLocation()} loading={computerLoading()} error={computerError()} onOpenHarnessHere={openComputerHarnessHere} onBrowse={(path) => void browseComputer(path)} onPrefetch={prefetchComputerFolder} onMakeWorkspace={() => void designateComputerWorkspace()} onCreateWorkspace={(path) => void createComputerWorkspace(path)} onOpenWorkspace={(project) => void openProject(project)} onManageWorkspace={(action, project) => { if (action === "rename") runSidebar("rename-folder", { project }); else if (action === "identity") openWorkspaceIdentity(project); else runSidebar("delete-project", { project }); }} onStartWorkspaceAction={(action, path) => runSidebar(action === "created" ? "new-workspace-created" : "new-workspace-cloned", { path })} onOpenView={openWorkspaceView} onOpenTerminalView={() => openTerminalRoute()} onOpenTerminalHere={() => void openComputerTerminalHere()} onOpenFile={(path) => { setComputerFile({ path }); openWorkspaceView("files"); }} />
          </>}>{(harnessId) => <>
            <ChatHeader title={harnessLabelFor(harnessId()) || harnessId()} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => void startNewChat()} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => {}} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} appDashboard alone />
            <HarnessDashboard harnessId={harnessId()} projects={catalogue.projects()} runtime={runtime} scope={harnessScope()} onScope={scopeHarness} home={computerLocation()?.home || ""}
              composer={(input) => {
                const drafted = () => { const draft = harnessDraft(); return Boolean(draft && draft.harnessId === harnessId() && chat.loadedId() === draft.chatId); };
                // Once there is a draft it is a chat, and chooses as one; the
                // page's pickers stand in before that, and hand their choice on.
                const choices = (): HarnessChoices => drafted()
                  ? { model: models.model(), thinkingLevel: models.effort(), permissionMode: permissions.selected() }
                  : input.choices;
                // A draft already made follows the folder.
                createEffect(on(() => input.folder.current, (cwd) => {
                  if (untrack(drafted)) void ensureHarnessDraft(harnessId(), cwd, untrack(choices));
                }, { defer: true }));
                const manifest = () => harnessCapabilities()[harnessProfile(harnessId())?.implementation || harnessId()] || null;
                const use = () => ensureHarnessDraft(harnessId(), input.folder.current, choices());
                return <div style={{ display: "contents" }}
                  onInput={(event) => { if (event.target instanceof HTMLTextAreaElement) typedBeforeDraft = event.target.value; void use(); }}>
                  <Composer chat={chat} launches supports={(name) => resolveCapability(manifest(), chat.capabilities(), name, false)} attachments={attachments} attachmentsSupported={Boolean(manifest()?.attachments)} models={drafted() ? models : input.models} modelsLoading={drafted() ? undefined : input.loading} folder={input.folder} permissions={manifest()?.permissionModes ? (drafted() ? permissions : input.permissions) : undefined} serviceLevels={manifest()?.serviceLevels?.length ? serviceLevels : undefined} profiles={harnessProfile(harnessId()) ? [harnessProfile(harnessId())!] : []} activeProfile={harnessProfile(harnessId())} onOpenModelSelector={openModelSelector} modelSelectorShortcut={shortcutManager.formatEffectiveBinding(COMMAND_IDS.openModelSelector)} serverOnline={runtime.connectivity() === "online"} voiceSettings={voiceSettings()} onChooseProfile={() => {}} onOpenSettings={openSettings} onOpenAttachments={() => void use().then(() => session.openAttachments())} onStatusChange={setComposerStatus} onSendDraft={(prompt) => sendHarnessDraft(harnessId(), input.folder.current, choices(), prompt)} />
                </div>;
              }}
              onStartThread={(launch) => sendHarnessDraft(launch.harnessId, launch.cwd, launch, launch.prompt)} onOpenThread={(thread) => void openHarnessThread(thread)} onOpenChat={(target, project) => void openChat(target, project)} />
          </>}</Show>}>{(thread) => {
            const workspace = () => catalogue.projects().find((project) => !isConduitManagedProject(project) && project.workingRoot === thread().path);
            const label = () => harnessLabelFor(thread().harnessId) || thread().harnessId;
            return <>
              <Show when={dropActive()}><div class="chat-drop-overlay"><div>Drop files to attach</div></div></Show>
              <ChatHeader project={workspace()} placeLabel={label()} onOpenPlace={() => openComputerHarness(thread().harnessId, "push", thread().path)} title={chat.title() || thread().title || "Untitled thread"} badge={<OutsideThreadChip harness={label()} folder={thread().path} workspace={Boolean(workspace())} busy={trackingThread()} onTrack={() => void trackHarnessThread()} />} profile={activeProfile()} runtime={chat.runtimeIdentity()} live={chat.live() as unknown as Record<string, unknown>} chat={chat} composerStatus={composerStatus()} connectivity={runtime.connectivity()} panelOpen={panelOpen()} mobileSidebarOpen={mobileSidebarOpen()} onToggleMobileSidebar={() => setMobileSidebar(!mobileSidebarOpen())} onNewChat={() => openComputerHarness(thread().harnessId, "push", thread().path)} onOpenPalette={() => openPalette(null)} onOpenSearch={toggleSearchPalette} onTogglePanel={togglePanel} onShare={() => void shareHarnessThread()} onUpdatePwa={() => void runPwaUpdate()} pwaUpdating={pwaUpdating} />
              {/* The same conversation a chat page has; only moving it to another
                  place is missing, since the thread's folder is where it ran. */}
              <Conversation chat={chat} busy={openingLiveChat()} stackRef={(element) => { chatComposerStack = element; }}
                transcript={<Transcript chat={chat} supports={chatCapability} partialContinue={partialContinue()} markdownRenderer={markdownRenderer()} profileLabel={label()} projectId={catalogue.projectId()} />}
                composer={<Composer chat={chat} supports={chatCapability} attachments={attachments} attachmentsSupported={chatCapability("attachments", true)} models={models} permissions={chatCapability("permissionModes") ? permissions : undefined} serviceLevels={chatManifest()?.serviceLevels?.length ? serviceLevels : undefined} profiles={profiles()} activeProfile={activeProfile()} onOpenModelSelector={openModelSelector} modelSelectorShortcut={shortcutManager.formatEffectiveBinding(COMMAND_IDS.openModelSelector)} serverOnline={runtime.connectivity() === "online"} voiceSettings={voiceSettings()} onChooseProfile={() => {}} onOpenSettings={openSettings} onOpenAttachments={session.openAttachments} onStatusChange={setComposerStatus} />} />
            </>;
          }}</Show>
        </Show>
        <Show when={routeKind() !== "dashboard" && routeKind() !== "computer"}>
        <Show when={routeKind() === "project" && selectedProject()} fallback={<>
          <Show when={dropActive()}><div class="chat-drop-overlay"><div>Drop files to attach</div></div></Show>
          <ChatSurface session={session} project={selectedProject()} tabActions={paneTabActions("main")} {...paneTabRow("main")} keyboardOwner={() => !sideHasKeyboard()} place={chatPlace()} modelSelector stackRef={(element) => { chatComposerStack = element; }}
            onShare={() => void shareChat()} onRename={() => runSidebar("rename-chat")} onDelete={() => runSidebar("delete-chat")}
            notice={workspaceNotice(selectedProject(), catalogue.selectedId())} />
        </>}>
          <ProjectPage session={session} project={selectedProject()!} tabActions={paneTabActions("main")} keyboardOwner={() => !sideHasKeyboard()} onOpenChat={(target, project) => openChatFromPage(target, project)}
            onSendDraft={async (prompt) => {
              const project = selectedProject();
              const id = chat.loadedId();
              if (!project || !id) return;
              // Sending is what ends a draft -- the server flips the status
              // on the prompt itself -- so the row goes in active. Listing it
              // as a draft hid it behind the New chat row until the first
              // turn checkpointed, which on a long or interrupted answer left
              // the sidebar saying "No chats" over an open conversation.
              catalogue.setProjects((current) => current.map((item) => item.id === project.id
                ? { ...item, sessions: [{ id, projectId: project.id, status: "active", title: chat.title() || "New chat", templateId: chat.templateId() || undefined }, ...item.sessions.filter((session) => session.id !== id)] }
                : item));
              history.pushState({}, "", `/chat/${id}`);
              chat.setDraft(prompt);
              await sendFromDashboard();
            }} />
        </Show>
        </Show>
      </Show>
    </main>
    <For each={renderSlots()}>{(slot, position) => renderSlot(slot, position, false)}</For>
    {/* Docked panes stay mounted, so each keeps its state and tabs; the dock shows one. */}
    <Show when={dockDocHost()} keyed>{(host) =>
      <For each={dockContents()}>{(slot) => <Portal mount={host}>{renderSlot(slot, () => 0, true)}</Portal>}</For>}</Show>
    <Show when={routeKind() === "computer" && computerLocation()}><WorkspacePanel connectivity={runtime.connectivity} projectId={() => computerLocation()!.project.id} projectName={() => computerLocation()!.project.name} sourceControlEnabled={() => computerLocation()!.repository} workingRoot={() => computerLocation()!.project.workingRoot} chatId={() => "computer"} settingsScope={() => "computer"} initialDirectory={() => computerLocation()!.listing} requestedFile={computerFile} open={panelOpen} expanded={workspaceExpanded} focusRequest={workspaceFocusRequest} onFocusRequestComplete={acknowledgeWorkspaceFocus} requestedTab={workspaceViewRequest} onTabChange={setDockTool} splitView={toolView} splitHost={toolHost} documentShown={() => dockSlot() !== null} widthRequest={dockWidthRequest} documentHost={(element) => setDockDocHost((current) => element ?? (current?.isConnected ? current : undefined))} minWidth={dockMinWidth} overlay={dockOverlay} onOpenBeside={isMobileLayout() ? undefined : openBeside} onMoveToDock={moveToDock} onCloseSplit={closeSplit} bindSplit={bindSplit} onOpenFile={canOpenFilePanes() ? openFileDocument : undefined} openFiles={openFileKeys} onToggleExpanded={toggleWorkspaceExpanded} onClose={closePanel} shortcuts={shortcutManager} onBrowseDirectory={(path) => void browseComputer(`${computerLocation()!.project.workingRoot}/${path}`)} onBrowseParent={() => void browseComputer(computerLocation()!.parent)} /></Show>
    <Show when={["chat", "project", "dashboard"].includes(routeKind()) && Boolean(selectedProject()) && Boolean(workspacePanelScope())}><WorkspacePanel connectivity={runtime.connectivity} projectId={() => dockProject()!.id} projectName={() => dockProject()!.name} sourceControlEnabled={() => dockProject()!.kind === "workspace"} workingRoot={() => dockProject()!.workingRoot} chatId={() => dockScope()!} artifactChatId={() => sideFocused() ? focusedChat().loadedId() : routeKind() === "chat" ? chat.loadedId() : null} commentChatId={() => focusedChat().loadedId()} historyAvailable={() => sideFocused() ? focusedSession().history() !== "none" : routeKind() !== "chat" || chatHistory() !== "none"} open={panelOpen} expanded={workspaceExpanded} focusRequest={workspaceFocusRequest} onFocusRequestComplete={acknowledgeWorkspaceFocus} requestedTab={workspaceViewRequest} onTabChange={setDockTool} splitView={toolView} splitHost={toolHost} documentShown={() => dockSlot() !== null} widthRequest={dockWidthRequest} documentHost={(element) => setDockDocHost((current) => element ?? (current?.isConnected ? current : undefined))} minWidth={dockMinWidth} overlay={dockOverlay} onOpenBeside={isMobileLayout() ? undefined : openBeside} onMoveToDock={moveToDock} onCloseSplit={closeSplit} bindSplit={bindSplit} onOpenFile={canOpenFilePanes() ? openFileDocument : undefined} openFiles={openFileKeys} onRequestOpen={() => setPanelOpenForChat(true)} onToggleExpanded={toggleWorkspaceExpanded} onClose={closePanel} shortcuts={shortcutManager} /></Show>
    </div>
    <Show when={dragHintContent()}>{(hint) => <div class="drag-hint" aria-hidden="true" ref={(element) => { dragHintElement = element; placeDragHint(); onCleanup(() => { if (dragHintElement === element) dragHintElement = undefined; }); }}>
      <Show when={hint().icon} keyed>{(icon) => ({ left: <PanelLeftIcon />, right: <PanelRightIcon />, column: <Columns2Icon />, tab: <PanelTopIcon />, swap: <ArrowLeftRightIcon />, here: <PanelTopIcon /> })[icon]}</Show>{hint().text}
    </div>}</Show>
    <Show when={docDrop() && ["left", "middle", "right", "dock"].includes(docDrop()!.zone) ? docDrop() : null}>{(drop) => <div class="doc-drop" aria-hidden="true" style={{ left: `${drop().rect.left}px`, top: `${drop().rect.top}px`, width: `${drop().rect.width}px`, height: `${drop().rect.height}px` }} />}</Show>
    <WorkspaceRail tools={Boolean(routeKind() === "computer" ? computerLocation() : ["chat", "project", "dashboard"].includes(routeKind()) && selectedProject() && workspacePanelScope())} onOpenSearch={toggleSearchPalette} onOpenPalette={() => openPalette(null)}
      panes={splitShown() ? shownSlots().length + 1 : 1} onLayout={applyPaneLayout}
      docked={dockContents().filter((slot) => slotView(slot)).map((slot) => ({ slot, view: slotView(slot)!, name: isDocked(slot) ? viewName(slotView(slot)) : `${viewName(slotView(slot))} (no room; returns when there is)` }))} currentDocked={panelOpen() ? dockSlot() : null} onChooseDocked={chooseDocked} dockOverlay={dockOverlay()} onToggleDockOverlay={toggleDockOverlay}
      current={panelOpen() && dockSlot() === null ? dockTool() : null} inSplit={splitToolShown()} onDock={moveToDock} sourceControlEnabled={routeKind() === "computer" ? Boolean(computerLocation()?.repository) : dockProject()?.kind === "workspace"} onChoose={chooseRailTool} />
    </Show>
    <Show when={routeKind() === "terminal" && routeBootstrap() === "ready"}>
      <TerminalRoute terminalId={terminalRouteId()} connectivity={runtime.connectivity} onOpenConduit={leaveTerminalRoute} />
    </Show>
    <CommandMenu open={paletteOpen()} onOpenChange={setPaletteOpen} onPageChange={setPalettePage} initialPage={palettePage()} initialQuery={paletteInitialQuery()} launchNonce={paletteNonce()} directLaunch={paletteDirectLaunch()}
      context={paletteContext()} runtime={runtime} actions={paletteActions} onChooseModel={(spec) => void focusedModels().chooseModel(spec)} currentModel={focusedModels().model()} scopeModels={focusedModels().allModels()} enabledModelSpecs={focusedModels().enabledModels()} onToggleModelScope={(spec) => { const models = focusedModels(); const enabled = models.enabledModels(); void models.saveScope(enabled.includes(spec) ? enabled.filter((item) => item !== spec) : [...enabled, spec]); }} shortcuts={shortcutManager} />
    <LeaderPalette shortcuts={shortcutManager} />
    <Show when={settingsLoaded()}>
      <Settings open={settingsOpen()} initialSection={settingsSection()} sectionWasNamed={settingsNamedSection()} initialWorkspaceId={settingsWorkspaceId()} onOpenChange={setSettingsOpen} models={models} templates={templates()} templatesLoading={templatesLoading()} defaultTemplateId={defaultTemplateId()} projects={catalogue.projects()} installations={installations()} installationsLoading={installationsLoading()} onInstallationsChange={setInstallations} onDefaultTemplateChange={saveDefaultTemplate} onWorkspaceDefaultChange={saveWorkspaceDefault} markdownRenderer={markdownRenderer()} onMarkdownRendererChange={switchMarkdownRenderer} meteorField={meteorField()} onMeteorFieldChange={switchMeteorField} voiceSettings={voiceSettings()} onVoiceSettingsSave={updateVoiceSettings} sidebarChatLimit={sidebarChatLimit()} onSidebarChatLimitChange={switchSidebarChatLimit} onOpenModelSelector={openModelSelector} shortcuts={shortcutManager} />
    </Show>
  </>;
}

/*
 * Arm the shell with what this client already verified, before anything is
 * dialled. The set is re-sent after every `/v0/server`, but a cold start
 * happens before the first of those, and a pin that arrives after the
 * connection it was for is no pin at all.
 */
void publishTrustedIdentities(trustedIdentities());

const mount = document.getElementById("root")!;
render(() => <ErrorBoundary fallback={(error) => { dismissLaunchMark(); return <div class="crash-screen"><div class="crash-card"><h1>Conduit hit a UI error</h1><p>{error instanceof Error ? error.message : "Unknown interface error"}</p><Button onClick={() => location.reload()}>Reload Conduit</Button></div></div>; }}>
  {nativeApp ? <NativeRoot /> : <App />}
</ErrorBoundary>, mount);
