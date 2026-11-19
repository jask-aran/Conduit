import type * as Y from "yjs";
import type { Range } from "./sheet-format.js";
import type { FormatSheet } from "./sheet-formats.js";
import type { SheetInk } from "./sheet-styles.js";

export const TYPE_CELL_LIMIT: number;
/** A cell's own type where its column has one and it is plain. */
export const PLAIN: "plain";
/** One of a dropdown's options: its value and, drawn as its pill's colour, an ink. */
export type SheetOption = { value: string; ink?: SheetInk };
/** An Excel data validation as an import keeps it: `range` its sqref, then its attributes and formulas; `inks` a dropdown's colours, ours alone. */
export type SheetValidation = { range: string; type?: string; formula1?: string; formula2?: string; inks?: Record<string, SheetInk>; [attribute: string]: unknown };
export function readValidations(look: Y.Map<unknown>, tab: string): SheetValidation[];
export function areasOf(validation: SheetValidation): Range[];
export function optionsOf(validation: SheetValidation): SheetOption[] | null;
export function cleanOptions(options: unknown): SheetOption[];
export function listFields(options: readonly (string | SheetOption)[]): Omit<SheetValidation, "range">;
export function editValidations(look: Y.Map<unknown>, tab: string, edit: (list: SheetValidation[]) => SheetValidation[]): void;
export function writeType(look: Y.Map<unknown>, sheet: FormatSheet & { id: string }, area: Range, type: "boolean" | "date" | "list" | null, columns: boolean, options?: readonly (string | SheetOption)[]): void;
/** POST /v0/document/:id/cells `{ op: "type", range, type, options?, tab? }`: `type` checkbox, date, dropdown (with `options`) or plain; `range` A1 or whole columns. */
export type SheetTypeOp = { op: "type"; range: string; type: "checkbox" | "date" | "dropdown" | "plain"; options?: (string | SheetOption)[]; tab?: string };
