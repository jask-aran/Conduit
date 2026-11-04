import * as Icons from "./icons";
import { For, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Row, type RowProps } from "./row";
import { clearDock } from "./dock-inset";


/*
 * Dashboard: a place's page. A head across the top (its mark, title, quick actions and status line); under it the
 * composer with the chats list on the left and what is live and what changed on the right, each scrolling on its own.
 * One column (oneColumn) stacks them in order: head, notice, composer, first, list, rest. The sections are Groups:
 * a GroupHeading (or switches) with actions at its right, then plain one-line Rows (list) -- the sidebar's rows at a page.
 * Behaviour (when to go to one column, the cursor, folding) is the app's: these draw.
 */
type Order = "first" | "list" | "rest";

export function Dashboard(props: {
  label: string;
  /** What the page is (Dashboard, Project, Workspace, Harness), for the leader. */
  page?: string;
  /** A phone, or a pane too narrow for two columns. */
  compact?: boolean;
  oneColumn?: boolean;
  /** The left column holds several groups at their own size, scrolling together, instead of one list filling it. */
  stacked?: boolean;
  /** A room: the conversation and its composer alone, one column at reading width, the conversation filling the height. */
  room?: boolean;
  ref?: (element: HTMLElement) => void;
  /** A DashHeader. */
  head: JSX.Element;
  /** QuickActions, at the title's right. */
  actions?: JSX.Element;
  notice?: JSX.Element;
  /** Across both columns under the head (a day strip): what reads better wide than in either column. */
  band?: JSX.Element;
  /** A conversation over the composer (DashConversation): its latest messages, the page's own thread. */
  conversation?: JSX.Element;
  /** The composer in the left column, over the list; a phone docks it at the foot instead (dock). */
  composer?: JSX.Element;
  list?: JSX.Element;
  aside?: JSX.Element;
  /** After the body: a phone's composer at the foot. */
  dock?: JSX.Element;
}) {
  return <section ref={props.ref} class="ui-dash" data-compact={props.compact ? "" : undefined} data-one-column={props.oneColumn ? "" : undefined} data-stacked={props.stacked ? "" : undefined} data-room={props.room ? "" : undefined} data-page={props.page} aria-label={props.label}>
    <div class="ui-dash-body">
      <header class="ui-dash-head">{props.head}{props.actions}</header>
      <Show when={props.notice}><div class="ui-dash-notice">{props.notice}</div></Show>
      <Show when={props.band}><div class="ui-dash-band">{props.band}</div></Show>
      <div class="ui-dash-main">
        {props.conversation}
        <Show when={props.composer}><div class="ui-dash-composer">{props.composer}</div></Show>
        {props.list}
      </div>
      <Show when={!props.room}><div class="ui-dash-aside">{props.aside}</div></Show>
    </div>
    {props.dock}
  </section>;
}

/**
 * DashConversation: a page's own thread in an inset over its composer, held at the newest while you are there; open:
 * the whole thread, at its foot. children: its messages, scrolled here; or (scrolls) a transcript that scrolls itself.
 */
export function DashConversation(props: { label: string; open?: { label: string; onOpen: () => void }; scrolls?: boolean; children: JSX.Element }) {
  let scroller!: HTMLDivElement;
  let pinned = true;
  onMount(() => {
    if (props.scrolls) return;
    const follow = () => { if (pinned) scroller.scrollTop = scroller.scrollHeight; };
    const sizes = new ResizeObserver(follow);
    const watch = () => { sizes.disconnect(); sizes.observe(scroller); for (const child of scroller.children) sizes.observe(child); follow(); };
    const tree = new MutationObserver(watch);
    tree.observe(scroller, { childList: true, subtree: true, characterData: true });
    watch();
    // A room's messages scroll under its composer's dock as a thread's do, and reserve its measured height the same
    // way (dock-inset.ts); the dock may arrive after the messages, so it is looked for until it does.
    // Looked for a frame on, once the messages are in the page (at mount they may not be yet).
    let stopClearing: (() => void) | null = null;
    let room: HTMLElement | null = null;
    const findDock = () => {
      const dock = stopClearing ? null : room?.querySelector<HTMLElement>(".ui-composer-dock");
      if (dock) { stopClearing = clearDock(scroller, dock, follow); docks.disconnect(); }
    };
    const docks = new MutationObserver(findDock);
    const frame = requestAnimationFrame(() => {
      room = scroller.closest<HTMLElement>(".ui-dash[data-room]");
      if (room) { docks.observe(room, { childList: true, subtree: true }); findDock(); }
    });
    onCleanup(() => { cancelAnimationFrame(frame); sizes.disconnect(); tree.disconnect(); docks.disconnect(); stopClearing?.(); });
  });
  return <section class="ui-dash-conversation" aria-label={props.label}>
    <div ref={scroller} class="ui-dash-conversation-scroll" data-scrolls={props.scrolls ? "" : undefined} role={props.scrolls ? undefined : "log"} onScroll={() => { pinned = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 8; }}>{props.children}</div>
    <Show when={props.open}>{(open) => <button type="button" class="ui-dash-conversation-open" onClick={() => open().onOpen()}>{open().label}<Icons.ChevronRight /></button>}</Show>
  </section>;
}

/** The page's head, in a Dashboard's head: its mark centred on the title and the status line under it. */
/** DashPath: a place's working path in its header's context, copied on a tap; it says Copied for a moment. */
export const DashPath = (props: { path?: string; copied?: boolean; onCopy: () => void }) =>
  <button type="button" class="ui-dash-path" title="Copy working path" onClick={() => props.onCopy()}><code>{props.copied ? "Copied" : props.path || "Working path unavailable"}</code></button>;

export function DashHeader(props: { title: string; glyph?: JSX.Element; context?: Array<JSX.Element | false | null | undefined> }) {
  const items = () => (props.context ?? []).filter(Boolean);
  return <>
    <Show when={props.glyph}><span class="ui-dash-glyph">{props.glyph}</span></Show>
    <h1 class="ui-dash-title">{props.title}</h1>
    <Show when={items().length}><p class="ui-dash-context"><For each={items()}>{(item) => <span>{item}</span>}</For></p></Show>
  </>;
}

/** Plain words on the title's line; a phone draws them as a row of large targets with their icons. The app folds them
 *  (data-fold, data-folded) into the ⋯ (QuickMore). */
export const QuickActions = (props: { children: JSX.Element }) => <nav class="ui-dash-quick" aria-label="Quick actions">{props.children}</nav>;
export function QuickAction(props: { icon: JSX.Element; label: string; folded?: boolean; onClick: () => void }) {
  return <button type="button" class="ui-dash-quick-action" tabIndex={-1} data-fold data-folded={props.folded ? "" : undefined} onClick={() => props.onClick()}>{props.icon}<span>{props.label}</span></button>;
}
/** The ⋯'s place at the end of the quick actions; keep: it is there whether or not anything folded (the page's manage items). */
export function QuickMore(props: { ref?: (element: HTMLSpanElement) => void; keep?: boolean; hidden?: boolean; children: JSX.Element }) {
  return <span ref={props.ref} class="ui-dash-quick-more" data-fold-more data-fold-keep={props.keep ? "" : undefined} data-folded={props.hidden ? "" : undefined}>{props.children}</span>;
}
/** A small icon button in a dashboard's line (the ⋯): a menu's trigger takes it with `as`. */

/** The chats list's heading on a phone: the choice it shows, its count, and where. */
export function GroupCompactHeading(props: { label: JSX.Element; count?: number | string | null; where?: JSX.Element }) {
  return <h2 class="ui-group-heading" data-compact="">{props.label}<Show when={props.count != null}><small>{props.count}</small></Show><Show when={props.where}><span>{props.where}</span></Show></h2>;
}
/** Switches in a heading's place (the chats list's All · Unread, Conduit · Computer): one line, never squeezed. */
export const GroupSwitches = (props: { children: JSX.Element }) => <div class="ui-group-switches">{props.children}</div>;


/** A text action at a heading's right (Open, New, Filters ⌄); a menu's trigger takes it with `as`. */
export function GroupAction(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" {...props} class="ui-group-action" />;
}
/** A day's name over its chats. */
export const DashDay = (props: { children: JSX.Element }) => <div class="ui-dash-day">{props.children}</div>;
/** The row after the last: "Show 20 more", quieter. */
export function DashMore(props: { count?: number | string; onClick: () => void; children: JSX.Element }) {
  return <button type="button" class="ui-dash-more" onClick={() => props.onClick()}>{props.children}<Show when={props.count != null}><small>{props.count}</small></Show></button>;
}
/** A line of prose in a group (a note, an error). */

/** A change's row, as the workspace panel draws it: file mark, name, folder, line counts, a status letter. */
export function ChangeRow(props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "class"> & { icon: JSX.Element; name: string; directory?: string; added?: number | null; removed?: number | null; status: string; statusTitle?: string; conflict?: boolean; selected?: boolean }) {
  const [local, rest] = splitProps(props, ["icon", "name", "directory", "added", "removed", "status", "statusTitle", "conflict", "selected"]);
  return <Row element="button" density="list" bare {...(rest as unknown as RowProps)} data-change-row="" selected={local.selected}>
    {local.icon}<span class="ui-change-name">{local.name}</span><span class="ui-change-directory">{local.directory}</span>
    <Show when={local.added != null} fallback={<span class="ui-counts" data-counts="list" aria-label="Counts unknown">—</span>}><LineCounts added={local.added ?? 0} removed={local.removed ?? 0} /></Show>
    <code class="ui-change-status" data-status={local.status} data-conflict={local.conflict ? "" : undefined} title={local.statusTitle}>{local.status}</code>
  </Row>;
}

/**
 * LineCounts: lines removed, then added, each in its change colour. The kind is where it sits (under
 * .ui-counts[data-counts]): list (a change row's, a group's heading: data's voice, light, said whole to assistive tech),
 * bar (a comparison's status bar: the bar's voice). title: what the counts are (approximate, say).
 */
export function LineCounts(props: { kind?: "list" | "bar"; added: number | null; removed: number | null; title?: string }) {
  const bar = () => props.kind === "bar";
  return <span class="ui-counts" data-counts={bar() ? "bar" : "list"} title={props.title} aria-label={bar() ? undefined : `${props.added ?? 0} added, ${props.removed ?? 0} removed`}>
    <span data-change="removed">−{props.removed ?? 0}</span><span data-change="added">+{props.added ?? 0}</span>
  </span>;
}

/** Project folders as folders, no box; two rows until all. */
export const FolderShelf = (props: { ref?: (element: HTMLDivElement) => void; all?: boolean; children: JSX.Element }) =>
  <div ref={props.ref} class="ui-folder-shelf" data-all={props.all ? "" : undefined}>{props.children}</div>;
/**
 * A folder on the shelf: its mark (a dot when something runs in it), name and a line of data. A link, a button, or a
 * menu's trigger with `as`. `icon`: an action's (New project), quiet; `mark`: a thing's own mark in its colours (a
 * harness on the hub's page), in place of the folder.
 */
export function FolderTile(props: Omit<JSX.HTMLAttributes<HTMLElement>, "class" | "children"> & Partial<Pick<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href">> & { element?: "a" | "button"; name: string; meta?: string; live?: boolean; icon?: JSX.Element; mark?: JSX.Element; ref?: (element: HTMLElement) => void }) {
  const [local, rest] = splitProps(props, ["element", "name", "meta", "live", "icon", "mark"]);
  return <Dynamic component={local.element || (rest.href ? "a" : "button")} {...rest} class="ui-folder" data-new={local.icon ? "" : undefined}>
    <Show when={!local.mark} fallback={<span class="ui-folder-own" aria-hidden="true">{local.mark}</span>}><Show when={local.icon} fallback={<svg class="ui-folder-mark" viewBox="0 0 30 24" aria-hidden="true">
      <path data-part="back" d="M1 4a2 2 0 0 1 2-2h7l3 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" />
      <path data-part="front" d="M1 8h28v13a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" />
    </svg>}>{local.icon}</Show></Show>
    <Show when={local.live}><span class="ui-folder-live" aria-label="Running" /></Show>
    <span class="ui-folder-name">{local.name}</span>
    <Show when={local.meta}><span class="ui-folder-meta">{local.meta}</span></Show>
  </Dynamic>;
}
