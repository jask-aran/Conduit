/*
 * A tab's filter (a spreadsheet's AutoFilter) and its tables, as its look holds them (sheet-format.d.ts SheetRangedLook, tables.tsx). The rows a filter
 * leaves out are hidden as hidden rows are (sizes.ts); a table's header is bold and its rows banded (grid.ts). Sorting, filtering and making a table act as a
 * spreadsheet's do: on the selection, or with one cell selected on the filter or table it is in, else on the block of filled cells around it.
 */
import { createMemo, createSignal, For, onCleanup, Show, type Accessor } from "solid-js";
import type * as Y from "yjs";
import { Actions, Icons, Item, SearchSection, Section } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Field, Input } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { DateField, type CalendarDay } from "@/components/ui/calendar";
import { readDate, serialDay } from "@/sheet-types.js";
import { sheetSortIcons as SortIcons } from "@/components/ui/sheet-icons";
import { Popover, PopoverContent, Select } from "@/components/ui/menus";
import { colName, filterHides, key as cellKey, rangeA1, rangedArea, valueText, type SheetFilterTest, type SheetFilterWhen, type SheetRangedLook, type SheetView } from "@/sheet-format.js";
import type { SheetBox, SheetCellsOp, SheetKey, SheetRange } from "./host";
import { PLAIN, type SheetCellStyle } from "./styles";
import { createSheetTables, TablePrompt, type PlacedTable } from "./tables";
import type { SheetTypeKind } from "./types";
import { rowsOf, tableFilter } from "@/sheet-tables.js";

// A column's values its filter lists, at most: Select all still reaches the rest.
const LISTED = 500;
// The filter applied again as it is opened, or as others' edits change what it hides, is no step of anyone's (history.ts tracks null and its steps).
const UNTRACKED = Symbol("refilter");
// A condition's test, as a spreadsheet's menu names it, and how many values it takes.
const TESTS: { is: SheetFilterTest; label: string; takes: 0 | 1 | 2; kind?: "number" | "date" }[] = [
  { is: "contains", label: "Text contains", takes: 1 }, { is: "not-contains", label: "Text does not contain", takes: 1 }, { is: "starts", label: "Text starts with", takes: 1 },
  { is: "ends", label: "Text ends with", takes: 1 }, { is: "equals", label: "Text is exactly", takes: 1 },
  { is: "greater", label: "Greater than", takes: 1, kind: "number" }, { is: "less", label: "Less than", takes: 1, kind: "number" }, { is: "between", label: "Between", takes: 2, kind: "number" },
  { is: "before", label: "Date is before", takes: 1, kind: "date" }, { is: "after", label: "Date is after", takes: 1, kind: "date" }, { is: "dates", label: "Date is between", takes: 2, kind: "date" },
  { is: "empty", label: "Is empty", takes: 0 }, { is: "filled", label: "Is not empty", takes: 0 },
];
const fits = (kind: "number" | "date" | undefined, text: string) => kind === "number" ? text.trim() !== "" && Number.isFinite(Number(text)) : kind === "date" ? readDay(text) !== null : text !== "";
type Ranged = { range: SheetRange; look: SheetRangedLook; table?: PlacedTable };
type What = "filter";
/** What key sequences and the menu do (sequences.tsx). `col`: the column sorted by; unsaid, the active cell's. */
export type SheetFilterKeys = { sort(descending: boolean, col?: number): void; filter(): void; table(): void };
export type SheetFilter = ReturnType<typeof createSheetFilter>;

const inside = (range: SheetRange, row: number, col: number) => row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
const byValue = (a: string, b: string) => a === b ? 0 : a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

/** The filled cells joined to a cell, across corners too, as a spreadsheet finds the data a cell is in: each side run out to its end, then the others again. */
export const regionAround = ({ rows, cols }: { rows: number; cols: number }, has: (row: number, col: number) => boolean, row: number, col: number): SheetRange => {
  const area = { top: row, bottom: row, left: col, right: col };
  const any = (top: number, bottom: number, left: number, right: number) => {
    for (let r = Math.max(0, top); r <= Math.min(rows - 1, bottom); r++) for (let c = Math.max(0, left); c <= Math.min(cols - 1, right); c++) if (has(r, c)) return true;
    return false;
  };
  for (let grew = true; grew;) {
    grew = false;
    while (area.top > 0 && any(area.top - 1, area.top - 1, area.left - 1, area.right + 1)) { area.top--; grew = true; }
    while (area.bottom < rows - 1 && any(area.bottom + 1, area.bottom + 1, area.left - 1, area.right + 1)) { area.bottom++; grew = true; }
    while (area.left > 0 && any(area.top - 1, area.bottom + 1, area.left - 1, area.left - 1)) { area.left--; grew = true; }
    while (area.right < cols - 1 && any(area.top - 1, area.bottom + 1, area.right + 1, area.right + 1)) { area.right++; grew = true; }
  }
  return area;
};

/** What the page lends a filter: its history's named steps, the grid's selection, and a range's cell type (sheet.tsx `setType`). */
/** `room`: Tab in a table's last cell with no free row under it: room made below it, then the row added. */
export type SheetFilterHost = { act(label: string, run: () => void): void; select(range: SheetRange): void; setType(range: SheetRange, kind: SheetTypeKind | null): void; room?(table: PlacedTable): void };
/** `bold`: whether a cell wears bold (styles.ts), which makes a first row a header. */
export function createSheetFilter(look: Y.Map<number | string>, model: Accessor<SheetView | undefined>, selection: Accessor<SheetRange | null>, hub: (op: SheetCellsOp) => void, bold: (row: number, col: number) => boolean, host: SheetFilterHost) {
  const [changed, setChanged] = createSignal(0);
  const observe = (event: Y.YMapEvent<number | string>) => { for (const name of event.keysChanged) if (name.startsWith("filter:") || name.startsWith("table:") || name.startsWith("tables:")) return void setChanged((n) => n + 1); };
  look.observe(observe);
  onCleanup(() => look.unobserve(observe));
  // Read for every cell the grid draws: parsed once a text, and its range found again only where its corners are no longer where they were.
  const held: Record<What, { text?: string; one: SheetRangedLook | null; at: Ranged | null; ids: (string | undefined)[] }> = { filter: { one: null, at: null, ids: [] } };
  const tables = createSheetTables(look, model, host.act);
  const read = (what: What): Ranged | null => {
    const sheet = model(), text = sheet?.id ? look.get(`${what}:${sheet.id}`) : undefined, one = held[what];
    if (!sheet || typeof text !== "string") return null;
    const at = one.at?.range;
    if (one.text === text && at && sheet.rowAt(at.top) === one.ids[0] && sheet.rowAt(at.bottom) === one.ids[1] && sheet.colAt(at.left) === one.ids[2] && sheet.colAt(at.right) === one.ids[3]) return one.at;
    if (one.text !== text) { one.text = text; try { one.one = JSON.parse(text) as SheetRangedLook; } catch { one.one = null; } }
    const range = rangedArea(sheet, one.one);
    one.at = range && one.one && { range, look: one.one };
    one.ids = range ? [sheet.rowAt(range.top), sheet.rowAt(range.bottom), sheet.colAt(range.left), sheet.colAt(range.right)] : [];
    return one.at;
  };
  // Every filter of the tab: its own, then each table's (its header row to its last data row); made again only when either changes.
  let ownWas: Ranged | null = null, tablesWas: readonly PlacedTable[] = [], every: Ranged[] = [];
  const all = (): Ranged[] => {
    const own = read("filter"), placed = tables.all(), sheet = model();
    if (own === ownWas && placed === tablesWas) return every;
    ownWas = own; tablesWas = placed;
    every = [...own ? [own] : [], ...placed.flatMap((table) => { const one = sheet && tableFilter(sheet, table.table, table.range); return one ? [{ range: { ...table.range, bottom: rowsOf(table.range, table.table).last }, look: one, table }] : []; })];
    return every;
  };
  // The filter the active cell is in, a table's first; else the tab's own.
  const current = (): Ranged | null => { const area = selection(), list = all(); return (area && [...list].reverse().find((one) => inside(one.range, area.top, area.left))) ?? read("filter"); };
  const write = (what: What, range: SheetRange | null, rest: Partial<SheetRangedLook> = {}) => {
    const sheet = model();
    if (!sheet?.id) return;
    if (!range) return void look.delete(`${what}:${sheet.id}`);
    const ids = [sheet.rowAt(range.top), sheet.colAt(range.left), sheet.rowAt(range.bottom), sheet.colAt(range.right)];
    if (ids.every(Boolean)) look.set(`${what}:${sheet.id}`, JSON.stringify({ ...rest, from: cellKey(ids[0]!, ids[1]!), to: cellKey(ids[2]!, ids[3]!) }));
  };
  // A filter written: the tab's own, or a table's `keep`, `when` and `hide`.
  const put = (on: Ranged, next: SheetRangedLook) => {
    if (!on.table) return write("filter", on.range, next);
    const { keep, when, hide } = next;
    tables.put(on.table.table.id, { keep, when, hide });
  };
  const text = (row: number, col: number) => valueText(model()?.value(row, col) ?? null);

  const block = (sheet: SheetView, row: number, col: number) => regionAround(sheet.size(), (r, c) => sheet.input(r, c) !== "", row, col);
  // A first row of text is a header where it is bold, where a row under it holds a number or TRUE/FALSE, or where each of its cells is said
  // nowhere else in its column. A one-column list of different words therefore keeps its first word on top: select the rest to sort it.
  const headed = (sheet: SheetView, range: SheetRange) => {
    const cols = Array.from({ length: range.right - range.left + 1 }, (_, c) => range.left + c), below = Array.from({ length: range.bottom - range.top }, (_, r) => range.top + 1 + r);
    const isText = (row: number, col: number) => { const value = sheet.value(row, col); return typeof value === "string" && value !== ""; };
    if (!below.length || !cols.every((col) => isText(range.top, col))) return false;
    return cols.every((col) => bold(range.top, col)) || below.some((row) => cols.some((col) => { const value = sheet.value(row, col); return typeof value === "number" || typeof value === "boolean"; }))
      || cols.every((col) => below.every((row) => text(row, col).toLowerCase() !== text(range.top, col).toLowerCase()));
  };
  // A lone cell is the filter or table it is in (a table's rows without its total row), else its block; whole columns are the block around their
  // first filled cell, as wide as they are.
  const target = (): { range: SheetRange; header: boolean } | null => {
    const area = selection(), sheet = model();
    if (!area || !sheet) return null;
    const { rows, cols } = sheet.size(), lone = area.top === area.bottom && area.left === area.right, columns = !lone && area.top === 0 && area.bottom >= rows - 1;
    if (lone) {
      const table = tables.at(area.top, area.left), filtered = read("filter");
      if (table) return { range: { ...table.range, bottom: rowsOf(table.range, table.table).last }, header: table.table.header !== false };
      if (filtered && inside(filtered.range, area.top, area.left)) return { range: filtered.range, header: true };
    }
    if (area.top >= rows || area.left >= cols) return null;
    let range = { ...area, bottom: Math.min(area.bottom, rows - 1), right: Math.min(area.right, cols - 1) };
    if (lone) range = block(sheet, area.top, area.left);
    else if (columns) {
      let first = -1;
      for (let row = 0; row < rows && first < 0; row++) for (let col = range.left; col <= range.right; col++) if (sheet.input(row, col) !== "") { first = row; break; }
      if (first < 0) return null;
      const found = block(sheet, first, range.left);
      range = { ...found, left: Math.min(found.left, range.left), right: Math.max(found.right, range.right) };
    }
    return { range, header: headed(sheet, range) };
  };
  const sortRange = (on: { range: SheetRange; header: boolean }, descending: boolean, col: number) =>
    hub({ op: "sort", range: rangeA1(on.range), column: colName(Math.min(Math.max(col, on.range.left), on.range.right)), descending, header: on.header });
  /** The values a column's rows under the filter's header show, each once, in order, "" (blank) last. */
  const values = (col: number) => {
    changed();
    const on = current(), seen = new Set<string>();
    if (on) for (let row = on.range.top + 1; row <= on.range.bottom; row++) seen.add(text(row, col));
    return [...seen].sort(byValue);
  };
  /** A column's own test, keeping its values or its condition (`when`), replaced (null: none), the filter applied with it. */
  const test = (col: number, values: ReadonlySet<string> | null, when: SheetFilterWhen | null) => {
    const on = current(), id = model()?.colAt(col);
    if (!on || !id) return;
    const keep = { ...on.look.keep }, whens = { ...on.look.when };
    delete keep[id]; delete whens[id];
    if (values) keep[id] = [...values];
    if (when) whens[id] = when;
    apply(on, { ...on.look, keep: Object.keys(keep).length ? keep : undefined, when: Object.keys(whens).length ? whens : undefined });
  };
  /** The values the filter keeps for a column; null for all. */
  const kept = (col: number): ReadonlySet<string> | null => { changed(); const id = model()?.colAt(col), list = id ? current()?.look.keep?.[id] : undefined; return list ? new Set(list) : null; };
  /** The filter written with the rows its kept values leave out now (`hide`), where that changes it. */
  const apply = (on: Ranged, next: SheetRangedLook) => {
    const sheet = model();
    if (!sheet) return;
    const hide = filterHides(sheet, next);
    if (["keep", "when"].every((what) => JSON.stringify(on.look[what as "keep"] ?? {}) === JSON.stringify(next[what as "keep"] ?? {})) && JSON.stringify(on.look.hide ?? []) === JSON.stringify(hide)) return;
    put(on, { ...next, hide: hide.length ? hide : undefined });
  };
  const bolded = new Map<SheetCellStyle | undefined, SheetCellStyle>();
  const here = () => { const area = selection(); return area ? tables.at(area.top, area.left) : null; };
  const keys: SheetFilterKeys = {
    sort: (descending, col) => { const on = target(); if (on) sortRange(on, descending, col ?? selection()?.left ?? on.range.left); },
    // In a table, its filter buttons shown or hidden; elsewhere the tab's own filter on or off.
    filter: () => {
      const table = here();
      if (table) return tables.change(table, { filter: table.table.filter === false }, table.table.filter === false ? "Filter" : "Remove filter");
      if (read("filter")) write("filter", null); else { const on = target(); if (on) write("filter", on.range); }
    },
    // A table asked for over the selection (Convert to table), or taken off where the active cell is in one (Convert to range).
    table: () => {
      const table = here();
      if (table) return host.act("Convert to range", () => tables.remove(table));
      const on = target();
      if (on) tables.ask({ range: on.range, header: on.header });
    },
  };
  // Ctrl+Space, Shift+Space and Ctrl+A in a table: its column's data, its row, its data; pressed again, with its header and total rows, then on as
  // the sheet's own.
  const pick = (kind: "cols" | "rows" | "all") => {
    const area = selection(), table = here();
    if (!area || !table) return false;
    const { range } = table, rows = rowsOf(range, table.table), data = { ...range, top: rows.first, bottom: rows.last };
    const same = (one: SheetRange) => one.top === area.top && one.bottom === area.bottom && one.left === area.left && one.right === area.right;
    const steps = kind === "cols" ? [{ ...data, left: area.left, right: area.right }, { ...range, left: area.left, right: area.right }] : kind === "rows" ? [{ ...area, left: range.left, right: range.right }] : [data, range];
    const next = steps.find((step, n) => !same(step) && (n === 0 || same(steps[n - 1]!)));
    if (!next) return false;
    host.select(next);
    return true;
  };
  return {
    keys, values, kept,
    /** What a sort or filter would act on now (the selection, or the block round a lone cell), and whether its first row is a header. */
    region: target,
    /** The block of filled cells joined to a cell. */
    around: (row: number, col: number) => { const sheet = model(); return sheet ? block(sheet, row, col) : null; },
    /** The filter the active cell is in (a table's own, else the tab's). */
    filter: () => { changed(); return current(); },
    /** The table the active cell is in. */
    table: () => { changed(); return here(); },
    tables,
    /** What only the palette and a search of the cell menu find of the active cell's table; each runs once the menu has shut. */
    tableActions: () => { changed(); const on = here(), area = selection(); return on ? tables.actions(on, (range, kind) => host.setType(range, kind), area?.left) : []; },
    /** A table column's data takes a cell type (from its header's menu), as rows it grows into do. */
    typeColumn: (col: number, kind: SheetTypeKind | null) => { const on = here(); if (on) { const rows = rowsOf(on.range, on.table); host.setType({ top: rows.first, bottom: rows.last, left: col, right: col }, kind); } },
    /** Sorts the filter's rows under its header by a column. */
    sortColumn: (col: number, descending: boolean) => { const on = current(); if (on) sortRange({ range: on.range, header: true }, descending, col); },
    /** The values a column keeps (null: every one), the filter applied with them; its condition goes. */
    keep: (col: number, values: ReadonlySet<string> | null) => test(col, values, null),
    /** A column's condition (null: none), in place of the values it kept. */
    when: (col: number): SheetFilterWhen | null => { changed(); const id = model()?.colAt(col); return (id && current()?.look.when?.[id]) || null; },
    setWhen: (col: number, when: SheetFilterWhen | null) => test(col, null, when),
    /** Whether a column keeps only some rows, by its values or its condition. */
    narrows: (col: number) => { changed(); const id = model()?.colAt(col), look = current()?.look; return Boolean(id && (look?.keep?.[id] || look?.when?.[id])); },
    /** The rows under the filter's header and how many it shows, while any column narrows them: the active cell's, else the first that does. */
    counted: () => {
      changed();
      const narrowing = (one: Ranged | null) => one && (Object.keys(one.look.keep ?? {}).length || Object.keys(one.look.when ?? {}).length) ? one : null;
      const on = narrowing(current()) ?? all().find(narrowing);
      if (!on) return null;
      const total = on.range.bottom - on.range.top;
      return { total, shown: total - (on.look.hide?.length ?? 0) };
    },
    /** Every filter applied again to the values its rows hold now, outside any step. */
    reapply: () => { const list = all(); if (list.length) look.doc!.transact(() => { for (const on of list) apply(on, on.look); }, UNTRACKED); },
    /** Rows a filter hides shown again, until it is applied again. */
    show: (rows: readonly number[]) => {
      const ids = new Set(rows.map((row) => model()?.rowAt(row)));
      for (const on of all()) {
        if (!on.look.hide?.some((id) => ids.has(id))) continue;
        const hide = on.look.hide.filter((id) => !ids.has(id));
        put(on, { ...on.look, hide: hide.length ? hide : undefined });
      }
    },
    /** The rows the filters hid when last applied (`hide`): one snapshot every page and the grid read alike. */
    hidden: (): ReadonlySet<number> => {
      const sheet = model(), out = new Set<number>();
      if (sheet) for (const on of all()) for (const id of on.look.hide ?? []) { const row = sheet.indexOfRow(id); if (row > on.range.top && row <= on.range.bottom) out.add(row); }
      return out;
    },
    /** A filter's mark on a header cell: 0 none, 1 a filter, 2 a filter keeping only some values. */
    mark: (row: number, col: number) => {
      const list = all();
      if (!list.length) return 0;
      const on = list.find((one) => row === one.range.top && col >= one.range.left && col <= one.range.right);
      if (!on) return 0;
      const id = model()?.colAt(col);
      return id && (on.look.keep?.[id] || on.look.when?.[id]) ? 2 : 1;
    },
    banded: tables.banded,
    /** A cell's style, bold in a table's header and total row. */
    style: (worn: SheetCellStyle | undefined, row: number, col: number) => {
      if (worn?.bold || !tables.edge(row, col)) return worn;
      let made = bolded.get(worn);
      if (!made) bolded.set(worn, made = { ...(worn ?? PLAIN), bold: true });
      return made;
    },
    /**
     * Ctrl+Shift+L turns the filter on or off; Ctrl+T and Ctrl+L ask for a table (a browser tab keeps Ctrl+T for a new tab; Ctrl+L reaches the page,
     * as the desktop app's both do); Ctrl+A in a table selects its data, then all of it. True when taken.
     */
    key: (event: KeyboardEvent) => {
      const ctrl = (event.ctrlKey || event.metaKey) && !event.altKey;
      if (ctrl && !event.shiftKey && event.code === "KeyA" && pick("all")) { event.preventDefault(); return true; }
      const table = here();
      if (ctrl && event.shiftKey && event.code === "KeyT" && table) { event.preventDefault(); tables.change(table, { total: !table.table.total }, "Total row"); return true; }
      const which = ctrl && event.shiftKey && event.code === "KeyL" ? keys.filter : ctrl && !event.shiftKey && (event.code === "KeyT" || event.code === "KeyL") ? () => { if (!here()) keys.table(); } : null;
      if (!which) return false;
      event.preventDefault();
      which();
      return true;
    },
    /** The grid's keys in a table: Ctrl+Space and Shift+Space select its column and row; Tab in its last cell adds a row. True when taken. */
    gridKey: (event: SheetKey) => {
      if (event.key === " " && event.ctrlKey !== event.shiftKey && !event.altKey && !event.metaKey && pick(event.ctrlKey ? "cols" : "rows")) { event.preventDefault(); return true; }
      if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return false;
      const area = selection(), table = here();
      if (!area || !table || area.top !== area.bottom || area.left !== area.right || area.left !== table.range.right || area.top !== rowsOf(table.range, table.table).last) return false;
      const row = tables.addRow(table);
      if (row === null && (table.table.total || !host.room)) return false;
      event.preventDefault();
      if (row === null) return host.room!(table), true;
      host.select({ top: row, bottom: row, left: table.range.left, right: table.range.left });
      return true;
    },
  };
}

/** A filter's column, opened from its header's mark: sorts by it, picks the values its rows may show (searched), or asks for a condition. */
export function FilterMenu(props: { filter: SheetFilter; at: { col: number; box: SheetBox } | null; frame: () => HTMLElement | undefined; onClose(): void }) {
  const col = () => props.at?.col ?? 0, kept = createMemo(() => props.filter.kept(col())), every = createMemo(() => props.filter.values(col())), all = () => kept() === null && !props.filter.when(col());
  const [query, setQuery] = createSignal(""), [asking, setAsking] = createSignal<number | null>(null);
  // Typed into its search, the list holds the values that hold it, and Select all picks those alone, as a spreadsheet's search does.
  const found = createMemo(() => { const asked = query().trim().toLowerCase(); return asked ? every().filter((value) => (value === "" ? "(blanks)" : value.toLowerCase()).includes(asked)) : every(); });
  const shows = (value: string) => !props.filter.when(col()) && (kept()?.has(value) ?? true);
  const toggle = (value: string) => {
    const next = new Set(props.filter.when(col()) ? [] : kept() ?? every());
    if (!next.delete(value)) next.add(value);
    props.filter.keep(col(), next.size === every().length ? null : next);
  };
  // The values found shown, and no others.
  const alone = () => found().every(shows) && every().every((value) => found().includes(value) || !shows(value));
  const pickFound = () => {
    if (!query().trim()) return props.filter.keep(col(), all() ? new Set() : null);
    props.filter.keep(col(), alone() ? new Set() : found().length === every().length ? null : new Set(found()));
  };
  const sort = (descending: boolean) => { props.filter.sortColumn(col(), descending); props.onClose(); };
  const close = () => { setQuery(""); setCursor(-1); props.onClose(); };
  const ask = () => { const at = col(); close(); setAsking(at); }, clear = () => { props.filter.keep(col(), null); close(); };
  // The keyboard stays in the search: Up and Down pick a row, Enter runs it (a value shown or hidden), or with none picked shows the values found alone.
  const [cursor, setCursor] = createSignal(-1);
  const typed = (kind: SheetTypeKind | null) => () => { props.filter.typeColumn(col(), kind); close(); };
  const types = () => props.filter.table() ? TYPES.map(([, kind]) => typed(kind)) : [], typesAt = () => 3 + Number(props.filter.narrows(col()));
  const rows = () => [() => sort(false), () => sort(true), ask, ...props.filter.narrows(col()) ? [clear] : [], ...types(), pickFound, ...found().slice(0, LISTED).map((value) => () => toggle(value))];
  const listed = () => rows().length - Math.min(found().length, LISTED) - 1;
  const key = (event: KeyboardEvent) => {
    const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
    if (step) { event.preventDefault(); setCursor((at) => Math.max(-1, Math.min(rows().length - 1, at + step))); }
    else if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      if (cursor() >= 0) rows()[cursor()]!();
      else if (query().trim()) { props.filter.keep(col(), found().length === every().length ? null : new Set(found())); close(); }
    }
  };
  return <>
    <Popover open={props.at !== null} onOpenChange={(open) => { if (!open) close(); }} anchorRef={props.frame} placement="bottom-start"
      anchorRect={() => { const box = props.at?.box; return box && new DOMRect(box.left, box.top, box.width, box.height); }}>
      <PopoverContent aria-label={`Filter column ${colName(col())}`} width="sm">
        <Section>
          <Item icon={<SortIcons.ascending />} active={cursor() === 0} onClick={() => sort(false)}>Sort A–Z</Item>
          <Item icon={<SortIcons.descending />} active={cursor() === 1} onClick={() => sort(true)}>Sort Z–A</Item>
        </Section>
        <Section>
          <Item icon={<SortIcons.filter />} meta={TESTS.find((one) => one.is === props.filter.when(col())?.is)?.label} active={cursor() === 2} onClick={ask}>Filter by condition…</Item>
          <Show when={props.filter.narrows(col())}><Item icon={<Icons.Erase />} active={cursor() === 3} onClick={clear}>Clear filter</Item></Show>
        </Section>
        <Show when={props.filter.table()}><Section title="Column type">
          <For each={TYPES}>{([label, kind], at) => <Item active={cursor() === typesAt() + at()} onClick={typed(kind)}>{label}</Item>}</For>
        </Section></Show>
        <SearchSection placeholder="Search values" value={query()} onInput={(text) => { setQuery(text); setCursor(-1); }} field={{ "aria-label": "Search values", onKeyDown: key }} />
        <Section title="Show" scroll>
          <Item picked={query().trim() ? found().length > 0 && alone() : all()} active={cursor() === listed()} onClick={pickFound}>{query().trim() ? "Select all found" : "Select all"}</Item>
          <For each={found().slice(0, LISTED)}>{(value, at) => <Item picked={shows(value)} active={cursor() === listed() + 1 + at()} onClick={() => toggle(value)}>{value === "" ? "(Blanks)" : value}</Item>}</For>
        </Section>
      </PopoverContent>
    </Popover>
    <FilterPrompt filter={props.filter} col={asking()} onClose={() => { setAsking(null); props.onClose(); }} />
    <TablePrompt tables={props.filter.tables} onClose={props.onClose} />
  </>;
}

const TYPES = [["Plain", null], ["Checkbox", "boolean"], ["Date", "date"]] as const;
const DATE_HINT = "30/1/2026";
// A condition's date is shown and typed as a date cell is (d/m/yyyy) and kept as ISO, which `dayOf` (sheet-format.js) reads.
function readDay(text: string) { const serial = readDate(text); return serial === null ? null : serialDay(serial); }
const writeDay = (day: CalendarDay) => `${day.day}/${day.month}/${day.year}`;
const isoDay = (text: string) => { const day = readDay(text); return day ? `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}` : text.trim(); };
/** A column's condition asked for: its test and the one or two values it compares with. */
function FilterPrompt(props: { filter: SheetFilter; col: number | null; onClose(): void }) {
  const [is, setIs] = createSignal<SheetFilterTest>("contains"), [a, setA] = createSignal(""), [b, setB] = createSignal("");
  const test = () => TESTS.find((one) => one.is === is())!, ready = () => (test().takes < 1 || fits(test().kind, a())) && (test().takes < 2 || fits(test().kind, b()));
  const set = (event: SubmitEvent) => {
    event.preventDefault();
    const col = props.col;
    const kept = (text: string) => test().kind === "date" ? isoDay(text) : text.trim();
    if (col !== null && ready()) props.filter.setWhen(col, { is: is(), ...(test().takes ? { a: kept(a()) || a() } : {}), ...(test().takes > 1 ? { b: kept(b()) } : {}) });
    props.onClose();
  };
  return <Dialog open={props.col !== null} title={`Filter column ${colName(props.col ?? 0)}`} onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <Show when={props.col === null ? null : [props.col]}>{(asked) => { const was = props.filter.when(asked()[0]!), shown = (text = "") => TESTS.find((one) => one.is === was?.is)?.kind === "date" && readDay(text) ? writeDay(readDay(text)!) : text;
      setIs(was?.is ?? "contains"); setA(shown(was?.a)); setB(shown(was?.b)); return <CardForm onSubmit={set}>
      <Field label="Show rows where" plain><Select aria-label="Condition" value={is()} onChange={(event) => setIs(event.currentTarget.value as SheetFilterTest)}><For each={TESTS}>{(one) => <option value={one.is}>{one.label}</option>}</For></Select></Field>
      <Show when={test().kind === "date"} fallback={<>
        <Show when={test().takes > 0}><Input aria-label={test().takes > 1 ? "From" : "Value"} value={a()} onInput={(event) => setA(event.currentTarget.value)} ref={(field) => queueMicrotask(() => field.focus())} /></Show>
        <Show when={test().takes > 1}><Input aria-label="To" value={b()} onInput={(event) => setB(event.currentTarget.value)} /></Show>
      </>}>
        <DateField aria-label={test().takes > 1 ? "From" : "Date"} placeholder={DATE_HINT} value={a()} onInput={setA} read={readDay} write={writeDay} autofocus />
        <Show when={test().takes > 1}><DateField aria-label="To" placeholder={DATE_HINT} value={b()} onInput={setB} read={readDay} write={writeDay} /></Show>
      </Show>
      <Actions><Button type="button" variant="ghost" outline onClick={() => props.onClose()}>Cancel</Button><Button type="submit" disabled={!ready()}>Filter</Button></Actions>
    </CardForm>; }}</Show>
  </Dialog>;
}
