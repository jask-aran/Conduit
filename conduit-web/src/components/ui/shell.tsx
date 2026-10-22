import { splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "@/lib/utils";

/*
 * The shell (DESIGN Surfaces): beside the sidebar, the row the panes and the dock share. Each pane is a Sheet: the
 * charcoal ground inset on the frame, rounded; the first is the main pane, the rest split from it. The Dock is the
 * workspace's sheet at the row's end, beside the panes or floating over them. The app keeps the behaviour --
 * weights, resizing, focus, what each pane shows -- and sets it through these pieces' props and attributes.
 */

/** The row beside the sidebar that the panes and the dock share. settling: the panes' shares are easing (a split
 *  opening or closing), so each sheet's room and margins move with them. */
export function AppShell(props: JSX.HTMLAttributes<HTMLDivElement> & { settling?: boolean }) {
  const [local, rest] = splitProps(props, ["class", "settling"]);
  return <div {...rest} class={cn("ui-shell", local.class)} data-settling={local.settling ? "" : undefined} />;
}

/** A pane: the charcoal ground inset on the frame. lead: the main pane, first beside the sidebar (it clips what it
 *  holds; a split pane's edge stands out of it). docked: a split pane moved into the dock, filling it ("hidden": docked
 *  while the dock shows another). under: the dock, expanded, covers it. On a phone the main pane is the whole screen
 *  and the others are not drawn. A sheet is a size container: what it holds is measured by its width. Its weight and
 *  min-width are the app's, as inline style. */
export function Sheet(props: JSX.HTMLAttributes<HTMLElement> & { as?: "main" | "section"; lead?: boolean; docked?: boolean | "hidden"; under?: boolean }) {
  const [local, rest] = splitProps(props, ["as", "class", "lead", "docked", "under"]);
  return <Dynamic component={local.as ?? "section"} {...rest} class={cn("ui-sheet", local.class)} data-lead={local.lead ? "" : undefined}
    data-docked={local.docked === "hidden" ? "hidden" : local.docked ? "" : undefined} data-under={local.under ? "" : undefined} />;
}

/** What fills a sheet edge to edge, measured by its own width: a split pane's chat or page, a tool, a terminal, a
 *  file viewer's host. */
export const SheetFill = (props: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [local, rest] = splitProps(props, ["class"]);
  return <div {...rest} class={cn("ui-sheet-fill", local.class)} />;
};

/** The workspace's sheet at the row's end. open: shown (its room eases open); expanded: it covers the panes; overlay:
 *  it floats over the panes instead of taking room in the row. The app sets data-edge-instant while its edge is
 *  dragged (no easing) and data-layer-switch while it moves between the row and the overlay; its width
 *  (--workspace-shell-width, width, margin-right) as inline style. edge: its PaneEdge (dock), which it places. On a
 *  phone it is a full-screen sheet sliding in from the right. */
export function Dock(props: JSX.HTMLAttributes<HTMLElement> & { open?: boolean; expanded?: boolean; overlay?: boolean; edge?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["class", "open", "expanded", "overlay", "edge", "children"]);
  return <aside {...rest} class={cn("ui-dock", local.class)} data-open={local.open ? "" : undefined} data-expanded={local.expanded ? "" : undefined}
    data-overlay={local.overlay ? "" : undefined}>{local.edge}{local.children}</aside>;
}

/** The dock's surface: its header, its tools' content, and the document a pane moved into the dock draws over them.
 *  documented: such a document shows (the tools keep their state, unseen). */
export function DockSurface(props: JSX.HTMLAttributes<HTMLDivElement> & { documented?: boolean }) {
  const [local, rest] = splitProps(props, ["class", "documented"]);
  return <div {...rest} class={cn("ui-dock-surface", local.class)} data-documented={local.documented ? "" : undefined} />;
}

/** Where a pane's document moved into the dock mounts (a portal target). */
export const DockDocument = (props: { ref?: (element: HTMLDivElement) => void }) => <div ref={props.ref} class="ui-dock-document" />;

/** A tool's body under its ToolHeader, in the dock or a split: it takes the room left and holds the keyboard. */
export const ToolContent = (props: JSX.HTMLAttributes<HTMLElement>) => {
  const [local, rest] = splitProps(props, ["class"]);
  return <main tabIndex={-1} {...rest} class={cn("ui-tool-content", local.class)} />;
};
