/*
 * Data validation on the page (sheet-valid.js): each write judged before it lands, as the hub judges its own; what needs the engine (a formula typed
 * into a ruled cell, a custom rule, an operand that is a formula or a name) is sent as the hub's `set`, which refuses it with the rule's message. A cell
 * already breaking its rule is drawn with a corner mark; a rule's input message is shown while its cell is selected.
 */
import type * as Y from "yjs";
import { parseRange, type SheetView } from "@/sheet-format.js";
import { readValidations, type SheetValidation } from "@/sheet-types.js";
import { breaks, constant, entryValue, refusal, ruleAt, writeRule, type SheetRule } from "@/sheet-valid.js";
import type { SheetRange } from "./host";

type Cell = { row: number; col: number; input: string };
type Sheet = SheetView & { id: string };
const CELL = /^\$?[A-Z]{1,3}\$?\d+$/i, RANGE = /^\$?[A-Z]{1,3}\$?\d+(:\$?[A-Z]{1,3}\$?\d+)?$/i;
const bare = (formula: unknown) => String(formula ?? "").trim().replace(/^=/, "");

export function createSheetValidity(look: Y.Map<number | string>, model: () => SheetView | undefined) {
  const kept = look as unknown as Y.Map<unknown>;
  // The tab's rules, read again only when their text changes.
  let text: unknown, tab: string | undefined, all: Record<string, SheetValidation> = {};
  const rules = (sheet: Sheet) => { const now = look.get(`validations:${sheet.id}`); if (now !== text || tab !== sheet.id) { text = now; tab = sheet.id; all = now ? readValidations(kept, sheet.id) : {}; } return all; };
  const sheetOf = () => { const sheet = model(); return sheet?.id ? sheet as Sheet : undefined; };
  const ruleOf = (sheet: Sheet, row: number, col: number): SheetRule | undefined => { const held = rules(sheet); for (const _ in held) return ruleAt(kept, sheet, row, col, held); return undefined; };
  // Operands the page can read: constants, and cells of the tab shown. Anything else is the hub's.
  const reads = (sheet: Sheet) => ({
    read: (formula: unknown) => { const one = constant(formula); if (one !== undefined) return one; const at = CELL.test(bare(formula)) ? parseRange(bare(formula).replace(/\$/g, "")) : null; return at ? sheet.value(at.top, at.left) : undefined; },
    list: (formula: unknown) => {
      const at = RANGE.test(bare(formula)) ? parseRange(bare(formula).replace(/\$/g, "")) : null;
      if (!at) return undefined;
      const out: string[] = [];
      for (let row = at.top; row <= Math.min(at.bottom, at.top + 999); row++) for (let col = at.left; col <= at.right; col++) { const value = sheet.value(row, col); if (value !== null && value !== "") out.push(String(value)); }
      return out;
    },
    custom: () => undefined,
  });
  return {
    /** The cells a write may make here (`local`), those sent to the hub to be judged with the engine (`hub`), and why it is refused, if it is. */
    sort(list: readonly Cell[]): { local: Cell[]; hub: Cell[]; refused?: string; told?: string } {
      const sheet = sheetOf();
      if (!sheet || !Object.keys(rules(sheet)).length) return { local: [...list], hub: [] };
      const local: Cell[] = [], hub: Cell[] = [];
      let told: string | undefined;
      for (const cell of list) {
        const rule = cell.input ? ruleOf(sheet, cell.row, cell.col) : undefined;
        if (!rule) { local.push(cell); continue; }
        const broken = cell.input.startsWith("=") ? undefined : breaks(rule, entryValue(cell.input), reads(sheet));
        if (broken === undefined) { hub.push(cell); continue; }
        if (broken) { const said = refusal(rule, cell.row, cell.col); if (said.stop) return { local: [], hub: [], refused: said.message }; told ??= said.message; }
        local.push(cell);
      }
      return { local, hub, told };
    },
    /** Whether a drawn cell breaks its rule (a custom rule, or one reading what the page can't, is not marked). */
    invalid(row: number, col: number) {
      const sheet = sheetOf(), rule = sheet && ruleOf(sheet, row, col);
      return Boolean(rule && breaks(rule, sheet.value(row, col), reads(sheet)));
    },
    /** The selection's first cell's rule, tracked by the caller. */
    rule(range: SheetRange | null) { const sheet = sheetOf(); return range && sheet ? ruleOf(sheet, range.top, range.left) : undefined; },
    /** The range takes a rule (null: none), in the caller's step. */
    set(range: SheetRange, attributes: SheetValidation | null) { const sheet = sheetOf(); if (sheet) look.doc!.transact(() => writeRule(kept, sheet, range, attributes, range.top === 0 && range.bottom >= sheet.size().rows - 1)); },
  };
}
export type SheetValidity = ReturnType<typeof createSheetValidity>;
