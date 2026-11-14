import { HyperFormula } from "hyperformula";
import * as Y from "yjs";
import { blockId } from "./document-format.js";
import { NAMES } from "./sheet-functions.js";

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
const FIRST = "Sheet1";
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
// Past this many cells in one change a new engine is built from the doc, which is then faster than as many single sets.
const REBUILD_AT = 50_000;
const raw = (input) => input === undefined || input === "" ? null : input;
const isError = (value) => value !== null && typeof value === "object";
/** A computed value as the file writes it. */
export const valueText = (value) => value === null || value === undefined ? "" : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : isError(value) ? value.value : String(value);
const refused = (message) => Object.assign(new Error(message), { status: 400 });
const NONE = Object.freeze({ id: undefined, rowIds: [], colIds: [], rowIndex: new Map(), colIndex: new Map(), typed: [], sheet: -1 });
/** The tabs' ids in order: a doc with no `tabs` is the one tab `main`. */
const listed = (order) => { const ids = order.toArray(); return ids.length ? ids : [MAIN]; };

/**
 * The whole workbook in one engine, a sheet of it per tab (so `Data!A1` and `'My Data'!A1` compute), and a SheetModel for each tab (`tab`).
 * `name`: what a tab never named (the one tab of a format-1 doc) is called, its file's name on the hub.
 */
export function createWorkbookModel(doc, { name: called } = {}) {
  const order = doc.getArray(TABS), meta = doc.getMap(TAB), cells = doc.getMap(CELLS), look = doc.getMap(LOOK), self = {}, listeners = new Set();
  let engine, ids = [], tabs = new Map(), bySheet = new Map(), rowTab = new Map(), colTab = new Map(), named = new Map(), names = "", watched = [], pending = null, written = null;
  const nameOf = (id) => meta.get(`name:${id}`) ?? (id === MAIN ? called ?? FIRST : id);
  const engineName = (id) => meta.get(`name:${id}`) ?? (id === MAIN ? FIRST : id);
  const blank = (n) => new Array(n).fill("");
  const reindexRows = (t) => { for (const id of t.rowIds) rowTab.delete(id); t.rowIds = t.rows.toArray(); t.rowIndex = new Map(t.rowIds.map((id, at) => [id, at])); for (const id of t.rowIds) rowTab.set(id, t); };
  const reindexCols = (t) => { for (const id of t.colIds) colTab.delete(id); t.colIds = t.cols.toArray(); t.colIndex = new Map(t.colIds.map((id, at) => [id, at])); for (const id of t.colIds) colTab.set(id, t); };
  /** A cell by its key: its tab and its place in the engine, or null for one not placed (a row or column gone, or of another tab). */
  const placeOf = (cell) => {
    const cut = cell.indexOf(":"), t = rowTab.get(cell.slice(0, cut)), col = t?.colIndex.get(cell.slice(cut + 1));
    return col === undefined ? null : { t, at: { sheet: t.sheet, row: t.rowIndex.get(cell.slice(0, cut)), col } };
  };
  const eachFormula = (each) => {
    for (const t of tabs.values()) for (let row = 0; row < t.typed.length; row++) { const line = t.typed[row]; for (let col = 0; col < line.length; col++) { const input = line[col]; if (typeof input === "string" && input.charCodeAt(0) === 61) each(t, row, col, input); } }
  };
  /** A formula that may refer to the tab: its text names it (a cheap test, and one that may say yes for nothing). */
  const naming = (id) => { const plain = named.get(id).toLowerCase(), quoted = plain.replace(/'/g, "''"); return (input) => { const text = input.toLowerCase(); return text.includes(plain) || text.includes(quoted); }; };
  // Not spliced in as arguments: a call takes only so many, and a sheet's rows are more.
  const moveRows = (t, at, n, removing) => { t.typed = removing ? t.typed.slice(0, at).concat(t.typed.slice(at + n)) : t.typed.slice(0, at).concat(Array.from({ length: n }, () => blank(t.colIds.length)), t.typed.slice(at)); };
  const moveCols = (t, at, n, removing) => { t.typed = t.typed.map((row) => removing ? row.slice(0, at).concat(row.slice(at + n)) : row.slice(0, at).concat(blank(n), row.slice(at))); };
  const note = () => pending ??= { rows: new Map(), cols: new Map(), keys: new Set(), tabs: false };
  const rebuild = () => {
    for (const off of watched) off();
    ids = listed(order); named = new Map(); rowTab.clear(); colTab.clear();
    // Two names the same but for case (only a doc written outside the hub has them) would stop the engine: the second is told apart.
    const taken = new Set();
    for (const id of ids) { let one = engineName(id); if (taken.has(one.toLowerCase())) one = `${one}~${id}`; taken.add(one.toLowerCase()); named.set(id, one); }
    names = ids.map(engineName).join("\n");
    tabs = new Map(ids.map((id) => [id, { id, rows: doc.getArray(rowsOf(id)), cols: doc.getArray(colsOf(id)), rowIds: [], colIds: [], rowIndex: new Map(), colIndex: new Map(), typed: [], sheet: -1 }]));
    const grids = {};
    for (const t of tabs.values()) {
      reindexRows(t); reindexCols(t);
      t.typed = Array.from({ length: t.rowIds.length }, () => blank(t.colIds.length));
      grids[named.get(t.id)] = Array.from({ length: t.rowIds.length }, () => new Array(t.colIds.length).fill(null));
    }
    for (const [cell, input] of cells) { const place = placeOf(cell); if (place) { place.t.typed[place.at.row][place.at.col] = input ?? ""; grids[named.get(place.t.id)][place.at.row][place.at.col] = raw(input); } }
    engine?.destroy();
    engine = HyperFormula.buildFromSheets(grids, CONFIG, NAMES);
    bySheet = new Map();
    for (const t of tabs.values()) { t.sheet = engine.getSheetId(named.get(t.id)); bySheet.set(t.sheet, t); }
    watched = [...tabs.values()].flatMap((t) => {
      const onRows = (event) => { note().rows.set(t.id, event.changes.delta); }, onCols = (event) => { note().cols.set(t.id, event.changes.delta); };
      t.rows.observe(onRows); t.cols.observe(onCols);
      return [() => t.rows.unobserve(onRows), () => t.cols.unobserve(onCols)];
    });
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
  const emit = (change) => { for (const listener of listeners) listener(change); };
  const onCells = (event) => { const keys = note().keys; for (const cell of event.keysChanged) keys.add(cell); };
  const onTabs = () => { note().tabs = true; };
  /** Each change to the doc reaches the engine once, as one batch, after the change is whole. */
  const flush = (transaction) => {
    const now = pending;
    pending = null;
    if (!now) return;
    if (now.tabs) {
      const next = listed(order);
      // A tab added, deleted or renamed builds the engine again from the doc, which then says every name and every formula: tabs change seldom.
      if (next.length !== ids.length || next.some((id) => !tabs.has(id)) || next.map(engineName).join("\n") !== names) { written = null; rebuild(); return emit({ tabs: true, structure: [...ids], cells: null }); }
      ids = next;
    }
    const moved = [...new Set([...now.rows.keys(), ...now.cols.keys()])].filter((id) => tabs.has(id)), structure = moved.length > 0;
    let changed = null;
    const retype = (done) => {
      const places = [];
      for (const cell of now.keys) { if (done?.has(cell)) continue; const place = placeOf(cell); if (place) { const input = cells.get(cell); place.t.typed[place.at.row][place.at.col] = input ?? ""; places.push([place.at, raw(input)]); } }
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
        for (const [id, delta] of now.rows) { const t = tabs.get(id); if (t) along(delta, (at, n) => { engine.addRows(t.sheet, [at, n]); moveRows(t, at, n, false); }, (at, n) => { engine.removeRows(t.sheet, [at, n]); moveRows(t, at, n, true); }); }
        for (const [id, delta] of now.cols) { const t = tabs.get(id); if (t) along(delta, (at, n) => { engine.addColumns(t.sheet, [at, n]); moveCols(t, at, n, false); }, (at, n) => { engine.removeColumns(t.sheet, [at, n]); moveCols(t, at, n, true); }); }
        for (const id of now.rows.keys()) if (tabs.has(id)) reindexRows(tabs.get(id));
        for (const id of now.cols.keys()) if (tabs.has(id)) reindexCols(tabs.get(id));
        // After a structure change every formula is as the doc says: one the engine already rewrote in the same way is left as it is, and one typed
        // here while the hub made the change, which the engine rewrote but the hub never saw, goes back to what the doc holds. Any tab's formula
        // may refer to the moved cells.
        for (const [place, input] of retype()) if (!(structure && input?.startsWith("="))) engine.setCellContents(place, input);
        if (structure) eachFormula((t, row, col, input) => { const place = { sheet: t.sheet, row, col }; if (engine.getCellFormula(place) !== input) engine.setCellContents(place, input); });
      } finally { changed = engine.resumeEvaluation().flatMap((change) => change.address && bySheet.has(change.address.sheet) ? [{ tab: bySheet.get(change.address.sheet).id, row: change.address.row, col: change.address.col }] : []); }
    }
    emit({ tabs: now.tabs, structure: moved, cells: changed });
  };
  order.observe(onTabs); meta.observe(onTabs); cells.observe(onCells);
  doc.on("afterTransaction", flush);
  rebuild();
  /** An id no row, column or tab has. */
  const fresh = () => { let id; do id = blockId(); while (rowTab.has(id) || colTab.has(id) || tabs.has(id) || meta.has(`name:${id}`)); return id; };
  const find = (which) => {
    const text = String(which ?? "").trim(), low = text.toLowerCase();
    return tabs.has(text) ? text : ids.find((id) => nameOf(id).toLowerCase() === low || named.get(id).toLowerCase() === low) ?? null;
  };
  const hidden = (id) => meta.get(`hidden:${id}`) === true;
  const list = () => ids.map((id) => ({ id, name: nameOf(id), hidden: hidden(id) }));
  const structure = (id, op, at, count, write = () => {}) => {
    const t = tabs.get(id) ?? (() => { throw refused(`No tab ${id}`); })();
    const isRows = op === "insert-rows" || op === "delete-rows", removing = op.startsWith("delete"), before = isRows ? t.rowIds : t.colIds, line = isRows ? t.rows : t.cols, names = naming(id);
    // Each formula that may refer to the tab by its row and column ids, with the engine's text of it before the change.
    const formulas = [];
    eachFormula((u, row, col, input) => { if (u === t || names(input)) formulas.push([u, u.rowIds[row], u.colIds[col], engine.getCellFormula({ sheet: u.sheet, row, col })]); });
    const gone = new Set(removing ? before.slice(at, at + count) : []), across = isRows ? t.colIds : t.rowIds;
    if (isRows) (removing ? engine.removeRows : engine.addRows).call(engine, t.sheet, [at, count]);
    else (removing ? engine.removeColumns : engine.addColumns).call(engine, t.sheet, [at, count]);
    doc.transact(() => {
      if (removing) line.delete(at, count); else line.insert(at, Array.from({ length: count }, fresh));
      if (isRows) { reindexRows(t); moveRows(t, at, count, removing); } else { reindexCols(t); moveCols(t, at, count, removing); }
      // The cells of what was deleted, found by their ids (a cell whose other id is gone too was never placed, and is left).
      for (const one of gone) for (const other of across) { const cell = isRows ? key(one, other) : key(other, one); if (cells.has(cell)) cells.delete(cell); }
      written = new Set();
      for (const [u, row, col, was] of formulas) {
        if (u === t && gone.has(isRows ? row : col)) continue;
        const place = { sheet: u.sheet, row: u.rowIndex.get(row), col: u.colIndex.get(col) }, after = engine.getCellFormula(place);
        if (after && after !== was) { const cell = key(row, col); cells.set(cell, after); u.typed[place.row][place.col] = after; written.add(cell); }
      }
      write();
    }, self);
    return { rows: t.rowIds.length, cols: t.colIds.length };
  };
  /** The tab takes the name in the engine, which rewrites each formula naming it, and the doc is written so (the change that writes it then builds the engine again). */
  const rename = (id, to) => {
    const names = naming(id), formulas = [];
    eachFormula((u, row, col, input) => { if (names(input)) formulas.push([u, row, col, engine.getCellFormula({ sheet: u.sheet, row, col })]); });
    engine.renameSheet(tabs.get(id).sheet, to);
    meta.set(`name:${id}`, to);
    for (const [u, row, col, was] of formulas) { const after = engine.getCellFormula({ sheet: u.sheet, row, col }); if (after && after !== was) cells.set(key(u.rowIds[row], u.colIds[col]), after); }
  };
  const free = (name, but) => {
    const fault = tabNameFault(name);
    if (fault) throw refused(fault);
    if (ids.some((id) => id !== but && nameOf(id).toLowerCase() === name.toLowerCase())) throw refused(`There is a tab named ${name} already`);
  };
  const tabOp = (op, args = {}, write = () => {}) => {
    const one = op === "add" ? null : find(args.tab) ?? (() => { throw refused(`No tab ${args.tab ?? ""}: the tabs are ${ids.map(nameOf).join(", ")}`); })();
    let made = one;
    doc.transact(() => {
      if (op === "add") {
        const name = typeof args.name === "string" ? args.name.trim() : "", rows = args.rows ?? 20, cols = args.cols ?? 8;
        free(name);
        const at = args.at ?? ids.length;
        if (!Number.isInteger(at) || at < 0 || at > ids.length) throw refused(`at is where the tab goes among the ${ids.length}, from 0 to ${ids.length}`);
        // The second tab writes the first: its name, its file's until now, so the first tab's file is named for it.
        if (!order.length) { order.insert(0, [MAIN]); if (!meta.has(`name:${MAIN}`)) rename(MAIN, tabName(called)); }
        made = fresh();
        order.insert(at, [made]);
        meta.set(`name:${made}`, name);
        doc.getArray(rowsOf(made)).insert(0, Array.from({ length: rows }, fresh));
        doc.getArray(colsOf(made)).insert(0, Array.from({ length: cols }, fresh));
      } else if (op === "rename") {
        const name = typeof args.name === "string" ? args.name.trim() : "";
        free(name, one);
        if (meta.get(`name:${one}`) !== name) rename(one, name);
      } else if (op === "delete") {
        if (ids.length < 2) throw refused("A workbook keeps at least one tab");
        if (!ids.some((id) => id !== one && !hidden(id))) throw refused("A workbook keeps at least one tab shown");
        const t = tabs.get(one);
        for (const cell of [...cells.keys()].filter((cell) => t.rowIndex.has(cell.slice(0, cell.indexOf(":"))))) cells.delete(cell);
        for (const name of [...look.keys()].filter((name) => name.split(":").slice(1).some((part) => part === one || t.rowIndex.has(part) || t.colIndex.has(part)))) look.delete(name);
        t.rows.delete(0, t.rows.length); t.cols.delete(0, t.cols.length);
        order.delete(order.toArray().indexOf(one), 1);
        meta.delete(`name:${one}`); meta.delete(`hidden:${one}`);
      } else if (op === "move") {
        const at = args.at;
        if (!Number.isInteger(at) || at < 0 || at >= ids.length) throw refused(`at is the tab's new place, from 0 to ${ids.length - 1}`);
        if (order.length) { order.delete(order.toArray().indexOf(one), 1); order.insert(at, [one]); }
      } else if (op === "hide") {
        if (args.hidden !== false && !ids.some((id) => id !== one && !hidden(id))) throw refused("A workbook keeps at least one tab shown");
        if (args.hidden === false) meta.delete(`hidden:${one}`); else meta.set(`hidden:${one}`, true);
      } else throw refused("A tab's op is add, rename, delete, move or hide");
      write();
    });
    return { tab: made, tabs: list() };
  };

  /** One tab's SheetModel, whichever tab `which()` names now. */
  const view = (which, end) => {
    const t = () => tabs.get(which()) ?? NONE, mine = new Set();
    const read = (r, c) => { const s = t(); return s.sheet < 0 || s.rowIds[r] === undefined || s.colIds[c] === undefined ? null : engine.getCellValue({ sheet: s.sheet, row: r, col: c }); };
    return {
      get id() { return t().id; }, get name() { const id = t().id; return id === undefined ? "" : nameOf(id); },
      get engine() { return engine; }, get sheet() { return t().sheet; },
      size: () => ({ rows: t().rowIds.length, cols: t().colIds.length }),
      input: (r, c) => t().typed[r]?.[c] ?? "",
      inputs: () => t().typed.map((line) => line.slice()),
      value: (r, c) => { const value = read(r, c); return isError(value) ? value.value : value; },
      error: (r, c) => { const value = read(r, c); return isError(value) ? value.message || value.value : null; },
      rowAt: (i) => t().rowIds[i], colAt: (i) => t().colIds[i],
      indexOfRow: (id) => t().rowIndex.get(id) ?? -1, indexOfCol: (id) => t().colIndex.get(id) ?? -1,
      onChange(listener) {
        const one = (change) => {
          const id = which(), moved = change.structure.includes(id);
          if (change.cells === null) return listener({ structure: moved, cells: null });
          const here = change.cells.flatMap((cell) => cell.tab === id ? [{ row: cell.row, col: cell.col }] : []);
          if (moved || here.length) listener({ structure: moved, cells: here });
        };
        listeners.add(one); mine.add(one);
        return () => { listeners.delete(one); mine.delete(one); };
      },
      structure: (op, at, count, write) => structure(which(), op, at, count, write),
      destroy: end ?? (() => { for (const one of mine) listeners.delete(one); mine.clear(); }),
    };
  };
  const book = {
    get engine() { return engine; },
    tabs: list,
    tab: (id) => view(() => id),
    first: () => view(() => ids[0]),
    find,
    tabOfRow: (id) => rowTab.get(id)?.id, tabOfCol: (id) => colTab.get(id)?.id,
    cellCount: () => [...tabs.values()].reduce((sum, t) => sum + t.rowIds.length * t.colIds.length, 0),
    onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); },
    structure, tabOp,
    destroy() { for (const off of watched) off(); order.unobserve(onTabs); meta.unobserve(onTabs); cells.unobserve(onCells); doc.off("afterTransaction", flush); listeners.clear(); engine.destroy(); },
  };
  return book;
}

/** The first tab's SheetModel, computed with the whole workbook (a formula there may read another tab); destroying it ends the workbook. */
export function createSheetModel(doc) {
  const book = createWorkbookModel(doc), first = book.first();
  return Object.defineProperties(first, { destroy: { value: book.destroy } });
}

/** A value as it crosses to the page: an error as [code, message], anything else as it is. */
const sent = (value) => isError(value) ? [value.value, value.message || value.value] : value;
/**
 * The engine off the page's thread (in a Web Worker: `serveSheetModel(self)`): a copy of the doc kept from the updates `createSheetView` sends,
 * computed by createWorkbookModel, and what it computes sent back, each cell by its ids (in every tab). Updates that arrive together are taken as one change.
 */
export function serveSheetModel(port) {
  const doc = new Y.Doc(), queue = [];
  let book = null, closed = false;
  const all = () => {
    const at = [], value = [];
    for (const { id } of book.tabs()) {
      const tab = book.tab(id);
      book.engine.getSheetValues(tab.sheet).forEach((line, r) => line.forEach((one, c) => { if (one !== null) { at.push(key(tab.rowAt(r), tab.colAt(c))); value.push(sent(one)); } }));
    }
    return { at, value };
  };
  const take = () => {
    if (closed || !queue.length) return;
    const updates = queue.splice(0);
    doc.transact(() => { for (const update of updates) Y.applyUpdate(doc, update); });
    if (book) return;
    book = createWorkbookModel(doc);
    book.onChange(({ cells }) => {
      if (!cells) return port.postMessage({ all: true, ...all() });
      const tabs = new Map(), of = (id) => tabs.get(id) ?? tabs.set(id, book.tab(id)).get(id);
      port.postMessage({ at: cells.map(({ tab, row, col }) => key(of(tab).rowAt(row), of(tab).colAt(col))), value: cells.map(({ tab, row, col }) => sent(book.engine.getCellValue({ sheet: of(tab).sheet, row, col }))) });
    });
    port.postMessage({ all: true, ...all() });
  };
  port.addEventListener("message", ({ data }) => {
    if (data.close) { closed = true; book?.destroy(); doc.destroy(); return; }
    if (queue.push(data.update) === 1) setTimeout(take, 0);
  });
  port.start?.();
}

/**
 * The page's sheet when its engine is in a worker (`serveSheetModel`), read as a SheetModel is: what was typed, the tabs, rows and columns are the
 * page's own doc; values are what the worker last sent, kept by each cell's ids, so rows or columns inserted or deleted move them at once and
 * only values that changed wait for the worker. It is the first tab; `tab(id)` is another. `onChange`: `structure` at once when tabs, rows or
 * columns change, `cells` when values arrive.
 */
export function createSheetView(doc, port) {
  const order = doc.getArray(TABS), meta = doc.getMap(TAB), cells = doc.getMap(CELLS), views = new Set(), values = new Map();
  let ids = [], tabs = new Map(), rowTab = new Map(), watched = new Set(), isReady;
  const reindex = () => {
    ids = listed(order); tabs = new Map(); rowTab = new Map(); watched = new Set([order, meta]);
    for (const id of ids) {
      const rows = doc.getArray(rowsOf(id)), cols = doc.getArray(colsOf(id)), t = { id, rowIds: rows.toArray(), colIds: cols.toArray() };
      t.rowIndex = new Map(t.rowIds.map((one, at) => [one, at])); t.colIndex = new Map(t.colIds.map((one, at) => [one, at]));
      tabs.set(id, t); watched.add(rows); watched.add(cols);
      for (const row of t.rowIds) rowTab.set(row, t);
    }
  };
  const emit = (change, only) => { for (const one of views) if (!only || one.which() === only) for (const listener of one.listeners) listener(change); };
  const after = (transaction) => { for (const type of transaction.changed.keys()) if (watched.has(type)) { reindex(); return emit({ structure: true, cells: null }); } };
  const onUpdate = (update) => port.postMessage({ update });
  const onMessage = ({ data }) => {
    if (data.all) values.clear();
    const changed = new Map();
    data.at.forEach((cell, i) => {
      const value = data.value[i];
      if (value === null) values.delete(cell); else values.set(cell, value);
      if (data.all) return;
      const cut = cell.indexOf(":"), t = rowTab.get(cell.slice(0, cut)), col = t?.colIndex.get(cell.slice(cut + 1));
      if (col !== undefined) (changed.get(t.id) ?? changed.set(t.id, []).get(t.id)).push({ row: t.rowIndex.get(cell.slice(0, cut)), col });
    });
    if (data.all) emit({ structure: false, cells: null });
    else for (const [id, list] of changed) emit({ structure: false, cells: list }, id);
    if (data.all) isReady();
  };
  const ready = new Promise((done) => { isReady = done; });
  doc.on("afterTransaction", after); doc.on("update", onUpdate);
  port.addEventListener("message", onMessage); port.start?.();
  reindex();
  port.postMessage({ update: Y.encodeStateAsUpdate(doc) });
  const view = (which, end) => {
    const t = () => tabs.get(which()) ?? NONE, one = { which, listeners: new Set() };
    views.add(one);
    const read = (r, c) => { const s = t(); return s.rowIds[r] === undefined || s.colIds[c] === undefined ? null : values.get(key(s.rowIds[r], s.colIds[c])) ?? null; };
    const input = (r, c) => { const s = t(); return s.rowIds[r] === undefined || s.colIds[c] === undefined ? "" : cells.get(key(s.rowIds[r], s.colIds[c])) ?? ""; };
    return {
      ready,
      get id() { return t().id; },
      size: () => ({ rows: t().rowIds.length, cols: t().colIds.length }),
      input, inputs: () => t().rowIds.map((_, r) => t().colIds.map((_, c) => input(r, c))),
      value: (r, c) => { const value = read(r, c); return Array.isArray(value) ? value[0] : value; },
      error: (r, c) => { const value = read(r, c); return Array.isArray(value) ? value[1] : null; },
      rowAt: (i) => t().rowIds[i], colAt: (i) => t().colIds[i],
      indexOfRow: (id) => t().rowIndex.get(id) ?? -1, indexOfCol: (id) => t().colIndex.get(id) ?? -1,
      onChange: (listener) => { one.listeners.add(listener); return () => one.listeners.delete(listener); },
      destroy: end ?? (() => { views.delete(one); one.listeners.clear(); }),
    };
  };
  const first = view(() => ids[0], () => { doc.off("afterTransaction", after); doc.off("update", onUpdate); port.removeEventListener("message", onMessage); views.clear(); port.postMessage({ close: true }); });
  return Object.assign(first, {
    tabs: () => ids.map((id) => ({ id, name: meta.get(`name:${id}`) ?? (id === MAIN ? FIRST : id), hidden: meta.get(`hidden:${id}`) === true })),
    tab: (id) => view(() => id),
  });
}
