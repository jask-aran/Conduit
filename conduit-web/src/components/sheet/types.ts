/*
 * Cell types on the page (sheet-types.js): each cell's type indexed from the look as it changes, so the grid finds a drawn cell's in a few map reads and
 * its tab's dropdowns' boxes; the selection's type set from the cell menu; a dropdown's options; and a date typed into a date cell read as one.
 */
import { createSignal, onCleanup, type Accessor } from "solid-js";
import type * as Y from "yjs";
import { key, type SheetView } from "@/sheet-format.js";
import { areasOf, editValidations, listFields, optionsOf, PLAIN, readValidations, writeType, type SheetOption } from "@/sheet-types.js";
import type { SheetRange } from "./host";

export type SheetTypeKind = "boolean" | "date" | "list";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number) => { const day = new Date(Date.UTC(y, m - 1, d)); return day.getUTCMonth() === m - 1 && day.getUTCDate() === d ? day.toISOString().slice(0, 10) : null; };

/** A date as typed (2026-03-15, 15/3/2026, 15/3/26, 15 Mar 2026, Mar 15 2026) as the ISO text Ctrl+; writes; null for anything else. Day before month, as the sheet's Date format. */
export function readDate(text: string): string | null {
  const typed = text.trim().toLowerCase();
  let hit = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(typed);
  if (hit) return iso(+hit[1]!, +hit[2]!, +hit[3]!);
  if ((hit = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(typed))) return iso(hit[3]!.length === 2 ? 2000 + +hit[3]! : +hit[3]!, +hit[2]!, +hit[1]!);
  const month = (word: string) => MONTHS.indexOf(word.slice(0, 3)) + 1;
  if ((hit = /^(\d{1,2}) ([a-z]+),? (\d{4})$/.exec(typed)) && month(hit[2]!)) return iso(+hit[3]!, month(hit[2]!), +hit[1]!);
  if ((hit = /^([a-z]+) (\d{1,2}),? (\d{4})$/.exec(typed)) && month(hit[1]!)) return iso(+hit[3]!, month(hit[1]!), +hit[2]!);
  return null;
}
/** ISO text as the serial number a date format draws. */
export const serialOf = (text: string) => /^\d{4}-\d{2}-\d{2}$/.test(text) ? Date.parse(`${text}T00:00:00Z`) / 864e5 + 25569 : null;

export interface SheetTypes {
  /** A drawn cell's type (`boolean`, `date`, `list:<n>` for the tab's nth validation, or an import's `number`); undefined for plain. Not tracked. */
  at(row: number, col: number): string | undefined;
  /** A dropdown's options, by its type; null where its list is cells on another tab. Not tracked. */
  options(type: string): readonly SheetOption[] | null;
  /** The cells a dropdown covers. */
  areas(type: string): readonly SheetRange[];
  /** The kind every cell of the range shares (undefined: plain), null where they differ; tracked. */
  uniform(range: SheetRange): SheetTypeKind | undefined | null;
  /** The range takes the type (null: plain); a dropdown, `options`. */
  set(range: SheetRange, kind: SheetTypeKind | null, options?: readonly SheetOption[]): void;
  /** A dropdown's options changed, every cell of it following. */
  setOptions(type: string, options: readonly SheetOption[]): void;
  /** What is written into a cell as typed: a date cell's typed date as ISO text. */
  typed(row: number, col: number, input: string): string;
  /** Where a cell's link goes: its own (`link:<rowId>:<colId>`, as an xlsx import keeps a hyperlink; `#Tab!A1` a place in the workbook), else its text where that is a web or mail address. Not tracked. */
  link(row: number, col: number, text: string): string | undefined;
  /** A cell's own link set (null takes it off). */
  setLink(row: number, col: number, address: string | null): void;
}

const WEB = /^(https?:\/\/|www\.)[^\s]+$/i, MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A cell's text as the address it links to, where it is one. */
export const addressOf = (text: string) => WEB.test(text) ? (/^www\./i.test(text) ? `https://${text}` : text) : MAIL.test(text) ? `mailto:${text}` : undefined;

type Dropdown = { areas: SheetRange[]; options: SheetOption[] | null; source: SheetRange | null };
export function createSheetTypes(look: Y.Map<number | string>, model: Accessor<SheetView | undefined>, failed: (message: string) => void): SheetTypes {
  const columns = new Map<string, string>(), cells = new Map<string, string>(), links = new Map<string, string>(), lists = new Map<string, (Dropdown | null)[]>(), [changed, setChanged] = createSignal(0);
  const kept = look as unknown as Y.Map<unknown>;
  const index = (name: string) => {
    if (name.startsWith("validations:")) {
      // A list of cells on its own tab is read from them as drawn; one on another tab lists nothing.
      lists.set(name.slice(12), readValidations(kept, name.slice(12)).map((one) => {
        if (one.type !== "list") return null;
        const options = optionsOf(one), source = options ? null : /^\$?[A-Z]+\$?\d+(:\$?[A-Z]+\$?\d+)?$/i.test(String(one.formula1 ?? "")) ? areasOf({ range: String(one.formula1) })[0] ?? null : null;
        return { areas: areasOf(one), options, source };
      }));
      return true;
    }
    if (name.startsWith("link:")) { const value = look.get(name); if (typeof value === "string" && value) links.set(name.slice(5), value); else links.delete(name.slice(5)); return false; }
    if (!name.startsWith("type:")) return false;
    const at = name.slice(5), value = look.get(name), to = at.includes(":") ? cells : columns;
    if (typeof value === "string") to.set(at, value); else to.delete(at);
    return true;
  };
  for (const name of look.keys()) index(name);
  const observe = (event: Y.YMapEvent<number | string>) => { let any = false; for (const name of event.keysChanged) any = index(name) || any; if (any) setChanged((n) => n + 1); };
  look.observe(observe);
  onCleanup(() => look.unobserve(observe));
  const listOf = (type: string) => { const tab = model()?.id; return tab ? lists.get(tab)?.[Number(type.slice(5))] ?? null : null; };
  const at = (row: number, col: number) => {
    const sheet = model(), colId = sheet?.colAt(col), tabLists = sheet?.id ? lists.get(sheet.id) : undefined;
    if (!colId) return undefined;
    if (tabLists) for (let n = 0; n < tabLists.length; n++) for (const area of tabLists[n]?.areas ?? []) if (row >= area.top && row <= area.bottom && col >= area.left && col <= area.right) return `list:${n}`;
    const type = (cells.size ? cells.get(key(sheet!.rowAt(row) ?? "", colId)) : undefined) ?? columns.get(colId);
    return type === PLAIN ? undefined : type;
  };
  const kindOf = (type?: string): SheetTypeKind | undefined => type === "boolean" || type === "date" ? type : type?.startsWith("list:") ? "list" : undefined;
  const act = (run: () => void) => { try { look.doc!.transact(run); } catch (error) { failed((error as Error).message); } };
  return {
    at,
    options: (type) => {
      const list = listOf(type), sheet = model();
      if (!list?.source || !sheet) return list?.options ?? null;
      const out: SheetOption[] = [];
      for (let row = list.source.top; row <= Math.min(list.source.bottom, list.source.top + 199); row++) for (let col = list.source.left; col <= list.source.right; col++) { const value = sheet.value(row, col); if (value !== null && value !== "") out.push({ value: String(value) }); }
      return out;
    },
    areas: (type) => listOf(type)?.areas ?? [],
    uniform: (range) => {
      changed();
      const sheet = model();
      if (!sheet) return null;
      const { rows, cols } = sheet.size(), bottom = Math.min(range.bottom, rows - 1, range.top + 999), right = Math.min(range.right, cols - 1);
      let shared: SheetTypeKind | undefined, first = true;
      for (let row = range.top; row <= bottom; row++) for (let col = range.left; col <= right; col++) { const kind = kindOf(at(row, col)); if (first) { shared = kind; first = false; } else if (kind !== shared) return null; }
      return shared;
    },
    set: (range, kind, options) => { const sheet = model(), tab = sheet?.id; if (sheet && tab) act(() => writeType(kept, sheet as SheetView & { id: string }, range, kind, range.top === 0 && range.bottom >= sheet.size().rows - 1, options)); },
    setOptions: (type, options) => { const tab = model()?.id, n = Number(type.slice(5)); if (tab) act(() => editValidations(kept, tab, (all) => all.map(({ inks: _, ...one }, at) => at === n ? { ...one, ...listFields(options) } : { ...one, ...(_ ? { inks: _ } : {}) }))); },
    link: (row, col, text) => {
      const sheet = links.size ? model() : undefined, own = sheet && links.get(key(sheet.rowAt(row) ?? "", sheet.colAt(col) ?? ""));
      return own ?? (text.includes("@") || text.includes(":") || text.startsWith("www.") ? addressOf(text) : undefined);
    },
    setLink: (row, col, address) => { const sheet = model(), rowId = sheet?.rowAt(row), colId = sheet?.colAt(col); if (rowId && colId) { if (address) look.set(`link:${key(rowId, colId)}`, address); else look.delete(`link:${key(rowId, colId)}`); } },
    typed: (row, col, input) => at(row, col) === "date" && input && !input.startsWith("=") ? readDate(input) ?? input : input,
  };
}
