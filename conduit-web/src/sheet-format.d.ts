import type { HyperFormula } from "hyperformula";
import type * as Y from "yjs";

export const SHEET_FORMAT: 2;
export const ROWS: "rows";
export const COLS: "cols";
export const CELLS: "cells";
export const LOOK: "look";
/** The Y.Array of tab ids in order (none in a format-1 doc: the one tab `main`). */
export const TABS: "tabs";
/** The Y.Map of `name:<tabId>` and `hidden:<tabId>`. */
export const TAB: "tab";
export const MAIN: "main";
export const SHEET_LIMIT: number;
export const WORKBOOK_LIMIT: number;
export const CALL_LIMIT: number;
export const COL_LIMIT: number;
export const CONFIG: Record<string, unknown>;
export type Range = { top: number; left: number; bottom: number; right: number };
/** A column's type in `look` (`type:<colId>`); the page draws "boolean" as a checkbox. */
export type ColumnType = "string" | "number" | "boolean" | "date";
export function rowId(): string;
export function colId(): string;
export function key(row: string, col: string): string;
/** The doc's names of a tab's row and column arrays: `rows`/`cols` for `main`, else `rows:<id>`/`cols:<id>`. */
export function rowsOf(tab: string): string;
export function colsOf(tab: string): string;
export function colName(col: number): string;
export function colIndex(letters: string): number;
export function a1(row: number, col: number): string;
/** Null for text that is no A1 address. */
export function parseA1(text: string): { row: number; col: number } | null;
export function parseRange(text: string): Range | null;
export function rangeA1(range: Range): string;
/** `'My Data'!B2:C5` as { tab: "My Data", range: "B2:C5" }; tab is null where none is said. */
export function parseRef(text: string): { tab: string | null; range: string };
/** A tab's name as a formula writes it before `!` (quoted where it must be). */
export function tabRef(name: string): string;
/** Why a tab cannot have this name, or null. */
export function tabNameFault(name: unknown): string | null;
/** Any text made a name a tab can have. */
export function tabName(name: unknown): string;
export function toCsv(rows: string[][], eol?: string): string;
export function fromCsv(text: string): string[][];
/** A computed value as the file writes it: TRUE/FALSE, an error's code, "" for empty. */
export function valueText(value: unknown): string;
/** `cells`: the cells whose values changed, or null when everything may have (the engine was built again, or the hub's own structure change). */
export type SheetChange = { structure: boolean; cells: { row: number; col: number }[] | null };
/** One tab of a workbook. */
export interface SheetModel {
  /** The whole workbook's engine; `sheet` is this tab's sheet in it. */
  engine: HyperFormula;
  sheet: number;
  readonly id: string | undefined;
  readonly name: string;
  size(): { rows: number; cols: number };
  input(r: number, c: number): string;
  /** What was typed in every cell, row by row ("" where nothing is): a copy. */
  inputs(): string[][];
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
  /** A tab's view stops listening; the first tab's from createSheetModel ends the workbook. */
  destroy(): void;
}
export type Tab = { id: string; name: string; hidden: boolean };
/**
 * POST /v0/document/:id/cells, the tab ops (the hub's alone; a page may also write `hidden:<id>` itself). `tab` is an id or a name. Every other op
 * there (set, fill, insert-rows…) takes an optional `tab` too, and `at`/`range` may name one (`Data!B4`); unsaid, the first tab. A `.csv` sheet given
 * a second tab moves into a workbook folder first. Answered with SheetTabsResult.
 */
export type SheetTabOp =
  | { op: "add-tab"; name: string; at?: number }
  | { op: "rename-tab"; tab: string; name: string }
  | { op: "delete-tab"; tab: string }
  | { op: "move-tab"; tab: string; at: number }
  | { op: "hide-tab"; tab: string; hidden: boolean };
export type SheetTabSize = Tab & { rows: number; cols: number };
/** `tab`: the id of the tab acted on (the new one for add-tab). GET /v0/document/:id?as=tabs answers { tabs } alone. */
export type SheetTabsResult = { tab: string; tabs: SheetTabSize[] };
/**
 * A change to the workbook: `tabs` when tabs were added, deleted, renamed, moved, hidden or shown; `structure` the tabs whose rows or columns
 * changed (every tab when the engine was built again); `cells` as SheetChange's, each with its tab.
 */
export type WorkbookChange = { tabs: boolean; structure: string[]; cells: { tab: string; row: number; col: number }[] | null };
/** The hub's alone. `tab`: a tab's id or name (any case). Names follow a spreadsheet's rules (tabNameFault); a failure is an Error with status 400. */
export type TabOp =
  | ["add", { name: string; at?: number; rows?: number; cols?: number }]
  | ["rename", { tab: string; name: string }]
  | ["delete", { tab: string }]
  | ["move", { tab: string; at: number }]
  | ["hide", { tab: string; hidden: boolean }];
export interface WorkbookModel {
  readonly engine: HyperFormula;
  /** In order, hidden ones too. */
  tabs(): Tab[];
  /** A tab's SheetModel (its own `destroy` only stops its listeners). */
  tab(id: string): SheetModel;
  /** Whichever tab is first. */
  first(): SheetModel;
  /** A tab's id from its id or its name (any case), or null. */
  find(tab: string): string | null;
  tabOfRow(rowId: string): string | undefined;
  tabOfCol(colId: string): string | undefined;
  /** Rows x columns summed over the tabs, the measure WORKBOOK_LIMIT bounds. */
  cellCount(): number;
  onChange(listener: (change: WorkbookChange) => void): () => void;
  /** The hub's alone: SheetModel `structure` in this tab, rewriting formulas in every tab that refer to it. */
  structure(tab: string, op: "insert-rows" | "delete-rows" | "insert-cols" | "delete-cols", at: number, count: number, write?: () => void): { rows: number; cols: number };
  /** The hub's alone. `tab`: the tab acted on (the new one for add). `write` runs in the same change. Adding to a format-1 doc first names its tab after `name`. */
  tabOp<Op extends TabOp>(op: Op[0], args: Op[1], write?: () => void): { tab: string; tabs: Tab[] };
  destroy(): void;
}
/** `name`: what the one tab of a doc with no tabs is called (its file's name); formulas still read it as Sheet1 until a second tab names it. */
export function createWorkbookModel(doc: Y.Doc, options?: { name?: string }): WorkbookModel;
/** The first tab, computed with the whole workbook; its `destroy` ends the workbook. */
export function createSheetModel(doc: Y.Doc): SheetModel;
/** What `serveSheetModel` and `createSheetView` talk over: a Web Worker, its `self`, or a MessagePort. */
export interface SheetPort {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  start?(): void;
}
/** In a worker: computes the workbook whose doc a page's `createSheetView` sends it. */
export function serveSheetModel(port: SheetPort): void;
/** A SheetModel's reads on the page with the engine in a worker; values are null until `ready`. */
export interface SheetView extends Omit<SheetModel, "engine" | "sheet" | "structure" | "name"> {
  ready: Promise<void>;
}
/** The first tab; `tab(id)` another (its `destroy` only stops its listeners), `tabs()` all of them. */
export function createSheetView(doc: Y.Doc, port: SheetPort): SheetView & { tabs(): Tab[]; tab(id: string): SheetView };
