import type { HyperFormula } from "hyperformula";
import type * as Y from "yjs";
import type { SheetPort, SheetView, Tab } from "./sheet-format.js";

export const CONFIG: Record<string, unknown>;
/** One tab of a workbook, computed by the engine here: a SheetView with the engine and the hub's structure changes. */
export interface SheetModel extends SheetView {
  /** The whole workbook's engine; `sheet` is this tab's sheet in it. */
  engine: HyperFormula;
  sheet: number;
  /** The hub's alone. */
  structure(op: "insert-rows" | "delete-rows" | "insert-cols" | "delete-cols", at: number, count: number, write?: () => void): { rows: number; cols: number };
  /** A tab's view stops listening; the first tab's from createSheetModel ends the workbook. */
  destroy(): void;
}
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
export function createWorkbookModel(doc: Y.Doc, options?: { name?: string; owner?: boolean }): WorkbookModel;
/** The first tab, computed with the whole workbook; its `destroy` ends the workbook. */
export function createSheetModel(doc: Y.Doc): SheetModel;
/** In a worker: computes the workbook whose doc a page's `createSheetView` posts it, answering with SheetEngineMessage. */
export function serveSheetModel(port: SheetPort): void;
