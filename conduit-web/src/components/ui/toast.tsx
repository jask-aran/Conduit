import * as Icons from "./icons";
import { Show, type JSX } from "solid-js";
import { CircleCheckIcon, CircleXIcon, InfoIcon } from "lucide-solid";
import { Button } from "./controls";
import { type Density, type Motion, motionOf } from "./shared";

/*
 * Toast: one sentence about what just happened, raised frost at the window's edge. Its kind is a glyph in
 * the state's colour (never a fill): success --live, warning --warn, error --destructive, info muted.
 * An action, when there is one thing to do about it; a × to dismiss. An error is an alert, the rest status.
 */
export type ToastKind = "success" | "info" | "warning" | "error";
const TOAST_ICONS: Record<ToastKind, () => JSX.Element> = { success: () => <CircleCheckIcon />, info: () => <InfoIcon />, warning: () => <Icons.Warning />, error: () => <CircleXIcon /> };
export function Toast(props: { kind?: ToastKind; children: JSX.Element; action?: { label: string; onClick?: (event: MouseEvent) => void }; description?: string; onDismiss?: () => void; density?: Density; motion?: Motion; embedded?: boolean }) {
  const kind = () => props.kind ?? "info";
  return <div role={kind() === "error" ? "alert" : "status"} class={props.embedded ? "ui-toast" : "ui-frost ui-toast-frame ui-toast"} data-kind={kind()} data-density={props.density} data-surface="frost" data-lift="raised" {...motionOf(props.motion)}>
    <span class="ui-toast-icon">{TOAST_ICONS[kind()]()}</span>
    <div class="ui-toast-copy"><p class="ui-toast-text">{props.children}</p><Show when={props.description}><p class="ui-toast-description">{props.description}</p></Show></div>
    <Show when={props.action}>{(action) => <Button variant="ghost" outline size="sm" onClick={(event) => action().onClick?.(event)}>{action().label}</Button>}</Show>
    <Button variant="ghost" size="icon-xs" class="ui-toast-close" aria-label="Dismiss" onClick={() => props.onDismiss?.()}><Icons.Close /></Button>
  </div>;
}
/** Where toasts gather: newest nearest the edge, the rest stacked away from it. */
export function Toaster(props: { children?: JSX.Element; host?: (attrs: { class: string; frameClass: string; style: JSX.CSSProperties }) => JSX.Element }) {
  // The engine's animated element is the frost frame. An embedded Toast draws
  // its content without putting a second backdrop below an opacity boundary.
  return props.host ? props.host({ class: "ui-notifications", frameClass: "ui-frost ui-frost-raised ui-toast-frame", style: { "--width": "var(--measure-lg)", "--gap": "var(--space-sm)" } })
    : <section class="ui-toaster" aria-label="Notifications">{props.children}</section>;
}
