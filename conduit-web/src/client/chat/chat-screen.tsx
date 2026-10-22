import { ChatView, ComposerDock } from "@/components/ui";
import { HarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { createSignal, For, Show, type JSX } from "solid-js";

import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/menus";
import { PaneTabRow } from "@/components/ui/pane";
import { Expand, Header, HeaderButton, HeaderCrumb, HeaderPill, Readout, Rule } from "@/components/ui";
import type { Project, RuntimeIdentity, Template } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import { ContextBar, ContextBreakdown } from "./context-gauge";
import { contextUsagePercent } from "./context-metrics";
import { isWorkspace } from "./place-picker";
import { harnessLabelFor } from "../harness-brand";
import { WorkspaceGlyph } from "../project/workspace-appearance";
import { isMobileLayout } from "../navigation/mobile-layout";
import { tabFrostOn } from "../preferences/tab-frost";
/*
 * A chat's screen: its header, and its transcript with the composer over it.
 * Out of main.tsx so the gallery draws the same ones.
 */

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
  const runtimeLabel = () => props.runtime ? harnessLabelFor(props.chat?.backendImplementation() || "conduit-runtime") : null;
  const profileLabel = () => props.profile?.label || props.profile?.id;
  const posture = () => props.profile?.posture || props.profile?.tools?.join(" / ");
  const sessionId = () => typeof props.live?.sessionId === "string" ? props.live.sessionId : "";
  const crumb = () => <Show when={props.tabs} fallback={<HeaderCrumb place={props.dashboard || props.alone ? undefined : projectLabel()} onPlace={props.onOpenPlace ? () => props.onOpenPlace!(props.project) : undefined} title={props.title} />}>
    <PaneTabRow>{props.tabs}</PaneTabRow>
  </Show>;
  const moreLabel = () => props.dashboard ? `More ${placeKind()} options` : "More chat options";
  const shareLabel = () => props.dashboard ? `Copy Tailscale ${placeKind()} link` : "Copy Tailscale chat link";
  // What the chat is running on, for its menu's Details: each a line of its own.
  const details = () => ([["Harness", runtimeLabel()], ["Version", props.live?.binaryVersion || props.runtime?.binaryVersion ? `v${props.live?.binaryVersion || props.runtime?.binaryVersion}` : null],
    ["Profile", profileLabel()], ["Tools", posture()], ["Session", sessionId()]] as [string, string | null | undefined][]).filter((line): line is [string, string] => Boolean(line[1]));
  const [detailsOpen, setDetailsOpen] = createSignal(false);
  // The pill's mark for where the page sits: a workspace's glyph, a folder, or Conduit's for a chat in no folder.
  const placeMark = () => props.alone || props.placeLabel ? undefined
    : !props.project || props.project.slug === "chat" ? <HarnessMark id="conduit" />
    : isWorkspace(props.project) ? <WorkspaceGlyph appearance={props.project.workspaceAppearance} /> : <Icons.Folder />;
  return <Header frost={!!props.tabs && tabFrostOn()}
    lead={<Show when={!props.mobileSidebarOpen}>
      <HeaderButton label="Toggle Sidebar" icon={<Icons.Sidebar />} aria-expanded={false} tabIndex={0} onClick={props.onToggleMobileSidebar} />
      <HeaderButton label="New chat" icon={<Icons.NewChat />} tabIndex={0} onClick={props.onNewChat} />
    </Show>}
    // A phone's name for the page, and the way into its menu (a desktop's title and rail hold what it holds).
    pill={<Show when={!props.appDashboard} fallback={<HeaderPill label={props.title} icon={<HarnessMark id="conduit" />} />}>
      {/* Opening, the context is read afresh, so Context shows its reading before it is unfolded. */}
      <DropdownMenu modal={false} placement="bottom" onOpenChange={(open) => { if (open) props.chat?.refreshContext(); else setDetailsOpen(false); }}>
        <MenuControl as={HeaderPill} opens label={props.title} icon={placeMark()} aria-label={`${moreLabel()}: ${props.title}`} data-header-more="" />
        <MenuContent width="md" unfolds>
          <MenuSection>
            <MenuRow icon={<Icons.Share />} onSelect={props.onShare}>Share</MenuRow>
            <Show when={props.onRename}>
              <MenuRow icon={<Icons.Edit />} onSelect={() => props.onRename?.()}>{props.dashboard ? `Rename ${placeKind()}` : "Rename"}</MenuRow>
            </Show>
            <Show when={isMobileLayout()}><MenuRow icon={<Icons.Workspace />} onSelect={props.onTogglePanel}>Workspace panel</MenuRow></Show>
            <Show when={props.onDelete}>
              <MenuRow destructive icon={<Icons.Delete />} onSelect={() => props.onDelete?.()}>{props.dashboard ? (placeKind() === "workspace" ? "Unlink workspace" : "Delete project") : "Delete chat"}</MenuRow>
            </Show>
          </MenuSection>
          <Show when={!props.dashboard && props.chat}>{(chat) => {
            // Each opens in place, its section growing (Expand): a submenu has nowhere to go beside a menu that fills a phone.
            const [expanded, setExpanded] = createSignal(false);
            const used = () => contextUsagePercent(chat().contextUsage());
            return <>
              <Rule />
              <MenuSection>
                <MenuRow field closeOnSelect={false} aria-expanded={expanded()} opens meta={used() == null ? "Unavailable" : `${Math.round(used()!)}% used`}
                  onSelect={() => setExpanded(!expanded())}>Context</MenuRow>
                <ContextBar chat={chat()} />
                <Expand open={expanded()}><ContextBreakdown chat={chat()} bare canCompact={chat().capabilities()?.compaction !== false} /></Expand>
              </MenuSection>
              {/* The thread's own particulars, a section of their own: shut, the harness; open, each on a line. */}
              <Show when={details().length}>
                <MenuSection>
                  <MenuRow field closeOnSelect={false} aria-expanded={detailsOpen()} opens meta={runtimeLabel() ?? undefined} onSelect={() => setDetailsOpen(!detailsOpen())}>Details</MenuRow>
                  <Expand open={detailsOpen()}><For each={details()}>{([label, value]) => <Readout label={label} value={value} />}</For></Expand>
                </MenuSection>
              </Show>
            </>;
          }}</Show>
        </MenuContent>
      </DropdownMenu>
    </Show>}
    after={props.badge}
    actions={<>
      {/* On a desktop search and the palette are the right rail's; a phone's header keeps them. */}
      <HeaderButton only="phone" label="Search chats" icon={<Icons.Search />} onClick={props.onOpenSearch} />
      <HeaderButton only="phone" label="Open command palette" title="Command palette" icon={<Icons.Terminal />} onClick={props.onOpenPalette} />
      <Show when={!props.appDashboard}>
        <HeaderButton only="desktop" label={shareLabel()} icon={<Icons.Share />} onClick={props.onShare} />
      </Show>
      {props.actions}
      {/* The pane's own swap and close, at its right edge: they act on the pane. */}
      {props.tabActions}
    </>}>{crumb()}</Header>;
}

/** A chat's transcript with its composer over it: a Conduit chat's and an
 *  untracked harness thread's alike. */
export function Conversation(props: { chat: ActiveChatStore; busy?: boolean; empty?: boolean; sending?: boolean; opening?: boolean; transcript: JSX.Element; composer: JSX.Element; stackRef?: (element: HTMLDivElement) => void }) {
  return <ChatView aria-busy={props.busy} empty={props.empty} sending={props.sending} opening={props.opening}>
    {props.transcript}
    <ComposerDock ref={(element) => props.stackRef?.(element)}>{props.composer}</ComposerDock>
  </ChatView>;
}

