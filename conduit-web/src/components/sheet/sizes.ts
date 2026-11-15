/*
 * A tab's row heights and column widths, as its look holds them (`height:<rowId>`, `width:<colId>`, so a size follows its row or column when others
 * are put in), and what sets them: a row's edge dragged beside its number, a key sequence, fitting to what the cells show.
 */
import type * as Y from "yjs";
import { valueText, type SheetView, type SizeKey } from "@/sheet-format.js";
import type { SheetGrid, SheetLook } from "./host";

/** The fewest pixels a row or column is given. */
const LEAST = 8;

/** One tab's sizes. Rows and columns past the tab's own have no ids and keep the default. */
export interface SheetSizes {
  width(col: number): number | undefined;
  height(row: number): number | undefined;
  /** Every row of the tab whose height is set, by position. */
  heights(): ReadonlyMap<number, number>;
  setWidths(cols: readonly number[], width: number): void;
  setHeights(rows: readonly number[], height: number): void;
  /** Each column as wide as the widest value it shows. */
  fitColumns(cols: readonly number[], look: SheetLook): void;
  /** Each row as tall as its tallest value's lines; one line is the default height. */
  fitRows(rows: readonly number[], look: SheetLook): void;
}

/** `lines`: how many lines a cell's text takes where its style wraps it (styles.ts); unsaid, its own line breaks. */
export function createSheetSizes(look: Y.Map<number | string>, model: () => SheetView | undefined, lines?: (row: number, col: number, text: string, look: SheetLook) => number): SheetSizes {
  const keyOf = (what: "width" | "height", id: string): SizeKey => `${what}:${id}`;
  const sized = (what: "width" | "height", id: string | undefined) => { const size = id && look.get(keyOf(what, id)); return typeof size === "number" ? size : undefined; };
  const set = (what: "width" | "height", ids: (string | undefined)[], size: number | null) => look.doc!.transact(() => {
    for (const id of ids) if (id) { if (size === null) look.delete(keyOf(what, id)); else look.set(keyOf(what, id), Math.max(LEAST, Math.round(size))); }
  });
  let measure: CanvasRenderingContext2D | null = null;
  return {
    width: (col) => sized("width", model()?.colAt(col)),
    height: (row) => sized("height", model()?.rowAt(row)),
    heights: () => {
      const sheet = model(), out = new Map<number, number>();
      if (sheet) for (const [name, size] of look.entries()) if (name.startsWith("height:") && typeof size === "number") { const row = sheet.indexOfRow(name.slice(7)); if (row >= 0) out.set(row, size); }
      return out;
    },
    setWidths: (cols, width) => set("width", cols.map((col) => model()?.colAt(col)), width),
    setHeights: (rows, height) => set("height", rows.map((row) => model()?.rowAt(row)), height),
    fitColumns: (cols, sheetLook) => {
      const sheet = model();
      measure ??= document.createElement("canvas").getContext("2d");
      if (!sheet || !measure) return;
      measure.font = `${sheetLook.grid.baseFontStyle} ${sheetLook.grid.fontFamily}`;
      const padding = 2 * Number(sheetLook.grid.cellHorizontalPadding), rows = sheet.size().rows;
      look.doc!.transact(() => {
        for (const col of cols) {
          let widest = 0;
          for (let row = 0; row < rows; row++) { const shown = valueText(sheet.value(row, col)); if (shown) widest = Math.max(widest, measure!.measureText(shown).width); }
          set("width", [sheet.colAt(col)], widest ? Math.ceil(widest + padding) : null);
        }
      });
    },
    fitRows: (rows, sheetLook) => {
      const sheet = model();
      if (!sheet) return;
      const line = parseFloat(String(sheetLook.grid.editorFontSize)) * Number(sheetLook.grid.lineHeight), padding = 2 * Number(sheetLook.grid.cellVerticalPadding), cols = sheet.size().cols;
      look.doc!.transact(() => {
        for (const row of rows) {
          let most = 1;
          for (let col = 0; col < cols; col++) { const text = valueText(sheet.value(row, col)); if (text) most = Math.max(most, lines ? lines(row, col, text, sheetLook) : text.split("\n").length); }
          set("height", [sheet.rowAt(row)], most > 1 ? Math.max(sheetLook.row, Math.ceil(most * line + padding)) : null);
        }
      });
    },
  };
}

/** A row's lower edge beside its number, dragged, sizes the row: drawn as it moves, `done` with its height when let go. The grid never sees the press. */
export function dragRowEdges(into: HTMLElement, grid: () => SheetGrid | undefined, done: (row: number, height: number) => void) {
  let drag: { row: number; top: number } | null = null, height = 0, taking = false;
  const hover = (event: PointerEvent) => {
    if (drag || event.buttons) return;
    if (grid()?.rowEdge(event.clientX, event.clientY)) into.dataset.rowEdge = ""; else delete into.dataset.rowEdge;
  };
  const move = (event: PointerEvent) => { if (!drag) return; height = Math.max(LEAST, Math.round(event.clientY - drag.top)); grid()?.height(drag.row, height); };
  const up = () => {
    removeEventListener("pointermove", move, true); removeEventListener("pointerup", up, true);
    if (drag && height) done(drag.row, height);
    drag = null; height = 0;
  };
  const press = (event: PointerEvent) => {
    taking = false;
    const edge = event.button === 0 ? grid()?.rowEdge(event.clientX, event.clientY) : null;
    if (!edge) return;
    drag = edge; taking = true; event.stopPropagation();
    addEventListener("pointermove", move, true); addEventListener("pointerup", up, true);
  };
  const hold = (event: MouseEvent) => { if (taking) { event.preventDefault(); event.stopPropagation(); } };
  const kinds = ["mousedown", "mouseup", "click"] as const;
  into.addEventListener("pointermove", hover, true); into.addEventListener("pointerdown", press, true);
  for (const kind of kinds) into.addEventListener(kind, hold, true);
  return () => { up(); into.removeEventListener("pointermove", hover, true); into.removeEventListener("pointerdown", press, true); for (const kind of kinds) into.removeEventListener(kind, hold, true); };
}
