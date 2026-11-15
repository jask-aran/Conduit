import { HyperFormula } from "hyperformula";
import * as Y from "yjs";
import { CELLS, COL_LIMIT, FIRST, LOOK, MAIN, NONE, SHEET_LIMIT, TAB, TABS, colsOf, isError, key, listed, rowId, rowsOf, sent, tabName, tabNameFault } from "./sheet-format.js";
import { NAMES } from "./sheet-functions.js";

/*
 * The formula engine over a sheet's doc (sheet-format.js), kept apart from the format so a page, which computes in a worker (`serveSheetModel`,
 * read by sheet-format.js `createSheetView`), never loads the engine itself. The hub and the worker compute the same values.
 */
// Dates are not read from text: a cell typed "01/02/2024" stays that text, so the file holds what was typed.
// Nothing is undone in the engine (the doc is what is undone), so it keeps no undo stack.
// As a spreadsheet computes: date serials count its false 29 February 1900 (DATE(1900,1,1) is 1); a range in arithmetic is an array (SUM(A1:A3*B1:B3),
// and `=A1:A3` spills); `=A1` of an empty cell is 0; "a" and "á" differ, "a" and "A" do not; values show 15 significant digits (the engine's
// default of 11 made 123456789012 read 123456789010; its count is one more than the setting). Criteria match whole cells with wildcards, as the defaults do.
export const CONFIG = {
  licenseKey: "gpl-v3", dateFormats: [], timeFormats: [], maxRows: SHEET_LIMIT, maxColumns: COL_LIMIT, undoLimit: 0,
  leapYear1900: true, nullDate: { year: 1899, month: 12, day: 31 }, useArrayArithmetic: true, evaluateNullToZero: true, accentSensitive: true, precisionRounding: 14,
};
// The engine links a range to each of its cells again for every formula that reads it, though the range, once in the graph, is linked already:
// 48,500 SUMIFS over the same three columns of 10,000 rows spent most of a 90 s build there. A range already in the graph is now only linked to
// the formula. What is computed is the same: the links that are skipped exist. Written against this version's own code, so only for it.
if (HyperFormula.version === "3.5.0") {
  const graph = Object.getPrototypeOf(HyperFormula.buildEmpty({ licenseKey: "gpl-v3" }).dependencyGraph), link = graph.processCellDependencies;
  graph.processCellDependencies = function (dependencies, end) {
    const rest = dependencies.filter((one) => {
      const range = one.start && one.end && typeof one.addresses === "function" && one.isFinite() ? this.getRange(one.start, one.end) : undefined;
      if (range === undefined || !this.graph.hasNode(range)) return true;
      this.graph.addEdge(range, end.idInGraph);
      return false;
    });
    link.call(this, rest, end);
  };
}
// Past this many cells in one change a new engine is built from the doc, which is then faster than as many single sets.
const REBUILD_AT = 50_000;
const raw = (input) => input === undefined || input === "" ? null : input;
const refused = (message) => Object.assign(new Error(message), { status: 400 });

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
  const fresh = () => { let id; do id = rowId(); while (rowTab.has(id) || colTab.has(id) || tabs.has(id) || meta.has(`name:${id}`)); return id; };
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

// Values cross to the page in parts this large, each a task of its own there, so none runs past a frame's budget.
const PART = 10_000;
/**
 * The engine off the page's thread (in a Web Worker: `serveSheetModel(self)`): a copy of the doc kept from the updates `createSheetView` posts,
 * computed by createWorkbookModel, and what it computes posted back by each cell's ids (in every tab), in parts. Updates that arrive together are
 * taken as one change; an answer's last part says how many updates have been taken. The function names go first, before any engine is built.
 */
export function serveSheetModel(port) {
  const doc = new Y.Doc(), queue = [];
  let book = null, taken = 0, changed = [];
  const post = (at, value, full) => {
    for (let from = 0; ; from += PART) {
      const last = from + PART >= at.length;
      port.postMessage({ at: at.slice(from, from + PART), value: value.slice(from, from + PART), ...(full ? { full: true } : {}), ...(last ? { taken } : {}) });
      if (last) return;
    }
  };
  const all = () => {
    const at = [], value = [];
    for (const { id } of book.tabs()) {
      const tab = book.tab(id);
      book.engine.getSheetValues(tab.sheet).forEach((line, r) => line.forEach((one, c) => { if (one !== null) { at.push(key(tab.rowAt(r), tab.colAt(c))); value.push(sent(one)); } }));
    }
    post(at, value, true);
  };
  const take = () => {
    const updates = queue.splice(0);
    changed = [];
    doc.transact(() => { for (const update of updates) Y.applyUpdate(doc, update); });
    taken += updates.length;
    if (!book) {
      book = createWorkbookModel(doc);
      book.onChange(({ cells }) => { changed = cells && changed && changed.concat(cells); });
      return all();
    }
    if (!changed) return all();
    const tabs = new Map(), of = (id) => tabs.get(id) ?? tabs.set(id, book.tab(id)).get(id);
    post(changed.map(({ tab, row, col }) => key(of(tab).rowAt(row), of(tab).colAt(col))), changed.map(({ tab, row, col }) => sent(book.engine.getCellValue({ sheet: of(tab).sheet, row, col }))), false);
  };
  port.postMessage({ functions: HyperFormula.getRegisteredFunctionNames(CONFIG.language ?? "enGB") });
  port.addEventListener("message", ({ data }) => { if (queue.push(data.update) === 1) setTimeout(take, 0); });
  port.start?.();
}
