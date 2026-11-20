import { isDateFormat, isValidFormat } from "numfmt";
import { a1, colIndex, colName, key, parseRange, parseRef } from "./sheet-format.js";

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

// A formula's parts as far as telling whether it gives a date: a string, a reference (another tab's, a range, whole columns or rows), a function's name
// with its bracket, a number or a name, a bracket or comma, an operator.
const TOKEN = /\s*(?:("(?:[^"]|"")*")|((?:(?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!)?(?:\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|\$?[A-Za-z]{1,3}:\$?[A-Za-z]{1,3}|\$?\d+:\$?\d+))(?![\w(!])|([A-Za-z_][\w.]*)\(|([\w.]+%?|#[A-Z/0!?]+)|([(),{};])|(<>|<=|>=|[-+*/^&=<>%]))/y;
// Functions whose result is of the kind of the arguments named (by place: "rest" from there on), as Excel and Google Sheets give a MAX of dates a date.
const PASS = { MAX: [0], MIN: [0], LARGE: [0], SMALL: [0], MEDIAN: [0], AVERAGE: [0], MAXIFS: [0], MINIFS: [0], ROUND: [0], ROUNDUP: [0], ROUNDDOWN: [0], INT: [0], TRUNC: [0], MROUND: [0], FLOOR: [0], CEILING: [0], INDEX: [0], IFERROR: [0, 1], IFNA: [0, 1], IF: [1, 2], IFS: "rest", CHOOSE: "rest", XLOOKUP: [2] };

/**
 * The date format a formula's result takes in a cell of General format, as Excel and Google Sheets give one: a function the engine says gives a date
 * (`dates`: by name, the format each takes), or a date's reference added to or taken from what is not a date (`=E2+30`, `=MAX(E:E)`), which takes that
 * date's own format; a difference of two dates stays a number. `formatOf`: the format of what a reference names, undefined for General.
 */
export function formulaDate(input, dates, formatOf) {
  const text = input.trimEnd(), tokens = [];
  if (!text.startsWith("=")) return undefined;
  TOKEN.lastIndex = 1;
  for (let hit; TOKEN.lastIndex < text.length && (hit = TOKEN.exec(text));) tokens.push(hit[1] ? ["text"] : hit[2] ? ["ref", hit[2]] : hit[3] ? ["call", hit[3].toUpperCase()] : hit[4] ? ["value"] : hit[5] ? [hit[5]] : ["op", hit[6]]);
  if (TOKEN.lastIndex < text.length) return undefined;
  let at = 0;
  const peek = () => tokens[at], op = (...ops) => peek()?.[0] === "op" && ops.includes(peek()[1]);
  // Each part gives its date's format (or undefined) and how many dates it counts: one more for a date added, one fewer for one taken away.
  const sum = () => {
    let count = 0, format;
    const term = (sign) => { const one = product(); if (one.format) { count += sign; format ??= one.format; } };
    term(1);
    while (op("+", "-")) term(tokens[at++][1] === "+" ? 1 : -1);
    if (!op("=", "<>", "<", ">", "<=", ">=", "&")) return { format: count === 1 ? format : undefined };
    at++;
    sum();
    return {};
  };
  const product = () => {
    let one = unary();
    while (op("*", "/", "^")) { at++; unary(); one = {}; }
    return one;
  };
  const unary = () => {
    if (op("+", "-")) { const sign = tokens[at++][1]; const one = unary(); return sign === "+" ? one : {}; }
    const one = primary();
    if (op("%")) { at++; return {}; }
    return one;
  };
  const args = () => {
    const out = [];
    if (peek()?.[0] === ")") { at++; return out; }
    for (;;) { out.push(sum()); const next = tokens[at++]?.[0]; if (next !== "," && next !== ";") return out; }
  };
  const primary = () => {
    const [kind, text] = tokens[at++] ?? [];
    if (kind === "ref") { const format = formatOf(text); return { format: format && isDateFormat(format) ? format : undefined }; }
    if (kind === "(") { const one = sum(); at++; return one; }
    if (kind === "{") { while (at < tokens.length && tokens[at++][0] !== "}"); return {}; }
    if (kind !== "call") return {};
    const list = args(), pass = PASS[text];
    if (dates[text]) return { format: dates[text] };
    return { format: (pass === "rest" ? list.slice(1) : pass?.map((n) => list[n]) ?? []).find((one) => one?.format)?.format };
  };
  return sum().format;
}

/**
 * Formulas just written whose cells are General take the date format `formulaDate` finds, each its own (in the caller's transaction). `other`: a tab of the
 * workbook by name, for references to it.
 */
export function formatDates(look, sheet, written, dates, other) {
  const formatAt = (view, row, col) => { const own = look.get(`fmt:${key(view.rowAt(row), view.colAt(col))}`) ?? look.get(`fmt:${view.colAt(col)}`); return isGeneral(own) ? undefined : String(own); };
  const formatOf = (text) => {
    const ref = parseRef(text.replace(/\$/g, "")), view = ref.tab === null ? sheet : other(ref.tab);
    if (!view) return undefined;
    const { rows, cols } = view.size(), whole = /^([A-Z]+):([A-Z]+)$/i.exec(ref.range), lines = /^(\d+):(\d+)$/.exec(ref.range);
    const area = whole ? { top: 0, left: colIndex(whole[1]), bottom: rows - 1 } : lines ? { top: Number(lines[1]) - 1, left: 0, bottom: Number(lines[2]) - 1 } : parseRange(ref.range);
    if (!area || area.top >= rows || area.left >= cols) return undefined;
    if (whole) { const column = look.get(`fmt:${view.colAt(area.left)}`); if (!isGeneral(column)) return String(column); }
    // A range is read by its first column's first number in a few rows, so a heading over dates does not hide them.
    for (let row = area.top; row <= Math.min(area.bottom, rows - 1, area.top + 20); row++) if (typeof view.value(row, area.left) === "number" || area.top === area.bottom) return formatAt(view, row, area.left);
    return undefined;
  };
  for (const { row, col, input } of written) {
    if (!input.startsWith("=") || formatAt(sheet, row, col) || !sheet.rowAt(row) || !sheet.colAt(col)) continue;
    const format = formulaDate(input, dates, formatOf);
    if (format) writeFormat(look, sheet, { top: row, left: col, bottom: row, right: col }, format, false);
  }
}
