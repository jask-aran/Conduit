import type * as Y from "yjs";
import type { Range } from "./sheet-format.js";
import type { FormatSheet } from "./sheet-formats.js";

/** Cells one call gives a style of their own; more is a whole column's or row's. */
export const STYLE_CELL_LIMIT: number;
export type SheetInk = "red" | "amber" | "green" | "blue";
/** A colour as a workbook gives it, lower case. */
export type SheetHex = `#${string}`;
export const SHEET_INKS: readonly SheetInk[];
/** A border choice for a range: every edge of every cell, the range's outline, one side of it, or none. */
export type SheetBorders = "all" | "outer" | "inner" | "top" | "bottom" | "left" | "right" | "none";
export const SHEET_BORDERS: readonly SheetBorders[];
/**
 * A cell's style as an agent says and reads it. A field left out is left as it is (read: worn from the row or column, else the default); false or null
 * is the default set on purpose (not bold in a bold column). `color` is the text's ink, `fill` the cell's, each an ink or a workbook's own `#rrggbb`;
 * `borders` its own edges, drawn in `borderColor` (else the grid's) at `borderWeight` (else thin); `size` its text's in points (else the sheet's).
 */
export type SheetStyle = {
  bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; wrap?: boolean;
  color?: SheetInk | SheetHex | null; fill?: SheetInk | SheetHex | null; borderColor?: SheetHex | null; borderWeight?: "medium" | "thick" | null; size?: number | null; align?: "left" | "center" | "right" | null; valign?: "top" | "middle" | "bottom" | null;
  borders?: { top?: boolean; right?: boolean; bottom?: boolean; left?: boolean };
};
/**
 * The packed form in `look` (`style:<colId>`, `style:<rowId>`, `style:<rowId>:<colId>`): codes by space, `b i u s w` flags, `c= f= h= v= bc= bw= z=` values
 * (`h=center`, `c=#0070c0`, `bw=medium`, `z=9`), `bt br bb bl` edges, `-` before one for its default set on purpose: "b c=red f=amber h=center bt bb", "-b".
 * As attributes: each code to true or false (a flag or an edge), or a word or null (a value).
 */
export type StyleAttrs = Partial<Record<"b" | "i" | "u" | "s" | "w" | "bt" | "br" | "bb" | "bl", boolean> & Record<"c" | "f" | "h" | "v" | "bc" | "bw" | "z", string | null>>;
export function decodeStyle(text: unknown): StyleAttrs;
export function encodeStyle(attrs: StyleAttrs): string;
/** A fault is an Error with status 400. */
export function styleAttrs(style: unknown): StyleAttrs;
export function styleOf(attrs: StyleAttrs): SheetStyle;
/**
 * Sets `style` (only the fields it names) and a border choice on `area` (clipped to the tab's own cells), in the caller's transaction. `whole`: the
 * area's whole columns or rows take what is the same along them, their cells' own of it going; else each cell its own, at most STYLE_CELL_LIMIT cells.
 * A cell keeps only what differs from what it would wear. A fault is an Error with status 400.
 */
export function writeStyle(look: Y.Map<number | string>, sheet: FormatSheet, area: Range, change: { style?: SheetStyle; borders?: SheetBorders }, whole: "cols" | "rows" | null): void;
/** The styles set within `area`, as sheet.json names them: a column's by its letter (`B`), a row's by its number (`5`), a cell's own by its address (`C4`). */
export function listStyles(look: Y.Map<number | string>, sheet: FormatSheet, area: Range): Record<string, SheetStyle>;
/**
 * POST /v0/document/:id/cells `{ op: "style", range, style?, borders?, tab? }`: `range` A1 (`B2:C5`), whole columns (`B:D`) or whole rows (`3:5`);
 * with `style` or `borders` they are set first. Its answer: the styles within the range after it, and the range as written (`cells`).
 */
export type SheetStyleOp = { op: "style"; range: string; style?: SheetStyle; borders?: SheetBorders; tab?: string };
export type SheetStylesResult = { cells: string[]; styles: Record<string, SheetStyle>; tab?: string };
