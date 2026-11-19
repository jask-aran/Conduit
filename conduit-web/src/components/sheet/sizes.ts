/*
 * A tab's row heights and column widths, as its look holds them (`height:<rowId>`, `width:<colId>`, so a size follows its row or column when others
 * are put in), and what sets them: a row's edge dragged beside its number, a key sequence, fitting to what the cells show. A height a fit set is marked
 * `fitted:<rowId>`, so a row fits itself again as its wrapped text changes; one set by hand, or of unknown origin, stays as it is.
 */
import type * as Y from "yjs";
import { valueText, type SheetView, type SizeKey } from "@/sheet-format.js";
import type { SheetGrid, SheetLook } from "./host";

/** The fewest pixels a row or column is given. */
const LEAST = 8;

/** A column's width: its own (`width:<colId>`), else its tab's default (`width:<tabId>`); undefined for the grid's own. A column past the tab's own takes the default. */
export function widthOf(look: Y.Map<number | string>, sheet: SheetView | undefined, col: number): number | undefined {
  const own = sheet?.colAt(col), size = (own && look.get(`width:${own}`)) ?? (sheet?.id && look.get(`width:${sheet.id}`));
  return typeof size === "number" ? size : undefined;
}

/** One tab's sizes. Rows and columns past the tab's own have no ids and keep the default. */
export interface SheetSizes {
  width(col: number): number | undefined;
  /** The tab's default column width, where it has one. */
  standard(): number | undefined;
  /** Sets the default; columns with their own width keep it. */
  setStandard(width: number): void;
  height(row: number): number | undefined;
  /** Every row of the tab whose height is set, by position. */
  heights(): ReadonlyMap<number, number>;
  setWidths(cols: readonly number[], width: number): void;
  setHeights(rows: readonly number[], height: number): void;
  /** Each column as wide as the widest value it shows. */
  fitColumns(cols: readonly number[], look: SheetLook): void;
  /** Each row as tall as its tallest value's lines; one line is the default height. */
  fitRows(rows: readonly number[], look: SheetLook): void;
  /** The rows of these whose height no person set fitted again. */
  refit(rows: readonly number[], look: SheetLook): void;
  /** How many rows and columns stand still at the top and left as the rest scrolls (`freezeRows:<tabId>`, `freezeCols:<tabId>`). */
  freeze(): { rows: number; cols: number };
  setFreeze(rows: number, cols: number): void;
  /** The rows hidden (`hidden:<rowId>`) and those a filter hides, by position. */
  hidden(): ReadonlySet<number>;
  setHidden(rows: readonly number[], hidden: boolean): void;
  /** The columns hidden (`hidden:<colId>`, apart from rows' as ids never repeat), by position. */
  hiddenCols(): ReadonlySet<number>;
  setHiddenCols(cols: readonly number[], hidden: boolean): void;
}

/**
 * `lines`: how many lines a cell's text takes where its style wraps it (styles.ts); unsaid, its own line breaks. `filtered`: the rows a filter hides
 * besides (filter.tsx). `measure`: how wide a cell's text is drawn, in its format and font (0 for none); unsaid, its value in the grid's font.
 */
export function createSheetSizes(look: Y.Map<number | string>, model: () => SheetView | undefined, lines?: (row: number, col: number, text: string, look: SheetLook) => number, filtered?: () => ReadonlySet<number>, sheetMeasure?: (row: number, col: number, look: SheetLook) => number): SheetSizes {
  const keyOf = (what: "width" | "height", id: string): SizeKey => `${what}:${id}`;
  const sized = (what: "width" | "height", id: string | undefined) => { const size = id && look.get(keyOf(what, id)); return typeof size === "number" ? size : undefined; };
  const set = (what: "width" | "height", ids: (string | undefined)[], size: number | null) => look.doc!.transact(() => {
    for (const id of ids) if (id) { if (size === null) look.delete(keyOf(what, id)); else look.set(keyOf(what, id), Math.max(LEAST, Math.round(size))); }
  });
  const hide = (ids: (string | undefined)[], hidden: boolean) => look.doc!.transact(() => { for (const id of ids) if (id) { if (hidden) look.set(`hidden:${id}`, 1); else look.delete(`hidden:${id}`); } });
  let measure: CanvasRenderingContext2D | null = null;
  return {
    width: (col) => widthOf(look, model(), col),
    standard: () => sized("width", model()?.id),
    setStandard: (width) => set("width", [model()?.id], width),
    height: (row) => sized("height", model()?.rowAt(row)),
    heights: () => {
      const sheet = model(), out = new Map<number, number>();
      if (sheet) for (const [name, size] of look.entries()) if (name.startsWith("height:") && typeof size === "number") { const row = sheet.indexOfRow(name.slice(7)); if (row >= 0) out.set(row, size); }
      return out;
    },
    freeze: () => { const id = model()?.id, count = (what: string) => { const n = id && look.get(`${what}:${id}`); return typeof n === "number" ? n : 0; }; return { rows: count("freezeRows"), cols: count("freezeCols") }; },
    setFreeze: (rows, cols) => { const id = model()?.id; if (id) look.doc!.transact(() => { for (const [what, n] of [["freezeRows", rows], ["freezeCols", cols]] as const) if (n > 0) look.set(`${what}:${id}`, n); else look.delete(`${what}:${id}`); }); },
    hidden: () => {
      const sheet = model(), out = new Set<number>(filtered?.());
      if (sheet) for (const name of look.keys()) if (name.startsWith("hidden:")) { const row = sheet.indexOfRow(name.slice(7)); if (row >= 0) out.add(row); }
      return out;
    },
    setHidden: (rows, hidden) => hide(rows.map((row) => model()?.rowAt(row)), hidden),
    hiddenCols: () => {
      const sheet = model(), out = new Set<number>();
      if (sheet) for (const name of look.keys()) if (name.startsWith("hidden:")) { const col = sheet.indexOfCol(name.slice(7)); if (col >= 0) out.add(col); }
      return out;
    },
    setHiddenCols: (cols, hidden) => hide(cols.map((col) => model()?.colAt(col)), hidden),
    // A width given a hidden column shows it again, as a spreadsheet's: its edge dragged open, or a width typed over it.
    setWidths: (cols, width) => look.doc!.transact(() => { const ids = cols.map((col) => model()?.colAt(col)); set("width", ids, width); hide(ids, false); }),
    setHeights: (rows, height) => look.doc!.transact(() => { const ids = rows.map((row) => model()?.rowAt(row)); set("height", ids, height); for (const id of ids) if (id) look.delete(`fitted:${id}`); }),
    fitColumns: (cols, sheetLook) => {
      const sheet = model();
      measure ??= document.createElement("canvas").getContext("2d");
      if (!sheet || !measure) return;
      measure.font = `${sheetLook.grid.baseFontStyle} ${sheetLook.grid.fontFamily}`;
      const padding = 2 * Number(sheetLook.grid.cellHorizontalPadding), rows = sheet.size().rows;
      look.doc!.transact(() => {
        for (const col of cols) {
          let widest = 0;
          for (let row = 0; row < rows; row++) { if (sheetMeasure) { widest = Math.max(widest, sheetMeasure(row, col, sheetLook)); continue; } const shown = valueText(sheet.value(row, col)); if (shown) widest = Math.max(widest, measure!.measureText(shown).width); }
          set("width", [sheet.colAt(col)], widest ? Math.ceil(widest + padding) : null);
        }
      });
    },
    refit(rows, sheetLook) { const sheet = model(); this.fitRows(rows.filter((row) => { const id = sheet?.rowAt(row); return id && (!look.has(`height:${id}`) || look.has(`fitted:${id}`)); }), sheetLook); },
    fitRows: (rows, sheetLook) => {
      const sheet = model();
      if (!sheet) return;
      const line = parseFloat(String(sheetLook.grid.editorFontSize)) * Number(sheetLook.grid.lineHeight), padding = 2 * Number(sheetLook.grid.cellVerticalPadding), cols = sheet.size().cols;
      look.doc!.transact(() => {
        for (const row of rows) {
          let most = 1;
          for (let col = 0; col < cols; col++) { const text = valueText(sheet.value(row, col)); if (text) most = Math.max(most, lines ? lines(row, col, text, sheetLook) : text.split("\n").length); }
          const id = sheet.rowAt(row), height = most > 1 ? Math.max(sheetLook.row, Math.ceil(most * line + padding)) : null;
          if (id && look.get(`height:${id}`) !== (height ?? undefined)) set("height", [id], height);
          if (id && height && !look.has(`fitted:${id}`)) look.set(`fitted:${id}`, 1); else if (id && !height && look.has(`fitted:${id}`)) look.delete(`fitted:${id}`);
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
