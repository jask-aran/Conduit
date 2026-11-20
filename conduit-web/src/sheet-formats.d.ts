import type * as Y from "yjs";
import type { Range, SheetView } from "./sheet-format.js";

/** Cells one call gives a format of their own; more is a whole column's. */
export const FORMAT_CELL_LIMIT: number;
export const GENERAL: "General";
/** No format, or Excel's General: the number shown as it is. */
export function isGeneral(format: unknown): boolean;
/** Why this is not a number format (numfmt reads it as Excel does), or null. */
export function formatFault(format: unknown): string | null;
/** What of a tab a format is written through: its size and its rows' and columns' ids. */
export type FormatSheet = Pick<SheetView, "size" | "rowAt" | "colAt" | "indexOfRow" | "indexOfCol">;
/**
 * Sets `format` on `area` (clipped to the tab's own cells), in the caller's transaction. `columns`: the area's whole columns take it (`fmt:<colId>`), their
 * cells' own formats going; else each cell (`fmt:<rowId>:<colId>`), kept only where it differs from its column's, at most FORMAT_CELL_LIMIT cells.
 * General takes a format away. A fault is an Error with status 400.
 */
export function writeFormat(look: Y.Map<number | string>, sheet: FormatSheet, area: Range, format: string, columns: boolean): void;
/** The formats set within `area`, as sheet.json names them: a column's by its letter (`B`), a cell's own by its address (`C4`). */
export function listFormats(look: Y.Map<number | string>, sheet: FormatSheet, area: Range): Record<string, string>;
/** The date format a formula's result takes in a General cell (`dates`: the engine's date functions, each with its format; `formatOf`: what a reference's cells are formatted as), or undefined. */
export function formulaDate(input: string, dates: Readonly<Record<string, string>>, formatOf: (reference: string) => string | undefined): string | undefined;
/** Written formulas in General cells take the date format `formulaDate` finds (in the caller's transaction); `other`: another tab by name. */
export function formatDates(look: Y.Map<number | string>, sheet: FormatSheet & Pick<SheetView, "value">, written: readonly { row: number; col: number; input: string }[], dates: Readonly<Record<string, string>>, other: (tab: string) => (FormatSheet & Pick<SheetView, "value">) | undefined): void;
/** POST /v0/document/:id/cells `{ op: "format", range, format?, tab? }`: `range` A1 (`B2:C5`) or whole columns (`B:D`); with `format` it is set first. */
export type SheetFormatOp = { op: "format"; range: string; format?: string; tab?: string };
/** Its answer: the formats within the range after it, and the range as written (`cells`). */
export type SheetFormatsResult = { cells: string[]; formats: Record<string, string>; tab?: string };
