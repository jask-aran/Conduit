import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { blockStarts, redrawBlocks } from "./blocks";

/** The top-level blocks numbered now (indexes `from` to `to`), round those in view. */
type Numbers = { from: number; to: number; set: DecorationSet };
const numbers = new PluginKey<Numbers>("numbers");
// How many blocks are numbered as a paper opens, before it is looked at; and the fewest a view is taken to hold.
const FIRST = 80, LEAST = 12;
const starts = new WeakMap<Node, number[]>();
const startsOf = (doc: Node) => starts.get(doc) ?? starts.set(doc, blockStarts(doc)).get(doc)!;
const label = (block: Node, at: number, index: number) => Decoration.node(at, at + block.nodeSize, { "data-n": String(index + 1) });
const draw = (doc: Node, from: number, to: number): Numbers => {
  const at = startsOf(doc), found: Decoration[] = [];
  for (let index = Math.max(0, from); index <= Math.min(to, at.length - 1); index++) found.push(label(doc.child(index), at[index]!, index));
  return { from, to, set: DecorationSet.create(doc, found) };
};
/** The first top-level block whose bottom is below `y` (viewport pixels). */
const blockAtY = (view: EditorView, y: number) => {
  const at = startsOf(view.state.doc);
  let low = 0, high = at.length - 1;
  while (low < high) { const mid = (low + high) >> 1, box = (view.nodeDOM(at[mid]!) as Element | null)?.getBoundingClientRect(); if (!box || box.bottom < y) low = mid + 1; else high = mid; }
  return low;
};

/**
 * Each block's number in the sheet's gutter (`data-n`, which the stylesheet draws). Only the blocks round the view are numbered, a view's worth and
 * more each way, numbered again as it scrolls near the edge of them: a block put in renumbers every block under it, which numbered all through the
 * paper (as CSS counters number it) costs a layout of every number at each Enter. `scroller`: the view the text scrolls in.
 */
export const numbered = (scroller: () => HTMLElement | undefined) => Extension.create({
  name: "blockNumbers",
  addProseMirrorPlugins: () => [new Plugin<Numbers>({
    key: numbers,
    state: {
      init: (_, state) => draw(state.doc, 0, FIRST),
      apply: (tr, old, was, state) => {
        const asked = tr.getMeta(numbers) as { from: number; to: number } | undefined;
        if (asked) return draw(state.doc, asked.from, asked.to);
        if (!tr.docChanged) return old;
        if (was.doc.childCount !== state.doc.childCount) return draw(state.doc, old.from, old.to);
        const set = redrawBlocks(old.set, was.doc, state.doc, (block, at, index) => index >= old.from && index <= old.to ? [label(block, at, index)] : []);
        return { ...old, set };
      },
    },
    props: { decorations: (state) => numbers.getState(state)!.set },
    view: (view) => {
      let frame = 0;
      const look = () => {
        frame = 0;
        const box = scroller()?.getBoundingClientRect(), count = view.state.doc.childCount;
        if (view.isDestroyed || !box || !count) return;
        const first = blockAtY(view, box.top), last = blockAtY(view, box.bottom), span = Math.max(LEAST, last - first + 1), { from, to } = numbers.getState(view.state)!;
        if ((from > 0 && first - span < from) || (to < count - 1 && last + span > to)) view.dispatch(view.state.tr.setMeta(numbers, { from: first - 2 * span, to: last + 2 * span }));
      };
      const soon = () => { frame ||= requestAnimationFrame(look); };
      const element = scroller();
      element?.addEventListener("scroll", soon, { passive: true });
      addEventListener("resize", soon);
      soon();
      return {
        update: (_, before) => { if (before.doc.childCount !== view.state.doc.childCount) soon(); },
        destroy: () => { cancelAnimationFrame(frame); element?.removeEventListener("scroll", soon); removeEventListener("resize", soon); },
      };
    },
  })],
});
