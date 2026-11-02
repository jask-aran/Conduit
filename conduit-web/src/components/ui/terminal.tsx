import { Show, splitProps, type JSX } from "solid-js";
import { Button, Spinner } from "./controls";
import { haptic } from "./haptics";
import * as Icons from "./icons";

/* A terminal's header is a PaneHeader (kind term, header.tsx), which folds it by measure. */
/** A terminal's state: a dot or busy ring, with a label when needed. */
export function TermStatus(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> & { tone: "success" | "busy" | "warn" | "danger" | "muted"; busy?: boolean; label?: string }) {
  const [local, rest] = splitProps(props, ["tone", "busy", "label"]);
  return <div role="status" {...rest} class="ui-term-status" data-tone={local.tone} data-busy={local.busy ? "" : undefined}>
    <div class="ui-term-status-mark" aria-hidden="true"><Show when={local.busy} fallback={<i />}><Spinner /></Show></div>
    <Show when={local.label}><small>{local.label}</small></Show>
  </div>;
}
/** Status, a strong title and muted context, followed by the caller's controls. end: what closes the line at its far
 *  end (a pane's own actions, when the terminal is a pane's document). */
/** onClose: the terminal is a pane's document, closed as any is -- a tab's ×, after its name (the pane stays, empty). */
export function TermIdentity(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> & { end?: JSX.Element; onClose?: () => void; closeLabel?: string }) {
  const [local, rest] = splitProps(props, ["children", "end", "onClose", "closeLabel"]);
  return <div {...rest} class="ui-term-identity">{local.children}
    <Show when={local.onClose}><button type="button" class="ui-term-close" aria-label={local.closeLabel ?? "Close terminal"} title={local.closeLabel ?? "Close terminal"} onClick={() => local.onClose?.()}><Icons.Close /></button></Show>
    <Show when={local.end}><span class="ui-term-identity-end">{local.end}</span></Show></div>;
}
/** A context line that truncates within the identity. */
export const TermContext = (props: { children: JSX.Element }) => <span class="ui-term-context">{props.children}</span>;
/** Inline shortcuts and their editor control. */
export function TermShortcuts(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class">) {
  return <div {...props} class="ui-term-shortcuts" />;
}
/** One command in the inline shortcut row. */
export const TermShortcut = (props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class">) => <Button variant="ghost" size="sm" {...props} />;
/** Header controls before the identity; phone controls appear for coarse pointers. */
export function TermLead(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> & { phone?: boolean }) {
  const [local, rest] = splitProps(props, ["phone"]);
  return <div {...rest} class="ui-term-lead" data-phone={local.phone ? "" : undefined} />;
}
/** The narrow header's shortcut menu container. */
export const TermOverflow = (props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class">) => <div {...props} class="ui-term-overflow" />;
/** The terminal's session and focus controls. */
/** A focus action's label, hidden on narrow screens. */
export const TermActionLabel = (props: { children: JSX.Element }) => <span class="ui-term-action-label">{props.children}</span>;
/** A centred empty or recovery state; the caller supplies icon, text and actions. */
export function TermState(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> & { empty?: boolean }) {
  const [local, rest] = splitProps(props, ["empty"]);
  return <div {...rest} class="ui-term-state" data-empty={local.empty ? "" : undefined} />;
}
/** An error above the terminal's lower corner. */
/** TermKeys: a phone's key bar under the terminal, the keys its keyboard lacks in one row that scrolls sideways. A tap
 *  on it never takes the focus from the terminal (so the keyboard stays up). */
export function TermKeys(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class" | "onMouseDown">) {
  return <div role="toolbar" data-mobile-swipe-ignore="" {...props} class="ui-term-keys" onMouseDown={(event) => event.preventDefault()} />;
}

/** TermKey: one key, Keycap's face at a finger's size; felt as it is pressed. armed: a modifier waiting for the next
 *  key (aria-pressed), ringed until it is used. */
export function TermKey(props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "class" | "onClick"> & { armed?: boolean; onClick: () => void }) {
  const [local, rest] = splitProps(props, ["armed", "onClick"]);
  return <button type="button" {...rest} class="ui-term-key" aria-pressed={local.armed === undefined ? undefined : local.armed}
    onClick={() => { haptic("press"); local.onClick(); }} />;
}

