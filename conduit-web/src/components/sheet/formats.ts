/*
 * Number formats on the page: each cell's format from the look (sheet-formats.js), drawn through numfmt while the grid draws, so each format is
 * compiled once (numfmt keeps each pattern parsed); and the selection's format set from the menu and Excel's keys.
 */
import { format as render, formatColor, getFormatInfo, isDateFormat, isValidFormat } from "numfmt";
import { createSignal, onCleanup, type Accessor } from "solid-js";
import type * as Y from "yjs";
import { key, type SheetView } from "@/sheet-format.js";
import { isGeneral, writeFormat } from "@/sheet-formats.js";
import type { SheetRange } from "./host";

/** A colour a format's section names, as the token the grid draws it in; one with no token here (blue, magenta…) draws as text. */
export type SheetHue = "destructive" | "live" | "warn";
/** Where a format's `*` fill stands in a drawn value, followed by the character it repeats: the grid draws what is before it at the cell's left and what is after at its right, as accounting formats put `$` and the figure (cell-draw.ts). */
export const SHEET_FILL = "\u0001";
/** A drawn value's text as words carry it (the foot's figures, find): its fill's mark gone. */
export const unfilled = (text: string) => text.includes(SHEET_FILL) ? text.replace(/\u0001[^]/g, "").trim() : text;
/** A value as its format draws it. */
export type SheetDrawn = { text: string; hue?: SheetHue };
/** A format the person picks by name (`id`: its tool's, sheet tools' `format-<id>`; `code`: the key under Ctrl+Shift, where it has one). */
export type SheetPreset = { id: string; name: string; format: string; code?: string; sample: string };

export const SHEET_PRESETS: readonly SheetPreset[] = [
  { id: "general", name: "General", format: "General", code: "Backquote", sample: "1234.5" },
  { id: "number", name: "Number", format: "#,##0.00", code: "Digit1", sample: "1,234.50" },
  { id: "currency", name: "Currency", format: "$#,##0.00", code: "Digit4", sample: "$1,234.50" },
  { id: "accounting", name: "Accounting", format: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)', sample: "$ 1,234.50" },
  { id: "percent", name: "Percent", format: "0%", code: "Digit5", sample: "12%" },
  { id: "scientific", name: "Scientific", format: "0.00E+00", code: "Digit6", sample: "1.23E+03" },
  { id: "date", name: "Date", format: "d/m/yyyy", code: "Digit3", sample: "15/3/2023" },
  { id: "long-date", name: "Long date", format: "d mmmm yyyy", sample: "15 March 2023" },
  { id: "time", name: "Time", format: "h:mm AM/PM", code: "Digit2", sample: "6:00 PM" },
];
const HUES: Readonly<Record<string, SheetHue>> = { red: "destructive", green: "live", yellow: "warn" };
// What a format holds that is not a placeholder: quoted text, an escaped character, [colour] or [condition], and _x or *x spacing.
const LITERAL = /"[^"]*"|\\.|\[[^\]]*\]|[_*]./g;
const PLACES = /[0#?][0#?,]*(\.[0#?]*)?|\.[0#?]+/;

type Compiled = { text: boolean; draw(value: number | string): SheetDrawn | null };
const compiled = new Map<string, Compiled | null>();
const compile = (pattern: string): Compiled | null => {
  if (compiled.has(pattern)) return compiled.get(pattern)!;
  // Each draw is made anew: values kept between frames outlived the young generation and brought a full collection (14 ms) into a scroll.
  const coloured = isValidFormat(pattern) && getFormatInfo(pattern).color === 1;
  const made: Compiled | null = isValidFormat(pattern) ? {
    // Text is drawn through a format only where it has a section for text (`@`).
    text: pattern.replace(LITERAL, "").includes("@"),
    draw: (value) => {
      try { const colour = coloured ? formatColor(pattern, value) : undefined; return { text: render(pattern, value, { fillChar: SHEET_FILL }), hue: typeof colour === "string" ? HUES[colour.toLowerCase()] : undefined }; } catch { return null; }
    },
  } : null;
  compiled.set(pattern, made);
  return made;
};

/** Each section's first run of digit places given one more decimal place, or one fewer; a date or a format of text alone is as it was. */
export function stepDecimals(pattern: string, by: 1 | -1): string {
  if (isDateFormat(pattern)) return pattern;
  const masked = pattern.replace(LITERAL, (literal) => "\0".repeat(literal.length)), edits: [number, number, string][] = [];
  let start = 0;
  for (const section of masked.split(";")) {
    const hit = PLACES.exec(section);
    if (hit) {
      const end = start + hit.index + hit[0].length, point = hit[0].indexOf("."), places = point < 0 ? -1 : hit[0].length - point - 1;
      if (by > 0) edits.push([end, end, point < 0 ? ".0" : "0"]);
      // The last place goes, and the point with it when it was the only one.
      else if (places >= 0) edits.push([end - (places === 1 ? 2 : 1), end, ""]);
    }
    start += section.length + 1;
  }
  return edits.reverse().reduce((text, [from, to, put]) => text.slice(0, from) + put + text.slice(to), pattern);
}

/** The sheet editor's formats: read by the grid as it draws, set from the menu and keys. */
export interface SheetFormats {
  /** The format a cell draws with (its own, else its column's); undefined for General. */
  at(row: number, col: number): string | undefined;
  /** A value as its cell's format draws it; null to draw it as it is (General, text where the format has no text section, a format numfmt cannot read). */
  draw(row: number, col: number, value: number | string): SheetDrawn | null;
  /** The format every cell of the range shares (undefined: General), or null where they differ; tracked where it is read. */
  uniform(range: SheetRange): string | undefined | null;
  /** The range takes the format: whole columns (top to the tab's last row) their columns', else each cell its own. */
  set(range: SheetRange, format: string): void;
  /** One more decimal place, or one fewer, from the first cell's format, for the whole range. */
  decimals(range: SheetRange, by: 1 | -1): void;
  /** Ctrl+Shift with 1 to 6 or `: a preset for the range. True when taken. */
  key(event: KeyboardEvent, range: SheetRange | null): boolean;
  /** How the range's figures (its sum, average…) are drawn: in its one format, or null where it has none or several. */
  figure(range: SheetRange | null): ((value: number) => string) | null;
  /** Whether a cell's format draws a date: the fill handle steps its number by days, months or years. */
  dated(row: number, col: number): boolean;
  /** The range a format of the person's own is being asked for (format-menu.tsx FormatPrompt), and `ask` to ask (null: done). */
  asking: Accessor<SheetRange | null>;
  ask(range: SheetRange | null): void;
}

export function createSheetFormats(look: Y.Map<number | string>, model: Accessor<SheetView | undefined>, failed: (message: string) => void): SheetFormats {
  // By column id, and by "<rowId>:<colId>"; "" is General set on a cell under a column that has a format.
  const columns = new Map<string, string>(), cells = new Map<string, string>(), [changed, setChanged] = createSignal(0), [asking, ask] = createSignal<SheetRange | null>(null);
  const index = (name: string) => {
    if (!name.startsWith("fmt:")) return false;
    const at = name.slice(4), value = look.get(name), to = at.includes(":") ? cells : columns;
    if (typeof value === "string") to.set(at, isGeneral(value) ? "" : value); else to.delete(at);
    return true;
  };
  for (const name of look.keys()) index(name);
  const observe = (event: Y.YMapEvent<number | string>) => { let any = false; for (const name of event.keysChanged) any = index(name) || any; if (any) setChanged((n) => n + 1); };
  look.observe(observe);
  onCleanup(() => look.unobserve(observe));

  const at = (row: number, col: number) => {
    const sheet = model(), colId = sheet?.colAt(col);
    if (!colId) return undefined;
    return ((cells.size ? cells.get(key(sheet!.rowAt(row)!, colId)) : undefined) ?? columns.get(colId)) || undefined;
  };
  const set = (range: SheetRange, format: string) => {
    const sheet = model();
    if (!sheet) return;
    try { look.doc!.transact(() => writeFormat(look, sheet, range, format, range.top === 0 && range.bottom >= sheet.size().rows - 1)); } catch (error) { failed((error as Error).message); }
  };
  return {
    at, asking, ask,
    dated: (row, col) => { const pattern = at(row, col); return Boolean(pattern && isDateFormat(pattern)); },
    draw: (row, col, value) => {
      const pattern = at(row, col), made = pattern ? compile(pattern) : null;
      return made && (typeof value === "number" || made.text) ? made.draw(value) : null;
    },
    uniform: (range) => {
      changed();
      const sheet = model();
      if (!sheet) return null;
      const { rows, cols } = sheet.size(), area = { ...range, bottom: Math.min(range.bottom, rows - 1), right: Math.min(range.right, cols - 1) };
      let shared: string | undefined, first = true;
      const agree = (format: string | undefined) => { if (first) { shared = format; first = false; } return format === shared; };
      // Each cell's own format, then each column's where some of its cells have none of their own.
      const owned = new Map<number, number>();
      for (const [name, format] of cells) {
        const cut = name.indexOf(":"), row = sheet.indexOfRow(name.slice(0, cut)), col = sheet.indexOfCol(name.slice(cut + 1));
        if (row < area.top || row > area.bottom || col < area.left || col > area.right) continue;
        if (!agree(format || undefined)) return null;
        owned.set(col, (owned.get(col) ?? 0) + 1);
      }
      for (let col = area.left; col <= area.right; col++) if ((owned.get(col) ?? 0) <= area.bottom - area.top && !agree(columns.get(sheet.colAt(col)!) || undefined)) return null;
      return shared;
    },
    set,
    decimals: (range, by) => {
      const sheet = model(), pattern = at(range.top, range.left);
      if (!sheet) return;
      if (pattern) { const next = stepDecimals(pattern, by); if (next !== pattern) set(range, next); return; }
      // From the range's first number (a General cell of text has no places of its own), as Excel steps from the numbers it shows.
      let value = sheet.value(range.top, range.left);
      for (let row = range.top, { rows, cols } = sheet.size(); typeof value !== "number" && row <= Math.min(range.bottom, rows - 1, range.top + 999); row++) for (let col = range.left; typeof value !== "number" && col <= Math.min(range.right, cols - 1); col++) value = sheet.value(row, col);
      const places = typeof value === "number" ? (String(Number(value.toPrecision(12))).split(".")[1]?.length ?? 0) + by : Math.max(0, by);
      set(range, places > 0 ? `0.${"0".repeat(places)}` : "0");
    },
    key: (event, range) => {
      const preset = event.shiftKey && !event.altKey && (event.ctrlKey || event.metaKey) ? SHEET_PRESETS.find((one) => one.code === event.code) : undefined;
      if (!preset || !range) return false;
      event.preventDefault();
      set(range, preset.format);
      return true;
    },
    figure(range) { const pattern = range && this.uniform(range), made = pattern ? compile(pattern) : null; return made && ((value) => unfilled(made.draw(value)?.text ?? String(value))); },
  };
}
