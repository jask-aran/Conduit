import { Show, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { cn } from "@/lib/utils";
import { PaneLetter } from "./header";

export function AppShell(props: JSX.HTMLAttributes<HTMLDivElement> & { settling?: boolean; drawer?: "open" | "shut" }) {
  const [local, rest] = splitProps(props, ["class", "settling", "drawer"]);
  return <div {...rest} class={cn("ui-shell", local.class)} data-settling={local.settling ? "" : undefined} data-drawer={local.drawer} />;
}

export function Sheet(props: JSX.HTMLAttributes<HTMLElement> & { as?: "main" | "section"; lead?: boolean; docked?: boolean | "hidden"; under?: boolean; backdrop?: JSX.Element; pane?: string }) {
  const [local, rest] = splitProps(props, ["as", "class", "lead", "docked", "under", "backdrop", "children", "pane"]);
  return <Dynamic component={local.as ?? "section"} {...rest} class={cn("ui-sheet", local.class)} data-lead={local.lead ? "" : undefined}
    data-docked={local.docked === "hidden" ? "hidden" : local.docked ? "" : undefined} data-under={local.under ? "" : undefined}>
    <Show when={local.backdrop}><div class="ui-sheet-backdrop" aria-hidden="true">{local.backdrop}</div></Show>
    <PaneLetter letter={local.pane}>{local.children}</PaneLetter>
  </Dynamic>;
}

export const SheetFill = (props: JSX.HTMLAttributes<HTMLDivElement>) => {
  const [local, rest] = splitProps(props, ["class"]);
  return <div {...rest} class={cn("ui-sheet-fill", local.class)} />;
};

export function Dock(props: JSX.HTMLAttributes<HTMLElement> & { open?: boolean; expanded?: boolean; overlay?: boolean; edge?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["class", "open", "expanded", "overlay", "edge", "children"]);
  return <aside {...rest} class={cn("ui-dock", local.class)} data-open={local.open ? "" : undefined} data-expanded={local.expanded ? "" : undefined}
    data-overlay={local.overlay ? "" : undefined}>{local.edge}{local.children}</aside>;
}

export function DockSurface(props: JSX.HTMLAttributes<HTMLDivElement> & { documented?: boolean }) {
  const [local, rest] = splitProps(props, ["class", "documented"]);
  return <div {...rest} class={cn("ui-dock-surface", local.class)} data-documented={local.documented ? "" : undefined} />;
}

export const DockDocument = (props: { ref?: (element: HTMLDivElement) => void }) => <div ref={props.ref} class="ui-dock-document" />;

export const ToolKept = (props: { shown: boolean; children: JSX.Element }) => <div class="ui-tool-kept" data-shown={props.shown ? "" : undefined} aria-hidden={props.shown ? undefined : "true"} inert={props.shown ? undefined : true}>{props.children}</div>;

export const ToolContent = (props: JSX.HTMLAttributes<HTMLElement>) => {
  const [local, rest] = splitProps(props, ["class"]);
  return <main tabIndex={-1} {...rest} class={cn("ui-tool-content", local.class)} />;
};
