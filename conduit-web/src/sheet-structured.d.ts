import type { Range } from "./sheet-format.js";

/** A table as references read it: rows and columns by index (-1: no header or total row), `sheet` its tab's name as a formula writes it before `!`. */
export type TableInfo = { name: string; tab: string; sheet: string; header: number; first: number; last: number; total: number; left: number; right: number; columns: string[] };
export type TableInfos = ReadonlyMap<string, TableInfo>;
export type CellAt = { tab: string; row: number; col: number };
export type Reference = { kind: "a1" | "struct" | "name"; start: number; end: number; table?: string | null; open?: number };
export const SPECIALS: string[];
export function escapeName(name: string): string;
export function referencesOf(text: string): Reference[];
export function tableAt(tables: TableInfos, at: CellAt): TableInfo | undefined;
/** `names`: "" for a bare reference (`[@Qty]`) outside any table. */
export function toA1(text: string, tables: TableInfos, at: CellAt): { a1: string; stored: string; names: string[] } | null;
export function areasOf(text: string, tables: TableInfos, at: CellAt): { start: number; end: number; tab: string; area: Range }[];
export function unstructure(text: string, tables: TableInfos, at: CellAt, name: string): string;
export function alignA1(stored: string, engine: string, tables: TableInfos): string;
export function structuredFor(tables: TableInfos, at: CellAt, tab: string, area: Range): string | null;
export function fromA1(text: string, tables: TableInfos, at: CellAt, sheetTab: (name: string) => string | undefined): string;
export function renameTable(text: string, from: string, to: string): string;
export function renameColumn(text: string, tables: TableInfos, at: CellAt, table: TableInfo, from: string, to: string): string;
export function toFile(text: string, tables: TableInfos, at: CellAt): string;
export function fromFile(text: string, tables: TableInfos, at: CellAt): string;
