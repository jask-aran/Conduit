import * as Icons from "./icons";
import { Show, type JSX } from "solid-js";
import { Frost } from "./frost";
import { LeadInput } from "./controls";
import { CloseButton, IconButton } from "./actions";

/**
 * FindBar: a pane's find, frost floating over the top of what it searches: a LeadInput, the count ("3 of 12"),
 * Previous, Next, Close. The caller mounts it while open and owns the search; Enter is Next, Shift+Enter Previous,
 * Escape clears then closes (the Escape ladder). children: more after the field (the editor's replace and toggles);
 * plain: drawn in its host's row (CodeMirror's panel).
 */
export function FindBar(props: {
  query: string;
  count?: string;
  label?: string;
  onQuery: (value: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onEscape: () => void;
  onClose: () => void;
  inputRef?: (element: HTMLInputElement) => void;
  plain?: boolean;
  children?: JSX.Element;
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); if (event.shiftKey) props.onPrevious(); else props.onNext(); return; }
    // Its own rungs of the ladder: the app's Escape (to the composer) must not also run.
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.onEscape(); }
  };
  // The buttons leave the caret in the field, so Enter keeps stepping after a click.
  const keep = (event: MouseEvent) => event.preventDefault();
  return <Frost class="ui-find-bar" role="search" aria-label={props.label ?? "Find in chat"} lift="raised" plain={props.plain}>
    <LeadInput kind="tool" ref={props.inputRef} value={props.query} placeholder={props.label ?? "Find in chat"} aria-label={props.label ?? "Find in chat"}
      onInput={(event) => props.onQuery(event.currentTarget.value)} onKeyDown={onKeyDown} onClear={() => props.onQuery("")} />
    {props.children}
    <Show when={props.count}><small class="ui-count ui-find-count" aria-live="polite">{props.count}</small></Show>
    <IconButton kind="tool" label="Previous match (Shift+Enter)" onMouseDown={keep} onClick={() => props.onPrevious()}><Icons.ArrowUp /></IconButton>
    <IconButton kind="tool" label="Next match (Enter)" onMouseDown={keep} onClick={() => props.onNext()}><Icons.ArrowDown /></IconButton>
    <CloseButton kind="tool" label="Close find (Escape)" onClick={() => props.onClose()} />
  </Frost>;
}
