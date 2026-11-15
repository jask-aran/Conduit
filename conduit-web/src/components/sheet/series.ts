/*
 * The fill handle's series, as Excel's AutoFill makes them: a source line (a row or a column of what was picked) carried on past its end. The line
 * is cut into runs of one kind (numbers, dates, month or weekday names, text ending in a number with one stem); each run continues its own
 * pattern every time the line repeats, and everything else (text, formulas, blanks) repeats as it is. Kept free of imports so Node can run it.
 */

/** A source cell: what was typed, its computed value, and whether its number format is a date's. */
export type SeriesCell = { input: string; value: string | number | boolean | null; dated: boolean };

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const NAMES = [MONTHS, DAYS].map((list) => ({ list, long: new Map(list.map((name, n) => [name.toLowerCase(), n])), short: new Map(list.map((name, n) => [name.slice(0, 3).toLowerCase(), n])) }));
// Excel's serial day 0 (1899-12-30) is this many days before 1970-01-01.
const EPOCH = 25569, DAY = 864e5;
const NUMBER = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i, COUNTED = /^(.*?)(\d+)$/, ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

type Kind =
  | { kind: "copy" }
  | { kind: "number"; n: number }
  | { kind: "date"; n: number; iso?: boolean }
  | { kind: "counted"; stem: string; n: number; width: number }
  | { kind: "named"; names: number; n: number; long: boolean; caps: "upper" | "lower" | "title" };

const kindOf = ({ input, value, dated }: SeriesCell): Kind => {
  if (!input || input.startsWith("=")) return { kind: "copy" };
  if (NUMBER.test(input)) return dated && typeof value === "number" ? { kind: "date", n: value } : { kind: "number", n: Number(input) };
  // A date typed as 2026-01-30 is text to the engine, but a date to whoever typed it: it steps by days, months or years, written as it was.
  const iso = ISO.exec(input), day = iso && Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  if (day !== null && day !== undefined && civil(day / DAY + EPOCH).toISOString().slice(0, 10) === input) return { kind: "date", n: day / DAY + EPOCH, iso: true };
  const lower = input.toLowerCase();
  for (const [names, { long, short }] of NAMES.entries()) {
    const n = long.get(lower) ?? short.get(lower);
    if (n !== undefined) return { kind: "named", names, n, long: long.has(lower), caps: input === input.toUpperCase() ? "upper" : input === lower ? "lower" : "title" };
  }
  const counted = COUNTED.exec(input);
  return counted ? { kind: "counted", stem: counted[1]!, n: Number(counted[2]), width: counted[2]!.length } : { kind: "copy" };
};
const sameRun = (a: Kind, b: Kind) => a.kind !== "copy" && a.kind === b.kind && (a.kind !== "counted" || a.stem === (b as typeof a).stem) && (a.kind !== "named" || a.names === (b as typeof a).names);
// 0.1 + 0.2 is drawn 0.3, as a sheet keeps 15 digits.
const tidy = (n: number) => Number(n.toPrecision(15));
// Least squares over the run's positions, as Excel's linear trend: an even run's own step.
const trend = (ns: number[]) => {
  const k = ns.length, mean = (k - 1) / 2, avg = ns.reduce((a, b) => a + b, 0) / k;
  const slope = ns.reduce((sum, n, x) => sum + (x - mean) * (n - avg), 0) / ns.reduce((sum, _, x) => sum + (x - mean) ** 2, 0);
  return (p: number) => avg + slope * (p - mean);
};
const civil = (serial: number) => new Date(Math.round((serial - EPOCH) * DAY));
const monthOf = (serial: number) => { const d = civil(serial); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
// The run's dates a whole number of months apart on one day of the month: the month steps by that (12 is a year), the day kept or cut to the month's last.
const byMonth = (ns: number[]) => {
  const day = civil(ns[0]!).getUTCDate(), months = ns.map(monthOf), step = months[1]! - months[0]!;
  if (!step || ns.some((n, x) => civil(n).getUTCDate() !== day || months[x]! - months[0]! !== step * x)) return null;
  const time = ns[0]! - Math.floor(ns[0]!);
  return (p: number) => {
    const month = months[0]! + step * p, year = Math.floor(month / 12), at = month - year * 12, last = new Date(Date.UTC(year, at + 1, 0)).getUTCDate();
    return Date.UTC(year, at, Math.min(day, last)) / DAY + EPOCH + time;
  };
};

/** The run's cell at position `p` of its own series (0 is its first source cell); `unit` is the step of a run of one: 1, or -1 filling backwards. */
const continueRun = (run: Kind[], inputs: string[], p: number, unit: number, counting: boolean): string => {
  const first = run[0]!, k = run.length, ns = run.map((one) => (one as { n: number }).n);
  // Ctrl turns Excel's choice round: a lone number counts, any other run is copied.
  const copied = first.kind === "number" && k === 1 ? !counting : counting;
  if (first.kind === "copy" || copied) return inputs[p % k]!;
  const at = k === 1 ? (q: number) => ns[0]! + unit * q : trend(ns);
  switch (first.kind) {
    case "number": return String(tidy(at(p)));
    case "date": { const n = tidy(((k > 1 ? byMonth(ns) : null) ?? at)(p)); return first.iso ? civil(Math.round(n)).toISOString().slice(0, 10) : String(n); }
    case "counted": { const n = String(Math.abs(Math.round(at(p)))); return first.stem + n.padStart(first.width, "0"); }
    case "named": {
      const { list } = NAMES[first.names]!, size = list.length, step = k === 1 ? unit : ((ns[1]! - ns[0]!) % size + size) % size;
      const name = list[(((ns[0]! + step * p) % size) + size) % size]!, cut = first.long ? name : name.slice(0, 3);
      return first.caps === "upper" ? cut.toUpperCase() : first.caps === "lower" ? cut.toLowerCase() : cut;
    }
  }
};

/** `count` cells after `line`, nearest first; `back` fills before it (upward or leftward), its pattern run the other way. `counting`: Ctrl held. */
export function continueLine(line: readonly SeriesCell[], count: number, back = false, counting = false): string[] {
  const cells = back ? [...line].reverse() : line, size = cells.length, kinds = cells.map(kindOf), runs: { start: number; kinds: Kind[]; inputs: string[] }[] = [], runAt: number[] = [];
  kinds.forEach((one, x) => {
    const last = runs.at(-1);
    if (last && sameRun(last.kinds[0]!, one)) { last.kinds.push(one); last.inputs.push(cells[x]!.input); } else runs.push({ start: x, kinds: [one], inputs: [cells[x]!.input] });
    runAt.push(runs.length - 1);
  });
  return Array.from({ length: count }, (_, i) => {
    const q = size + i, cycle = Math.floor(q / size), x = q % size, run = runs[runAt[x]!]!;
    return continueRun(run.kinds, run.inputs, cycle * run.kinds.length + x - run.start, back ? -1 : 1, counting);
  });
}

/**
 * The cells a fill-handle drag adds beside `source` (rows of cells), in sheet order: `count` rows below it ("down") or above ("up"), or columns
 * right or left of it. Each column of the source carries on down or up on its own, each row right or left.
 */
export function seriesFill(source: readonly (readonly SeriesCell[])[], direction: "down" | "up" | "right" | "left", count: number, counting = false): string[][] {
  const back = direction === "up" || direction === "left", order = (cells: string[]) => back ? cells.reverse() : cells;
  if (direction === "right" || direction === "left") return source.map((row) => order(continueLine(row, count, back, counting)));
  const cols = source[0]!.map((_, c) => order(continueLine(source.map((row) => row[c]!), count, back, counting)));
  return Array.from({ length: count }, (_, r) => cols.map((col) => col[r]!));
}
