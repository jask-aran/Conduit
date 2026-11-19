import type * as Y from "yjs";
import type { Range } from "./sheet-format.js";
import type { FormatSheet } from "./sheet-formats.js";
import type { SheetInk } from "./sheet-styles.js";

export const TYPE_CELL_LIMIT: number;
/** A typed date (2026-03-15, 15/3/2026, 15 Mar 2026…) as the engine's serial number; null for anything else. */
export function readDate(text: string): number | null;
export function dateText(serial: number): string;
/** A cell's own type where its column has one and it is plain. */
export const PLAIN: "plain";
/** One of a dropdown's options: its value and, drawn as its pill's colour, an ink. */
export type SheetOption = { value: string; ink?: SheetInk };
/** A dropdown's or other validation's type value: `valid:<id>`. */
export const VALID: "valid:";
/** An Excel data validation's attributes, as an import keeps them; `inks` a dropdown's colours, ours alone. */
export type SheetValidation = { type?: string; formula1?: string; formula2?: string; inks?: Record<string, SheetInk>; [attribute: string]: unknown };
export function readValidations(look: Y.Map<unknown>, tab: string): Record<string, SheetValidation>;
export function setValidation(look: Y.Map<unknown>, tab: string, id: string, attributes: SheetValidation): void;
export function optionsOf(validation: SheetValidation): SheetOption[] | null;
export function cleanOptions(options: unknown): SheetOption[];
export function listFields(options: readonly (string | SheetOption)[]): SheetValidation;
export function writeType(look: Y.Map<unknown>, sheet: FormatSheet & { id: string }, area: Range, type: "boolean" | "date" | "list" | null, columns: boolean, options?: readonly (string | SheetOption)[]): void;
/** The tab's validations by A1 (`range`: the cells holding each), as sheet.json and xlsx keep them. */
export function validationsA1(look: Y.Map<unknown>, sheet: FormatSheet & { id: string }): (SheetValidation & { range: string })[];
export function restoreValidations(look: Y.Map<unknown>, sheet: FormatSheet & { id: string }, list: unknown): void;
/** POST /v0/document/:id/cells `{ op: "type", range, type, options?, tab? }`: `type` checkbox, date, dropdown (with `options`) or plain; `range` A1 or whole columns. */
export type SheetTypeOp = { op: "type"; range: string; type: "checkbox" | "date" | "dropdown" | "plain"; options?: (string | SheetOption)[]; tab?: string };
