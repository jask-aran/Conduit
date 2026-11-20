/*
 * Cell types on the page (sheet-types.js): each cell's type indexed from the look as it changes, so the grid finds a drawn cell's in a few map reads and
 * its tab's dropdowns' boxes; the selection's type set from the cell menu; a dropdown's options; and a date typed into a date cell read as one.
 */
import { createSignal, onCleanup, type Accessor } from "solid-js";
import type * as Y from "yjs";
import { key, parseRange, type SheetView } from "@/sheet-format.js";
import { dateText, listFields, optionsOf, PLAIN, readDate, readValidations, setValidation, VALID, writeType, type SheetOption, type SheetValidation } from "@/sheet-types.js";
import type { SheetRange } from "./host";

export type SheetTypeKind = "boolean" | "date" | "list";
export interface SheetTypes {
  /** A drawn cell's type (`boolean`, `date`, `list:<n>` for the tab's nth validation, or an import's `number`); undefined for plain. Not tracked. */
  at(row: number, col: number): string | undefined;
  /** A dropdown's options, by its type; null where its list is cells on another tab. Not tracked. */
  options(type: string): readonly SheetOption[] | null;
  /** The cells a dropdown covers. */
  cells(type: string): readonly { row: number; col: number }[];
  /** The kind every cell of the range shares (undefined: plain), null where they differ; tracked. */
  uniform(range: SheetRange): SheetTypeKind | undefined | null;
  /** The range takes the type (null: plain); a dropdown, `options`. */
  set(range: SheetRange, kind: SheetTypeKind | null, options?: readonly SheetOption[]): void;
  /** A dropdown's options changed, every cell of it following. */
  setOptions(type: string, options: readonly SheetOption[]): void;
  /** What is written into a cell as typed: a date cell's typed date as its serial number. */
  typed(row: number, col: number, input: string): string;
  /** What a cell's input is shown and edited as: a date cell's serial number as its date. */
  shown(row: number, col: number, input: string): string;
  /** Where a cell's link goes: its own (`link:<rowId>:<colId>`, as an xlsx import keeps a hyperlink; `#Tab!A1` a place in the workbook), else its text where that is a web or mail address. Not tracked. */
  link(row: number, col: number, text: string): string | undefined;
  /** A cell's own link set (null takes it off). */
  setLink(row: number, col: number, address: string | null): void;
}

const WEB = /^(https?:\/\/|www\.)[^\s]+$/i, MAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A cell's text as the address it links to, where it is one. */
export const addressOf = (text: string) => WEB.test(text) ? (/^www\./i.test(text) ? `https://${text}` : text) : MAIL.test(text) ? `mailto:${text}` : undefined;

type Dropdown = { attributes: SheetValidation; options: SheetOption[] | null; source: string | null };
// A list's cells on its own tab, read as they are now (a table's column, `=Sales[Status]`, grows with it).
const RANGE = /^\$?[A-Z]+\$?\d+(:\$?[A-Z]+\$?\d+)?$/i;
const sourceOf = (sheet: SheetView, formula: string): SheetRange | null => { const text = (sheet.a1 ? sheet.a1(formula) : formula).replace(/^=/, ""); return RANGE.test(text) ? parseRange(text.replace(/\$/g, "")) : null; };
export function createSheetTypes(look: Y.Map<number | string>, model: Accessor<SheetView | undefined>, failed: (message: string) => void): SheetTypes {
  const columns = new Map<string, string>(), cells = new Map<string, string>(), links = new Map<string, string>(), lists = new Map<string, Dropdown>(), [changed, setChanged] = createSignal(0);
  const kept = look as unknown as Y.Map<unknown>;
  const index = (name: string) => {
    if (name.startsWith("validations:")) {
      // A list of cells on its own tab is read from them as drawn; one on another tab lists nothing.
      for (const [id, one] of Object.entries(readValidations(kept, name.slice(12)))) {
        if (one.type !== "list") continue;
        const options = optionsOf(one), source = options ? null : String(one.formula1 ?? "");
        lists.set(id, { attributes: one, options, source });
      }
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
  const listOf = (type: string) => lists.get(type.slice(5)) ?? null;
  // A list validation is a dropdown (`list:<id>`); any other is drawn plain.
  const at = (row: number, col: number) => {
    const sheet = model(), colId = sheet?.colAt(col);
    if (!colId) return undefined;
    const type = (cells.size ? cells.get(key(sheet!.rowAt(row) ?? "", colId)) : undefined) ?? columns.get(colId);
    return type === PLAIN ? undefined : type?.startsWith(VALID) ? (lists.has(type.slice(VALID.length)) ? `list:${type.slice(VALID.length)}` : undefined) : type;
  };
  const kindOf = (type?: string): SheetTypeKind | undefined => type === "boolean" || type === "date" ? type : type?.startsWith("list:") ? "list" : undefined;
  const act = (run: () => void) => { try { look.doc!.transact(run); } catch (error) { failed((error as Error).message); } };
  return {
    at,
    options: (type) => {
      const list = listOf(type), sheet = model(), source = list?.source && sheet ? sourceOf(sheet, list.source) : null;
      if (!source || !sheet) return list?.options ?? null;
      const out: SheetOption[] = [];
      for (let row = source.top; row <= Math.min(source.bottom, source.top + 199); row++) for (let col = source.left; col <= source.right; col++) { const value = sheet.value(row, col); if (value !== null && value !== "") out.push({ value: String(value) }); }
      return out;
    },
    cells: (type) => {
      const sheet = model(), out: { row: number; col: number }[] = [];
      if (!sheet) return out;
      const { rows, cols } = sheet.size();
      for (let col = 0; col < cols; col++) for (let row = 0; row < rows; row++) if (at(row, col) === type) out.push({ row, col });
      return out;
    },
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
    setOptions: (type, options) => { const tab = model()?.id, was = listOf(type)?.attributes; if (tab && was) { const { inks: _, ...rest } = was; act(() => setValidation(kept, tab, type.slice(5), { ...rest, ...listFields(options) })); } },
    link: (row, col, text) => {
      const sheet = links.size ? model() : undefined, own = sheet && links.get(key(sheet.rowAt(row) ?? "", sheet.colAt(col) ?? ""));
      return own ?? (text.includes("@") || text.includes(":") || text.startsWith("www.") ? addressOf(text) : undefined);
    },
    setLink: (row, col, address) => { const sheet = model(), rowId = sheet?.rowAt(row), colId = sheet?.colAt(col); if (rowId && colId) { if (address) look.set(`link:${key(rowId, colId)}`, address); else look.delete(`link:${key(rowId, colId)}`); } },
    shown: (row, col, input) => at(row, col) === "date" && /^\d+(\.\d+)?$/.test(input) && +input >= 61 ? dateText(+input) : input,
    typed: (row, col, input) => at(row, col) === "date" && input && !input.startsWith("=") ? String(readDate(input) ?? input) : input,
  };
}
