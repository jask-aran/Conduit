/*
 * Cell styles on the page: each cell's style from the look (sheet-styles.js), indexed as it changes so the grid finds a drawn cell's in a few map reads,
 * one object for each mix of column, row and own style; and the selection's style set from the ribbon, the menu and Excel's keys.
 */
import { createSignal, onCleanup, type Accessor } from "solid-js";
import type * as Y from "yjs";
import { key, valueText, type SheetView } from "@/sheet-format.js";
import { decodeStyle, writeStyle, type SheetBorders, type SheetHex, type SheetInk, type SheetStyle, type StyleAttrs } from "@/sheet-styles.js";
import type { SheetLook, SheetRange } from "./host";
import { widthOf } from "./sizes";
import { wrapLines } from "./wrap";

/**
 * What a cell is drawn with, its column's, row's and own style together. `color`, `fill` and `edgeColor`: an ink or a workbook's `#rrggbb`. `edges`: top 1,
 * right 2, bottom 4, left 8, `edgeWeight` px wide. `size`: points. `custom`: the grid draws its text itself (cell-draw.ts).
 */
export type SheetCellStyle = { bold: boolean; italic: boolean; underline: boolean; strike: boolean; wrap: boolean; color?: SheetInk | SheetHex; fill?: SheetInk | SheetHex; align?: "left" | "center" | "right"; valign: "top" | "middle" | "bottom"; edges: number; edgeColor?: SheetHex; edgeWeight: number; size?: number; custom: boolean };
export const PLAIN: SheetCellStyle = { bold: false, italic: false, underline: false, strike: false, wrap: false, valign: "middle", edges: 0, edgeWeight: 1, custom: false };
const WEIGHTS: Readonly<Record<string, number>> = { medium: 2, thick: 3 };
/** The grid's text size (`13px`) for a cell of `points`: the sheet's text is the 11 points a workbook's is by default. */
export const textSize = (base: string, points?: number) => points ? `${Math.round(parseFloat(base) * points / 11 * 10) / 10}px` : base;
// Excel's: Ctrl with B, I, U, and 5 for a line through.
const KEYS: Readonly<Record<string, "bold" | "italic" | "underline" | "strike">> = { KeyB: "bold", KeyI: "italic", KeyU: "underline", Digit5: "strike" };

export interface SheetStyles {
  /** A drawn cell's style; undefined for none. Not tracked: read as the grid draws. */
  at(row: number, col: number): SheetCellStyle | undefined;
  /** What a cell wears (none: plain), tracked where it is read, for the ribbon. */
  worn(row: number, col: number): SheetCellStyle;
  /** Only what `style` names changes: whole columns (top to the tab's last row) or rows (its first column to its last) their own, else each cell. */
  set(range: SheetRange, style: SheetStyle): void;
  borders(range: SheetRange, kind: SheetBorders): void;
  /** Every style the range wears its own, borders too, taken off (Clear formatting). */
  clear(range: SheetRange): void;
  /** Ctrl with B, I, U or 5 toggles that on the range, from what its first cell wears. True when taken. */
  key(event: KeyboardEvent, range: SheetRange | null): boolean;
  /** How many lines a cell's text takes: wrapped to its column's width where it wraps (sizes.ts fits a row by it). */
  lines(row: number, col: number, text: string, look: SheetLook): number;
  /** The rows of the range a wrapped cell would need more than one line in. */
  taller(range: SheetRange, look: SheetLook): number[];
}

export function createSheetStyles(look: Y.Map<number | string>, model: Accessor<SheetView | undefined>, failed: (message: string) => void): SheetStyles {
  // A column's or row's by its id (ids are unique across the doc), a cell's by "<rowId>:<colId>".
  const lines = new Map<string, StyleAttrs>(), cells = new Map<string, StyleAttrs>(), [changed, setChanged] = createSignal(0);
  const NONE: StyleAttrs = {};
  let mixed = new Map<StyleAttrs, Map<StyleAttrs, Map<StyleAttrs, SheetCellStyle | null>>>();
  const index = (name: string) => {
    if (!name.startsWith("style:")) return false;
    const at = name.slice(6), text = look.get(name), to = at.includes(":") ? cells : lines;
    if (typeof text === "string") to.set(at, decodeStyle(text)); else to.delete(at);
    return true;
  };
  for (const name of look.keys()) index(name);
  const observe = (event: Y.YMapEvent<number | string>) => { let any = false; for (const name of event.keysChanged) any = index(name) || any; if (any) { mixed = new Map(); setChanged((n) => n + 1); } };
  look.observe(observe);
  onCleanup(() => look.unobserve(observe));

  const make = (attrs: StyleAttrs): SheetCellStyle | null => {
    const on = (code: keyof StyleAttrs) => attrs[code] === true, edges = (on("bt") ? 1 : 0) | (on("br") ? 2 : 0) | (on("bb") ? 4 : 0) | (on("bl") ? 8 : 0);
    const style: SheetCellStyle = { bold: on("b"), italic: on("i"), underline: on("u"), strike: on("s"), wrap: on("w"), color: (attrs.c ?? undefined) as SheetCellStyle["color"], fill: (attrs.f ?? undefined) as SheetCellStyle["fill"],
      align: (attrs.h ?? undefined) as SheetCellStyle["align"], valign: (attrs.v ?? "middle") as SheetCellStyle["valign"], edges, edgeColor: (attrs.bc ?? undefined) as SheetHex | undefined, edgeWeight: WEIGHTS[attrs.bw ?? ""] ?? 1,
      size: attrs.z ? Number(attrs.z) : undefined, custom: false };
    style.custom = style.wrap || style.underline || style.strike || style.valign !== "middle";
    return style.custom || style.bold || style.italic || style.color || style.fill || style.align || style.size || edges ? style : null;
  };
  // Each mix made once, by the three styles' own objects, so a frame's draws make nothing new (formats.ts says why).
  const mix = (col: StyleAttrs, row: StyleAttrs, own: StyleAttrs) => {
    let byRow = mixed.get(col);
    if (!byRow) mixed.set(col, byRow = new Map());
    let byOwn = byRow.get(row);
    if (!byOwn) byRow.set(row, byOwn = new Map());
    let made = byOwn.get(own);
    if (made === undefined) byOwn.set(own, made = make({ ...col, ...row, ...own }));
    return made ?? undefined;
  };
  const at = (row: number, col: number) => {
    if (!lines.size && !cells.size) return undefined;
    const sheet = model(), colId = sheet?.colAt(col), rowId = sheet?.rowAt(row);
    const column = colId ? lines.get(colId) : undefined, across = rowId ? lines.get(rowId) : undefined, own = cells.size && rowId && colId ? cells.get(key(rowId, colId)) : undefined;
    return column || across || own ? mix(column ?? NONE, across ?? NONE, own ?? NONE) : undefined;
  };
  const worn = (row: number, col: number) => { changed(); return at(row, col) ?? PLAIN; };
  const write = (range: SheetRange, change: { style?: SheetStyle; borders?: SheetBorders }) => {
    const sheet = model();
    if (!sheet) return;
    const { rows, cols } = sheet.size(), whole = range.top === 0 && range.bottom >= rows - 1 ? "cols" : range.left === 0 && range.right >= cols - 1 ? "rows" : null;
    try { look.doc!.transact(() => writeStyle(look, sheet, range, change, whole)); } catch (error) { failed((error as Error).message); }
  };
  let measure: CanvasRenderingContext2D | null = null;
  const count = (row: number, col: number, text: string, sheetLook: SheetLook) => {
    const style = at(row, col);
    if (!style?.wrap) return text.split("\n").length;
    measure ??= document.createElement("canvas").getContext("2d");
    if (!measure) return 1;
    const width = widthOf(look, model(), col), [weight, size] = String(sheetLook.grid.baseFontStyle).split(" ") as [string, string];
    const font = `${style.italic ? "italic " : ""}${style.bold ? sheetLook.strong : weight} ${textSize(size, style.size)} ${sheetLook.grid.fontFamily}`;
    measure.font = font;
    return wrapLines(measure, text, font, (width ?? sheetLook.width) - 2 * Number(sheetLook.grid.cellHorizontalPadding)).length;
  };
  return {
    at, worn,
    set: (range, style) => write(range, { style }),
    borders: (range, kind) => write(range, { borders: kind }),
    clear: (range) => write(range, { style: { bold: false, italic: false, underline: false, strike: false, wrap: false, color: null, fill: null, align: null, valign: null, size: null, borderColor: null, borderWeight: null }, borders: "none" }),
    key: (event, range) => {
      // As a spreadsheet's: Ctrl+Shift+& draws the range's outline, Ctrl+Shift+_ takes its borders off.
      const edge = (event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey ? ({ Digit7: "outer", Minus: "none" } as const)[event.code as "Digit7" | "Minus"] : undefined;
      if (edge && range) { event.preventDefault(); write(range, { borders: edge }); return true; }
      const name = (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey ? KEYS[event.code] : undefined;
      if (!name || !range) return false;
      event.preventDefault();
      write(range, { style: { [name]: !worn(range.top, range.left)[name] } });
      return true;
    },
    lines: count,
    taller: (range, sheetLook) => {
      const sheet = model(), out: number[] = [];
      if (!sheet) return out;
      const { rows, cols } = sheet.size();
      for (let row = range.top; row <= Math.min(range.bottom, rows - 1); row++) {
        for (let col = 0; col < cols; col++) if (at(row, col)?.wrap && count(row, col, valueText(sheet.value(row, col)), sheetLook) > 1) { out.push(row); break; }
      }
      return out;
    },
  };
}
