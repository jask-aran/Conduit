import { a1, colName, key } from "./sheet-format.js";
import { shiftRefs } from "./sheet-rules.js";
import { blockId } from "./block-id.js";
import { dateText, optionsOf, putType, readDate, readValidations, VALID } from "./sheet-types.js";

/*
 * Data validation as Excel's (sheet-valid.d.ts): a rule is a `dataValidation`'s own attributes (sheet-types.js keeps them by id in
 * `validations:<tabId>`, a cell holding one by `type:… = valid:<id>`), judged the same on the page and the hub. What a rule's operands need of the
 * cells or the engine the caller reads (`read`): the page reads constants and cells, and leaves what needs the engine to the hub.
 */
export const RULE_KINDS = ["whole", "decimal", "list", "date", "time", "textLength", "custom"];
export const OPERATORS = ["between", "notBetween", "equal", "notEqual", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"];
const SAID = { between: "between", notBetween: "not between", equal: "equal to", notEqual: "not equal to", greaterThan: "greater than", lessThan: "less than", greaterThanOrEqual: "at least", lessThanOrEqual: "at most" };
const KIND_SAID = { whole: "a whole number", decimal: "a number", date: "a date", time: "a time", textLength: "text of a length" };
const on = (flag) => flag === "1" || flag === "true" || flag === true;

/** The rule a cell holds, with its id; undefined for none. `all`: the tab's rules, read once by a caller judging many cells. */
export function ruleAt(look, sheet, row, col, all) {
  const rowId = sheet.rowAt(row), colId = sheet.colAt(col);
  if (!rowId || !colId) return undefined;
  const type = look.get(`type:${key(rowId, colId)}`) ?? look.get(`type:${colId}`);
  if (typeof type !== "string" || !type.startsWith(VALID)) return undefined;
  const id = type.slice(VALID.length), one = (all ?? readValidations(look, sheet.id))[id];
  return one && one.type && one.type !== "none" ? { id, ...one } : undefined;
}

/** A time typed (9:30, 9:30 pm, 21:30:15) as the day's fraction, as a spreadsheet keeps one; null for anything else. */
export function readTime(text) {
  const hit = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i.exec(String(text).trim());
  if (!hit) return null;
  let hours = +hit[1];
  if (hit[4]) { if (hours > 12) return null; hours = hours % 12 + (hit[4].toLowerCase() === "pm" ? 12 : 0); }
  return hours < 24 && +hit[2] < 60 && +(hit[3] ?? 0) < 60 ? (hours * 3600 + +hit[2] * 60 + +(hit[3] ?? 0)) / 86400 : null;
}
/** What a typed entry (not a formula) holds: a number, a date's or time's serial, TRUE/FALSE, or its text; null for nothing. */
export function entryValue(input) {
  const text = String(input ?? "").trim();
  if (!text) return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?%?$/i.test(text)) return text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text);
  if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
  return readDate(text) ?? readTime(text) ?? String(input);
}

/** An operand as a constant where it is one (a number, a quoted text, a date or time typed); undefined where it needs cells or the engine. */
export function constant(formula) {
  const text = String(formula ?? "").trim().replace(/^=/, "");
  if (/^"(.*)"$/s.test(text)) return text.slice(1, -1).replace(/""/g, '"');
  const value = entryValue(text);
  return typeof value === "number" ? value : undefined;
}

/**
 * Whether `value` breaks the rule: true or false, or undefined where an operand could not be read. `read(formula)`: an operand's value (undefined:
 * can't tell); `list(formula)`: a list's values from cells (undefined: can't tell); `custom(formula)`: a custom rule's result at the cell holding
 * `value`. A blank never breaks a rule, as typing nothing is clearing the cell.
 */
export function breaks(rule, value, { read, list, custom }) {
  if (value === null || value === "" || !rule?.type || rule.type === "none") return false;
  if (rule.type === "list") {
    const options = optionsOf(rule)?.map((one) => one.value) ?? list(rule.formula1);
    if (!options) return undefined;
    const text = String(typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : value).toLowerCase();
    return !options.some((one) => String(one).toLowerCase() === text);
  }
  if (rule.type === "custom") { const result = custom(rule.formula1); return result === undefined ? undefined : !(result === true || (typeof result === "number" && result !== 0)); }
  const n = rule.type === "textLength" ? String(typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : value).length : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return true;
  if (rule.type === "whole" && !Number.isInteger(n)) return true;
  if (rule.type === "time" && (n < 0 || n >= 1)) return true;
  const operator = rule.operator ?? "between", two = operator === "between" || operator === "notBetween";
  const a = read(rule.formula1), b = two ? read(rule.formula2) : 0;
  if (a === undefined || b === undefined) return undefined;
  if (typeof a !== "number" || typeof b !== "number") return true;
  const [low, high] = a <= b ? [a, b] : [b, a];
  const ok = { between: n >= low && n <= high, notBetween: n < low || n > high, equal: n === a, notEqual: n !== a, greaterThan: n > a, lessThan: n < a, greaterThanOrEqual: n >= a, lessThanOrEqual: n <= a }[operator];
  return ok === undefined ? false : !ok;
}

// A list said by its first few values.
const FEW = 5;
/** A rule in words: "a whole number between 1 and 10". `listed`: a list's values read from its cells, said instead of its reference. */
export function ruleText(rule, listed) {
  const plain = (formula) => {
    const text = String(formula ?? "").replace(/^=/, ""), n = Number(text);
    if (text === "" || !Number.isFinite(n)) return text;
    if (rule.type === "date") return dateText(n);
    if (rule.type === "time") { const minutes = Math.round(n * 1440); return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`; }
    return text;
  };
  const values = rule.type === "list" ? optionsOf(rule)?.map((one) => one.value) ?? listed?.map(String) : undefined;
  if (values) return `one of ${values.slice(0, FEW).join(", ")}${values.length > FEW ? ", …" : ""}`;
  if (rule.type === "list") return `one of ${plain(rule.formula1)}`;
  if (rule.type === "custom") return `a value for which ${plain(rule.formula1)} is TRUE`;
  const operator = rule.operator ?? "between", two = operator === "between" || operator === "notBetween";
  return `${KIND_SAID[rule.type] ?? "a value"} ${SAID[operator] ?? operator} ${plain(rule.formula1)}${two ? ` and ${plain(rule.formula2)}` : ""}`;
}

/** What an entry breaking the rule at `row`, `col` is told: its own title and message, else what the cell takes. `stop`: the entry is refused. `listed`: as ruleText's. */
export function refusal(rule, row, col, listed) {
  const style = rule.errorStyle === "warning" || rule.errorStyle === "information" ? rule.errorStyle : "stop";
  const own = rule.error ? `${rule.errorTitle ? `${rule.errorTitle}: ` : ""}${rule.error}` : `${a1(row, col)} takes ${ruleText(rule, listed)}`;
  return { stop: style === "stop" && on(rule.showErrorMessage), style, message: own };
}

/** A custom rule's formula as at `row`, `col`: moved from the rule's first cell (`anchor`), the cell's own reference standing for its new `value`. */
export function customAt(formula, anchor, row, col, value) {
  const moved = shiftRefs(String(formula ?? "").replace(/^=/, ""), row - anchor.row, col - anchor.col);
  const literal = value === null ? '""' : typeof value === "string" ? `"${value.replace(/"/g, '""')}"` : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value);
  const self = new RegExp(`(?<![A-Za-z0-9_!:$.])\\$?${colName(col)}\\$?${row + 1}(?![0-9A-Za-z_:(])`, "gi");
  return `=${moved.split(/("(?:[^"]|"")*")/).map((part, nth) => nth % 2 ? part : part.replace(self, literal)).join("")}`;
}

/** A rule's first cell, as an export's `sqref` starts (sheet-types.js validationsA1: leftmost column, its top cell): a custom rule's formula is written there. */
export function anchorOf(look, sheet, id) {
  let best = null;
  for (const [name, value] of look.entries()) {
    if (value !== `${VALID}${id}` || !name.startsWith("type:")) continue;
    const parts = name.split(":"), col = sheet.indexOfCol(parts.at(-1)), row = parts.length === 3 ? sheet.indexOfRow(parts[1]) : 0;
    if (row >= 0 && col >= 0 && (!best || col < best.col || (col === best.col && row < best.row))) best = { row, col };
  }
  return best ?? { row: 0, col: 0 };
}

/** The area takes the rule (`attributes`, Excel's own; null: none), clipped to the tab, in the caller's transaction; rules no cell holds any more go. */
export function writeRule(look, sheet, area, attributes, columns) {
  const { rows, cols } = sheet.size(), at = { ...area, bottom: Math.min(area.bottom, rows - 1), right: Math.min(area.right, cols - 1) }, all = readValidations(look, sheet.id);
  if ((at.bottom - at.top + 1) * (at.right - at.left + 1) > 10_000 && !columns) throw Object.assign(new Error("At most 10000 cells take a rule of their own at once: give whole columns instead"), { status: 400 });
  let kept = null;
  if (attributes) { const id = blockId(); all[id] = attributes; kept = `${VALID}${id}`; look.set(`validations:${sheet.id}`, JSON.stringify(all)); }
  putType(look, sheet, at, kept, columns);
  const held = new Set([...look.values()].flatMap((value) => typeof value === "string" && value.startsWith(VALID) ? [value.slice(VALID.length)] : []));
  const left = Object.fromEntries(Object.entries(all).filter(([id]) => held.has(id)));
  if (Object.keys(left).length !== Object.keys(all).length) { if (Object.keys(left).length) look.set(`validations:${sheet.id}`, JSON.stringify(left)); else look.delete(`validations:${sheet.id}`); }
}

/**
 * The hub's judgement of cells written or about to be (`[row, col, input]`), with the engine (`sheet.engine`, `sheet.sheet`): `each(row, col, said)`
 * told of each that breaks its rule, until it returns false. A formula entry is judged by what it computes; an operand the engine cannot compute
 * lets the entry through.
 */
function judge(look, sheet, written, each) {
  const all = readValidations(look, sheet.id);
  if (!Object.keys(all).length) return;
  const calc = (formula) => { try { const out = sheet.engine.calculateFormula(formula, sheet.sheet); return out !== null && typeof out === "object" && !Array.isArray(out) ? undefined : out; } catch { return undefined; } };
  for (const [row, col, input] of written) {
    const rule = input ? ruleAt(look, sheet, row, col, all) : undefined;
    if (!rule) continue;
    const value = String(input).startsWith("=") ? calc(String(input)) : entryValue(input);
    if (value === undefined || Array.isArray(value)) continue;
    const at = () => anchorOf(look, sheet, rule.id);
    const list = (formula) => { const out = calc(`=${String(formula ?? "").replace(/^=/, "")}`); return Array.isArray(out) ? out.flat().filter((one) => one !== null && one !== "").map(String) : out === undefined ? undefined : [String(out)]; };
    const broken = breaks(rule, value, {
      read: (formula) => { const kept = constant(formula); if (kept !== undefined) return kept; const out = calc(`=${String(formula ?? "").replace(/^=/, "")}`); return Array.isArray(out) ? undefined : out; },
      list, custom: (formula) => calc(customAt(formula, at(), row, col, value)),
    });
    if (broken && each(row, col, refusal(rule, row, col, rule.type === "list" ? list(rule.formula1) : undefined)) === false) return;
  }
}
/** The first Stop rule an entry about to be written breaks, as its message naming the cell, else null. */
export function hubRefusal(look, sheet, written) {
  let out = null;
  judge(look, sheet, written, (row, col, said) => { if (!said.stop) return true; out = said.message.startsWith(`${a1(row, col)} `) ? said.message : `${a1(row, col)}: ${said.message}`; return false; });
  return out;
}
/** The cells just written that break their rules, as `[row, col]`, as a fill lets them through. */
export function hubBroken(look, sheet, written) {
  const out = [];
  judge(look, sheet, written, (row, col) => { out.push([row, col]); });
  return out;
}
/** What a person is told of the values a paste or fill let through that break their rules: how many, and the first. */
export const brokenText = (count, first, verb) => count === 1 ? `A ${verb} value breaks a rule, at ${first}` : `${count} ${verb} values break a rule, first at ${first}`;
