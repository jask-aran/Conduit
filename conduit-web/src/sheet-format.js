import { HyperFormula } from "hyperformula";
import * as Y from "yjs";
import { blockId } from "./document-format.js";
import { NAMES } from "./sheet-functions.js";

/*
 * A sheet (the `sheet` artifact kind): one tab of cells kept in a Yjs doc that the hub and every open page merge, and computed by the same
 * formula engine on both, so a value the page draws is the value the hub writes to the file. The doc holds what was typed; values are never kept in it.
 * Rows and columns have ids, so a cell, a comment's corners and a column's look follow their row and column when others are inserted. Only the hub
 * inserts or deletes rows and columns (`structure`): a formula that refers to moved cells is rewritten in the same change.
 */
export const SHEET_FORMAT = 1, ROWS = "rows", COLS = "cols", CELLS = "cells", LOOK = "look";
/** Cells in one sheet, cells in one call, and columns (the engine's own bound: ZZZ). */
export const SHEET_LIMIT = 200_000, CALL_LIMIT = 100_000, COL_LIMIT = 18_278;
export const rowId = blockId, colId = blockId;
export const key = (row, col) => `${row}:${col}`;
export const colName = (col) => { let name = ""; for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name; return name; };
export const a1 = (row, col) => `${colName(col)}${row + 1}`;
const A1 = /^\$?([A-Za-z]{1,3})\$?([1-9]\d{0,6})$/;
export const colIndex = (letters) => { let col = 0; for (const letter of letters.toUpperCase()) col = col * 26 + letter.charCodeAt(0) - 64; return col - 1; };
export const parseA1 = (text) => { const hit = A1.exec(String(text ?? "").trim()); return hit ? { row: Number(hit[2]) - 1, col: colIndex(hit[1]) } : null; };
export const parseRange = (text) => {
  const [from, to = from, more] = String(text ?? "").split(":"), a = parseA1(from), b = parseA1(to);
  return a && b && more === undefined ? { top: Math.min(a.row, b.row), left: Math.min(a.col, b.col), bottom: Math.max(a.row, b.row), right: Math.max(a.col, b.col) } : null;
};
export const rangeA1 = ({ top, left, bottom, right }) => top === bottom && left === right ? a1(top, left) : `${a1(top, left)}:${a1(bottom, right)}`;

const QUOTED = /[",\r\n]/, DELIMITER = /[,\r\n]/g;
/** RFC 4180: a field is quoted when it holds a comma, a quote or a line break; each row ends with `eol`. */
export const toCsv = (rows, eol = "\n") => rows.map((row) => row.map((field) => QUOTED.test(field) ? `"${field.replace(/"/g, '""')}"` : field).join(",")).join(eol) + (rows.length ? eol : "");
/** Rows as written (they need not be the same length); a line break inside quotes is kept as it is, a BOM is dropped, and the last line break ends the last row. */
export function fromCsv(text) {
  const rows = [], n = text.length, end = (at) => { DELIMITER.lastIndex = at; return DELIMITER.exec(text)?.index ?? n; };
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0, row = [];
  while (at < n) {
    let field = "";
    if (text[at] === '"') {
      for (at += 1; ;) {
        const close = text.indexOf('"', at);
        if (close < 0) { field += text.slice(at); at = n; break; }
        field += text.slice(at, close);
        if (text[close + 1] === '"') { field += '"'; at = close + 2; } else { at = close + 1; break; }
      }
    }
    // What follows a closing quote (a loose file) is kept as written.
    const stop = end(at);
    row.push(field + text.slice(at, stop));
    at = stop;
    if (text[at] === ",") { at += 1; if (at >= n) { row.push(""); rows.push(row); } continue; }
    rows.push(row); row = [];
    if (text[at] === "\r") at += 1;
    if (text[at] === "\n") at += 1;
  }
  return rows;
}

// Dates are not read from text: a cell typed "01/02/2024" stays that text, so the file holds what was typed.
// Nothing is undone in the engine (the doc is what is undone), so it keeps no undo stack.
// As a spreadsheet computes: date serials count its false 29 February 1900 (DATE(1900,1,1) is 1); a range in arithmetic is an array (SUM(A1:A3*B1:B3),
// and `=A1:A3` spills); `=A1` of an empty cell is 0; "a" and "á" differ, "a" and "A" do not; values show 15 significant digits (the engine's
// default of 11 made 123456789012 read 123456789010; its count is one more than the setting). Criteria match whole cells with wildcards, as the defaults do.
export const CONFIG = {
  licenseKey: "gpl-v3", dateFormats: [], timeFormats: [], maxRows: SHEET_LIMIT, maxColumns: COL_LIMIT, undoLimit: 0,
  leapYear1900: true, nullDate: { year: 1899, month: 12, day: 31 }, useArrayArithmetic: true, evaluateNullToZero: true, accentSensitive: true, precisionRounding: 14,
};
/** The engine as every sheet builds it: CONFIG, and the names a spreadsheet's formulas use bare. */
const buildEngine =(grid) => HyperFormula.buildFromArray(grid, CONFIG, NAMES);
// Past this many cells in one change a new engine is built from the doc, which is then faster than as many single sets.
const REBUILD_AT = 50_000;
const raw = (input) => input === undefined || input === "" ? null : input;
const isError = (value) => value !== null && typeof value === "object";
/** A computed value as the file writes it. */
export const valueText = (value) => value === null || value === undefined ? "" : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : isError(value) ? value.value : String(value);

export function createSheetModel(doc) {
  const rows = doc.getArray(ROWS), cols = doc.getArray(COLS), cells = doc.getMap(CELLS), self = {};
  let engine, sheet;
  const listeners = new Set();
  let rowIds = [], colIds = [], rowIndex = new Map(), colIndexOf = new Map(), pending = null;
  // What was typed, by position ("" where nothing is): the cells as of the last change, so reading them in order is no lookup by ids.
  let typed = [], written = null;
  const reindexRows = () => { rowIds = rows.toArray(); rowIndex = new Map(rowIds.map((id, at) => [id, at])); };
  const reindexCols = () => { colIds = cols.toArray(); colIndexOf = new Map(colIds.map((id, at) => [id, at])); };
  const placeOf = (cell) => { const cut = cell.indexOf(":"), row = rowIndex.get(cell.slice(0, cut)), col = colIndexOf.get(cell.slice(cut + 1)); return row === undefined || col === undefined ? null : { sheet, row, col }; };
  const blankRow = () => new Array(colIds.length).fill("");
  const eachFormula = (each) => {
    for (let row = 0; row < typed.length; row++) { const line = typed[row]; for (let col = 0; col < line.length; col++) { const input = line[col]; if (typeof input === "string" && input.charCodeAt(0) === 61) each(row, col, input); } }
  };
  /** Rows or columns inserted or deleted in `typed`, as they were in the doc. */
  // Not spliced in as arguments: a call takes only so many, and a sheet's rows are more.
  const moveRows = (at, n, removing) => { typed = removing ? typed.slice(0, at).concat(typed.slice(at + n)) : typed.slice(0, at).concat(Array.from({ length: n }, blankRow), typed.slice(at)); };
  const moveCols = (at, n, removing) => { typed = typed.map((row) => removing ? row.slice(0, at).concat(row.slice(at + n)) : row.slice(0, at).concat(new Array(n).fill(""), row.slice(at))); };
  const rebuild = () => {
    reindexRows(); reindexCols();
    typed = Array.from({ length: rowIds.length }, blankRow);
    const grid = Array.from({ length: rowIds.length }, () => new Array(colIds.length).fill(null));
    for (const [cell, input] of cells) { const place = placeOf(cell); if (place) { typed[place.row][place.col] = input ?? ""; grid[place.row][place.col] = raw(input); } }
    engine?.destroy();
    engine = buildEngine(grid); sheet = engine.getSheetId(engine.getSheetNames()[0]);
  };
  /** A Y.Array's delta as the engine's row or column inserts and deletes. */
  const along = (delta, add, remove) => {
    let at = 0;
    for (const step of delta) {
      if (step.retain) at += step.retain;
      else if (step.insert) { add(at, step.insert.length); at += step.insert.length; }
      else if (step.delete) remove(at, step.delete);
    }
  };
  const note = () => pending ??= { rows: null, cols: null, keys: new Set() };
  const onRows = (event) => { note().rows = event.changes.delta; }, onCols = (event) => { note().cols = event.changes.delta; };
  const onCells = (event) => { const keys = note().keys; for (const cell of event.keysChanged) keys.add(cell); };
  /** Each change to the doc reaches the engine once, as one batch, after the change is whole. */
  const flush = (transaction) => {
    const now = pending, structure = Boolean(now?.rows || now?.cols);
    pending = null;
    if (!now) return;
    let changed = null;
    const retype = (done) => {
      const places = [];
      for (const cell of now.keys) { if (done?.has(cell)) continue; const place = placeOf(cell); if (place) { const input = cells.get(cell); typed[place.row][place.col] = input ?? ""; places.push([place, raw(input)]); } }
      return places;
    };
    // The hub's own structure change was made in the engine and in `typed` first: only what `write` changed is left.
    if (transaction.origin === self) { retype(written); written = null; }
    // A structure change rewrites many formulas, which the engine rewrites too: that is no reason to build it again.
    else if (!structure && now.keys.size > REBUILD_AT) rebuild();
    else {
      // Suspended rather than batched: a batch keeps what it changed for an undo, many times slower for many cells.
      engine.suspendEvaluation();
      try {
        if (now.rows) along(now.rows, (at, n) => { engine.addRows(sheet, [at, n]); moveRows(at, n, false); }, (at, n) => { engine.removeRows(sheet, [at, n]); moveRows(at, n, true); });
        if (now.cols) along(now.cols, (at, n) => { engine.addColumns(sheet, [at, n]); moveCols(at, n, false); }, (at, n) => { engine.removeColumns(sheet, [at, n]); moveCols(at, n, true); });
        if (now.rows) reindexRows();
        if (now.cols) reindexCols();
        // After a structure change every formula is as the doc says: one the engine already rewrote in the same way is left as it is, and one typed
        // here while the hub made the change, which the engine rewrote but the hub never saw, goes back to what the doc holds.
        for (const [place, input] of retype()) if (!(structure && input?.startsWith("="))) engine.setCellContents(place, input);
        if (structure) eachFormula((row, col, input) => { if (engine.getCellFormula({ sheet, row, col }) !== input) engine.setCellContents({ sheet, row, col }, input); });
      } finally { changed = engine.resumeEvaluation().flatMap((change) => change.address ? [{ row: change.address.row, col: change.address.col }] : []); }
    }
    for (const listener of listeners) listener({ structure, cells: changed });
  };
  rows.observe(onRows); cols.observe(onCols); cells.observe(onCells);
  doc.on("afterTransaction", flush);
  rebuild();
  const read = (r, c) => engine.getCellValue({ sheet, row: r, col: c });
  return {
    get engine() { return engine; }, get sheet() { return sheet; },
    size: () => ({ rows: rowIds.length, cols: colIds.length }),
    input: (r, c) => typed[r]?.[c] ?? "",
    inputs: () => typed.map((line) => line.slice()),
    value: (r, c) => { const value = read(r, c); return isError(value) ? value.value : value; },
    error: (r, c) => { const value = read(r, c); return isError(value) ? value.message || value.value : null; },
    rowAt: (i) => rowIds[i], colAt: (i) => colIds[i],
    indexOfRow: (id) => rowIndex.get(id) ?? -1, indexOfCol: (id) => colIndexOf.get(id) ?? -1,
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    /**
     * Rows or columns inserted or deleted (the hub's alone): made in the engine first, which rewrites every formula that refers to moved cells, then
     * written to the doc in one change with those formulas and with the deleted rows' or columns' cells gone. `write` runs in that change too.
     */
    structure(op, at, count, write = () => {}) {
      const isRows = op === "insert-rows" || op === "delete-rows", removing = op.startsWith("delete"), ids = isRows ? rowIds : colIds, list = isRows ? rows : cols;
      // Each formula by its row and column ids, with the engine's text of it before the change.
      const formulas = [];
      eachFormula((row, col) => formulas.push([rowIds[row], colIds[col], engine.getCellFormula({ sheet, row, col })]));
      const gone = new Set(removing ? ids.slice(at, at + count) : []), across = isRows ? colIds : rowIds;
      if (isRows) (removing ? engine.removeRows : engine.addRows).call(engine, sheet, [at, count]);
      else (removing ? engine.removeColumns : engine.addColumns).call(engine, sheet, [at, count]);
      doc.transact(() => {
        if (removing) list.delete(at, count); else list.insert(at, Array.from({ length: count }, blockId));
        if (isRows) { reindexRows(); moveRows(at, count, removing); } else { reindexCols(); moveCols(at, count, removing); }
        // The cells of what was deleted, found by their ids (a cell whose other id is gone too was never placed, and is left).
        for (const id of gone) for (const other of across) { const cell = isRows ? key(id, other) : key(other, id); if (cells.has(cell)) cells.delete(cell); }
        written = new Set();
        for (const [row, col, before] of formulas) {
          if (gone.has(isRows ? row : col)) continue;
          const place = { sheet, row: rowIndex.get(row), col: colIndexOf.get(col) }, after = engine.getCellFormula(place);
          if (after && after !== before) { const cell = key(row, col); cells.set(cell, after); typed[place.row][place.col] = after; written.add(cell); }
        }
        write();
      }, self);
      return { rows: rowIds.length, cols: colIds.length };
    },
    destroy() { rows.unobserve(onRows); cols.unobserve(onCols); cells.unobserve(onCells); doc.off("afterTransaction", flush); listeners.clear(); engine.destroy(); },
  };
}

/** A value as it crosses to the page: an error as [code, message], anything else as it is. */
const sent = (value) => isError(value) ? [value.value, value.message || value.value] : value;
/**
 * The engine off the page's thread (in a Web Worker: `serveSheetModel(self)`): a copy of the doc kept from the updates `createSheetView` sends,
 * computed by createSheetModel, and what it computes sent back, each cell by its ids. Updates that arrive together are taken as one change.
 */
export function serveSheetModel(port) {
  const doc = new Y.Doc(), queue = [];
  let model = null, closed = false;
  const all = () => {
    const values = model.engine.getSheetValues(model.sheet), at = [], value = [];
    values.forEach((line, r) => line.forEach((one, c) => { if (one !== null) { at.push(key(model.rowAt(r), model.colAt(c))); value.push(sent(one)); } }));
    return { at, value };
  };
  const take = () => {
    if (closed || !queue.length) return;
    const updates = queue.splice(0);
    doc.transact(() => { for (const update of updates) Y.applyUpdate(doc, update); });
    if (model) return;
    model = createSheetModel(doc);
    model.onChange(({ cells }) => port.postMessage(cells ? { at: cells.map(({ row, col }) => key(model.rowAt(row), model.colAt(col))), value: cells.map(({ row, col }) => sent(model.engine.getCellValue({ sheet: model.sheet, row, col }))) } : { all: true, ...all() }));
    port.postMessage({ all: true, ...all() });
  };
  port.addEventListener("message", ({ data }) => {
    if (data.close) { closed = true; model?.destroy(); doc.destroy(); return; }
    if (queue.push(data.update) === 1) setTimeout(take, 0);
  });
  port.start?.();
}

/**
 * The page's sheet when its engine is in a worker (`serveSheetModel`), read as a SheetModel is: what was typed, the rows and the columns are the
 * page's own doc; values are what the worker last sent, kept by each cell's ids, so rows or columns inserted or deleted move them at once and
 * only values that changed wait for the worker. `onChange`: `structure` at once when rows or columns change, `cells` when values arrive.
 */
export function createSheetView(doc, port) {
  const rows = doc.getArray(ROWS), cols = doc.getArray(COLS), cells = doc.getMap(CELLS), listeners = new Set(), values = new Map();
  let rowIds = [], colIds = [], rowIndex = new Map(), colIndexOf = new Map(), moved = false, isReady;
  const reindex = () => { rowIds = rows.toArray(); colIds = cols.toArray(); rowIndex = new Map(rowIds.map((id, at) => [id, at])); colIndexOf = new Map(colIds.map((id, at) => [id, at])); };
  const emit = (change) => { for (const listener of listeners) listener(change); };
  const read = (r, c) => rowIds[r] === undefined || colIds[c] === undefined ? null : values.get(key(rowIds[r], colIds[c])) ?? null;
  const onMoved = () => { moved = true; };
  const after = () => { if (moved) { moved = false; reindex(); emit({ structure: true, cells: null }); } };
  const onUpdate = (update) => port.postMessage({ update });
  const onMessage = ({ data }) => {
    if (data.all) values.clear();
    const changed = [];
    data.at.forEach((cell, i) => {
      const value = data.value[i];
      if (value === null) values.delete(cell); else values.set(cell, value);
      if (data.all) return;
      const cut = cell.indexOf(":"), row = rowIndex.get(cell.slice(0, cut)), col = colIndexOf.get(cell.slice(cut + 1));
      if (row !== undefined && col !== undefined) changed.push({ row, col });
    });
    emit({ structure: false, cells: data.all ? null : changed });
    if (data.all) isReady();
  };
  const ready = new Promise((done) => { isReady = done; });
  rows.observe(onMoved); cols.observe(onMoved); doc.on("afterTransaction", after); doc.on("update", onUpdate);
  port.addEventListener("message", onMessage); port.start?.();
  reindex();
  port.postMessage({ update: Y.encodeStateAsUpdate(doc) });
  const input = (r, c) => rowIds[r] === undefined || colIds[c] === undefined ? "" : cells.get(key(rowIds[r], colIds[c])) ?? "";
  return {
    ready,
    size: () => ({ rows: rowIds.length, cols: colIds.length }),
    input, inputs: () => rowIds.map((_, r) => colIds.map((_, c) => input(r, c))),
    value: (r, c) => { const value = read(r, c); return Array.isArray(value) ? value[0] : value; },
    error: (r, c) => { const value = read(r, c); return Array.isArray(value) ? value[1] : null; },
    rowAt: (i) => rowIds[i], colAt: (i) => colIds[i],
    indexOfRow: (id) => rowIndex.get(id) ?? -1, indexOfCol: (id) => colIndexOf.get(id) ?? -1,
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { rows.unobserve(onMoved); cols.unobserve(onMoved); doc.off("afterTransaction", after); doc.off("update", onUpdate); port.removeEventListener("message", onMessage); listeners.clear(); port.postMessage({ close: true }); },
  };
}
