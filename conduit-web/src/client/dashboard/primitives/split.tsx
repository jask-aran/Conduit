import { For, Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import "./split.css";

// The project and workspace dashboards: a header across the top, then the
// composer with the threads list under it on the left and what is live and
// what changed on the right. The pane's width, not the window's, decides
// when the two columns become one, so opening the workspace panel reflows it
// the way a narrow window does. The Conduit dashboard still uses ./dashboard.

const classes = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

export function SplitDashboard(props: {
  label: string;
  class?: string;
  header: JSX.Element;
  shortcuts?: JSX.Element;
  notice?: JSX.Element;
  composer?: JSX.Element;
  list?: JSX.Element;
  aside?: JSX.Element;
}) {
  return <section class={classes("split-dashboard", props.class)} aria-label={props.label}>
    <div class="split-dashboard-body">
      <div class="split-dashboard-head">{props.header}{props.shortcuts}</div>
      <Show when={props.notice}><div class="split-dashboard-notice">{props.notice}</div></Show>
      <div class="split-dashboard-main">
        <Show when={props.composer}><div class="split-dashboard-composer">{props.composer}</div></Show>
        {props.list}
      </div>
      <div class="split-dashboard-aside">{props.aside}</div>
    </div>
  </section>;
}

/** Name, kind and one muted line of context, written as words. */
export function SplitHeader(props: {
  title: string;
  kind?: string;
  glyph?: JSX.Element;
  context?: Array<JSX.Element | false | null | undefined>;
}) {
  return <header class="split-header">
    <Show when={props.glyph}><span class="split-header-glyph">{props.glyph}</span></Show>
    <div class="split-header-copy">
      <h1><span>{props.title}</span><Show when={props.kind}><span class="split-header-kind">{props.kind}</span></Show></h1>
      <Show when={props.context?.some(Boolean)}>
        <p class="split-header-context"><For each={props.context!.filter(Boolean)}>{(item) => <span>{item}</span>}</For></p>
      </Show>
    </div>
  </header>;
}

/** Plain words at the header's right; a row of large targets on a phone. */
export function SplitShortcuts(props: { children: JSX.Element }) {
  return <nav class="split-shortcuts" aria-label="Shortcuts">{props.children}</nav>;
}

export function SplitShortcut(props: { icon: JSX.Element; label: string; onClick: () => void; title?: string }) {
  return <button type="button" title={props.title} onClick={props.onClick}>{props.icon}<span>{props.label}</span></button>;
}

/**
 * A heading and plain one-line rows, drawn as the sidebar draws its groups.
 * `order` places it on one column: Running comes first, then the threads
 * list, then the rest.
 */
export function SplitGroup(props: {
  id: string;
  label?: string;
  count?: number | null;
  heading?: JSX.Element;
  actions?: JSX.Element;
  children: JSX.Element;
  more?: JSX.Element;
  order?: "first" | "list" | "rest";
  class?: string;
  busy?: boolean;
}) {
  return <section class={classes("split-group", props.class)} data-order={props.order || "rest"} aria-labelledby={props.label ? props.id : undefined} aria-label={props.label ? undefined : props.id} aria-busy={props.busy || undefined}>
    <header class="split-group-heading">
      {props.heading ?? <h2 id={props.id}>{props.label}<Show when={props.count != null}><small>{props.count}</small></Show></h2>}
      <Show when={props.actions}><div class="split-group-actions">{props.actions}</div></Show>
    </header>
    <div class="split-group-rows">{props.children}{props.more}</div>
  </section>;
}

export function SplitGroupMore(props: { children: JSX.Element; onClick: () => void }) {
  return <button type="button" class="split-group-more" onClick={props.onClick}>{props.children}</button>;
}

export function SplitEmpty(props: { children: JSX.Element }) {
  return <div class="split-group-empty">{props.children}</div>;
}

// One flat props type, as DashboardRow has, so Kobalte's polymorphic `as`
// keeps the anchor- and button-specific attributes.
type SplitRowProps = {
  lead?: JSX.Element;
  primary: JSX.Element;
  context?: JSX.Element;
  trailing?: JSX.Element;
  element?: "div" | "button" | "a";
}
  & Omit<JSX.HTMLAttributes<HTMLElement>, "children" | "ref">
  & { ref?: (element: HTMLElement) => void }
  & Partial<Pick<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "target" | "rel">>
  & Partial<Pick<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "type" | "disabled">>;

export function SplitRow(props: SplitRowProps) {
  const [local, rest] = splitProps(props, ["element", "lead", "primary", "context", "trailing", "class"]);
  return <Dynamic component={local.element || "div"} {...rest} class={classes("split-row", local.class)}>
    <span class="split-row-lead">{local.lead}</span>
    <span class="split-row-primary">{local.primary}</span>
    <span class="split-row-context">{local.context}</span>
    <Show when={local.trailing}><span class="split-row-trailing">{local.trailing}</span></Show>
  </Dynamic>;
}

/** The workspace panel's line counts: removed, then added. */
export function SplitCounts(props: { added: number | null; removed: number | null }) {
  return <span class="split-counts" aria-label={`${props.added ?? 0} added, ${props.removed ?? 0} removed`}>
    <span data-change="removed">−{props.removed ?? 0}</span><span data-change="added">+{props.added ?? 0}</span>
  </span>;
}
