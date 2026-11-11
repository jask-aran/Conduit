import { dragRegion } from "./window";
import { Dot } from "./nav";
import { Frost } from "./frost";
import * as Icons from "./icons";
import { CloseButton } from "./actions";
import { Row, type RowProps } from "./row";
import { For, onCleanup, Show, splitProps, type JSX } from "solid-js";
import { callHandler } from "./shared";
import { keptParts, watchFit } from "./fit";


export const PaneTabRow = (props: { side?: string; children: JSX.Element }) => <nav aria-label="Tabs" class="ui-tabs-row" data-file-side={props.side}>{props.children}</nav>;
export const PaneTabs = (props: { ref?: (element: HTMLDivElement) => void; onFold?: (hidden: string[]) => void; children: JSX.Element }) =>
  <div ref={(element) => { props.ref?.(element); if (props.onFold) fitTabs(element, props.onFold); }} class="ui-pane-tabs">{props.children}</div>;

function fitTabs(strip: HTMLElement, onFold: (hidden: string[]) => void) {
  let reported = "";
  const report = (hidden: string[]) => { if (hidden.join() !== reported) { reported = hidden.join(); onFold(hidden); } };
  const fit = () => {
    const places = [...strip.querySelectorAll<HTMLElement>(".ui-tab-place")];
    const tabs = [...strip.querySelectorAll<HTMLElement>(".ui-tab")];
    // The row's spacing, as pane.css sets it (registered lengths, so they read back in px).
    const style = getComputedStyle(strip);
    const tabGap = parseFloat(style.getPropertyValue("--tab-gap")) || 0;
    const placeGap = parseFloat(style.getPropertyValue("--tab-place-gap")) || 0;
    const moreWidth = parseFloat(style.getPropertyValue("--tab-more")) || 0;
    const labelGap = parseFloat(style.getPropertyValue("--tab-label-gap")) || 0;
    for (const element of [...places, ...tabs]) element.style.display = "";
    for (const element of tabs) element.removeAttribute("data-lead");
    if (!tabs.length) return report([]);
    const room = strip.clientWidth;
    // Tabs give way to a squeeze by cutting their titles, so each is measured with its whole title; a tab's own cap
    // (max-width) still holds.
    const whole = (tab: HTMLElement) => { const title = tab.querySelector<HTMLElement>(".ui-tab-title > span"); const width = tab.getBoundingClientRect().width; return Math.min(width + (title ? title.scrollWidth - title.clientWidth : 0), Math.max(width, parseFloat(getComputedStyle(tab).maxWidth) || Infinity)); };
    const natural = (element: HTMLElement) => element.classList.contains("ui-tab") ? whole(element) : element.getBoundingClientRect().width + [...element.querySelectorAll<HTMLElement>(".ui-tab")].reduce((sum, tab) => sum + whole(tab) - tab.getBoundingClientRect().width, 0);
    const all = places.reduce((sum, element, index) => sum + natural(element) + (index ? placeGap : 0), 0);
    const label = (place: HTMLElement) => place.querySelector<HTMLElement>(".ui-tab-place-label")?.getBoundingClientRect().width ?? 0;
    const staying = tabs.filter((tab) => tab.hasAttribute("data-lit") || tab.hasAttribute("data-shown"));
    const need = String(Math.ceil(staying.reduce((sum, tab) => sum + natural(tab) + tabGap, 0) + (staying.length < tabs.length ? moreWidth : 0)
      + places.filter((place) => staying.some((tab) => place.contains(tab))).reduce((sum, place) => sum + label(place), 0)));
    if (strip.dataset.need !== need) strip.dataset.need = need;
    if (all <= room) return report([]);
    // Each tab with the gap and middot before it; each place with its label and the rule before it, paid once a tab of
    // it stays.
    const placeOf = (tab: HTMLElement) => places.findIndex((place) => place.contains(tab));
    const placeCost = (index: number) => label(places[index]!) + labelGap + (index ? placeGap : 0);
    const paid = new Set(staying.map(placeOf));
    const budget = room - moreWidth - staying.reduce((sum, tab) => sum + natural(tab) + tabGap, 0) - [...paid].reduce((sum, index) => sum + placeCost(index), 0);
    const others = tabs.filter((tab) => !staying.includes(tab));
    const costs = others.map((tab) => { const index = placeOf(tab); const cost = natural(tab) + tabGap + (paid.has(index) ? 0 : placeCost(index)); paid.add(index); return cost; });
    const hidden = others.slice(keptParts(budget, costs));
    hidden.forEach((tab) => { tab.style.display = "none"; });
    // A folded tab's middot goes with it: the first tab left in a place leads it.
    places.forEach((place) => {
      let lead = true;
      place.querySelectorAll<HTMLElement>(".ui-tab").forEach((tab) => { const shown = tab.style.display !== "none"; tab.toggleAttribute("data-lead", shown && lead); if (shown) lead = false; });
      if (lead) place.style.display = "none";
    });
    report(hidden.map((tab) => tab.dataset.tab!));
  };
  watchFit(strip, fit, { content: fit, attributes: ["data-lit", "data-shown"] });
  queueMicrotask(fit);
}

export function TabPlace(props: { current?: boolean; label?: string; labelProps?: JSX.ButtonHTMLAttributes<HTMLButtonElement>; onLabel?: () => void; children: JSX.Element }) {
  return <span class="ui-tab-place" data-current={props.current ? "" : undefined}>
    <Show when={props.label != null}><button type="button" tabIndex={-1} {...props.labelProps} class="ui-tab-place-label" title={props.label} onClick={() => props.onLabel?.()}><span>{props.label}</span></button></Show>
    {props.children}
  </span>;
}

/** The title holds its lit width so switching moves nothing. */
export function PaneTab(props: {
  id?: string;
  lit?: boolean;
  shown?: boolean;
  unsaved?: boolean;
  none?: boolean;
  icon?: JSX.Element;
  live?: boolean;
  title: string;
  hint?: string;
  closeLabel?: string;
  closeTitle?: string;
  onOpen?: () => void;
  onClose?: () => void;
  drag?: JSX.HTMLAttributes<HTMLSpanElement> & { draggable?: "true" | boolean; "data-doc-view"?: string };
}) {
  return <span {...props.drag} class="ui-tab" role="tab" data-tab={props.id} aria-selected={Boolean(props.lit)} data-lit={props.lit ? "" : undefined}
    data-shown={props.shown ? "" : undefined} data-unsaved={props.unsaved ? "" : undefined} data-none={props.none ? "" : undefined}>
    <Show when={props.none} fallback={<button type="button" class="ui-tab-open" tabIndex={-1} title={props.hint ?? props.title} onClick={() => props.onOpen?.()}>
      {props.icon}
      <Show when={props.live}><Dot tone="success" class="ui-tab-live" aria-label="Running" /></Show>
      <span class="ui-tab-title" data-text={props.title}><span>{props.title}</span></span>
    </button>}><span class="ui-tab-open"><span class="ui-tab-title"><span>{props.title}</span></span></span></Show>
    <Show when={props.onClose}><CloseButton kind="tab" tabIndex={-1} label={props.closeLabel ?? `Close ${props.title}`} title={props.closeTitle ?? "Close tab"} onClick={() => props.onClose?.()} /></Show>
  </span>;
}

export type EdgeDrag = { move: (dx: number, event: PointerEvent) => void; end?: () => void };

export type ResizeEdgeKind = "pane" | "split" | "sides" | "browser";

/** Captured, so the edge keeps its cursor through the drag. */
function dragEdge(event: PointerEvent, drag: EdgeDrag, done: () => void) {
  const edge = event.currentTarget as HTMLElement;
  event.preventDefault();
  edge.setPointerCapture(event.pointerId);
  edge.dataset.resizing = "";
  const startX = event.clientX;
  let last: PointerEvent | undefined;
  let frame = 0;
  let stopped = false;
  const apply = () => { frame = 0; if (last) drag.move(last.clientX - startX, last); };
  const move = (next: PointerEvent) => { last = next; if (!frame) frame = requestAnimationFrame(apply); };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (frame) { cancelAnimationFrame(frame); apply(); }
    for (const type of ["pointerup", "pointercancel", "blur"]) window.removeEventListener(type, stop);
    window.removeEventListener("pointermove", move);
    edge.removeEventListener("lostpointercapture", stop);
    if (edge.hasPointerCapture(event.pointerId)) edge.releasePointerCapture(event.pointerId);
    delete edge.dataset.resizing;
    done();
    drag.end?.();
  };
  window.addEventListener("pointermove", move);
  for (const type of ["pointerup", "pointercancel", "blur"]) window.addEventListener(type, stop, { once: true });
  edge.addEventListener("lostpointercapture", stop, { once: true });
  return stop;
}

export function ResizeEdge(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "onPointerDown" | "onDrag"> & { kind: ResizeEdgeKind; dock?: boolean; ref?: (element: HTMLDivElement) => void;
  startDrag?: (event: PointerEvent, stop: () => void) => EdgeDrag | undefined; onStep?: (direction: -1 | 1) => void;
  "aria-valuemin"?: number; "aria-valuemax"?: number; "aria-valuenow"?: number }) {
  const [local, rest] = splitProps(props, ["kind", "dock", "startDrag", "onStep", "onKeyDown"]);
  let stop: (() => void) | undefined;
  onCleanup(() => stop?.());
  return <div role="separator" aria-orientation="vertical" tabIndex={local.onStep ? 0 : undefined} {...rest} class="ui-resize-edge" data-edge={local.kind} data-dock={local.dock ? "" : undefined}
    onPointerDown={(event) => {
      // The drag before this one ends first: its end, run after the new start, would undo what the start set.
      stop?.();
      const drag = local.startDrag?.(event, () => stop?.());
      if (!drag) return;
      stop = dragEdge(event, drag, () => { stop = undefined; });
    }}
    onKeyDown={(event) => {
      if (local.onStep && (event.key === "ArrowLeft" || event.key === "ArrowRight")) local.onStep(event.key === "ArrowLeft" ? -1 : 1);
      callHandler(local.onKeyDown, event);
    }} />;
}

export const DropWash = (props: { style?: JSX.CSSProperties; within?: boolean }) => <div class="ui-drop-wash" data-within={props.within ? "" : undefined} style={props.style} aria-hidden="true" />;
export const DragPill = (props: { ref?: (element: HTMLDivElement) => void; icon?: JSX.Element; children: JSX.Element }) =>
  <Frost ref={props.ref} lift="raised" class="ui-drag-pill" aria-hidden="true">{props.icon}<span>{props.children}</span></Frost>;

export function ToolRail(props: JSX.HTMLAttributes<HTMLElement> & { foot?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["foot", "children"]);
  return <nav {...rest} class="ui-tool-rail" data-surface="frame" data-tauri-drag-region={dragRegion()}>{local.children}<Show when={local.foot}><div class="ui-tool-rail-foot">{local.foot}</div></Show></nav>;
}
export const RailRule = () => <span class="ui-rail-rule" aria-hidden="true" />;

export const LayoutGlyph = (props: { weights: number[] }) =>
  <span class="ui-layout-glyph" aria-hidden="true"><For each={props.weights}>{(weight) => <i style={{ flex: `${weight} 1 0` }} />}</For></span>;

export const PaneHome = (props: { label: string; children: JSX.Element }) =>
  <section class="ui-pane-home" aria-label={props.label}><div class="ui-pane-home-column">{props.children}</div></section>;
export function ToolBar(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void; edge?: "top" | "bottom"; vertical?: boolean }) {
  const [local, rest] = splitProps(props, ["edge", "vertical"]);
  return <div {...rest} class="ui-tool-bar" data-edge={local.edge ?? "bottom"} data-vertical={local.vertical ? "" : undefined} />;
}
export function TreeRow(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { depth?: number; folder?: boolean; open?: boolean; icon: JSX.Element; name: string; end?: JSX.Element; selected?: boolean; "data-open-file"?: string }) {
  const [local, rest] = splitProps(props, ["depth", "folder", "open", "icon", "name", "end", "selected", "style"]);
  return <Row {...(rest as RowProps)} element="button" density="tree" depth={local.depth ?? 0} selected={local.selected} class="ui-tree-row" label={local.name} end={local.end}
    lead={<><Show when={local.folder} fallback={<span class="ui-tree-chevron" />}><Icons.ChevronRight class="ui-tree-chevron ui-fold-chevron" data-open={local.open ? "" : undefined} /></Show>{local.icon}</>} />;
}
export const Tree = (props: JSX.HTMLAttributes<HTMLElement> & { ref?: (element: HTMLElement) => void }) => <nav role="tree" {...props} class="ui-tree" />;

export const DropOverlay = (props: { children: JSX.Element }) =>
  <div class="ui-drop-overlay"><Frost lift="raised" class="ui-drop-overlay-card">{props.children}</Frost></div>;
