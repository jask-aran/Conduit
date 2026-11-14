import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { HyperFormula } from "hyperformula";
import * as XLSX from "xlsx";
import { COL_LIMIT, CONFIG, SHEET_LIMIT, WORKBOOK_LIMIT, a1, colName, tabName, toCsv, valueText } from "../sheet-format.js";
import { NAMES } from "../sheet-functions.js";

/*
 * An .xlsx read as a workbook's files (docs/plans/sheet-xlsx-and-tabs.md): each tab's CSV of values, its formulas by address and its look, as
 * sheets.js reads a workbook folder, and a report of what did not come across. Every formula is computed here and held against the value the
 * .xlsx kept for it: one that computes something else, or cannot be computed, is frozen (its cell holds the kept value; the report keeps the
 * formula). Pure and slow for a large file: the hub runs it off its main thread.
 */
/** @typedef {{ name: string, hidden: boolean, csv: string, inputs: Record<string, string>, look: Record<string, unknown>, rows: number, cols: number, formulas: number }} ImportedTab */
/** @typedef {{ tabs: { name: string, rows: number, cols: number, formulas: number }[], skipped: string[], computed: { same: number, frozen: number, noCache: number, volatile: number }, frozen: Record<string, Record<string, { formula: string, why: string, kept?: string }>>, reasons: Record<string, number>, dropped: Record<string, number> }} ImportReport */

const VOLATILE = /\b(?:TODAY|NOW|RAND|RANDBETWEEN|RANDARRAY)\s*\(/i, FORMATS_PER_TAB = 2000, PASSES = 4;
const ERROR_TEXT = { 0: "#NULL!", 7: "#DIV/0!", 15: "#VALUE!", 23: "#REF!", 29: "#NAME?", 36: "#NUM!", 42: "#N/A", 43: "#GETTING_DATA" };
const fault = (message) => Object.assign(new Error(message), { status: 422 });
const isError = (value) => value !== null && typeof value === "object";
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
  // sheetStubs: without it a formula whose kept value is empty is left out. cellStyles: column widths and hidden rows come only with it. xlfn: the prefixes stay, so `translated` is the one place they go.
  try { book = XLSX.read(bytes, { type: "array", dense: true, cellFormula: true, cellNF: true, cellText: false, cellHTML: false, cellStyles: true, sheetStubs: true, xlfn: true }); }
  catch (error) { throw fault(`That file could not be read as an .xlsx: ${error?.message ?? error}`); }
  const wanted = only?.length ? new Set(only.map((name) => name.toLowerCase())) : null, meta = book.Workbook?.Sheets ?? [];
  const dropped = {}, drop = (what, count = 1) => { if (count) dropped[what] = (dropped[what] ?? 0) + count; };
  const skipped = [], read = [], names = new Set();
  book.SheetNames.forEach((called, index) => {
    const sheet = book.Sheets[called], data = sheet?.["!data"];
    if (!data || (wanted && !wanted.has(called.toLowerCase()))) { skipped.push(called); return; }
    let name = tabName(called), n = 2;
    while (names.has(name.toLowerCase())) name = `${tabName(called).slice(0, 27)} ${n++}`;
    names.add(name.toLowerCase());
    let rows = 0, cols = 0;
    data.forEach((row, r) => row?.forEach((cell, c) => { if (cell && (cell.f || (cell.t !== "z" && cell.v !== "" && cell.v !== undefined))) { rows = Math.max(rows, r + 1); cols = Math.max(cols, c + 1); } }));
    read.push({ called, name, hidden: Boolean(meta[index]?.Hidden), sheet, data, rows: Math.max(1, rows), cols: Math.max(1, cols) });
    drop("merged ranges", sheet["!merges"]?.length ?? 0);
    drop("hidden rows", sheet["!rows"]?.filter((row) => row?.hidden).length ?? 0);
    drop("hidden columns", sheet["!cols"]?.filter((col) => col?.hidden).length ?? 0);
  });
  if (!read.length) throw fault(wanted ? `None of those tabs is in the workbook: its tabs are ${book.SheetNames.join(", ")}` : "That workbook has no tabs with cells");
  const sizes = () => read.map((tab) => `${tab.name} ${tab.rows}x${tab.cols}`).join(", ");
  const large = read.find((tab) => tab.cols > COL_LIMIT || tab.rows * tab.cols > SHEET_LIMIT);
  if (large) throw fault(`The tab ${large.name} is too large for a sheet (${large.rows} rows x ${large.cols} columns; at most ${SHEET_LIMIT} cells a tab). Import some of its tabs (tabs): ${sizes()}`);
  const total = read.reduce((sum, tab) => sum + tab.rows * tab.cols, 0);
  if (total > WORKBOOK_LIMIT) throw fault(`That workbook is too large for a sheet (${total} cells over its tabs; at most ${WORKBOOK_LIMIT}). Import some of its tabs (tabs): ${sizes()}`);
  drop("defined names", (book.Workbook?.Names ?? []).filter((name) => !name.Name.startsWith("_xlnm.")).length);

  // What is typed in each cell, and where the formulas are. 
  const formulas = [], spilt = [];
  for (const tab of read) {
    tab.typed = Array.from({ length: tab.rows }, () => new Array(tab.cols).fill(null));
    tab.data.forEach((row, r) => row?.forEach((cell, c) => {
      if (!cell || r >= tab.rows || c >= tab.cols) return;
      // A formula over several cells is not computed: the engine fails to load some of them ("Edge does not exist"), so each of its cells holds its kept value.
      if (cell.f && cell.F?.includes(":")) { spilt.push({ tab, r, c, formula: translated(cell.f) }); tab.typed[r][c] = cell.t === "n" ? cell.v : cell.t === "z" ? null : kept(cell) || null; }
      else if (cell.f) { formulas.push({ tab, r, c, cell, formula: translated(cell.f) }); tab.typed[r][c] = translated(cell.f); }
      else if (cell.t === "n") tab.typed[r][c] = cell.v;
      else if (cell.t !== "z" && kept(cell) !== "") tab.typed[r][c] = cell.t === "s" || cell.t === "str" ? String(cell.v) : kept(cell);
    }));
  }
  let engine;
  try { engine = HyperFormula.buildFromSheets(Object.fromEntries(read.map((tab) => [tab.name, tab.typed])), CONFIG, NAMES); }
  catch (error) { throw fault(`That workbook's formulas could not be loaded: ${error?.message ?? error}`); }
  try {
    for (const tab of read) tab.id = engine.getSheetId(tab.name);
    // Text this engine would read as something else (a number, TRUE, a formula) is typed with the mark that keeps it text.
    const marked = [];
    for (const tab of read) tab.data.forEach((row, r) => row?.forEach((cell, c) => {
      if (!cell || cell.f || (cell.t !== "s" && cell.t !== "str") || r >= tab.rows || c >= tab.cols || cell.v === "" || tab.typed[r][c] === null) return;
      if (engine.getCellValue({ sheet: tab.id, row: r, col: c }) !== cell.v || String(cell.v).startsWith("'")) marked.push([tab, r, c, `'${cell.v}`]);
    }));
    if (marked.length) engine.batch(() => { for (const [tab, r, c, text] of marked) { tab.typed[r][c] = text; engine.setCellContents({ sheet: tab.id, row: r, col: c }, text); } });

    // Compared in passes: a formula that reads a wrong one is wrong too, so only the first wrong ones in each chain are frozen, then the rest are computed again.
    const report = { computed: { same: 0, frozen: 0, noCache: 0, volatile: 0 }, frozen: {}, reasons: {} };
    const at = (one) => ({ sheet: one.tab.id, row: one.r, col: one.c }), id = (address) => `${address.sheet}:${address.row}:${address.col}`;
    const downstream = (from) => {
      const seen = new Set(), queue = from.map(at);
      while (queue.length) for (const next of engine.getCellDependents(queue.pop())) {
        if (next.start) continue;
        const key = id(next);
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
        const why = isError(value) ? (value.value === "#NAME?" ? "a function or name this sheet does not have" : `it gives ${value.value} here`) : `it gives ${valueText(value) || "nothing"} here, ${text || "nothing"} in the file`;
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
      (tab.sheet["!cols"] ?? []).forEach((col, c) => { if (c < tab.cols && col?.wpx) look[`width:${colName(c)}`] = Math.round(col.wpx); });
      // A number format is kept for a column where most of its numbers share it, and for the cells that differ, up to a count.
      tab.data.forEach((row, r) => row?.forEach((cell, c) => { if (cell?.t === "n" && r < tab.rows && c < tab.cols) (formats.get(c) ?? formats.set(c, new Map()).get(c)).set(r, typeof cell.z === "string" ? cell.z : "General"); }));
      let single = 0;
      for (const [c, column] of formats) {
        const counts = new Map();
        for (const format of column.values()) counts.set(format, (counts.get(format) ?? 0) + 1);
        const [most] = [...counts].sort((a, b) => b[1] - a[1])[0];
        if (most !== "General") look[`fmt:${colName(c)}`] = most;
        for (const [r, format] of column) if (format !== most) { if (single < FORMATS_PER_TAB) { look[`fmt:${a1(r, c)}`] = format; single += 1; } else drop("number formats"); }
      }
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
    ...(Object.keys(report.dropped).length ? [`Left out: ${Object.entries(report.dropped).map(([what, count]) => `${count} ${what}`).join(", ")}; also any charts, fills, borders, fonts, validation, conditional formats and notes, which are not read.`] : ["Charts, fills, borders, fonts, validation, conditional formats and notes are not read."]),
  ].join("\n");
}
// Functions an .xlsx stores under a prefix: without it a spreadsheet shows #NAME? until the cell is entered again.
const PREFIXED = new Set("STDEV.S STDEV.P VAR.S VAR.P COVARIANCE.S COVARIANCE.P FLOOR.MATH CEILING.MATH CEILING.PRECISE FLOOR.PRECISE ISO.CEILING IFS SWITCH MAXIFS MINIFS CONCAT TEXTJOIN XLOOKUP XMATCH IFNA XOR RANK.EQ RANK.AVG PERCENTILE.INC PERCENTILE.EXC PERCENTRANK.INC PERCENTRANK.EXC QUARTILE.INC QUARTILE.EXC MODE.SNGL MODE.MULT NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV T.DIST T.DIST.2T T.DIST.RT T.INV T.INV.2T T.TEST CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST Z.TEST BINOM.DIST BINOM.DIST.RANGE BINOM.INV NEGBINOM.DIST POISSON.DIST EXPON.DIST GAMMA.DIST GAMMA.INV BETA.DIST BETA.INV WEIBULL.DIST LOGNORM.DIST LOGNORM.INV HYPGEOM.DIST CONFIDENCE.NORM CONFIDENCE.T NETWORKDAYS.INTL WORKDAY.INTL DAYS ISOWEEKNUM NUMBERVALUE FORECAST.LINEAR UNICHAR UNICODE BITAND BITOR BITXOR BITLSHIFT BITRSHIFT SHEET SHEETS FORMULATEXT ISFORMULA PERMUTATIONA GAMMA GAUSS PHI SEC CSC COT SECH CSCH COTH ACOT ACOTH ARABIC BASE DECIMAL COMBINA MUNIT SKEW.P AGGREGATE ERF.PRECISE ERFC.PRECISE GAMMALN.PRECISE UNIQUE SEQUENCE RANDARRAY SORTBY TAKE DROP CHOOSECOLS CHOOSEROWS EXPAND".split(" "));
const SCOPED = new Set(["FILTER", "SORT"]);
const stored = (formula) => formula.slice(1).split(/("(?:[^"]|"")*")/).map((part, nth) => nth % 2 ? part : part.replace(/([A-Za-z][A-Za-z0-9.]*)\(/g, (all, name) => PREFIXED.has(name.toUpperCase()) ? `_xlfn.${all}` : SCOPED.has(name.toUpperCase()) ? `_xlfn._xlws.${all}` : all)).join("");
const ERROR_CODE = Object.fromEntries(Object.entries(ERROR_TEXT).map(([code, text]) => [text, Number(code)]));
/**
 * A workbook written as an .xlsx: each formula with the value it computes here, number formats, column widths and hidden tabs. A cell an import
 * froze gets its formula back where it still holds what the import left in it. No fills, fonts or borders are written.
 * @param {{ name: string, hidden: boolean, typed: string[][], values: unknown[][], look: Record<string, unknown> }[]} tabs  `values`: what each cell computes
 * @param {ImportReport | null} [imported]
 * @returns {Buffer}
 */
export function exportXlsx(tabs, imported) {
  const book = XLSX.utils.book_new();
  for (const tab of tabs) {
    const frozen = imported?.frozen?.[tab.name] ?? {}, sheet = {}, cols = Math.max(1, ...tab.typed.map((row) => row.length));
    tab.typed.forEach((row, r) => row.forEach((typed, c) => {
      if (!typed) return;
      const at = a1(r, c), was = frozen[at], formula = typed.startsWith("=") ? typed : was?.kept === typed && !was.why.startsWith("a formula over") ? was.formula : null, value = tab.values[r]?.[c];
      const cell = isError(value) ? { t: "e", v: ERROR_CODE[value.value] ?? 15, w: value.value } : typeof value === "number" ? { t: "n", v: value } : typeof value === "boolean" ? { t: "b", v: value } : { t: "s", v: String(value ?? "") };
      if (cell.t === "s" && cell.v === "" && !formula) return;
      if (formula) cell.f = stored(formula);
      const format = tab.look[`fmt:${at}`] ?? tab.look[`fmt:${colName(c)}`];
      if (cell.t === "n" && typeof format === "string" && format !== "General") cell.z = format;
      sheet[at] = cell;
    }));
    sheet["!ref"] = `A1:${a1(Math.max(0, tab.typed.length - 1), cols - 1)}`;
    sheet["!cols"] = Array.from({ length: cols }, (_, c) => typeof tab.look[`width:${colName(c)}`] === "number" ? { wpx: tab.look[`width:${colName(c)}`] } : {});
    XLSX.utils.book_append_sheet(book, sheet, tab.name);
  }
  book.Workbook = { Sheets: tabs.map((tab) => ({ Hidden: tab.hidden ? 1 : 0 })) };
  return XLSX.write(book, { type: "buffer", bookType: "xlsx", compression: true });
}
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
