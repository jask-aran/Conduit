import { HyperFormula } from "hyperformula";
import { blockId } from "./document-format.js";

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
export const CONFIG = { licenseKey: "gpl-v3", dateFormats: [], timeFormats: [], maxRows: SHEET_LIMIT, maxColumns: COL_LIMIT, undoLimit: 0 };
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
  const reindex = () => { rowIds = rows.toArray(); colIds = cols.toArray(); rowIndex = new Map(rowIds.map((id, at) => [id, at])); colIndexOf = new Map(colIds.map((id, at) => [id, at])); };
  const placeOf = (cell) => { const cut = cell.indexOf(":"), row = rowIndex.get(cell.slice(0, cut)), col = colIndexOf.get(cell.slice(cut + 1)); return row === undefined || col === undefined ? null : { sheet, row, col }; };
  const rebuild = () => {
    reindex();
    const grid = Array.from({ length: rowIds.length }, () => new Array(colIds.length).fill(null));
    for (const [cell, input] of cells) { const place = placeOf(cell); if (place) grid[place.row][place.col] = raw(input); }
    engine?.destroy();
    engine = HyperFormula.buildFromArray(grid, CONFIG); sheet = engine.getSheetId(engine.getSheetNames()[0]);
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
    // The hub's own structure change was made in the engine first.
    if (transaction.origin === self) reindex();
    else if (now.keys.size > REBUILD_AT) rebuild();
    else {
      // Suspended rather than batched: a batch keeps what it changed for an undo, many times slower for many cells.
      engine.suspendEvaluation();
      try {
        if (now.rows) along(now.rows, (at, n) => engine.addRows(sheet, [at, n]), (at, n) => engine.removeRows(sheet, [at, n]));
        if (now.cols) along(now.cols, (at, n) => engine.addColumns(sheet, [at, n]), (at, n) => engine.removeColumns(sheet, [at, n]));
        if (structure) reindex();
        for (const cell of now.keys) {
          const place = placeOf(cell), input = raw(cells.get(cell));
          // A formula the engine already rewrote for the same structure change is left as it is.
          if (place && !(structure && input?.startsWith("=") && engine.getCellFormula(place) === input)) engine.setCellContents(place, input);
        }
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
    input: (r, c) => rowIds[r] === undefined || colIds[c] === undefined ? "" : cells.get(key(rowIds[r], colIds[c])) ?? "",
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
      const formulas = [];
      for (const [cell, input] of cells) if (input.startsWith("=")) { const place = placeOf(cell); if (place) formulas.push([cell, engine.getCellFormula(place)]); }
      const gone = new Set(removing ? ids.slice(at, at + count) : []), side = (cell) => isRows ? cell.slice(0, cell.indexOf(":")) : cell.slice(cell.indexOf(":") + 1);
      if (isRows) (removing ? engine.removeRows : engine.addRows).call(engine, sheet, [at, count]);
      else (removing ? engine.removeColumns : engine.addColumns).call(engine, sheet, [at, count]);
      doc.transact(() => {
        if (removing) list.delete(at, count); else list.insert(at, Array.from({ length: count }, blockId));
        reindex();
        if (gone.size) for (const cell of [...cells.keys()]) if (gone.has(side(cell))) cells.delete(cell);
        for (const [cell, before] of formulas) {
          const place = !gone.has(side(cell)) && placeOf(cell), after = place && engine.getCellFormula(place);
          if (after && after !== before) cells.set(cell, after);
        }
        write();
      }, self);
      return { rows: rowIds.length, cols: colIds.length };
    },
    destroy() { rows.unobserve(onRows); cols.unobserve(onCols); cells.unobserve(onCells); doc.off("afterTransaction", flush); listeners.clear(); engine.destroy(); },
  };
}
