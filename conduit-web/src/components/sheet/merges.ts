/*
 * A tab's merged cells, as its look holds them (`merges:<tabId>`: a list of ranges by their corners' ids, as a filter's, so a merge follows its rows and
 * columns). A merge shows its top-left cell over the whole of it (grid.ts); merging keeps only that cell's value, as a spreadsheet does.
 */
import type * as Y from "yjs";
import { key as cellKey, rangedArea, type SheetRangedLook, type SheetView } from "@/sheet-format.js";
import type { SheetRange } from "./host";

export type SheetMergeKind = "center" | "across" | "cells";
type Corners = Pick<SheetRangedLook, "from" | "to">;

const overlaps = (one: SheetRange, two: SheetRange) => one.top <= two.bottom && two.top <= one.bottom && one.left <= two.right && two.left <= one.right;

export function createSheetMerges(look: Y.Map<number | string>, model: () => SheetView | undefined) {
  const read = (): Corners[] => {
    const id = model()?.id, text = id ? look.get(`merges:${id}`) : undefined;
    if (typeof text !== "string") return [];
    try { const list = JSON.parse(text); return Array.isArray(list) ? list : []; } catch { return []; }
  };
  const list = (): SheetRange[] => { const sheet = model(); return sheet ? read().flatMap((one) => { const area = rangedArea(sheet, one); return area ? [area] : []; }) : []; };
  const save = (ranges: readonly SheetRange[]) => {
    const sheet = model();
    if (!sheet?.id) return;
    const corners = ranges.flatMap((area) => { const ids = [sheet.rowAt(area.top), sheet.colAt(area.left), sheet.rowAt(area.bottom), sheet.colAt(area.right)]; return ids.every(Boolean) ? [{ from: cellKey(ids[0]!, ids[1]!), to: cellKey(ids[2]!, ids[3]!) }] : []; });
    if (corners.length) look.set(`merges:${sheet.id}`, JSON.stringify(corners)); else look.delete(`merges:${sheet.id}`);
  };
  /** The ranges a merge of `range` makes, inside the tab's own cells: one per row for `across`. */
  const made = (range: SheetRange, kind: SheetMergeKind): SheetRange[] => {
    const size = model()?.size();
    if (!size) return [];
    const area = { ...range, bottom: Math.min(range.bottom, size.rows - 1), right: Math.min(range.right, size.cols - 1) };
    const out = kind === "across" ? Array.from({ length: area.bottom - area.top + 1 }, (_, r) => ({ ...area, top: area.top + r, bottom: area.top + r })) : [area];
    return out.filter((one) => one.bottom > one.top || one.right > one.left);
  };
  return {
    list,
    /** The merge a cell is in. */
    at: (row: number, col: number) => list().find((one) => row >= one.top && row <= one.bottom && col >= one.left && col <= one.right),
    /** The cells holding a value a merge of `range` would empty: all but each new merge's top-left. */
    losing: (range: SheetRange, kind: SheetMergeKind) => {
      const sheet = model(), out: { row: number; col: number }[] = [];
      if (sheet) for (const one of made(range, kind)) for (let row = one.top; row <= one.bottom; row++) for (let col = one.left; col <= one.right; col++) if ((row !== one.top || col !== one.left) && sheet.input(row, col) !== "") out.push({ row, col });
      return out;
    },
    /** Merges `range` (the merges it overlaps go), true where it made one. */
    merge: (range: SheetRange, kind: SheetMergeKind) => {
      const added = made(range, kind);
      if (!added.length) return false;
      save([...list().filter((one) => !overlaps(one, range)), ...added]);
      return true;
    },
    /** Takes off every merge `range` overlaps; true where there was one. */
    unmerge: (range: SheetRange) => {
      const now = list(), kept = now.filter((one) => !overlaps(one, range));
      if (kept.length === now.length) return false;
      save(kept);
      return true;
    },
    /** Whether `range` is a merge as it is. */
    is: (range: SheetRange) => list().some((one) => one.top === range.top && one.left === range.left && one.bottom === range.bottom && one.right === range.right),
  };
}
export type SheetMerges = ReturnType<typeof createSheetMerges>;
