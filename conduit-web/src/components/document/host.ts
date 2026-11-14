/*
 * The document editor's boundary. The editor (this folder) shows the hub's live copy of one Conduit document
 * (document-format.js) and edits it; like Markup beside it, it is drawn with library pieces only and knows nothing of
 * the app it runs in. What it needs of the app comes through a DocumentHost, and what it offers a layer over it
 * (Markup) is DocumentMarks: neither side reaches past what the other declares here.
 */
import type { JSX } from "solid-js";

/** A kind of block the editor can make of where the caret is. `date` is the one put in the line at the caret (and typed as `@today`, `@tomorrow`). */
export type DocumentBlockKind = "heading-1" | "heading-2" | "heading-3" | "bullets" | "numbers" | "checklist" | "quote" | "callout" | "toggle" | "code" | "table" | "image" | "divider" | "date" | "text";
export const DOCUMENT_BLOCKS: readonly DocumentBlockKind[] = ["text", "heading-1", "heading-2", "heading-3", "bullets", "numbers", "checklist", "quote", "callout", "toggle", "code", "table", "image", "divider", "date"];
/** A kind a block of text can be turned into ("Turn into", a bar's block kinds); a table, an image, a divider or a date is made beside text, never of it. */
export type DocumentTurnableKind = Exclude<DocumentBlockKind, "table" | "image" | "divider" | "date">;
export const DOCUMENT_TURNABLE: readonly DocumentTurnableKind[] = ["text", "heading-1", "heading-2", "heading-3", "bullets", "numbers", "checklist", "quote", "callout", "toggle", "code"];

/** A mark the editor can put on the text selected. `color` and `highlight` each take an ink (document-format.js PAPER_INKS). */
export type DocumentMarkKind = "bold" | "italic" | "strike" | "code" | "color" | "highlight";
export const DOCUMENT_MARKS: readonly DocumentMarkKind[] = ["bold", "italic", "strike", "code", "color", "highlight"];
/** An edit tool: what changes the document itself, as against what marks it up. */
export type DocumentToolName = DocumentBlockKind | DocumentMarkKind;
export const DOCUMENT_TOOLS: readonly DocumentToolName[] = [...DOCUMENT_BLOCKS, ...DOCUMENT_MARKS];
/**
 * What the format holds that plain Markdown cannot say (document-format.js writes each as raw HTML, its own syntax, or keeps it beside the text): its
 * nodes `callout`, `toggle` and `date`, the marks `color`, `highlight` and `underline` (StarterKit's, bound to Mod-u), and the `properties` over the text.
 */
export type DocumentExtra = "callout" | "toggle" | "date" | "color" | "highlight" | "underline" | "properties";
export const DOCUMENT_EXTRAS: readonly DocumentExtra[] = ["callout", "toggle", "date", "color", "highlight", "underline", "properties"];

export interface DocumentHost {
  /** The hub's live socket for a document, opened with the app's own sign-in. */
  socket(id: string): Promise<WebSocket>;
  /** Who writes from this client, as the document keeps it beside what they wrote. */
  author(): string;
  /** The edit tools offered here (block kinds and text marks), in the rail, the slash menu, a block's menu and over a selection; every one where it declares none. */
  tools?: readonly DocumentToolName[];
  /** A pressed `@name` in the text (its block's id and the name, no `@`): show what it asked. Without it a mention is drawn but does nothing. */
  showMention?(block: string, name: string): void;
  /**
   * Images kept beside the document, which an image block names (document-format.js IMAGE_NAME), never holding the bytes. `keep`: the file sent to
   * the hub, the name it is kept under given back (rejected, it was not kept, and the host has told the person why). `src`: what an <img> draws a
   * kept name from. Without it no image is offered, whatever `tools` says.
   */
  images?: { keep(file: File): Promise<string>; src(name: string): string | Promise<string> };
  /**
   * Suggesting offered beside Editing (unsaid: Editing only). `controls`: who draws each suggestion's Accept and Reject: the editor, `inline` at its
   * first block, or a layer over it (`margin`, from DocumentMarks.suggestions).
   */
  suggest?: { controls: "inline" | "margin" };
  /**
   * The extras this document holds (every one where it declares none). One it does not hold is out of the editor's schema, so it is neither made,
   * pasted, typed by its keys nor merged in, and out of every tool whatever `tools` says; without `properties` the head is the title alone. The hub
   * builds the same document with the same list, or the two schemas would differ and each would drop what the other wrote.
   */
  holds?: readonly DocumentExtra[];
}

/** How the reader writes in a paper: `editing` is final; in `suggesting` each burst of writing stands as a suggestion until accepted or rejected. Each reader's, per paper, never written to it. */
export type DocumentWriting = "editing" | "suggesting";
/** A suggestion standing in the document (document-format.js SUGGESTION): its key, who made it and when, its blocks (in order, then those it deleted), and what it does in words. */
export type DocumentSuggestion = { key: string; by: string; at: string; blocks: string[]; summary: string };

/** Each text mark, on where the selection is; `can`: a mark would apply now (a selection, or a caret in a block of text). */
export type DocumentMarking = { can: boolean; on: Record<DocumentMarkKind, boolean> };

/** A heading in the document, for an outline. */
export type DocumentHeading = { id: string; level: 1 | 2 | 3; text: string };

/**
 * What the editor offers the app round it, to bind to its commands and draw beside it. `openBlockMenu`: the caret block's menu, the keyboard in it.
 * `moveBlock`: the caret's block up or down one (false at an end). `outline`: the headings, in order; `current`: the one being read (the last above
 * the top of the view). `reveal`: scroll to a block and flash it. `find`: open the find bar.
 */
export type DocumentControls = {
  openBlockMenu(): void;
  moveBlock(by: -1 | 1): boolean;
  outline(): DocumentHeading[];
  current(): string | undefined;
  reveal(block: string): void;
  find(): void;
};

/** How this copy stands with the hub's: `away` keeps what is written and sends it when the hub answers again; `stale`, the hub refuses this page as older than the paper, so it is read only until reloaded. */
export type DocumentState = "connecting" | "live" | "away" | "stale";

/** A comment the editor marks in the text: `under.blocks` is the ids of the blocks it was made on, `quote` the run of text in them (found again in its block; the block itself when the text has changed). */
export type DocumentAnchor = { key: string; quote?: string; under?: Record<string, string | number | boolean>; current: boolean; resolved: boolean };

/**
 * What the editor tells a layer that marks it up, in the shape Markup's host asks for: what is being marked, and the
 * blocks a mark lies over (their ids, and their text as drawn); and for a margin of comments, the marks of those it is
 * told, where each is now, and word of when they may have moved or one was pressed. `changed`: blocks stand changed
 * for that comment (document-format.js CHANGES), read where it is drawn so it follows. `tools`: the block kinds
 * offered, each making the caret's block that kind (`active`: it is that kind now, read where it is drawn). `selection`:
 * the text selected, else the caret's block; null before the editor is made. `marking`: the text marks where the selection is, read where drawn.
 */
/** An agent at work in the document, as the hub tells it (server/documents.js: a seat): the blocks it holds, what it is doing, and what it is heard writing before the change is made. */
export type DocumentSeat = { name: string; state: "thinking" | "reading" | "writing"; blocks: string[]; for?: string; op?: "replace" | "insert"; text?: string };
export type DocumentMarks = {
  tools(): { name: string; label: string; icon: () => JSX.Element; active: boolean; pressed?: boolean; disabled?: boolean; keys?: string[]; menu?: string; compact?: boolean; run(): void }[];
  marking(): DocumentMarking;
  /** What was written here, taken back and put back; `canUndo` and `canRedo` are read where drawn. */
  history: { undo(): boolean; redo(): boolean; canUndo(): boolean; canRedo(): boolean };
  selection(): Range | null;
  subject(): Record<string, string>;
  under(box: { left: number; top: number; width: number; height: number }): Record<string, string> | null;
  anchors(list: DocumentAnchor[]): void;
  place(key: string): { left: number; top: number; width: number; height: number } | null;
  /** Where every mark stands, as one word that changes whenever any may have moved (MarkupMarginHost.placed). */
  placed(): string;
  watch(listener: (pressed?: string) => void): () => void;
  changed(key: string): boolean;
  /** The suggestions standing, oldest first, read where drawn. `place` finds one by its key. `accept`: its text stays and stops standing as suggested; `reject`: taken back. */
  suggestions(): DocumentSuggestion[];
  accept(key: string): void;
  reject(key: string): void;
  /** Every suggestion standing, or every one `by` made, accepted or taken back at once. */
  acceptAll(by?: string): void;
  rejectAll(by?: string): void;
  /** The agents at work in the document now, as the hub tells them; read where drawn. */
  seats(): DocumentSeat[];
  /** What the layer over the editor does with a comment's answer (null: nothing), offered on the block: Keep, Revert and Try again under the last block an agent changed for a comment it was told of and not resolved, Stop where an agent is at work for one. */
  answers(acts: DocumentAnswers | null): void;
};
/** A comment's answer, as the layer over the editor settles it, by the comment's key: what the agent changed kept (the comment resolved), put back, put back and asked again; or the agent stopped. */
export type DocumentAnswers = { keep(key: string): void; revert(key: string): void; retry(key: string): void; stop(key: string): void };
