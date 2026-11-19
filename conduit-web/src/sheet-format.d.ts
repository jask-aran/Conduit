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
export type Range = { top: number; left: number; bottom: number; right: number };
/** A column's type in `look` (`type:<colId>`); the page draws "boolean" as a checkbox. */
export type ColumnType = "string" | "number" | "boolean" | "date";
/**
 * The keys of `look` that size a tab: a column's width (`width:<colId>`) and a row's height (`height:<rowId>`), in pixels; a row or column with none
 * is the default size. sheet.json writes them by column letter (`width:B`) and row number (`height:5`), per tab.
 */
export type SizeKey = `width:${string}` | `height:${string}`;
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
/** What a typed cell shows until the engine says (null for a formula): a number, a percentage, TRUE/FALSE, or text (a leading `'` dropped). */
export function guess(input: string): number | boolean | string | null;
export function runsOf(list: readonly number[]): number[][];
export function toCsv(rows: string[][], eol?: string, sep?: string): string;
export function fromCsv(text: string, sep?: string): string[][];
/** A computed value as the file writes it: TRUE/FALSE, an error's code, "" for empty. */
export function valueText(value: unknown): string;
/** `cells`: the cells whose values changed, or null when everything may have (the engine was built again, or the hub's own structure change). */
export type SheetChange = { structure: boolean; cells: { row: number; col: number }[] | null };
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
/**
 * POST /v0/document/:id/cells: the rows of `range` (below its first, with `header`) sorted by `column` (its letter), blanks last, as a spreadsheet
 * sorts: only the range's cells move, each with its own look (style, number format), a formula moved as a fill moves it. Rows, their heights and
 * comments stay where they are. The filter is applied again after.
 */
export type SheetSortOp = { op: "sort"; range: string; column: string; descending?: boolean; header?: boolean; tab?: string };
/**
 * `look`'s `filter:<tabId>` and `table:<tabId>`, JSON: a range by its corners (`<rowId>:<colId>`), its first row the header. A filter's `keep` holds,
 * by column id, the values (as valueText writes them, "" for blank) its rows under the header may show; a column without one keeps every row; `hide`
 * is the rows it left out when last applied (filterHides), by id, so every page hides the same ones. A table's `name` is its own; it is drawn with a
 * bold header and banded rows, and turns the filter on over it. sheet.json writes them by A1: `{ range: "A1:D20", keep: { B: ["x"] }, hide: [3, 5] }`.
 */
export type SheetRangedLook = { from: string; to: string; keep?: Record<string, string[]>; when?: Record<string, SheetFilterWhen>; hide?: string[]; name?: string };
/**
 * A filter's condition on a column (`when`, by column id; by letter in sheet.json): text tests case aside, numbers, dates (a date-formatted number or
 * text typed as 2026-01-30; `a` and `b` typed so), and empty. `b`: the other end of a between, both ends kept.
 */
export type SheetFilterTest = "contains" | "not-contains" | "starts" | "ends" | "equals" | "greater" | "less" | "between" | "before" | "after" | "dates" | "empty" | "filled";
export type SheetFilterWhen = { is: SheetFilterTest; a?: string; b?: string };
/** Its range in `view`; null where a corner is gone. */
export function rangedArea(view: Pick<SheetView, "indexOfRow" | "indexOfCol">, ranged: Partial<SheetRangedLook> | null | undefined): Range | null;
/** The rows under a filter's header its kept values leave out, by id: its `hide` as applied now. */
export function filterHides(view: SheetView, filter: SheetRangedLook): string[];
export type SheetTabSize = Tab & { rows: number; cols: number };
/** `tab`: the id of the tab acted on (the new one for add-tab). GET /v0/document/:id?as=tabs answers { tabs } alone. */
export type SheetTabsResult = { tab: string; tabs: SheetTabSize[] };
/** One tab as it is read: what was typed, its rows and columns by id, and its values (sheet-engine.js SheetModel computes them; a page's SheetView is sent them). */
export interface SheetView {
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
  /** Stops its listeners. */
  destroy(): void;
}

/** The internal names createWorkbookModel (sheet-engine.js) shares with the view. */
export const FIRST: "Sheet1";
export function isError(value: unknown): boolean;
export function listed(order: Y.Array<string>): string[];
export const NONE: { id: undefined; rowIds: string[]; colIds: string[]; rowIndex: Map<string, number>; colIndex: Map<string, number>; typed: string[][]; sheet: -1 };
/** A computed value as it crosses from the worker: an error as [code, message]. */
export type SheetValue = string | number | boolean | [code: string, message: string];
export function sent(value: unknown): SheetValue | null;

/** What `serveSheetModel` and `createSheetView` talk over: a Web Worker, its `self`, or a MessagePort. */
export interface SheetPort {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  start?(): void;
}
/** The page to the worker: each update of its doc, the first its whole state. */
export type SheetPageMessage = { update: Uint8Array };
/**
 * The worker to the page. `functions`: the engine's function names, custom ones included, first of all. Values: cells by key (`<rowId>:<colId>`,
 * null for one now empty), in parts; `full` parts together are every value there is (each answer to a change that rebuilt the engine, and the
 * first); the last part of an answer says how many updates the worker has `taken`, and its values hold for the doc as of that update.
 */
export type SheetEngineMessage =
  | { functions: string[] }
  | { at: string[]; value: (SheetValue | null)[]; full?: true; taken?: number };

/** What changed of the workbook as a whole: its tabs, whether it is still computing, the function names. */
export type SheetBookChange = { tabs?: true; computing?: true; functions?: true };
/** A page's workbook with its engine in a worker: WorkbookModel's reads, and how computing stands. */
export interface SheetBook {
  /** Settled once the first values have arrived. */
  ready: Promise<void>;
  /** In order, hidden ones too. */
  tabs(): Tab[];
  /** A tab's view (its `destroy` only stops its listeners). */
  tab(id: string): SheetView;
  /** A tab's id from its id or its name (any case), or null. */
  find(tab: string): string | null;
  tabOfRow(rowId: string): string | undefined;
  /** [] until the worker says. */
  functions(): readonly string[];
  /** True until values hold for every change made to the doc. */
  computing(): boolean;
  onChange(listener: (change: SheetBookChange) => void): () => void;
  /** Stops listening to the doc and the port; the worker is its owner's to end. */
  destroy(): void;
}
/** `name`: what the one tab of a doc with no tabs is called (its file's name). */
export function createSheetView(doc: Y.Doc, port: SheetPort, options?: { name?: string }): SheetBook;
