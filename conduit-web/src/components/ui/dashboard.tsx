import * as Icons from "./icons";
import { For, Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";


/*
 * Dashboard: a place's page. A head across the top (its mark, title, quick actions and status line); under it the
 * composer with the chats list on the left and what is live and what changed on the right, each scrolling on its own.
 * One column (oneColumn) stacks them in order: head, notice, composer, first, list, rest. The sections are Groups:
 * a GroupHeading (or switches) with actions at its right, then plain one-line DashRows -- the sidebar's rows at a page.
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
  ref?: (element: HTMLElement) => void;
  /** A DashHeader. */
  head: JSX.Element;
  /** QuickActions, at the title's right. */
  actions?: JSX.Element;
  notice?: JSX.Element;
  /** The composer in the left column, over the list; a phone docks it at the foot instead (dock). */
  composer?: JSX.Element;
  list?: JSX.Element;
  aside?: JSX.Element;
  /** After the body: a phone's composer at the foot. */
  dock?: JSX.Element;
}) {
  return <section ref={props.ref} class="ui-dash" data-compact={props.compact ? "" : undefined} data-one-column={props.oneColumn ? "" : undefined} data-page={props.page} aria-label={props.label}>
    <div class="ui-dash-body">
      <header class="ui-dash-head">{props.head}{props.actions}</header>
      <Show when={props.notice}><div class="ui-dash-notice">{props.notice}</div></Show>
      <div class="ui-dash-main">
        <Show when={props.composer}><div class="ui-dash-composer">{props.composer}</div></Show>
        {props.list}
      </div>
      <div class="ui-dash-aside">{props.aside}</div>
    </div>
    {props.dock}
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
export function DashIconButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["children"]);
  return <button type="button" {...rest} class="ui-dash-icon">{local.children ?? <Icons.More />}</button>;
}

/** A section's name, the strong one: Geist at the strong weight, sentence case, an optional count in data. The quiet
 *  section label (menus, Settings, the sidebar) is the other role. */
export function GroupHeading(props: { id?: string; count?: number | string | null; children: JSX.Element }) {
  return <h2 id={props.id} class="ui-group-heading">{props.children}<Show when={props.count != null}><small>{props.count}</small></Show></h2>;
}
/** A heading that folds its group: the chevron turns as it opens. */
export function GroupToggle(props: { id?: string; open: boolean; count?: number | string | null; onClick: () => void; children: JSX.Element }) {
  return <h2 id={props.id} class="ui-group-heading"><button type="button" class="ui-group-toggle" aria-expanded={props.open} onClick={() => props.onClick()}>
    <Icons.ChevronRight />{props.children}<Show when={props.count != null}><small>{props.count}</small></Show></button></h2>;
}
/** The chats list's heading on a phone: the choice it shows, its count, and where. */
export function GroupCompactHeading(props: { label: JSX.Element; count?: number | string | null; where?: JSX.Element }) {
  return <h2 class="ui-group-heading" data-compact="">{props.label}<Show when={props.count != null}><small>{props.count}</small></Show><Show when={props.where}><span>{props.where}</span></Show></h2>;
}
/** Switches in a heading's place (the chats list's All · Unread, Conduit · Computer): one line, never squeezed. */
export const GroupSwitches = (props: { children: JSX.Element }) => <div class="ui-group-switches">{props.children}</div>;

export function Group(props: {
  /** The heading's id when it has one; otherwise the group's name for assistive tech. */
  id: string;
  labelled?: boolean;
  /** What the leader calls it (chats, projects, workspaces, terminals, changes, files, folders). */
  section?: string;
  order?: Order;
  folded?: boolean;
  busy?: boolean;
  heading: JSX.Element;
  actions?: JSX.Element;
  children: JSX.Element;
  more?: JSX.Element;
}) {
  return <section class="ui-dash-group" data-folded={props.folded ? "" : undefined} data-section={props.section} data-order={props.order ?? "rest"}
    aria-labelledby={props.labelled ? props.id : undefined} aria-label={props.labelled ? undefined : props.id} aria-busy={props.busy || undefined}>
    <header class="ui-dash-group-head">{props.heading}<Show when={props.actions}><div class="ui-dash-group-actions">{props.actions}</div></Show></header>
    <div class="ui-dash-group-rows" hidden={props.folded}>{props.children}{props.more}</div>
  </section>;
}

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
export const DashEmpty = (props: { children: JSX.Element }) => <div class="ui-dash-empty">{props.children}</div>;
/** A line of prose in a group (a note, an error). */
export const DashNote = (props: { error?: boolean; children: JSX.Element }) => <p class="ui-dash-note" role={props.error ? "alert" : undefined} data-error={props.error ? "" : undefined}>{props.children}</p>;

type RowProps = {
  lead?: JSX.Element;
  primary: JSX.Element;
  context?: JSX.Element;
  trailing?: JSX.Element;
  element?: "div" | "button" | "a";
  /** Where you are (a harness's folder that is the current one). */
  current?: boolean;
}
  & Omit<JSX.HTMLAttributes<HTMLElement>, "children" | "ref" | "class">
  & { ref?: (element: HTMLElement) => void }
  & Partial<Pick<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel">>
  & Partial<Pick<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "disabled">>;

/** A row: a mark, the title, muted context after it, data at the end. A button or a link when it opens something. */
export function DashRow(props: RowProps) {
  const [local, rest] = splitProps(props, ["element", "lead", "primary", "context", "trailing", "current"]);
  return <Dynamic component={local.element || "div"} {...rest} class="ui-dash-row" data-current={local.current ? "" : undefined}>
    <span class="ui-dash-row-lead">{local.lead}</span>
    <span class="ui-dash-row-primary">{local.primary}</span>
    <span class="ui-dash-row-context">{local.context}</span>
    <Show when={local.trailing}><span class="ui-dash-row-trailing">{local.trailing}</span></Show>
  </Dynamic>;
}

/** A change's row, as the workspace panel draws it: file mark, name, folder, line counts, a status letter. */
export function ChangeRow(props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children" | "class"> & { icon: JSX.Element; name: string; directory?: string; added?: number | null; removed?: number | null; status: string; statusTitle?: string; conflict?: boolean; selected?: boolean }) {
  const [local, rest] = splitProps(props, ["icon", "name", "directory", "added", "removed", "status", "statusTitle", "conflict", "selected"]);
  return <button type="button" {...rest} class="ui-dash-row" data-change-row="" data-selected={local.selected ? "" : undefined}>
    {local.icon}<span class="ui-change-name">{local.name}</span><span class="ui-change-directory">{local.directory}</span>
    <Show when={local.added != null} fallback={<span class="ui-counts" aria-label="Counts unknown">—</span>}><Counts added={local.added ?? 0} removed={local.removed ?? 0} /></Show>
    <code class="ui-change-status" data-status={local.status} data-conflict={local.conflict ? "" : undefined} title={local.statusTitle}>{local.status}</code>
  </button>;
}

/** Line counts: removed, then added. */
export function Counts(props: { added: number | null; removed: number | null }) {
  return <span class="ui-counts" aria-label={`${props.added ?? 0} added, ${props.removed ?? 0} removed`}>
    <span data-change="removed">−{props.removed ?? 0}</span><span data-change="added">+{props.added ?? 0}</span>
  </span>;
}

/** Project folders as folders, no box; two rows until all. */
export const FolderShelf = (props: { ref?: (element: HTMLDivElement) => void; all?: boolean; children: JSX.Element }) =>
  <div ref={props.ref} class="ui-folder-shelf" data-all={props.all ? "" : undefined}>{props.children}</div>;
/** A folder on the shelf: its mark (a dot when something runs in it), name and a line of data. A link, a button, or a menu's trigger with `as`. */
export function FolderTile(props: Omit<JSX.HTMLAttributes<HTMLElement>, "class" | "children"> & Partial<Pick<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href">> & { element?: "a" | "button"; name: string; meta?: string; live?: boolean; icon?: JSX.Element; ref?: (element: HTMLElement) => void }) {
  const [local, rest] = splitProps(props, ["element", "name", "meta", "live", "icon"]);
  return <Dynamic component={local.element || (rest.href ? "a" : "button")} {...rest} class="ui-folder" data-new={local.icon ? "" : undefined}>
    <Show when={local.icon} fallback={<svg class="ui-folder-mark" viewBox="0 0 30 24" aria-hidden="true">
      <path data-part="back" d="M1 4a2 2 0 0 1 2-2h7l3 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" />
      <path data-part="front" d="M1 8h28v13a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2z" />
    </svg>}>{local.icon}</Show>
    <Show when={local.live}><span class="ui-folder-live" aria-label="Running" /></Show>
    <span class="ui-folder-name">{local.name}</span>
    <Show when={local.meta}><span class="ui-folder-meta">{local.meta}</span></Show>
  </Dynamic>;
}
