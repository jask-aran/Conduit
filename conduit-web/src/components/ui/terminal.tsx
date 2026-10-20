import { Show, splitProps, type JSX } from "solid-js";
import { Button, Spinner } from "./controls";

/** A terminal's header: leading controls, identity, shortcuts, overflow, then divided actions. */
export function TermHeader(props: Omit<JSX.HTMLAttributes<HTMLElement>, "class"> & { actions?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["children", "actions"]);
  return <header {...rest} class="ui-term-header">{local.children}<span class="ui-term-divider" aria-hidden="true" />{local.actions}</header>;
}
/** A terminal's state: a dot or busy ring, with a label when needed. */
export function TermStatus(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> & { tone: "success" | "busy" | "warn" | "danger" | "muted"; busy?: boolean; label?: string }) {
  const [local, rest] = splitProps(props, ["tone", "busy", "label"]);
  return <div role="status" {...rest} class="ui-term-status" data-tone={local.tone} data-busy={local.busy ? "" : undefined}>
    <div class="ui-term-status-mark" aria-hidden="true"><Show when={local.busy} fallback={<i />}><Spinner /></Show></div>
    <Show when={local.label}><small>{local.label}</small></Show>
  </div>;
}
/** Status, a strong title and muted context, followed by the caller's controls. */
export function TermIdentity(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class">) {
  return <div {...props} class="ui-term-identity" />;
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
export function TermActions(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class">) {
  return <div {...props} class="ui-term-actions" />;
}
/** A focus action's label, hidden on narrow screens. */
export const TermActionLabel = (props: { children: JSX.Element }) => <span class="ui-term-action-label">{props.children}</span>;
/** A centred empty or recovery state; the caller supplies icon, text and actions. */
export function TermState(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class"> & { empty?: boolean }) {
  const [local, rest] = splitProps(props, ["empty"]);
  return <div {...rest} class="ui-term-state" data-empty={local.empty ? "" : undefined} />;
}
/** An error above the terminal's lower corner. */
export function TermError(props: Omit<JSX.HTMLAttributes<HTMLParagraphElement>, "class">) {
  return <p role="alert" {...props} class="ui-term-error" />;
}
/** A shortcut editor; submit and keyboard handling remain with the caller. */
export const ShortcutForm = (props: Omit<JSX.FormHTMLAttributes<HTMLFormElement>, "class">) => <form {...props} class="ui-term-shortcut-form" />;
/** The shortcut's name and target on one line. */
export const ShortcutFormLine = (props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class">) => <div {...props} class="ui-term-shortcut-form-line" />;
/** The shortcut's shell choices, with caller supplied pressed states. */
export const ShortcutTarget = (props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class">) => <div {...props} class="ui-term-shortcut-target" />;
/** A command field with its shell prompt. */
export const ShortcutCommand = (props: Omit<JSX.LabelHTMLAttributes<HTMLLabelElement>, "class">) => <label {...props} class="ui-term-shortcut-command" />;
/** The on-start choice and the editor's save and cancel controls. */
export const ShortcutFormActions = (props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "class">) => <div {...props} class="ui-term-shortcut-form-actions" />;
