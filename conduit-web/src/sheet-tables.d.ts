import type * as Y from "yjs";
import type { Range, SheetView } from "./sheet-format.js";

export type SheetTotal = "sum" | "average" | "count" | "countNums" | "max" | "min";
/** A table: its corners by `<rowId>:<colId>`; `header` false when its first row is data; `total` when its last row is its total row; `totals` by column id. */
export type SheetTable = { id: string; name: string; from: string; to: string; header?: false; total?: true; style?: string; totals?: Record<string, SheetTotal> };
export type SheetTableA1 = Omit<SheetTable, "id" | "from" | "to" | "totals"> & { range: string; totals?: Record<string, SheetTotal> };
type Sheetish = Pick<SheetView, "indexOfRow" | "indexOfCol" | "rowAt" | "colAt" | "size">;
type Look = Pick<Y.Map<unknown>, "get" | "set" | "has" | "delete" | "keys">;
export const TABLE_STYLE: string;
export const TOTALS: SheetTotal[];
export function readTables(look: Pick<Look, "get">, tabId: string): SheetTable[];
export function writeTables(look: Look, tabId: string, list: SheetTable[]): void;
export function takenNames(look: Look, skip?: string): Set<string>;
export function nameFault(name: string, taken: ReadonlySet<string>): string | null;
export function freshName(taken: ReadonlySet<string>): string;
export function newTable(sheet: Sheetish, area: Range, name: string, header?: boolean): SheetTable;
export function tablesA1(sheet: Sheetish, list: SheetTable[]): SheetTableA1[];
export function tablesIds(sheet: Sheetish, given: unknown, taken: ReadonlySet<string>): SheetTable[];
