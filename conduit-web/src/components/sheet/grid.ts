/*
 * The grid: a canvas-drawn data grid, which is a React component, mounted as an island in what Solid draws. Only
 * the sheet editor imports this, lazily, so React and the grid never reach the app's first load. TSX here compiles
 * to Solid, so the island is written with createElement.
 */
import { AllCellRenderers, CompactSelection, DataEditorCore, GridCellKind, ImageWindowLoaderImpl, markerCellRenderer, sprites, type DataEditorProps, type DataEditorRef, type GridCell, type GridSelection, type Item, type Rectangle, type Theme } from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { createElement, useEffect, useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { colName, type SheetView, COL_LIMIT } from "@/sheet-format.js";
import { shiftRefs } from "@/sheet-rules.js";
import { createCellLook } from "./cell-draw";
import { seriesFill } from "./series";
import type { SheetDrawn } from "./formats";
import type { SheetCellStyle } from "./styles";
import type { SheetBox, SheetGrid, SheetGridEvents, SheetLook, SheetRange, SheetReference } from "./host";

/** What the grid reads of the sheet besides its cells: each column's width and type, the rows whose height is not the default (`look`), a value as its cell's number format draws it (formats.ts), a cell's style (styles.ts), and whether an import froze it. */
export type SheetColumns = { width(col: number): number | undefined; type(col: number): string | undefined; heights(): ReadonlyMap<number, number>; draw(row: number, col: number, value: number | string): SheetDrawn | null; dated(row: number, col: number): boolean; style(row: number, col: number): SheetCellStyle | undefined; frozen(row: number, col: number): boolean; freeze(): { rows: number; cols: number }; hidden(): ReadonlySet<number>;
  /** A filter's mark on a header cell (0 none, 1 a filter, 2 one keeping only some values) and a table's banded rows (filter.tsx). */
  mark(row: number, col: number): number; banded(row: number, col: number): boolean;
  /** The tab's merged ranges (merges.ts). */
  merges(): readonly SheetRange[] };
// How near a row's lower edge, beside its number, a press takes the edge to drag.
const EDGE_SLOP = 3;
// How often (ms) a drag held past the grid's edge scrolls it on by a column.
const SWEEP_STEP = 60;
// How thick (px) the line under a row number is where rows after it are hidden.
const HIDDEN_LINE = 2;
// How near a column's side (px) a press takes the edge to size it: the grid's own reach.
const COL_EDGE = 5;
type GridOptions = { model: SheetView; columns: SheetColumns; events: SheetGridEvents; look: SheetLook };
type Highlight = NonNullable<DataEditorProps["highlightRegions"]>[number];

const NO_SELECTION: GridSelection = { columns: CompactSelection.empty(), rows: CompactSelection.empty() };
// No cell opens the grid's own editor: the sheet's formula editor (formula-editor.tsx) edits every one, so a key typed as it opens is never lost.
const EMPTY: GridCell = { kind: GridCellKind.Text, data: "", displayData: "", allowOverlay: false, copyData: "" };
// A row whose line runs inside a merge: the cells outside it draw theirs (`merged`).
const NO_LINE: Partial<Theme> = { horizontalBorderColor: "transparent" };
// Most numbers are short as they are; only a long one (0.1 + 0.2) is cut to what a sheet shows.
const shown = (value: string | number | boolean | null) => { if (typeof value !== "number") return value === null ? "" : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : value; const text = String(value); return text.length > 12 ? String(Number(value.toPrecision(12))) : text; };
const rect = (range: SheetRange): Rectangle => ({ x: range.left, y: range.top, width: range.right - range.left + 1, height: range.bottom - range.top + 1 });
const range = (box: Rectangle): SheetRange => ({ top: box.y, left: box.x, bottom: box.y + box.height - 1, right: box.x + box.width - 1 });
const edges = (picked: CompactSelection): [number, number] | null => { const all = picked.toArray(); return all.length ? [Math.min(...all), Math.max(...all)] : null; };

/** The cells a selection covers: a range, or whole rows or columns. */
/** The empty rows and columns drawn past the sheet's own, and the fewest ever drawn. */
const ROOM = { rows: 50, cols: 10, least: { rows: 100, cols: 26 } };
// Whole columns or rows are what is selected, though a cell in them is the active one.
const selected = (selection: GridSelection, size: { rows: number; cols: number }): SheetRange | null => {
  const cols = edges(selection.columns), rows = edges(selection.rows);
  if (cols) return { top: 0, bottom: size.rows - 1, left: cols[0], right: cols[1] };
  if (rows) return { top: rows[0], bottom: rows[1], left: 0, right: size.cols - 1 };
  return selection.current ? range(selection.current.range) : null;
};
const one = (col: number, row: number): NonNullable<GridSelection["current"]> => ({ cell: [col, row], range: { x: col, y: row, width: 1, height: 1 }, rangeStack: [] });

/**
 * The rows the grid draws and the sheet's rows they are: a hidden row is not drawn, so the grid's row n is the sheet's nth shown row, and past
 * the sheet's own rows they run on one for one. Everything the grid says of a row is turned into the sheet's here, and back.
 */
function createRowMap() {
  let shown: Int32Array | null = null, at: Int32Array | null = null, held = 0;
  const same = (one: Int32Array | null, two: Int32Array | null) => one === two || (one !== null && two !== null && one.length === two.length && one.every((row, n) => row === two[n]));
  const map = {
    /** Counts each change of which rows are hidden. */
    version: 0,
    /** `rows`: how many the sheet holds; `hidden`: which of those are not drawn. */
    set(hidden: ReadonlySet<number>, rows: number) {
      const was = shown;
      held = rows; shown = at = null;
      if ([...hidden].some((row) => row < rows)) {
        const list: number[] = [];
        at = new Int32Array(rows);
        for (let row = 0; row < rows; row++) { at[row] = list.length; if (!hidden.has(row)) list.push(row); }
        shown = Int32Array.from(list);
      }
      if (!same(was, shown)) map.version++;
    },
    hiddenCount: () => shown ? held - shown.length : 0,
    sheet: (drawn: number) => !shown ? drawn : drawn < shown.length ? shown[drawn]! : held + drawn - shown.length,
    /** A hidden row gives the first shown row after it. */
    drawn: (row: number) => !at || !shown ? row : row < held ? at[row]! : shown.length + row - held,
    hidden: (row: number) => Boolean(at && shown && row < held && shown[at[row]!] !== row),
    toSheet: (area: SheetRange | null): SheetRange | null => area && { ...area, top: map.sheet(area.top), bottom: map.sheet(area.bottom) },
    /** Null where every row of it is hidden. */
    toDrawn: (area: SheetRange): SheetRange | null => { const top = map.drawn(area.top), bottom = map.drawn(area.bottom) - (map.hidden(area.bottom) ? 1 : 0); return bottom < top ? null : { ...area, top, bottom }; },
  };
  return map;
}

type RowMap = ReturnType<typeof createRowMap>;
/** One of the grid's two views: the head (the column letters and the rows frozen above the rest, there only while some are) and the body. */
type Part = { editor: DataEditorRef | null; view: Rectangle; map: RowMap; current: GridSelection; host?: HTMLDivElement; select?(selection: GridSelection): void };
type Mark = { color: string; range: SheetRange; style: "solid-outline" | "no-outline" | "dashed" | "solid" };

/** Mounts the grid in `element` and gives the editor its controls; the grid's whole state is here, kept as React's. */
export function mountGrid(element: HTMLElement, options: GridOptions): SheetGrid {
  const { model, events } = options;
  let counting = false;
  /** What a cell shows; what was typed into it is read only when the grid asks (editing, copying), since drawing never does. */
  class TextCell {
    readonly kind = GridCellKind.Text; readonly allowOverlay = false; mark = 0;
    constructor(private row: number, private col: number, private typed: string | null, readonly displayData: string, readonly contentAlign?: "left" | "center" | "right", readonly themeOverride?: Partial<Theme>, readonly worn?: SheetCellStyle, readonly frozen?: boolean) {}
    get data() { return this.typed ??= model.input(this.row, this.col); }
    get copyData() { return this.data; }
  }
  // Typing into a cell opens the grid's own editor, which is drawn into an element of this id.
  if (!document.getElementById("portal")) document.body.append(Object.assign(document.createElement("div"), { id: "portal" }));
  const part = (): Part => ({ editor: null, view: { x: 0, y: 0, width: 0, height: 0 }, map: createRowMap(), current: NO_SELECTION });
  const head = part(), body = part(), parts = [head, body] as const;
  // Set as the component mounts: the editor drives the island through these.
  const drive: { width?(col: number, width: number): void; height?(row: number, height: number): void; marks?(): void; look?(look: SheetLook): void; structure?(): void; owner?(part: Part): void } = {};
  let look = options.look, comments: Mark[] = [], references: Mark[] = [], owner = body;
  // Find's matches (find.tsx) in amber's wash, as a highlighter marks them; coloured as drawn, so they follow the theme.
  let found: readonly { range: SheetRange; current: boolean }[] = [];
  const findMarks = (): Mark[] => found.map((one) => ({ color: look.palette.amber.fill, range: one.range, style: one.current ? "solid-outline" : "no-outline" }));

  // The grid runs on past what the sheet holds, as a spreadsheet's does: a cell written out there makes the sheet reach it (the hub's `set`).
  // The rows frozen are the head's; the body hides them, as it does the rows hidden.
  let frozenRows = 0, frozenCols = 0;
  // Each row's merges, by the sheet's rows, made again with the rest of the shape.
  let merges: readonly SheetRange[] = [], mergesOf = new Map<number, SheetRange[]>();
  const mergeAt = (row: number, col: number) => { const list = mergesOf.get(row); if (list) for (const one of list) if (col >= one.left && col <= one.right) return one; return undefined; };
  /** Whether a part's drawn row's top line runs inside a merge. */
  const lineCut = (p: Part, drawn: number) => { if (!mergesOf.size || drawn < 1) return false; const above = p.map.sheet(drawn - 1), list = mergesOf.get(p.map.sheet(drawn)); return Boolean(list?.some((one) => one.top <= above)); };
  // Each part's row heights as last drawn, which a merge's rows measure it by.
  const rowHeights = new Map<Part, number | ((drawn: number) => number)>();
  /** A range grown to take in every merge it reaches. */
  const grown = (area: SheetRange) => {
    let out = area;
    for (let again = merges.length > 0; again;) {
      again = false;
      for (const one of merges) if (one.top <= out.bottom && one.bottom >= out.top && one.left <= out.right && one.right >= out.left && (one.top < out.top || one.bottom > out.bottom || one.left < out.left || one.right > out.right)) {
        out = { top: Math.min(out.top, one.top), bottom: Math.max(out.bottom, one.bottom), left: Math.min(out.left, one.left), right: Math.max(out.right, one.right) }; again = true;
      }
    }
    return out;
  };
  const reach = () => {
    merges = options.columns.merges(); mergesOf = new Map();
    for (const one of merges) for (let row = one.top; row <= one.bottom; row++) (mergesOf.get(row) ?? mergesOf.set(row, []).get(row)!).push(one);
    const held = model.size(), hidden = options.columns.hidden();
    frozenRows = Math.min(options.columns.freeze().rows, held.rows);
    head.map.set(hidden, frozenRows);
    body.map.set(frozenRows ? new Set([...hidden, ...Array.from({ length: frozenRows }, (_, row) => row)]) : hidden, held.rows);
    return { rows: Math.max(held.rows - body.map.hiddenCount() + ROOM.rows, ROOM.least.rows), head: frozenRows - head.map.hiddenCount(), cols: Math.min(COL_LIMIT, Math.max(held.cols + ROOM.cols, ROOM.least.cols)) };
  };
  let size = reach();
  const partOf = (row: number) => row < frozenRows ? head : body;
  /** The part of a range of the sheet's rows a part holds, as it draws them; null where it holds none of it. */
  const clip = (p: Part, area: SheetRange) => {
    const within = p === head ? (area.top < frozenRows ? { ...area, bottom: Math.min(area.bottom, frozenRows - 1) } : null) : (area.bottom >= frozenRows ? { ...area, top: Math.max(area.top, frozenRows) } : null);
    return within && p.map.toDrawn(within);
  };
  /** The focus cell's bands, in a part's drawn rows: the active cell's row (in its own part) and column (in both), the cell itself left clear. */
  const focusOf = (p: Part): Highlight[] => {
    const cell = look.focus ? owner.current.current?.cell : undefined;
    if (!cell) return [];
    const [col, row] = cell, rows = p === head ? size.head : size.rows, band = (x: number, y: number, width: number, height: number): Highlight[] => width > 0 && height > 0 ? [{ color: look.focus, range: { x, y, width, height }, style: "no-outline" }] : [];
    if (p !== owner) return band(col, 0, 1, rows);
    return [...band(0, row, col, 1), ...band(col + 1, row, size.cols - col - 1, 1), ...band(col, 0, 1, row), ...band(col, row + 1, 1, rows - row - 1)];
  };
  const marksOf = (p: Part): Highlight[] | undefined => {
    const list = [...focusOf(p), ...[...references, ...findMarks(), ...comments].flatMap((one) => { const drawn = clip(p, one.range); return drawn ? [{ color: one.color, range: rect({ ...drawn, right: Math.min(drawn.right, size.cols - 1) }), style: one.style }] : []; })];
    return list.length ? list : undefined;
  };
  /**
   * The sheet's cells the selection covers, over both parts. A range the sheet gave (the address field, a menu) is kept as it was given while the
   * parts still show it, so a hidden row at its edge stays in it.
   */
  let asked: { to: SheetRange; head: GridSelection; body: GridSelection } | null = null;
  const picked = (): SheetRange | null => {
    if (asked && asked.head === head.current && asked.body === body.current) return asked.to;
    const columns = edges(owner.current.columns);
    if (columns) return { top: 0, bottom: body.map.sheet(size.rows - 1), left: columns[0], right: columns[1] };
    const areas = parts.flatMap((p) => { const area = p.map.toSheet(selected(p.current, size)); return area && (p === owner || frozenRows) ? [area] : []; });
    return areas.length ? areas.reduce((one, two) => ({ top: Math.min(one.top, two.top), bottom: Math.max(one.bottom, two.bottom), left: Math.min(one.left, two.left), right: Math.max(one.right, two.right) })) : null;
  };
  /** Each part's share of a range of the sheet's, the cursor's part chosen first so the other keeps its share. */
  const spread = (to: SheetRange, into: Part, share: (p: Part, drawn: SheetRange) => GridSelection) => {
    for (const p of [into, into === head ? body : head]) {
      const drawn = clip(p, to), next = drawn ? share(p, drawn) : NO_SELECTION;
      if (p === into) choose(p, next); else if (frozenRows) { p.current = next; p.select?.(next); }
    }
    asked = { to, head: head.current, body: body.current };
  };
  /** A part's selection, given: a column picked is picked in both parts; anything else is the one part's. */
  /**
   * As a spreadsheet's, a selection always has an active cell: whole columns or rows picked keep the one there was where it is in them, else take
   * the first of them in view, so the arrows go on from it and Escape comes back to it.
   */
  const active = (p: Part, given: GridSelection): GridSelection => {
    // Rows picked while columns were (or the other way) come with both: the ones just picked are the selection.
    const next = given.columns.length && given.rows.length ? (p.current.columns.equals(given.columns) ? { ...given, columns: CompactSelection.empty() } : { ...given, rows: CompactSelection.empty() }) : given;
    if (next.current || !(next.columns.length || next.rows.length)) return next;
    const was = p.current.current?.cell ?? owner.current.current?.cell, cols = edges(next.columns), rows = edges(next.rows), { view } = p;
    if (cols) { const col = was && was[0] >= cols[0] && was[0] <= cols[1] ? was[0] : cols[0]; return { ...next, current: one(col, p === owner && was ? was[1] : p === head ? 0 : view.y) }; }
    const [top, bottom] = rows!, row = was && p === owner && was[1] >= top && was[1] <= bottom ? was[1] : top;
    return { ...next, current: one(was ? was[0] : frozenCols ? 0 : view.x, row) };
  };
  // Moved into the other part, it is drawn at once: a part focused before its selection is drawn selects its first cell.
  const choose = (p: Part, given: GridSelection) => {
    const next = active(p, given), other = p === head ? body : head, theirs = next.columns.length ? { columns: next.columns, rows: CompactSelection.empty() } : NO_SELECTION;
    const apply = () => {
      p.current = next; p.select?.(next);
      if (frozenRows && (other.current !== NO_SELECTION || theirs !== NO_SELECTION)) { other.current = theirs; other.select?.(theirs); }
      if (owner !== p) { owner = p; drive.owner?.(p); }
    };
    if (owner !== p) flushSync(apply); else apply();
  };
  /** A range picked grown over the merges it reaches, as a spreadsheet's; an active cell in a merge is its top-left. */
  const fit = (p: Part, given: GridSelection): GridSelection => {
    const now = given.current;
    if (!merges.length || !now || given.columns.length || given.rows.length) return given;
    const area = p.map.toSheet(range(now.range))!, to = grown(area), home = mergeAt(p.map.sheet(now.cell[1]), now.cell[0]), top = home && clip(p, home)?.top;
    const cell: Item = home && top !== undefined ? [home.left, top] : now.cell, drawn = to === area ? null : clip(p, to);
    if (!drawn && cell[0] === now.cell[0] && cell[1] === now.cell[1]) return given;
    return { ...given, current: { ...now, cell, range: drawn ? rect(drawn) : now.range } };
  };
  const write = (list: { row: number; col: number; input: string }[]) => { if (list.length) events.write(list); };
  // Made once a part: a new function or object for the grid on each render has it work everything out again, the cost of each arrow-key move.
  const handlersOf = (p: Part): Partial<DataEditorProps> => ({
    onGridSelectionChange: (next) => { choose(p, fit(p, next)); events.selected(picked()); },
    onCellsEdited: (cells) => {
      write(cells.map(({ location: [col, row], value }) => ({ row: p.map.sheet(row), col, input: value.kind === GridCellKind.Boolean ? (value.data ? "TRUE" : "FALSE") : value.kind === GridCellKind.Text ? value.data : "" })));
      return true;
    },
    // What was copied here has its formulas moved with it.
    onPaste: (target, given) => { pasteInto(p, target, moved(given, p.map.sheet(target[1]), target[0])); return false; },
    onDelete: (cleared) => {
      const area = selected(cleared, size), list: { row: number; col: number; input: string }[] = [];
      if (area) for (let drawn = area.top; drawn <= area.bottom; drawn++) { const row = p.map.sheet(drawn); for (let col = area.left; col <= area.right; col++) if (model.input(row, col)) list.push({ row, col, input: "" }); }
      write(list);
      return false;
    },
    // The series is worked out here (series.ts) and sent as the cells past the source; the hub moves its formulas from the source, per cell.
    onFillPattern: ({ patternSource, fillDestination, preventDefault }) => {
      preventDefault();
      const source = range(patternSource), into = range(fillDestination), rows = Array.from({ length: patternSource.height }, (_, y) => p.map.sheet(source.top + y));
      const direction = into.bottom > source.bottom ? "down" : into.top < source.top ? "up" : into.right > source.right ? "right" : "left", across = direction === "right" || direction === "left";
      const added = across ? into.right - into.left - source.right + source.left : into.bottom - into.top - source.bottom + source.top;
      if (!added) return;
      const cells = rows.map((row) => Array.from({ length: patternSource.width }, (_, x) => ({ input: model.input(row, source.left + x), value: model.value(row, source.left + x), dated: options.columns.dated(row, source.left + x) })));
      const values = seriesFill(cells, direction, added, counting), from = { top: rows[0]!, bottom: rows.at(-1)!, left: source.left, right: source.right };
      const top = direction === "down" ? source.bottom + 1 : direction === "up" ? into.top : source.top, bottom = direction === "up" ? source.top - 1 : direction === "down" ? into.bottom : source.bottom;
      const left = direction === "right" ? source.right + 1 : into.left, right = direction === "left" ? source.left - 1 : into.right;
      // Into the rows shown: each run of them between hidden rows is filled on its own.
      for (let start = top, drawn = top; drawn <= bottom; drawn++) if (drawn === bottom || p.map.sheet(drawn + 1) !== p.map.sheet(drawn) + 1) { events.fill({ top: p.map.sheet(start), bottom: p.map.sheet(drawn), left, right }, values.slice(start - top, drawn - top + 1), from); start = drawn + 1; }
    },
    getRowThemeOverride: (drawn) => lineCut(p, drawn) ? NO_LINE : undefined,
    onColumnResize: (_, width, col) => drive.width?.(col, width),
    onColumnResizeEnd: (_, width, col) => events.resized(col, width),
    onHeaderContextMenu: (col) => { const area = picked(); events.menu({ cols: owner.current.columns.hasIndex(col) && area ? area : { top: 0, bottom: 0, left: col, right: col } }); },
    onCellContextMenu: ([col, drawn]) => {
      const row = p.map.sheet(drawn), area = picked(), inside = area && row >= area.top && row <= area.bottom && (col < 0 || (col >= area.left && col <= area.right));
      const rows = inside ? { ...area, left: 0, right: 0 } : { top: row, bottom: row, left: 0, right: 0 }, cols = inside && col >= 0 ? { ...area, top: 0, bottom: 0 } : { top: 0, bottom: 0, left: col, right: col };
      events.menu(col < 0 ? { rows } : { rows, cols });
    },
    // A press on the cell already selected moves nothing, so the grid would not take the keyboard back from the pane, which takes it on any press.
    // A press on a filter's mark, in its header cell's right end, opens the filter.
    onCellClicked: ([col, row], event) => {
      p.editor?.focus();
      const at = p.map.sheet(row), cell = options.columns.mark(at, col) && event.localEventX >= event.bounds.width - Number(look.grid.headerIconSize) - 2 * Number(look.grid.cellHorizontalPadding) ? box(p, col, row) : undefined;
      if (cell) events.filter?.(at, col, { left: cell.x, top: cell.y, width: cell.width, height: cell.height });
      events.pressed(at, col);
    },
    onCellActivated: ([col, drawn]) => { const row = p.map.sheet(drawn), home = mergeAt(row, col); events.activated(home?.top ?? row, home?.left ?? col); },
    onKeyDown: (event) => {
      const cell = p.current.current?.cell;
      if (!cell) return;
      if (events.key(event, p.map.sheet(cell[1]), cell[0])) return event.cancel();
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === "v" && copied) { event.cancel(); event.preventDefault(); pasteInto(p, cell, copied.values); return; }
      // An arrow from whole columns or rows goes on from their active cell, to one cell.
      const step = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, [number, number]>)[event.key];
      if (step && !(event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) && (p.current.columns.length || p.current.rows.length)) {
        const col = Math.min(Math.max(cell[0] + step[0], 0), size.cols - 1), drawn = cell[1] + step[1];
        if (drawn >= 0 && drawn < (p === head ? size.head : size.rows)) { event.cancel(); const row = p.map.sheet(drawn); api.select({ top: row, bottom: row, left: col, right: col }); return; }
      }
      // Ctrl and an arrow go as a spreadsheet's: from a value along a run of values to its last, else on to the next value, else to the edge; Shift
      // moves the selection's far edge so, the active cell kept. Within the part, past its hidden rows.
      if (step && (event.ctrlKey || event.metaKey) && !event.altKey) {
        event.cancel();
        const range = p.current.current?.range, filled = (col: number, drawn: number) => model.input(p.map.sheet(drawn), col) !== "";
        const vertical = step[1] !== 0, dir = vertical ? step[1] : step[0], end = vertical ? (p === head ? size.head : size.rows) : size.cols;
        const far = !event.shiftKey || !range ? cell : [range.x === cell[0] ? range.x + range.width - 1 : range.x, range.y === cell[1] ? range.y + range.height - 1 : range.y] as const;
        const at = (n: number) => vertical ? filled(far[0], n) : filled(n, far[1]);
        let n = vertical ? far[1] : far[0];
        if (n + dir >= 0 && n + dir < end) {
          if (at(n) && at(n + dir)) while (n + dir >= 0 && n + dir < end && at(n + dir)) n += dir;
          else { n += dir; while (!at(n) && n + dir >= 0 && n + dir < end) n += dir; }
        }
        const to: [number, number] = vertical ? [far[0], n] : [n, far[1]];
        if (!event.shiftKey) { const row = p.map.sheet(to[1]); api.select({ top: row, bottom: row, left: to[0], right: to[0] }); return; }
        const drawn = { x: Math.min(cell[0], to[0]), y: Math.min(cell[1], to[1]), width: Math.abs(cell[0] - to[0]) + 1, height: Math.abs(cell[1] - to[1]) + 1 };
        choose(p, { columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [cell[0], cell[1]], range: drawn, rangeStack: [] } });
        asked = null; events.selected(picked()); api.show(p.map.sheet(to[1]), to[0]);
        return;
      }
      // Ctrl+End goes to the last row and column holding anything, not the grid's run-on end.
      if (event.key === "End" && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey) {
        event.cancel();
        const { rows, cols } = model.size();
        let bottom = 0, right = 0;
        for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) if (model.input(row, col) !== "") { bottom = Math.max(bottom, row); right = Math.max(right, col); }
        api.select({ top: bottom, bottom, left: right, right });
        return;
      }
      // An arrow from a merge steps past its edge, from its top-left.
      const home = step && !(event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) ? mergeAt(p.map.sheet(cell[1]), cell[0]) : undefined, inPart = home && clip(p, home);
      if (step && inPart) {
        const col = step[0] < 0 ? inPart.left - 1 : step[0] > 0 ? inPart.right + 1 : inPart.left, drawn = step[1] < 0 ? inPart.top - 1 : step[1] > 0 ? inPart.bottom + 1 : inPart.top;
        if (col >= 0 && col < size.cols && drawn >= 0 && drawn < (p === head ? size.head : size.rows)) { event.cancel(); const row = p.map.sheet(drawn); api.select({ top: row, bottom: row, left: col, right: col }); return; }
      }
      // Escape brings a selection of more than one cell back to its active cell; one cell, it is left to the pane.
      const area = picked();
      if (event.key === "Escape" && area && (area.top !== area.bottom || area.left !== area.right)) { event.cancel(); const row = p.map.sheet(cell[1]); api.select({ top: row, bottom: row, left: cell[0], right: cell[0] }); return; }
      // An arrow across the frozen rows' edge goes on into the other part.
      if (!frozenRows || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const into = event.key === "ArrowUp" && p === body && cell[1] === 0 && size.head ? head : event.key === "ArrowDown" && p === head && cell[1] === size.head - 1 ? body : null;
      if (!into) return;
      event.cancel();
      const row = into === head ? head.map.sheet(size.head - 1) : body.map.sheet(0);
      api.select({ top: row, bottom: row, left: cell[0], right: cell[0] });
      into.editor?.focus();
    },
    editOnType: false, cellActivationBehavior: "double-click",
    onVisibleRegionChanged: (region) => { p.view = region; events.moved(); },
    // Its own Ctrl+Space and Shift+Space take only the current cell's column or row; the sheet's take the whole selection's (`whole`).
    rowMarkers: "clickable-number", smoothScrollX: true, smoothScrollY: true, width: "100%", height: "100%", fillHandle: true, getCellsForSelection: true, keybindings: { search: false, selectColumn: false, selectRow: false, clear: false },
    // The grid's own description of every cell for a screen reader is rebuilt on each move and scroll. Drawn off screen and copied whole, an
    // arrow-key move that scrolls costs a third less and a wheel step half (measured: p95 8.6 to 5.7 ms, 6.4 to 2.5 ms).
    experimental: { disableAccessibilityTree: true, renderStrategy: "double-buffer" },
  });
  // Each row's number is the sheet's, and a line under it says rows after it are hidden. The grid's core is used, as its usual wrapper sets
  // its own renderers; what else the wrapper gives (its icons, an image loader) is given here once.
  const core = { headerIcons: sprites, imageWindowLoader: new ImageWindowLoaderImpl() };
  function renderersOf(p: Part) {
    return AllCellRenderers.map((one) => one !== markerCellRenderer ? one : { ...one, draw: (args: Parameters<typeof one.draw>[0], cell: Parameters<typeof one.draw>[1]) => {
      if (!("markerKind" in cell)) return;
      const drawn = cell.row - 1, row = p.map.sheet(drawn), { ctx, rect: box, theme: drawnTheme } = args;
      markerCellRenderer.draw({ ...args, cell: { ...cell, row: row + 1 } }, { ...cell, row: row + 1 });
      if (p.map.sheet(drawn + 1) > row + 1 && (p === body || drawn + 1 < size.head)) { ctx.fillStyle = drawnTheme.textMedium; ctx.fillRect(box.x, box.y + box.height - HIDDEN_LINE, box.width, HIDDEN_LINE); }
    } });
  }
  const handlers = { head: handlersOf(head), body: handlersOf(body) }, renderers = { head: renderersOf(head), body: renderersOf(body) };
  const refs = Object.fromEntries(([["head", head], ["body", body]] as const).map(([name, p]) => [name, { host: (into: HTMLDivElement | null) => { p.host = into ?? undefined; }, editor: (instance: DataEditorRef | null) => { p.editor = instance; } }])) as Record<"head" | "body", { host(into: HTMLDivElement | null): void; editor(instance: DataEditorRef | null): void }>;

  function Grid() {
    const [headSelection, setHeadSelection] = useState<GridSelection>(NO_SELECTION), [bodySelection, setBodySelection] = useState<GridSelection>(NO_SELECTION);
    const [marked, setMarked] = useState(0), [shape, setShape] = useState(0), [theme, setTheme] = useState(look), [, setOwner] = useState<Part>(owner);
    const [widths, setWidths] = useState<Record<number, number>>({}), [heights, setHeights] = useState<Record<number, number>>({});
    // Each part's selection is held as it is set (`choose`); React's copy only draws it, and may be a render behind.
    useEffect(() => {
      head.select = setHeadSelection; body.select = setBodySelection; drive.marks = () => setMarked((n) => n + 1); drive.look = setTheme; drive.owner = setOwner;
      drive.width = (col, width) => setWidths((was) => ({ ...was, [col]: width }));
      drive.height = (row, height) => setHeights((was) => ({ ...was, [row]: height }));
      drive.structure = () => { size = reach(); setWidths({}); setHeights({}); setShape((n) => n + 1); };
      // Mounted, the grid has drawn in its layout effects; the frame after is on screen.
      requestAnimationFrame(() => events.drawn());
    }, []);
    const { rows, cols } = size, frozen = frozenRows > 0;
    const columns = useMemo(() => Array.from({ length: cols }, (_, col) => ({ id: model.colAt(col) ?? String(col), title: colName(col), width: widths[col] ?? options.columns.width(col) ?? theme.width })), [shape, cols, widths, theme]);
    const types = useMemo(() => Array.from({ length: cols }, (_, col) => options.columns.type(col)), [shape, cols]);
    const cellLook = useMemo(() => createCellLook(theme), [theme]);
    const contentOf = (p: Part) => {
      const hues = { destructive: theme.error, live: theme.live, warn: theme.warn }, { theme: themed } = cellLook;
      // A table's banded rows are washed where a cell has no fill of its own; made once a look, as the grid compares them by identity.
      const washes = new Map<Partial<Theme> | undefined, Partial<Theme>>(), washed = (made?: Partial<Theme>) => made?.bgCell ? made : washes.get(made) ?? washes.set(made, { ...made, bgCell: theme.mark }).get(made)!;
      const withMark = (cell: TextCell, mark: number) => { cell.mark = mark; return cell; };
      // A merge is its top-left cell spanning its columns in each of its rows; past one row, each row draws its share of the whole (`block`: the
      // pixels above it in the merge, and the merge's height), and the rows' own lines inside it are left out (`lineCut`): each cell outside a
      // merge in such a row draws its own top line (`line`).
      const merged = (at: number, col: number, row: number): GridCell => {
        const one = mergeAt(row, col), cut = lineCut(p, at);
        if (!one) return cut ? Object.create(own(row, col), { line: { value: true } }) : own(row, col);
        const drawn = clip(p, one)!, height = rowHeights.get(p) ?? theme.row, sum = (from: number, to: number) => { let out = 0; for (let n = from; n < to; n++) out += typeof height === "number" ? height : height(n); return out; };
        // Own fields only: with row numbers shown the grid copies a spanned cell as `{ ...cell, span }`, which keeps no prototype's.
        const base = own(one.top, one.left) as GridCell & { data?: unknown; copyData?: string }, first = row === one.top && col === one.left;
        return {
          ...base, data: first ? base.data : "", copyData: first ? base.copyData : "",
          span: [one.left, one.right],
          ...(one.bottom > one.top ? { block: [sum(drawn.top, at), sum(drawn.top, drawn.bottom + 1)] } : {}),
          ...(cut && one.top >= p.map.sheet(at - 1) + 1 ? { line: true } : {}),
        } as GridCell;
      };
      const own = (row: number, col: number): GridCell => {
        const value = model.value(row, col), type = types[col], mark = options.columns.mark(row, col), striped = options.columns.banded(row, col);
        // A filter's header cell in a column of checkboxes is drawn as text, so its mark shows.
        if (type === "boolean" && !mark) return { kind: GridCellKind.Boolean, data: value === true, allowOverlay: false, copyData: model.input(row, col) };
        // An empty value is an empty cell but for a formula that gives nothing.
        const input = value === null || typeof value === "string" ? model.input(row, col) : null;
        const style = options.columns.style(row, col);
        // An empty cell is drawn for its fill and edges alone.
        if (input === "") return style || mark || striped ? withMark(new TextCell(row, col, "", "", undefined, striped ? washed(themed(style)) : themed(style), style), mark) : EMPTY;
        // An error is shown by its code, as the engine names it; only a value that could be one is asked whether it is.
        const fault = typeof value === "string" && value.startsWith("#") && model.error(row, col) !== null;
        const drawn = fault || value === null || typeof value === "boolean" ? null : options.columns.draw(row, col, value);
        const worn = themed(style, fault ? theme.error : drawn?.hue && hues[drawn.hue]);
        return withMark(new TextCell(row, col, input, drawn ? drawn.text : shown(value), style?.align ?? (typeof value === "number" || type === "number" ? "right" : undefined), striped ? washed(worn) : worn, style,
          input !== null && !input.startsWith("=") && options.columns.frozen(row, col) || undefined), mark);
      };
      return ([col, at]: Item): GridCell => merges.length ? merged(at, col, p.map.sheet(at)) : own(p.map.sheet(at), col);
    };
    const content = useMemo(() => ({ head: contentOf(head), body: contentOf(body) }), [types, theme, cellLook]);
    // One number while every row is the default height: the grid then sums no heights to scroll. Heights set while a row's edge is dragged are by the sheet's row.
    const heightOf = (p: Part) => { const kept = options.columns.heights(); return kept.size || Object.keys(heights).length ? (drawn: number) => { const row = p.map.sheet(drawn); return heights[row] ?? kept.get(row) ?? theme.row; } : theme.row; };
    const rowHeight = useMemo(() => ({ head: heightOf(head), body: heightOf(body) }), [shape, heights, theme]);
    rowHeights.set(head, rowHeight.head).set(body, rowHeight.body);
    // The columns frozen stand at the left as the rest scroll; never all of those in view, or nothing could scroll.
    const freezeColumns = useMemo(() => { frozenCols = Math.min(options.columns.freeze().cols, cols - 1); return frozenCols; }, [shape, cols]);
    // The focus cell follows the active cell; while it is off the key stays the same, so a move draws no marks again.
    const focused = theme.focus && owner.current.current ? `${owner === head ? "head" : "body"}:${owner.current.current.cell.join()}` : "";
    const marks = useMemo(() => ({ head: marksOf(head), body: marksOf(body) }), [marked, shape, focused, theme.focus]);
    // A whole column's letter, picked, is washed as its cells are; the grid would fill it in the accent its fill handle and ring keep.
    const drawHeader: DataEditorProps["drawHeader"] = (args, draw) => { if (args.isSelected) { const { ctx, rect: box } = args, inset = args.columnIndex ? 1 : 0; for (const fill of [theme.grid.bgHeader, theme.picked]) { ctx.fillStyle = String(fill); ctx.fillRect(box.x + inset, box.y, box.width - inset, box.height); } } draw(); };
    // A filter's mark at its header cell's right: a caret, under a bar (a funnel) where the column keeps only some values.
    const drawCell = useMemo<NonNullable<DataEditorProps["drawCell"]>>(() => (args, content) => {
      const { block, line } = args.cell as { block?: [number, number]; line?: boolean };
      cellLook.draw(block ? { ...args, rect: { ...args.rect, y: args.rect.y - block[0], height: block[1] } } : args, content);
      if (line) { const { ctx, rect: box } = args, ink = ctx.fillStyle; ctx.fillStyle = args.theme.borderColor; ctx.fillRect(box.x, box.y, box.width, 1); ctx.fillStyle = ink; }
      const mark = (args.cell as { mark?: number }).mark;
      if (!mark) return;
      const { ctx, rect: box } = args, ink = ctx.fillStyle, wide = Number(theme.grid.headerIconSize) / 2, x = box.x + box.width - Number(theme.grid.cellHorizontalPadding) - wide, y = box.y + box.height / 2 - wide / 4;
      ctx.fillStyle = String(mark === 2 ? theme.grid.textDark : theme.grid.textMedium);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + wide, y); ctx.lineTo(x + wide / 2, y + wide / 2); ctx.closePath(); ctx.fill();
      if (mark === 2) ctx.fillRect(x, y - wide / 4, wide, 1);
      ctx.fillStyle = ink;
    }, [cellLook, theme]);
    const shared = { ...core, columns, freezeColumns, drawCell, drawHeader, theme: theme.grid as Partial<Theme> };
    // The head is as tall as its letters and rows: it never scrolls up or down.
    const headRows = size.head, headHeight = theme.header + Array.from({ length: headRows }, (_, drawn) => { const h = rowHeight.head; return typeof h === "number" ? h : h(drawn); }).reduce((sum, h) => sum + h, 0);
    // Sideways, the two parts scroll as one: a scroll of either moves the other, and the wheel over the head scrolls the body. Listened for on
    // each part's frame, as the grid makes its scroller once it is sized.
    useEffect(() => {
      const top = head.host, under = body.host, scroller = (into: HTMLElement) => into.querySelector<HTMLElement>(".dvn-scroller");
      if (!frozen || !top || !under) return;
      const follow = (to: HTMLElement) => (event: Event) => { const from = event.target as HTMLElement, into = scroller(to); if (from.classList.contains("dvn-scroller") && into && into.scrollLeft !== from.scrollLeft) into.scrollLeft = from.scrollLeft; };
      const down = follow(top), up = follow(under), wheel = (event: WheelEvent) => { event.preventDefault(); scroller(under)?.scrollBy(event.deltaX, event.deltaY); };
      under.addEventListener("scroll", down, true); top.addEventListener("scroll", up, true); top.addEventListener("wheel", wheel, { passive: false });
      return () => { under.removeEventListener("scroll", down, true); top.removeEventListener("scroll", up, true); top.removeEventListener("wheel", wheel); };
    }, [frozen]);
    const view = (p: Part, props: Pick<DataEditorProps, "rows" | "getCellContent"> & Partial<DataEditorProps>) => createElement("div", { ref: refs[p === head ? "head" : "body"].host, className: p === head ? "ui-spreadsheet-frozen" : "ui-spreadsheet-rows", style: p === head ? { height: `${headHeight}px` } : undefined },
      createElement(DataEditorCore, { ...handlers[p === head ? "head" : "body"], ...shared, ...props, drawFocusRing: owner === p, renderers: renderers[p === head ? "head" : "body"], ref: refs[p === head ? "head" : "body"].editor, ...props }));
    return createElement("div", { className: "ui-spreadsheet-views" },
      frozen ? view(head, { rows: headRows, getCellContent: content.head, rowHeight: rowHeight.head, headerHeight: theme.header, gridSelection: headSelection, highlightRegions: marks.head }) : null,
      view(body, { rows, getCellContent: content.body, rowHeight: rowHeight.body, headerHeight: frozen ? 0 : theme.header, gridSelection: bodySelection, highlightRegions: marks.body }));
  }

  const root = createRoot(element);
  root.render(createElement(Grid));
  const box = (p: Part, col: number, row: number) => p.editor?.getBounds(col, row);
  // The frozen columns first: they stand in view whatever the scroll.
  const colAt = (p: Part, x: number) => { const { view } = p; for (let at = frozenCols ? 0 : view.x; at < view.x + view.width + 1; at = at + 1 === frozenCols ? Math.max(view.x, frozenCols) : at + 1) { const cell = box(p, at, view.y); if (cell && x >= cell.x && x < cell.x + cell.width) return at; } return -1; };
  const rowAt = (p: Part, y: number) => { const { view } = p; for (let at = view.y; at < view.y + view.height + 1; at++) { const cell = box(p, view.x, at); if (cell && y >= cell.y && y < cell.y + cell.height) return at; } return -1; };
  /** The part a point is over, by the parts' own frames. */
  const partAt = (y: number) => frozenRows && head.host && y < head.host.getBoundingClientRect().bottom ? head : body;
  const rowEdge = (p: Part, x: number, y: number) => {
    const { view } = p, numbers = box(p, -1, view.y);
    if (!numbers || x < numbers.x || x >= numbers.x + numbers.width) return null;
    for (let at = view.y; at < view.y + view.height + 1; at++) { const cell = box(p, -1, at); if (cell && Math.abs(y - (cell.y + cell.height)) <= EDGE_SLOP) return { row: at, top: cell.y }; }
    return null;
  };
  let stop = () => {};
  // Dragged along the column letters or down the row numbers, the columns or rows between are picked.
  const sweep = (event: PointerEvent) => {
    const p = partAt(event.clientY), letters = frozenRows ? head : body, frame0 = (p.host ?? element).getBoundingClientRect(), lettersTop = (letters.host ?? element).getBoundingClientRect().top;
    const numbers = box(p, -1, p.view.y), top = p === letters ? frame0.top + look.header : frame0.top, left = numbers ? numbers.x + numbers.width : frame0.left;
    const across = p === letters && event.clientY >= lettersTop && event.clientY < lettersTop + look.header, down = !across && Boolean(numbers) && event.clientX < left;
    const at = (place: number) => across ? colAt(p, place) : rowAt(p, place), [lo, hi] = across ? [left, frame0.right] : [top, frame0.bottom], from = at(across ? event.clientX : event.clientY);
    // A press on an edge sizes (the grid's own columns, sizes.ts's rows); Shift and Ctrl add to the selection, as the grid does.
    const cell = across ? box(p, from, p.view.y) : undefined, onEdge = cell ? cell.x + cell.width - event.clientX <= COL_EDGE || (from > 0 && event.clientX - cell.x <= COL_EDGE) : rowEdge(p, event.clientX, event.clientY);
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || !(across || down) || from < 0 || onEdge) return;
    // Each frame, not each move: held past an edge, the grid scrolls a line at a time under a still pointer and the pick runs on with it.
    // The body scrolls (the head never does up or down); a drag down the head's numbers stays in the head.
    let to = from, place = across ? event.clientX : event.clientY, frame = 0, stepped = 0;
    const pick = (now: number) => { frame = requestAnimationFrame(pick);
      const past = place >= hi ? 1 : place < lo ? -1 : 0, under = at(Math.min(Math.max(place, lo + 1), hi - 1));
      if (under >= 0) to = under;
      // The next line on from the one at the edge, found by its own bounds: the grid tells its visible region only once a scroll settles.
      if (past && now - stepped > SWEEP_STEP && (across || p === body)) { stepped = now; const next = Math.min(Math.max(to + past, 0), (across ? size.cols : size.rows) - 1);
        if (across) body.editor?.scrollTo(next, body.view.y, "horizontal"); else body.editor?.scrollTo(body.view.x, next, "vertical"); }
      const lines = CompactSelection.fromSingleSelection([Math.min(from, to), Math.max(from, to) + 1]);
      if (lines.equals(across ? p.current.columns : p.current.rows)) return;
      choose(p, { columns: across ? lines : CompactSelection.empty(), rows: across ? CompactSelection.empty() : lines }); events.selected(picked()); };
    const move = (moved: PointerEvent) => { place = across ? moved.clientX : moved.clientY; };
    const up = () => { cancelAnimationFrame(frame); removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up); };
    stop(); stop = up;
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up); frame = requestAnimationFrame(pick);
  };
  element.addEventListener("pointerdown", sweep);
  // Ctrl as the fill handle is let go (the grid fills on the mouseup after it) counts a lone number up, or copies a series.
  const ctrl = (event: PointerEvent) => { counting = event.ctrlKey; };
  addEventListener("pointerup", ctrl, true);
  // What was last copied from this grid, as typed (its rows shown), and where from: pasted as it is, its relative references move as a
  // spreadsheet's do. A cut moves cells, whose references stay.
  let copied: { top: number; left: number; text: string; values: string[][] } | null = null;
  // Ctrl+Shift+V pastes what the cells copied showed, their values, not their formulas.
  const valuesIn = (area: SheetRange) => { const hidden = options.columns.hidden(), lines: string[][] = []; for (let row = area.top; row <= area.bottom; row++) if (!hidden.has(row)) lines.push(Array.from({ length: area.right - area.left + 1 }, (_, c) => { const value = model.value(row, area.left + c); return value === null ? "" : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value); })); return lines; };
  // Into the rows shown, a hidden one keeping what it holds.
  const pasteInto = (p: Part, [col, row]: Item, values: readonly (readonly string[])[]) => {
    const bottom = p.map.sheet(row + values.length - 1), right = col + Math.max(...values.map((line) => line.length)) - 1;
    if (bottom >= model.size().rows || right >= model.size().cols) events.fill({ top: p.map.sheet(row), left: col, bottom, right }, values.map((line) => [...line]));
    else write(values.flatMap((line, y) => line.map((input, x) => ({ row: p.map.sheet(row + y), col: col + x, input }))));
  };
  const typedIn = (area: SheetRange) => { const hidden = options.columns.hidden(), lines: string[] = []; for (let row = area.top; row <= area.bottom; row++) if (!hidden.has(row)) lines.push(Array.from({ length: area.right - area.left + 1 }, (_, c) => model.input(row, area.left + c)).join("\t")); return lines.join("\n"); };
  const clipped = (event: ClipboardEvent) => { if (!parts.some((p) => p.host?.contains(document.activeElement))) return; const area = event.type === "copy" ? picked() : null; copied = area && { top: area.top, left: area.left, text: typedIn(area), values: valuesIn(area) }; };
  addEventListener("copy", clipped, true); addEventListener("cut", clipped, true);
  const moved = (values: readonly (readonly string[])[], top: number, left: number): string[][] => {
    const same = copied && values.map((line) => line.join("\t")).join("\n") === copied.text;
    return values.map((line) => line.map((input) => same && input.startsWith("=") ? shiftRefs(input, top - copied!.top, left - copied!.left) : input));
  };
  const api: SheetGrid = {
    update: (changed) => {
      if (!changed) {
        // A selection is held as a part draws it: kept on the same sheet rows when rows are hidden, shown or frozen.
        const was = picked(), columns = owner.current.columns.length > 0, rows = owner.current.rows.length > 0, versions = parts.map((p) => p.map.version).join(), freeze = frozenRows;
        const cell = owner.current.current && { row: owner.map.sheet(owner.current.current.cell[1]), col: owner.current.current.cell[0] };
        drive.structure?.();
        if (!was || columns || (versions === parts.map((p) => p.map.version).join() && freeze === frozenRows)) return;
        if (rows) spread(was, partOf(was.top), (_, drawn) => ({ columns: CompactSelection.empty(), rows: CompactSelection.fromSingleSelection([drawn.top, drawn.bottom + 1]) }));
        else api.select(was);
        if (cell && !rows) { const into = partOf(cell.row), drawn = clip(into, { top: cell.row, bottom: cell.row, left: cell.col, right: cell.col }), held = into.current.current;
          if (drawn && held) choose(into, { ...into.current, current: { ...held, cell: [cell.col, drawn.top] } }); }
        return;
      }
      // Only what is in view is drawn again; the rest is read as it scrolls in. A merge over rows is drawn by each of its rows.
      if (merges.length) { const seen = new Set<SheetRange>(); changed = changed.flatMap((cell) => { const one = mergeAt(cell.row, cell.col); if (!one || one.bottom === one.top) return [cell]; if (seen.has(one)) return []; seen.add(one); return Array.from({ length: one.bottom - one.top + 1 }, (_, n) => ({ row: one.top + n, col: one.left })); }); }
      for (const p of parts) {
        const { view } = p, near = changed.flatMap(({ row: at, col }) => { const drawn = partOf(at) === p ? clip(p, { top: at, bottom: at, left: col, right: col }) : null; return drawn && drawn.top >= view.y && drawn.top < view.y + view.height + 1 && col >= view.x && col < view.x + view.width + 1 ? [{ cell: [col, drawn.top] as Item }] : []; });
        if (near.length) p.editor?.updateCells(near);
      }
    },
    // The grid scrolls a selection given it into view itself, as it draws it: a scroll of ours as well would be counted twice.
    select: (given) => {
      // A single cell in a hidden row is the first shown row's after it, as a move down onto it lands there.
      const lone = given && given.top === given.bottom && given.left === given.right ? partOf(given.top) : null, shownRow = lone && lone.map.hidden(given!.top) ? lone.map.sheet(lone.map.drawn(given!.top)) : null;
      const shownTo = given && shownRow !== null ? { ...given, top: shownRow, bottom: shownRow } : given, to = shownTo && grown(shownTo);
      // Held at once, not at React's next render: `whole` and the grid's own focus read it straight after. A range across the frozen rows' edge
      // is drawn in both parts, the cursor in the part of its first row.
      const into = to ? partOf(to.top) : body;
      if (to) spread(to, into, (p, drawn) => ({ columns: CompactSelection.empty(), rows: CompactSelection.empty(), current: { cell: [p === into ? to.left : drawn.left, drawn.top], range: rect(drawn), rangeStack: [] } }));
      else for (const p of parts) choose(p, NO_SELECTION);
      events.selected(to);
    },
    highlight: (list) => { comments = list.map((one) => ({ color: one.current ? look.markCurrent : look.mark, range: one.range, style: one.current ? "solid-outline" : "no-outline" })); drive.marks?.(); },
    // A whole column or row runs to the grid's end.
    references: (list: readonly SheetReference[]) => { references = list.map((one) => ({ color: look.inks[one.ink] ?? look.mark, range: one.range, style: one.pointing ? "dashed" : "solid" })); drive.marks?.(); },
    found: (list) => { found = list; drive.marks?.(); },
    // The region's edge cells may be cut off: those are scrolled to, the rest left where they are.
    show: (at, col) => {
      const p = partOf(at), drawn = clip(p, { top: at, bottom: at, left: col, right: col }), { view } = p, cell = p.current.current?.cell;
      if (cell && drawn && cell[0] === col && cell[1] === drawn.top) return;
      if (drawn && (col <= view.x || col >= view.x + view.width - 1 || (p === body && (drawn.top <= view.y || drawn.top >= view.y + view.height - 1)))) p.editor?.scrollTo(col, drawn.top, p === head ? "horizontal" : "both");
    },
    // The parts' boxes for a range, as one: clipped to the cells' part of each, under the letters and beside the row numbers, or the frozen columns where it scrolls under them.
    bounds: (whole) => {
      let out: SheetBox | null = null;
      for (const p of parts) {
        const area = clip(p, whole), frame = p.host?.getBoundingClientRect();
        if (!area || !frame) continue;
        const first = box(p, area.left, area.top), last = box(p, area.right, area.bottom), numbers = box(p, -1, area.top);
        if (!first || !last || !numbers) continue;
        const pinned = area.left >= frozenCols && frozenCols ? box(p, frozenCols - 1, area.top) : undefined, under = p === body && frozenRows ? frame.top : frame.top + look.header;
        const left = Math.max(first.x, pinned ? pinned.x + pinned.width : numbers.x + numbers.width), top = Math.max(first.y, under), right = Math.min(last.x + last.width, frame.right), bottom = Math.min(last.y + last.height, frame.bottom);
        if (right <= left || bottom <= top) continue;
        out = out ? { left: Math.min(out.left, left), top: Math.min(out.top, top), width: Math.max(out.left + out.width, right) - Math.min(out.left, left), height: Math.max(out.top + out.height, bottom) - Math.min(out.top, top) } : { left, top, width: right - left, height: bottom - top };
      }
      return out;
    },
    cellAt: (x, y) => {
      const p = partAt(y), col = colAt(p, x), row = rowAt(p, y);
      return col < 0 || row < 0 ? null : { row: p.map.sheet(row), col };
    },
    moved,
    copiedValues: () => copied?.values ?? null,
    whole: (kind) => {
      const area = picked();
      if (!area) return;
      if (kind === "cols") { const lines = CompactSelection.fromSingleSelection([area.left, area.right + 1]); choose(owner, { columns: lines, rows: CompactSelection.empty() }); }
      else spread({ ...area, left: 0, right: size.cols - 1 }, partOf(area.top), (_, drawn) => ({ columns: CompactSelection.empty(), rows: CompactSelection.fromSingleSelection([drawn.top, drawn.bottom + 1]) }));
      events.selected(picked());
    },
    rowEdge: (x, y) => { const p = partAt(y), edge = rowEdge(p, x, y); return edge && { ...edge, row: p.map.sheet(edge.row) }; },
    height: (row, height) => drive.height?.(row, height),
    theme: (next) => { look = next; drive.look?.(look); },
    scroll: (to) => { if (to) { const drawn = clip(body, { top: to.row, bottom: to.row, left: to.col, right: to.col }); body.editor?.scrollTo(to.col, drawn?.top ?? 0, "both", 0, 0, { hAlign: "start", vAlign: "start" }); } return { row: body.map.sheet(body.view.y), col: body.view.x }; },
    focus: () => owner.editor?.focus(),
    destroy: () => { stop(); element.removeEventListener("pointerdown", sweep); removeEventListener("pointerup", ctrl, true); removeEventListener("copy", clipped, true); removeEventListener("cut", clipped, true); root.unmount(); },
  };
  return api;
}
