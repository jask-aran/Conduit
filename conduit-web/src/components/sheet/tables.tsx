/*
 * A tab's tables on the page (sheet-tables.js): each found where its corners' ids are now, read for every cell the grid draws, so parsed once a text
 * and placed again only where a corner moved. A table's header and total rows are bold, its data rows banded from the first.
 */
import { createSignal, Show, type Accessor } from "solid-js";
import type * as Y from "yjs";
import { Actions } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Field, Input } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { rangedArea, type SheetView } from "@/sheet-format.js";
import { freshName, nameFault, newTable, readTables, takenNames, writeTables, type SheetTable } from "@/sheet-tables.js";
import type { SheetRange } from "./host";

export type PlacedTable = { range: SheetRange; table: SheetTable };
export type SheetTables = ReturnType<typeof createSheetTables>;
const inside = (range: SheetRange, row: number, col: number) => row >= range.top && row <= range.bottom && col >= range.left && col <= range.right;
const meets = (one: SheetRange, two: SheetRange) => one.top <= two.bottom && two.top <= one.bottom && one.left <= two.right && two.left <= one.right;

export function createSheetTables(look: Y.Map<number | string>, model: Accessor<SheetView | undefined>) {
  let text: unknown, tab: string | undefined, list: SheetTable[] = [], placed: PlacedTable[] = [], ids: (string | undefined)[][] = [];
  const all = (): PlacedTable[] => {
    const sheet = model();
    if (!sheet?.id) return [];
    const now = look.get(`tables:${sheet.id}`) ?? look.get(`table:${sheet.id}`);
    if (now === text && tab === sheet.id && placed.every(({ range }, n) => sheet.rowAt(range.top) === ids[n]![0] && sheet.rowAt(range.bottom) === ids[n]![1] && sheet.colAt(range.left) === ids[n]![2] && sheet.colAt(range.right) === ids[n]![3])) return placed;
    if (now !== text || tab !== sheet.id) { text = now; tab = sheet.id; list = readTables(look, sheet.id); }
    placed = list.flatMap((table) => { const range = rangedArea(sheet, table); return range ? [{ range, table }] : []; });
    ids = placed.map(({ range }) => [sheet.rowAt(range.top), sheet.rowAt(range.bottom), sheet.colAt(range.left), sheet.colAt(range.right)]);
    return placed;
  };
  const at = (row: number, col: number) => all().find(({ range }) => inside(range, row, col)) ?? null;
  const save = (next: SheetTable[]) => { const id = model()?.id; if (id) writeTables(look, id, next); };
  const [renaming, setRenaming] = createSignal<PlacedTable | null>(null);
  return {
    all, at, renaming, setRenaming,
    /** Whether a range would overlap a table, as Excel refuses one table over another. */
    overlaps: (range: SheetRange) => all().some((one) => meets(one.range, range)),
    /** A new table over `range`, named Table1, Table2… as the workbook has none. */
    make: (range: SheetRange, header = true) => { const sheet = model(); if (sheet) save([...all().map((one) => one.table), newTable(sheet, range, freshName(takenNames(look)), header)]); },
    remove: (gone: PlacedTable) => save(all().map((one) => one.table).filter((one) => one.id !== gone.table.id)),
    /** Why a name won't do for the table (sheet-tables.js nameFault), or null. */
    fault: (one: PlacedTable, name: string) => { const taken = takenNames(look); taken.delete(one.table.name.toLowerCase()); return nameFault(name, taken); },
    rename: (one: PlacedTable, name: string) => save(all().map(({ table }) => table.id === one.table.id ? { ...table, name } : table)),
    /** A cell in a table's header (1) or total row (2), else 0. */
    edge: (row: number, col: number) => { const on = at(row, col); return !on ? 0 : row === on.range.top && on.table.header !== false ? 1 : row === on.range.bottom && on.table.total ? 2 : 0; },
    /** A table's data rows, every other one from the first. */
    banded: (row: number, col: number) => {
      const on = at(row, col);
      return Boolean(on && on.table.style !== "none" && !(on.table.total && row === on.range.bottom) && (row - on.range.top - (on.table.header === false ? 0 : 1)) % 2 === 0);
    },
  };
}

/** A table renamed: Excel's rules for a name, unique in the workbook. */
export function TablePrompt(props: { tables: SheetTables; onClose(): void }) {
  const [name, setName] = createSignal("");
  const fault = () => { const one = props.tables.renaming(); return one && name().trim() !== one.table.name ? props.tables.fault(one, name().trim()) : null; };
  const close = () => { props.tables.setRenaming(null); props.onClose(); };
  const save = (event: SubmitEvent) => {
    event.preventDefault();
    const one = props.tables.renaming();
    if (one && !fault() && name().trim() !== one.table.name) props.tables.rename(one, name().trim());
    close();
  };
  return <Dialog open={props.tables.renaming() !== null} title="Rename table" onOpenChange={(open) => { if (!open) close(); }}>
    <Show when={props.tables.renaming()}>{(one) => { setName(one().table.name); return <CardForm onSubmit={save}>
      <Field label="Table name"><Input value={name()} onInput={(event) => setName(event.currentTarget.value)} ref={(field) => queueMicrotask(() => field.select())} /></Field>
      <Show when={fault()}><p role="alert">{fault()}</p></Show>
      <Actions><Button type="button" variant="ghost" outline onClick={close}>Cancel</Button><Button type="submit" disabled={Boolean(fault())}>Rename</Button></Actions>
    </CardForm>; }}</Show>
  </Dialog>;
}
