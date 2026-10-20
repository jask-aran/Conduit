import { For, Show, splitProps, type JSX } from "solid-js";
import { XIcon } from "lucide-solid";

/*
 * Panes (DESIGN Panes and windows): a pane's tab row, the controls after it, the edge you drag, the wash a drop
 * lands in and the pill that names it; the workspace rail and the dock's header. Behaviour (fitting the row,
 * dragging, resizing, where focus goes) is the app's: these draw.
 */

/** A pane's tab row (PaneTabRow, in its header's title) and its strip (Tabs): runs of tabs by place, then the ⋯ for what folded. The app
 *  measures the row (--tab-gap, --tab-place-gap and --tab-more are registered lengths) and hides what does not fit. */
export const PaneTabRow = (props: { side?: string; children: JSX.Element }) => <nav aria-label="Tabs" class="ui-tabs-row" data-file-side={props.side}>{props.children}</nav>;
export const PaneTabs = (props: { ref?: (element: HTMLDivElement) => void; children: JSX.Element }) => <div ref={props.ref} class="ui-tabs">{props.children}</div>;

/** One place's run of tabs: the place named once in caps (a button that goes to the tab used there last). */
export function TabPlace(props: { current?: boolean; label?: string; labelProps?: JSX.ButtonHTMLAttributes<HTMLButtonElement>; onLabel?: () => void; children: JSX.Element }) {
  return <span class="ui-tab-place" data-current={props.current ? "" : undefined}>
    <Show when={props.label != null}><button type="button" tabIndex={-1} {...props.labelProps} class="ui-tab-place-label" title={props.label} onClick={() => props.onLabel?.()}><span>{props.label}</span></button></Show>
    {props.children}
  </span>;
}

/** A tab: its mark, a dot while it runs, the title (holding its lit width so switching moves nothing), then ×.
 *  lit: where you are (the current weight; the × takes room). shown: open on a viewer's other side. unsaved: a dot
 *  where the × sits until the pointer comes. none: the empty side's "No file open". */
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
      <Show when={props.live}><i class="ui-tab-live" aria-label="Running" /></Show>
      <span class="ui-tab-title" data-text={props.title}><span>{props.title}</span></span>
    </button>}><span class="ui-tab-open"><span class="ui-tab-title"><span>{props.title}</span></span></span></Show>
    <Show when={props.onClose}><button type="button" class="ui-tab-close" tabIndex={-1} aria-label={props.closeLabel ?? `Close ${props.title}`} title={props.closeTitle ?? "Close tab"} onClick={() => props.onClose?.()}><XIcon /></button></Show>
  </span>;
}

/** A pane's own controls after its title or tabs (dock, swap, close); a menu's trigger takes PaneAction with `as`. */
export const PaneActions = (props: { children: JSX.Element }) => <span class="ui-pane-actions">{props.children}</span>;
export function PaneAction(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }) {
  const [local, rest] = splitProps(props, ["label", "children"]);
  return <button type="button" tabIndex={-1} aria-label={local.label} title={local.label} {...rest} class="ui-pane-action">{local.children}</button>;
}

/** The edge between two panes, or the dock's: a separator you drag (and, for the dock, step with the arrows). */
export function PaneEdge(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void; dock?: boolean; "aria-valuemin"?: number; "aria-valuemax"?: number; "aria-valuenow"?: number }) {
  const [local, rest] = splitProps(props, ["dock"]);
  return <div role="separator" aria-orientation="vertical" {...rest} class="ui-pane-edge" data-dock={local.dock ? "" : undefined} />;
}

/** Where a drop lands: the band it washes (placed by the app). */
export const DropWash = (props: { style?: JSX.CSSProperties; within?: boolean }) => <div class="ui-drop-wash" data-within={props.within ? "" : undefined} style={props.style} aria-hidden="true" />;
/** What a drop will do, beside the pointer: an icon and its result. */
export const DragPill = (props: { ref?: (element: HTMLDivElement) => void; icon?: JSX.Element; children: JSX.Element }) =>
  <div ref={props.ref} class="ui-frost ui-drag-pill" data-surface="frost" data-lift="raised" aria-hidden="true">{props.icon}<span>{props.children}</span></div>;

/** The workspace rail on the frame: tools, then what is docked, under hairlines; the foot at the bottom. Its
 *  buttons are RailButtons (nav.tsx). */
export function ToolRail(props: JSX.HTMLAttributes<HTMLElement> & { foot?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["foot", "children"]);
  return <nav {...rest} class="ui-tool-rail" data-surface="frame">{local.children}<Show when={local.foot}><div class="ui-tool-rail-foot">{local.foot}</div></Show></nav>;
}
export const RailRule = () => <span class="ui-rail-rule" aria-hidden="true" />;

/** A layout's glyph: its panes' widths as bars (the pane layouts menu). */
export const LayoutGlyph = (props: { weights: number[] }) =>
  <span class="ui-layout-glyph" aria-hidden="true"><For each={props.weights}>{(weight) => <i style={{ flex: `${weight} 1 0` }} />}</For></span>;

/** A tool's header in the dock or a pane: its name, the place it shows (the dock follows places), its modes
 *  (a Segmented), and its controls. compact: the app measured it short -- "labels" drops the modes' words, "name"
 *  the name too. The header is the tool's drag handle. */
export function ToolHeader(props: JSX.HTMLAttributes<HTMLElement> & { ref?: (element: HTMLElement) => void; name: string; nameTitle?: string; place?: string; placeTitle?: string; modes?: JSX.Element; views?: JSX.Element; actions?: JSX.Element; draggable?: boolean }) {
  const [local, rest] = splitProps(props, ["name", "nameTitle", "place", "placeTitle", "modes", "views", "actions", "children"]);
  return <header {...rest} class="ui-tool-head">
    <strong title={local.nameTitle}>{local.name}</strong>
    <Show when={local.place}><span class="ui-tool-place" title={local.placeTitle}>{local.place}</span></Show>
    {local.modes}
    {local.views}
    <div class="ui-tool-actions">{local.actions}</div>
  </header>;
}

/** A phone's strip of the dock's views (it has no rail): each an icon and its name; the names go when they do not fit (iconsOnly). */
export function ToolViews(props: { ref?: (element: HTMLDivElement) => void; iconsOnly?: boolean; children: JSX.Element }) {
  return <div ref={props.ref} class="ui-tool-views" data-icons-only={props.iconsOnly ? "" : undefined}><div role="toolbar" aria-label="Workspace views">{props.children}</div></div>;
}
export function ToolView(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon: JSX.Element; label: string; selected?: boolean }) {
  const [local, rest] = splitProps(props, ["icon", "label", "selected"]);
  return <button type="button" role="tab" {...rest} aria-selected={Boolean(local.selected)} class="ui-tool-view">{local.icon}<span>{local.label}</span></button>;
}

/** What a tool says while it has nothing to show, or is loading: centred, quiet. */
export const PaneEmpty = (props: { children: JSX.Element }) => <div class="ui-pane-empty">{props.children}</div>;
/** Loading, at the corner of what it loads into: a frost capsule with a spinner. */
export const PaneLoading = (props: { children: JSX.Element }) => <div class="ui-frost ui-pane-loading" data-surface="frost" role="status">{props.children}</div>;
