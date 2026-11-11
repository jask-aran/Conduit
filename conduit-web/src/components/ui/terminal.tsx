import { Show, splitProps, type JSX } from "solid-js";
import { Button, Spinner } from "./controls";
import { haptic } from "./haptics";
import { CloseButton } from "./actions";

export function TermStatus(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> & { tone: "success" | "busy" | "warn" | "danger" | "muted"; busy?: boolean; label?: string }) {
  const [local, rest] = splitProps(props, ["tone", "busy", "label"]);
  return <div role="status" {...rest} class="ui-term-status" data-tone={local.tone} data-busy={local.busy ? "" : undefined}>
    <div class="ui-term-status-mark ui-size-icon" aria-hidden="true"><Show when={local.busy} fallback={<i />}><Spinner /></Show></div>
    <Show when={local.label}><small>{local.label}</small></Show>
  </div>;
}
export function TermIdentity(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> & { end?: JSX.Element; onClose?: () => void; closeLabel?: string }) {
  const [local, rest] = splitProps(props, ["children", "end", "onClose", "closeLabel"]);
  return <div {...rest} class="ui-term-identity">{local.children}
    <Show when={local.onClose}><CloseButton kind="tab" label={local.closeLabel ?? "Close terminal"} onClick={() => local.onClose?.()} /></Show>
    <Show when={local.end}><span class="ui-term-identity-end">{local.end}</span></Show></div>;
}
export const TermContext = (props: { children: JSX.Element }) => <span class="ui-term-context">{props.children}</span>;
export function TermShortcuts(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class">) {
  return <div {...props} class="ui-term-shortcuts" />;
}
export const TermShortcut = (props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class">) => <Button variant="ghost" size="sm" {...props} />;
export function TermLead(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> & { phone?: boolean }) {
  const [local, rest] = splitProps(props, ["phone"]);
  return <div {...rest} class="ui-term-lead" data-phone={local.phone ? "" : undefined} />;
}
export const TermOverflow = (props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class">) => <div {...props} class="ui-term-overflow" />;
export const TermActionLabel = (props: { children: JSX.Element }) => <span class="ui-term-action-label">{props.children}</span>;
export function TermState(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> & { empty?: boolean }) {
  const [local, rest] = splitProps(props, ["empty"]);
  return <div {...rest} class="ui-term-state" data-empty={local.empty ? "" : undefined} />;
}
export function TermKeys(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "onMouseDown">) {
  return <div role="toolbar" data-mobile-swipe-ignore="" {...props} class="ui-term-keys" onMouseDown={(event) => event.preventDefault()} />;
}

export function TermKey(props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "onClick"> & { armed?: boolean; onClick: () => void }) {
  const [local, rest] = splitProps(props, ["armed", "onClick"]);
  return <button type="button" {...rest} class="ui-term-key" aria-pressed={local.armed === undefined ? undefined : local.armed}
    onClick={() => { haptic("press"); local.onClick(); }} />;
}

