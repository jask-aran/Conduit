import { a1, colIndex, key, parseA1, parseRange, rangeA1, rangedArea } from "./sheet-format.js";

/*
 * Conditional formatting (sheet-rules.d.ts): a tab's rules in its look (`rules:<tabId>`), each a cell-value comparison or a formula, as a spreadsheet's.
 * A rule's formulas are read by a small evaluator of our own, not the engine: the page's engine is in a worker (sheet-engine.js), and a drawn cell
 * must be answered at once. Shared by the page, which draws them (components/sheet/rules.tsx), the hub (sheets.js) and the xlsx parts.
 */
export const RULE_OPS = [">", "<", ">=", "<=", "=", "<>", "between", "notBetween"];
export const RULE_LIMIT = 200;
const COMPARE = { ">": (n) => n > 0, "<": (n) => n < 0, ">=": (n) => n >= 0, "<=": (n) => n <= 0, "=": (n) => n === 0, "<>": (n) => n !== 0 };
const TOKEN = /\s*(?:("(?:[^"]|"")*")|(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)(?![\w(.!])|(\d*\.?\d+(?:[eE][+-]?\d+)?)|(TRUE|FALSE)(?![\w(.])|([A-Za-z_][\w.]*)\s*\(|(<=|>=|<>|[-+*/^&=<>(),%]))/iy;
const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/;
const fail = () => { throw new Error("#VALUE!"); };

// A spreadsheet's order for comparing: numbers, then text (case aside), then TRUE and FALSE; a blank is 0 against a number, "" against text.
const rank = (value) => typeof value === "number" ? 0 : typeof value === "string" ? 1 : 2;
export const compareValues = (a, b) => {
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === "string") { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
  return Number(a) - Number(b);
};
const num = (value) => typeof value === "number" ? value : typeof value === "boolean" ? Number(value) : value === null || value === "" ? 0 : Number.isFinite(Number(value)) ? Number(value) : fail();
const truth = (value) => typeof value === "string" ? (/^true$/i.test(value) || (/^false$/i.test(value) ? false : fail())) : Boolean(num(value));
const text = (value) => value === null ? "" : typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value);
const numbers = (args) => args.flatMap((arg) => arg.cells ? arg.cells().filter((value) => typeof value === "number") : [num(arg())]);
const FUNCTIONS = {
  AND: (args) => args.every((arg) => truth(arg())), OR: (args) => args.some((arg) => truth(arg())), NOT: ([x]) => !truth(x()),
  IF: ([test, yes, no]) => truth(test()) ? yes() : no ? no() : false,
  ISNUMBER: ([x]) => { try { return typeof x() === "number"; } catch { return false; } }, ISTEXT: ([x]) => { try { return typeof x() === "string"; } catch { return false; } },
  ISBLANK: ([x]) => { try { return x() === null; } catch { return false; } }, ISERROR: ([x]) => { try { x(); return false; } catch { return true; } },
  ABS: ([x]) => Math.abs(num(x())), ROUND: ([x, digits]) => { const by = 10 ** (digits ? num(digits()) : 0); return Math.sign(num(x())) * Math.round(Math.abs(num(x())) * by) / by; },
  MOD: ([x, y]) => { const d = num(y()); if (!d) fail(); const n = num(x()); return n - d * Math.floor(n / d); }, INT: ([x]) => Math.floor(num(x())), LEN: ([x]) => text(x()).length,
  SUM: (args) => numbers(args).reduce((sum, n) => sum + n, 0), COUNT: (args) => numbers(args).length,
  MIN: (args) => { const list = numbers(args); return list.length ? Math.min(...list) : 0; }, MAX: (args) => { const list = numbers(args); return list.length ? Math.max(...list) : 0; },
  AVERAGE: (args) => { const list = numbers(args); return list.length ? list.reduce((sum, n) => sum + n, 0) / list.length : fail(); },
};
const BINARY = [["=", "<>", "<", ">", "<=", ">="], ["&"], ["+", "-"], ["*", "/"], ["^"]];
const apply = (op, x, y) => {
  if (op === "&") return text(x) + text(y);
  if (op in COMPARE) return COMPARE[op](compareValues(x, y));
  const a = num(x), b = num(y);
  return op === "+" ? a + b : op === "-" ? a - b : op === "*" ? a * b : op === "^" ? a ** b : b ? a / b : fail();
};

/**
 * A formula (without its `=`) as a function of the cell it is asked for: relative references move with that cell from `anchor`, the cell the text
 * was written for. It reads values with `get`, which throws for an error, and throws one itself. Null where this evaluator cannot read it (another
 * tab, a function it lacks). `reads`: it reads cells, so any change can change it.
 */
export function compileFormula(source, anchor) {
  const tokens = [], base = parseA1(anchor) ?? { row: 0, col: 0 };
  const body = String(source ?? "").replace(/^=/, "");
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < body.length) {
    const at = TOKEN.lastIndex, found = TOKEN.exec(body);
    if (!found) { if (/^\s*$/.test(body.slice(at))) break; return null; }
    tokens.push(found);
  }
  let n = 0, reads = false;
  const peek = () => tokens[n], op = (said) => tokens[n]?.[6] === said;
  const cell = (ref) => {
    const [, colHeld, letters, rowHeld, digits] = CELL.exec(ref), r = Number(digits) - 1, c = colIndex(letters);
    reads = true;
    return (row, col) => [rowHeld ? r : row + r - base.row, colHeld ? c : col + c - base.col];
  };
  const parse = (level = 0) => {
    if (level === BINARY.length) return unary();
    let left = parse(level + 1);
    while (peek()?.[6] && BINARY[level].includes(peek()[6])) { const said = tokens[n++][6], right = parse(level + 1), was = left; left = (ctx) => apply(said, was(ctx), right(ctx)); }
    return left;
  };
  const unary = () => {
    if (op("-")) { n++; const inner = unary(); return (ctx) => -num(inner(ctx)); }
    if (op("+")) { n++; return unary(); }
    let made = atom();
    while (op("%")) { n++; const inner = made; made = (ctx) => num(inner(ctx)) / 100; }
    return made;
  };
  const atom = () => {
    const token = tokens[n++];
    if (!token) throw new Error("end");
    const [, string, ref, number, bool, call] = token;
    if (string !== undefined) { const value = string.slice(1, -1).replace(/""/g, '"'); return () => value; }
    if (number !== undefined) { const value = Number(number); return () => value; }
    if (bool !== undefined) { const value = bool.toUpperCase() === "TRUE"; return () => value; }
    if (ref !== undefined) {
      const [one, two] = ref.split(":"), from = cell(one);
      if (!two) return (ctx) => { const [r, c] = from(ctx.row, ctx.col); return r < 0 || c < 0 ? fail() : ctx.get(r, c); };
      const to = cell(two), read = (ctx) => { const [r1, c1] = from(ctx.row, ctx.col), [r2, c2] = to(ctx.row, ctx.col), out = [];
        for (let r = Math.max(0, Math.min(r1, r2)); r <= Math.max(r1, r2); r++) for (let c = Math.max(0, Math.min(c1, c2)); c <= Math.max(c1, c2); c++) out.push(ctx.get(r, c)); return out; };
      return Object.assign(() => fail(), { range: read });
    }
    if (call !== undefined) {
      const fn = FUNCTIONS[call.toUpperCase()];
      if (!fn) throw new Error("function");
      const args = [];
      if (!op(")")) do { if (args.length) n++; args.push(parse()); } while (op(","));
      if (!op(")")) throw new Error(")");
      n++;
      return (ctx) => fn(args.map((arg) => Object.assign(() => arg(ctx), arg.range ? { cells: () => arg.range(ctx) } : {})));
    }
    if (token[6] === "(") { const inner = parse(); if (!op(")")) throw new Error(")"); n++; return inner; }
    throw new Error("token");
  };
  try {
    const root = parse();
    if (n !== tokens.length) return null;
    return Object.assign((row, col, get) => root({ row, col, get }), { reads });
  } catch { return null; }
}

/** A rule as one test of a cell, reading values with `get` (which throws for an error): its value, or its formula, against the rule. Null where a formula of it cannot be read here. */
export function compileRule(rule) {
  const anchor = rule.anchor ?? "A1", a = compileFormula(rule.a, anchor), two = rule.op === "between" || rule.op === "notBetween", b = two ? compileFormula(rule.b, anchor) : null;
  if (!a || (rule.kind !== "formula" && (!RULE_OPS.includes(rule.op) || (two && !b)))) return null;
  const test = rule.kind === "formula" ? (row, col, get) => truth(a(row, col, get)) : (row, col, get) => {
    const value = get(row, col), x = a(row, col, get);
    if (!b) return COMPARE[rule.op](compareValues(value, x));
    const y = b(row, col, get), [low, high] = compareValues(x, y) <= 0 ? [x, y] : [y, x], inside = compareValues(value, low) >= 0 && compareValues(value, high) <= 0;
    return rule.op === "between" ? inside : !inside;
  };
  return Object.assign((row, col, get) => { try { return test(row, col, get); } catch { return false; } }, { reads: a.reads || Boolean(b?.reads) });
}

/** A formula's relative references moved by `rows` and `cols`, outside its strings: as a fill moves them. */
// A string ("…") and a quoted tab's name ('Q1 2024') are left as they are; a reference after a tab's name (Data!B2) moves as any.
export const shiftRefs = (formula, rows, cols) => !rows && !cols ? formula : String(formula).split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/).map((part, nth) => nth % 2 ? part
  : part.replace(/(?<![\w.$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(.!])/g, (all, colHeld, letters, rowHeld, digits) => {
    const col = colHeld ? colIndex(letters) : colIndex(letters) + cols, row = rowHeld ? Number(digits) - 1 : Number(digits) - 1 + rows;
    return row < 0 || col < 0 ? "#REF!" : `${colHeld}${a1(0, col).replace(/\d+$/, "")}${rowHeld}${row + 1}`;
  })).join("");

/** The rules a look's text holds, those that are whole. */
export function readRules(text) {
  try {
    const list = JSON.parse(String(text));
    return Array.isArray(list) ? list.filter((rule) => rule && Array.isArray(rule.ranges) && typeof rule.a === "string" && (rule.kind === "formula" || RULE_OPS.includes(rule.op))) : [];
  } catch { return []; }
}
/** A rule's ranges where they are now (a range whose corner has gone is left out). */
export const ruleAreas = (view, rule) => rule.ranges.flatMap(([from, to]) => { const area = rangedArea(view, { from, to }); return area ? [area] : []; });
const topLeft = (areas) => ({ row: Math.min(...areas.map((area) => area.top)), col: Math.min(...areas.map((area) => area.left)) });
const said = (rule) => Object.fromEntries(Object.entries(rule).filter(([name, value]) => !["ranges", "anchor"].includes(name) && value !== undefined));

/** A tab's rules by A1 (`ranges: "B5 B29:O29"`), each formula as written for the ranges' top-left cell, as a workbook keeps them. */
export function rulesA1(view, text) {
  return readRules(text).flatMap((rule) => {
    const areas = ruleAreas(view, rule);
    if (!areas.length) return [];
    const at = topLeft(areas), from = parseA1(rule.anchor) ?? at, move = (formula) => formula === undefined ? undefined : shiftRefs(formula, at.row - from.row, at.col - from.col);
    return [{ ...said(rule), ranges: areas.map(rangeA1).join(" "), a: move(rule.a), b: move(rule.b) }];
  }).map((rule) => JSON.parse(JSON.stringify(rule)));
}
/** Rules by A1 as a look's text by ids, each range clipped to the tab; undefined for none. */
export function rulesIds(view, list) {
  const { rows, cols } = view.size(), out = [];
  for (const rule of Array.isArray(list) ? list.slice(0, RULE_LIMIT) : []) {
    const areas = String(rule?.ranges ?? "").split(/\s+/).flatMap((one) => { const area = parseRange(one); return area ? [area] : []; });
    if (!areas.length || typeof rule.a !== "string") continue;
    const ranges = areas.flatMap((area) => area.top >= rows || area.left >= cols ? [] : [[key(view.rowAt(area.top), view.colAt(area.left)), key(view.rowAt(Math.min(area.bottom, rows - 1)), view.colAt(Math.min(area.right, cols - 1)))]]);
    const at = topLeft(areas);
    if (ranges.length) out.push({ ...said(rule), ranges, anchor: a1(at.row, at.col) });
  }
  return out.length ? JSON.stringify(out.filter((rule) => readRules(JSON.stringify([rule])).length)) : undefined;
}
