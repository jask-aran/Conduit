import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { HyperFormula } from "hyperformula";
import * as XLSX from "xlsx";
import { COL_LIMIT, SHEET_LIMIT, WORKBOOK_LIMIT, a1, colIndex, colName, parseA1, parseRange, tabName, toCsv, valueText } from "../sheet-format.js";
import { CONFIG, defineNames } from "../sheet-engine.js";
import { NAMES } from "../sheet-functions.js";
import { shiftRefs } from "../sheet-rules.js";
import { decodeStyle, encodeStyle, SHEET_INKS } from "../sheet-styles.js";
import { drawingPart, readCharts, tablePart, withParts } from "./xlsx-parts.js";
import { ownOver, readDxfs, readStyles, rgbOf, seen, sheetRules, sheetStyles, withDxfs, withRules, writeRules, writeStyles } from "./xlsx-styles.js";

/*
 * An .xlsx read as a workbook's files (docs/plans/sheet-xlsx-and-tabs.md): each tab's CSV of values, its formulas by address and its look, as
 * sheets.js reads a workbook folder, and a report of what did not come across. Every formula is computed here and held against the value the
 * .xlsx kept for it: one that computes something else, or cannot be computed, is frozen (its cell holds the kept value; the report keeps the
 * formula). Pure and slow for a large file: the hub runs it off its main thread.
 */
/** @typedef {{ name: string, hidden: boolean, csv: string, inputs: Record<string, string>, look: Record<string, unknown>, rows: number, cols: number, formulas: number }} ImportedTab */
/** @typedef {{ tabs: { name: string, rows: number, cols: number, formulas: number }[], skipped: string[], computed: { same: number, frozen: number, noCache: number, volatile: number }, frozen: Record<string, Record<string, { formula: string, why: string, kept?: string }>>, reasons: Record<string, number>, dropped: Record<string, number> }} ImportReport */

const PT_PER_PX = 0.75;
// Pixels to a character of a column's width, Excel's for its default font: SheetJS's own guess makes them double on read and six on write.
const PX_PER_CHAR = 7, STYLES_PER_TAB = 20_000;
const VOLATILE = /\b(?:TODAY|NOW|RAND|RANDBETWEEN|RANDARRAY)\s*\(/i, FORMATS_PER_TAB = 2000, PASSES = 4;
const ERROR_TEXT = { 0: "#NULL!", 7: "#DIV/0!", 15: "#VALUE!", 23: "#REF!", 29: "#NAME?", 36: "#NUM!", 42: "#N/A", 43: "#GETTING_DATA" };
const fault = (message) => Object.assign(new Error(message), { status: 422 });
// SheetJS's dense rows are holey arrays as long as their last cell: walking the holes of rows whose formatting runs far out costs more than all the rest.
const cellsOf = (data, each) => { for (let r = 0; r < data.length; r++) { const row = data[r]; if (row) for (const c of Object.keys(row)) if (row[c]) each(row[c], r, Number(c)); } };
const isError = (value) => value !== null && typeof value === "object";
// SheetJS reads and writes no frozen panes or styles: they are read from, and written into, the workbook's own XML parts.
const unescaped = (text) => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const attr = (tag, name) => { const found = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return found ? unescaped(found[1]) : undefined; };
/** The rows and columns a sheet's view freezes, from its XML. */
const paneOf = (xml) => {
  const pane = /<pane\b[^>]*>/.exec(xml)?.[0];
  if (!pane || !/^frozen/.test(attr(pane, "state") ?? "")) return null;
  const count = (name) => Math.max(0, Math.floor(Number(attr(pane, name) ?? 0)) || 0);
  return { rows: count("ySplit"), cols: count("xSplit") };
};
/** A frozen view as a sheet's XML says it, `rows` and `cols` frozen at the top and left. */
const paneXml = (rows, cols) => `<sheetView workbookViewId="0"><pane${cols ? ` xSplit="${cols}"` : ""}${rows ? ` ySplit="${rows}"` : ""} topLeftCell="${a1(rows, cols)}" activePane="${rows && cols ? "bottomRight" : rows ? "bottomLeft" : "topRight"}" state="frozen"/></sheetView>`;
/** A written workbook with its XML parts changed by `edit` (each part's path in the zip, its XML and all of them by path); the zip is written again only where one changed. */
const editParts = (bytes, edit) => {
  const zip = XLSX.CFB.read(bytes, { type: "buffer" }), files = new Map();
  zip.FullPaths.forEach((path, i) => { if (path.endsWith(".xml")) files.set(path.replace(/^Root Entry\//, ""), zip.FileIndex[i]); });
  const xml = Object.fromEntries([...files].map(([path, file]) => [path, Buffer.from(file.content).toString("utf8")]));
  let changed = false;
  for (const [path, file] of files) {
    const next = edit(path, xml[path], xml);
    if (next !== xml[path]) { file.content = Buffer.from(next, "utf8"); file.size = file.content.length; changed = true; }
  }
  return changed ? XLSX.CFB.write(zip, { fileType: "zip", type: "buffer", compression: true }) : bytes;
};
const escaped = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const WORKSHEET = "sheetPr dimension sheetViews sheetFormatPr cols sheetData sheetCalcPr sheetProtection protectedRanges scenarios autoFilter sortState dataConsolidate customSheetViews mergeCells phoneticPr conditionalFormatting dataValidations hyperlinks printOptions pageMargins pageSetup headerFooter rowBreaks colBreaks customProperties cellWatches ignoredErrors smartTags drawing legacyDrawing legacyDrawingHF drawingHF picture oleObjects controls webPublishItems tableParts extLst".split(" ");
/** A sheet part with `block` put where the schema has `element`: before the first element that comes after it there. */
const placed = (xml, element, block) => {
  const later = WORKSHEET.slice(WORKSHEET.indexOf(element) + 1).join("|");
  return xml.replace(new RegExp(`${later ? `<(?:${later})\\b|` : ""}</worksheet>`), (at) => `${block}${at}`);
};
// A data validation's attributes as the schema has them, and each one's formulas: what is kept of one (`validations` in a tab's look) and written back.
const VALIDATION = ["type", "errorStyle", "imeMode", "operator", "allowBlank", "showDropDown", "showInputMessage", "showErrorMessage", "errorTitle", "error", "promptTitle", "prompt"];
const validationsOf = (xml) => [...xml.matchAll(/<dataValidation\b([^>]*?)(?:\/>|>([\s\S]*?)<\/dataValidation>)/g)].map(([, head, body = ""]) => {
  const formula = (n) => { const found = new RegExp(`<formula${n}>([\\s\\S]*?)</formula${n}>`).exec(body); return found ? { [`formula${n}`]: unescaped(found[1]) } : {}; };
  return { range: attr(head, "sqref") ?? "", ...Object.fromEntries(VALIDATION.flatMap((name) => attr(head, name) === undefined ? [] : [[name, attr(head, name)]])), ...formula(1), ...formula(2) };
}).filter((one) => one.range).map((one, _, __, inks = inksOf(xml)) => inks[one.range] ? { ...one, inks: inks[one.range] } : one);
// A dropdown's option inks (sheet-types.js), which Excel has no place for: in an extension of the sheet's own, which Excel keeps through its own save.
const INKS_URI = "{6C5E2A4B-0D1C-4C2B-9C2E-3F8A1D0C0A11}";
const inksOf = (xml) => Object.fromEntries([...(new RegExp(`<ext\\b[^>]*uri="${INKS_URI.replace(/[{}]/g, "\\$&")}"[\\s\\S]*?</ext>`).exec(xml)?.[0] ?? "").matchAll(/<(?:\w+:)?inks sqref="([^"]*)">([^<]*)</g)].flatMap(([, range, json]) => { try { return [[unescaped(range), JSON.parse(unescaped(json))]]; } catch { return []; } }));
const inksXml = (list) => {
  const held = (Array.isArray(list) ? list : []).filter((one) => typeof one?.range === "string" && one.inks && typeof one.inks === "object" && Object.keys(one.inks).length);
  return held.length ? `<ext uri="${INKS_URI}" xmlns:cd="https://conduit.invalid/sheet">${held.map((one) => `<cd:inks sqref="${escaped(one.range)}">${escaped(JSON.stringify(one.inks))}</cd:inks>`).join("")}</ext>` : "";
};
const validationsXml = (list) => {
  const kept = (Array.isArray(list) ? list : []).filter((one) => typeof one?.range === "string" && /^(\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?\s*)+$/.test(one.range));
  return kept.length ? `<dataValidations count="${kept.length}">${kept.map((one) => `<dataValidation${VALIDATION.filter((name) => one[name] !== undefined).map((name) => ` ${name}="${escaped(one[name])}"`).join("")} sqref="${escaped(one.range)}">${["formula1", "formula2"].filter((name) => one[name] !== undefined).map((name) => `<${name}>${escaped(one[name])}</${name}>`).join("")}</dataValidation>`).join("")}</dataValidations>` : "";
};
// A filter's conditions (sheet-format.d.ts SheetFilterWhen) and kept values, by column letter, as an `<autoFilter>`'s `<filterColumn>`s, and back.
// "Is exactly" is one `<filter>`, kept values several; a date is its serial, read back as a date where the column's first value wears a date format.
const wild = (text) => String(text ?? "").replace(/[*?~]/g, "~$&"), unwild = (text) => text.replace(/~([*?~])/g, "$1");
const serial = (day) => /^\d{4}-\d{2}-\d{2}$/.test(String(day)) ? Date.parse(`${day}T00:00Z`) / 864e5 + 25569 : Number(day);
const dayText = (n) => new Date(Math.round((n - 25569) * 864e5)).toISOString().slice(0, 10);
const custom = (pairs, and) => `<customFilters${and ? ' and="1"' : ""}>${pairs.map(([operator, val]) => `<customFilter operator="${operator}" val="${escaped(val)}"/>`).join("")}</customFilters>`;
const WHEN_XML = {
  contains: (a) => custom([["equal", `*${wild(a)}*`]]), "not-contains": (a) => custom([["notEqual", `*${wild(a)}*`]]), starts: (a) => custom([["equal", `${wild(a)}*`]]), ends: (a) => custom([["equal", `*${wild(a)}`]]),
  equals: (a) => `<filters><filter val="${escaped(a)}"/></filters>`, empty: () => '<filters blank="1"/>', filled: () => custom([["notEqual", " "]]),
  greater: (a) => custom([["greaterThan", a]]), less: (a) => custom([["lessThan", a]]), between: (a, b) => custom([["greaterThanOrEqual", a], ["lessThanOrEqual", b]], true),
  before: (a) => custom([["lessThan", serial(a)]]), after: (a) => custom([["greaterThan", serial(a)]]), dates: (a, b) => custom([["greaterThanOrEqual", serial(a)], ["lessThanOrEqual", serial(b)]], true),
};
const filterColumns = (filter) => {
  const area = parseRange(String(filter?.range ?? "")), cols = new Map();
  if (!area) return "";
  for (const [letter, values] of Object.entries(filter.keep ?? {})) if (Array.isArray(values)) cols.set(letter, `<filters${values.includes("") ? ' blank="1"' : ""}>${values.filter(Boolean).map((value) => `<filter val="${escaped(value)}"/>`).join("")}</filters>`);
  for (const [letter, when] of Object.entries(filter.when ?? {})) if (WHEN_XML[when?.is]) cols.set(letter, WHEN_XML[when.is](when.a ?? "", when.b ?? ""));
  return [...cols].filter(([letter]) => /^[A-Z]{1,3}$/.test(letter) && colIndex(letter) >= area.left && colIndex(letter) <= area.right).sort(([a], [b]) => colIndex(a) - colIndex(b)).map(([letter, xml]) => `<filterColumn colId="${colIndex(letter) - area.left}">${xml}</filterColumn>`).join("");
};
const READ_CUSTOM = [[/^equal \*(.*)\*$/, "contains"], [/^notEqual \*(.*)\*$/, "not-contains"], [/^equal \*(.*)$/, "ends"], [/^equal (.*)\*$/, "starts"], [/^notEqual  $/, "filled"], [/^greaterThan (.*)$/, "greater"], [/^lessThan (.*)$/, "less"], [/^equal (.*)$/, "equals"]];
const filterOf = (xml, range, dated, drop) => {
  const area = parseRange(range), keep = {}, when = {};
  for (const column of xml.match(/<filterColumn\b[\s\S]*?<\/filterColumn>/g) ?? []) {
    const letter = colName(area.left + Number(attr(column, "colId"))), date = dated(area.left + Number(attr(column, "colId")));
    const values = [...column.matchAll(/<filter\b[^>]*>/g)].map(([tag]) => attr(tag, "val") ?? ""), blank = ["1", "true"].includes(attr(/<filters\b[^>]*>/.exec(column)?.[0] ?? "", "blank"));
    const customs = [...column.matchAll(/<customFilter\b[^>]*>/g)].map(([tag]) => `${attr(tag, "operator") ?? "equal"} ${attr(tag, "val") ?? ""}`);
    if (/<filters\b/.test(column)) { if (values.length === 1 && !blank) when[letter] = { is: "equals", a: values[0] }; else if (!values.length && blank) when[letter] = { is: "empty" }; else keep[letter] = [...values, ...(blank ? [""] : [])]; continue; }
    const pair = customs.length === 2 && /^greaterThanOrEqual /.test(customs[0]) && /^lessThanOrEqual /.test(customs[1]) ? [customs[0].split(" ")[1], customs[1].split(" ")[1]] : null;
    if (pair) { when[letter] = date ? { is: "dates", a: dayText(Number(pair[0])), b: dayText(Number(pair[1])) } : { is: "between", a: pair[0], b: pair[1] }; continue; }
    const found = customs.length === 1 && READ_CUSTOM.map(([re, is]) => [re.exec(customs[0]), is]).find(([hit]) => hit);
    if (!found) { drop("filter conditions the sheet does not have"); continue; }
    const [hit, is] = found, a = unwild(hit[1] ?? "");
    when[letter] = date && (is === "greater" || is === "less") ? { is: is === "greater" ? "after" : "before", a: dayText(Number(a)) } : is === "filled" ? { is } : { is, a };
  }
  return { ...(Object.keys(keep).length ? { keep } : {}), ...(Object.keys(when).length ? { when } : {}) };
};
const sheetOf = (path) => { const n = /^xl\/worksheets\/sheet(\d+)\.xml$/.exec(path)?.[1]; return n ? Number(n) - 1 : -1; };
/** A formula as this engine reads it: the prefixes a newer function is stored under are taken off. */
const translated = (formula) => `=${formula.replace(/_xlfn\.|_xlws\.|_xlpm\./g, "")}`;
const kept = (cell) => cell.t === "e" ? ERROR_TEXT[cell.v] ?? "#VALUE!" : cell.t === "b" ? (cell.v ? "TRUE" : "FALSE") : cell.t === "d" ? "" : String(cell.v ?? "");
/** Whether what this engine computed is what the file kept: numbers to nine significant digits, text as it is, any error for any error. */
const same = (value, cell) => {
  if (isError(value)) return cell.t === "e";
  if (cell.t === "n") return typeof value === "number" ? Math.abs(value - cell.v) <= 1e-9 * Math.max(1, Math.abs(value), Math.abs(cell.v)) : value === null && cell.v === 0;
  if (cell.t === "b") return value === cell.v;
  if (cell.t === "s" || cell.t === "str") return (value === null ? "" : String(value)) === String(cell.v ?? "");
  return false;
};

/**
 * @param {Uint8Array} bytes
 * @param {{ tabs?: string[] }} [options] `tabs`: only these, by name
 * @returns {{ tabs: ImportedTab[], report: ImportReport }}
 */
export function importXlsx(bytes, { tabs: only } = {}) {
  let book;
  // sheetStubs: without it a formula whose kept value is empty is left out. cellStyles: column widths and hidden rows and columns come only with it. xlfn: the prefixes stay, so `translated` is the one place they go.
  try { book = XLSX.read(bytes, { type: "array", dense: true, cellFormula: true, cellNF: true, cellText: false, cellHTML: false, cellStyles: true, sheetStubs: true, xlfn: true, bookFiles: true }); }
  catch (error) { throw fault(`That file could not be read as an .xlsx: ${error?.message ?? error}`); }
  const wanted = only?.length ? new Set(only.map((name) => name.toLowerCase())) : null, meta = book.Workbook?.Sheets ?? [];
  const dropped = {}, drop = (what, count = 1) => { if (count) dropped[what] = (dropped[what] ?? 0) + count; };
  const skipped = [], read = [], names = new Set();
  // Each tab's XML part, by the workbook's own list and its links, read for its pane and styles.
  const part = (path) => book.files?.[path]?.content, text = (path) => { const bytes = part(path); return bytes ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).toString("utf8") : ""; };
  const targets = Object.fromEntries((text("xl/_rels/workbook.xml.rels").match(/<Relationship\b[^>]*>/g) ?? []).map((tag) => [attr(tag, "Id"), attr(tag, "Target") ?? ""]));
  const stylesXml = text("xl/styles.xml"), themeXml = text(Object.values(targets).find((target) => /theme\d*\.xml$/.test(target))?.replace(/^\/?(xl\/)?/, "xl/") ?? "");
  const formatsOf = readStyles(stylesXml, themeXml), dxfs = readDxfs(stylesXml, themeXml);
  // The parts a part links to by a relationship of this type (`table`, `drawing`, `chart`…), by their paths in the zip.
  const linked = (from, type) => (text(from.replace(/([^/]+)$/, "_rels/$1.rels")).match(/<Relationship\b[^>]*>/g) ?? []).filter((tag) => (attr(tag, "Type") ?? "").endsWith(`/${type}`))
    .map((tag) => { const target = attr(tag, "Target") ?? ""; return target.startsWith("/") ? target.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(from), target)); });
  const xmlOf = Object.fromEntries((text("xl/workbook.xml").match(/<sheet\b[^>]*>/g) ?? []).map((tag) => { const target = targets[attr(tag, "r:id")] ?? ""; return [attr(tag, "name"), target.startsWith("/") ? target.slice(1) : `xl/${target}`]; }));
  book.SheetNames.forEach((called, index) => {
    const sheet = book.Sheets[called], data = sheet?.["!data"];
    if (!data || (wanted && !wanted.has(called.toLowerCase()))) { skipped.push(called); return; }
    let name = tabName(called), n = 2;
    while (names.has(name.toLowerCase())) name = `${tabName(called).slice(0, 27)} ${n++}`;
    names.add(name.toLowerCase());
    let rows = 0, cols = 0;
    let notes = 0;
    cellsOf(data, (cell, r, c) => { if (cell.f || (cell.t !== "z" && cell.v !== "" && cell.v !== undefined)) { rows = Math.max(rows, r + 1); cols = Math.max(cols, c + 1); } if (cell.c?.length) notes++; });
    // Its charts, each standing on a cell the tab is taken out to, and a merge holding a value (a title over empty columns) to its far corner, by no
    // more empty cells than a tab keeps styles for (a title merged across the whole row is cut at the tab's edge, as before).
    const most = Math.min(SHEET_LIMIT, Math.max(1, rows) * Math.max(1, cols) + STYLES_PER_TAB);
    const grow = (r, c) => { const taller = Math.max(rows, r + 1), wider = Math.max(cols, c + 1); if (wider <= COL_LIMIT && taller * wider <= most) { rows = taller; cols = wider; return true; } return false; };
    const charts = readCharts(xmlOf[called] ?? "", called, text, linked, drop).filter((chart) => { const at = parseA1(chart.at), area = parseRange(chart.range); return grow(at.row, at.col) && grow(area.bottom, area.right) || (drop("charts past the sheet's limits"), false); });
    for (const { s, e } of sheet["!merges"] ?? []) if (s.r < rows && s.c < cols && data[s.r]?.[s.c]?.v !== undefined) grow(e.r, e.c);
    // A validation's cells (the tab holds it on its cells, sheet-types.js): its columns, and its rows as far as the same room lets (a whole column stops at the values).
    for (const one of validationsOf(text(xmlOf[called] ?? ""))) for (const part of one.range.split(/\s+/)) { const area = parseRange(part.replace(/\$/g, "")); if (area && !grow(area.bottom, area.right)) grow(Math.min(area.bottom, rows - 1), area.right); }
    read.push({ called, name, hidden: Boolean(meta[index]?.Hidden), sheet, data, charts, rows: Math.max(1, rows), cols: Math.max(1, cols) });
    drop("notes", notes);
  });
  if (!read.length) throw fault(wanted ? `None of those tabs is in the workbook: its tabs are ${book.SheetNames.join(", ")}` : "That workbook has no tabs with cells");
  const sizes = () => read.map((tab) => `${tab.name} ${tab.rows}x${tab.cols}`).join(", ");
  const large = read.find((tab) => tab.cols > COL_LIMIT || tab.rows * tab.cols > SHEET_LIMIT);
  if (large) throw fault(`The tab ${large.name} is too large for a sheet (${large.rows} rows x ${large.cols} columns; at most ${SHEET_LIMIT} cells a tab). Import some of its tabs (tabs): ${sizes()}`);
  const total = read.reduce((sum, tab) => sum + tab.rows * tab.cols, 0);
  if (total > WORKBOOK_LIMIT) throw fault(`That workbook is too large for a sheet (${total} cells over its tabs; at most ${WORKBOOK_LIMIT}). Import some of its tabs (tabs): ${sizes()}`);
  // The workbook's defined names, each local one by its tab's name here; kept on the first tab's look (`names`) and computed (sheet-engine.js `defineNames`).
  const tabNamed = new Map(read.map((tab) => [tab.called, tab.name]));
  const definedNames = (book.Workbook?.Names ?? []).flatMap((one) => typeof one.Name === "string" && typeof one.Ref === "string" ? [{ name: one.Name, ref: one.Ref, ...(one.Sheet !== undefined && tabNamed.has(book.SheetNames[one.Sheet]) ? { tab: tabNamed.get(book.SheetNames[one.Sheet]) } : {}) }] : []);
  // Read once the workbook fits: a tab grows to take in the empty cells a fill or an edge shows on, while it still fits.
  const shows = formatsOf.map(seen);
  let room = WORKBOOK_LIMIT - total;
  for (const tab of read) {
    // As far as the limits let it, columns first, by no more empty cells than a tab keeps styles for.
    const xml = text(xmlOf[tab.called] ?? ""), styles = sheetStyles(xml, tab, shows), had = tab.rows * tab.cols, most = Math.min(SHEET_LIMIT, room + had, had + STYLES_PER_TAB);
    const cols = Math.max(tab.cols, Math.min(styles.reach.cols, COL_LIMIT, Math.floor(most / tab.rows)));
    const rows = Math.max(tab.rows, Math.min(styles.reach.rows, Math.floor(most / cols)));
    room -= rows * cols - had; Object.assign(tab, { rows, cols });
    Object.assign(tab, { pane: paneOf(xml), styles });
    const ruled = sheetRules(xml, dxfs);
    tab.rules = ruled.rules; tab.rulesKept = ruled.kept;
    for (const [type, count] of Object.entries(ruled.unread)) drop(`conditional formats (${type})`, count);
    tab.validations = validationsOf(xml);
    // A tab's first table, or else its filter, by its range (a table's name and style kept); the criteria a filter was last applied with are not read, the rows it hid are.
    const [table, ...tables] = linked(xmlOf[tab.called] ?? "", "table").map(text).filter((part) => attr(/<table\b[^>]*>/.exec(part)?.[0] ?? "", "ref"));
    if (table) { const head = /<table\b[^>]*>/.exec(table)[0], style = attr(/<tableStyleInfo\b[^>]*>/.exec(table)?.[0] ?? "", "name"); tab.table = { range: attr(head, "ref"), name: attr(head, "displayName") ?? attr(head, "name"), ...(style ? { style } : {}) }; }
    drop("tables after a tab's first", tables.length);
    const filter = /<autoFilter\b[^>]*>/.exec(xml)?.[0];
    // A table's filter is its own part's: its conditions are read from there.
    const filtering = table ? /<autoFilter\b[\s\S]*?(?:\/>|<\/autoFilter>)/.exec(table)?.[0] : /<autoFilter\b[^>]*?(?:\/>|>[\s\S]*?<\/autoFilter>)/.exec(xml)?.[0];
    const dated = (c) => { const cell = tab.data[parseRange(attr(filtering, "ref")).top + 1]?.[c]; return typeof cell?.z === "string" && XLSX.SSF.is_date(cell.z); };
    if (filtering && attr(filtering, "ref")) { const conditions = filterOf(filtering, attr(filtering, "ref"), dated, drop); if (!table || Object.keys(conditions).length) tab.filter = { range: attr(filtering, "ref"), ...conditions }; }
    const color = /<tabColor\b[^>]*>/.exec(xml)?.[0];
    if (color && /^[0-9A-F]{8}$/i.test(attr(color, "rgb") ?? "")) tab.color = `#${attr(color, "rgb").slice(2).toUpperCase()}`; else drop("tab colours from the theme", color ? 1 : 0);
    drop("validation rules (in Excel 2010's form, naming another tab)", xml.match(/<x14:dataValidation\b/g)?.length ?? 0);
  }

  // What is typed in each cell, and where the formulas are. 
  const formulas = [], spilt = [];
  for (const tab of read) {
    tab.typed = Array.from({ length: tab.rows }, () => new Array(tab.cols).fill(null));
    cellsOf(tab.data, (cell, r, c) => {
      if (r >= tab.rows || c >= tab.cols) return;
      // A formula over several cells is not computed: the engine fails to load some of them ("Edge does not exist"), so each of its cells holds its kept value.
      if (cell.f && cell.F?.includes(":")) { spilt.push({ tab, r, c, formula: translated(cell.f) }); tab.typed[r][c] = cell.t === "n" ? cell.v : cell.t === "z" ? null : kept(cell) || null; }
      else if (cell.f) { formulas.push({ tab, r, c, cell, formula: translated(cell.f) }); tab.typed[r][c] = translated(cell.f); }
      else if (cell.t === "n") tab.typed[r][c] = cell.v;
      else if (cell.t !== "z" && kept(cell) !== "") tab.typed[r][c] = cell.t === "s" || cell.t === "str" ? String(cell.v) : kept(cell);
    });
  }
  let engine;
  try { engine = HyperFormula.buildFromSheets(Object.fromEntries(read.map((tab) => [tab.name, tab.typed])), CONFIG, NAMES); }
  catch (error) { throw fault(`That workbook's formulas could not be loaded: ${error?.message ?? error}`); }
  try {
    defineNames(engine, definedNames);
    for (const tab of read) tab.id = engine.getSheetId(tab.name);
    // Text this engine would read as something else (a number, TRUE, a formula) is typed with the mark that keeps it text.
    const marked = [];
    for (const tab of read) cellsOf(tab.data, (cell, r, c) => {
      if (cell.f || (cell.t !== "s" && cell.t !== "str") || r >= tab.rows || c >= tab.cols || cell.v === "" || tab.typed[r][c] === null) return;
      if (engine.getCellValue({ sheet: tab.id, row: r, col: c }) !== cell.v || String(cell.v).startsWith("'")) marked.push([tab, r, c, `'${cell.v}`]);
    });
    if (marked.length) engine.batch(() => { for (const [tab, r, c, text] of marked) { tab.typed[r][c] = text; engine.setCellContents({ sheet: tab.id, row: r, col: c }, text); } });

    // Compared in passes: a formula that reads a wrong one is wrong too, so only the first wrong ones in each chain are frozen, then the rest are computed again.
    const report = { computed: { same: 0, frozen: 0, noCache: 0, volatile: 0 }, frozen: {}, reasons: {} };
    const at = (one) => ({ sheet: one.tab.id, row: one.r, col: one.c }), id = (address) => `${address.sheet}:${address.row}:${address.col}`;
    // Through the ranges that read them too (SUM(C1:C9)), each a dependant of its own.
    const downstream = (from) => {
      const seen = new Set(), queue = from.map(at);
      while (queue.length) for (const next of engine.getCellDependents(queue.pop())) {
        const key = next.start ? `${id(next.start)}-${id(next.end)}` : id(next);
        if (!seen.has(key)) { seen.add(key); queue.push(next); }
      }
      return seen;
    };
    const moving = downstream(formulas.filter((one) => VOLATILE.test(one.formula)));
    for (const one of formulas) if (VOLATILE.test(one.formula)) moving.add(id(at(one)));
    for (const one of spilt) { (report.frozen[one.tab.name] ??= {})[a1(one.r, one.c)] = { formula: one.formula, why: "a formula over several cells", kept: String(one.tab.typed[one.r][one.c] ?? "") }; report.reasons["a formula over several cells"] = (report.reasons["a formula over several cells"] ?? 0) + 1; }
    report.computed.frozen += spilt.length;
    let open = formulas.filter((one) => !moving.has(id(at(one))));
    const freeze = (wrong, gave = wrong.map((one) => engine.getCellValue(at(one)))) => engine.batch(() => {
      for (const [index, one] of wrong.entries()) {
        const value = gave[index], text = kept(one.cell);
        const why = isError(value) ? (value.value === "#NAME?" ? "a function or name this sheet does not have" : value.value === "#ERROR!" ? "a formula this sheet cannot read" : `it gives ${value.value} here`) : `it gives ${valueText(value) || "nothing"} here, ${text || "nothing"} in the file`;
        (report.frozen[one.tab.name] ??= {})[a1(one.r, one.c)] = { formula: one.formula, why, kept: one.cell.t === "s" || one.cell.t === "str" ? `'${one.cell.v}` : text };
        const reason = !why.startsWith("it gives") ? why : isError(value) ? `gives ${value.value}` : "a different value";
        report.reasons[reason] = (report.reasons[reason] ?? 0) + 1;
        const typed = one.cell.t === "n" ? one.cell.v : one.cell.t === "s" || one.cell.t === "str" ? `'${one.cell.v}` : text || null;
        one.tab.typed[one.r][one.c] = typed; one.frozen = true;
        engine.setCellContents(at(one), typed);
      }
      report.computed.frozen += wrong.length;
    });
    for (let pass = 0; pass <= PASSES && open.length; pass += 1) {
      const wrong = open.filter((one) => one.cell.t !== "z" && !same(engine.getCellValue(at(one)), one.cell));
      if (!wrong.length) break;
      const after = pass < PASSES ? downstream(wrong) : new Set(), first = wrong.filter((one) => !after.has(id(at(one))));
      freeze(first.length ? first : wrong);
      open = open.filter((one) => !one.frozen);
    }
    for (const one of formulas) if (!one.frozen) report.computed[moving.has(id(at(one))) ? "volatile" : one.cell.t === "z" ? "noCache" : "same"] += 1;

    const tabs = read.map((tab) => {
      const values = engine.getSheetValues(tab.id), inputs = {}, look = {}, formats = new Map();
      const csv = tab.typed.map((row, r) => row.map((typed, c) => {
        if (typeof typed === "string" && typed.startsWith("=")) { inputs[a1(r, c)] = typed; return valueText(values[r]?.[c]); }
        return typed === null ? "" : String(typed);
      }));
      (tab.sheet["!cols"] ?? []).forEach((col, c) => { if (c >= tab.cols) return; if (col?.width || col?.wpx) look[`width:${colName(c)}`] = Math.round(col.width ? col.width * PX_PER_CHAR : col.wpx); if (col?.hidden) look[`hidden:${colName(c)}`] = 1; });
      (tab.sheet["!rows"] ?? []).forEach((row, r) => { if (r < tab.rows && row?.hidden) look[`hidden:${r + 1}`] = 1; });
      // A number format is kept for a column where most of its numbers share it, and for the cells that differ, up to a count.
      cellsOf(tab.data, (cell, r, c) => { if (cell.t === "n" && r < tab.rows && c < tab.cols) (formats.get(c) ?? formats.set(c, new Map()).get(c)).set(r, typeof cell.z === "string" ? cell.z : "General"); });
      let single = 0;
      for (const [c, column] of formats) {
        const counts = new Map();
        for (const format of column.values()) counts.set(format, (counts.get(format) ?? 0) + 1);
        const [most] = [...counts].sort((a, b) => b[1] - a[1])[0];
        if (most !== "General") look[`fmt:${colName(c)}`] = most;
        for (const [r, format] of column) if (format !== most) { if (single < FORMATS_PER_TAB) { look[`fmt:${a1(r, c)}`] = format; single += 1; } else drop("number formats"); }
      }
      // Each column's and row's own style, and each cell's where it says other than what it would wear from them, up to a count.
      const { cols: colStyles, rows: rowStyles, cells: cellStyles, heights } = tab.styles, worn = new Map(), attrs = (index) => worn.get(index) ?? worn.set(index, decodeStyle(formatsOf[index] ?? "")).get(index);
      for (const [c, index] of colStyles) if (formatsOf[index]) { if (c < tab.cols) look[`style:${colName(c)}`] = formatsOf[index]; else if (shows[index] && !tab.styles.wide.has(c)) drop("column styles past the tab's edge"); }
      for (const [r, index] of rowStyles) if (formatsOf[index]) { if (r < tab.rows) look[`style:${r + 1}`] = formatsOf[index]; else if (shows[index]) drop("row styles past the tab's edge"); }
      let styled = 0;
      for (const [r, height] of heights) if (r < tab.rows) look[`height:${r + 1}`] = Math.round(height / PT_PER_PX);
      for (const [r, c, index] of cellStyles) {
        if (r >= tab.rows || c >= tab.cols) { drop("styled cells past the tab's last value"); continue; }
        const under = { ...attrs(colStyles.get(c)), ...attrs(rowStyles.get(r)) }, own = encodeStyle(ownOver(under, attrs(index)));
        if (!own) continue;
        if (styled < STYLES_PER_TAB) { look[`style:${a1(r, c)}`] = own; styled += 1; } else drop("cell styles");
      }
      // Each hyperlink by its cell (`link:<rowId>:<colId>`): its address, or `#Tab!A1` for a place in the workbook.
      cellsOf(tab.data, (cell, r, c) => { if (typeof cell.l?.Target === "string") { if (r < tab.rows && c < tab.cols) { look[`link:${a1(r, c)}`] = cell.l.Target; } else drop("hyperlinks past the tab's last value"); } });
      // Merged ranges inside the tab, a lone cell being none.
      // A merge reaching past the tab's last value is cut at its edge; one left a single cell is dropped.
      const merges = (tab.sheet["!merges"] ?? []).map(({ s, e }) => ({ s, e: { r: Math.min(e.r, tab.rows - 1), c: Math.min(e.c, tab.cols - 1) } })).filter(({ s, e }) => e.r >= s.r && e.c >= s.c && (e.r > s.r || e.c > s.c));
      drop("merged ranges past the tab's last value", (tab.sheet["!merges"]?.length ?? 0) - merges.length);
      if (merges.length) look.merges = merges.map((range) => XLSX.utils.encode_range(range));
      if (tab.rules.length) look.rules = tab.rules;
      if (tab.rulesKept.length) look.rulesKept = tab.rulesKept;
      if (tab.validations.length) look.validations = tab.validations;
      if (tab.color) look.tabColor = tab.color;
      if (tab.charts.length) look.charts = tab.charts;
      if (tab.table) look.table = tab.table;
      if (tab.filter) look.filter = tab.filter;
      // A frozen formula goes with its cell (`excel:<rowId>:<colId>` once in the doc), written for the cell it was in (`anchor`), as a rule's are.
      for (const [at, one] of Object.entries(report.frozen[tab.name] ?? {})) if (!one.why.startsWith("a formula over")) look[`excel:${at}`] = { formula: one.formula, value: one.kept, anchor: at };
      if (tab === read[0] && definedNames.length) look.names = definedNames;
      if (tab.pane?.rows) look.freezeRows = tab.pane.rows;
      if (tab.pane?.cols) look.freezeCols = tab.pane.cols;
      return { name: tab.name, hidden: tab.hidden, csv: toCsv(csv), inputs, look, rows: tab.rows, cols: tab.cols, formulas: Object.keys(inputs).length };
    });
    return { tabs, report: { tabs: tabs.map(({ name, rows, cols, formulas: count }) => ({ name, rows, cols, formulas: count })), skipped, ...report, dropped } };
  } finally { engine.destroy(); }
}

/** A report in words: what came across, what was frozen and why, what was left out. */
export function importSummary(report) {
  const { same, frozen, noCache, volatile } = report.computed, total = same + frozen + noCache + volatile, listed = Object.entries(report.frozen).flatMap(([tab, cells]) => Object.entries(cells).map(([at, one]) => `${tab}!${at} ${one.formula} (${one.why})`));
  return [
    `Tabs: ${report.tabs.map((tab) => `${tab.name} (${tab.rows}x${tab.cols}, ${tab.formulas} formulas)`).join(", ")}.${report.skipped.length ? ` Not imported: ${report.skipped.join(", ")}.` : ""}`,
    total ? `Of ${total} formulas, ${same + noCache + volatile} compute here as they did${volatile ? ` (${volatile} depend on the date or a random number and were not compared)` : ""}${frozen ? `; ${frozen} do not and hold the value the file kept, as plain values: ${Object.entries(report.reasons).map(([why, count]) => `${count} ${why}`).join(", ")}` : ""}.` : "It has no formulas.",
    ...(listed.length ? [`Frozen: ${listed.slice(0, 20).join("; ")}${listed.length > 20 ? `; and ${listed.length - 20} more (GET /v0/document/<id>?as=import lists all)` : ""}.`] : []),
    ...(Object.keys(report.dropped).length ? [`Left out: ${Object.entries(report.dropped).map(([what, count]) => `${count} ${what}`).join(", ")}; also any pivot tables, which are not read.`] : ["Pivot tables are not read."]),
  ].join("\n");
}
// Functions an .xlsx stores under a prefix: without it a spreadsheet shows #NAME? until the cell is entered again.
const PREFIXED = new Set("STDEV.S STDEV.P VAR.S VAR.P COVARIANCE.S COVARIANCE.P FLOOR.MATH CEILING.MATH CEILING.PRECISE FLOOR.PRECISE ISO.CEILING IFS SWITCH MAXIFS MINIFS CONCAT TEXTJOIN XLOOKUP XMATCH IFNA XOR RANK.EQ RANK.AVG PERCENTILE.INC PERCENTILE.EXC PERCENTRANK.INC PERCENTRANK.EXC QUARTILE.INC QUARTILE.EXC MODE.SNGL MODE.MULT NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T T.TEST CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST Z.TEST BINOM.DIST BINOM.DIST.RANGE BINOM.INV NEGBINOM.DIST POISSON.DIST EXPON.DIST GAMMA.DIST GAMMA.INV BETA.DIST BETA.INV WEIBULL.DIST LOGNORM.DIST LOGNORM.INV HYPGEOM.DIST CONFIDENCE.NORM CONFIDENCE.T NETWORKDAYS.INTL WORKDAY.INTL DAYS ISOWEEKNUM NUMBERVALUE FORECAST.LINEAR UNICHAR UNICODE BITAND BITOR BITXOR BITLSHIFT BITRSHIFT SHEET SHEETS FORMULATEXT ISFORMULA PERMUTATIONA GAMMA GAUSS PHI SEC CSC COT SECH CSCH COTH ACOT ACOTH ARABIC BASE DECIMAL COMBINA MUNIT SKEW.P AGGREGATE ERF.PRECISE ERFC.PRECISE GAMMALN.PRECISE UNIQUE SEQUENCE RANDARRAY SORTBY TAKE DROP CHOOSECOLS CHOOSEROWS EXPAND VSTACK HSTACK TEXTBEFORE TEXTAFTER".split(" "));
const SCOPED = new Set(["FILTER", "SORT"]);
const stored = (formula) => formula.slice(1).split(/("(?:[^"]|"")*")/).map((part, nth) => nth % 2 ? part : part.replace(/([A-Za-z][A-Za-z0-9.]*)\(/g, (all, name) => PREFIXED.has(name.toUpperCase()) ? `_xlfn.${all}` : SCOPED.has(name.toUpperCase()) ? `_xlfn._xlws.${all}` : all)).join("");
// A reference to a tab the workbook no longer has is #REF!, as a spreadsheet makes it when the tab is deleted: a file naming a missing tab is one to repair.
const TAB_REF = /(?<![#\p{L}\p{N}_.'])('(?:[^']|'')+'|[\p{L}_][\p{L}\p{N}_.]*)!(?:\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?|\$?[A-Z]{1,3}:\$?[A-Z]{1,3}|\$?\d+:\$?\d+)/gu;
// A frozen formula reading a table or another workbook (`[`) is written as its value: the export has neither part.
const outside = (formula) => formula.replace(/"(?:[^"]|"")*"/g, "");
const orphaned = (formula, known) => formula.split(/("(?:[^"]|"")*")/).map((part, nth) => nth % 2 ? part : part.replace(TAB_REF, (all, tab) => known.has((tab.startsWith("'") ? tab.slice(1, -1).replace(/''/g, "'") : tab).toLowerCase()) ? all : "#REF!")).join("");
const ERROR_CODE = Object.fromEntries(Object.entries(ERROR_TEXT).map(([code, text]) => [text, Number(code)]));
/**
 * A workbook written as an .xlsx: each formula with the value it computes here, number formats, column widths, row heights, hidden rows and columns, frozen panes and hidden tabs. A cell an import
 * froze (`excel:` in its look) gets its formula back while it holds what the import left in it, moved as a fill moves it from its `anchor` (where a
 * sort took it; a row or column change rewrites the formula itself, sheets.js). Styles are written into the parts SheetJS wrote (xlsx-styles.js).
 * @param {{ name: string, hidden: boolean, typed: string[][], values: unknown[][], look: Record<string, unknown> }[]} tabs  `values`: what each cell computes
 * @returns {Buffer}
 */
export function exportXlsx(tabs) {
  const book = XLSX.utils.book_new(), known = new Set(tabs.map((tab) => tab.name.toLowerCase()));
  let tables = 0;
  const tableNames = new Set();
  for (const tab of tabs) {
    const sheet = {}, cols = Math.max(1, ...tab.typed.map((row) => row.length));
    tab.typed.forEach((row, r) => row.forEach((typed, c) => {
      if (!typed) return;
      const at = a1(r, c), held = tab.look[`excel:${at}`], from = parseA1(String(held?.anchor ?? "")), value = tab.values[r]?.[c];
      const formula = typed.startsWith("=") ? typed : from && held.value === typed && typeof held.formula === "string" && !outside(held.formula).includes("[") ? shiftRefs(held.formula, r - from.row, c - from.col) : null;
      const cell = isError(value) ? { t: "e", v: ERROR_CODE[value.value] ?? 15, w: value.value } : typeof value === "number" ? { t: "n", v: value } : typeof value === "boolean" ? { t: "b", v: value } : { t: "s", v: String(value ?? "") };
      if (cell.t === "s" && cell.v === "" && !formula) return;
      if (formula) cell.f = stored(orphaned(formula, known));
      const format = tab.look[`fmt:${at}`] ?? tab.look[`fmt:${colName(c)}`];
      if (cell.t === "n" && typeof format === "string" && format !== "General") cell.z = format;
      const link = tab.look[`link:${at}`];
      if (typeof link === "string" && link) cell.l = { Target: link };
      sheet[at] = cell;
    }));
    sheet["!ref"] = `A1:${a1(Math.max(0, tab.typed.length - 1), cols - 1)}`;
    // A column without its own width takes the tab's default (`width` alone), where it has one.
    sheet["!cols"] = Array.from({ length: cols }, (_, c) => { const width = tab.look[`width:${colName(c)}`] ?? tab.look.width; return { ...(typeof width === "number" ? { width: width / PX_PER_CHAR } : {}), ...(tab.look[`hidden:${colName(c)}`] ? { hidden: true } : {}) }; });
    // Each row's height where it has its own, in points (SheetJS writes pixels as points), and the rows hidden.
    // The rows hidden, and those the filter hid when last applied.
    const filteredOut = new Set(tab.look.filter?.hide ?? []);
    sheet["!rows"] = tab.typed.map((_, r) => { const height = tab.look[`height:${r + 1}`]; return { ...(typeof height === "number" ? { hpt: height * PT_PER_PX } : {}), ...(tab.look[`hidden:${r + 1}`] || filteredOut.has(r + 1) ? { hidden: true } : {}) }; });
    // A table is its own part (xlsx-parts.js); one Excel would repair is written as its filter alone.
    // The table's part holds its own filter: a sheet's filter over it is one Excel repairs.
    tab.tablePart = tab.look.table ? tablePart(tab.look.table, tab.values, ++tables, tableNames, filterColumns(tab.look.filter?.range === tab.look.table.range ? tab.look.filter : null)) : null;
    const filtered = tab.tablePart ? undefined : tab.look.filter?.range ?? tab.look.table?.range;
    if (typeof filtered === "string") sheet["!autofilter"] = { ref: filtered };
    if (Array.isArray(tab.look.merges)) sheet["!merges"] = tab.look.merges.map((range) => XLSX.utils.decode_range(String(range)));
    XLSX.utils.book_append_sheet(book, sheet, tab.name);
  }
  const at = new Map(tabs.map((tab, n) => [tab.name.toLowerCase(), n]));
  const names = tabs.flatMap((tab) => Array.isArray(tab.look.names) ? tab.look.names : []).filter((one) => typeof one?.name === "string" && typeof one.ref === "string" && (one.tab === undefined || at.has(String(one.tab).toLowerCase())));
  book.Workbook = { Sheets: tabs.map((tab) => ({ Hidden: tab.hidden ? 1 : 0 })), ...(names.length ? { Names: names.map((one) => ({ Name: one.name, Ref: one.ref, ...(one.tab === undefined ? {} : { Sheet: at.get(String(one.tab).toLowerCase()) }) })) } : {}) };
  const written = XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true }), count = (value) => typeof value === "number" && value > 0 ? value : 0;
  const panes = tabs.map((tab) => [count(tab.look.freezeRows), count(tab.look.freezeCols)]), styled = tabs.some((tab) => Object.keys(tab.look).some((name) => name.startsWith("style:")));
  const ruled = tabs.some((tab) => ["rules", "rulesKept"].some((name) => Array.isArray(tab.look[name]) && tab.look[name].length)), rules = ruled ? writeRules(tabs.map((tab) => tab.look.rules), (formula) => stored(orphaned(`=${formula}`, known)), tabs.map((tab) => tab.look.rulesKept)) : null;
  const validations = tabs.map((tab) => validationsXml(tab.look.validations)), inked = tabs.map((tab) => inksXml(tab.look.validations));
  // A tab's colour (`tabColor`): #RRGGBB as imported, or an ink the page set, written as its hex.
  const conditions = tabs.map((tab) => tab.tablePart ? "" : filterColumns(tab.look.filter));
  const colors = tabs.map((tab) => { const color = String(tab.look.tabColor ?? ""); return /^#[0-9A-F]{6}$/i.test(color) || SHEET_INKS.includes(color) ? `<tabColor rgb="FF${rgbOf(color)}"/>` : ""; });
  let drawings = 0, charts = 1;
  const parts = tabs.map((tab) => { const drawing = Array.isArray(tab.look.charts) ? drawingPart(tab.look.charts, tab.name, drawings + 1, charts) : null; if (drawing) { drawings += 1; charts += drawing.count; } return [tab.tablePart, drawing].filter(Boolean); });
  if (!styled && !ruled && !panes.some(([rows, cols]) => rows || cols) && !validations.some(Boolean) && !inked.some(Boolean) && !colors.some(Boolean) && !conditions.some(Boolean)) return withParts(written, parts, placed);
  let restyled = null;
  return withParts(editParts(written, (path, xml, all) => {
    if (styled && !restyled) {
      const sheets = tabs.map((tab, n) => ({ xml: all[`xl/worksheets/sheet${n + 1}.xml`] ?? "", ...styleOf(tab.look), size: { rows: tab.typed.length, cols: Math.max(1, ...tab.typed.map((row) => row.length)) } }));
      restyled = writeStyles(all["xl/styles.xml"] ?? "", sheets);
    }
    if (path === "xl/styles.xml") return rules ? withDxfs(restyled?.styles ?? xml, rules.dxfs) : restyled?.styles ?? xml;
    const n = sheetOf(path), [rows, cols] = panes[n] ?? [0, 0], sheet = withRules(n >= 0 && restyled ? restyled.sheets[n] : xml, rules?.sheets[n]);
    const valid = [[validations[n], (xml) => placed(xml, "dataValidations", validations[n])], [colors[n], (xml) => /<sheetPr\b/.test(xml) ? xml.replace(/<sheetPr\b([^>]*?)(\/?)>/, (_, head, closed) => `<sheetPr${head}>${colors[n]}${closed ? "</sheetPr>" : ""}`) : placed(xml, "sheetPr", `<sheetPr>${colors[n]}</sheetPr>`)]]
      .concat([[inked[n], (xml) => /<extLst>/.test(xml) ? xml.replace("</extLst>", `${inked[n]}</extLst>`) : placed(xml, "extLst", `<extLst>${inked[n]}</extLst>`)], [conditions[n], (xml) => xml.replace(/<autoFilter ref="([^"]*)"\/>/, (_, ref) => `<autoFilter ref="${ref}">${conditions[n]}</autoFilter>`)]])
      .reduce((xml, [has, put]) => n >= 0 && has ? put(xml) : xml, sheet);
    return rows || cols ? valid.replace(/<sheetView workbookViewId="0"\/>/, paneXml(rows, cols)) : valid;
  }), parts, placed);
}
/** The style each cell of a tab wears, packed (empty for none), from its look by letter, row number and address: its own over its row's over its column's; and each line's own. */
const styleOf = (look) => {
  const cols = new Map(), rows = new Map(), cells = new Map(), made = new Map();
  const worn = (...parts) => encodeStyle(Object.fromEntries(Object.entries(Object.assign({}, ...parts.map(decodeStyle))).filter(([, value]) => value !== false && value !== null)));
  for (const [name, value] of Object.entries(look)) {
    const at = /^style:(?:([A-Z]+)|(\d+)|([A-Z]+\d+))$/.exec(name);
    if (at && typeof value === "string") (at[1] ? cols.set(colIndex(at[1]), value) : at[2] ? rows.set(Number(at[2]) - 1, value) : cells.set(at[3], value));
  }
  const own = (lines) => new Map([...lines].map(([at, value]) => [at, worn(value)]).filter(([, packed]) => packed));
  const styleAt = (r, c) => {
    const parts = [cols.get(c) ?? "", rows.get(r) ?? "", cells.size ? cells.get(a1(r, c)) ?? "" : ""], id = parts.join("|");
    if (id === "||") return "";
    if (!made.has(id)) made.set(id, worn(...parts));
    return made.get(id);
  };
  return { styleAt, cols: own(cols), rows: own(rows) };
};
const IMPORT_MS = 180_000, IMPORT_HEAP_MB = 2048;
/** `importXlsx` on a thread of its own, so the hub answers while a large workbook computes; it is ended after three minutes. */
export function importXlsxApart(bytes, options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { xlsx: bytes, options }, resourceLimits: { maxOldGenerationSizeMb: IMPORT_HEAP_MB } });
    const late = setTimeout(() => { void worker.terminate(); reject(fault("That workbook took more than three minutes to compute. Import some of its tabs (tabs)")); }, IMPORT_MS);
    worker.once("message", ({ result, error }) => { clearTimeout(late); if (error) reject(Object.assign(new Error(error.message), { status: error.status })); else resolve(result); });
    worker.once("error", (error) => { clearTimeout(late); reject(error.code === "ERR_WORKER_OUT_OF_MEMORY" ? fault("That workbook needs more memory than an import is given. Import some of its tabs (tabs)") : error); });
  });
}
if (!isMainThread && workerData?.xlsx) {
  try { parentPort.postMessage({ result: importXlsx(workerData.xlsx, workerData.options) }); }
  catch (error) { parentPort.postMessage({ error: { message: String(error?.message ?? error), status: error?.status } }); }
}
