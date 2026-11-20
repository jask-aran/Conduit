import { Extension, type Editor } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { createSignal, Show, type Accessor } from "solid-js";
import { blockAtY, FIRST, numbers } from "./numbers";
import { probeEditor } from "./read";
import { DocumentFind, documentDrawClass } from "@/components/ui/document";
import { PAPER_REPLACE_KEY } from "./shortcuts";

/** `from`..`to`: the top-level blocks whose matches are drawn, the ones numbered round the view (numbers.ts); the current match is drawn wherever it is. */
type Match = { from: number; to: number; block: number };
type Found = { query: string; current: number; matches: Match[]; from: number; to: number; drawn: DecorationSet };
const found = new PluginKey<Found>("find");
const search = (doc: Node, query: string) => {
  const matches: Match[] = [], wanted = query.toLowerCase();
  if (!wanted) return matches;
  const look = (node: Node, pos: number, block: number) => {
    // One character for each inline node that is not text, so an offset in the text is an offset in the block.
    const text = node.textBetween(0, node.content.size, undefined, "￼").toLowerCase();
    for (let at = text.indexOf(wanted); at >= 0; at = text.indexOf(wanted, at + wanted.length)) matches.push({ from: pos + 1 + at, to: pos + 1 + at + wanted.length, block });
  };
  doc.forEach((top, at, block) => { if (top.isTextblock) look(top, at, block); else top.descendants((node, pos) => { if (!node.isTextblock) return true; look(node, at + 1 + pos, block); return false; }); });
  return matches;
};
// Every match drawn would redraw every block holding one at each letter typed into the query, and lay them all out.
const draw = (doc: Node, matches: Match[], current: number, from: number, to: number) =>
  DecorationSet.create(doc, matches.flatMap((match, nth) => nth === current ? [Decoration.inline(match.from, match.to, { class: `${documentDrawClass.match} ${documentDrawClass.currentMatch}` })] : match.block >= from && match.block <= to ? [Decoration.inline(match.from, match.to, { class: documentDrawClass.match })] : []));

/**
 * Find in the text: Mod-F while the editor has focus opens the bar (DocumentFind), the selected text its query; each match is drawn, the current one
 * apart, and kept in view. Enter and Shift+Enter step, Escape shuts it and gives the text its focus back. Mod-H opens it with its replace row. `scroller` is the view the text scrolls in.
 */
export function createFind(editor: Accessor<Editor | undefined>, scroller: Accessor<HTMLElement | undefined>) {
  const [open, setOpen] = createSignal(false), [replacing, setReplacing] = createSignal(false), [replacement, setReplacement] = createSignal("");
  let field: HTMLInputElement | undefined, replaceField: HTMLInputElement | undefined;
  const state = probeEditor(editor, (made) => made ? found.getState(made.state) : undefined);
  const set = (change: { query?: string; current?: number }) => { const view = editor()?.view; if (view) view.dispatch(view.state.tr.setMeta(found, change)); };
  /** The blocks wholly in view, read before a change is drawn, while the text is laid out already. */
  const seen = () => { const view = editor()?.view, box = scroller()?.getBoundingClientRect(); return view && box ? [blockAtY(view, box.top) + 1, blockAtY(view, box.bottom) - 1] as const : null; };
  /** The current match brought into view; measured only where it is not in a block wholly in view (`was`, from before the change), which saves laying the paper out at each letter typed. */
  const inView = (was = seen()) => {
    const view = editor()?.view, now = state(), match = now?.matches[now.current];
    if (!view || !match || (was && match.block >= was[0] && match.block <= was[1])) return;
    const at = view.coordsAtPos(match.from), box = scroller()!.getBoundingClientRect();
    if (at.top < box.top || at.bottom > box.bottom) scroller()!.scrollBy({ top: at.top - box.top - box.height / 3 });
  };
  const step = (by: 1 | -1) => { const now = state(); if (!now?.matches.length) return; const was = seen(); set({ current: (now.current + by + now.matches.length) % now.matches.length }); inView(was); };
  const show = (replace = false) => {
    const made = editor();
    if (!made) return;
    const { from, to, empty } = made.state.selection, picked = empty ? "" : made.state.doc.textBetween(from, to, " ");
    if (picked && !picked.includes("\n")) set({ query: picked, current: 0 });
    setOpen(true);
    if (replace) setReplacing(made.isEditable);
    // To the replace field where there is something to replace already, else to find's.
    queueMicrotask(() => { const into = replace && found.getState(made.state)?.query ? replaceField : field; into?.focus(); into?.select(); inView(); });
  };
  // The current match, or every one (last first, so each is where it was found), written as the replacement in one change; then the next match after it is current.
  const replace = (every: boolean) => {
    const view = editor()?.view, now = view && found.getState(view.state), text = replacement();
    if (!view?.editable || !now?.matches.length) return;
    const tr = view.state.tr, chosen = every ? [...now.matches].reverse() : [now.matches[now.current]!];
    for (const match of chosen) if (text) tr.insertText(text, match.from, match.to); else tr.delete(match.from, match.to);
    const was = seen();
    view.dispatch(tr);
    const after = chosen.at(-1)!.from + text.length, next = found.getState(view.state)!.matches.findIndex((match) => match.from >= after);
    set({ current: Math.max(0, next) });
    inView(was);
  };
  // In the bar's own fields too: Mod-H shows the replace row, Mod-F goes back to find's field (the browser has both chords otherwise).
  const barKeys = (element: HTMLInputElement) => element.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (!(event.ctrlKey || event.metaKey) || event.altKey || (event.shiftKey && key !== "h") || (key !== "f" && key !== "h")) return;
    event.preventDefault();
    if (key === "h" && editor()?.isEditable) setReplacing(true);
    queueMicrotask(() => (key === "f" ? field : replaceField)?.focus());
  });
  const close = () => { setOpen(false); setReplacing(false); set({ query: "", current: 0 }); editor()?.commands.focus(); };
  const count = () => { const now = state(); return now?.query ? now.matches.length ? `${now.current + 1} of ${now.matches.length}` : "No matches" : undefined; };
  return {
    show,
    extension: () => Extension.create({
      name: "find",
      addKeyboardShortcuts: () => ({ "Mod-f": () => { show(); return true; }, [PAPER_REPLACE_KEY]: () => { show(true); return true; }, "Mod-Shift-h": () => { show(true); return true; } }),
      addProseMirrorPlugins: () => [new Plugin<Found>({
        key: found,
        state: {
          init: () => ({ query: "", current: 0, matches: [], from: 0, to: FIRST, drawn: DecorationSet.empty }),
          apply: (tr, old) => {
            const change = tr.getMeta(found) as { query?: string; current?: number } | undefined, moved = tr.getMeta(numbers) as { from: number; to: number } | undefined, { from, to } = moved ?? old;
            // With nothing asked, the text changing finds nothing new: the state is kept, and what reads it is not told.
            if (!change && (!(tr.docChanged || moved) || !old.query)) return moved ? { ...old, from, to } : old;
            const query = change?.query ?? old.query, matches = tr.docChanged || change?.query !== undefined ? search(tr.doc, query) : old.matches;
            const current = Math.min(change?.current ?? old.current, Math.max(0, matches.length - 1));
            return { query, current, matches, from, to, drawn: draw(tr.doc, matches, current, from, to) };
          },
        },
        props: { decorations: (state) => found.getState(state)?.drawn },
      })],
    }),
    view: () => <Show when={open()}>
      <DocumentFind query={state()?.query ?? ""} count={count()} inputRef={(element) => { field = element; barKeys(element); }} onQuery={(query) => { const was = seen(); set({ query, current: 0 }); inView(was); }}
        onNext={() => step(1)} onPrevious={() => step(-1)} onEscape={close} onClose={close}
        onReplacing={editor()?.isEditable ? () => { const on = !replacing(); setReplacing(on); queueMicrotask(() => (on ? replaceField : field)?.focus()); } : undefined}
        replace={replacing() ? { value: replacement(), onValue: setReplacement, onReplace: () => replace(false), onReplaceAll: () => replace(true), inputRef: (element) => { replaceField = element; barKeys(element); } } : undefined} />
    </Show>,
  };
}
