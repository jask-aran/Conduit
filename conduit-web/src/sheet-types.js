import { blockId } from "./block-id.js";
import { key, parseRange, rangeA1 } from "./sheet-format.js";
import { SHEET_INKS } from "./sheet-styles.js";

/*
 * Cell types in a sheet's look (sheet-types.d.ts): `type:<colId>` for a whole column, `type:<rowId>:<colId>` for a cell (a cell's own over its
 * column's, PLAIN where a cell under a typed column is plain), so a type follows its cells through inserts, deletes, moves, sorts and shifts as styles do.
 * A type is "boolean" (a checkbox), "date", or `valid:<id>`: one of Excel's data validations, its attributes the tab's `validations:<tabId>` entry for
 * that id, as `{ type: "list", formula1: "\"Done,Late\"", inks: { Done: "green" } }` (`inks` ours alone); a list's is a dropdown. sheet.json and xlsx
 * see the A1 shape an import keeps (`validations: [{ range: "B2:B9", ...attributes }]`): `validationsA1` and `restoreValidations` turn one into the other.
 */
export const TYPE_CELL_LIMIT = 10_000;
export const PLAIN = "plain";
export const VALID = "valid:";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// The engine's serials (sheet-engine.js CONFIG: Excel's, 1900 a leap year): days from 30 December 1899, for dates from March 1900.
const serial = (y, m, d) => { const day = new Date(Date.UTC(y, m - 1, d)); return day.getUTCMonth() === m - 1 && day.getUTCDate() === d && y >= 1900 ? day.getTime() / 864e5 + 25569 : null; };

/** A date as typed (2026-03-15, 15/3/2026, 15/3/26, 15 Mar 2026, Mar 15 2026) as its serial number, as a spreadsheet keeps a date; null for anything else. Day before month, as the sheet's Date format. */
export function readDate(text) {
  const typed = text.trim().toLowerCase();
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(typed);
  if (hit) return serial(+hit[1], +hit[2], +hit[3]);
  if ((hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(typed))) return serial(hit[3].length === 2 ? 2000 + +hit[3] : +hit[3], +hit[2], +hit[1]);
  const month = (word) => MONTHS.indexOf(word.slice(0, 3)) + 1;
  if ((hit = /^(\d{1,2}) ([a-z]+),? (\d{4})$/.exec(typed)) && month(hit[2])) return serial(+hit[3], month(hit[2]), +hit[1]);
  if ((hit = /^([a-z]+) (\d{1,2}),? (\d{4})$/.exec(typed)) && month(hit[1])) return serial(+hit[3], month(hit[1]), +hit[2]);
  return null;
}

/** A calendar's day (month from 1) as its serial number, and back. */
export const daySerial = ({ year, month, day }) => serial(year, month, day);
export const serialDay = (n) => { const at = new Date((Math.floor(n) - 25569) * 864e5); return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() }; };

/** A serial number as the Date format draws it (d/m/yyyy), as a date cell is edited; readDate reads it back. */
export const dateText = (serial) => { const day = new Date((Math.floor(serial) - 25569) * 864e5); return `${day.getUTCDate()}/${day.getUTCMonth() + 1}/${day.getUTCFullYear()}`; };

const span = (sheet, area) => { const { rows, cols } = sheet.size(); return { ...area, bottom: Math.min(area.bottom, rows - 1), right: Math.min(area.right, cols - 1) }; };

/** A tab's validations' attributes by id. */
export function readValidations(look, tab) {
  try { const all = JSON.parse(String(look.get(`validations:${tab}`) ?? "{}")); return all && typeof all === "object" && !Array.isArray(all) ? all : {}; } catch { return {}; }
}
const writeValidations = (look, tab, all) => { if (Object.keys(all).length) look.set(`validations:${tab}`, JSON.stringify(all)); else look.delete(`validations:${tab}`); };

/** A list validation's options, as its formula lists them (`"a,b"`); null where it is no list, or its list is a range of cells. */
export function optionsOf(validation) {
  const listed = validation?.type === "list" && /^"(.*)"$/s.exec(String(validation.formula1 ?? "").trim());
  if (!listed) return null;
  const inks = validation.inks && typeof validation.inks === "object" ? validation.inks : {};
  return listed[1].replace(/""/g, '"').split(",").flatMap((typed) => { const value = typed.trim(); return value ? [SHEET_INKS.includes(inks[value]) ? { value, ink: inks[value] } : { value }] : []; });
}
/** Options as kept: each a value of its own, once (no commas, which Excel's list parts by), with an ink of the sheet's or none. */
export const cleanOptions = (options) => {
  const seen = new Set();
  return (Array.isArray(options) ? options : []).flatMap((one) => {
    const value = String(typeof one === "object" && one ? one.value ?? "" : one ?? "").replace(/,/g, " ").trim();
    if (!value || seen.has(value)) return [];
    seen.add(value);
    return [SHEET_INKS.includes(one?.ink) ? { value, ink: one.ink } : { value }];
  });
};
/** A list validation's attributes for `options`, as Excel writes a dropdown: as many as its 255 characters of list hold. */
export const listFields = (options) => {
  const clean = cleanOptions(options);
  while (clean.length > 1 && clean.map((one) => one.value.replace(/"/g, '""')).join(",").length > 255) clean.pop();
  const inks = Object.fromEntries(clean.flatMap((one) => one.ink ? [[one.value, one.ink]] : []));
  return { type: "list", allowBlank: "1", showErrorMessage: "1", formula1: `"${clean.map((one) => one.value.replace(/"/g, '""')).join(",")}"`, ...(Object.keys(inks).length ? { inks } : {}) };
};
/** A validation's attributes changed (in the caller's transaction). */
export function setValidation(look, tab, id, attributes) { const all = readValidations(look, tab); all[id] = attributes; writeValidations(look, tab, all); }

export const putType = (look, sheet, at, kept, columns) => {
  const cols = [];
  for (let c = at.left; c <= at.right; c++) cols.push(sheet.colAt(c));
  if (columns) {
    const ids = new Set(cols);
    for (const col of cols) if (kept) look.set(`type:${col}`, kept); else look.delete(`type:${col}`);
    for (const name of [...look.keys()]) { const parts = name.split(":"); if (parts.length === 3 && parts[0] === "type" && ids.has(parts[2])) look.delete(name); }
    return;
  }
  for (let r = at.top; r <= at.bottom; r++) {
    const row = sheet.rowAt(r);
    for (const col of cols) { const name = `type:${key(row, col)}`, column = look.get(`type:${col}`); if ((kept ?? undefined) === column) look.delete(name); else look.set(name, kept ?? PLAIN); }
  }
};

/**
 * Sets `type` on `area`, clipped to the tab's own cells, in the caller's transaction: "boolean", "date", "list" (a dropdown of `options`, a validation of
 * its own) or null for plain. `columns`: the area's whole columns take it, their cells' own types going; else each cell, kept only where it differs from
 * its column's. A fault is an Error with status 400.
 */
export function writeType(look, sheet, area, type, columns, options) {
  const at = span(sheet, area), count = (at.bottom - at.top + 1) * (at.right - at.left + 1);
  if (!columns && count > TYPE_CELL_LIMIT) throw Object.assign(new Error(`That is ${count} cells; at most ${TYPE_CELL_LIMIT} take a type of their own at once: type whole columns instead`), { status: 400 });
  let kept = type;
  if (type === "list") { const id = blockId(); setValidation(look, sheet.id, id, listFields(options)); kept = `${VALID}${id}`; }
  putType(look, sheet, at, kept, columns);
}

/** The tab's validations in the A1 shape sheet.json and xlsx keep: each with the cells that hold it as `range` (runs down each column); none that no cell holds. */
export function validationsA1(look, sheet) {
  const all = readValidations(look, sheet.id), cells = new Map(), { rows, cols } = sheet.size(), own = new Map();
  for (const [name, value] of look.entries()) {
    const [what, one, two, more] = name.split(":");
    if (what !== "type" || more !== undefined) continue;
    if (two !== undefined) { const row = sheet.indexOfRow(one), col = sheet.indexOfCol(two); if (row >= 0 && col >= 0) own.set(`${row}:${col}`, String(value)); }
  }
  const take = (row, col, value) => { if (!String(value).startsWith(VALID)) return; const id = String(value).slice(VALID.length); if (all[id]) (cells.get(id) ?? cells.set(id, new Map()).get(id)).set(`${row}:${col}`, [row, col]); };
  for (const [at, value] of own) { const [row, col] = at.split(":").map(Number); take(row, col, value); }
  for (let col = 0; col < cols; col++) { const value = look.get(`type:${sheet.colAt(col)}`); if (typeof value === "string" && value.startsWith(VALID)) for (let row = 0; row < rows; row++) if (!own.has(`${row}:${col}`)) take(row, col, value); }
  return [...cells].map(([id, held]) => {
    const byCol = new Map();
    for (const [row, col] of held.values()) (byCol.get(col) ?? byCol.set(col, []).get(col)).push(row);
    const ranges = [...byCol].sort(([a], [b]) => a - b).flatMap(([col, list]) => {
      list.sort((a, b) => a - b);
      const out = [];
      for (const row of list) { const last = out.at(-1); if (last && last.bottom === row - 1) last.bottom = row; else out.push({ top: row, bottom: row, left: col, right: col }); }
      return out;
    });
    return { range: ranges.map(rangeA1).join(" "), ...all[id] };
  });
}
/** Validations in the A1 shape laid on the tab's cells (clipped to it), in the caller's transaction. */
export function restoreValidations(look, sheet, list) {
  const { rows, cols } = sheet.size(), all = readValidations(look, sheet.id);
  for (const one of Array.isArray(list) ? list : []) {
    if (!one || typeof one !== "object") continue;
    const { range, ...attributes } = one, areas = String(range ?? "").split(/\s+/).flatMap((part) => { const area = parseRange(part.replace(/\$/g, "")); return area && area.top < rows && area.left < cols ? [span(sheet, area)] : []; });
    if (!areas.length) continue;
    const id = blockId();
    all[id] = attributes;
    for (const area of areas) putType(look, sheet, area, `${VALID}${id}`, false);
  }
  writeValidations(look, sheet.id, all);
}
