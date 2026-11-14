import type { Editor } from "@tiptap/core";
import { createMemo, type Accessor } from "solid-js";
import { createEditorTransaction } from "solid-tiptap";

/** What is read from the editor after each transaction, told on only when it changed: a keystroke is a transaction, and most of what is read (the block's kind, the marks worn) is the same after it. */
export const readEditor = <T>(editor: Accessor<Editor | undefined>, read: (made: Editor | undefined) => T, equals?: (a: T, b: T) => boolean): Accessor<T> =>
  createMemo(createEditorTransaction(editor, read), undefined, equals ? { equals } : undefined);
export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
