import * as Icons from "./icons";
import { Show } from "solid-js";
import { Frost } from "./frost";
import { LeadInput } from "./controls";
import { CloseButton, IconButton } from "./actions";

/**
 * FindBar: a pane's find, floating over the top of what it searches (a chat's transcript, under its header): a search
 * field (LeadInput, its × clearing the query), the count ("3 of 12", "No results"), Previous, Next and Close. Frost,
 * as floating chrome inside a pane is. It rises in as it opens; the caller mounts it while open and owns the search:
 * Enter is Next and Shift+Enter Previous, Escape clears the query and then closes (the Escape ladder), all through
 * onKeyDown's caller-side handlers.
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
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); if (event.shiftKey) props.onPrevious(); else props.onNext(); return; }
    // Its own rungs of the ladder: the app's Escape (to the composer) must not also run.
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); props.onEscape(); }
  };
  // The buttons leave the caret in the field, so Enter keeps stepping after a click.
  const keep = (event: MouseEvent) => event.preventDefault();
  return <Frost class="ui-find-bar" role="search" aria-label={props.label ?? "Find in chat"} lift="raised">
    <LeadInput kind="tool" ref={props.inputRef} value={props.query} placeholder={props.label ?? "Find in chat"} aria-label={props.label ?? "Find in chat"}
      onInput={(event) => props.onQuery(event.currentTarget.value)} onKeyDown={onKeyDown} onClear={() => props.onQuery("")} />
    <Show when={props.count}><span class="ui-find-count" aria-live="polite">{props.count}</span></Show>
    <IconButton kind="tool" label="Previous match (Shift+Enter)" onMouseDown={keep} onClick={() => props.onPrevious()}><Icons.ArrowUp /></IconButton>
    <IconButton kind="tool" label="Next match (Enter)" onMouseDown={keep} onClick={() => props.onNext()}><Icons.ArrowDown /></IconButton>
    <CloseButton kind="tool" label="Close find (Escape)" onClick={() => props.onClose()} />
  </Frost>;
}
