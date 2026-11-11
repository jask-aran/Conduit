import * as Icons from "./icons";
import { Show, untrack, type JSX } from "solid-js";
import { Expand } from "./expand";
import { Count } from "./controls";

export type GroupKind = "setting" | "column" | "nav" | "workbench" | "card" | "agent" | "dash" | "change";
type Order = "first" | "list" | "rest";

export function Group(props: {
  kind?: GroupKind;
  title?: JSX.Element;
  heading?: JSX.Element;
  count?: number | string | null;
  actions?: JSX.Element;
  more?: JSX.Element;
  away?: string;
  scope?: string;
  open?: boolean;
  onToggle?: () => void;
  folded?: boolean;
  busy?: boolean;
  order?: Order;
  section?: string;
  id?: string;
  labelled?: boolean;
  going?: boolean;
  children?: JSX.Element;
}) {
  // A group's kind is fixed for its life: its markup is chosen once.
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
    default: return <section class="ui-group" data-group={kind} aria-label={name()}><Show when={kind !== "column" || props.title}><div class="ui-nav-label">{props.title}<Show when={props.scope}><span class="ui-nav-away">{props.scope}</span></Show></div></Show>{props.children}</section>;
  }
}

export const Columns = (props: { kind?: "setting" | "card" | "browser"; children: JSX.Element }) =>
  <div class="ui-columns" data-group={props.kind ?? "setting"}>{props.children}</div>;

export function GroupHeading(props: { id?: string; count?: number | string | null; children: JSX.Element }) {
  return <h2 id={props.id} class="ui-group-heading">{props.children}<Show when={props.count != null}><Count value={props.count!} /></Show></h2>;
}
export function GroupToggle(props: { id?: string; open: boolean; count?: number | string | null; onClick: () => void; children: JSX.Element }) {
  return <h2 id={props.id} class="ui-group-heading"><button type="button" class="ui-group-toggle" aria-expanded={props.open} onClick={() => props.onClick()}>
    <Icons.ChevronRight class="ui-fold-chevron" />{props.children}<Show when={props.count != null}><Count value={props.count!} /></Show></button></h2>;
}
