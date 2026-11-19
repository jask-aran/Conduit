/*
 * The sheet editor's boundary, as the document editor's (components/document/host.ts): everything of the app's
 * reaches it through a SheetHost, and what it offers a layer that marks it up (Markup) is SheetMarks. It is built on
 * the sheet format the hub shares (sheet-format.js), Yjs, and a grid drawn on a canvas, which is a React island
 * loaded only with a sheet (grid.ts).
 */
import type { JSX } from "solid-js";
import type { SheetSortOp, SheetTabOp } from "@/sheet-format.js";
import type { SheetFormatOp } from "@/sheet-formats.js";
import type { SheetBorders, SheetInk, SheetStyleOp } from "@/sheet-styles.js";
import type { SheetChartKind, SheetChartSpec } from "@/sheet-charts.js";

/** Cells by position, 0-based and inclusive (sheet-format.js parseRange). */
export type SheetRange = { top: number; left: number; bottom: number; right: number };
/**
 * The grid's look, read from the app's tokens (theme.ts): Glide's theme object, sizes in pixels, and the inks it draws itself (`inks`: a formula's references, formula.ts INKS; `live` and `warn`: a number format's green and yellow).
 * For styles (styles.ts): `strong`, a bold cell's weight; `edge`, a border's colour; `palette`, each ink as text and as a cell's fill; `corner`, the size of the mark on a cell an import froze (in `warn`).
 */
/** `focus`: the wash over the active cell's row and column, empty while the focus cell is off. */
export type SheetLook = { grid: Record<string, string | number>; row: number; header: number; picked: string; width: number; error: string; live: string; warn: string; mark: string; markCurrent: string; focus: string; inks: string[];
  strong: string; edge: string; corner: number; palette: Record<SheetInk, { text: string; fill: string }> };
/** A reference in the formula being edited, outlined on the grid in its ink; `pointing`: the one being pointed at with the mouse or arrows. */
export type SheetReference = { range: SheetRange; ink: number; pointing: boolean };
/** A key pressed on the grid, as the editor is asked whether it takes it. */
export type SheetKey = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "metaKey" | "altKey" | "preventDefault">;
/** A box in the viewport's pixels. */
export type SheetBox = { left: number; top: number; width: number; height: number };

/**
 * What only the hub may do to a sheet (sheet-format: structure, a fill whose formulas are adjusted per cell, and its tabs), as POST /v0/document/:id/cells takes it. `tab`: an id or a name; unsaid, the first.
 * `client` (the page's Yjs client id) and `step`: the hub sends that page the change's updates tagged with the step (document-format.js FRAME.own), for its history.
 */
export type SheetCellsOp = { client?: number; step?: number } & (
  | { op: "set"; at: string; value: string; tab?: string }
  | { op: "fill"; range: string; values?: string[][]; value?: string; from?: string; tab?: string }
  | { op: "insert-rows" | "insert-cols" | "delete-rows" | "delete-cols"; at: number; count?: number; tab?: string }
  /** `count` whole rows or columns from `at` moved to start at `to`, the tab's formulas reading them following them. */
  | { op: "move-rows" | "move-cols"; at: number; count?: number; to: number; tab?: string }
  /** A block's cells deleted with those below (`up`) or right (`left`) moving in, or room made by moving them down or right, formulas following. */
  | { op: "shift-cells"; range: string; way: "up" | "left" | "down" | "right"; tab?: string }
  | SheetFormatOp
  | SheetStyleOp
  | SheetSortOp
  | { op: "chart"; chart?: SheetChartSpec & { id?: string; delete?: boolean }; tab?: string }
  | SheetTabOp);

/** A cell an import could not compute, as GET /v0/document/:id?as=import reports it (server/sheet-xlsx.js): the file's formula, why, and the value it holds instead. By tab name, then A1. */
export type SheetFrozen = Record<string, Record<string, { formula: string; why: string; kept?: string }>>;

/**
 * The edit tools a sheet offers on its ribbon, as its kind declares them (client/document/artifact-kinds.ts). Each draws as one or more tools named
 * `<tool>` (a toggle) or `<tool>-<choice>` (one of a menu): SheetToolId, the stable names a key sequence is bound to. Undo and Redo are the ribbon's own.
 */
export type SheetToolName = "bold" | "italic" | "underline" | "strike" | "wrap" | "clear" | "color" | "fill" | "borders" | "merge" | "chart" | "align" | "valign" | "format" | "decimals" | "spread" | "paint";
/** In the ribbon's order, left to right. */
export const SHEET_TOOLS: readonly SheetToolName[] = ["bold", "italic", "underline", "strike", "align", "color", "fill", "borders", "merge", "chart", "format", "valign", "wrap", "decimals", "spread", "paint", "clear"];
/** `clear`: Clear formatting (styles and number formats). `spread-down` and `spread-right`: Fill down and Fill right, named apart from `fill`, the fill colour. */
export type SheetToolId = "bold" | "italic" | "underline" | "strike" | "wrap" | "clip" | "clear" | "paint" | `spread-${"down" | "right"}` | `color-${SheetInk | "none" | "any"}` | `fill-${SheetInk | "none" | "any"}` | `borders-${SheetBorders}` | `merge-${"center" | "across" | "cells" | "none"}` | `chart-${SheetChartKind}`
  | `align-${"left" | "center" | "right"}` | `valign-${"top" | "middle" | "bottom"}` | `format-${"general" | "number" | "currency" | "accounting" | "percent" | "scientific" | "date" | "long-date" | "time" | "custom"}` | `decimals-${"more" | "fewer"}`;
/** One tool as the ribbon draws it (Markup's MarkupHostTool): read where drawn, so getters follow. `menu`: the tools of one stand as one control (showing `glyph` where one says it); `compact` with `swatch`: a set of inks. */
export type SheetTool = { name: SheetToolId; label: string; icon: () => JSX.Element; active?: boolean; pressed?: boolean; disabled?: boolean; keys?: string[]; menu?: string; compact?: boolean; swatch?: string; glyph?: () => JSX.Element; tip?: string; pick?(hex: string): void; run(): void };

export interface SheetHost {
  /** The hub's live socket for the sheet, opened with the app's own sign-in. */
  socket(id: string): Promise<WebSocket>;
  /** Who writes from this client. */
  author(): string;
  /** A structural change or an adjusted fill, done by the hub (rejected with its words, which the editor shows). */
  cells(op: SheetCellsOp): Promise<unknown>;
  /** Tells the person something failed, in the hub's words. */
  failed(message: string): void;
  /** The cells its import froze, where it was imported (asked once); null where it was not. */
  frozen?(): Promise<SheetFrozen | null>;
  /** The edit tools offered on its ribbon (every one where it declares none). */
  tools?: readonly SheetToolName[];
  /** How the grid is drawn here, read where drawn so it follows (unsaid: gridlines, 100%, no focus cell). */
  display?(): SheetDisplay;
  /** Opens the app's settings for how a sheet is drawn. */
  openSettings?(): void;
}

/** `zoom`: what the grid's sizes are drawn at (1 is 100%); the sizes a sheet keeps stay its own. `focusCell`: the active cell's row and column are washed. */
export type SheetDisplay = { gridlines: boolean; zoom: number; focusCell: boolean };

/** How this copy stands with the hub's, as a paper's (DocumentState). */
export type SheetState = "connecting" | "live" | "away" | "stale";

/** The ask key, by its code: with the platform's modifier and Alt, a paper's (components/document/shortcuts.ts PAPER_COMMENT_KEY) on a sheet. */
export const ASK_KEY = "KeyM";
/**
 * A range as the place a comment is about, in the shape Markup's host asks for (MarkupPlace): its values row by row (`text`), its A1 address (`label`),
 * `under` its corners by ids (`cells`, the hub's contract), its address when chosen (`range`, `Data!B2:C3` where the workbook has several tabs) and that tab's name, and its box now, found by those ids.
 */
export type SheetPlace = { text: string; label: string; under: { cells: string; range: string; tab?: string }; boxes(): SheetBox[] };

/** A comment the sheet marks: `under.cells` is the two corners of its range by ids ("<rowId>:<colId> <rowId>:<colId>"). */
export type SheetAnchor = { key: string; quote?: string; under?: Record<string, string | number | boolean>; current: boolean; resolved: boolean };

/**
 * What the editor tells a layer that marks it up, in the shape Markup's host asks for. `under`: the cells a box lies
 * over, by ids and by A1 address. `place`: the cells selected, as a place; `placeAt`: the cells from one point to another
 * (a press: the one cell), which it selects. `where`: where a comment's range is now. `reveal`: scroll to a range (A1) and
 * select it. `slot`: the end of the formula bar, where the layer's ribbon stands. `tools`: its edit tools, for that ribbon. Not offered, because a sheet
 * does not have them yet: agents' seats, suggestions, and Keep or Revert of an agent's change.
 */
export type SheetMarks = {
  subject(): Record<string, string | number>;
  under(box: SheetBox): Record<string, string> | null;
  place(): SheetPlace | null;
  placeAt(from: { x: number; y: number }, to: { x: number; y: number } | null): SheetPlace | null;
  slot(): HTMLElement | undefined;
  tools(): SheetTool[];
  anchors(list: SheetAnchor[]): void;
  where(key: string): SheetBox | null;
  watch(listener: (pressed?: string) => void): () => void;
  reveal(place: string): void;
  focus(): void;
  /** What this page did, taken back and put back `count` steps at a time (never another's writing); `steps`: the latest steps' names, newest first. Read where drawn. */
  history: { undo(count?: number): boolean; redo(count?: number): boolean; canUndo(): boolean; canRedo(): boolean; steps(): { undo: string[]; redo: string[] } };
};

/** The grid island (grid.ts) as the editor drives it: it draws and reports, the editor decides. */
export interface SheetGrid {
  /** Cells whose value changed, or null for everything (a structural change: sizes, widths, types). */
  update(changed: readonly { row: number; col: number }[] | null): void;
  /** The grid scrolls what it is given into view. */
  select(range: SheetRange | null): void;
  highlight(list: readonly { range: SheetRange; current: boolean }[]): void;
  /** The formula being edited's references, drawn over the comments' highlights. */
  references(list: readonly SheetReference[]): void;
  /** Find's matches, washed (`current`: the one it stands on, outlined as well); none while the find bar is shut. */
  found(list: readonly { range: SheetRange; current: boolean }[]): void;
  /** Scrolls a cell into view without selecting it. */
  show(row: number, col: number): void;
  /** Selects the whole columns, or rows, the selection covers. */
  whole(kind: "cols" | "rows"): void;
  /** Whether whole columns or whole rows are picked; null for a block of cells. */
  lines(): "cols" | "rows" | null;
  /** A range's cells shown, as the clipboard's text (tab-separated, quoted as a spreadsheet's), held as copied from this grid unless cut. */
  copy(range: SheetRange, cut: boolean): string;
  /** The clipboard's text pasted at a cell, into the rows and columns shown from it: copied from this grid, its formulas' relative references move with
   * it, or (`values`) what its cells showed is pasted. */
  paste(at: { row: number; col: number }, text: string, values?: boolean): void;
  /** Whether something copied from this grid is held, for Paste values. */
  held(): boolean;
  /** The rows and columns shown that what is held was copied from, for Paste formatting. */
  source(): { rows: readonly number[]; cols: readonly number[] } | null;
  /** The row whose lower edge, beside its number, is under a point of the viewport (and the top of that row), as a drag to size it starts. */
  rowEdge(x: number, y: number): { row: number; top: number } | null;
  /** A row drawn at a height while it is dragged, before the look holds it. */
  height(row: number, height: number): void;
  /** A range's box on screen, clipped to the grid's; null when none of it is in view. */
  bounds(range: SheetRange): SheetBox | null;
  /** A cell's box on screen, in view or not (null in a hidden row); `area`: where the cells are drawn, under the letters and beside the row numbers. */
  origin(row: number, col: number): SheetBox | null;
  area(): SheetBox | null;
  /** The cell under a point of the viewport. */
  cellAt(x: number, y: number): { row: number; col: number } | null;
  theme(look: SheetLook): void;
  /** The first cell in view; given one, it is scrolled to the top left first. */
  scroll(to?: { row: number; col: number }): { row: number; col: number };
  focus(): void;
  destroy(): void;
}

/** What the island tells the editor. */
export type SheetGridEvents = {
  selected(range: SheetRange | null): void;
  /** What was typed into a cell, or pasted, as inputs by position; the editor writes them. */
  write(cells: readonly { row: number; col: number; input: string }[], label?: string): void;
  /** A paste or a fill dragged past the sheet's edge, or a fill whose formulas move: the hub's fill. `from`: the fill handle's source, whose formulas the hub moves into `values`. */
  fill(range: SheetRange, values: string[][], from?: SheetRange): void;
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
  /** A column letter's edge or a row number's double-clicked: that column or row is fitted to what it shows. */
  autofit?(kind: "cols" | "rows", line: number): void;
  /** A filter's mark pressed on its header cell (SheetColumns `mark`), with the cell's box. */
  filter?(row: number, col: number, box: SheetBox): void;
  /** Its first frame with the sheet's cells is painted. */
  drawn(): void;
};
