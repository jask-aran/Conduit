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

/** A tab's tables by A1 for its file (`{ name, range, header?, total?, style?, totals?: { B: "sum" } }`), those whose corners are gone left out. */
export function tablesA1(sheet, list) {
  return list.flatMap(({ id, from, to, totals, ...rest }) => {
    const area = rangedArea(sheet, { from, to });
    if (!area) return [];
    const lettered = totals && Object.fromEntries(Object.entries(totals).flatMap(([col, fn]) => sheet.indexOfCol(col) >= 0 ? [[colName(sheet.indexOfCol(col)), fn]] : []));
    return [{ ...rest, range: rangeA1(area), ...(lettered && Object.keys(lettered).length ? { totals: lettered } : {}) }];
  });
}
/** Tables by A1 (a file's, or one old `table`) as a tab's by ids, each name another tab's table has (`taken`) numbered afresh. */
export function tablesIds(sheet, given, taken) {
  const { rows, cols } = sheet.size(), mine = new Set();
  return (Array.isArray(given) ? given : given ? [given] : []).flatMap((one) => {
    const area = parseRange(String(one?.range ?? ""));
    if (!area || area.bottom >= rows || area.right >= cols) return [];
    const said = String(one.name ?? ""), name = nameFault(said, new Set([...taken, ...mine])) ? freshName(new Set([...taken, ...mine])) : said;
    mine.add(name.toLowerCase());
    const totals = one.totals && typeof one.totals === "object" ? Object.fromEntries(Object.entries(one.totals).flatMap(([letter, fn]) => /^[A-Z]{1,3}$/.test(letter) && colIndex(letter) < cols && TOTALS.includes(fn) ? [[sheet.colAt(colIndex(letter)), fn]] : [])) : {};
    return [{ ...newTable(sheet, area, name, one.header !== false), ...(one.total ? { total: true } : {}), ...(typeof one.style === "string" && one.style !== TABLE_STYLE ? { style: one.style } : {}), ...(Object.keys(totals).length ? { totals } : {}) }];
  });
}
