import type * as Y from "yjs";
import type { Range } from "./sheet-format.js";
import type { FormatSheet } from "./sheet-formats.js";
import type { SheetValidation } from "./sheet-types.js";

export type SheetRuleKind = "whole" | "decimal" | "list" | "date" | "time" | "textLength" | "custom";
export type SheetRuleOperator = "between" | "notBetween" | "equal" | "notEqual" | "greaterThan" | "lessThan" | "greaterThanOrEqual" | "lessThanOrEqual";
export const RULE_KINDS: SheetRuleKind[];
export const OPERATORS: SheetRuleOperator[];
export type SheetRule = SheetValidation & { id: string };
type Sheetish = FormatSheet & { id: string; indexOfRow(id: string): number; indexOfCol(id: string): number };
export function ruleAt(look: Y.Map<unknown>, sheet: Sheetish, row: number, col: number, all?: Record<string, SheetValidation>): SheetRule | undefined;
export function readTime(text: string): number | null;
export function entryValue(input: string): string | number | boolean | null;
export function constant(formula: unknown): string | number | undefined;
export type RuleReads = { read(formula: unknown): unknown; list(formula: unknown): readonly unknown[] | undefined; custom(formula: unknown): unknown };
export function breaks(rule: SheetValidation, value: unknown, reads: RuleReads): boolean | undefined;
export function ruleText(rule: SheetValidation, listed?: readonly unknown[]): string;
export function refusal(rule: SheetValidation, row: number, col: number, listed?: readonly unknown[]): { stop: boolean; style: "stop" | "warning" | "information"; message: string };
export function brokenText(count: number, first: string, verb: string): string;
export function customAt(formula: unknown, anchor: { row: number; col: number }, row: number, col: number, value: unknown): string;
export function anchorOf(look: Y.Map<unknown>, sheet: Sheetish, id: string): { row: number; col: number };
/** The Data validation dialog's form, as ruleFields reads it. */
export type RuleForm = { kind: SheetRuleKind | "any"; operator?: SheetRuleOperator; a?: string; b?: string; blank?: boolean; prompting?: boolean; promptTitle?: string; prompt?: string; alerting?: boolean; style?: "stop" | "warning" | "information"; errorTitle?: string; error?: string; inks?: Record<string, unknown>; dropDown?: boolean };
export function ruleFields(form: RuleForm): SheetValidation | null;
/** POST /v0/document/:id/cells `{ op: "validate", range, rule?, tab? }`: no `rule` lists the range's rules in this shape, `null` clears them. */
export type RuleSpec = { kind: SheetRuleKind; operator?: SheetRuleOperator; values?: string[]; blank?: boolean; input?: { title?: string; text?: string } | false; alert?: { style?: "stop" | "warning" | "information"; title?: string; text?: string } | false };
export function ruleSpec(rule: SheetValidation): RuleSpec;
export function writeRule(look: Y.Map<unknown>, sheet: Sheetish, area: Range, attributes: SheetValidation | null, columns: boolean): void;
