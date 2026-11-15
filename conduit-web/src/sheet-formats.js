import { isValidFormat } from "numfmt";
import { a1, colName, key } from "./sheet-format.js";

/*
 * Number formats in a sheet's look (sheet-formats.d.ts): Excel's format strings, `fmt:<colId>` for a column's and `fmt:<rowId>:<colId>` for a cell
 * that differs from its column. Shared by the page, which draws them (components/sheet/formats.ts), and the hub, which sets and lists them.
 */
export const FORMAT_CELL_LIMIT = 10_000;
export const GENERAL = "General";
export const isGeneral = (format) => typeof format !== "string" || !format.trim() || format.trim().toLowerCase() === "general";
export const formatFault = (format) => typeof format !== "string" ? "format is an Excel number format, such as $#,##0.00, 0.0% or d/m/yyyy (General for none)"
  : isGeneral(format) || isValidFormat(format) ? null : `${format} is not a number format Excel reads`;

const span = (sheet, area) => { const { rows, cols } = sheet.size(); return { ...area, bottom: Math.min(area.bottom, rows - 1), right: Math.min(area.right, cols - 1) }; };
const cellKeys = (look, cols) => [...look.keys()].filter((name) => { const ids = name.split(":"); return ids.length === 3 && ids[0] === "fmt" && cols.has(ids[2]); });

export function writeFormat(look, sheet, area, format, columns) {
  const fault = formatFault(format);
  if (fault) throw Object.assign(new Error(fault), { status: 400 });
  const at = span(sheet, area), general = isGeneral(format), cols = [];
  for (let c = at.left; c <= at.right; c++) cols.push(sheet.colAt(c));
  if (columns) {
    for (const col of cols) if (general) look.delete(`fmt:${col}`); else look.set(`fmt:${col}`, format);
    for (const name of cellKeys(look, new Set(cols))) look.delete(name);
    return;
  }
  const count = (at.bottom - at.top + 1) * (at.right - at.left + 1);
  if (count > FORMAT_CELL_LIMIT) throw Object.assign(new Error(`That is ${count} cells; at most ${FORMAT_CELL_LIMIT} take a format of their own at once: format whole columns instead`), { status: 400 });
  for (let r = at.top; r <= at.bottom; r++) {
    const row = sheet.rowAt(r);
    cols.forEach((col) => {
      // A cell keeps a format of its own only where it differs from its column's.
      const name = `fmt:${key(row, col)}`, column = look.get(`fmt:${col}`);
      if (general ? column === undefined : column === format) look.delete(name); else look.set(name, general ? GENERAL : format);
    });
  }
}

export function listFormats(look, sheet, area) {
  const at = span(sheet, area), out = {}, own = [];
  for (let c = at.left; c <= at.right; c++) { const format = look.get(`fmt:${sheet.colAt(c)}`); if (typeof format === "string") out[colName(c)] = format; }
  for (const [name, format] of look.entries()) {
    const [what, row, col] = name.split(":"), r = col ? sheet.indexOfRow(row) : -1, c = col ? sheet.indexOfCol(col) : -1;
    if (what === "fmt" && typeof format === "string" && r >= at.top && r <= at.bottom && c >= at.left && c <= at.right) own.push([r, c, format]);
  }
  for (const [r, c, format] of own.sort((a, b) => a[0] - b[0] || a[1] - b[1])) out[a1(r, c)] = format;
  return out;
}
