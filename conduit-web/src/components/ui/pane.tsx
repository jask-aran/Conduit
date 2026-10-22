import { Frost } from "./frost";
import * as Icons from "./icons";
import { For, Show, splitProps, type JSX } from "solid-js";


/*
 * Panes (DESIGN Panes and windows): a pane's tab row, the controls after it, the edge you drag, the wash a drop
 * lands in and the pill that names it; the workspace rail and the dock's header. Behaviour (fitting the row,
 * dragging, resizing, where focus goes) is the app's: these draw.
 */

/** A pane's tab row (PaneTabRow, in its header's title) and its strip (Tabs): runs of tabs by place, then the ⋯ for what folded. The app
 *  measures the row (--tab-gap, --tab-place-gap and --tab-more are registered lengths) and hides what does not fit. */
export const PaneTabRow = (props: { side?: string; children: JSX.Element }) => <nav aria-label="Tabs" class="ui-tabs-row" data-file-side={props.side}>{props.children}</nav>;
export const PaneTabs = (props: { ref?: (element: HTMLDivElement) => void; children: JSX.Element }) => <div ref={props.ref} class="ui-pane-tabs">{props.children}</div>;

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
    <Show when={props.onClose}><button type="button" class="ui-tab-close" tabIndex={-1} aria-label={props.closeLabel ?? `Close ${props.title}`} title={props.closeTitle ?? "Close tab"} onClick={() => props.onClose?.()}><Icons.Close /></button></Show>
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
  <Frost ref={props.ref} lift="raised" class="ui-drag-pill" aria-hidden="true">{props.icon}<span>{props.children}</span></Frost>;

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
export const PaneEmpty = (props: { children: JSX.Element; role?: "status" | "alert" }) => <div class="ui-pane-empty" role={props.role}>{props.children}</div>;
/** Loading, at the corner of what it loads into: a frost capsule with a spinner. */
export const PaneLoading = (props: { children: JSX.Element }) => <Frost class="ui-pane-loading" role="status">{props.children}</Frost>;

/** A strip of a tool's controls (the file tree's filter, its actions; a folded tree's rail): small icon buttons on a
 *  hairline. edge: which side the hairline is on. vertical: a rail. */
export function ToolBar(props: JSX.HTMLAttributes<HTMLDivElement> & { ref?: (element: HTMLDivElement) => void; edge?: "top" | "bottom"; vertical?: boolean }) {
  const [local, rest] = splitProps(props, ["edge", "vertical"]);
  return <div {...rest} class="ui-tool-bar" data-edge={local.edge ?? "bottom"} data-vertical={local.vertical ? "" : undefined} />;
}
/** An icon button in a ToolBar; a menu's trigger takes it with `as`. */
export function ToolButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { label?: string }) {
  const [local, rest] = splitProps(props, ["label", "children"]);
  return <button type="button" aria-label={local.label} title={local.label} {...rest} class="ui-tool-button">{local.children}</button>;
}
/** A filter field in a ToolBar: the search mark, then the field. */
export function ToolFilter(props: JSX.InputHTMLAttributes<HTMLInputElement> & { ref?: (element: HTMLInputElement) => void }) {
  return <label class="ui-tool-filter"><Icons.Search /><input type="search" {...props} /></label>;
}
/** A line about the tool's state (stale, truncated, grouped): muted, or warn; an action at its end in words. */
export function ToolNotice(props: { tone?: "warn"; live?: boolean; action?: { label: string; disabled?: boolean; onClick: () => void }; children?: JSX.Element }) {
  return <div class="ui-tool-notice" data-tone={props.tone} role={props.live ? "status" : undefined} aria-live={props.live ? "polite" : undefined}>
    {props.children}
    <Show when={props.action}>{(action) => <button type="button" disabled={action().disabled} onClick={() => action().onClick()}>{action().label}</button>}</Show>
  </div>;
}

/** A row of a tree: indented by depth, a chevron for a folder (open turns it; none for a file keeps its place), its
 *  mark, its name, and a mark at the end (kept visible). selected: open in the viewer; data-open-file is the app's
 *  (open in a pane: the name strong; "focused" stronger). A context menu's trigger takes it with `as`. */
export function TreeRow(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { depth?: number; folder?: boolean; open?: boolean; icon: JSX.Element; name: string; end?: JSX.Element; selected?: boolean; "data-open-file"?: string }) {
  const [local, rest] = splitProps(props, ["depth", "folder", "open", "icon", "name", "end", "selected", "style"]);
  return <button type="button" {...rest} class="ui-tree-row" data-selected={local.selected ? "" : undefined} style={{ "--depth": local.depth ?? 0 }}>
    <Show when={local.folder} fallback={<span class="ui-tree-chevron" />}><Icons.ChevronRight class="ui-tree-chevron" data-open={local.open ? "" : undefined} /></Show>
    {local.icon}<span class="ui-tree-name">{local.name}</span>{local.end}
  </button>;
}
/** A tree: the scrolling list its rows sit in. */
export const Tree = (props: JSX.HTMLAttributes<HTMLElement> & { ref?: (element: HTMLElement) => void }) => <nav role="tree" {...props} class="ui-tree" />;

/** Files dragged over a pane: its content fogged, and what dropping does on a raised Frost card at its centre. */
export const DropOverlay = (props: { children: JSX.Element }) =>
  <div class="ui-drop-overlay"><Frost lift="raised" class="ui-drop-overlay-card">{props.children}</Frost></div>;
