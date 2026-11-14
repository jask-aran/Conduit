import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js";
import type { Doc } from "yjs";
import { DocumentField, DocumentHead, DocumentProperty, DocumentTitle } from "@/components/ui/document";
import { PROPERTIES } from "@/document-format.js";

/**
 * Over the text: the paper's name as its title, renamed in place when `onRename` is given (Enter or leaving it; refused, the name it had comes
 * back), and its properties, the Yjs document's PROPERTIES map, each written there as it is typed so it merges as the text does. A property
 * whose value is cleared goes as its field is left. `onDown`: Enter or ArrowDown in the title, which go on to the text.
 */
export function PaperHead(props: { /** Whether it holds properties (DocumentHost.holds): a plain Markdown file's head is its title alone. */ properties?: boolean; doc: Doc; name: string; onRename?: (name: string) => Promise<unknown> | void; onDown: () => void }) {
  const map = props.doc.getMap<string>(PROPERTIES), [values, setValues] = createSignal(map.toJSON() as Record<string, string>);
  const redraw = () => setValues(map.toJSON());
  map.observe(redraw);
  onCleanup(() => map.unobserve(redraw));
  // Keyed by name, so a row being typed in is never drawn anew under the caret.
  const names = createMemo(() => props.properties === false ? [] : Object.keys(values()));
  const [draft, setDraft] = createSignal<string>(), [adding, setAdding] = createSignal<{ name?: string } | null>(null);
  createEffect(on(() => props.name, () => setDraft(undefined), { defer: true }));
  const rename = async (field: HTMLInputElement) => {
    const next = field.value.trim(), back = () => { setDraft(undefined); field.value = props.name; };
    if (!next || next === props.name) return back();
    try { await props.onRename?.(next); } catch { back(); }
  };
  const added = (name: string, value: string) => { if (value.trim()) map.set(name, value.trim()); setAdding(null); };
  const focus = (field: HTMLInputElement) => queueMicrotask(() => field.focus());
  return <DocumentHead add={adding() ? undefined : { label: "Add a property", onClick: () => setAdding({}) }}>
    <DocumentTitle editable={Boolean(props.onRename)} aria-label="Name" value={draft() ?? props.name} onInput={(event) => setDraft(event.currentTarget.value)} onBlur={(event) => void rename(event.currentTarget)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === "ArrowDown") { event.preventDefault(); props.onDown(); }
        else if (event.key === "Escape") { setDraft(undefined); event.currentTarget.value = props.name; event.currentTarget.blur(); }
      }} />
    <For each={names()}>{(name) => <DocumentProperty name={name}>
      <DocumentField aria-label={name} value={values()[name] ?? ""} onInput={(event) => map.set(name, event.currentTarget.value)} onBlur={(event) => { if (!event.currentTarget.value.trim()) map.delete(name); }} />
    </DocumentProperty>}</For>
    <Show when={adding()}>{(now) => <Show when={now().name} fallback={
      <DocumentProperty name={<DocumentField ref={focus} aria-label="Property name" placeholder="Name" onBlur={() => { if (adding() && !adding()!.name) setAdding(null); }}
        onKeyDown={(event) => { const name = event.currentTarget.value.trim(); if (event.key === "Escape") setAdding(null); else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); setAdding(name ? { name } : null); } }} />}><span /></DocumentProperty>}>
      {(name) => <DocumentProperty name={name()}>
        <DocumentField ref={focus} aria-label={name()} placeholder="Value" onBlur={(event) => added(name(), event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === "Escape") setAdding(null); else if (event.key === "Enter") added(name(), event.currentTarget.value); }} />
      </DocumentProperty>}
    </Show>}</Show>
  </DocumentHead>;
}
