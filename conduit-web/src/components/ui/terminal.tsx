import { onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";
import { Button, Spinner } from "./controls";
import { haptic } from "./haptics";

/** What a header folds when it is too narrow, first to last: the shortcuts into the ⋯, then the actions' labels. */
const TERM_FOLDS = ["shortcuts", "labels"] as const;

/** A terminal's header: leading controls, identity, shortcuts, overflow, then actions. It folds by measure: while
 *  its content overflows or the identity's title or context is cut, the next fold goes; each comes back once the header is as wide as it
 *  was needed at. A change to what it holds (a shortcut, the running command) measures it again from unfolded. */
export function TermHeader(props: Omit<JSX.HTMLAttributes<HTMLElement>, "class"> & { actions?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["children", "actions"]);
  let header!: HTMLElement;
  onMount(() => {
    let folds = 0;
    const needs: number[] = [];
    const set = (count: number) => { folds = count; if (count) header.dataset.folded = TERM_FOLDS.slice(0, count).join(" "); else delete header.dataset.folded; };
    const over = () => {
      // The identity's title and context truncate rather than overflow: what they cut is what is missing.
      const parts = [...header.querySelectorAll<HTMLElement>(".ui-term-identity > *")];
      return Math.max(header.scrollWidth - header.clientWidth, parts.reduce((cut, part) => cut + Math.max(0, part.scrollWidth - part.clientWidth), 0));
    };
    const fit = (fresh = false) => {
      if (!header.clientWidth) return;
      if (fresh) set(0);
      while (folds && header.clientWidth >= needs[folds - 1]!) set(folds - 1);
      for (let cut = over(); cut > 0.5 && folds < TERM_FOLDS.length; cut = over()) { needs[folds] = header.clientWidth + cut; set(folds + 1); }
    };
    const resize = new ResizeObserver(() => fit());
    const content = new MutationObserver(() => fit(true));
    resize.observe(header);
    content.observe(header, { childList: true, subtree: true, characterData: true });
    fit(true);
    onCleanup(() => { resize.disconnect(); content.disconnect(); });
  });
  return <header ref={header} data-surface="ground" {...rest} class="ui-term-header">{local.children}{local.actions}</header>;
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

