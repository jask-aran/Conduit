import { createSignal, Show, type JSX } from "solid-js";
import { ChevronRightIcon, EllipsisIcon, MessageSquarePlusIcon, PanelLeftIcon, PanelRightIcon, PencilIcon, RefreshCwIcon, SearchIcon, ShareIcon, TerminalIcon, Trash2Icon } from "lucide-solid";
import { Button, Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/primitives";
import { useLibrary } from "@/components/ui/swap";
import type { Project, RuntimeIdentity, Template } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import { SPINNING_ACTIVITY, type ComposerStatus } from "./composer";
import { ContextBar, ContextBreakdown } from "./context-gauge";
import { contextUsagePercent } from "./context-metrics";
import { HostUiRequests } from "./host-ui-card";
import { VoiceWaveform } from "./voice-waveform";
import { isWorkspace } from "./place-picker";
import { harnessLabelFor } from "../harness-brand";
import { isInstalledClient } from "../platform/installed-client.ts";
import { isMobileLayout } from "../navigation/mobile-layout";
import { headerPill, HeaderActions } from "../navigation/header-pill";
/*
 * A chat's screen: its header, and its transcript with the composer over it.
 * Out of main.tsx so the gallery draws the same ones.
 */
const nativeApp = isInstalledClient();

export function ChatHeader(props: {
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
  const leadingPill = headerPill();
  return <>
    <header class="chat-header">
      <Show when={!props.mobileSidebarOpen}>
        <div class={`mobile-header-leading ${leadingPill().class ?? ""}`} data-composer-surface={leadingPill()["data-composer-surface"]}>
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
            {/* Library previews: the library's heading section (components/ui/swap.ts). */}
            <Show when={useLibrary()} fallback={<MenuGroup>
              <MenuLabel class="chat-header-menu-title">{props.title}</MenuLabel>
              <MenuLabel class="chat-header-menu-meta">{menuLine()}</MenuLabel>
            </MenuGroup>}>
              <div class="ui-section ui-heading" data-kind="heading"><div class="ui-heading-title">{props.title}</div><div class="ui-heading-detail">{menuLine()}</div></div>
            </Show>
            <Show when={!props.dashboard}>
              <Show when={props.chat}>{(chat) => {
                // Opens in place: a submenu has nowhere to go beside a menu that fills a phone.
                const [expanded, setExpanded] = createSignal(false);
                const used = () => contextUsagePercent(chat().contextUsage());
                return <div class={useLibrary() ? undefined : "chat-header-menu-context-block"}>
                  <Show when={useLibrary()}><div role="menuitem" class="ui-row" data-field="" aria-expanded={expanded()} onClick={() => { if (!expanded()) chat().refreshContext(); setExpanded(!expanded()); }}>
                    <span class="ui-label">Context</span><small>{used() == null ? "Unavailable" : `${Math.round(used()!)}% used`}</small><ChevronRightIcon class="ui-chevron" /></div></Show>
                  <Show when={!useLibrary()}><button type="button" class="chat-header-menu-context-trigger" aria-expanded={expanded()}
                    onClick={() => { if (!expanded()) chat().refreshContext(); setExpanded(!expanded()); }}>
                    <span class="chat-header-menu-context-line"><span class="chat-header-menu-section-label">Context</span>
                      <span>{used() == null ? "Unavailable" : `${Math.round(used()!)}% used`}</span><ChevronRightIcon class="chat-header-menu-context-chevron" /></span>
                    <Show when={!expanded()}><ContextBar chat={chat()} /></Show>
                  </button></Show>
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
export function Conversation(props: { chat: ActiveChatStore; busy?: boolean; transcript: JSX.Element; composer: JSX.Element; stackRef?: (element: HTMLDivElement) => void }) {
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

