import * as Y from "yjs";
import { blockId } from "./block-id.js";

/*
 * A sheet (the `sheet` artifact kind): a workbook of tabs of cells kept in a Yjs doc that the hub and every open page merge, and computed by the same
 * formula engine on both, so a value the page draws is the value the hub writes to the file. The doc holds what was typed; values are never kept in it.
 * Rows and columns have ids, so a cell, a comment's corners and a column's look follow their row and column when others are inserted. Only the hub
 * inserts or deletes rows and columns (`structure`), and adds, renames, deletes or moves tabs (`tabOp`): a formula that refers to moved cells or a
 * renamed tab is rewritten in the same change.
 *
 * Tabs: `tabs` is their ids in order and `tab` holds `name:<id>` and `hidden:<id>`. Tab `main` keeps the root `rows`/`cols`, any other has
 * `rows:<id>`/`cols:<id>`. Row and column ids are unique across the doc, so `cells` and `look` stay one map each: a cell's row names its tab.
 * A doc with no `tabs` (format 1) is the one tab `main`, and nothing of tabs is written until a second is added.
 */
export const SHEET_FORMAT = 2, ROWS = "rows", COLS = "cols", CELLS = "cells", LOOK = "look", TABS = "tabs", TAB = "tab", MAIN = "main";
/** Cells in one tab, in one workbook, in one call, and columns (the engine's own bound: ZZZ). */
export const SHEET_LIMIT = 200_000, WORKBOOK_LIMIT = 500_000, CALL_LIMIT = 100_000, COL_LIMIT = 18_278;
export const rowId = blockId, colId = blockId;
export const rowsOf = (tab) => tab === MAIN ? ROWS : `${ROWS}:${tab}`, colsOf = (tab) => tab === MAIN ? COLS : `${COLS}:${tab}`;
// The engine's name for a tab never named: a one-tab sheet's name is its file's only once a second tab makes it written.
export const FIRST = "Sheet1";
/** Why a tab cannot have this name, as a spreadsheet's rules say, or null. */
export const tabNameFault = (name) => {
  const text = typeof name === "string" ? name : "";
  return !text.trim() ? "A tab needs a name" : text.length > 31 ? "A tab's name is at most 31 characters" : /[\\/?*[\]:]/.test(text) ? "A tab's name has none of \\ / ? * [ ] :" : /^'|'$/.test(text) ? "A tab's name does not start or end with '" : null;
};
/** A name made one a tab can have. */
export const tabName = (name) => String(name ?? "").replace(/[\\/?*[\]:]/g, " ").replace(/^'+|'+$/g, "").slice(0, 31).trim() || FIRST;
/** A tab's name as a formula writes it before `!`: quoted unless it could be read as nothing else. */
export const tabRef = (name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^R\d*C\d*$/i.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
/** `'My Data'!B2:C5` as { tab: "My Data", range: "B2:C5" }; with no tab, tab is null. */
export const parseRef = (text) => {
  const said = String(text ?? "").trim(), hit = /^(?:'((?:[^']|'')+)'|([^'!:]+))!(.*)$/.exec(said);
  return hit ? { tab: hit[1] !== undefined ? hit[1].replace(/''/g, "'") : hit[2].trim(), range: hit[3].trim() } : { tab: null, range: said };
};
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

/** RFC 4180: a field is quoted when it holds the separator (`sep`: a comma, or a tab as a clipboard's cells are), a quote or a line break; each row ends with `eol`. */
export const toCsv = (rows, eol = "\n", sep = ",") => { const quoted = new RegExp(`["${sep}\r\n]`); return rows.map((row) => row.map((field) => quoted.test(field) ? `"${field.replace(/"/g, '""')}"` : field).join(sep)).join(eol) + (rows.length ? eol : ""); };
/** Rows as written (they need not be the same length); a line break inside quotes is kept as it is, a BOM is dropped, and the last line break ends the last row. */
export function fromCsv(text, sep = ",") {
  const rows = [], n = text.length, delimiter = new RegExp(`[${sep}\r\n]`, "g"), end = (at) => { delimiter.lastIndex = at; return delimiter.exec(text)?.index ?? n; };
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
    if (text[at] === sep) { at += 1; if (at >= n) { row.push(""); rows.push(row); } continue; }
    rows.push(row); row = [];
    if (text[at] === "\r") at += 1;
    if (text[at] === "\n") at += 1;
  }
  return rows;
}

export const isError = (value) => value !== null && typeof value === "object";
/** A computed value as the file writes it. */
export const valueText = (value) => value === null || value === undefined ? "" : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : isError(value) ? value.value : String(value);
export const rangedArea = (view, ranged) => {
  const at = (corner) => { const text = String(corner ?? ""), cut = text.indexOf(":"); return cut < 0 ? [-1, -1] : [view.indexOfRow(text.slice(0, cut)), view.indexOfCol(text.slice(cut + 1))]; };
  const [top, left] = at(ranged?.from), [bottom, right] = at(ranged?.to);
  return top >= 0 && left >= 0 && bottom >= top && right >= left ? { top, left, bottom, right } : null;
};
export const filterHides = (view, filter) => {
  const area = rangedArea(view, filter), out = [];
  if (!area || !filter.keep) return out;
  const cols = Object.entries(filter.keep).flatMap(([id, list]) => { const col = view.indexOfCol(id); return col >= area.left && col <= area.right ? [[col, new Set(list)]] : []; });
  if (cols.length) for (let row = area.top + 1; row <= area.bottom; row++) if (cols.some(([col, list]) => !list.has(valueText(view.value(row, col))))) out.push(view.rowAt(row));
  return out;
};
/** A tab not there (yet): what a model or view of it reads. */
export const NONE = Object.freeze({ id: undefined, rowIds: [], colIds: [], rowIndex: new Map(), colIndex: new Map(), typed: [], sheet: -1 });
/** The tabs' ids in order: a doc with no `tabs` is the one tab `main`. */
export const listed = (order) => { const ids = order.toArray(); return ids.length ? ids : [MAIN]; };
/** A computed value as it crosses from the engine's worker: an error as [code, message], anything else as it is. */
export const sent = (value) => isError(value) ? [value.value, value.message || value.value] : value;

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
/** What a typed cell shows until the engine says: a number, a percentage or TRUE/FALSE as the engine reads them, text as typed; a formula waits. */
export const guess = (input) => {
  if (input.charCodeAt(0) === 61) return null;
  const text = input.trim(), percent = text.endsWith("%") && NUMBER.test(text.slice(0, -1));
  return NUMBER.test(text) ? Number(text) : percent ? Number(text.slice(0, -1)) / 100 : /^(?:true|false)$/i.test(text) ? text.toLowerCase() === "true" : input.charCodeAt(0) === 39 ? input.slice(1) : input;
};

/**
 * The page's workbook when its engine is in a worker (sheet-engine.js `serveSheetModel`), read as a WorkbookModel is: what was typed, the tabs, rows
 * and columns are the page's own doc, so they draw at once; values are what the worker last sent, kept by each cell's ids, so rows or columns put in
 * or taken out move them at once. A cell typed since the worker last answered shows what was typed (as `guess` reads it) or, for a formula, its last
 * value. A tab's `onChange`: `structure` at once when its rows or columns or the tabs change, `cells` when a cell is typed and when values arrive.
 * `name`: what a tab never named is called, as createWorkbookModel's.
 */
export function createSheetView(doc, port, { name: called } = {}) {
  const order = doc.getArray(TABS), meta = doc.getMap(TAB), cells = doc.getMap(CELLS), views = new Set(), listeners = new Set();
  // `stale`: each cell typed since the worker last answered, with the number of the update that typed it; `next`: a whole set of values arriving in parts.
  const stale = new Map();
  let ids = [], tabs = new Map(), rowTab = new Map(), watched = new Map(), values = new Map(), next = null, names = [], posted = 0, taken = 0, built = false, isReady;
  const nameOf = (id) => meta.get(`name:${id}`) ?? (id === MAIN ? called ?? FIRST : id);
  const list = () => ids.map((id) => ({ id, name: nameOf(id), hidden: meta.get(`hidden:${id}`) === true }));
  const index = (id) => {
    const rows = doc.getArray(rowsOf(id)), cols = doc.getArray(colsOf(id)), t = { id, rowIds: rows.toArray(), colIds: cols.toArray() };
    t.rowIndex = new Map(t.rowIds.map((one, at) => [one, at])); t.colIndex = new Map(t.colIds.map((one, at) => [one, at]));
    for (const row of tabs.get(id)?.rowIds ?? []) rowTab.delete(row);
    for (const row of t.rowIds) rowTab.set(row, t);
    tabs.set(id, t); watched.set(rows, id); watched.set(cols, id);
  };
  const reindex = () => { ids = listed(order); tabs = new Map(); rowTab = new Map(); watched = new Map([[order, null], [meta, null]]); for (const id of ids) index(id); };
  const placeOf = (cell) => { const cut = cell.indexOf(":"), t = rowTab.get(cell.slice(0, cut)), col = t?.colIndex.get(cell.slice(cut + 1)); return col === undefined ? null : { tab: t.id, row: t.rowIndex.get(cell.slice(0, cut)), col }; };
  const emit = (change, only) => { for (const one of views) if (!only || only.has(one.which())) for (const listener of one.listeners) listener(change); };
  const tell = (change) => { for (const listener of listeners) listener(change); };
  /** Cells by key, told to their tabs' views as changed. */
  const redraw = (keys) => {
    const byTab = new Map();
    for (const cell of keys) { const place = placeOf(cell); if (place) (byTab.get(place.tab) ?? byTab.set(place.tab, []).get(place.tab)).push({ row: place.row, col: place.col }); }
    for (const [id, list] of byTab) emit({ structure: false, cells: list }, new Set([id]));
  };
  // Runs before the transaction's update is posted, so that update is `posted + 1`.
  const after = (transaction) => {
    let whole = false;
    const moved = new Set();
    for (const type of transaction.changed.keys()) if (watched.has(type)) { const id = watched.get(type); if (id === null) whole = true; else moved.add(id); }
    if (whole) { const was = JSON.stringify(list()); reindex(); emit({ structure: true, cells: null }); if (JSON.stringify(list()) !== was) tell({ tabs: true }); }
    else if (moved.size) { for (const id of moved) index(id); emit({ structure: true, cells: null }, moved); }
    const typed = transaction.changed.get(cells);
    if (!typed) return;
    for (const cell of typed) stale.set(cell, posted + 1);
    if (!whole) redraw(typed);
  };
  const onUpdate = (update) => { posted += 1; port.postMessage({ update }); if (posted === taken + 1) tell({ computing: true }); };
  const onMessage = ({ data }) => {
    if (data.functions) { names = data.functions; return tell({ functions: true }); }
    const into = data.full ? (next ??= new Map()) : values;
    for (let i = 0; i < data.at.length; i++) { const value = data.value[i]; if (value === null) into.delete(data.at[i]); else into.set(data.at[i], value); }
    if (!data.full) redraw(data.at);
    if (data.taken === undefined) return;
    taken = data.taken;
    const settled = [];
    for (const [cell, by] of stale) if (by <= taken) { stale.delete(cell); settled.push(cell); }
    if (next) { values = next; next = null; emit({ structure: false, cells: null }); } else redraw(settled);
    if (!built) { built = true; isReady(); }
    tell({ computing: true });
  };
  const ready = new Promise((done) => { isReady = done; });
  reindex();
  doc.on("afterTransaction", after); doc.on("update", onUpdate);
  port.addEventListener("message", onMessage); port.start?.();
  const whole = Y.encodeStateAsUpdate(doc);
  posted = 1;
  port.postMessage({ update: whole }, [whole.buffer]);

  const view = (which) => {
    const t = () => tabs.get(which()) ?? NONE, one = { which, listeners: new Set() };
    views.add(one);
    const at = (r, c) => { const s = t(), row = s.rowIds[r], col = s.colIds[c]; return row === undefined || col === undefined ? null : key(row, col); };
    const read = (r, c) => {
      const cell = at(r, c);
      if (cell === null) return null;
      if (!built || stale.has(cell)) { const input = cells.get(cell); if (input) { const typed = guess(input); if (typed !== null) return typed; } }
      return values.get(cell) ?? null;
    };
    const input = (r, c) => { const cell = at(r, c); return cell === null ? "" : cells.get(cell) ?? ""; };
    return {
      get id() { return t().id; }, get name() { const id = t().id; return id === undefined ? "" : nameOf(id); },
      size: () => ({ rows: t().rowIds.length, cols: t().colIds.length }),
      input, inputs: () => t().rowIds.map((_, r) => t().colIds.map((_, c) => input(r, c))),
      value: (r, c) => { const value = read(r, c); return Array.isArray(value) ? value[0] : value; },
      error: (r, c) => { const value = read(r, c); return Array.isArray(value) ? value[1] : null; },
      rowAt: (i) => t().rowIds[i], colAt: (i) => t().colIds[i],
      indexOfRow: (id) => t().rowIndex.get(id) ?? -1, indexOfCol: (id) => t().colIndex.get(id) ?? -1,
      onChange: (listener) => { one.listeners.add(listener); return () => one.listeners.delete(listener); },
      destroy: () => { views.delete(one); one.listeners.clear(); },
    };
  };
  return {
    ready, tabs: list, tab: (id) => view(() => id),
    find: (which) => { const text = String(which ?? "").trim(), low = text.toLowerCase(); return tabs.has(text) ? text : ids.find((id) => nameOf(id).toLowerCase() === low) ?? null; },
    tabOfRow: (id) => rowTab.get(id)?.id,
    functions: () => names,
    computing: () => !built || taken < posted,
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { doc.off("afterTransaction", after); doc.off("update", onUpdate); port.removeEventListener("message", onMessage); views.clear(); listeners.clear(); },
  };
}
