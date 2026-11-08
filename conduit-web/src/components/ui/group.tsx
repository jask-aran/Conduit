import * as Icons from "./icons";
import { Show, untrack, type JSX } from "solid-js";
import { Expand } from "./expand";
import { Count } from "./controls";

/**
 * Group: a titled run of rows or lines -- Settings' groups and columns, the sidebar's, a workbench's side sections, a
 * card's two sides, a page's groups on a dashboard, source control's staged and unstaged. The kind sets how its title
 * reads and what it holds (styles: the kind's family -- overlay.css, nav.css, workbench.css, card.css, agents.css,
 * dashboard.css, source.css -- under .ui-group[data-group]):
 *
 *   setting, column   the quiet label over lines (a column is one of several side by side, in Columns)
 *   nav               the sidebar's label, or none; away: what the rows are on is not there now ("Offline since …")
 *   workbench         a side section's title
 *   card, agent       a small heading over one side of a card, over a rider's list
 *   dash              a page's group: its heading (GroupHeading, GroupToggle) and actions over its rows, a row after
 *                     them (more); folded on a phone; order and section for the page's layout and the leader
 *   change            folds at its heading (GroupToggle) with a count, an action at the heading's right
 */
export type GroupKind = "setting" | "column" | "nav" | "workbench" | "card" | "agent" | "dash" | "change";
type Order = "first" | "list" | "rest";

export function Group(props: {
  kind?: GroupKind;
  /** What the group is called. A dash group's is its heading instead. */
  title?: JSX.Element;
  /** A dash group's heading (GroupHeading, GroupToggle, GroupCompactHeading, GroupSwitches). */
  heading?: JSX.Element;
  count?: number | string | null;
  /** Controls at the heading's right. */
  actions?: JSX.Element;
  /** After the rows (a dash group's "Show more"). */
  more?: JSX.Element;
  away?: string;
  /** A change group's: open shows its rows; onToggle folds it. */
  open?: boolean;
  onToggle?: () => void;
  /** A dash group's: folded hides its rows (a phone's); busy says its rows are loading. */
  folded?: boolean;
  busy?: boolean;
  order?: Order;
  /** What the leader calls a dash group (chats, projects, workspaces, terminals, changes, files, folders). */
  section?: string;
  /** A dash group's heading id when labelled; otherwise its name for assistive tech. */
  id?: string;
  labelled?: boolean;
  /** An agent group leaving (its rider folding it away). */
  going?: boolean;
  children?: JSX.Element;
}) {
  // A group's kind is what it is for its life: its markup is chosen once.
  const kind = untrack(() => props.kind ?? "setting");
  const name = () => (typeof props.title === "string" ? props.title : undefined);
  switch (kind) {
    case "nav": return <section class="ui-group" data-group="nav" data-away={props.away ? "" : undefined}>
      <Show when={props.title}><div class="ui-nav-label">{props.title}<Show when={props.away}><span class="ui-nav-away">{props.away}</span></Show></div></Show>
      {props.children}
    </section>;
    case "workbench": return <section class="ui-group" data-group="workbench"><h4 class="ui-title">{props.title}</h4>{props.children}</section>;
    case "card": case "agent": return <section class="ui-group" data-group={kind} data-going={props.going ? "" : undefined} aria-label={name()}><h4>{props.title}</h4>{props.children}</section>;
    case "dash": return <section class="ui-group" data-group="dash" data-folded={props.folded ? "" : undefined} data-section={props.section} data-order={props.order ?? "rest"}
      aria-labelledby={props.labelled ? props.id : undefined} aria-label={props.labelled ? undefined : props.id} aria-busy={props.busy || undefined}>
      <header class="ui-group-head">{props.heading}<Show when={props.actions}><div class="ui-group-actions">{props.actions}</div></Show></header>
      <div class="ui-group-body" hidden={props.folded}>{props.children}{props.more}</div>
    </section>;
    case "change": return <section class="ui-group" data-group="change" data-open={props.open ? "" : undefined}>
      <header class="ui-group-head"><GroupToggle open={Boolean(props.open)} count={props.count} onClick={() => props.onToggle?.()}>{props.title}</GroupToggle>{props.actions}</header>
      <Expand open={Boolean(props.open)}>{props.children}</Expand>
    </section>;
    default: return <section class="ui-group" data-group={kind} aria-label={name()}><div class="ui-nav-label">{props.title}</div>{props.children}</section>;
  }
}

/** Groups side by side, as many as the room holds, a hairline between: Settings' columns, a card's two sides, the file
 *  browser's panes. The kind is the family whose spacing it takes. */
export const Columns = (props: { kind?: "setting" | "card" | "browser"; children: JSX.Element }) =>
  <div class="ui-columns" data-group={props.kind ?? "setting"}>{props.children}</div>;

/** A dash group's heading: the strong one, sentence case, with a count in data. The quiet label is the other kinds'. */
export function GroupHeading(props: { id?: string; count?: number | string | null; children: JSX.Element }) {
  return <h2 id={props.id} class="ui-group-heading">{props.children}<Show when={props.count != null}><Count value={props.count!} /></Show></h2>;
}
/** A heading that folds its group: the chevron turns as it opens. */
export function GroupToggle(props: { id?: string; open: boolean; count?: number | string | null; onClick: () => void; children: JSX.Element }) {
  return <h2 id={props.id} class="ui-group-heading"><button type="button" class="ui-group-toggle" aria-expanded={props.open} onClick={() => props.onClick()}>
    <Icons.ChevronRight class="ui-fold-chevron" />{props.children}<Show when={props.count != null}><Count value={props.count!} /></Show></button></h2>;
}
