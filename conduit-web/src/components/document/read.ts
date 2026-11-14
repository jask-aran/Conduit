import type { Editor } from "@tiptap/core";
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js";

/**
 * What is read from the editor for what stands around the text (a bar's pressed tools, the handle, a count): read once after the frame that drew
 * the transactions is painted, however many there were, and told on only when it changed. A keystroke is a transaction, and none of this is the
 * text: read inside it, it is time between the key and the letter.
 */
export const readEditor = <T>(editor: Accessor<Editor | undefined>, read: (made: Editor | undefined) => T, equals?: (a: T, b: T) => boolean): Accessor<T> => {
  const [drawn, setDrawn] = createSignal(0);
  let frame = 0, timer: ReturnType<typeof setTimeout> | undefined;
  const later = () => { if (frame) return; frame = requestAnimationFrame(() => { timer = setTimeout(() => { frame = 0; setDrawn((n) => n + 1); }); }); };
  createEffect(() => { const made = editor(); if (!made) return; made.on("transaction", later); onCleanup(() => made.off("transaction", later)); });
  onCleanup(() => { cancelAnimationFrame(frame); clearTimeout(timer); });
  return createMemo(() => { drawn(); return read(editor()); }, undefined, equals ? { equals } : undefined);
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
