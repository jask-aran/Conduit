import { Extension, type Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createSignal, Show, type Accessor } from "solid-js";
import { createEditorTransaction } from "solid-tiptap";
import { DocumentFind, documentDrawClass } from "@/components/ui/document";

type Found = { query: string; current: number; matches: { from: number; to: number }[]; drawn: DecorationSet };
const found = new PluginKey<Found>("find");
const search = (doc: Node, query: string) => {
  const matches: Found["matches"] = [], wanted = query.toLowerCase();
  if (!wanted) return matches;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // One character for each inline node that is not text, so an offset in the text is an offset in the block.
    const text = node.textBetween(0, node.content.size, undefined, "￼").toLowerCase();
    for (let at = text.indexOf(wanted); at >= 0; at = text.indexOf(wanted, at + wanted.length)) matches.push({ from: pos + 1 + at, to: pos + 1 + at + wanted.length });
    return false;
  });
  return matches;
};
const draw = (doc: Node, matches: Found["matches"], current: number) =>
  DecorationSet.create(doc, matches.map((match, nth) => Decoration.inline(match.from, match.to, { class: nth === current ? `${documentDrawClass.match} ${documentDrawClass.currentMatch}` : documentDrawClass.match })));

/**
 * Find in the text: Mod-F while the editor has focus opens the bar (DocumentFind), the selected text its query; each match is drawn, the current one
 * apart, and kept in view. Enter and Shift+Enter step, Escape shuts it and gives the text its focus back. `scroller` is the view the text scrolls in.
 */
export function createFind(editor: Accessor<Editor | undefined>, scroller: Accessor<HTMLElement | undefined>) {
  const [open, setOpen] = createSignal(false);
  let field: HTMLInputElement | undefined;
  const state = createEditorTransaction(editor, (made) => made ? found.getState(made.state) : undefined);
  const set = (change: { query?: string; current?: number }) => { const view = editor()?.view; if (view) view.dispatch(view.state.tr.setMeta(found, change)); };
  const inView = () => {
    const view = editor()?.view, now = state(), match = now?.matches[now.current], box = scroller()?.getBoundingClientRect();
    if (!view || !match || !box) return;
    const at = view.coordsAtPos(match.from);
    if (at.top < box.top || at.bottom > box.bottom) scroller()!.scrollBy({ top: at.top - box.top - box.height / 3 });
  };
  const step = (by: 1 | -1) => { const now = state(); if (!now?.matches.length) return; set({ current: (now.current + by + now.matches.length) % now.matches.length }); inView(); };
  const show = () => {
    const made = editor();
    if (!made) return;
    const { from, to, empty } = made.state.selection, picked = empty ? "" : made.state.doc.textBetween(from, to, " ");
    if (picked && !picked.includes("\n")) set({ query: picked, current: 0 });
    setOpen(true);
    queueMicrotask(() => { field?.focus(); field?.select(); inView(); });
  };
  const close = () => { setOpen(false); set({ query: "", current: 0 }); editor()?.commands.focus(); };
  const count = () => { const now = state(); return now?.query ? now.matches.length ? `${now.current + 1} of ${now.matches.length}` : "No matches" : undefined; };
  return {
    show,
    extension: () => Extension.create({
      name: "find",
      addKeyboardShortcuts: () => ({ "Mod-f": () => { show(); return true; } }),
      addProseMirrorPlugins: () => [new Plugin<Found>({
        key: found,
        state: {
          init: () => ({ query: "", current: 0, matches: [], drawn: DecorationSet.empty }),
          apply: (tr, old) => {
            const change = tr.getMeta(found) as { query?: string; current?: number } | undefined;
            if (!change && !tr.docChanged) return old;
            const query = change?.query ?? old.query, matches = tr.docChanged || change?.query !== undefined ? search(tr.doc, query) : old.matches;
            const current = Math.min(change?.current ?? old.current, Math.max(0, matches.length - 1));
            return { query, current, matches, drawn: draw(tr.doc, matches, current) };
          },
        },
        props: { decorations: (state) => found.getState(state)?.drawn },
      })],
    }),
    view: () => <Show when={open()}>
      <DocumentFind query={state()?.query ?? ""} count={count()} inputRef={(element) => { field = element; }} onQuery={(query) => { set({ query, current: 0 }); inView(); }}
        onNext={() => step(1)} onPrevious={() => step(-1)} onEscape={close} onClose={close} />
    </Show>,
  };
}
