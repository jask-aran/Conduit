import * as Icons from "./icons";
import { Dot } from "./nav";
import { For, Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Row, type RowProps } from "./row";
import { feel, type HapticProp } from "./haptics";
import { callHandler } from "./shared";
import { Count } from "./controls";


/* Dashboard: a place's page. A head (mark, title, quick actions, status line); under it the composer and chats list
   left, what is live and what changed right, each scrolling on its own; oneColumn stacks head, notice, composer, first,
   list, rest. Sections are Groups of the sidebar's Rows at a page. Behaviour (one column, cursor, folding) is the app's. */
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
  head?: JSX.Element;
  /** QuickActions, at the title's right. */
  actions?: JSX.Element;
  notice?: JSX.Element;
  /** Across both columns under the head (a day strip): what reads better wide than in either column. */
  band?: JSX.Element;
  /** The composer in the left column, over the list; a phone docks it at the foot instead (dock). */
  composer?: JSX.Element;
  list?: JSX.Element;
  aside?: JSX.Element;
  /** After the body: a phone's composer at the foot. */
  dock?: JSX.Element;
}) {
  return <section ref={props.ref} class="ui-dash" data-compact={props.compact ? "" : undefined} data-one-column={props.oneColumn ? "" : undefined} data-stacked={props.stacked ? "" : undefined} data-headless={props.head || props.actions ? undefined : ""} data-room={props.room ? "" : undefined} data-page={props.page} aria-label={props.label}>
    <div class="ui-dash-body">
      {/* None for a room whose particulars are elsewhere (jbot's: its pill and the composer's chip). */}
      <Show when={props.head || props.actions}><header class="ui-dash-head">{props.head}{props.actions}</header></Show>
      <Show when={props.notice}><div class="ui-dash-notice">{props.notice}</div></Show>
      <Show when={props.band}><div class="ui-dash-band">{props.band}</div></Show>
      <div class="ui-dash-main">
        <Show when={props.composer}><div class="ui-dash-composer">{props.composer}</div></Show>
        {props.list}
      </div>
      <Show when={!props.room}><div class="ui-dash-aside">{props.aside}</div></Show>
    </div>
    {props.dock}
  </section>;
}

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

/** Plain words on the title's line; a phone draws them as a row of large targets with their icons. foldRow folds them
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
  return <h2 class="ui-group-heading" data-compact="">{props.label}<Show when={props.count != null}><Count value={props.count!} /></Show><Show when={props.where}><span>{props.where}</span></Show></h2>;
}
/** Switches in a heading's place (the chats list's All · Unread, Conduit · Computer): one line, never squeezed. */
export const GroupSwitches = (props: { children: JSX.Element }) => <div class="ui-group-switches">{props.children}</div>;


/** A group's quiet action at a heading's right (Open, New, Filters ⌄); a menu's trigger takes it with `as`. */
export function GroupAction(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { haptic?: HapticProp }) {
  const [local, rest] = splitProps(props, ["haptic", "onClick"]);
  return <button type="button" {...rest} class="ui-group-action" onClick={(event) => { feel(local.haptic, "press"); callHandler(local.onClick, event); }} />;
}
/** A day's name over its chats. */
export const DashDay = (props: { children: JSX.Element }) => <div class="ui-dash-day">{props.children}</div>;
/** The row after the last: "Show 20 more", quieter. */
export function DashMore(props: { count?: number | string; onClick: () => void; children: JSX.Element }) {
  return <button type="button" class="ui-dash-more" onClick={() => { feel(undefined, "fold"); props.onClick(); }}>{props.children}<Show when={props.count != null}><Count value={props.count!} /></Show></button>;
}
/** A line of prose in a group (a note, an error). */

/** A change's row, as the workspace panel draws it: file mark, name, folder, line counts, a status letter. */
export function ChangeRow(props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "class"> & { icon: JSX.Element; name: string; directory?: string; added?: number | null; removed?: number | null; status: string; statusTitle?: string; conflict?: boolean; selected?: boolean }) {
  const [local, rest] = splitProps(props, ["icon", "name", "directory", "added", "removed", "status", "statusTitle", "conflict", "selected"]);
  return <Row element="button" density="list" bare {...(rest as unknown as RowProps)} data-change-row="" selected={local.selected}>
    {local.icon}<span class="ui-change-name ui-truncate">{local.name}</span><span class="ui-change-directory ui-truncate">{local.directory}</span>
    <Show when={local.added != null} fallback={<span class="ui-counts" data-counts="list" aria-label="Counts unknown">—</span>}><LineCounts added={local.added ?? 0} removed={local.removed ?? 0} /></Show>
    <code class="ui-change-status" data-status={local.status} data-conflict={local.conflict ? "" : undefined} title={local.statusTitle}>{local.status}</code>
  </Row>;
}

/** LineCounts: lines removed, then added, in their change colours; the voice is where it sits (.ui-counts[data-counts]:
 *  list or bar). title: what the counts are (approximate, say). */
export function LineCounts(props: { kind?: "list" | "bar"; added: number | null; removed: number | null; title?: string }) {
  const bar = () => props.kind === "bar";
  return <span class="ui-counts" data-counts={bar() ? "bar" : "list"} title={props.title} aria-label={bar() ? undefined : `${props.added ?? 0} added, ${props.removed ?? 0} removed`}>
    <span data-change="removed">−{props.removed ?? 0}</span><span data-change="added">+{props.added ?? 0}</span>
  </span>;
}

/** Project folders as folders, no box; two rows until all. */
export const FolderShelf = (props: { ref?: (element: HTMLDivElement) => void; all?: boolean; children: JSX.Element }) =>
  <div ref={props.ref} class="ui-folder-shelf" data-all={props.all ? "" : undefined}>{props.children}</div>;
/** A folder on the shelf: mark (a dot when something runs), name and a line of data; a link, button or trigger (`as`).
 *  icon: an action's (New project); mark: a thing's own mark (a harness on the hub's page) in place of the folder. */
export function FolderTile(props: Omit<JSX.HTMLAttributes<HTMLElement>, "class" | "children"> & Partial<Pick<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href">> & { element?: "a" | "button"; name: string; meta?: string; live?: boolean; icon?: JSX.Element; mark?: JSX.Element; ref?: (element: HTMLElement) => void }) {
  const [local, rest] = splitProps(props, ["element", "name", "meta", "live", "icon", "mark"]);
  return <Dynamic component={local.element || (rest.href ? "a" : "button")} {...rest} class="ui-folder" data-new={local.icon ? "" : undefined}>
    <Show when={!local.mark} fallback={<span class="ui-folder-own" aria-hidden="true">{local.mark}</span>}><Show when={local.icon} fallback={<svg class="ui-folder-mark" viewBox="0 0 30 24" aria-hidden="true">
      <path data-part="back" d="M1 4a2 2 0 0 1 2-2h7l3 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" />
      <path data-part="front" d="M1 8h28v13a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" />
    </svg>}>{local.icon}</Show></Show>
    <Show when={local.live}><Dot tone="success" class="ui-folder-live" aria-label="Running" /></Show>
    <span class="ui-folder-name ui-truncate">{local.name}</span>
    <Show when={local.meta}><span class="ui-folder-meta ui-truncate">{local.meta}</span></Show>
  </Dynamic>;
}

/** DashPanel: a dashboard in a panel (jbot's): a fixed top (a band by its GaugeFigure, then what needs the person) over
 *  groups scrolling below, their gutter kept so nothing moves. */
export function DashPanel(props: { band: JSX.Element; figure?: JSX.Element; under?: JSX.Element; children: JSX.Element }) {
  return <div class="ui-dash-panel">
    <div class="ui-dash-panel-top">
      <div class="ui-dash-panel-glance"><div class="ui-dash-panel-day">{props.band}</div>{props.figure}</div>
      {props.under}
    </div>
    <div class="ui-dash-panel-body">{props.children}</div>
  </div>;
}

/** DashPeek: a row previewed in place in a DashPanel: Back and its way on (the file, the chat) over a Glance. */
export function DashPeek(props: { onBack: () => void; open?: { label: string; icon: JSX.Element; go: (event: MouseEvent) => void }; children: JSX.Element }) {
  return <div class="ui-dash-peek">
    <div class="ui-dash-peek-bar"><GroupAction onClick={() => props.onBack()}><Icons.ChevronLeft />Back</GroupAction>
      <Show when={props.open}>{(open) => <GroupAction onClick={(event: MouseEvent) => open().go(event)}>{open().icon}{open().label}</GroupAction>}</Show></div>
    {props.children}
  </div>;
}
