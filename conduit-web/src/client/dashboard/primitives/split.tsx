import { ComposerDock, Group, GroupHeading, GroupToggle, Empty, IconButton } from "@/components/ui";
import { duration, easing, reducedMotion } from "@/components/ui/motion";
import { createContext, createEffect, createSignal, For, Index, onCleanup, onMount, Show, useContext, type Accessor, type JSX } from "solid-js";
import { DropdownMenu, MenuContent, MenuControl, MenuRow, MenuSection } from "@/components/ui/menus";
import { LineCounts, DashHeader, Dashboard, DashMore, QuickAction, QuickActions, QuickMore } from "@/components/ui/dashboard";
import { installSplitCursor, type SplitPage } from "./split-cursor";
import { foldRow } from "@/components/ui/fit";
import { isMobileLayout, MOBILE_LAYOUT_QUERY } from "../../navigation/mobile-layout";

// The pane's width, not the window's, decides when the two columns become one, so opening the workspace panel
// reflows it the way a narrow window does.

// A phone. Groups read it to trade their heading for a compact one and to fold; on desktop a narrow pane only stacks
// its columns.
const Phone = createContext<Accessor<boolean>>(() => false);

// Two columns only while the left one holds its controls at full size: the composer's (which never squeeze) and the
// chats heading's switches, ⋯ and search. The breakpoint is measured from them, not tuned.
const WATCHED = [
  ".ui-toolbar-start > *", ".ui-toolbar-end",
  ".ui-group[data-group=dash][data-order='list'] > .ui-group-head > *", ".ui-group[data-group=dash][data-order='list'] .ui-group-actions > *",
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

/** Never delayed, so a fast resize never catches the old layout squeezed. */
function glide(root: HTMLElement, change: () => void, shown?: DOMRect) {
  for (const animation of running) animation.cancel();
  running = [];
  if (reducedMotion()) return change();
  const composer = root.querySelector<HTMLElement>(".ui-dash-composer");
  // Where the composer was last drawn: by now the pane has already resized
  // around the old layout, which may have squeezed it.
  const before = shown ?? composer?.getBoundingClientRect();
  change();
  const after = composer?.getBoundingClientRect();
  // Into two columns the composer narrows out of the right column's way; its
  // sections wait until it mostly has, so it never draws over them.
  const narrowing = !root.hasAttribute("data-one-column") && Boolean(before && after && after.width < before.width - 1);
  for (const section of root.querySelectorAll<HTMLElement>(".ui-group[data-group=dash], .ui-dash-notice")) {
    const delay = narrowing && section.closest(".ui-dash-aside") ? 200 : 0;
    running.push(section.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration("--duration-quick"), delay, easing: "ease-out", fill: "backwards" }));
  }
  if (composer && before && after && Math.abs(before.width - after.width) > 1) running.push(composer.animate([
    { width: `${before.width}px`, transform: `translate(${before.left - after.left}px, ${before.top - after.top}px)` },
    // Its column's live width, so a resize still under way carries it along.
    { width: "100%", transform: "none" },
  ], { duration: duration("--duration-travel"), easing: easing("--ease-arrive") }));
}

function twoColumnWidth(root: HTMLElement) {
  const body = root.querySelector<HTMLElement>(".ui-dash-body");
  if (!body) return 0;
  const style = getComputedStyle(body);
  const needs = [0];
  const composer = root.querySelector<HTMLElement>(".ui-dash-composer");
  const actions = composer?.querySelector<HTMLElement>(".ui-toolbar");
  if (composer && actions) needs.push(rowNeed(actions) + composer.getBoundingClientRect().width - actions.getBoundingClientRect().width);
  const heading = root.querySelector<HTMLElement>(".ui-group[data-group=dash][data-order='list'] > .ui-group-head");
  if (heading) needs.push(rowNeed(heading) + heading.parentElement!.getBoundingClientRect().width - heading.getBoundingClientRect().width);
  // --dash-aside and --dash-gutter are registered lengths, so they read back in px.
  return Math.max(...needs) + (parseFloat(style.columnGap) || 0) + (parseFloat(style.getPropertyValue("--dash-aside")) || 0) + 2 * (parseFloat(style.getPropertyValue("--dash-gutter")) || 0);
}

export function SplitDashboard(props: {
  label: string;
  page: SplitPage;
  class?: string;
  header?: JSX.Element;
  quickActions?: JSX.Element;
  notice?: JSX.Element;
  band?: JSX.Element;
  composer?: JSX.Element;
  list?: JSX.Element;
  stacked?: boolean;
  aside?: JSX.Element;
  room?: boolean;
  /** What its two columns need, as measured: a document that declares its width, so the pane holding it keeps it. */
  onNeed?: (width: number) => void;
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
    // Out of the effect, so the layout changes as glide sets it and it can
    // measure the result; still before the frame is painted.
    const from = shown;
    queueMicrotask(() => { if (target === next) glide(root, () => setOneColumn(next), from); });
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
      props.onNeed?.(need());
      shown = root.querySelector(".ui-dash-composer")?.getBoundingClientRect();
      if (!measured) requestAnimationFrame(() => { measured = true; });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    // Measured where the observer delivers, after layout, where its reads are free: deferred to the next frame they
    // would follow that frame's writes and force a layout every frame.
    const sizes = new ResizeObserver(() => { cancelAnimationFrame(frame); measure(); });
    const watch = () => { sizes.disconnect(); sizes.observe(root); for (const element of root.querySelectorAll(WATCHED)) sizes.observe(element); schedule(); };
    const tree = new MutationObserver(watch);
    tree.observe(root, { childList: true, subtree: true });
    watch();
    onCleanup(() => { cancelAnimationFrame(frame); sizes.disconnect(); tree.disconnect(); });
  });
  return <Phone.Provider value={phone}><Dashboard ref={(element) => { root = element; }} label={props.label} page={props.page} compact={phone()} oneColumn={oneColumn()} stacked={props.stacked} room={props.room}
    head={props.header} actions={props.quickActions} notice={props.notice} band={props.band} composer={!phone() ? props.composer : undefined} list={props.list} aside={props.aside}
    dock={<Show when={phone() && props.composer}><ComposerDock data-dash-dock="">{props.composer}</ComposerDock></Show>} /></Phone.Provider>;
}

export function SplitHeader(props: {
  title: string;
  kind?: string;
  glyph?: JSX.Element;
  context?: Array<JSX.Element | false | null | undefined>;
}) {
  return <DashHeader title={props.title} glyph={props.glyph} context={[props.kind, ...(props.context ?? [])]} />;
}

export type SplitQuickAction = { icon: JSX.Element; label: string; onClick: () => void };

/** `manage` is a function, so its items are made inside the ⋯ menu. */
export function SplitQuickActions(props: { items: Array<SplitQuickAction | false | null | undefined>; manage?: () => JSX.Element; label?: string }) {
  const items = () => props.items.filter(Boolean) as SplitQuickAction[];
  const [fit, setFit] = createSignal(Infinity);
  const folded = () => items().slice(fit());
  let more!: HTMLSpanElement;
  onMount(() => foldRow(more, setFit, isMobileLayout));
  return <QuickActions>
    <Index each={items()}>{(item, index) => <QuickAction icon={item().icon} label={item().label} folded={index >= fit()} onClick={() => item().onClick()} />}</Index>
    <QuickMore ref={(element) => { more = element; }} keep={Boolean(props.manage)} hidden={!props.manage && !folded().length}>
      <DropdownMenu modal={false}>
        <MenuControl kind="dash" as={IconButton} tabIndex={-1} aria-label={props.label ?? "More"} title={props.label ?? "More"} />
        <MenuContent>
          <Show when={folded().length}><MenuSection><For each={folded()}>{(item) => <MenuRow icon={item.icon} onSelect={() => item.onClick()}>{item.label}</MenuRow>}</For></MenuSection></Show>
          <Show when={props.manage}><MenuSection>{props.manage?.()}</MenuSection></Show>
        </MenuContent>
      </DropdownMenu>
    </QuickMore>
  </QuickActions>;
}

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
  headless?: boolean;
}) {
  const narrow = useContext(Phone);
  const key = `conduit.dashboard.open:${props.id}`;
  const [open, setOpen] = createSignal((() => { try { return localStorage.getItem(key) === "1"; } catch { return false; } })());
  const toggle = () => {
    setOpen((value) => !value);
    try { localStorage.setItem(key, open() ? "1" : "0"); } catch { /* a per-viewer convenience */ }
  };
  const folds = () => Boolean(props.collapsible && narrow());
  const heading = () => narrow() && props.compactHeading ? props.compactHeading
    : folds() ? <GroupToggle id={props.id} open={open()} count={props.count} onClick={toggle}>{props.label}</GroupToggle>
    : props.heading ?? <GroupHeading id={props.id} count={props.count}>{props.label}</GroupHeading>;
  const actions = () => narrow() && props.compactActions ? props.compactActions : props.actions;
  return <Group kind="dash" id={props.id} labelled={Boolean(props.label)} section={props.id.replace(/^.*-/, "").replace("threads", "chats")} order={props.order} folded={folds() && !open()} busy={props.busy}
    heading={props.headless ? undefined : heading()} actions={props.headless ? undefined : actions()} more={props.more}>{props.children}</Group>;
}

export function SplitGroupMore(props: { children: JSX.Element; count?: number | string; onClick: () => void }) {
  return <DashMore count={props.count} onClick={props.onClick}>{props.children}</DashMore>;
}

export function SplitEmpty(props: { children: JSX.Element }) {
  return <Empty kind="dash">{props.children}</Empty>;
}


export const SplitCounts = LineCounts;
