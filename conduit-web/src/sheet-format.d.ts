import type { HyperFormula } from "hyperformula";
import type * as Y from "yjs";

export const SHEET_FORMAT: 1;
export const ROWS: "rows";
export const COLS: "cols";
export const CELLS: "cells";
export const LOOK: "look";
export const SHEET_LIMIT: number;
export const CALL_LIMIT: number;
export const COL_LIMIT: number;
export type Range = { top: number; left: number; bottom: number; right: number };
/** A column's type in `look` (`type:<colId>`); the page draws "boolean" as a checkbox. */
export type ColumnType = "string" | "number" | "boolean" | "date";
export function rowId(): string;
export function colId(): string;
export function key(row: string, col: string): string;
export function colName(col: number): string;
export function colIndex(letters: string): number;
export function a1(row: number, col: number): string;
/** Null for text that is no A1 address. */
export function parseA1(text: string): { row: number; col: number } | null;
export function parseRange(text: string): Range | null;
export function rangeA1(range: Range): string;
export function toCsv(rows: string[][], eol?: string): string;
export function fromCsv(text: string): string[][];
/** A computed value as the file writes it: TRUE/FALSE, an error's code, "" for empty. */
export function valueText(value: unknown): string;
/** `cells`: the cells whose values changed, or null when everything may have (the engine was built again, or the hub's own structure change). */
export type SheetChange = { structure: boolean; cells: { row: number; col: number }[] | null };
export interface SheetModel {
  engine: HyperFormula;
  sheet: number;
  size(): { rows: number; cols: number };
  input(r: number, c: number): string;
  /** An error cell's value is its code ("#DIV/0!"). */
  value(r: number, c: number): string | number | boolean | null;
  /** An error cell's message (its code where the engine gives none), else null. */
  error(r: number, c: number): string | null;
  rowAt(i: number): string | undefined;
  colAt(i: number): string | undefined;
  indexOfRow(id: string): number;
  indexOfCol(id: string): number;
  onChange(listener: (change: SheetChange) => void): () => void;
  /** The hub's alone. */
  structure(op: "insert-rows" | "delete-rows" | "insert-cols" | "delete-cols", at: number, count: number, write?: () => void): { rows: number; cols: number };
  destroy(): void;
}
export function createSheetModel(doc: Y.Doc): SheetModel;
