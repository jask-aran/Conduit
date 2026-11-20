import { HyperFormula } from "hyperformula";
import * as Y from "yjs";
import { CELLS, COL_LIMIT, FIRST, LOOK, MAIN, NONE, SHEET_LIMIT, TAB, TABS, colsOf, isError, key, listed, rowId, rowsOf, sent, tabName, tabNameFault, tabRef } from "./sheet-format.js";
import { NAMES } from "./sheet-functions.js";
import { alignA1, renameColumn, renameTable, toA1 } from "./sheet-structured.js";
import { readTables } from "./sheet-tables.js";

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
/** The engine's functions whose result is a date, or a date and time, as its own metadata says, with the format each result takes (sheet-formats.js formulaDate). */
export const dateFunctions = () => Object.fromEntries(HyperFormula.getRegisteredFunctionNames(CONFIG.language ?? "enGB").flatMap((name) => {
  const kind = HyperFormula.getFunctionPlugin(name)?.implementedFunctions?.[name]?.returnNumberType;
  return kind === "NUMBER_DATE" ? [[name, "d/m/yyyy"]] : kind === "NUMBER_DATETIME" ? [[name, "d/m/yyyy h:mm"]] : [];
}));
// Past this many cells in one change a new engine is built from the doc, which is then faster than as many single sets.
const REBUILD_AT = 50_000;
const raw = (input) => input === undefined || input === "" ? null : input;
const refused = (message) => Object.assign(new Error(message), { status: 400 });

/**
 * The whole workbook in one engine, a sheet of it per tab (so `Data!A1` and `'My Data'!A1` compute), and a SheetModel for each tab (`tab`).
 * `name`: what a tab never named (the one tab of a format-1 doc) is called, its file's name on the hub.
 */
/**
 * A workbook's defined names (an imported .xlsx's, `names:<tabId>` in the look: `{ name, ref, tab? }`, `tab` the one a name is local to) as the engine's
 * named expressions, so the formulas reading them compute; Excel's own (`_xlnm.Print_Area`…) and any the engine cannot take are left to the file.
 */
export const defineNames = (engine, list) => {
  for (const one of list) {
    const scope = one.tab === undefined ? undefined : engine.getSheetId(String(one.tab)), expression = `=${one.ref}`;
    if (typeof one.name === "string" && !one.name.startsWith("_xlnm.") && (one.tab === undefined || scope !== undefined) && engine.isItPossibleToAddNamedExpression(one.name, expression, scope)) engine.addNamedExpression(one.name, expression, scope);
  }
};
const listOf = (value) => { try { const list = typeof value === "string" ? JSON.parse(value) : value; return Array.isArray(list) ? list.filter((one) => one && typeof one.ref === "string") : []; } catch { return []; } };

export function createWorkbookModel(doc, { name: called, owner = false } = {}) {
  const order = doc.getArray(TABS), meta = doc.getMap(TAB), cells = doc.getMap(CELLS), look = doc.getMap(LOOK), self = {}, listeners = new Set();
  let engine, ids = [], tabs = new Map(), bySheet = new Map(), rowTab = new Map(), colTab = new Map(), named = new Map(), names = "", watched = [], pending = null, written = null;
  // Structured references (sheet-structured.js): the tables as they read them, the A1 each such cell gave the engine, and which cells read which table.
  let infos = new Map(), given = new Map(), uses = new Map(), refers = new Map(), heads = new Set(), fixes = [];
  const fixing = {};
  const defined = () => listed(order).flatMap((id) => listOf(look.get(`names:${id}`)));
  const nameOf = (id) => meta.get(`name:${id}`) ?? (id === MAIN ? called ?? FIRST : id);
  const engineName = (id) => meta.get(`name:${id}`) ?? (id === MAIN ? FIRST : id);
  const blank = (n) => new Array(n).fill("");
  const reindexRows = (t, keep) => { for (const id of t.rowIds) rowTab.delete(id); t.rowIds = t.rows.toArray(); t.rowIndex = new Map([...t.rowIds.map((id, at) => [id, at]), ...(keep ?? [])]); for (const id of t.rowIds) rowTab.set(id, t); };
  const reindexCols = (t, keep) => { for (const id of t.colIds) colTab.delete(id); t.colIds = t.cols.toArray(); t.colIndex = new Map([...t.colIds.map((id, at) => [id, at]), ...(keep ?? [])]); for (const id of t.colIds) colTab.set(id, t); };
  /** A cell by its key: its tab and its place in the engine, or null for one not placed (a row or column gone, or of another tab). */
  const placeOf = (cell) => {
    const cut = cell.indexOf(":"), t = rowTab.get(cell.slice(0, cut)), col = t?.colIndex.get(cell.slice(cut + 1));
    return col === undefined ? null : { t, at: { sheet: t.sheet, row: t.rowIndex.get(cell.slice(0, cut)), col } };
  };
  const eachFormula = (each) => {
    for (const t of tabs.values()) for (let row = 0; row < t.typed.length; row++) { const line = t.typed[row]; for (let col = 0; col < line.length; col++) { const input = line[col]; if (typeof input === "string" && input.charCodeAt(0) === 61) each(t, row, col, input); } }
  };
  /** The workbook's tables as references read them (sheet-structured.d.ts TableInfo), `id` and `cols` (column ids) to tell a rename from a move. */
  const tableInfos = () => {
    const out = new Map();
    for (const t of tabs.values()) for (const table of readTables(look, t.id)) {
      const from = placeOf(table.from), to = placeOf(table.to);
      if (from?.t !== t || to?.t !== t || out.has(table.name.toLowerCase())) continue;
      const { row: top, col: left } = from.at, { row: bottom, col: right } = to.at, header = table.header === false ? -1 : top, total = table.total ? bottom : -1;
      const columns = Array.from({ length: right - left + 1 }, (_, n) => (header < 0 ? "" : String(t.typed[header]?.[left + n] ?? "")) || `Column${n + 1}`);
      out.set(table.name.toLowerCase(), { id: table.id, name: table.name, tab: t.id, sheet: tabRef(named.get(t.id)), header, first: header < 0 ? top : top + 1, last: total < 0 ? bottom : bottom - 1, total, left, right, columns, cols: t.colIds.slice(left, right + 1), head: t.rowIds[top] });
    }
    return out;
  };
  const forget = (cell) => { for (const name of uses.get(cell) ?? []) refers.get(name)?.delete(cell); uses.delete(cell); given.delete(cell); };
  const mentions = (input) => { const low = input.toLowerCase(); for (const name of infos.keys()) if (low.includes(name)) return true; return false; };
  /** What the engine is given for a cell's input: a formula's structured references as A1, the cell noted as reading their tables. */
  const toEngine = (t, row, col, input) => {
    const cell = key(t.rowIds[row], t.colIds[col]);
    if (uses.has(cell)) forget(cell);
    if (typeof input !== "string" || input.charCodeAt(0) !== 61 || !(input.includes("[") || (infos.size && mentions(input)))) return raw(input);
    const done = toA1(input, infos, { tab: t.id, row, col });
    if (!done) return raw(input);
    for (const name of done.names) (refers.get(name) ?? refers.set(name, new Set()).get(name)).add(cell);
    uses.set(cell, done.names); given.set(cell, done.a1);
    // The hub writes the tables' and columns' names in their own casing.
    if (owner && done.stored !== input) fixes.push([cell, input, done.stored]);
    return done.a1;
  };
  /** The formula the engine holds for a cell as the doc would hold it: a structured one's A1 references the engine moved, written into its text. */
  const asStored = (cell, input, rewritten) => given.has(cell) ? (rewritten === given.get(cell) ? input : alignA1(input, rewritten, infos)) : rewritten;
  /**
   * The tables read again (after their look, a header cell or the lines under them changed): each cell reading one that changed is given its A1 again,
   * and the hub rewrites a renamed table's or column's references. The cells the engine changed, or null when it was not asked.
   */
  const retable = () => {
    const next = tableInfos(), changed = new Set(), byId = new Map([...infos.values()].map((one) => [one.id, one]));
    const same = (one, two) => one && two && one.name === two.name && one.tab === two.tab && one.sheet === two.sheet && one.header === two.header && one.first === two.first && one.last === two.last && one.total === two.total && one.left === two.left && one.right === two.right && one.columns.join("\n") === two.columns.join("\n");
    for (const name of new Set([...infos.keys(), ...next.keys()])) if (!same(infos.get(name), next.get(name))) changed.add(name);
    if (!changed.size) return null;
    changed.add("");
    const renames = [];
    if (owner) for (const one of next.values()) {
      const was = byId.get(one.id);
      if (!was) continue;
      if (was.name !== one.name) for (const cell of refers.get(was.name.toLowerCase()) ?? []) renames.push([cell, (text) => renameTable(text, was.name, one.name)]);
      one.cols.forEach((col, n) => { const at = was.cols.indexOf(col); if (at >= 0 && was.columns[at] !== one.columns[n] && was.columns[at].toLowerCase() !== one.columns[n].toLowerCase()) for (const cell of refers.get(was.name.toLowerCase()) ?? []) renames.push([cell, (text, place) => renameColumn(text, next, place, one, was.columns[at], one.columns[n])]); });
    }
    infos = next; heads = new Set([...next.values()].map((one) => one.head));
    for (const [cell, edit] of renames) {
      const place = placeOf(cell), input = place && place.t.typed[place.at.row][place.at.col];
      if (input) { const after = edit(input, { tab: place.t.id, row: place.at.row, col: place.at.col }); if (after !== input) fixes.push([cell, input, after]); }
    }
    engine.suspendEvaluation();
    try {
      for (const name of changed) for (const cell of [...refers.get(name) ?? []]) {
        const place = placeOf(cell);
        if (!place) { forget(cell); continue; }
        const was = given.get(cell), now = toEngine(place.t, place.at.row, place.at.col, place.t.typed[place.at.row][place.at.col]);
        if (now !== was) engine.setCellContents(place.at, now);
      }
    } finally { return engine.resumeEvaluation(); }
  };
  /** The hub's rewrites of structured references (names in their own casing, renamed tables and columns), written once the change is whole. */
  const writeFixes = () => {
    if (!fixes.length) return;
    const now = fixes; fixes = [];
    queueMicrotask(() => doc.transact(() => { for (const [cell, was, after] of now) if (cells.get(cell) === was) cells.set(cell, after); }, fixing));
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
    names = [...ids.map(engineName), JSON.stringify(defined())].join("\n");
    tabs = new Map(ids.map((id) => [id, { id, rows: doc.getArray(rowsOf(id)), cols: doc.getArray(colsOf(id)), rowIds: [], colIds: [], rowIndex: new Map(), colIndex: new Map(), typed: [], sheet: -1 }]));
    const grids = {};
    for (const t of tabs.values()) {
      reindexRows(t); reindexCols(t);
      t.typed = Array.from({ length: t.rowIds.length }, () => blank(t.colIds.length));
      grids[named.get(t.id)] = Array.from({ length: t.rowIds.length }, () => new Array(t.colIds.length).fill(null));
    }
    for (const [cell, input] of cells) { const place = placeOf(cell); if (place) place.t.typed[place.at.row][place.at.col] = input ?? ""; }
    infos = tableInfos(); heads = new Set([...infos.values()].map((one) => one.head)); given = new Map(); uses = new Map(); refers = new Map();
    for (const t of tabs.values()) t.typed.forEach((line, row) => line.forEach((input, col) => { if (input !== "") grids[named.get(t.id)][row][col] = toEngine(t, row, col, input); }));
    engine?.destroy();
    engine = HyperFormula.buildFromSheets(grids, CONFIG, NAMES);
    defineNames(engine, defined());
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
  const resize = (t, isRows, at, n, removing) => { (isRows ? removing ? engine.removeRows : engine.addRows : removing ? engine.removeColumns : engine.addColumns).call(engine, t.sheet, [at, n]); (isRows ? moveRows : moveCols)(t, at, n, removing); };
  // A delta putting back ids the line still has (a move, its undo or redo) as the engine's moves, so cells and the formulas reading them go with their ids
  // (undefined: inserts and deletes alone, `along`). An undo of a move after another's move of the line stands it where the later move put it; the
  // undo's place holds an empty line until the hub takes it out (`unrepeat`). The answer: where each id standing twice is kept (reindexRows's `keep`; unsaid, its last place).
  const relay = (t, isRows, delta) => {
    const before = isRows ? t.rowIds : t.colIds, index = isRows ? t.rowIndex : t.colIndex, after = (isRows ? t.rows : t.cols).toArray();
    if (before.length === index.size && new Set(after).size === after.length && !delta.some((step) => step.insert?.some((id) => index.has(id)))) return undefined;
    // Where the delta keeps each line that holds its id's cells (a delta leaves out the lines kept at its end).
    const stays = new Map(), stay = (n) => { for (; n > 0 && from < before.length; n--, from++, to++) if (index.get(before[from]) === from) stays.set(before[from], to); };
    let from = 0, to = 0;
    for (const step of delta) { if (step.retain) stay(step.retain); else if (step.insert) to += step.insert.length; else if (step.delete) from += step.delete; }
    stay(Infinity);
    const keep = new Map(), seen = new Set();
    for (const id of after) if (seen.has(id)) keep.set(id, after[stays.get(id)] === id ? stays.get(id) : after.indexOf(id)); else seen.add(id);
    const want = after.map((id, at) => (keep.get(id) ?? at) === at ? id : null), wantAt = new Map(want.map((id, at) => [id, at])), current = before.slice();
    const holds = (at) => index.get(current[at]) === at && wantAt.has(current[at]);
    // `n` lines from `at` to stand from `into`.
    const shift = (at, n, into) => { const move = (list) => list.splice(into, 0, ...list.splice(at, n)); (isRows ? engine.moveRows : engine.moveColumns).call(engine, t.sheet, at, n, into < at ? into : into + n); if (isRows) move(t.typed); else t.typed.forEach(move); move(current); };
    // Out first what has gone and the lines that held no cells, then each line brought to its place, a run of them at once.
    for (let at = current.length - 1, n; at >= 0; at -= n) { for (n = 0; at - n >= 0 && !holds(at - n); n++); if (n) { resize(t, isRows, at - n + 1, n, true); current.splice(at - n + 1, n); } else n = 1; }
    const held = new Set(current);
    for (let at = 0, n = 1; at < want.length; at += n, n = 1) {
      const id = want[at];
      if (id !== null && current[at] === id) continue;
      if (!held.has(id)) { while (at + n < want.length && !held.has(want[at + n])) n++; resize(t, isRows, at, n, false); current.splice(at, 0, ...new Array(n).fill(null)); continue; }
      // The shorter of the run that belongs here, brought up, and the run standing here, sent down to its place past the first (each step brings it nearer).
      const was = current.indexOf(id, at), goes = wantAt.get(current[at]) ?? -1; let m = 1;
      while (was + n < current.length && want[at + n] !== null && current[was + n] === want[at + n]) n++;
      while (goes >= 0 && current[at + m] !== null && current[at + m] !== undefined && current[at + m] === want[goes + m]) m++;
      if (m < n && goes > was - m && goes + m <= current.length) { shift(at, m, goes); n = 0; } else shift(was, n, at);
    }
    return keep;
  };
  // The places `relay` left empty for an id standing twice, taken out by the hub so the doc says each line once.
  const unrepeat = () => doc.transact(() => {
    for (const t of tabs.values()) for (const [line, ids, index] of [[t.rows, t.rowIds, t.rowIndex], [t.cols, t.colIds, t.colIndex]]) for (let at = ids.length - 1; at >= 0; at--) if (index.get(ids[at]) !== at) line.delete(at, 1);
  });
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
      if (next.length !== ids.length || next.some((id) => !tabs.has(id)) || [...next.map(engineName), JSON.stringify(defined())].join("\n") !== names) { written = null; rebuild(); return emit({ tabs: true, structure: [...ids], cells: null }); }
      ids = next;
    }
    const moved = [...new Set([...now.rows.keys(), ...now.cols.keys()])].filter((id) => tabs.has(id)), structure = moved.length > 0;
    let changed = null, relaid = false, twice = false, failed = false;
    const kept = [];
    const retype = (done) => {
      const places = [];
      for (const cell of now.keys) { if (done?.has(cell)) continue; const place = placeOf(cell); if (place) { const input = cells.get(cell); place.t.typed[place.at.row][place.at.col] = input ?? ""; places.push([place.at, toEngine(place.t, place.at.row, place.at.col, input)]); } else forget(cell); }
      return places;
    };
    // The hub's own structure change was made in the engine and in `typed` first: only what `write` changed is left (and its own rewrites).
    if (transaction.origin === self) { retype(written); written = null; }
    // A structure change rewrites many formulas, which the engine rewrites too: that is no reason to build it again.
    else if (!structure && now.keys.size > REBUILD_AT) rebuild();
    else {
      // Suspended rather than batched: a batch keeps what it changed for an undo, many times slower for many cells.
      engine.suspendEvaluation();
      try {
        const keeps = new Map();
        for (const [isRows, changes] of [[true, now.rows], [false, now.cols]]) for (const [id, delta] of changes) { const t = tabs.get(id), keep = t && relay(t, isRows, delta); if (keep) { relaid = true; keeps.set(`${isRows}:${id}`, keep); } else if (t) along(delta, (at, n) => resize(t, isRows, at, n, false), (at, n) => resize(t, isRows, at, n, true)); }
        for (const id of now.rows.keys()) if (tabs.has(id)) reindexRows(tabs.get(id), keeps.get(`true:${id}`));
        for (const id of now.cols.keys()) if (tabs.has(id)) reindexCols(tabs.get(id), keeps.get(`false:${id}`));
        twice = [...keeps.values()].some((keep) => keep.size > 0);
        // After a structure change every formula is as the doc says: one the engine already rewrote in the same way is left as it is, and one typed
        // here while the hub made the change, which the engine rewrote but the hub never saw, goes back to what the doc holds. Any tab's formula
        // may refer to the moved cells.
        for (const [place, input] of retype()) if (!(structure && input?.startsWith("="))) engine.setCellContents(place, input);
        // But a formula this change did not write itself (one typed since the rows an undo takes back were made) keeps the engine's rewrite, as the
        // hub's own change would have made it; the hub (`owner`) writes those so every copy follows. Lines moved back (`relay`) move no formula's
        // cells: each reads what it read, which the engine's rewrite says, whatever text an undo put back.
        if (structure) eachFormula((t, row, col, input) => {
          const place = { sheet: t.sheet, row, col }, cell = key(t.rowIds[row], t.colIds[col]), rewritten = engine.getCellFormula(place), stored = rewritten && asStored(cell, input, rewritten);
          // The engine writes `=sum(a1)` as `=SUM(A1)`: a formula differing only so was not moved, and stays as typed.
          if (stored === input || stored?.toUpperCase() === input.toUpperCase()) return;
          if (owner && stored && (relaid || !now.keys.has(cell))) { t.typed[row][col] = stored; kept.push([cell, input, stored]); } else engine.setCellContents(place, toEngine(t, row, col, input));
        });
      } catch { failed = true; } finally { changed = engine.resumeEvaluation().flatMap((change) => change.address && bySheet.has(change.address.sheet) ? [{ tab: bySheet.get(change.address.sheet).id, row: change.address.row, col: change.address.col }] : []); }
    }
    // A move the engine refused (one cutting through a spilt array) is built again from the doc.
    if (failed) { rebuild(); changed = null; kept.length = 0; twice = [...tabs.values()].some((t) => t.rowIds.length !== t.rowIndex.size || t.colIds.length !== t.colIndex.size); }
    // The tables read again where one may have changed: its look, a header cell, or lines moved.
    else if (now.tables || structure || (heads.size && [...now.keys].some((cell) => heads.has(cell.slice(0, cell.indexOf(":")))))) {
      const more = retable();
      if (more && changed) changed = changed.concat(more.flatMap((change) => change.address && bySheet.has(change.address.sheet) ? [{ tab: bySheet.get(change.address.sheet).id, row: change.address.row, col: change.address.col }] : []));
    }
    writeFixes();
    emit({ tabs: now.tabs, structure: moved, cells: changed });
    // The rewrites first, written for the places before the empty lines are taken out, which then rewrites them again.
    if (kept.length || (owner && twice)) queueMicrotask(() => { if (kept.length) doc.transact(() => { written = new Set(); for (const [cell, was, after] of kept) if (cells.get(cell) === was) { cells.set(cell, after); written.add(cell); } }, self); if (owner && twice) unrepeat(); });
  };
  const onLook = (event) => { for (const name of event.keysChanged) if (name.startsWith("names:")) return onTabs(); else if (name.startsWith("table")) note().tables = true; };
  order.observe(onTabs); meta.observe(onTabs); cells.observe(onCells); look.observe(onLook);
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
  /** `op` inserts, deletes or (`move-rows`, `move-cols`) moves `count` lines from `at`, moved to start at `to`: their ids move, so their cells keep their keys. */
  const structure = (id, op, at, count, write = () => {}, to = at) => {
    const t = tabs.get(id) ?? (() => { throw refused(`No tab ${id}`); })();
    const isRows = op.endsWith("rows"), removing = op.startsWith("delete"), moving = op.startsWith("move"), before = isRows ? t.rowIds : t.colIds, line = isRows ? t.rows : t.cols, names = naming(id);
    // Each formula that may refer to the tab by its row and column ids, with the engine's text of it before the change.
    const formulas = [];
    eachFormula((u, row, col, input) => { if (u === t || names(input) || given.has(key(u.rowIds[row], u.colIds[col]))) formulas.push([u, u.rowIds[row], u.colIds[col], engine.getCellFormula({ sheet: u.sheet, row, col }), input]); });
    const gone = new Set(removing ? before.slice(at, at + count) : []), across = isRows ? t.colIds : t.rowIds;
    if (moving) (isRows ? engine.moveRows : engine.moveColumns).call(engine, t.sheet, at, count, to < at ? to : to + count);
    else if (isRows) (removing ? engine.removeRows : engine.addRows).call(engine, t.sheet, [at, count]);
    else (removing ? engine.removeColumns : engine.addColumns).call(engine, t.sheet, [at, count]);
    const relay = (list) => list.splice(to, 0, ...list.splice(at, count));
    doc.transact(() => {
      if (moving) { const moved = line.slice(at, at + count); line.delete(at, count); line.insert(to, moved); }
      else if (removing) line.delete(at, count); else line.insert(at, Array.from({ length: count }, fresh));
      if (isRows) { reindexRows(t); if (moving) relay(t.typed); else moveRows(t, at, count, removing); } else { reindexCols(t); if (moving) t.typed.forEach(relay); else moveCols(t, at, count, removing); }
      // The cells of what was deleted, found by their ids (a cell whose other id is gone too was never placed, and is left).
      for (const one of gone) for (const other of across) { const cell = isRows ? key(one, other) : key(other, one); if (cells.has(cell)) cells.delete(cell); }
      written = new Set();
      for (const [u, row, col, was, input] of formulas) {
        if (u === t && gone.has(isRows ? row : col)) continue;
        const place = { sheet: u.sheet, row: u.rowIndex.get(row), col: u.colIndex.get(col) }, cell = key(row, col), after = engine.getCellFormula(place), stored = after && after !== was ? asStored(cell, input, after) : input;
        if (stored !== input) { cells.set(cell, stored); u.typed[place.row][place.col] = stored; written.add(cell); }
      }
      write();
    }, self);
    return { rows: t.rowIds.length, cols: t.colIds.length };
  };
  /** The tab takes the name in the engine, which rewrites each formula naming it, and the doc is written so (the change that writes it then builds the engine again). */
  const rename = (id, to) => {
    const names = naming(id), formulas = [];
    eachFormula((u, row, col, input) => { if (names(input)) formulas.push([u, row, col, engine.getCellFormula({ sheet: u.sheet, row, col }), input]); });
    engine.renameSheet(tabs.get(id).sheet, to);
    meta.set(`name:${id}`, to);
    for (const [u, row, col, was, input] of formulas) { const cell = key(u.rowIds[row], u.colIds[col]), after = engine.getCellFormula({ sheet: u.sheet, row, col }); if (after && after !== was) { const stored = asStored(cell, input, after); if (stored !== input) cells.set(cell, stored); } }
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
      structure: (op, at, count, write, to) => structure(which(), op, at, count, write, to),
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
    destroy() { for (const off of watched) off(); order.unobserve(onTabs); meta.unobserve(onTabs); cells.unobserve(onCells); look.unobserve(onLook); doc.off("afterTransaction", flush); listeners.clear(); engine.destroy(); },
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
  port.postMessage({ functions: HyperFormula.getRegisteredFunctionNames(CONFIG.language ?? "enGB"), dates: dateFunctions() });
  port.addEventListener("message", ({ data }) => { if (queue.push(data.update) === 1) setTimeout(take, 0); });
  port.start?.();
}
