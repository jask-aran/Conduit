/*
 * A tab's tables on the page (sheet-tables.js, the hub's code too): each found where its corners' ids are now, read for every cell the grid draws,
 * so parsed once a text and placed again only where a corner moved. A table's header and total rows are bold, its data rows banded in its style.
 * An entry beside a table grows it, as the hub's `set` does: watched here on the cells this page's own steps write, joined to the same step.
 */
import { createSignal, onCleanup, Show, type Accessor } from "solid-js";
import * as Y from "yjs";
import { Actions } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Field, Input, Switch } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { CELLS, key, parseRange, rangeA1, rangedArea, type SheetView } from "@/sheet-format.js";
import { shiftRefs } from "@/sheet-rules.js";
import { addTableRow, changeTable, infoOf, makeTable, nameFault, putFilter, readTables, rowsOf, TABLE_STYLE, tableWrites, takenNames, totalAt, totalOf, type PlacedTable, type SheetTable, type SheetTableChange } from "@/sheet-tables.js";
import { SheetStep } from "./history";
import type { SheetCellsOp, SheetRange } from "./host";
import type { SheetTypeKind } from "./types";

export type { PlacedTable };
export type SheetTables = ReturnType<typeof createSheetTables>;
type Asked = { kind: "make"; range: SheetRange; header: boolean } | { kind: "resize" | "rename"; table: PlacedTable };
const inside = (range: SheetRange, row: number, col: number) => row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
const meets = (one: SheetRange, two: SheetRange) => one.top <= two.bottom && two.top <= one.bottom && one.left <= two.right && two.left <= one.right;
// The styles offered, as Excel names them, and the wash each draws: Excel's Light, Medium and Dark n cycle its accents by n mod 7.
export const TABLE_STYLES = [{ label: "Blue", style: TABLE_STYLE }, { label: "Green", style: "TableStyleMedium7" }, { label: "Amber", style: "TableStyleMedium3" }, { label: "Grey", style: "TableStyleMedium1" }, { label: "None", style: "none" }];
const CYCLE = [1, 5, 3, 1, 3, 5, 4];
/** A style's wash: 0 none, 1 grey, else 2 + its ink in SHEET_INKS (red, amber, green, blue). */
const toneOf = (style = TABLE_STYLE) => style === "none" ? 0 : CYCLE[(Number(/(\d+)$/.exec(style)?.[1] ?? 2) - 1) % 7] ?? 1;
const TOTAL_NAMES: [string, string][] = [["none", "None"], ["sum", "Sum"], ["average", "Average"], ["count", "Count"], ["countNums", "Count numbers"], ["max", "Max"], ["min", "Min"]];

export function createSheetTables(look: Y.Map<number | string>, model: Accessor<SheetView | undefined>, act: (label: string, run: () => void) => void, hub: (op: SheetCellsOp) => void) {
  const doc = look.doc!, cells = doc.getMap<string>(CELLS);
  let text: unknown, tab: string | undefined, list: SheetTable[] = [], placed: PlacedTable[] = [], ids: (string | undefined)[][] = [];
  const all = (): PlacedTable[] => {
    const sheet = model();
    if (!sheet?.id) return placed = [];
    const now = look.get(`tables:${sheet.id}`) ?? look.get(`table:${sheet.id}`);
    if (now === undefined) { text = now; return placed.length ? placed = [] : placed; }
    if (now === text && tab === sheet.id && placed.every(({ range }, n) => sheet.rowAt(range.top) === ids[n]![0] && sheet.rowAt(range.bottom) === ids[n]![1] && sheet.colAt(range.left) === ids[n]![2] && sheet.colAt(range.right) === ids[n]![3])) return placed;
    if (now !== text || tab !== sheet.id) { text = now; tab = sheet.id; list = readTables(look, sheet.id); }
    placed = list.flatMap((table) => { const range = rangedArea(sheet, table); return range ? [{ range, table }] : []; });
    ids = placed.map(({ range }) => [sheet.rowAt(range.top), sheet.rowAt(range.bottom), sheet.colAt(range.left), sheet.colAt(range.right)]);
    return placed;
  };
  const at = (row: number, col: number) => { const every = all(); return every.length ? every.find(({ range }) => inside(range, row, col)) ?? null : null; };
  const set = (row: number, col: number, input: string) => { const sheet = model(), place = sheet && key(sheet.rowAt(row)!, sheet.colAt(col)!); if (!place) return; if (input) cells.set(place, input); else cells.delete(place); };
  // An entry this page's step wrote beside a table grows it, in the same step (history.ts joins a step's transactions).
  let growing = false;
  const grow = (event: Y.YMapEvent<string>) => {
    const sheet = model(), origin = event.transaction.origin;
    if (growing || !(origin instanceof SheetStep) || !sheet?.id || !all().length) return;
    const written = [...event.keysChanged].flatMap((place) => { const [row, col] = place.split(":"), r = sheet.indexOfRow(row!), c = sheet.indexOfCol(col!); return r >= 0 && c >= 0 ? [[r, c, cells.get(place) ?? ""] as const] : []; });
    growing = true;
    try { doc.transact(() => tableWrites(look, sheet, written, set, shiftRefs), origin); } finally { growing = false; }
  };
  cells.observe(grow);
  onCleanup(() => cells.unobserve(grow));
  const [asked, setAsked] = createSignal<Asked | null>(null);
  const run = (label: string, change: () => void) => act(label, () => { try { change(); } catch { /* checked before it is asked for */ } });
  const tables = {
    all, at, asked, setAsked,
    /** This tab's tables as structured references read them, by lowercased name (the formula editor's). */
    infos: () => { const sheet = model(); return new Map(sheet ? all().map((one) => [one.table.name.toLowerCase(), infoOf(sheet, one)] as const) : []); },
    /** Every tab's tables' names. */
    names: () => [...look.keys()].flatMap((name) => /^tables?:[^:]+$/.test(name) ? readTables(look, name.slice(name.indexOf(":") + 1)).map((one) => one.name) : []),
    /** A table asked for over a range, its first row a header where `header`: the prompt confirms both. */
    ask: (made: { range: SheetRange; header: boolean }) => setAsked({ kind: "make", ...made }),
    /** Why a range won't do for a new table (or the table resized), or null. */
    rangeFault: (range: SheetRange | null, resized?: PlacedTable) => {
      const size = model()?.size();
      if (!range || !size || range.bottom >= size.rows || range.right >= size.cols) return "Give the table's cells as an A1 range, such as A1:D20, on this tab";
      if (all().some((one) => one !== resized && meets(one.range, range))) return "A table can't overlap another table";
      if (resized && (range.top !== resized.range.top || range.bottom <= range.top)) return "A table's header stays in its first row, over at least one row of data";
      return null;
    },
    make: (range: SheetRange, header: boolean) => { const sheet = model(); if (sheet) run("Convert to table", () => makeTable(look, sheet, range, header, set)); },
    change: (one: PlacedTable, change: SheetTableChange, label = "Table") => { const sheet = model(); if (sheet) run(label, () => changeTable(look, sheet, one.table.id, change, set)); },
    /** Convert to range, by the hub, which writes the formulas reading it by A1 in the same step. */
    remove: (one: PlacedTable) => hub({ op: "table", table: { name: one.table.name, delete: true } }),
    /** A table's own filter written, in the caller's step. */
    put: (id: string, filter: Pick<SheetTable, "keep" | "when" | "hide">) => { const sheet = model(); if (sheet) putFilter(look, sheet, id, filter); },
    /** A row added under the table's last (Tab in its last cell), as one step; its index, or null where none can be. `pushed`: its total row was pushed down. */
    addRow: (one: PlacedTable, pushed = false) => { const sheet = model(); let row: number | null = null; if (sheet) act("Add table row", () => { row = addTableRow(look, sheet, one.table.id, set, shiftRefs, pushed); }); return row; },
    /** Why a name won't do for the table (sheet-tables.js nameFault), or null. */
    fault: (one: PlacedTable, name: string) => { const taken = takenNames(look); taken.delete(one.table.name.toLowerCase()); return nameFault(name, taken); },
    /** A cell in a table's header (1) or total row (2), else 0. */
    edge: (row: number, col: number) => { const on = at(row, col); return !on ? 0 : row === on.range.top && on.table.header !== false ? 1 : row === on.range.bottom && on.table.total ? 2 : 0; },
    /** A table's data rows, every other one from the first, by their wash (toneOf); 0 for any other cell. */
    banded: (row: number, col: number) => {
      const on = at(row, col);
      if (!on) return 0;
      const rows = rowsOf(on.range, on.table);
      return row >= rows.first && row <= rows.last && (row - rows.first) % 2 === 0 ? toneOf(on.table.style) : 0;
    },
    /** The table's actions for the palette and the cell menu's search: each runs once the menu has shut. `setType`: a range's cell type, as the menu's. */
    actions: (on: PlacedTable, setType: (range: SheetRange, kind: SheetTypeKind | null) => void, col = on.range.left) => {
      const sheet = model(), rows = rowsOf(on.range, on.table), data = { top: rows.first, bottom: rows.last, left: col, right: col }, total = sheet && on.table.total ? totalOf(sheet.input(rows.total, col)) ?? "none" : null;
      return [
        { label: "Rename table…", meta: on.table.name, run: () => setAsked({ kind: "rename", table: on }) },
        { label: "Resize table…", meta: rangeA1(on.range), run: () => setAsked({ kind: "resize", table: on }) },
        { label: on.table.total ? "Remove total row" : "Add total row", keys: ["Ctrl", "Shift", "T"], run: () => tables.change(on, { total: !on.table.total }, "Total row") },
        ...total !== null && col > on.range.left ? TOTAL_NAMES.map(([fn, label]) => ({ label: `Total: ${label}`, meta: fn === total ? "Now" : undefined, run: () => run("Total row", () => { if (sheet) set(rows.total, col, totalAt(sheet, on.table, on.range, col, fn)); }) })) : [],
        ...TABLE_STYLES.map((one) => ({ label: `Table style: ${one.label}`, meta: (on.table.style ?? TABLE_STYLE) === one.style ? "Now" : undefined, run: () => tables.change(on, { style: one.style }, "Table style") })),
        ...([["Plain", null], ["Checkbox", "boolean"], ["Date", "date"]] as const).map(([label, kind]) => ({ label: `Column type: ${label}`, run: () => setType(data, kind) })),
        { label: "Convert to range", run: () => act("Convert to range", () => tables.remove(on)) },
      ];
    },
  };
  return tables;
}

/** The table prompts: one made (its range, and whether its first row is a header), resized, or renamed. */
export function TablePrompt(props: { tables: SheetTables; onClose(): void }) {
  const [text, setText] = createSignal(""), [header, setHeader] = createSignal(true);
  const range = () => parseRange(text().trim().replace(/\$/g, "").toUpperCase());
  const fault = () => {
    const now = props.tables.asked();
    if (!now) return null;
    if (now.kind === "rename") return text().trim() === now.table.table.name ? null : props.tables.fault(now.table, text().trim());
    return props.tables.rangeFault(range(), now.kind === "resize" ? now.table : undefined);
  };
  const close = () => { props.tables.setAsked(null); props.onClose(); };
  const save = (event: SubmitEvent) => {
    event.preventDefault();
    const now = props.tables.asked(), area = range();
    if (!now || fault()) return;
    if (now.kind === "make" && area) props.tables.make(area, header());
    else if (now.kind === "resize" && area) props.tables.change(now.table, { range: area }, "Resize table");
    else if (now.kind === "rename" && text().trim() !== now.table.table.name) props.tables.change(now.table, { name: text().trim() }, "Rename table");
    close();
  };
  const title = () => ({ make: "Create table", resize: "Resize table", rename: "Rename table" })[props.tables.asked()?.kind ?? "make"];
  return <Dialog open={props.tables.asked() !== null} title={title()} onOpenChange={(open) => { if (!open) close(); }}>
    <Show when={props.tables.asked()}>{(now) => {
      const one = now();
      setText(one.kind === "rename" ? one.table.table.name : rangeA1(one.kind === "make" ? one.range : one.table.range)); setHeader(one.kind === "make" ? one.header : true);
      return <CardForm onSubmit={save}>
        <Field label={one.kind === "rename" ? "Table name" : "Where is the data for your table?"}><Input value={text()} onInput={(event) => setText(event.currentTarget.value)} ref={(field) => queueMicrotask(() => field.select())} /></Field>
        <Show when={one.kind === "make"}><Field label="My table has headers" inline plain><Switch label="My table has headers" checked={header()} onChange={setHeader} /></Field></Show>
        <Show when={fault()}><p role="alert">{fault()}</p></Show>
        <Actions><Button type="button" variant="ghost" outline onClick={close}>Cancel</Button><Button type="submit" disabled={Boolean(fault())}>{one.kind === "make" ? "Create" : one.kind === "resize" ? "Resize" : "Rename"}</Button></Actions>
      </CardForm>;
    }}</Show>
  </Dialog>;
}
