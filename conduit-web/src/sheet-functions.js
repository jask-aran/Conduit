import * as formulajs from "@formulajs/formulajs";
import { format as formatted } from "numfmt";
import { CellError, EmptyValue, ErrorType, FunctionArgumentType, FunctionPlugin, HyperFormula, SimpleRangeValue } from "hyperformula";

/*
 * Functions a spreadsheet's workbooks use that the engine lacks, registered for every engine once this module is loaded (sheet-format.js imports it,
 * so the hub and the page compute the same values).
 */
const { NUMBER, RANGE, NOERROR, ANY, SCALAR, STRING } = FunctionArgumentType;
const number = (value) => typeof value === "number" ? value : typeof value?.val === "number" ? value.val : undefined;
const RANKED = { parameters: [{ argumentType: NUMBER }, { argumentType: RANGE }, { argumentType: NUMBER, defaultValue: 0 }] };
const Sum = (sum, count) => ({ sum, count });
// SUMIFS's own plugin, so AVERAGEIFS takes the same criteria, wildcards and per-range cache.
class SpreadsheetGaps extends HyperFormula.getFunctionPlugin("SUMIFS") {
  /** 1 + how many numbers in the range beat `n` (largest first unless `order` is not 0); text, booleans and blanks are skipped, an error is returned. */
  ranked(ast, state, name, average) {
    return this.runFunction(ast.args, state, this.metadata(name), (n, range, order) => {
      let beat = 0, ties = 0;
      for (const cell of range.valuesFromTopLeftCorner()) {
        if (cell instanceof CellError) return cell;
        const value = number(cell);
        if (value === undefined) continue;
        if (value === n) ties++; else if (order ? value < n : value > n) beat++;
      }
      return ties ? 1 + beat + (average ? (ties - 1) / 2 : 0) : new CellError(ErrorType.NA);
    });
  }
  rank(ast, state) { return this.ranked(ast, state, "RANK", false); }
  rankeq(ast, state) { return this.ranked(ast, state, "RANK.EQ", false); }
  rankavg(ast, state) { return this.ranked(ast, state, "RANK.AVG", true); }
  /** Only numbers in the average range count; an error there in a matching row is the result. */
  averageifs(ast, state) {
    return this.runFunction(ast.args, state, this.metadata("AVERAGEIFS"), (values, ...conditions) => {
      const total = this.computeConditionalAggregationFunction(values, conditions, "AVERAGEIFS", Sum(0, 0),
        (left, right) => left instanceof CellError ? left : right instanceof CellError ? right : Sum(left.sum + right.sum, left.count + right.count),
        (cell) => cell instanceof CellError ? cell : number(cell) === undefined ? Sum(0, 0) : Sum(number(cell), 1));
      return total instanceof CellError ? total : total.count ? total.sum / total.count : new CellError(ErrorType.DIV_BY_ZERO);
    });
  }
}
SpreadsheetGaps.implementedFunctions = {
  RANK: { method: "rank", ...RANKED }, "RANK.EQ": { method: "rankeq", ...RANKED }, "RANK.AVG": { method: "rankavg", ...RANKED },
  AVERAGEIFS: { method: "averageifs", parameters: [{ argumentType: RANGE }, { argumentType: RANGE }, { argumentType: NOERROR }], repeatLastArgs: 2 },
};
const names = Object.fromEntries(Object.keys(SpreadsheetGaps.implementedFunctions).map((name) => [name, name]));
HyperFormula.registerFunctionPlugin(SpreadsheetGaps, { enGB: names, enUS: names });

// The engine's own TEXT knows a few codes (`#,##0.00` gave "1235,##0.00", `0%` "0%"): a format is read as the cells draw theirs, and DATEDIF takes its unit in any case.
const Dates = HyperFormula.getFunctionPlugin("DATEDIF");
class SpreadsheetDates extends Dates {
  text(ast, state) {
    return this.runFunction(ast.args, state, this.metadata("TEXT"), (value, pattern) => {
      if (value instanceof CellError) return value;
      const given = plain(value) ?? 0, number = typeof given === "string" && given.trim() && Number.isFinite(Number(given)) ? Number(given) : given;
      try { return formatted(pattern, typeof number === "boolean" ? String(number).toUpperCase() : number); } catch { return new CellError(ErrorType.VALUE); }
    });
  }
  datedif(ast, state) {
    const run = this.runFunction;
    this.runFunction = (args, at, metadata, compute) => run.call(this, args, at, metadata, (start, end, unit) => compute(start, end, unit.toUpperCase()));
    try { return super.datedif(ast, state); } finally { delete this.runFunction; }
  }
}
SpreadsheetDates.implementedFunctions = { TEXT: { method: "text", parameters: [{ argumentType: SCALAR }, { argumentType: STRING }] }, DATEDIF: Dates.implementedFunctions.DATEDIF };
HyperFormula.registerFunctionPlugin(SpreadsheetDates, { enGB: { TEXT: "TEXT", DATEDIF: "DATEDIF" }, enUS: { TEXT: "TEXT", DATEDIF: "DATEDIF" } });

// The engine's FILTER takes only a row or a column and conditions after it; a spreadsheet's keeps a table's rows (or columns) where `include` holds,
// and a value past it is what to give where none does (`FILTER(A2:D9, B2:B9>15, "none")`). Further conditions the engine's way still count.
const Arrays = HyperFormula.getFunctionPlugin("FILTER");
class SpreadsheetFilter extends Arrays {
  filter(ast, state) {
    return this.runFunction(ast.args, state, this.metadata("FILTER"), (values, ...rest) => {
      const conditions = rest.filter((one) => one instanceof SimpleRangeValue), empty = rest.find((one) => !(one instanceof SimpleRangeValue));
      const tall = conditions.every((one) => one.width() === 1 && one.height() === values.height()), wide = !tall && conditions.every((one) => one.height() === 1 && one.width() === values.width());
      if (!tall && !wide) return new CellError(ErrorType.VALUE, "The condition is not as tall or as wide as the range.");
      const count = tall ? values.height() : values.width(), keep = [];
      for (let at = 0; at < count; at++) {
        let held = true;
        for (const one of conditions) {
          const cell = tall ? one.data[at][0] : one.data[0][at];
          if (cell instanceof CellError) return cell;
          held &&= cell === true || (number(cell) ?? 0) !== 0;
        }
        keep.push(held);
      }
      const kept = tall ? values.data.filter((_, at) => keep[at]) : values.data.map((row) => row.filter((_, at) => keep[at]));
      if (kept.length && kept[0].length) return SimpleRangeValue.onlyValues(kept);
      return empty === undefined ? new CellError(ErrorType.NA, "Nothing matches the condition.") : empty instanceof CellError ? empty : SimpleRangeValue.onlyValues([[plain(empty) ?? 0]]);
    });
  }
}
SpreadsheetFilter.implementedFunctions = { FILTER: { ...Arrays.implementedFunctions.FILTER, parameters: [{ argumentType: RANGE }, { argumentType: RANGE }, { argumentType: ANY, optionalArg: true }] } };
HyperFormula.registerFunctionPlugin(SpreadsheetFilter, { enGB: { FILTER: "FILTER" }, enUS: { FILTER: "FILTER" } });

/*
 * What the engine lacks and @formulajs/formulajs has, under the name a spreadsheet gives it. A range reaches it as rows of plain values and a date as its
 * serial number. One that answers with several values (TREND, LINEST, TAKE) gives its first here: a result spilt over cells is not built.
 */
const BORROWED = {
  ACCRINT: "ACCRINT", AGGREGATE: "AGGREGATE", "BINOM.DIST.RANGE": "BINOM.DIST.RANGE", CHOOSECOLS: "CHOOSECOLS", CHOOSEROWS: "CHOOSEROWS", CONCAT: "CONCAT",
  CONVERT: "CONVERT", COUPDAYS: "COUPDAYS", DISC: "DISC", DOLLAR: "DOLLAR", DROP: "DROP", "ERROR.TYPE": "ERROR.TYPE", EXPAND: "EXPAND", FIXED: "FIXED",
  FORECAST: "FORECAST", "FORECAST.LINEAR": "FORECAST", FREQUENCY: "FREQUENCY", GESTEP: "GESTEP", GROWTH: "GROWTH", INTERCEPT: "INTERCEPT", KURT: "KURT",
  LINEST: "LINEST", LOGEST: "LOGEST", LOOKUP: "LOOKUP", MODE: "MODE.SNGL", "MODE.MULT": "MODE.MULT", "MODE.SNGL": "MODE.SNGL", MUNIT: "MUNIT",
  "NETWORKDAYS.INTL": "NETWORKDAYSINTL", NUMBERVALUE: "NUMBERVALUE", "PERCENTILE.EXC": "PERCENTILE.EXC", "PERCENTILE.INC": "PERCENTILE.INC",
  PERCENTRANK: "PERCENTRANK.INC", "PERCENTRANK.EXC": "PERCENTRANK.EXC", "PERCENTRANK.INC": "PERCENTRANK.INC", PERMUT: "PERMUT", PERMUTATIONA: "PERMUTATIONA",
  PRICEDISC: "PRICEDISC", PROB: "PROB", "QUARTILE.EXC": "QUARTILE.EXC", "QUARTILE.INC": "QUARTILE.INC", TAKE: "TAKE", TREND: "TREND", TRIMMEAN: "TRIMMEAN",
  TYPE: "TYPE", "WORKDAY.INTL": "WORKDAYINTL", TEXTAFTER: "TEXTAFTER", TEXTBEFORE: "TEXTBEFORE", XMATCH: "XMATCH",
};
// Errors in a range are passed over by these, not given back.
const PAST_ERRORS = new Set(["LOOKUP", "XMATCH"]);
const folded = (value) => typeof value === "string" ? value.toLowerCase() : value;
/** A spreadsheet's wildcards (`*`, `?`, `~` before either for itself) as a whole-text, any-case pattern. */
const wildcard = (text) => new RegExp(`^${text.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/~?[*?]/g, (part) => part.length > 1 ? `\\${part[1]}` : part === "*" ? ".*" : ".")}$`, "is");
/** The text before (or after) the nth delimiter, counted from the end where n is negative; `end` counts the text's end (or start) as one. */
const around = (after) => (text, delimiters, n, mode, end, missing) => {
  text = String(text ?? ""); n ??= 1;
  const cut = [delimiters].flat(2).map((one) => String(one ?? "")), empty = cut.includes(""), fold = (one) => mode ? one.toLowerCase() : one, hay = fold(text);
  if (!n || Math.abs(n) > text.length + 1) return new Error("#VALUE!");
  const hits = empty ? [[n > 0 ? 0 : text.length, 0]] : [];
  for (let at = 0; !empty && at < hay.length;) {
    const found = cut.filter((one) => hay.startsWith(fold(one), at)).sort((a, b) => b.length - a.length)[0];
    if (found === undefined) at++; else { hits.push([at, found.length]); at += found.length; }
  }
  if (end && !empty) n > 0 ? hits.push([text.length, 0]) : hits.unshift([0, 0]);
  const hit = n > 0 ? hits[n - 1] : hits[hits.length + n];
  return !hit ? missing ?? new Error("#N/A") : after ? text.slice(hit[0] + hit[1]) : text.slice(0, hit[0]);
};
const same = (a, b) => typeof a === typeof b && (typeof a === "string" ? a.toLowerCase() <= b.toLowerCase() : a <= b);
/** Ours where the borrowed one is wrong: it fails on a blank in the range and on a decimal comma. */
const OURS = {
  // The last value of the needle's type that is not above it, as a spreadsheet's search lands on in a sorted range; blanks and errors are passed over.
  LOOKUP: (needle, vector, results = vector) => {
    const wide = vector.length === 1 || (vector.length > 1 && vector[0].length > vector.length && results === vector), from = wide ? vector[0] : vector.map((row) => row[0]);
    const to = results === vector ? (wide ? vector[vector.length - 1] : vector.map((row) => row[row.length - 1])) : results.length === 1 ? results[0] : results.map((row) => row[0]);
    let found = -1;
    from.forEach((value, at) => { if (value !== null && !(value instanceof CellError) && same(value, needle)) found = at; });
    return found < 0 ? new Error("#N/A") : to[found] ?? 0;
  },
  // A position (from 1) in a row or column: exact (0), else the next smaller (-1) or larger (1), or by wildcards (2); from the end where `search` is negative.
  XMATCH: (needle, within, mode, search) => {
    within = Array.isArray(within) ? within : [[within]];
    if (within.length > 1 && within[0].length > 1) return new Error("#VALUE!");
    const line = within.length === 1 ? within[0] : within.map((row) => row[0]), key = folded(needle), wild = mode === 2 && typeof needle === "string" ? wildcard(needle) : null;
    let best = -1;
    for (let step = 0; step < line.length; step++) {
      const at = search < 0 ? line.length - 1 - step : step, value = line[at];
      if (typeof value !== typeof needle) continue;
      if (wild ? wild.test(value) : folded(value) === key) return at + 1;
      if (mode === 1 && folded(value) > key && (best < 0 || folded(value) < folded(line[best]))) best = at;
      if (mode === -1 && folded(value) < key && (best < 0 || folded(value) > folded(line[best]))) best = at;
    }
    return best < 0 ? new Error("#N/A") : best + 1;
  },
  TEXTAFTER: around(true),
  TEXTBEFORE: around(false),
  NUMBERVALUE: (text, decimal = ".", group = ",") => {
    const [, digits, percents] = /^(.*?)(%*)$/.exec(String(text ?? "").replace(/\s/g, "").split(group[0]).join("").replace(decimal[0], "."));
    return digits === "" ? 0 : Number.isNaN(Number(digits)) ? new Error("#VALUE!") : Number(digits) / 100 ** percents.length;
  },
};
const ERRORS = { "#N/A": ErrorType.NA, "#DIV/0!": ErrorType.DIV_BY_ZERO, "#NUM!": ErrorType.NUM, "#REF!": ErrorType.REF, "#NAME?": ErrorType.NAME };
const plain = (value) => value === EmptyValue ? null : typeof value?.val === "number" ? value.val : value;
// Its dates are midnight where this runs; a serial counts days from 30 December 1899.
const serial = (date) => (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1899, 11, 30)) / 86400000 + (date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds()) / 86400;
const answer = (value) => {
  while (Array.isArray(value)) value = value[0];
  if (value instanceof CellError) return value;
  if (value instanceof Error) return new CellError(ERRORS[value.message] ?? ErrorType.VALUE);
  if (value instanceof Date) return serial(value);
  return value === undefined || value === null || (typeof value === "number" && !Number.isFinite(value)) ? new CellError(value == null ? ErrorType.VALUE : ErrorType.NUM) : value;
};
class Borrowed extends FunctionPlugin {}
Borrowed.implementedFunctions = {};
const registered = new Set(HyperFormula.getRegisteredFunctionNames("enGB"));
for (const [name, path] of Object.entries(BORROWED)) {
  const borrowed = OURS[name] ?? path.split(".").reduce((from, key) => from?.[key], formulajs);
  if (registered.has(name) || typeof borrowed !== "function") continue;
  const method = `borrowed${name}`;
  Borrowed.prototype[method] = function (ast, state) {
    return this.runFunction(ast.args, state, this.metadata(name), (...args) => {
      const given = [];
      for (const arg of args) {
        if (arg === undefined) continue;
        if (arg instanceof CellError) return arg;
        if (!(arg instanceof SimpleRangeValue)) { given.push(plain(arg)); continue; }
        const rows = arg.data.map((row) => row.map(plain));
        const broken = rows.flat().find((cell) => cell instanceof CellError);
        if (broken && !PAST_ERRORS.has(name)) return broken;
        given.push(rows);
      }
      try { return answer(borrowed(...given)); } catch { return new CellError(ErrorType.VALUE); }
    });
  };
  Borrowed.implementedFunctions[name] = { method, parameters: [{ argumentType: ANY, optionalArg: true }], repeatLastArgs: 1 };
}
const borrowedNames = Object.fromEntries(Object.keys(Borrowed.implementedFunctions).map((name) => [name, name]));
HyperFormula.registerFunctionPlugin(Borrowed, { enGB: borrowedNames, enUS: borrowedNames });

/** Bare TRUE and FALSE as a spreadsheet reads them (`=VLOOKUP(A1,B:C,2,FALSE)`): the engine knows them only as functions. */
export const NAMES = [{ name: "TRUE", expression: "=TRUE()" }, { name: "FALSE", expression: "=FALSE()" }];
