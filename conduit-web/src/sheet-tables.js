import { colIndex, colName, key, parseRange, rangeA1, rangedArea } from "./sheet-format.js";
import { blockId } from "./block-id.js";

/*
 * A tab's tables (Excel's Ctrl+T), as its look holds them in `tables:<tabId>` (sheet-tables.d.ts SheetTable): each by its corners' row and column ids,
 * so it follows inserts, deletes, moves and sorts, with a name unique in the workbook. The one `table:<tabId>` a tab held before is read as its first.
 */
export const TABLE_STYLE = "TableStyleMedium2";
export const TOTALS = ["sum", "average", "count", "countNums", "max", "min"];

const parse = (text) => { try { return JSON.parse(String(text)); } catch { return null; } };
/** A tab's tables, by ids. */
export function readTables(look, tabId) {
  const text = look.get(`tables:${tabId}`);
  if (text !== undefined) { const list = parse(text); return Array.isArray(list) ? list.filter((one) => one?.from && one.to && one.id) : []; }
  const old = parse(look.get(`table:${tabId}`));
  return old?.from && old.to ? [{ id: "t1", name: old.name ?? "Table1", from: old.from, to: old.to, ...(old.style ? { style: old.style } : {}) }] : [];
}
/** A tab's tables written (in the caller's transaction), the old `table:<tabId>` gone. */
export function writeTables(look, tabId, list) {
  if (look.has(`table:${tabId}`)) look.delete(`table:${tabId}`);
  const text = JSON.stringify(list);
  if (!list.length) { if (look.has(`tables:${tabId}`)) look.delete(`tables:${tabId}`); }
  else if (look.get(`tables:${tabId}`) !== text) look.set(`tables:${tabId}`, text);
}
/** The names every tab's tables have, lowercased, but those of `skip` (a tab). */
export function takenNames(look, skip) {
  const out = new Set();
  for (const name of look.keys()) {
    const [what, tab, more] = name.split(":");
    if (more === undefined && tab !== skip && (what === "tables" || (what === "table" && !look.has(`tables:${tab}`)))) for (const one of readTables(look, tab)) out.add(String(one.name).toLowerCase());
  }
  return out;
}
/** Why Excel would not take a table's name, or null: a letter, `_` or `\` first, then letters, digits, `.` and `_`; no cell's address; unique in the workbook. */
export function nameFault(name, taken) {
  if (!name) return "A table needs a name";
  if (name.length > 255) return "A table's name is at most 255 characters";
  if (!/^[\p{L}_\\][\p{L}\p{N}_.]*$/u.test(name)) return "A table's name starts with a letter or _ and holds only letters, digits, . and _ (no spaces)";
  if (/^[A-Z]{1,3}\d+$/i.test(name) || /^[RC]$/i.test(name) || /^R\d*C\d*$/i.test(name)) return "A table's name can't be a cell's address";
  if (taken.has(name.toLowerCase())) return `Another table is called ${name}`;
  return null;
}
/** The first of Table1, Table2… no table has. */
export function freshName(taken) { let n = 1; while (taken.has(`table${n}`)) n++; return `Table${n}`; }
/** A new table over `area` (by index), its corners' ids from the sheet. */
export function newTable(sheet, area, name, header = true) {
  return { id: blockId(), name, from: key(sheet.rowAt(area.top), sheet.colAt(area.left)), to: key(sheet.rowAt(area.bottom), sheet.colAt(area.right)), ...(header ? {} : { header: false }) };
}
const corners = (sheet, area) => ({ from: key(sheet.rowAt(area.top), sheet.colAt(area.left)), to: key(sheet.rowAt(area.bottom), sheet.colAt(area.right)) });
const meets = (one, two) => one.top <= two.bottom && two.top <= one.bottom && one.left <= two.right && two.left <= one.right;

/** A table's rows by index: its header (-1: none), its first and last data rows, its total row (-1: none). */
export const rowsOf = (area, table) => ({ header: table.header === false ? -1 : area.top, first: area.top + (table.header === false ? 0 : 1), last: area.bottom - (table.total ? 1 : 0), total: table.total ? area.bottom : -1 });
/** A tab's tables where they are now (by index); those whose corners are gone left out. */
export const placed = (look, sheet) => readTables(look, sheet.id).flatMap((table) => { const range = rangedArea(sheet, table); return range ? [{ table, range }] : []; });
/** The table's filter as a tab's is held (sheet-format.d.ts SheetRangedLook: its header row to its last data row), or null where it shows none. */
export function tableFilter(sheet, table, area) {
  if (table.header === false || table.filter === false) return null;
  const { last } = rowsOf(area, table);
  return { from: table.from, to: key(sheet.rowAt(last), sheet.colAt(area.right)), keep: table.keep, when: table.when, hide: table.hide };
}

/** The SUBTOTAL a total cell writes for a function of TOTALS over a data column (101-109: the rows a filter hides left out, as Excel's). */
const CODES = { average: 101, count: 103, countNums: 102, max: 104, min: 105, sum: 109 };
export const totalFormula = (fn, column) => CODES[fn] ? `=SUBTOTAL(${CODES[fn]},${rangeA1(column)})` : "";
/** The function of TOTALS a total cell's formula is, or undefined. */
export function totalOf(input) {
  const code = /^=SUBTOTAL\((\d+),[^,()]+\)$/i.exec(String(input ?? "").replace(/\s/g, ""))?.[1];
  return Object.keys(CODES).find((fn) => CODES[fn] === Number(code) || CODES[fn] - 100 === Number(code));
}

/**
 * A table made over `area`, in the caller's transaction. `header`: its first row is its header; unsaid where the row above is free, Excel's
 * Column1… are written there (`set`, the caller's own cell writer) and the table starts on it. Throws where it would overlap a table.
 */
export function makeTable(look, sheet, area, header, set) {
  const list = placed(look, sheet);
  let range = area, named = header;
  if (!header && area.top > 0 && Array.from({ length: area.right - area.left + 1 }, (_, c) => sheet.input(area.top - 1, area.left + c)).every((input) => input === "")) {
    range = { ...area, top: area.top - 1 };
    for (let c = area.left; c <= area.right; c++) set(range.top, c, `Column${c - area.left + 1}`);
    named = true;
  }
  if (list.some((one) => meets(one.range, range))) throw new Error("A table can't overlap another table");
  const table = newTable(sheet, range, freshName(takenNames(look)), named);
  writeTables(look, sheet.id, [...list.map((one) => one.table), table]);
  return table;
}
/**
 * A table changed, in the caller's transaction: its `name` (Excel's rules, unique in the workbook), `style` ("none" for plain), `filter` (false: no
 * buttons), its `range` (resized: its header row stays its first) or its total row (`total`: on, the row under it joins it with Total and a Sum in
 * its last column, written by `set`; off, that row's cells are cleared and it leaves). Throws what won't do.
 */
export function changeTable(look, sheet, id, change, set) {
  const list = placed(look, sheet), one = list.find((each) => each.table.id === id);
  if (!one) throw new Error("No such table");
  let { table, range } = one;
  if (change.name !== undefined && change.name !== table.name) {
    const taken = takenNames(look); taken.delete(table.name.toLowerCase());
    const fault = nameFault(change.name, taken);
    if (fault) throw new Error(fault);
    table = { ...table, name: change.name };
  }
  if (change.style !== undefined) { const { style: _, ...rest } = table; table = change.style === TABLE_STYLE ? rest : { ...rest, style: change.style }; }
  if (change.filter !== undefined) { const { filter: _, keep: __, when: ___, hide: ____, ...rest } = table; table = change.filter ? rest : { ...rest, filter: false }; }
  if (change.range) {
    const next = change.range;
    if (next.top !== range.top || next.bottom - next.top < (table.header === false ? 0 : 1)) throw new Error("A table's header stays in its first row, over at least one row of data");
    if (list.some((each) => each !== one && meets(each.range, next))) throw new Error("A table can't overlap another table");
    range = next;
  }
  if (change.total !== undefined && change.total !== Boolean(table.total)) {
    if (change.total) {
      const row = range.bottom + 1;
      if (row >= sheet.size().rows || list.some((each) => each !== one && meets(each.range, { ...range, top: row, bottom: row }))) throw new Error("The row under the table is needed for its total row");
      range = { ...range, bottom: row };
      set(row, range.left, "Total");
      for (let c = range.left + 1; c < range.right; c++) set(row, c, "");
      if (range.right > range.left) set(row, range.right, totalFormula("sum", { top: rowsOf(range, table).first, bottom: row - 1, left: range.right, right: range.right }));
      table = { ...table, total: true };
    } else {
      for (let c = range.left; c <= range.right; c++) set(range.bottom, c, "");
      range = { ...range, bottom: range.bottom - 1 };
      const { total: _, ...rest } = table; table = rest;
    }
  }
  writeTables(look, sheet.id, list.map((each) => each === one ? { ...table, ...corners(sheet, range) } : each.table));
  return table;
}
export function removeTable(look, sheet, id) { writeTables(look, sheet.id, placed(look, sheet).filter((one) => one.table.id !== id).map((one) => one.table)); }

/**
 * What a table does with cells just written (`written`: [row, col, input]), in the caller's transaction, `set` writing its own: an entry right under
 * its last row, or right of its last column, grows it to hold it (Excel's AutoExpand), a new column's header named Column<n> where empty; a row it
 * grows into takes the row above's types, formats and styles, and each calculated column's formula; a formula entered in an empty column of it fills
 * the column (a calculated column). Returns whether any table changed.
 */
export function tableWrites(look, sheet, written, set, shift) {
  const list = placed(look, sheet);
  if (!list.length || !written.length) return false;
  const typed = new Map(written.map(([row, col, input]) => [`${row}:${col}`, input])), input = (row, col) => typed.get(`${row}:${col}`) ?? sheet.input(row, col);
  const column = (top, bottom, col) => Array.from({ length: Math.max(0, bottom - top + 1) }, (_, n) => input(top + n, col));
  const free = (range, area) => !list.some((each) => each.range !== range && meets(each.range, area));
  let changed = false;
  const next = list.map(({ table, range }) => {
    const rows = rowsOf(range, table);
    let grown = range;
    // AutoExpand: anything typed in the row under it (with no total row), or in the column right of it.
    if (!table.total && written.some(([row, col, one]) => one && row === range.bottom + 1 && col >= range.left && col <= range.right) && free(range, { ...range, top: range.bottom + 1, bottom: range.bottom + 1 })) grown = { ...grown, bottom: range.bottom + 1 };
    if (written.some(([row, col, one]) => one && col === range.right + 1 && row >= range.top && row <= range.bottom) && free(range, { ...range, left: range.right + 1, right: range.right + 1 })) {
      grown = { ...grown, right: range.right + 1 };
      if (rows.header >= 0 && input(rows.header, grown.right) === "") {
        const names = new Set(Array.from({ length: range.right - range.left + 1 }, (_, c) => input(rows.header, range.left + c).toLowerCase()));
        let n = range.right - range.left + 2;
        while (names.has(`column${n}`)) n++;
        set(rows.header, grown.right, `Column${n}`);
      }
    }
    if (grown.bottom > range.bottom) newRow(look, sheet, range, rows, grown, input, (row, col, one) => { if (!typed.get(`${row}:${col}`)) set(row, col, one); }, shift);
    // A calculated column: one formula entered in a column whose other data cells are empty fills it.
    const last = grown.bottom - (table.total ? 1 : 0), [one] = written;
    if (written.length === 1 && one[2].startsWith("=") && one[0] >= rows.first && one[0] <= last && one[1] >= grown.left && one[1] <= grown.right && last > rows.first
      && column(rows.first, last, one[1]).every((cell, n) => rows.first + n === one[0] || cell === "")) for (let r = rows.first; r <= last; r++) if (r !== one[0]) set(r, one[1], shift(one[2], r - one[0], 0));
    if (grown === range) return table;
    changed = true;
    return { ...table, ...corners(sheet, grown) };
  });
  if (changed) writeTables(look, sheet.id, next);
  return changed;
}
// A row a table grows into takes the row above's look, and each formula column's formula (one every data row holds), moved.
const newRow = (look, sheet, range, rows, grown, input, set, shift) => {
  for (let c = grown.left; c <= grown.right; c++) {
    const above = input(range.bottom, c);
    copyLook(look, sheet, range.bottom, c, grown.bottom, c);
    if (above.startsWith("=") && Array.from({ length: range.bottom - rows.first + 1 }, (_, n) => input(rows.first + n, c)).every((one) => one.startsWith("="))) set(grown.bottom, c, shift(above, 1, 0));
  }
};
/** A row added under a table's last (Tab in its last cell), where that row is empty and the table has no total row; its index, or null. */
export function addTableRow(look, sheet, id, set, shift) {
  const list = placed(look, sheet), one = list.find((each) => each.table.id === id);
  if (!one || one.table.total) return null;
  const { table, range } = one, row = range.bottom + 1, grown = { ...range, bottom: row };
  if (row >= sheet.size().rows || list.some((each) => each !== one && meets(each.range, { ...range, top: row, bottom: row })) || Array.from({ length: range.right - range.left + 1 }, (_, c) => sheet.input(row, range.left + c)).some(Boolean)) return null;
  newRow(look, sheet, range, rowsOf(range, table), grown, (r, c) => sheet.input(r, c), set, shift);
  writeTables(look, sheet.id, list.map((each) => each === one ? { ...table, ...corners(sheet, grown) } : each.table));
  return row;
}
/** A table's own filter written (`keep`, `when`, `hide`; undefined: none). */
export function putFilter(look, sheet, id, { keep, when, hide }) {
  writeTables(look, sheet.id, readTables(look, sheet.id).map((table) => {
    if (table.id !== id) return table;
    const { keep: _, when: __, hide: ___, ...rest } = table;
    return { ...rest, ...(keep ? { keep } : {}), ...(when ? { when } : {}), ...(hide ? { hide } : {}) };
  }));
}
/** The SUBTOTAL a table's total cell writes for `fn` (TOTALS, or "none"), over its column's data. */
export function totalAt(table, range, col, fn) { const { first, last } = rowsOf(range, table); return fn === "none" ? "" : totalFormula(fn, { top: first, bottom: last, left: col, right: col }); }
// A cell's own type, number format and style, as the cell above has them.
const copyLook = (look, sheet, fromRow, fromCol, row, col) => {
  for (const what of ["type", "fmt", "style"]) {
    const kept = look.get(`${what}:${key(sheet.rowAt(fromRow), sheet.colAt(fromCol))}`), name = `${what}:${key(sheet.rowAt(row), sheet.colAt(col))}`;
    if (kept !== undefined && look.get(name) === undefined) look.set(name, kept);
  }
};

/** A tab's tables by A1 for its file (`{ name, range, header?, total?, style?, filter? }`), those whose corners are gone left out; a filter's as sheet.json writes one. */
export function tablesA1(sheet, list) {
  return list.flatMap(({ id, from, to, keep, when, hide, ...rest }) => {
    const area = rangedArea(sheet, { from, to });
    if (!area) return [];
    const lettered = (by) => by && Object.fromEntries(Object.entries(by).flatMap(([col, values]) => sheet.indexOfCol(col) >= 0 ? [[colName(sheet.indexOfCol(col)), values]] : []));
    const hidden = Array.isArray(hide) ? hide.map((one) => sheet.indexOfRow(one) + 1).filter(Boolean) : [];
    return [{ ...rest, range: rangeA1(area), ...(keep ? { keep: lettered(keep) } : {}), ...(when ? { when: lettered(when) } : {}), ...(hidden.length ? { hide: hidden } : {}) }];
  });
}
/** Tables by A1 (a file's, or one old `table`) as a tab's by ids, each name another tab's table has (`taken`) numbered afresh. */
export function tablesIds(sheet, given, taken) {
  const { rows, cols } = sheet.size(), mine = new Set();
  const byId = (by, ok) => by && typeof by === "object" ? Object.fromEntries(Object.entries(by).flatMap(([letter, value]) => /^[A-Z]{1,3}$/.test(letter) && colIndex(letter) < cols && ok(value) ? [[sheet.colAt(colIndex(letter)), value]] : [])) : undefined;
  return (Array.isArray(given) ? given : given ? [given] : []).flatMap((one) => {
    const area = parseRange(String(one?.range ?? ""));
    if (!area || area.bottom >= rows || area.right >= cols) return [];
    const said = String(one.name ?? ""), name = nameFault(said, new Set([...taken, ...mine])) ? freshName(new Set([...taken, ...mine])) : said;
    mine.add(name.toLowerCase());
    const keep = byId(one.keep, Array.isArray), when = byId(one.when, (test) => typeof test?.is === "string"), hide = Array.isArray(one.hide) ? one.hide.flatMap((row) => Number.isInteger(row) && row >= 1 && row <= rows ? [sheet.rowAt(row - 1)] : []) : [];
    return [{ ...newTable(sheet, area, name, one.header !== false), ...(one.total ? { total: true } : {}), ...(typeof one.style === "string" && one.style !== TABLE_STYLE ? { style: one.style } : {}),
      ...(one.filter === false ? { filter: false } : {}), ...(keep && Object.keys(keep).length ? { keep } : {}), ...(when && Object.keys(when).length ? { when } : {}), ...(hide.length ? { hide } : {}) }];
  });
}
