/*
 * The sheet editor's boundary, as the document editor's (components/document/host.ts): everything of the app's
 * reaches it through a SheetHost, and what it offers a layer that marks it up (Markup) is SheetMarks. It is built on
 * the sheet format the hub shares (sheet-format.js), Yjs, and a grid drawn on a canvas, which is a React island
 * loaded only with a sheet (grid.ts).
 */

/** Cells by position, 0-based and inclusive (sheet-format.js parseRange). */
export type SheetRange = { top: number; left: number; bottom: number; right: number };
/** The grid's look, read from the app's tokens (theme.ts): Glide's theme object, sizes in pixels, and the inks it draws itself (`inks`: a formula's references, formula.ts INKS). */
export type SheetLook = { grid: Record<string, string | number>; row: number; header: number; width: number; error: string; mark: string; markCurrent: string; inks: string[] };
/** A reference in the formula being edited, outlined on the grid in its ink; `pointing`: the one being pointed at with the mouse or arrows. */
export type SheetReference = { range: SheetRange; ink: number; pointing: boolean };
/** A key pressed on the grid, as the editor is asked whether it takes it. */
export type SheetKey = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "preventDefault">;
/** A box in the viewport's pixels. */
export type SheetBox = { left: number; top: number; width: number; height: number };

/** What only the hub may do to a sheet (sheet-format: structure, and a fill whose formulas are adjusted per cell), as POST /v0/document/:id/cells takes it. */
export type SheetCellsOp =
  | { op: "set"; at: string; value: string }
  | { op: "fill"; range: string; values?: string[][]; value?: string }
  | { op: "insert-rows" | "insert-cols" | "delete-rows" | "delete-cols"; at: number; count?: number };

export interface SheetHost {
  /** The hub's live socket for the sheet, opened with the app's own sign-in. */
  socket(id: string): Promise<WebSocket>;
  /** Who writes from this client. */
  author(): string;
  /** A structural change or an adjusted fill, done by the hub (rejected with its words, which the editor shows). */
  cells(op: SheetCellsOp): Promise<unknown>;
  /** Tells the person something failed, in the hub's words. */
  failed(message: string): void;
}

/** How this copy stands with the hub's, as a paper's (DocumentState). */
export type SheetState = "connecting" | "live" | "away" | "stale";

/** The ask key, by its code: with the platform's modifier and Alt, a paper's (components/document/shortcuts.ts PAPER_COMMENT_KEY) on a sheet. */
export const ASK_KEY = "KeyM";
/**
 * A range as the place a comment is about, in the shape Markup's host asks for (MarkupPlace): its values row by row (`text`), its A1 address (`label`),
 * `under` its corners by ids (`cells`, the hub's contract) and its address when chosen (`range`), and its box now, found by those ids.
 */
export type SheetPlace = { text: string; label: string; under: { cells: string; range: string }; boxes(): SheetBox[] };

/** A comment the sheet marks: `under.cells` is the two corners of its range by ids ("<rowId>:<colId> <rowId>:<colId>"). */
export type SheetAnchor = { key: string; quote?: string; under?: Record<string, string | number | boolean>; current: boolean; resolved: boolean };

/**
 * What the editor tells a layer that marks it up, in the shape Markup's host asks for. `under`: the cells a box lies
 * over, by ids and by A1 address. `place`: the cells selected, as a place; `placeAt`: the cells from one point to another
 * (a press: the one cell), which it selects. `where`: where a comment's range is now. `reveal`: scroll to a range (A1) and
 * select it. `slot`: the end of the formula bar, where a layer may put its own controls. Not offered, because a sheet
 * does not have them yet: agents' seats, suggestions, and Keep or Revert of an agent's change.
 */
export type SheetMarks = {
  subject(): Record<string, string | number>;
  under(box: SheetBox): Record<string, string> | null;
  place(): SheetPlace | null;
  placeAt(from: { x: number; y: number }, to: { x: number; y: number } | null): SheetPlace | null;
  slot(): HTMLElement | undefined;
  anchors(list: SheetAnchor[]): void;
  where(key: string): SheetBox | null;
  watch(listener: (pressed?: string) => void): () => void;
  reveal(place: string): void;
  focus(): void;
  /** What this page wrote, taken back and put back (never another's writing); `canUndo` and `canRedo` are read where drawn. */
  history: { undo(): boolean; redo(): boolean; canUndo(): boolean; canRedo(): boolean };
};

/** The grid island (grid.ts) as the editor drives it: it draws and reports, the editor decides. */
export interface SheetGrid {
  /** Cells whose value changed, or null for everything (a structural change: sizes, widths, types). */
  update(changed: readonly { row: number; col: number }[] | null): void;
  select(range: SheetRange | null, scroll?: boolean): void;
  highlight(list: readonly { range: SheetRange; current: boolean }[]): void;
  /** The formula being edited's references, drawn over the comments' highlights. */
  references(list: readonly SheetReference[]): void;
  /** Scrolls a cell into view without selecting it. */
  show(row: number, col: number): void;
  /** A range's box on screen, clipped to the grid's; null when none of it is in view. */
  bounds(range: SheetRange): SheetBox | null;
  /** The cell under a point of the viewport. */
  cellAt(x: number, y: number): { row: number; col: number } | null;
  theme(look: SheetLook): void;
  focus(): void;
  destroy(): void;
}

/** What the island tells the editor. */
export type SheetGridEvents = {
  selected(range: SheetRange | null): void;
  /** What was typed into a cell, or pasted, as inputs by position; the editor writes them. */
  write(cells: readonly { row: number; col: number; input: string }[]): void;
  /** A paste or a fill dragged past the sheet's edge, or a fill whose formulas move: the hub's fill. */
  fill(range: SheetRange, values: string[][]): void;
  resized(col: number, width: number): void;
  /** A press on a header, a row number or a cell, before the context menu opens over it. */
  menu(target: { rows?: SheetRange; cols?: SheetRange }): void;
  /** Scrolled or resized: what is drawn where has moved. */
  moved(): void;
  pressed(row: number, col: number): void;
  /** A key pressed on the selected cell: true when the editor took it (typing starts an edit; Enter and F2 open one), and the grid leaves it alone. */
  key(event: SheetKey, row: number, col: number): boolean;
  /** A cell double-clicked: it is opened to edit. */
  activated(row: number, col: number): void;
  /** Its first frame with the sheet's cells is painted. */
  drawn(): void;
};
