/*
 * The grid: a canvas-drawn data grid, which is a React component, mounted as an island in what Solid draws. Only
 * the sheet editor imports this, lazily, so React and the grid never reach the app's first load. TSX here compiles
 * to Solid, so the island is written with createElement.
 */
import { CompactSelection, DataEditor, GridCellKind, type DataEditorProps, type DataEditorRef, type GridCell, type GridSelection, type Item, type Rectangle, type Theme } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { createElement, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { colName, type SheetModel, COL_LIMIT } from "@/sheet-format.js";
import type { SheetBox, SheetGrid, SheetGridEvents, SheetLook, SheetRange } from "./host";

/** What the grid reads of the sheet besides its cells: each column's width and type (`look`). */
export type SheetColumns = { width(col: number): number | undefined; type(col: number): string | undefined };
type GridOptions = { model: SheetModel; columns: SheetColumns; events: SheetGridEvents; look: SheetLook };

const NO_SELECTION: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };
const EMPTY: GridCell = { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: true, copyData: "" };
// Most numbers are short as they are; only a long one (0.1 + 0.2) is cut to what a sheet shows.
const shown = (value: string | number | boolean | null) => { if (typeof value !== "number") return value === null ? "" : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : value; const text = String(value); return text.length > 12 ? String(Number(value.toPrecision(12))) : text; };
const rect = (range: SheetRange): Rectangle => ({ x: range.left, y: range.top, width: range.right - range.left + 1, height: range.bottom - range.top + 1 });
const range = (box: Rectangle): SheetRange => ({ top: box.y, left: box.x, bottom: box.y + box.height - 1, right: box.x + box.width - 1 });
const edges = (picked: CompactSelection): [number, number] | null => { const all = picked.toArray(); return all.length ? [Math.min(...all), Math.max(...all)] : null; };

/** The cells a selection covers: a range, or whole rows or columns. */
/** The empty rows and columns drawn past the sheet's own, and the fewest ever drawn. */
const ROOM = { rows: 50, cols: 10, least: { rows: 100, cols: 26 } };
const selected = (selection: GridSelection, size: { rows: number; cols: number }): SheetRange | null => {
  if (selection.current) return range(selection.current.range);
  const cols = edges(selection.columns), rows = edges(selection.rows);
  if (cols) return { top: 0, bottom: size.rows - 1, left: cols[0], right: cols[1] };
  if (rows) return { top: rows[0], bottom: rows[1], left: 0, right: size.cols - 1 };
  return null;
};

/** Mounts the grid in `element` and gives the editor its controls; the grid's whole state is here, kept as React's. */
export function mountGrid(element: HTMLElement, options: GridOptions): SheetGrid {
  const { model, events } = options;
  /** What a cell shows; what was typed into it is read only when the grid asks (editing, copying), since drawing never does. */
  class TextCell {
    readonly kind = GridCellKind.Text; readonly allowOverlay = true;
    constructor(private row: number, private col: number, private typed: string | null, readonly displayData: string, readonly contentAlign?: "right", readonly themeOverride?: Partial<Theme>) {}
    get data() { return this.typed ??= model.input(this.row, this.col); }
    get copyData() { return this.data; }
  }
  // Typing into a cell opens the grid's own editor, which is drawn into an element of this id.
  if (!document.getElementById("portal")) document.body.append(Object.assign(document.createElement("div"), { id: "portal" }));
  let editor: DataEditorRef | null = null, view: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  // Set as the component mounts: the editor drives the island through these.
  const drive: { select?(selection: GridSelection): void; width?(col: number, width: number): void; marks?(list: DataEditorProps["highlightRegions"]): void; look?(look: SheetLook): void; structure?(): void } = {};
  let look = options.look;

  // The grid runs on past what the sheet holds, as a spreadsheet's does: a cell written out there makes the sheet reach it (the hub's `set`).
  const reach = () => { const held = model.size(); return { rows: Math.max(held.rows + ROOM.rows, ROOM.least.rows), cols: Math.min(COL_LIMIT, Math.max(held.cols + ROOM.cols, ROOM.least.cols)) }; };
  let size = reach(), current = NO_SELECTION;
  const write = (list: { row: number; col: number; input: string }[]) => { if (list.length) events.write(list); };
  // Made once: a new function or object for the grid on each render has it work everything out again, the cost of each arrow-key move.
  const handlers: Partial<DataEditorProps> = {
    onGridSelectionChange: (next) => { drive.select?.(next); events.selected(selected(next, size)); },
    onCellsEdited: (cells) => {
      write(cells.map(({ location: [col, row], value }) => ({ row, col, input: value.kind === GridCellKind.Boolean ? (value.data ? "TRUE" : "FALSE") : value.kind === GridCellKind.Text ? value.data : "" })));
      return true;
    },
    onPaste: (target, values) => {
      const [col, row] = target, bottom = row + values.length - 1, right = col + Math.max(...values.map((line) => line.length)) - 1;
      if (bottom >= model.size().rows || right >= model.size().cols) events.fill({ top: row, left: col, bottom, right }, values.map((line) => [...line]));
      else write(values.flatMap((line, y) => line.map((input, x) => ({ row: row + y, col: col + x, input }))));
      return false;
    },
    onDelete: (cleared) => {
      const area = selected(cleared, size), list: { row: number; col: number; input: string }[] = [];
      if (area) for (let row = area.top; row <= area.bottom; row++) for (let col = area.left; col <= area.right; col++) if (model.input(row, col)) list.push({ row, col, input: "" });
      write(list);
      return false;
    },
    // A fill is the hub's, so a formula's references move per cell as a spreadsheet's fill does.
    onFillPattern: ({ patternSource, fillDestination, preventDefault }) => {
      preventDefault();
      const source = range(patternSource);
      events.fill(range(fillDestination), Array.from({ length: patternSource.height }, (_, y) => Array.from({ length: patternSource.width }, (_, x) => model.input(source.top + y, source.left + x))));
    },
    onColumnResize: (_, width, col) => drive.width?.(col, width),
    onColumnResizeEnd: (_, width, col) => events.resized(col, width),
    onHeaderContextMenu: (col) => { const area = selected(current, size); events.menu({ cols: current.columns.hasIndex(col) && area ? area : { top: 0, bottom: 0, left: col, right: col } }); },
    onCellContextMenu: ([col, row]) => {
      const area = selected(current, size), inside = area && row >= area.top && row <= area.bottom && (col < 0 || (col >= area.left && col <= area.right));
      const rows = inside ? { ...area, left: 0, right: 0 } : { top: row, bottom: row, left: 0, right: 0 }, cols = inside && col >= 0 ? { ...area, top: 0, bottom: 0 } : { top: 0, bottom: 0, left: col, right: col };
      events.menu(col < 0 ? { rows } : { rows, cols });
    },
    onCellClicked: ([col, row]) => events.pressed(row, col),
    onVisibleRegionChanged: (region) => { view = region; events.moved(); },
    rowMarkers: "number", smoothScrollX: true, smoothScrollY: true, width: "100%", height: "100%", fillHandle: true, getCellsForSelection: true, keybindings: { search: false },
    // The grid's own description of every cell for a screen reader is rebuilt on each move and scroll. Drawn off screen and copied whole, an
    // arrow-key move that scrolls costs a third less and a wheel step half (measured: p95 8.6 to 5.7 ms, 6.4 to 2.5 ms).
    experimental: { disableAccessibilityTree: true, renderStrategy: "double-buffer" },
  };
  const made = (instance: DataEditorRef | null) => { editor = instance; };

  function Grid() {
    const [selection, setSelection] = useState<GridSelection>(NO_SELECTION), [marks, setMarks] = useState<DataEditorProps["highlightRegions"]>(), [shape, setShape] = useState(0), [theme, setTheme] = useState(look);
    const [widths, setWidths] = useState<Record<number, number>>({});
    current = selection;
    useEffect(() => {
      drive.select = setSelection; drive.marks = setMarks; drive.look = setTheme; drive.width = (col, width) => setWidths((was) => ({ ...was, [col]: width }));
      drive.structure = () => { size = reach(); setWidths({}); setShape((n) => n + 1); };
      // Mounted, the grid has drawn in its layout effects; the frame after is on screen.
      requestAnimationFrame(() => events.drawn());
    }, []);
    const { rows, cols } = size;
    const columns = useMemo(() => Array.from({ length: cols }, (_, col) => ({ id: model.colAt(col) ?? String(col), title: colName(col), width: widths[col] ?? options.columns.width(col) ?? theme.width })), [shape, cols, widths, theme]);
    const types = useMemo(() => Array.from({ length: cols }, (_, col) => options.columns.type(col)), [shape, cols]);
    const content = useMemo(() => {
      const error = { textDark: theme.error };
      return ([col, row]: Item): GridCell => {
        const value = model.value(row, col), type = types[col];
        if (type === "boolean") return { kind: GridCellKind.Boolean, data: value === true, allowOverlay: false, copyData: model.input(row, col) };
        // An empty value is an empty cell but for a formula that gives nothing.
        const input = value === null || typeof value === "string" ? model.input(row, col) : null;
        if (input === "") return EMPTY;
        // An error is shown by its code, as the engine names it; only a value that could be one is asked whether it is.
        const fault = typeof value === "string" && value.startsWith("#") && model.error(row, col) !== null;
        return new TextCell(row, col, input, shown(value), typeof value === "number" || type === "number" ? "right" : undefined, fault ? error : undefined);
      };
    }, [types, theme]);
    const props: DataEditorProps = { ...handlers, columns, rows, getCellContent: content, theme: theme.grid as Partial<Theme>, rowHeight: theme.row, headerHeight: theme.header, gridSelection: selection, highlightRegions: marks };
    return createElement(DataEditor, { ...props, ref: made });
  }

  const root = createRoot(element);
  root.render(createElement(Grid));
  const box = (col: number, row: number) => editor?.getBounds(col, row);
  return {
    update: (changed) => {
      if (!changed) return drive.structure?.();
      // Only what is in view is drawn again; the rest is read as it scrolls in.
      const near = changed.filter(({ row, col }) => row >= view.y && row < view.y + view.height + 1 && col >= view.x && col < view.x + view.width + 1);
      if (near.length) editor?.updateCells(near.map(({ row, col }) => ({ cell: [col, row] })));
    },
    select: (to, scroll) => {
      drive.select?.(to ? { columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [to.left, to.top], range: rect(to), rangeStack: [] } } : NO_SELECTION);
      events.selected(to);
      if (to && scroll) editor?.scrollTo(to.left, to.top, "both", 0, 0, { vAlign: "center", hAlign: "center" });
    },
    highlight: (list) => drive.marks?.(list.length ? list.map((one) => ({ color: one.current ? look.markCurrent : look.mark, range: rect(one.range), style: one.current ? "solid-outline" : "no-outline" })) : undefined),
    bounds: (area) => {
      const first = box(area.left, area.top), last = box(area.right, area.bottom), numbers = box(-1, area.top), frame = element.getBoundingClientRect();
      if (!first || !last || !numbers) return null;
      // Clipped to the cells' part of the grid, under the header and beside the row numbers.
      const left = Math.max(first.x, numbers.x + numbers.width), top = Math.max(first.y, frame.top + look.header), right = Math.min(last.x + last.width, frame.right), bottom = Math.min(last.y + last.height, frame.bottom);
      return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } satisfies SheetBox : null;
    },
    cellAt: (x, y) => {
      let col = -1, row = -1;
      for (let at = view.x; at < view.x + view.width + 1 && col < 0; at++) { const cell = box(at, view.y); if (cell && x >= cell.x && x < cell.x + cell.width) col = at; }
      for (let at = view.y; at < view.y + view.height + 1 && row < 0; at++) { const cell = box(view.x, at); if (cell && y >= cell.y && y < cell.y + cell.height) row = at; }
      return col < 0 || row < 0 ? null : { row, col };
    },
    theme: (next) => { look = next; drive.look?.(look); },
    focus: () => editor?.focus(),
    destroy: () => root.unmount(),
  };
}
