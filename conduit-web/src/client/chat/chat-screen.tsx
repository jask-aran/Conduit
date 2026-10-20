import { createSignal, Show, type JSX } from "solid-js";
import { EllipsisIcon, MessageSquarePlusIcon, PanelLeftIcon, PanelRightIcon, PencilIcon, RefreshCwIcon, SearchIcon, ShareIcon, TerminalIcon, Trash2Icon } from "lucide-solid";
import { Menu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/menus";
import { Header, HeaderButton, HeaderCrumb, HeadingSection, MenuNote, Rule, Spinner } from "@/components/ui";
import type { Project, RuntimeIdentity, Template } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import { ContextBar, ContextBreakdown } from "./context-gauge";
import { contextUsagePercent } from "./context-metrics";
import { isWorkspace } from "./place-picker";
import { harnessLabelFor } from "../harness-brand";
import { isInstalledClient } from "../platform/installed-client.ts";
import { isMobileLayout } from "../navigation/mobile-layout";
import { tabFrostOn } from "../preferences/tab-frost";
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
  const sessionId = () => typeof props.live?.sessionId === "string" ? props.live.sessionId : "";
  const crumb = () => <Show when={props.tabs} fallback={<HeaderCrumb place={props.dashboard || props.alone ? undefined : projectLabel()} onPlace={props.onOpenPlace ? () => props.onOpenPlace!(props.project) : undefined} title={props.title} />}>
    <nav aria-label="Tabs" class="chat-header-title chat-header-tabs">{props.tabs}</nav>
  </Show>;
  const moreLabel = () => props.dashboard ? `More ${placeKind()} options` : "More chat options";
  const shareLabel = () => props.dashboard ? `Copy Tailscale ${placeKind()} link` : "Copy Tailscale chat link";
  return <Header frost={!!props.tabs && tabFrostOn()}
    lead={<Show when={!props.mobileSidebarOpen}>
      <HeaderButton label="Toggle Sidebar" icon={<PanelLeftIcon />} aria-expanded={false} tabIndex={0} onClick={props.onToggleMobileSidebar} />
      <HeaderButton label="New chat" icon={<MessageSquarePlusIcon />} tabIndex={0} onClick={props.onNewChat} />
    </Show>}
    after={props.badge}
    actions={<>
      {/* On a desktop search and the palette are the right rail's; a phone's header keeps them, and the ⋯ that holds the rest. */}
      <HeaderButton only="phone" label="Search chats" icon={<SearchIcon />} onClick={props.onOpenSearch} />
      <HeaderButton only="phone" label="Open command palette" title="Command palette" icon={<TerminalIcon />} onClick={props.onOpenPalette} />
      <Show when={!props.appDashboard}>
        <HeaderButton only="desktop" label={shareLabel()} icon={<ShareIcon />} onClick={props.onShare} />
        <Menu modal={false}>
          <MenuControl as={HeaderButton} only="phone" label={moreLabel()} icon={<EllipsisIcon />} data-header-more="" />
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
        </Menu>
      </Show>
      {props.actions}
      {/* The pane's own swap and close, at its right edge: they act on the pane. */}
      {props.tabActions}
    </>}>{crumb()}</Header>;
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

