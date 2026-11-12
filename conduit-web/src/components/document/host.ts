/*
 * The document editor's boundary. The editor (this folder) shows the hub's live copy of one Conduit document
 * (document-format.js) and edits it; like Markup beside it, it is drawn with library pieces only and knows nothing of
 * the app it runs in. What it needs of the app comes through a DocumentHost, and what it offers a layer over it
 * (Markup) is DocumentMarks: neither side reaches past what the other declares here.
 */
import type { JSX } from "solid-js";

/** A kind of block the editor can make of where the caret is. */
export type DocumentBlockKind = "heading-1" | "heading-2" | "heading-3" | "bullets" | "numbers" | "checklist" | "quote" | "code" | "table" | "divider" | "text";
export const DOCUMENT_BLOCKS: readonly DocumentBlockKind[] = ["text", "heading-1", "heading-2", "heading-3", "bullets", "numbers", "checklist", "quote", "code", "table", "divider"];

export interface DocumentHost {
  /** The hub's live socket for a document, opened with the app's own sign-in. */
  socket(id: string): Promise<WebSocket>;
  /** Who writes from this client, as the document keeps it beside what they wrote. */
  author(): string;
  /** The block kinds offered here; every kind where it declares none. */
  blocks?: readonly DocumentBlockKind[];
}

/** How this copy stands with the hub's: `away` keeps what is written and sends it when the hub answers again. */
export type DocumentState = "connecting" | "live" | "away";

/** A comment the editor marks in the text: `under.blocks` is the ids of the blocks it was made on, `quote` the run of text in them (found again in its block; the block itself when the text has changed). */
export type DocumentAnchor = { key: string; quote?: string; under?: Record<string, string | number | boolean>; current: boolean; resolved: boolean };

/**
 * What the editor tells a layer that marks it up, in the shape Markup's host asks for: what is being marked, and the
 * blocks a mark lies over (their ids, and their text as drawn); and for a margin of comments, the marks of those it is
 * told, where each is now, and word of when they may have moved or one was pressed. `changed`: blocks stand changed
 * for that comment (document-format.js CHANGES), read where it is drawn so it follows. `tools`: the block kinds
 * offered, each making the caret's block that kind (`active`: it is that kind now, read where it is drawn). `selection`:
 * the text selected, else the caret's block; null before the editor is made.
 */
export type DocumentMarks = {
  tools(): { name: DocumentBlockKind; label: string; icon: () => JSX.Element; active: boolean; run(): void }[];
  selection(): Range | null;
  subject(): Record<string, string>;
  under(box: { left: number; top: number; width: number; height: number }): Record<string, string> | null;
  anchors(list: DocumentAnchor[]): void;
  place(key: string): { left: number; top: number; width: number; height: number } | null;
  watch(listener: (pressed?: string) => void): () => void;
  changed(key: string): boolean;
};
