import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** The top-level block at or around a position: where it starts, or null between none. */
export const blockAt = (doc: Node, pos: number) => {
  const $pos = doc.resolve(Math.max(0, Math.min(pos, doc.content.size)));
  if ($pos.depth) return $pos.before(1);
  return $pos.nodeAfter ? pos : $pos.nodeBefore ? pos - $pos.nodeBefore.nodeSize : null;
};
/** Where each top-level block starts, in order. */
export const blockStarts = (doc: Node) => { const starts: number[] = []; doc.forEach((_, at) => starts.push(at)); return starts; };
export const caretBlockAt = (view: EditorView) => { const { $from, from } = view.state.selection; return $from.depth ? $from.before(1) : view.state.doc.nodeAt(from) ? from : null; };

/**
 * Moves the block starting at `from` to `to` (a gap between top-level blocks, in the document as it is), in one transaction. The node itself
 * moves, ids and all: UniqueID gives a node a new id only when it is new and its id is held twice in what changed, and a moved block is held once.
 * A caret inside it goes with it.
 */
export const moveBlock = (view: EditorView, from: number, to: number) => {
  const { state } = view, node = state.doc.nodeAt(from);
  if (!node || to === from || to === from + node.nodeSize) return;
  const { selection } = state, { anchor, head } = selection, inside = (pos: number) => pos > from && pos < from + node.nodeSize;
  const tr = state.tr.delete(from, from + node.nodeSize), at = tr.mapping.map(to);
  tr.insert(at, node);
  if (selection instanceof TextSelection && inside(anchor) && inside(head)) tr.setSelection(TextSelection.create(tr.doc, at + anchor - from, at + head - from));
  view.dispatch(tr.scrollIntoView());
};
/** Up or down by one block. */
export const shiftBlock = (view: EditorView, from: number, by: -1 | 1) => {
  const starts = blockStarts(view.state.doc), nth = starts.indexOf(from);
  if (nth < 0 || nth + by < 0 || nth + by >= starts.length) return false;
  moveBlock(view, from, by < 0 ? starts[nth - 1]! : (starts[nth + 2] ?? view.state.doc.content.size));
  return true;
};

// A copy with no ids, at any depth: the copy's ids are its own, given as it is written, never its original's.
const unnamed = (json: Record<string, unknown>): Record<string, unknown> => ({ ...json, ...(json.attrs ? { attrs: { ...json.attrs as object, id: null } } : {}), ...(Array.isArray(json.content) ? { content: json.content.map(unnamed) } : {}) });
export const duplicateBlock = (view: EditorView, from: number) => {
  const { state } = view, node = state.doc.nodeAt(from);
  if (node) view.dispatch(state.tr.insert(from + node.nodeSize, state.schema.nodeFromJSON(unnamed(node.toJSON()))).scrollIntoView());
};
export const deleteBlock = (view: EditorView, from: number) => {
  const node = view.state.doc.nodeAt(from);
  if (node) view.dispatch(view.state.tr.delete(from, from + node.nodeSize));
};
/** The caret into a block, so a command on the caret's block acts on it. */
export const caretInto = (view: EditorView, from: number) => view.dispatch(view.state.tr.setSelection(Selection.near(view.state.doc.resolve(from + 1))));
/** An empty paragraph under a block, the caret in it with `/` typed, so the block kinds are offered as when one types it. */
export const addUnder = (view: EditorView, from: number) => {
  const { state } = view, node = state.doc.nodeAt(from);
  if (!node) return;
  const at = from + node.nodeSize, tr = state.tr.insert(at, state.schema.nodes.paragraph!.create(null, state.schema.text("/")));
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, at + 2)).scrollIntoView());
  view.focus();
};
/** A block as it is drawn, for what asks about it. */
export const blockRange = (view: EditorView, from: number) => { const block = view.nodeDOM(from); if (!block) return null; const range = document.createRange(); range.selectNodeContents(block); return range; };

export const blockKeys = Extension.create({
  name: "blockKeys",
  addKeyboardShortcuts() {
    const shift = (by: -1 | 1) => () => { const from = caretBlockAt(this.editor.view); return from !== null && shiftBlock(this.editor.view, from, by); };
    return { "Alt-Shift-ArrowUp": shift(-1), "Alt-Shift-ArrowDown": shift(1) };
  },
});
