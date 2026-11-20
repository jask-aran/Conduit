import type * as Y from "yjs";
import type { Range, SheetFilterWhen, SheetRangedLook, SheetView } from "./sheet-format.js";

export type SheetTotal = "sum" | "average" | "count" | "countNums" | "max" | "min";
/**
 * A table: its corners by `<rowId>:<colId>`; `header` false when its first row is data (only as a file had it); `total` when its last row is its
 * total row; `filter` false when it shows no filter buttons, else its own filter (`keep`, `when`, `hide`, as a tab's filter, sheet-format.d.ts).
 */
export type SheetTable = { id: string; name: string; from: string; to: string; header?: false; total?: true; style?: string; filter?: false; keep?: Record<string, string[]>; when?: Record<string, SheetFilterWhen>; hide?: string[] };
export type SheetTableA1 = Omit<SheetTable, "id" | "from" | "to" | "keep" | "when" | "hide"> & { range: string; keep?: Record<string, string[]>; when?: Record<string, SheetFilterWhen>; hide?: number[] };
export type PlacedTable = { table: SheetTable; range: Range };
export type SheetTableChange = { name?: string; style?: string; filter?: boolean; range?: Range; total?: boolean };
type Sheetish = Pick<SheetView, "id" | "indexOfRow" | "indexOfCol" | "rowAt" | "colAt" | "size" | "input">;
type Look = Pick<Y.Map<unknown>, "get" | "set" | "has" | "delete" | "keys">;
type Writer = (row: number, col: number, input: string) => void;
export const TABLE_STYLE: string;
export const TOTALS: SheetTotal[];
export function readTables(look: Pick<Look, "get">, tabId: string): SheetTable[];
export function writeTables(look: Look, tabId: string, list: SheetTable[]): void;
export function takenNames(look: Look, skip?: string): Set<string>;
export function nameFault(name: string, taken: ReadonlySet<string>): string | null;
export function freshName(taken: ReadonlySet<string>): string;
export function newTable(sheet: Pick<Sheetish, "rowAt" | "colAt">, area: Range, name: string, header?: boolean): SheetTable;
export function rowsOf(area: Range, table: SheetTable): { header: number; first: number; last: number; total: number };
export function placed(look: Pick<Look, "get">, sheet: Pick<Sheetish, "id" | "indexOfRow" | "indexOfCol">): PlacedTable[];
export function tableFilter(sheet: Pick<Sheetish, "rowAt" | "colAt">, table: SheetTable, area: Range): SheetRangedLook | null;
export function totalFormula(fn: string, column: Range): string;
export function totalOf(input: unknown): SheetTotal | undefined;
export function makeTable(look: Look, sheet: Sheetish, area: Range, header: boolean, set: Writer): SheetTable;
export function changeTable(look: Look, sheet: Sheetish, id: string, change: SheetTableChange, set: Writer): SheetTable;
export function removeTable(look: Look, sheet: Sheetish, id: string): void;
export function tableWrites(look: Look, sheet: Sheetish, written: readonly (readonly [number, number, string])[], set: Writer, shift: (formula: string, rows: number, cols: number) => string): boolean;
export function addTableRow(look: Look, sheet: Sheetish, id: string, set: Writer, shift: (formula: string, rows: number, cols: number) => string): number | null;
export function putFilter(look: Look, sheet: Pick<Sheetish, "id">, id: string, filter: Pick<SheetTable, "keep" | "when" | "hide">): void;
export function totalAt(table: SheetTable, range: Range, col: number, fn: string): string;
export function tablesA1(sheet: Pick<Sheetish, "indexOfRow" | "indexOfCol">, list: SheetTable[]): SheetTableA1[];
export function tablesIds(sheet: Sheetish, given: unknown, taken: ReadonlySet<string>): SheetTable[];
