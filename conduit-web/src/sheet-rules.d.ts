import type { Range, SheetView } from "./sheet-format.js";

export type SheetRuleOp = ">" | "<" | ">=" | "<=" | "=" | "<>" | "between" | "notBetween";
export const RULE_OPS: readonly SheetRuleOp[];
export type SheetTextOp = "contains" | "notContains" | "begins" | "ends";
export const TEXT_OPS: Readonly<Record<SheetTextOp, (text: string, said: string) => boolean>>;
export const RULE_LIMIT: number;
export type SheetCellValue = number | string | boolean | null;
/**
 * A rule in a tab's look (`rules:<tabId>`, a JSON list, the first over the rest): its ranges by their corners' ids, the cell its formulas were written
 * for (`anchor`, A1), and the style it lays over a cell it holds for (sheet-styles.js, packed). `a` (and `b` for between): a formula without its `=`,
 * which for a value rule is what the cell's value is compared with (`0`, `"done"`, `$B$2`); for a text rule (`kind: "text"`, op a SheetTextOp), the text itself. `stop`: a cell it holds for wears no rule after it.
 */
export type SheetRule = { ranges: [string, string][]; anchor: string; kind: "value" | "formula" | "text"; op?: SheetRuleOp | SheetTextOp; a: string; b?: string; style: string; stop?: boolean };
/** A rule as sheet.json and an agent read it: its ranges by A1 (`B5 B29:O29`), its formulas written for their top-left cell. */
export type SheetRuleA1 = Omit<SheetRule, "ranges" | "anchor"> & { ranges: string };
type Get = (row: number, col: number) => SheetCellValue;
export type RuleFormula = ((row: number, col: number, get: Get) => SheetCellValue) & { reads: boolean };
export type RuleTest = ((row: number, col: number, get: Get) => boolean) & { reads: boolean };
export function compareValues(a: SheetCellValue, b: SheetCellValue): number;
export function compileFormula(source: string | undefined, anchor: string): RuleFormula | null;
export function compileRule(rule: Pick<SheetRule, "kind" | "op" | "a" | "b"> & { anchor?: string }): RuleTest | null;
export function shiftRefs(formula: string, rows: number, cols: number): string;
export function readRules(text: unknown): SheetRule[];
export function ruleAreas(view: Pick<SheetView, "indexOfRow" | "indexOfCol">, rule: SheetRule): Range[];
export function rulesA1(view: Pick<SheetView, "indexOfRow" | "indexOfCol">, text: unknown): SheetRuleA1[];
export function rulesIds(view: Pick<SheetView, "size" | "rowAt" | "colAt">, list: unknown): string | undefined;
