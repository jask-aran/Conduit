/*
 * The document editor's boundary. The editor (this folder) shows the hub's live copy of one Conduit document
 * (document-format.js) and edits it; like Markup beside it, it is drawn with library pieces only and knows nothing of
 * the app it runs in. What it needs of the app comes through a DocumentHost, and what it offers a layer over it
 * (Markup) is DocumentMarks: neither side reaches past what the other declares here.
 */

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

/** What the editor tells a layer that marks it up, in the shape Markup's host asks for: what is being marked, and the blocks a mark lies over (their ids, and their text as drawn). */
export type DocumentMarks = {
  subject(): Record<string, string>;
  under(box: { left: number; top: number; width: number; height: number }): Record<string, string> | null;
};
