import { Show, type JSX } from "solid-js";
import { CircleCheckIcon, CircleXIcon, InfoIcon, TriangleAlertIcon, XIcon } from "lucide-solid";
import { Button } from "./controls";
import { type Density, type Motion, motionOf } from "./shared";

/*
 * Toast: one sentence about what just happened, raised frost at the window's edge. Its kind is a glyph in
 * the state's colour (never a fill): success --live, warning --warn, error --destructive, info muted.
 * An action, when there is one thing to do about it; a × to dismiss. An error is an alert, the rest status.
 */
export type ToastKind = "success" | "info" | "warning" | "error";
const TOAST_ICONS: Record<ToastKind, () => JSX.Element> = { success: () => <CircleCheckIcon />, info: () => <InfoIcon />, warning: () => <TriangleAlertIcon />, error: () => <CircleXIcon /> };
export function Toast(props: { kind?: ToastKind; children: JSX.Element; action?: { label: string; onClick?: (event: MouseEvent) => void }; description?: string; onDismiss?: () => void; density?: Density; motion?: Motion }) {
  const kind = () => props.kind ?? "info";
  return <div role={kind() === "error" ? "alert" : "status"} class="ui-frost ui-toast" data-kind={kind()} data-density={props.density} data-surface="frost" data-lift="raised" {...motionOf(props.motion)}>
    <span class="ui-toast-icon">{TOAST_ICONS[kind()]()}</span>
    <div class="ui-toast-copy"><p class="ui-toast-text">{props.children}</p><Show when={props.description}><p class="ui-toast-description">{props.description}</p></Show></div>
    <Show when={props.action}>{(action) => <Button variant="ghost" outline size="sm" onClick={(event) => action().onClick?.(event)}>{action().label}</Button>}</Show>
    <Button variant="ghost" size="icon-xs" class="ui-toast-close" aria-label="Dismiss" onClick={() => props.onDismiss?.()}><XIcon /></Button>
  </div>;
}
/** Where toasts gather: newest nearest the edge, the rest stacked away from it. */
export function Toaster(props: { children?: JSX.Element; host?: (attrs: { class: string; style: JSX.CSSProperties }) => JSX.Element }) {
  // A notification engine supplies behavior; the library owns its shell and appearance.
  return props.host ? props.host({ class: "ui-notifications", style: { "--width": "var(--measure-lg)", "--gap": "var(--space-sm)" } })
    : <section class="ui-toaster" aria-label="Notifications">{props.children}</section>;
}
