import { createContext, createEffect, createSignal, For, Index, onCleanup, onMount, Show, splitProps, useContext, type Accessor, type JSX } from "solid-js";
import { ChevronRightIcon, EllipsisIcon } from "lucide-solid";
import { Menu, MenuContent, MenuGroup, MenuItem, MenuSeparator, MenuTrigger } from "@/components/primitives";
import { Dynamic } from "solid-js/web";
import { installSplitCursor, type SplitPage } from "./split-cursor";
import { isMobileLayout, MOBILE_LAYOUT_QUERY } from "../../navigation/mobile-layout";
import "./split.css";

// The project and workspace dashboards: a header across the top, then the
// composer with the threads list under it on the left and what is live and
// what changed on the right. The pane's width, not the window's, decides
// when the two columns become one, so opening the workspace panel reflows it
// the way a narrow window does. The Conduit dashboard still uses ./dashboard.

const classes = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

// A phone. Groups read it to trade their heading for a compact one and to
// fold; on desktop a narrow pane only stacks its columns (split.css).
const Phone = createContext<Accessor<boolean>>(() => false);

// Two columns only while the left one holds its controls at full size: the
// composer's (which never squeeze, split.css) and the chats heading's
// switches, ⋯ and search. The breakpoint is measured from them, not tuned.
const BODY_GUTTERS = 48; // .split-dashboard-body: calc(100% - 48px)
const WATCHED = [
  ".composer-actions-left > *", ".composer-actions-right",
  ".split-group[data-order='list'] > .split-group-heading > *", ".split-group[data-order='list'] .split-group-actions > *",
].join(", ");

/** The width a flex row needs with nothing in it squeezed: its fixed
 *  children at their size, a growing one by what it holds. Filters that fold
 *  into ⋯ are left out. */
function rowNeed(row: HTMLElement): number {
  const style = getComputedStyle(row);
  const children = ([...row.children] as HTMLElement[]).filter((child) => !child.hasAttribute("data-fold") && getComputedStyle(child).display !== "none");
  const inner = children.reduce((sum, child) => {
    const own = getComputedStyle(child);
    const grows = parseFloat(own.flexGrow) > 0 && own.display.includes("flex");
    return sum + (grows ? rowNeed(child) : child.getBoundingClientRect().width) + parseFloat(own.marginLeft) + parseFloat(own.marginRight);
  }, 0);
  const edges = ["paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth"] as const;
  return inner + (parseFloat(style.columnGap) || 0) * Math.max(0, children.length - 1) + edges.reduce((sum, edge) => sum + (parseFloat(style[edge]) || 0), 0);
}

let running: Animation[] = [];

/**
 * Switches layouts at once, without anything crossing the pane: the sections
 * appear at their new places and fade in (as the collapsed sidebar's rail
 * does), while the composer eases from its old width and place to its new
 * ones. Never delayed, so a fast resize never catches the old layout squeezed.
 * Instant when motion is reduced.
 */
function glide(root: HTMLElement, change: () => void, shown?: DOMRect) {
  for (const animation of running) animation.cancel();
  running = [];
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return change();
  const composer = root.querySelector<HTMLElement>(".split-dashboard-composer");
  // Where the composer was last drawn: by now the pane has already resized
  // around the old layout, which may have squeezed it.
  const before = shown ?? composer?.getBoundingClientRect();
  change();
  const after = composer?.getBoundingClientRect();
  // Into two columns the composer narrows out of the right column's way; its
  // sections wait until it mostly has, so it never draws over them.
  const narrowing = !root.hasAttribute("data-one-column") && Boolean(before && after && after.width < before.width - 1);
  for (const section of root.querySelectorAll<HTMLElement>(".split-group, .split-dashboard-notice")) {
    const delay = narrowing && section.closest(".split-dashboard-aside") ? 200 : 0;
    running.push(section.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, delay, easing: "ease-out", fill: "backwards" }));
  }
  if (composer && before && after && Math.abs(before.width - after.width) > 1) running.push(composer.animate([
    { width: `${before.width}px`, transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)` },
    { width: `${after.width}px`, transform: "none" },
  ], { duration: 320, easing: "cubic-bezier(.2, .8, .2, 1)" }));
}

/** The narrowest pane that fits both columns. */
function twoColumnWidth(root: HTMLElement) {
  const body = root.querySelector<HTMLElement>(".split-dashboard-body");
  if (!body) return 0;
  const style = getComputedStyle(body);
  const needs = [0];
  const composer = root.querySelector<HTMLElement>(".split-dashboard-composer");
  const actions = composer?.querySelector<HTMLElement>(".composer-actions");
  if (composer && actions) needs.push(rowNeed(actions) + composer.getBoundingClientRect().width - actions.getBoundingClientRect().width);
  const heading = root.querySelector<HTMLElement>(".split-group[data-order='list'] > .split-group-heading");
  if (heading) needs.push(rowNeed(heading) + heading.parentElement!.getBoundingClientRect().width - heading.getBoundingClientRect().width);
  return Math.max(...needs) + (parseFloat(style.columnGap) || 0) + (parseFloat(style.getPropertyValue("--split-aside-width")) || 0) + BODY_GUTTERS;
}

export function SplitDashboard(props: {
  label: string;
  /** What the page is, for the leader. */
  page: SplitPage;
  class?: string;
  header: JSX.Element;
  quickActions?: JSX.Element;
  notice?: JSX.Element;
  composer?: JSX.Element;
  list?: JSX.Element;
  aside?: JSX.Element;
}) {
  let root!: HTMLElement;
  const [phone, setPhone] = createSignal(isMobileLayout());
  const [paneWidth, setPaneWidth] = createSignal(Infinity);
  const [need, setNeed] = createSignal(0);
  const wanted = () => phone() || paneWidth() < need();
  const [oneColumn, setOneColumn] = createSignal(false);
  let measured = false;
  // The layout being switched to, so a switch under way is not started again
  // on every frame of a resize.
  let target = false;
  let shown: DOMRect | undefined;
  createEffect(() => {
    const next = wanted();
    if (next === target) return;
    target = next;
    if (!measured) return setOneColumn(next);
    glide(root, () => setOneColumn(next), shown);
  });
  onMount(() => {
    onCleanup(installSplitCursor(root));
    const query = matchMedia(MOBILE_LAYOUT_QUERY);
    const change = () => setPhone(query.matches);
    query.addEventListener("change", change);
    onCleanup(() => query.removeEventListener("change", change));
    let frame = 0;
    const measure = () => {
      frame = 0;
      setPaneWidth(root.clientWidth);
      setNeed(twoColumnWidth(root));
      shown = root.querySelector(".split-dashboard-composer")?.getBoundingClientRect();
      if (!measured) requestAnimationFrame(() => { measured = true; });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const sizes = new ResizeObserver(schedule);
    const watch = () => { sizes.disconnect(); sizes.observe(root); for (const element of root.querySelectorAll(WATCHED)) sizes.observe(element); schedule(); };
    const tree = new MutationObserver(watch);
    tree.observe(root, { childList: true, subtree: true });
    watch();
    onCleanup(() => { cancelAnimationFrame(frame); sizes.disconnect(); tree.disconnect(); });
  });
  return <Phone.Provider value={phone}><section ref={root} class={classes("split-dashboard", props.class)} data-compact={phone() ? "" : undefined} data-one-column={oneColumn() ? "" : undefined} data-page={props.page} aria-label={props.label}>
    <div class="split-dashboard-body">
      <div class="split-dashboard-head">{props.header}{props.quickActions}</div>
      <Show when={props.notice}><div class="split-dashboard-notice">{props.notice}</div></Show>
      <div class="split-dashboard-main">
        <Show when={props.composer}><div class="split-dashboard-composer">{props.composer}</div></Show>
        {props.list}
      </div>
      <div class="split-dashboard-aside">{props.aside}</div>
    </div>
  </section></Phone.Provider>;
}

/** The page's mark, centred on its name and, under the name, its kind and
 *  context, small and muted. */
export function SplitHeader(props: {
  title: string;
  kind?: string;
  glyph?: JSX.Element;
  context?: Array<JSX.Element | false | null | undefined>;
}) {
  const items = () => [props.kind, ...(props.context ?? [])].filter(Boolean);
  return <header class="split-header">
    <Show when={props.glyph}><span class="split-header-glyph">{props.glyph}</span></Show>
    <div class="split-header-copy">
      <h1>{props.title}</h1>
      <Show when={items().length}>
        <p class="split-header-context"><For each={items()}>{(item) => <span>{item}</span>}</For></p>
      </Show>
    </div>
  </header>;
}

/**
 * Folds a row's [data-fold] items, last first, into its [data-fold-more] as
 * room runs out. A folded item stays laid out, hidden, so its width is known
 * when room comes back; [data-fold-keep] on the ⋯ counts it whether or not
 * anything has folded. Call from onMount; a phone never folds.
 */
export function watchFold(more: HTMLElement, setFit: (count: number) => void) {
  const bar = more.parentElement;
  if (!bar) return;
  const measure = () => {
    if (isMobileLayout()) return setFit(Infinity);
    const gap = parseFloat(getComputedStyle(bar).columnGap) || 0;
    const children = [...bar.children] as HTMLElement[];
    const widths = children.filter((child) => child.hasAttribute("data-fold")).map((child) => child.offsetWidth + gap);
    const keep = more.hasAttribute("data-fold-keep");
    let used = children.filter((child) => !child.matches("[data-fold], [data-fold-more]")).reduce((sum, child) => sum + child.offsetWidth + gap, 0)
      + (keep ? more.offsetWidth + gap : 0);
    const room = bar.clientWidth + gap + .5;
    if (used + widths.reduce((sum, width) => sum + width, 0) <= room) return setFit(widths.length);
    if (!keep) used += more.offsetWidth + gap;
    let count = 0;
    while (count < widths.length && used + widths[count]! <= room) used += widths[count++]!;
    setFit(count);
  };
  const observer = new ResizeObserver(measure);
  const observeAll = () => { observer.disconnect(); observer.observe(bar); for (const child of bar.children) observer.observe(child); measure(); };
  const mutations = new MutationObserver(observeAll);
  mutations.observe(bar, { childList: true });
  observeAll();
  onCleanup(() => { observer.disconnect(); mutations.disconnect(); });
}

export type SplitQuickAction = { icon: JSX.Element; label: string; onClick: () => void };

/**
 * Plain words on the title's line. A quick action is a verb for this place that
 * nothing else on the page already offers -- not a section's own action, the
 * status row, the chats heading or the top bar -- and managing the place
 * itself goes in `manage`. At every desktop width, as room runs out
 * they fold, last first, into the ⋯, which also holds the page's `manage`
 * items -- a function, so they are made inside the menu -- and the title truncates only once they all have. A row of large
 * targets on a phone.
 */
export function SplitQuickActions(props: { items: Array<SplitQuickAction | false | null | undefined>; manage?: () => JSX.Element; label?: string }) {
  const items = () => props.items.filter(Boolean) as SplitQuickAction[];
  const [fit, setFit] = createSignal(Infinity);
  const folded = () => items().slice(fit());
  let more!: HTMLSpanElement;
  onMount(() => watchFold(more, setFit));
  return <nav class="split-quick-actions" aria-label="Quick actions">
    <Index each={items()}>{(item, index) => <button type="button" tabIndex={-1} data-fold data-folded={index >= fit() ? "" : undefined} onClick={() => item().onClick()}>{item().icon}<span>{item().label}</span></button>}</Index>
    <span ref={more} data-fold-more data-fold-keep={props.manage ? "" : undefined} data-folded={!props.manage && !folded().length ? "" : undefined}>
      <Menu modal={false}>
        <MenuTrigger class="workspace-dashboard-manage" tabIndex={-1} aria-label={props.label ?? "More"} title={props.label ?? "More"}><EllipsisIcon /></MenuTrigger>
        <MenuContent>
          <Show when={folded().length}>
            <MenuGroup><For each={folded()}>{(item) => <MenuItem onSelect={() => item.onClick()}>{item.icon}{item.label}</MenuItem>}</For></MenuGroup>
            <Show when={props.manage}><MenuSeparator /></Show>
          </Show>
          {props.manage?.()}
        </MenuContent>
      </Menu>
    </span>
  </nav>;
}

/**
 * A heading and plain one-line rows, drawn as the sidebar draws its groups.
 * `order` places it on one column: Running comes first, then the threads
 * list, then the rest. On a phone a group can trade its heading and
 * actions for compact ones (the chats list's Filters menu), and a
 * `collapsible` group folds under its heading, folded until opened; the
 * choice is remembered per device.
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
  compactHeading?: JSX.Element;
  compactActions?: JSX.Element;
  collapsible?: boolean;
}) {
  const narrow = useContext(Phone);
  const key = `conduit.dashboard.open:${props.id}`;
  const [open, setOpen] = createSignal((() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } })());
  const toggle = () => {
    setOpen((value) => !value);
    try { localStorage.setItem(key, open() ? "1" : "0"); } catch { /* a per-viewer convenience */ }
  };
  const folds = () => Boolean(props.collapsible && narrow());
  const title = () => <>{props.label}<Show when={props.count != null}><small>{props.count}</small></Show></>;
  const heading = () => narrow() && props.compactHeading ? props.compactHeading
    : folds() ? <h2 id={props.id}><button type="button" class="split-group-toggle" aria-expanded={open()} onClick={toggle}><ChevronRightIcon />{title()}</button></h2>
    : props.heading ?? <h2 id={props.id}>{title()}</h2>;
  const actions = () => narrow() && props.compactActions ? props.compactActions : props.actions;
  return <section class={classes("split-group", props.class)} data-folded={folds() && !open() ? "" : undefined} data-section={props.id.replace(/^.*-/, "").replace("threads", "chats")} data-order={props.order || "rest"} aria-labelledby={props.label ? props.id : undefined} aria-label={props.label ? undefined : props.id} aria-busy={props.busy || undefined}>
    <header class="split-group-heading">
      {heading()}
      <Show when={actions()}><div class="split-group-actions">{actions()}</div></Show>
    </header>
    <div class="split-group-rows" hidden={folds() && !open()}>{props.children}{props.more}</div>
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
