/*
 * What the formula editor says of the functions used most: each one's arguments and a line on what it does. Which functions there are is the
 * engine's to say (its registered names, custom ones included); one missing here is offered by its name alone.
 */

/** `args`: the arguments in order, an optional one in brackets; a last one ending "…" may be given again and again. */
export type FunctionHelp = { args: readonly string[]; about: string };

const help = (args: string, about: string): FunctionHelp => ({ args: args ? args.split(", ") : [], about });
export const FUNCTION_HELP: Readonly<Record<string, FunctionHelp>> = {
  SUM: help("number1, [number2, …]", "Adds numbers and ranges."),
  AVERAGE: help("number1, [number2, …]", "The mean of numbers."),
  COUNT: help("value1, [value2, …]", "How many values are numbers."),
  COUNTA: help("value1, [value2, …]", "How many values are not empty."),
  COUNTBLANK: help("range", "How many cells in a range are empty."),
  MIN: help("number1, [number2, …]", "The smallest number."),
  MAX: help("number1, [number2, …]", "The largest number."),
  MEDIAN: help("number1, [number2, …]", "The middle number."),
  PRODUCT: help("number1, [number2, …]", "Multiplies numbers."),
  IF: help("condition, value_if_true, [value_if_false]", "One value when a condition holds, another when not."),
  IFS: help("condition1, value1, [condition2, value2, …]", "The value of the first condition that holds."),
  IFERROR: help("value, value_if_error", "The value, or another where it is an error."),
  IFNA: help("value, value_if_na", "The value, or another where it is #N/A."),
  SWITCH: help("expression, case1, value1, [case2, value2, …]", "The value paired with the first case the expression equals."),
  AND: help("logical1, [logical2, …]", "TRUE when every argument is."),
  OR: help("logical1, [logical2, …]", "TRUE when any argument is."),
  NOT: help("logical", "The opposite of a logical value."),
  XOR: help("logical1, [logical2, …]", "TRUE when an odd number of arguments are."),
  VLOOKUP: help("search_key, range, index, [is_sorted]", "Finds a key down a range's first column and gives a column of that row."),
  HLOOKUP: help("search_key, range, index, [is_sorted]", "Finds a key along a range's first row and gives a row of that column."),
  XLOOKUP: help("search_key, lookup_range, result_range, [if_not_found], [match_mode], [search_mode]", "Finds a key in one range and gives what stands beside it in another."),
  INDEX: help("range, row, [column]", "The cell at a row and column of a range."),
  MATCH: help("search_key, range, [match_type]", "Where a key stands in a range."),
  XMATCH: help("search_key, range, [match_mode], [search_mode]", "Where a key stands in a row or column: exactly, the next smaller or larger, or by wildcards."),
  CHOOSE: help("index, value1, [value2, …]", "The value at an index."),
  SUMIF: help("range, criterion, [sum_range]", "Adds the cells that meet a criterion."),
  SUMIFS: help("sum_range, criteria_range1, criterion1, [criteria_range2, criterion2, …]", "Adds the cells that meet every criterion."),
  COUNTIF: help("range, criterion", "How many cells meet a criterion."),
  COUNTIFS: help("criteria_range1, criterion1, [criteria_range2, criterion2, …]", "How many cells meet every criterion."),
  AVERAGEIF: help("range, criterion, [average_range]", "The mean of the cells that meet a criterion."),
  AVERAGEIFS: help("average_range, criteria_range1, criterion1, [criteria_range2, criterion2, …]", "The mean of the cells that meet every criterion."),
  MAXIFS: help("max_range, criteria_range1, criterion1, [criteria_range2, criterion2, …]", "The largest of the cells that meet every criterion."),
  MINIFS: help("min_range, criteria_range1, criterion1, [criteria_range2, criterion2, …]", "The smallest of the cells that meet every criterion."),
  SUMPRODUCT: help("array1, [array2, …]", "Multiplies ranges item by item and adds the products."),
  ROUND: help("number, [places]", "Rounds to a number of decimal places."),
  ROUNDUP: help("number, [places]", "Rounds away from zero."),
  ROUNDDOWN: help("number, [places]", "Rounds toward zero."),
  CEILING: help("number, significance", "Rounds up to a multiple."),
  FLOOR: help("number, significance", "Rounds down to a multiple."),
  ABS: help("number", "A number without its sign."),
  INT: help("number", "Rounds down to a whole number."),
  MOD: help("dividend, divisor", "The remainder of a division."),
  POWER: help("base, exponent", "A number raised to a power."),
  SQRT: help("number", "The square root."),
  EXP: help("exponent", "e raised to a power."),
  LN: help("number", "The natural logarithm."),
  LOG: help("number, [base]", "The logarithm to a base."),
  PI: help("", "The number π."),
  RAND: help("", "A random number from 0 up to 1."),
  RANDBETWEEN: help("low, high", "A random whole number between two."),
  CONCATENATE: help("text1, [text2, …]", "Joins text."),
  TEXTJOIN: help("delimiter, ignore_empty, text1, [text2, …]", "Joins text with a delimiter between."),
  CONCAT: help("text1, [text2, …]", "Joins text and ranges of text."),
  TEXTBEFORE: help("text, delimiter, [instance], [match_mode], [match_end], [if_not_found]", "The text before a delimiter."),
  TEXTAFTER: help("text, delimiter, [instance], [match_mode], [match_end], [if_not_found]", "The text after a delimiter."),
  LEFT: help("text, [count]", "The first characters of text."),
  RIGHT: help("text, [count]", "The last characters of text."),
  MID: help("text, start, count", "Characters from the middle of text."),
  LEN: help("text", "How many characters text has."),
  TRIM: help("text", "Text without spaces at its ends or doubled inside."),
  UPPER: help("text", "Text in capitals."),
  LOWER: help("text", "Text in small letters."),
  PROPER: help("text", "Text with each word capitalised."),
  SUBSTITUTE: help("text, search_for, replace_with, [occurrence]", "Replaces text inside text."),
  FIND: help("search_for, text, [start]", "Where text first appears, matching case."),
  SEARCH: help("search_for, text, [start]", "Where text first appears, ignoring case."),
  TEXT: help("value, format", "A number or date written in a format, such as \"#,##0.00\" or \"d mmm yyyy\"."),
  VALUE: help("text", "Text read as a number."),
  ISBLANK: help("value", "TRUE where the value is empty."),
  ISNUMBER: help("value", "TRUE where the value is a number."),
  ISERROR: help("value", "TRUE where the value is an error."),
  DATE: help("year, month, day", "A date from its parts."),
  TODAY: help("", "Today's date."),
  NOW: help("", "The date and time now."),
  YEAR: help("date", "A date's year."),
  MONTH: help("date", "A date's month."),
  DAY: help("date", "A date's day of the month."),
  WEEKDAY: help("date, [type]", "A date's day of the week."),
  EDATE: help("start_date, months", "The date some months before or after."),
  EOMONTH: help("start_date, months", "The last day of the month some months on."),
  NETWORKDAYS: help("start_date, end_date, [holidays]", "Working days between two dates."),
  DATEDIF: help("start_date, end_date, unit", "Whole years (\"Y\"), months (\"M\") or days (\"D\") between two dates."),
  RANK: help("value, range, [ascending]", "A value's rank in a range."),
  LARGE: help("range, n", "The nth largest value."),
  SMALL: help("range, n", "The nth smallest value."),
  MODE: help("number1, [number2, …]", "The value that comes most often."),
  STDEV: help("value1, [value2, …]", "The standard deviation of a sample."),
  VAR: help("value1, [value2, …]", "The variance of a sample."),
  TRANSPOSE: help("range", "A range with its rows and columns swapped."),
  UNIQUE: help("range, [by_column], [exactly_once]", "A range's rows without repeats, spilt below."),
  SORT: help("range, [sort_index], [sort_order], [by_column]", "A range sorted, spilt below."),
  FILTER: help("range, include, [if_empty]", "The rows (or columns) of a range where a condition holds, spilt below."),
  SEQUENCE: help("rows, [columns], [start], [step]", "Numbers in order, spilt over rows and columns."),
  OFFSET: help("reference, rows, columns, [height], [width]", "A range a number of rows and columns from another."),
  INDIRECT: help("reference_text", "The range a text names."),
  ROW: help("[reference]", "A cell's row number."),
  COLUMN: help("[reference]", "A cell's column number."),
  ROWS: help("range", "How many rows a range has."),
  COLUMNS: help("range", "How many columns a range has."),
  PMT: help("rate, periods, present_value, [future_value], [type]", "The payment each period on a loan."),
};

/** A function offered: its name, and the other name it was typed as (WRONG_NAMES), shown as "for" that. */
/** `detail` and `id`: a chip the sheet offers past CHIPS (a person, an artifact, a ready-made dropdown), by its id. */
/** `insert`: a table's or column's name, written over the text from `from` to the caret. */
export type FunctionOffer = { name: string; typedFor?: string; chip?: true; detail?: string; id?: string; insert?: { from: number; text: string } };
/** What `@` in an empty cell offers, as a spreadsheet's smart chips: a type for the cell, or today's date written in it. */
export const CHIPS: Readonly<Record<string, string>> = { Date: "A date picked from a calendar", Dropdown: "Options to pick from", Today: "Today's date" };

// Most used first: a name typed is offered the common function it starts, never the rare one before it in the alphabet.
const POPULAR = ["SUM", "AVERAGE", "IF", "COUNT", "MAX", "MIN", "ROUND", "VLOOKUP", "COUNTIF", "SUMIF", "IFERROR", "AND", "OR", "CONCATENATE", "LEFT", "RIGHT", "MID", "LEN", "TRIM",
  "UPPER", "LOWER", "TODAY", "NOW", "DATE", "YEAR", "MONTH", "DAY", "INDEX", "MATCH", "XLOOKUP", "ABS", "INT", "MOD", "COUNTA", "SUMIFS", "COUNTIFS", "AVERAGEIF", "IFS", "NOT", "TEXT",
  "VALUE", "SUMPRODUCT", "MEDIAN", "ROUNDUP", "ROUNDDOWN", "POWER", "SQRT", "SUBSTITUTE", "FIND", "SEARCH"];
const RANK = new Map([...POPULAR, ...Object.keys(FUNCTION_HELP)].filter((name, at, all) => all.indexOf(name) === at).map((name, at) => [name, at]));

/** Names people type for a function the engine calls otherwise; each is offered only where the engine has the real one and not the typed one. */
export const WRONG_NAMES: Readonly<Record<string, string>> = {
  AVG: "AVERAGE", MEAN: "AVERAGE", STDDEV: "STDEV", CONCAT: "CONCATENATE", LENGTH: "LEN", STRLEN: "LEN", SUBSTR: "MID", SUBSTRING: "MID", CEIL: "CEILING", POW: "POWER",
  IFNULL: "IFERROR", NVL: "IFERROR", LCASE: "LOWER", UCASE: "UPPER", INSTR: "FIND", ISEMPTY: "ISBLANK", TRUNCATE: "TRUNC", DISTINCT: "UNIQUE", COUNTDISTINCT: "COUNTUNIQUE",
  TOTAL: "SUM", RANK: "RANK.EQ", REPLACEALL: "SUBSTITUTE", DATEADD: "EDATE",
};
const wrongFor = (typed: string, names: ReadonlySet<string>) => Object.entries(WRONG_NAMES).filter(([wrong, real]) => wrong.startsWith(typed) && names.has(real) && !names.has(wrong));

/** The functions to offer for a name being typed: the help table's that it starts, most used first; then the real names of wrong ones it starts; then the engine's other names it starts; then those it is inside. `names`: sorted. */
export function functionOffers(typed: string, names: readonly string[], known: ReadonlySet<string>, limit: number): FunctionOffer[] {
  const upper = typed.toUpperCase(), out: FunctionOffer[] = [], seen = new Set<string>();
  const add = (name: string, typedFor?: string) => { if (out.length < limit && !seen.has(name)) { seen.add(name); out.push(typedFor ? { name, typedFor } : { name }); } };
  const starts = names.filter((name) => name.startsWith(upper));
  for (const name of starts.filter((one) => RANK.has(one)).sort((a, b) => RANK.get(a)! - RANK.get(b)!)) add(name);
  for (const [wrong, real] of wrongFor(upper, known)) add(real, wrong);
  for (const name of starts) add(name);
  if (upper.length > 1 && out.length < limit) for (const name of names) if (name.includes(upper)) add(name);
  return out;
}

const distance = (a: string, b: string) => {
  let row = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
};
/** The real names nearest a name the engine does not have: the one it is a wrong name for, alone; else those a few edits from it, most used first among equals. */
export function nearestFunctions(name: string, names: readonly string[], known: ReadonlySet<string>, limit: number): FunctionOffer[] {
  const upper = name.toUpperCase(), real = WRONG_NAMES[upper], most = Math.max(2, Math.floor(upper.length / 3));
  if (real && known.has(real)) return [{ name: real, typedFor: upper }];
  return names.map((one) => ({ one, far: distance(upper, one) })).filter(({ far }) => far <= most)
    .sort((a, b) => a.far - b.far || (RANK.get(a.one) ?? Infinity) - (RANK.get(b.one) ?? Infinity)).slice(0, limit).map(({ one }) => ({ name: one }));
}

/** The argument a position in a call stands for: past the last, the last again where it repeats. */
export const argumentAt = (help: FunctionHelp, at: number) => at < help.args.length ? at : help.args.at(-1)?.includes("…") ? help.args.length - 1 : -1;

// The engine's words for an error, where they are its own (or it gave none, only the code), as a person can act on them.
const REASONS: Readonly<Record<string, string>> = {
  "#DIV/0!": "It divides by zero, or by an empty cell.",
  "#CYCLE!": "Circular reference: the formula reads its own cell, directly or through other cells.",
  "#N/A": "A value it looks for is not there.",
  "#VALUE!": "A value is of the wrong type here.",
  "#REF!": "It reads a cell that is not there.",
  "#NUM!": "A number is out of range here.",
  "#NAME?": "It names a function or name this sheet does not have.",
  "#SPILL!": "Its result spills over cells that are not empty: clear them to show it.",
  "#ERROR!": "The formula cannot be read: check its brackets, commas and quotes.",
  "Value cannot be coerced to number.": "It reads text where a number is needed.",
  "NaN or infinite value encountered.": "The result is not a number, such as the square root of a negative one.",
  "Cell range not allowed.": "It is given a range where one value is needed.",
  "No space for array result.": "Its result spills over cells that are not empty: clear them to show it.",
  "Sheet does not exist.": "It reads a tab this sheet does not have.",
  "Value not found.": "The value it looks for is not in the range.",
  "Wrong number of arguments.": "The function is given too many or too few arguments.",
  "Address is not correct.": "It reads a cell that is not there.",
};
/** Why a cell shows an error, from the engine's message (or, where it gave none, the error's code). */
export const errorReason = (message: string) => REASONS[message] ?? (message.startsWith("Parsing error.") ? REASONS["#ERROR!"]! : message.replace(/^Named expression (.+) not recognized\.$/, "$1 is not a name this sheet has."));
