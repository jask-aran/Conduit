import { createSignal, Show, type JSX } from "solid-js";
import { EllipsisIcon, MessageSquarePlusIcon, PanelLeftIcon, PanelRightIcon, PencilIcon, RefreshCwIcon, SearchIcon, ShareIcon, TerminalIcon, Trash2Icon } from "lucide-solid";
import { Button, MenuTrigger } from "@/components/primitives";
import { Menu, MenuContent, MenuRow, MenuSection } from "@/components/menus";
import { HeadingSection, MenuNote, Rule, Spinner } from "@/components/ui";
import type { Project, RuntimeIdentity, Template } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import { SPINNING_ACTIVITY, type ComposerStatus } from "./composer";
import { ContextBar, ContextBreakdown } from "./context-gauge";
import { contextUsagePercent } from "./context-metrics";
import { VoiceWaveform } from "./voice-waveform";
import { isWorkspace } from "./place-picker";
import { harnessLabelFor } from "../harness-brand";
import { isInstalledClient } from "../platform/installed-client.ts";
import { isMobileLayout } from "../navigation/mobile-layout";
import { headerPill, HeaderActions, PillShell } from "../navigation/header-pill";
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
        <PillShell pill={leadingPill} class="mobile-header-leading">
          <Button variant="ghost" size="icon-sm" class="mobile-sidebar-trigger" data-mobile-open="false" aria-label="Toggle Sidebar" aria-expanded={false} onClick={props.onToggleMobileSidebar}><PanelLeftIcon /></Button>
          <Button variant="ghost" size="icon-sm" class="mobile-new-chat-trigger" aria-label="New chat" title="New chat" onClick={props.onNewChat}><MessageSquarePlusIcon /></Button>
        </PillShell>
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
          <MenuContent>
            <HeadingSection title={props.title} detail={menuLine()} />
            <Show when={!props.dashboard}>
              <Show when={props.chat}>{(chat) => {
                // Opens in place: a submenu has nowhere to go beside a menu that fills a phone.
                const [expanded, setExpanded] = createSignal(false);
                const used = () => contextUsagePercent(chat().contextUsage());
                return <>
                  <MenuSection>
                    <MenuRow closeOnSelect={false} aria-expanded={expanded()} opens meta={used() == null ? "Unavailable" : `${Math.round(used()!)}% used`}
                      onSelect={() => { if (!expanded()) chat().refreshContext(); setExpanded(!expanded()); }}>Context</MenuRow>
                    <Show when={!expanded()}><ContextBar chat={chat()} /></Show>
                  </MenuSection>
                  <Show when={expanded()}><ContextBreakdown chat={chat()} bare canCompact={chat().capabilities()?.compaction !== false} /></Show>
                </>;
              }}</Show>
              <Show when={sessionId()}><MenuSection title="Session ID"><MenuNote>{sessionId()}</MenuNote></MenuSection></Show>
            </Show>
            <Rule />
            <Show when={!props.dashboard && !nativeApp}>
              <MenuSection>
                <MenuRow disabled={props.pwaUpdating()} onSelect={props.onUpdatePwa} icon={<Show when={props.pwaUpdating()} fallback={<RefreshCwIcon />}><Spinner /></Show>}>{props.pwaUpdating() ? "Updating app…" : "Update app"}</MenuRow>
              </MenuSection>
              <Rule />
            </Show>
            <MenuSection>
              <Show when={isMobileLayout()}><MenuRow icon={<PanelRightIcon />} onSelect={props.onTogglePanel}>Workspace panel</MenuRow></Show>
              <MenuRow icon={<ShareIcon />} onSelect={props.onShare}>Share</MenuRow>
              <Show when={props.onRename}>
                <MenuRow icon={<PencilIcon />} onSelect={() => props.onRename?.()}>{props.dashboard ? `Rename ${placeKind()}` : "Rename"}</MenuRow>
              </Show>
              <Show when={props.onDelete}>
                <MenuRow destructive icon={<Trash2Icon />} onSelect={() => props.onDelete?.()}>{props.dashboard ? (placeKind() === "workspace" ? "Unlink workspace" : "Delete project") : "Delete"}</MenuRow>
              </Show>
            </MenuSection>
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
      <div ref={(element) => props.stackRef?.(element)} class="composer-stack">
        {props.composer}
      </div>
    </section>
  </div>;
}

