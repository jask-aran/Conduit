import type { Editor } from "@tiptap/core";
import { Mark } from "@tiptap/pm/model";
import { TextSelection, type EditorState } from "@tiptap/pm/state";
import { batch, createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js";

/**
 * What a read of the editor depends on. "doc": the text. "selection": where the selection is, which the text moves. "caret": the blocks the caret is
 * in (kind, attributes, place), the marks it wears and the marks stored for it, focus, and whether the text can be written in; a selection that is not
 * a caret changes it at any change. Typing in one block changes the first two and not the caret.
 */
export type EditorFacet = "doc" | "selection" | "caret";

// The caret is in the same blocks wearing the same marks: a node's attributes are kept by the node that copies it with new text.
const sameCaret = (was: EditorState, now: EditorState) => {
  const a = was.selection, b = now.selection;
  if (!(a instanceof TextSelection && b instanceof TextSelection && a.empty && b.empty)) return false;
  const $a = a.$from, $b = b.$from;
  if ($a.depth !== $b.depth) return false;
  for (let depth = 1; depth <= $b.depth; depth++) {
    const x = $a.node(depth), y = $b.node(depth);
    if (x.type !== y.type || x.attrs !== y.attrs || $a.start(depth) !== $b.start(depth)) return false;
  }
  return Mark.sameSet($a.marks(), $b.marks());
};

type Watch = { track: Record<EditorFacet, () => void>; probes: Set<() => void> };
const watches = new WeakMap<Editor, Watch>();
/**
 * One check for each editor, once after the frame that drew its transactions is painted, however many there were: it says which facets changed, and
 * only what reads those runs. A keystroke is a transaction, and none of this is the text: read inside it, it is time between the key and the letter.
 */
const watchOf = (made: Editor) => {
  const had = watches.get(made);
  if (had) return had;
  const [doc, docMoved] = createSignal(undefined, { equals: false }), [selection, selectionMoved] = createSignal(undefined, { equals: false }), [caret, caretMoved] = createSignal(undefined, { equals: false });
  const watch: Watch = { track: { doc, selection, caret }, probes: new Set() };
  let was = made.state, focused = made.isFocused, editable = made.isEditable, frame = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    frame = 0;
    if (made.isDestroyed) return;
    const now = made.state, docChanged = now.doc !== was.doc, selectionChanged = docChanged || !now.selection.eq(was.selection);
    const caretChanged = (selectionChanged && !sameCaret(was, now)) || now.storedMarks !== was.storedMarks || focused !== made.isFocused || editable !== made.isEditable;
    was = now; focused = made.isFocused; editable = made.isEditable;
    batch(() => {
      if (docChanged) docMoved();
      if (selectionChanged) selectionMoved();
      if (caretChanged) caretMoved();
      for (const probe of watch.probes) probe();
    });
  };
  made.on("transaction", () => { if (!frame) frame = requestAnimationFrame(() => { timer = setTimeout(check); }); });
  made.on("destroy", () => { cancelAnimationFrame(frame); clearTimeout(timer); });
  watches.set(made, watch);
  return watch;
};

/** Makes what is being computed run again when this facet of the editor changes. */
export const track = (made: Editor | undefined, on: EditorFacet) => { if (made) watchOf(made).track[on](); };
/** What is read from the editor for what stands around the text (a bar's pressed tools, the handle, a count), read again when `on` changes. */
export const readEditor = <T>(editor: Accessor<Editor | undefined>, on: EditorFacet, read: (made: Editor | undefined) => T, equals?: (a: T, b: T) => boolean): Accessor<T> =>
  createMemo(() => { const made = editor(); track(made, on); return read(made); }, undefined, equals ? { equals } : undefined);
/** A read cheap enough to make in each check itself (a plugin's state, whether there is a step to undo), told on only when it is not what it was. */
export const probeEditor = <T>(editor: Accessor<Editor | undefined>, read: (made: Editor | undefined) => T): Accessor<T> => {
  const [value, setValue] = createSignal<T>(read(untrack(editor)));
  createEffect(() => {
    const made = editor(), probe = () => setValue(() => read(made));
    probe();
    if (!made) return;
    const { probes } = watchOf(made);
    probes.add(probe);
    onCleanup(() => probes.delete(probe));
  });
  return value;
};
export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Whether the selection is in a node or wears a mark of this name. For a caret it is read from the state itself: the editor's own isActive walks the document's nodes for each name asked, and a keystroke asks for a dozen. */
export const isOn = (made: Editor | undefined, name: string, attrs?: Record<string, unknown>) => {
  if (!made) return false;
  const { selection, storedMarks, schema } = made.state;
  if (!selection.empty) return made.isActive(name, attrs);
  const { $from } = selection;
  if (schema.marks[name]) return (storedMarks ?? $from.marks()).some((mark) => mark.type.name === name);
  for (let depth = $from.depth; depth > 0; depth--) { const node = $from.node(depth); if (node.type.name === name && (!attrs || Object.entries(attrs).every(([key, value]) => node.attrs[key] === value))) return true; }
  return false;
};
/** The attributes of the mark of this name the selection wears, a caret's read as `isOn` reads it. */
export const markAttrs = (made: Editor | undefined, name: string): Record<string, unknown> => {
  if (!made) return {};
  const { selection, storedMarks } = made.state;
  return selection.empty ? [...(storedMarks ?? []), ...selection.$head.marks()].find((mark) => mark.type.name === name)?.attrs ?? {} : made.getAttributes(name);
};
