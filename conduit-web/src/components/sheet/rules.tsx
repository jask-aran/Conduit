/*
 * Conditional formatting drawn (sheet-rules.js): the shown tab's rules from the look, compiled once a text, and each drawn cell's matches kept until
 * the sheet changes, so a frame's draws evaluate nothing twice; the styles they lay over a cell made once for each style and mix of matches, as
 * styles.ts makes its own (the grid compares them by identity).
 */
import { createSignal, For, Show, type Accessor } from "solid-js";
import type * as Y from "yjs";
import { Actions } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Field, Input, Segmented } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/menus";
import { COL_LIMIT, a1, key, type Range, type SheetView } from "@/sheet-format.js";
import { compileRule, readRules, RULE_LIMIT, ruleAreas, type RuleTest, type SheetCellValue, type SheetRule, type SheetRuleOp } from "@/sheet-rules.js";
import { decodeStyle, type StyleAttrs } from "@/sheet-styles.js";
import { PLAIN, type SheetCellStyle } from "./styles";

type Compiled = { rule: SheetRule; test: RuleTest; attrs: StyleAttrs };
const EDGES = [["bt", 1], ["br", 2], ["bb", 4], ["bl", 8]] as const;
const inside = (area: Range, row: number, col: number) => row >= area.top && row <= area.bottom && col >= area.left && col <= area.right;

/** `worn` with `attrs` over it: a flag or colour a rule sets replaces the cell's, one it leaves out stays. */
export function layStyle(worn: SheetCellStyle | undefined, attrs: StyleAttrs): SheetCellStyle {
  const base = worn ?? PLAIN, flag = (code: "b" | "i" | "u" | "s", was: boolean) => attrs[code] ?? was;
  const hue = <T,>(code: "c" | "f" | "bc", was: T) => code in attrs ? (attrs[code] ?? undefined) as T : was;
  const edges = EDGES.reduce((on, [code, bit]) => attrs[code] === true ? on | bit : attrs[code] === false ? on & ~bit : on, base.edges);
  const style = { ...base, bold: flag("b", base.bold), italic: flag("i", base.italic), underline: flag("u", base.underline), strike: flag("s", base.strike), color: hue("c", base.color), fill: hue("f", base.fill), edges, edgeColor: hue("bc", base.edgeColor) };
  style.custom = style.wrap || style.underline || style.strike || style.valign !== "middle";
  return style;
}

/** The rules a view's look holds for its tab, as one cell's matches (highest priority first) and as the style they lay over it. */
export function createRuleStyles(text: (id: string) => unknown, model: Accessor<SheetView | undefined>) {
  let said: unknown, id: string | undefined, list: Compiled[] = [], areas: Range[][] | null = null, wide = false;
  // A cell's matches by its position (row × COL_LIMIT + column), as their numbers joined ("" for none).
  let matched = new Map<number, string>();
  let laid = new WeakMap<SheetCellStyle, Map<string, SheetCellStyle>>(), plain = new Map<string, SheetCellStyle>();
  const read = (sheet: SheetView) => {
    const now = sheet.id ? text(sheet.id) : undefined;
    if (now === said && sheet.id === id) return;
    said = now; id = sheet.id; matched = new Map(); areas = null; laid = new WeakMap(); plain = new Map();
    list = readRules(now).flatMap((rule) => { const test = compileRule(rule); return test ? [{ rule, test, attrs: decodeStyle(rule.style) }] : []; });
    wide = list.some((one) => one.test.reads);
  };
  const get = (sheet: SheetView) => (row: number, col: number): SheetCellValue => { if (sheet.error(row, col) !== null) throw new Error("#VALUE!"); return sheet.value(row, col); };
  const matches = (sheet: SheetView, row: number, col: number) => {
    const at = row * COL_LIMIT + col;
    let hits = matched.get(at);
    if (hits === undefined) {
      areas ??= list.map((one) => ruleAreas(sheet, one.rule));
      const read = get(sheet), out: number[] = [];
      // A rule that stops (Excel's Stop If True) holding leaves the cell to no rule after it.
      for (let n = 0; n < list.length; n++) { const one = list[n]!; if (areas[n]!.some((area) => inside(area, row, col)) && one.test(row, col, read)) { out.push(n); if (one.rule.stop) break; } }
      matched.set(at, hits = out.join(" "));
    }
    return hits;
  };
  return {
    /** The cell's style with its matching rules' over it: of two that set the same thing, the higher's. Read as the grid draws. */
    style(worn: SheetCellStyle | undefined, row: number, col: number) {
      const sheet = model();
      if (!sheet) return worn;
      read(sheet);
      if (!list.length) return worn;
      const hits = matches(sheet, row, col);
      if (!hits) return worn;
      let byHits = worn ? laid.get(worn) : plain;
      if (!byHits) laid.set(worn!, byHits = new Map());
      let made = byHits.get(hits);
      if (!made) byHits.set(hits, made = layStyle(worn, Object.assign({}, ...hits.split(" ").reverse().map((n) => list[Number(n)]!.attrs)) as StyleAttrs));
      return made;
    },
    /** The sheet's values or rows changed: every cell is asked again. */
    changed() { matched = new Map(); areas = null; },
    /** A rule reads other cells than the one it is drawn in, so a change anywhere can restyle any cell it covers. */
    wide() { const sheet = model(); if (sheet) read(sheet); return wide; },
  };
}

/** The shown tab's rules drawn, and `add` and `clear` to write them (in the caller's history step). */
export function createSheetRules(look: Y.Map<number | string>, model: Accessor<SheetView | undefined>) {
  const drawn = createRuleStyles((id) => look.get(`rules:${id}`), model);
  return {
    ...drawn,
    /** A rule on `area` (clipped to the tab) put first, as a spreadsheet puts a new one. */
    add(area: Range, rule: Omit<SheetRule, "ranges" | "anchor">) {
      const sheet = model(), size = sheet?.size();
      if (!sheet?.id || !size || area.top >= size.rows || area.left >= size.cols) return;
      const from = key(sheet.rowAt(area.top)!, sheet.colAt(area.left)!), to = key(sheet.rowAt(Math.min(area.bottom, size.rows - 1))!, sheet.colAt(Math.min(area.right, size.cols - 1))!);
      look.set(`rules:${sheet.id}`, JSON.stringify([{ ...rule, ranges: [[from, to]], anchor: a1(area.top, area.left) }, ...readRules(look.get(`rules:${sheet.id}`))].slice(0, RULE_LIMIT)));
    },
    count: () => { const id = model()?.id; return id ? readRules(look.get(`rules:${id}`)).length : 0; },
    clear() { const id = model()?.id; if (id) look.delete(`rules:${id}`); },
  };
}
export type SheetRules = ReturnType<typeof createSheetRules>;

const OPS: readonly { value: SheetRuleOp; label: string }[] = [
  { value: ">", label: "Greater than" }, { value: "<", label: "Less than" }, { value: "between", label: "Between" }, { value: "=", label: "Equal to" },
  { value: ">=", label: "Greater than or equal to" }, { value: "<=", label: "Less than or equal to" }, { value: "<>", label: "Not equal to" }, { value: "notBetween", label: "Not between" },
];
// Excel's highlight presets, by its own colours.
const LOOKS = [
  { value: "f=#ffc7ce c=#9c0006", label: "Light red fill with dark red text" }, { value: "f=#ffeb9c c=#9c5700", label: "Yellow fill with dark yellow text" },
  { value: "f=#c6efce c=#006100", label: "Green fill with dark green text" }, { value: "f=#ffc7ce", label: "Light red fill" }, { value: "c=#9c0006", label: "Red text" }, { value: "b", label: "Bold text" },
];

/** A new rule for the selection (`area`, A1 in the title), and the tab's rules taken off. `onClose`: closed, whatever was done. */
export function RulePrompt(props: { area: Range | null; rules: SheetRules; act(label: string, run: () => void): void; onClose(): void }) {
  const [kind, setKind] = createSignal<"value" | "formula">("value"), [op, setOp] = createSignal<SheetRuleOp>(">"), [a, setA] = createSignal(""), [b, setB] = createSignal(""), [style, setStyle] = createSignal(LOOKS[0]!.value);
  const two = () => kind() === "value" && (op() === "between" || op() === "notBetween");
  const rule = () => { const text = (said: string) => said.trim().replace(/^=/, ""); return { kind: kind(), ...(kind() === "value" ? { op: op() } : {}), a: text(a()), ...(two() ? { b: text(b()) } : {}), style: style() }; };
  // Only a rule this sheet can draw is taken: one it cannot read would hold for nothing.
  const readable = () => Boolean(rule().a && (!two() || rule().b) && compileRule(rule()));
  const add = (event: SubmitEvent) => { event.preventDefault(); const area = props.area; if (area && readable()) props.act("Conditional formatting", () => props.rules.add(area, rule())); props.onClose(); };
  return <Dialog open={props.area !== null} title="New formatting rule" description={props.area ? `Cells ${a1(props.area.top, props.area.left)}${props.area.bottom > props.area.top || props.area.right > props.area.left ? `:${a1(props.area.bottom, props.area.right)}` : ""}` : undefined} onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <CardForm onSubmit={add}>
      <Segmented label="Rule" value={kind()} options={[{ value: "value", label: "Cell value" }, { value: "formula", label: "Formula" }]} onChange={setKind} />
      <Show when={kind() === "value"} fallback={<Field label="Formats where this is true"><Input aria-label="Formula" placeholder="=$B1>100" value={a()} onInput={(event) => setA(event.currentTarget.value)} /></Field>}>
        <Field label="Cell value is" plain><Select aria-label="Comparison" value={op()} onChange={(event) => setOp(event.currentTarget.value as SheetRuleOp)}><For each={OPS}>{(one) => <option value={one.value}>{one.label}</option>}</For></Select></Field>
        <Input aria-label={two() ? "From" : "Value"} value={a()} onInput={(event) => setA(event.currentTarget.value)} />
        <Show when={two()}><Input aria-label="To" value={b()} onInput={(event) => setB(event.currentTarget.value)} /></Show>
      </Show>
      <Field label="Format with" plain><Select aria-label="Format with" value={style()} onChange={(event) => setStyle(event.currentTarget.value)}><For each={LOOKS}>{(one) => <option value={one.value}>{one.label}</option>}</For></Select></Field>
      <Actions>
        <Show when={props.area && props.rules.count()}><Button type="button" variant="ghost" outline onClick={() => { props.act("Clear rules", () => props.rules.clear()); props.onClose(); }}>Clear sheet's rules</Button></Show>
        <Button type="button" variant="ghost" outline onClick={() => props.onClose()}>Cancel</Button><Button type="submit" disabled={!readable()}>Add</Button>
      </Actions>
    </CardForm>
  </Dialog>;
}
