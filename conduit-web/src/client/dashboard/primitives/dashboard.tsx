import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import "./dashboard.css";

const classes = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

export function DashboardShell(props: {
  children: JSX.Element;
  class?: string;
  label?: string;
  labelledBy?: string;
}) {
  return <section class={classes("dashboard-shell", props.class)} aria-label={props.label} aria-labelledby={props.labelledBy}>{props.children}</section>;
}

export function DashboardIdentity(props: {
  title: string;
  kind?: string;
  subtitle?: JSX.Element;
  glyph?: JSX.Element;
  actions?: JSX.Element;
  variant?: "identity" | "intro";
  titleId?: string;
}) {
  return <header class="dashboard-identity" data-variant={props.variant || "identity"}>
    <div class="dashboard-identity-main">
      {props.glyph && <span class="dashboard-identity-glyph">{props.glyph}</span>}
      <div class="dashboard-identity-copy">
        <div class="dashboard-identity-name"><h1 id={props.titleId}>{props.title}</h1>{props.kind && <span>{props.kind}</span>}</div>
        {props.subtitle && <div class="dashboard-identity-subtitle">{props.subtitle}</div>}
      </div>
    </div>
    {props.actions && <div class="dashboard-identity-actions">{props.actions}</div>}
  </header>;
}

export function DashboardLaunch(props: { primary: JSX.Element; aside?: JSX.Element; class?: string }) {
  return <div class={classes("dashboard-launch", props.class)}>
    <div class="dashboard-composer-slot">{props.primary}</div>
    {props.aside && <aside class="dashboard-launch-aside">{props.aside}</aside>}
  </div>;
}

export function DashboardQuickActions(props: { label: string; children: JSX.Element; columns?: 1 | 2 }) {
  return <div class="dashboard-quick-actions" data-columns={props.columns || 2} aria-label={props.label}>
    <span>{props.label}</span>
    {props.children}
  </div>;
}

export function DashboardControlGroup(props: { label: string; children: JSX.Element }) {
  return <div class="dashboard-control-group" role="group" aria-label={props.label}>{props.children}</div>;
}

export function DashboardSearchButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return <button {...rest} type="button" class={classes("dashboard-search-button", local.class)}>{local.children}</button>;
}

export function DashboardGrid(props: { primary: JSX.Element; rail?: JSX.Element; class?: string }) {
  return <div class={classes("dashboard-grid", props.class)}>
    <div class="dashboard-primary">{props.primary}</div>
    {props.rail && <aside class="dashboard-rail">{props.rail}</aside>}
  </div>;
}

export function DashboardSection(props: {
  title?: string;
  description?: JSX.Element;
  actions?: JSX.Element;
  children: JSX.Element;
  class?: string;
  id?: string;
  busy?: boolean;
  scrollable?: boolean;
}) {
  return <section class={classes("dashboard-section", props.scrollable && "is-scrollable", props.class)} aria-labelledby={props.id} aria-busy={props.busy}>
    {(props.title || props.description || props.actions) && <header class="dashboard-section-heading">
      <div>{props.title && <h2 id={props.id}>{props.title}</h2>}{props.description && <p>{props.description}</p>}</div>
      {props.actions && <div class="dashboard-section-actions">{props.actions}</div>}
    </header>}
    {props.children}
  </section>;
}

type DashboardRowContent = {
  leading?: JSX.Element;
  content: JSX.Element;
  meta?: JSX.Element;
  trailing?: JSX.Element;
};

type DashboardRowProps = DashboardRowContent & (
  | ({ element?: "div" } & Omit<JSX.HTMLAttributes<HTMLDivElement>, "children">)
  | ({ element: "button" } & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "children">)
  | ({ element: "a" } & Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "children">)
);

export function DashboardRow(props: DashboardRowProps) {
  const [local, rest] = splitProps(props, ["element", "leading", "content", "meta", "trailing", "class"]);
  return <Dynamic component={local.element || "div"} {...rest} class={classes("dashboard-row", local.class)}>
    {local.leading && <span class="dashboard-row-leading">{local.leading}</span>}
    <span class="dashboard-row-content">{local.content}</span>
    {local.meta && <span class="dashboard-row-meta">{local.meta}</span>}
    {local.trailing && <span class="dashboard-row-trailing">{local.trailing}</span>}
  </Dynamic>;
}

export function DashboardRowTitle(props: { title: JSX.Element; context?: JSX.Element }) {
  return <span class="dashboard-row-title"><strong>{props.title}</strong>{props.context && <em>{props.context}</em>}</span>;
}

export function DashboardEmpty(props: { children: JSX.Element; class?: string }) {
  return <div class={classes("dashboard-empty", props.class)}>{props.children}</div>;
}

export function DashboardScrollRegion(props: { children: JSX.Element; class?: string }) {
  return <div class={classes("dashboard-scroll-region", props.class)}>{props.children}</div>;
}
