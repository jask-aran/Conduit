/*
 * The grid: a canvas-drawn data grid, which is a React component, mounted as an island in what Solid draws. Only
 * the sheet editor imports this, lazily, so React and the grid never reach the app's first load. TSX here compiles
 * to Solid, so the island is written with createElement.
 */
import { CompactSelection, DataEditor, GridCellKind, type DataEditorProps, type DataEditorRef, type GridCell, type GridSelection, type Item, type Rectangle, type Theme } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { createElement, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { colName, type SheetView, COL_LIMIT } from "@/sheet-format.js";
import { createCellLook } from "./cell-draw";
import type { SheetDrawn } from "./formats";
import type { SheetCellStyle } from "./styles";
import type { SheetBox, SheetGrid, SheetGridEvents, SheetLook, SheetRange, SheetReference } from "./host";

/** What the grid reads of the sheet besides its cells: each column's width and type, the rows whose height is not the default (`look`), a value as its cell's number format draws it (formats.ts), a cell's style (styles.ts), and whether an import froze it. */
export type SheetColumns = { width(col: number): number | undefined; type(col: number): string | undefined; heights(): ReadonlyMap<number, number>; draw(row: number, col: number, value: number | string): SheetDrawn | null; style(row: number, col: number): SheetCellStyle | undefined; frozen(row: number, col: number): boolean ; freeze(): { rows: number; cols: number } };
// How near a row's lower edge, beside its number, a press takes the edge to drag.
const EDGE_SLOP = 3;
// How often (ms) a drag held past the grid's edge scrolls it on by a column.
const SWEEP_STEP = 60;
// How near a column's side (px) a press takes the edge to size it: the grid's own reach.
const COL_EDGE = 5;
type GridOptions = { model: SheetView; columns: SheetColumns; events: SheetGridEvents; look: SheetLook };
type Highlight = NonNullable<DataEditorProps["highlightRegions"]>[number];

const NO_SELECTION: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };
// No cell opens the grid's own editor: the sheet's formula editor (formula-editor.tsx) edits every one, so a key typed as it opens is never lost.
const EMPTY: GridCell = { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false, copyData: "" };
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
    readonly kind = GridCellKind.Text; readonly allowOverlay = false;
    constructor(private row: number, private col: number, private typed: string | null, readonly displayData: string, readonly contentAlign?: "left" | "center" | "right", readonly themeOverride?: Partial<Theme>, readonly worn?: SheetCellStyle, readonly frozen?: boolean) {}
    get data() { return this.typed ??= model.input(this.row, this.col); }
    get copyData() { return this.data; }
  }
  // Typing into a cell opens the grid's own editor, which is drawn into an element of this id.
  if (!document.getElementById("portal")) document.body.append(Object.assign(document.createElement("div"), { id: "portal" }));
  let editor: DataEditorRef | null = null, view: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  // Set as the component mounts: the editor drives the island through these.
  const drive: { select?(selection: GridSelection): void; width?(col: number, width: number): void; height?(row: number, height: number): void; marks?(list: DataEditorProps["highlightRegions"]): void; look?(look: SheetLook): void; structure?(): void } = {};
  let look = options.look, comments: Highlight[] = [], references: Highlight[] = [];
  const marks = () => drive.marks?.(comments.length || references.length ? [...references, ...comments] : undefined);

  // The grid runs on past what the sheet holds, as a spreadsheet's does: a cell written out there makes the sheet reach it (the hub's `set`).
  const reach = () => { const held = model.size(); return { rows: Math.max(held.rows + ROOM.rows, ROOM.least.rows), cols: Math.min(COL_LIMIT, Math.max(held.cols + ROOM.cols, ROOM.least.cols)) }; };
  let size = reach(), current = NO_SELECTION, frozenCols = 0;
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
    // A press on the cell already selected moves nothing, so the grid would not take the keyboard back from the pane, which takes it on any press.
    onCellClicked: ([col, row]) => { editor?.focus(); events.pressed(row, col); },
    onCellActivated: ([col, row]) => events.activated(row, col),
    onKeyDown: (event) => { const cell = current.current?.cell; if (cell && events.key(event, cell[1], cell[0])) event.cancel(); },
    editOnType: false, cellActivationBehavior: "double-click",
    onVisibleRegionChanged: (region) => { view = region; events.moved(); },
    // Its own Ctrl+Space and Shift+Space take only the current cell's column or row; the sheet's take the whole selection's (`whole`).
    rowMarkers: "clickable-number", smoothScrollX: true, smoothScrollY: true, width: "100%", height: "100%", fillHandle: true, getCellsForSelection: true, keybindings: { search: false, selectColumn: false, selectRow: false },
    // The grid's own description of every cell for a screen reader is rebuilt on each move and scroll. Drawn off screen and copied whole, an
    // arrow-key move that scrolls costs a third less and a wheel step half (measured: p95 8.6 to 5.7 ms, 6.4 to 2.5 ms).
    experimental: { disableAccessibilityTree: true, renderStrategy: "double-buffer" },
  };
  const made = (instance: DataEditorRef | null) => { editor = instance; };

  function Grid() {
    const [selection, setSelection] = useState<GridSelection>(NO_SELECTION), [marks, setMarks] = useState<DataEditorProps["highlightRegions"]>(), [shape, setShape] = useState(0), [theme, setTheme] = useState(look);
    const [widths, setWidths] = useState<Record<number, number>>({}), [heights, setHeights] = useState<Record<number, number>>({});
    current = selection;
    useEffect(() => {
      drive.select = setSelection; drive.marks = setMarks; drive.look = setTheme; drive.width = (col, width) => setWidths((was) => ({ ...was, [col]: width }));
      drive.height = (row, height) => setHeights((was) => ({ ...was, [row]: height }));
      drive.structure = () => { size = reach(); setWidths({}); setHeights({}); setShape((n) => n + 1); };
      // Mounted, the grid has drawn in its layout effects; the frame after is on screen.
      requestAnimationFrame(() => events.drawn());
    }, []);
    const { rows, cols } = size;
    const columns = useMemo(() => Array.from({ length: cols }, (_, col) => ({ id: model.colAt(col) ?? String(col), title: colName(col), width: widths[col] ?? options.columns.width(col) ?? theme.width })), [shape, cols, widths, theme]);
    const types = useMemo(() => Array.from({ length: cols }, (_, col) => options.columns.type(col)), [shape, cols]);
    const cellLook = useMemo(() => createCellLook(theme), [theme]);
    const content = useMemo(() => {
      const hues = { destructive: theme.error, live: theme.live, warn: theme.warn }, { theme: themed } = cellLook;
      return ([col, row]: Item): GridCell => {
        const value = model.value(row, col), type = types[col];
        if (type === "boolean") return { kind: GridCellKind.Boolean, data: value === true, allowOverlay: false, copyData: model.input(row, col) };
        // An empty value is an empty cell but for a formula that gives nothing.
        const input = value === null || typeof value === "string" ? model.input(row, col) : null;
        const style = options.columns.style(row, col);
        // An empty cell is drawn for its fill and edges alone.
        if (input === "") return style ? new TextCell(row, col, "", "", undefined, themed(style), style) : EMPTY;
        // An error is shown by its code, as the engine names it; only a value that could be one is asked whether it is.
        const fault = typeof value === "string" && value.startsWith("#") && model.error(row, col) !== null;
        const drawn = fault || value === null || typeof value === "boolean" ? null : options.columns.draw(row, col, value);
        return new TextCell(row, col, input, drawn ? drawn.text : shown(value), style?.align ?? (typeof value === "number" || type === "number" ? "right" : undefined), themed(style, fault ? theme.error : drawn?.hue && hues[drawn.hue]), style,
          input !== null && !input.startsWith("=") && options.columns.frozen(row, col) || undefined);
      };
    }, [types, theme, cellLook]);
    // One number while every row is the default height: the grid then sums no heights to scroll.
    const rowHeight = useMemo(() => {
      const kept = options.columns.heights();
      return kept.size || Object.keys(heights).length ? (row: number) => heights[row] ?? kept.get(row) ?? theme.row : theme.row;
    }, [shape, heights, theme]);
    // The columns frozen stand at the left as the rest scroll; never all of those in view, or nothing could scroll.
    const freezeColumns = useMemo(() => { frozenCols = Math.min(options.columns.freeze().cols, cols - 1); return frozenCols; }, [shape, cols]);
    const props: DataEditorProps = { ...handlers, columns, rows, freezeColumns, getCellContent: content, drawCell: cellLook.draw,
      // A whole column's letter, picked, is washed as its cells are; the grid would fill it in the accent its fill handle and ring keep.
      drawHeader: (args, draw) => { if (args.isSelected) { const { ctx, rect } = args, inset = args.columnIndex ? 1 : 0; for (const fill of [theme.grid.bgHeader, theme.picked]) { ctx.fillStyle = String(fill); ctx.fillRect(rect.x + inset, rect.y, rect.width - inset, rect.height); } } draw(); }, theme: theme.grid as Partial<Theme>, rowHeight, headerHeight: theme.header, gridSelection: selection, highlightRegions: marks };
    return createElement(DataEditor, { ...props, ref: made });
  }

  const root = createRoot(element);
  root.render(createElement(Grid));
  const box = (col: number, row: number) => editor?.getBounds(col, row);
  // The frozen columns first: they stand in view whatever the scroll.
  const colAt = (x: number) => { for (let at = frozenCols ? 0 : view.x; at < view.x + view.width + 1; at = at + 1 === frozenCols ? Math.max(view.x, frozenCols) : at + 1) { const cell = box(at, view.y); if (cell && x >= cell.x && x < cell.x + cell.width) return at; } return -1; };
  const rowAt = (y: number) => { for (let at = view.y; at < view.y + view.height + 1; at++) { const cell = box(view.x, at); if (cell && y >= cell.y && y < cell.y + cell.height) return at; } return -1; };
  const rowEdge = (x: number, y: number) => {
    const numbers = box(-1, view.y);
    if (!numbers || x < numbers.x || x >= numbers.x + numbers.width) return null;
    for (let at = view.y; at < view.y + view.height + 1; at++) { const cell = box(-1, at); if (cell && Math.abs(y - (cell.y + cell.height)) <= EDGE_SLOP) return { row: at, top: cell.y }; }
    return null;
  };
  let stop = () => {};
  // Dragged along the column letters or down the row numbers, the columns or rows between are picked.
  const sweep = (event: PointerEvent) => {
    const frame0 = element.getBoundingClientRect(), numbers = box(-1, view.y), top = frame0.top + look.header, left = numbers ? numbers.x + numbers.width : frame0.left;
    const across = event.clientY >= frame0.top && event.clientY < top, down = !across && Boolean(numbers) && event.clientX < left;
    const at = across ? colAt : rowAt, [lo, hi] = across ? [left, frame0.right] : [top, frame0.bottom], from = at(across ? event.clientX : event.clientY);
    // A press on an edge sizes (the grid's own columns, sizes.ts's rows); Shift and Ctrl add to the selection, as the grid does.
    const cell = across ? box(from, view.y) : undefined, onEdge = cell ? cell.x + cell.width - event.clientX <= COL_EDGE || (from > 0 && event.clientX - cell.x <= COL_EDGE) : rowEdge(event.clientX, event.clientY);
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || !(across || down) || from < 0 || onEdge) return;
    // Each frame, not each move: held past an edge, the grid scrolls a line at a time under a still pointer and the pick runs on with it.
    let to = from, place = across ? event.clientX : event.clientY, frame = 0, stepped = 0;
    const pick = (now: number) => { frame = requestAnimationFrame(pick);
      const past = place >= hi ? 1 : place < lo ? -1 : 0, under = at(Math.min(Math.max(place, lo + 1), hi - 1));
      if (under >= 0) to = under;
      // The next line on from the one at the edge, found by its own bounds: the grid tells its visible region only once a scroll settles.
      if (past && now - stepped > SWEEP_STEP) { stepped = now; const next = Math.min(Math.max(to + past, 0), (across ? size.cols : size.rows) - 1);
        if (across) editor?.scrollTo(next, view.y, "horizontal"); else editor?.scrollTo(view.x, next, "vertical"); }
      const picked = CompactSelection.fromSingleSelection([Math.min(from, to), Math.max(from, to) + 1]);
      if (picked.equals(across ? current.columns : current.rows)) return;
      current = { columns: across ? picked : CompactSelection.empty(), rows: across ? CompactSelection.empty() : picked }; drive.select?.(current); events.selected(selected(current, size)); };
    const move = (moved: PointerEvent) => { place = across ? moved.clientX : moved.clientY; };
    const up = () => { cancelAnimationFrame(frame); removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); };
    stop(); stop = up;
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up); frame = requestAnimationFrame(pick);
  };
  element.addEventListener("pointerdown", sweep);
  return {
    update: (changed) => {
      if (!changed) return drive.structure?.();
      // Only what is in view is drawn again; the rest is read as it scrolls in.
      const near = changed.filter(({ row, col }) => row >= view.y && row < view.y + view.height + 1 && col >= view.x && col < view.x + view.width + 1);
      if (near.length) editor?.updateCells(near.map(({ row, col }) => ({ cell: [col, row] })));
    },
    select: (to, scroll) => {
      // Held at once, not at React's next render: `whole` and the grid's own focus read it straight after.
      current = to ? { columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [to.left, to.top], range: rect(to), rangeStack: [] } } : NO_SELECTION;
      drive.select?.(current);
      events.selected(to);
      if (to && scroll) editor?.scrollTo(to.left, to.top, "both", 0, 0, { vAlign: "center", hAlign: "center" });
    },
    highlight: (list) => { comments = list.map((one) => ({ color: one.current ? look.markCurrent : look.mark, range: rect(one.range), style: one.current ? "solid-outline" : "no-outline" })); marks(); },
    // A whole column or row runs to the grid's end.
    references: (list: readonly SheetReference[]) => {
      references = list.map((one) => ({ color: look.inks[one.ink] ?? look.mark, range: rect({ ...one.range, bottom: Math.min(one.range.bottom, size.rows - 1), right: Math.min(one.range.right, size.cols - 1) }), style: one.pointing ? "dashed" : "solid" }));
      marks();
    },
    // The region's edge cells may be cut off: those are scrolled to, the rest left where they are.
    show: (row, col) => { if (col <= view.x || col >= view.x + view.width - 1 || row <= view.y || row >= view.y + view.height - 1) editor?.scrollTo(col, row); },
    bounds: (area) => {
      const first = box(area.left, area.top), last = box(area.right, area.bottom), numbers = box(-1, area.top), frame = element.getBoundingClientRect();
      if (!first || !last || !numbers) return null;
      // Clipped to the cells' part of the grid, under the header and beside the row numbers, or the frozen columns where it scrolls under them.
      const pinned = area.left >= frozenCols && frozenCols ? box(frozenCols - 1, area.top) : undefined;
      const left = Math.max(first.x, pinned ? pinned.x + pinned.width : numbers.x + numbers.width), top = Math.max(first.y, frame.top + look.header), right = Math.min(last.x + last.width, frame.right), bottom = Math.min(last.y + last.height, frame.bottom);
      return right > left && bottom > top ? { left, top, width: right - left, height: bottom - top } satisfies SheetBox : null;
    },
    cellAt: (x, y) => {
      const col = colAt(x), row = rowAt(y);
      return col < 0 || row < 0 ? null : { row, col };
    },
    whole: (kind) => {
      const area = selected(current, size);
      if (!area) return;
      const picked = CompactSelection.fromSingleSelection(kind === "cols" ? [area.left, area.right + 1] : [area.top, area.bottom + 1]);
      const next: GridSelection = { columns: kind === "cols" ? picked : CompactSelection.empty(), rows: kind === "rows" ? picked : CompactSelection.empty() };
      drive.select?.(next); events.selected(selected(next, size));
    },
    rowEdge,
    height: (row, height) => drive.height?.(row, height),
    theme: (next) => { look = next; drive.look?.(look); },
    scroll: (to) => { if (to) editor?.scrollTo(to.col, to.row, "both", 0, 0, { hAlign: "start", vAlign: "start" }); return { row: view.y, col: view.x }; },
    focus: () => editor?.focus(),
    destroy: () => { stop(); element.removeEventListener("pointerdown", sweep); root.unmount(); },
  };
}
