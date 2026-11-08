import { Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "@/lib/utils";
import { PaneLetter } from "./header";

/* The shell (DESIGN Surfaces). The app keeps the behaviour (weights, resizing, focus, what each pane shows) and sets it
 * through these pieces' props and attributes. */

/** The row beside the sidebar that the panes and the dock share. settling: the panes' shares are easing, so each
 *  sheet's room moves with them. drawer: the phone's sidebar, which the row slides off to show (nav.css --drawer). */
export function AppShell(props: JSX.HTMLAttributes<HTMLDivElement> & { settling?: boolean; drawer?: "open" | "shut" }) {
  const [local, rest] = splitProps(props, ["class", "settling", "drawer"]);
  return <div {...rest} class={cn("ui-shell", local.class)} data-settling={local.settling ? "" : undefined} data-drawer={local.drawer} />;
}

/** A pane: the charcoal ground inset on the frame, a size container. lead: the main pane (it clips what it holds).
 *  docked: a split pane moved into the dock ("hidden": while the dock shows another). under: the expanded dock covers
 *  it. On a phone only the main pane is drawn. backdrop: drawn on its ground (the meteor field), never taking the
 *  pointer. pane: its letter (A, B…) while there are several, for its header (PaneLetter). */
export function Sheet(props: JSX.HTMLAttributes<HTMLElement> & { as?: "main" | "section"; lead?: boolean; docked?: boolean | "hidden"; under?: boolean; backdrop?: JSX.Element; pane?: string }) {
  const [local, rest] = splitProps(props, ["as", "class", "lead", "docked", "under", "backdrop", "children", "pane"]);
  return <Dynamic component={local.as ?? "section"} {...rest} class={cn("ui-sheet", local.class)} data-lead={local.lead ? "" : undefined}
    data-docked={local.docked === "hidden" ? "hidden" : local.docked ? "" : undefined} data-under={local.under ? "" : undefined}>
    <Show when={local.backdrop}><div class="ui-sheet-backdrop" aria-hidden="true">{local.backdrop}</div></Show>
    <PaneLetter letter={local.pane}>{local.children}</PaneLetter>
  </Dynamic>;
}

/** What fills a sheet edge to edge, measured by its own width: a split pane's chat, a tool, a terminal. */
export const SheetFill = (props: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [local, rest] = splitProps(props, ["class"]);
  return <div {...rest} class={cn("ui-sheet-fill", local.class)} />;
};

/** The workspace's sheet at the row's end. expanded: it covers the panes; overlay: it floats over them. The app sets
 *  data-edge-instant while its edge is dragged and data-layer-switch while it moves between row and overlay. edge:
 *  its ResizeEdge. On a phone, a full-screen sheet sliding in from the right. */
export function Dock(props: JSX.HTMLAttributes<HTMLElement> & { open?: boolean; expanded?: boolean; overlay?: boolean; edge?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["class", "open", "expanded", "overlay", "edge", "children"]);
  return <aside {...rest} class={cn("ui-dock", local.class)} data-open={local.open ? "" : undefined} data-expanded={local.expanded ? "" : undefined}
    data-overlay={local.overlay ? "" : undefined}>{local.edge}{local.children}</aside>;
}

/** The dock's surface. documented: a pane's document moved into the dock shows over the tools (they keep their state). */
export function DockSurface(props: JSX.HTMLAttributes<HTMLDivElement> & { documented?: boolean }) {
  const [local, rest] = splitProps(props, ["class", "documented"]);
  return <div {...rest} class={cn("ui-dock-surface", local.class)} data-documented={local.documented ? "" : undefined} />;
}

/** Where a pane's document moved into the dock mounts (a portal target). */
export const DockDocument = (props: { ref?: (element: HTMLDivElement) => void }) => <div ref={props.ref} class="ui-dock-document" />;

/** A tool kept drawn while another shows (jbot's): skipped from layout and paint, its scroll and state kept. */
export const ToolKept = (props: { shown: boolean; children: JSX.Element }) => <div class="ui-tool-kept" data-shown={props.shown ? "" : undefined} aria-hidden={props.shown ? undefined : "true"} inert={props.shown ? undefined : true}>{props.children}</div>;

/** A tool's body under its PaneHeader, in the dock or a split: it takes the room left and holds the keyboard. */
export const ToolContent = (props: JSX.HTMLAttributes<HTMLElement>) => {
  const [local, rest] = splitProps(props, ["class"]);
  return <main tabIndex={-1} {...rest} class={cn("ui-tool-content", local.class)} />;
};
