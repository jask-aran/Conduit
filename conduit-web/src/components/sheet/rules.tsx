/*
 * Conditional formatting drawn (sheet-rules.js): the shown tab's rules from the look, compiled once a text, and each drawn cell's matches kept until
 * the sheet changes, so a frame's draws evaluate nothing twice; the styles they lay over a cell made once for each style and mix of matches, as
 * styles.ts makes its own (the grid compares them by identity).
 */
import { createEffect, createSignal, For, on, Show, type Accessor } from "solid-js";
import type * as Y from "yjs";
import { Actions } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Field, Input, Segmented } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { Row } from "@/components/ui/row";
import { MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubTrigger, Select } from "@/components/ui/menus";
import { PHONE_LAYOUT_QUERY } from "@/components/ui/layout";
import { Icons } from "@/components/ui";
import { COL_LIMIT, a1, key, rangeA1, type Range, type SheetView } from "@/sheet-format.js";
import { compileRule, readRules, RULE_LIMIT, ruleAreas, type RuleTest, type SheetCellValue, type SheetRule, type SheetRuleOp, type SheetTextOp } from "@/sheet-rules.js";
import { decodeStyle, type StyleAttrs } from "@/sheet-styles.js";
import { keptRules, type KeptMark } from "./scales";
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
  style.custom = style.wrap || style.underline || style.strike || style.valign !== "middle" || Boolean(style.double || style.shrink || style.indent || style.rotate || style.repeat);
  return style;
}

/** The rules a view's look holds for its tab, as one cell's matches (highest priority first) and as the style they lay over it. */
export function createRuleStyles(text: (id: string) => unknown, model: Accessor<SheetView | undefined>, keptText: (id: string) => unknown = () => undefined) {
  let said: unknown, saidKept: unknown, id: string | undefined, list: Compiled[] = [], areas: Range[][] | null = null, wide = false, kept = keptRules(undefined);
  // A kept rule's mark on a cell by its position, and the style it makes of each style it is laid over, by the mark's own key.
  let keptAt = new Map<number, { mark: KeptMark; key: string } | null>(), keptLaid = new WeakMap<SheetCellStyle, Map<string, SheetCellStyle>>();
  // A cell's matches by its position (row × COL_LIMIT + column), as their numbers joined ("" for none).
  let matched = new Map<number, string>();
  let laid = new WeakMap<SheetCellStyle, Map<string, SheetCellStyle>>(), plain = new Map<string, SheetCellStyle>();
  const read = (sheet: SheetView) => {
    const now = sheet.id ? text(sheet.id) : undefined, nowKept = sheet.id ? keptText(sheet.id) : undefined;
    if (now === said && nowKept === saidKept && sheet.id === id) return;
    said = now; saidKept = nowKept; id = sheet.id; matched = new Map(); areas = null; laid = new WeakMap(); plain = new Map();
    kept = keptRules(nowKept); keptAt = new Map(); keptLaid = new WeakMap();
    list = readRules(now).flatMap((rule) => { const test = compileRule(rule); return test ? [{ rule, test, attrs: decodeStyle(rule.style) }] : []; });
    wide = Boolean(kept.size) || list.some((one) => one.test.reads);
  };
  const keptOf = (sheet: SheetView, row: number, col: number) => {
    const at = row * COL_LIMIT + col;
    let found = keptAt.get(at);
    if (found === undefined) {
      const mark = kept.at(sheet, row, col);
      keptAt.set(at, found = mark ? { mark, key: JSON.stringify(mark) } : null);
    }
    return found;
  };
  // A kept rule's mark laid over the style the drawn rules made: one object for each style and mark.
  const layKept = (worn: SheetCellStyle | undefined, { mark, key }: { mark: KeptMark; key: string }) => {
    const base = worn ?? PLAIN;
    let byKey = keptLaid.get(base);
    if (!byKey) keptLaid.set(base, byKey = new Map());
    let made = byKey.get(key);
    if (!made) {
      made = mark.attrs ? layStyle(base, mark.attrs) : { ...base };
      if (mark.fill) made.fill = mark.fill;
      if (mark.bar) made.bar = mark.bar;
      if (mark.icon) { made.icon = mark.icon; made.custom = true; }
      if (mark.bare) made.bare = true;
      byKey.set(key, made);
    }
    return made;
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
      if (!list.length && !kept.size) return worn;
      const extra = kept.size ? keptOf(sheet, row, col) : null;
      const hits = list.length ? matches(sheet, row, col) : "";
      if (!hits) return extra ? layKept(worn, extra) : worn;
      let byHits = worn ? laid.get(worn) : plain;
      if (!byHits) laid.set(worn!, byHits = new Map());
      let made = byHits.get(hits);
      if (!made) byHits.set(hits, made = layStyle(worn, Object.assign({}, ...hits.split(" ").reverse().map((n) => list[Number(n)]!.attrs)) as StyleAttrs));
      return extra ? layKept(made, extra) : made;
    },
    /** The number format a matching rule gives the cell (a workbook's rule may carry one), the drawn rules' first; undefined for none. */
    fmt(row: number, col: number) {
      const sheet = model();
      if (!sheet) return undefined;
      read(sheet);
      const hits = list.length ? matches(sheet, row, col) : "";
      for (const n of hits ? hits.split(" ") : []) { const fmt = (list[Number(n)]!.rule as { fmt?: string }).fmt; if (fmt) return fmt; }
      return kept.size ? keptOf(sheet, row, col)?.mark.fmt : undefined;
    },
    /** The sheet's values or rows changed: every cell is asked again. */
    changed() { matched = new Map(); areas = null; if (kept.size) { kept.changed(); keptAt = new Map(); } },
    /** A rule reads other cells than the one it is drawn in, so a change anywhere can restyle any cell it covers. */
    wide() { const sheet = model(); if (sheet) read(sheet); return wide; },
  };
}

/** The shown tab's rules drawn, and `add` and `clear` to write them (in the caller's history step). */
export function createSheetRules(look: Y.Map<number | string>, model: Accessor<SheetView | undefined>) {
  const drawn = createRuleStyles((id) => look.get(`rules:${id}`), model, (id) => look.get(`rulesKept:${id}`)), [version, setVersion] = createSignal(0), [preset, prefer] = createSignal<RulePreset | null>(null);
  const own = () => { const id = model()?.id; return id ? readRules(look.get(`rules:${id}`)) : []; };
  return {
    ...drawn,
    /** The kind of rule the prompt opens on next (RulesMenu), taken as it opens. */
    preset, prefer,
    /** The tab's rules, first over the rest, as the dialog lists them. */
    list: () => { version(); const sheet = model(); return sheet ? own().map((rule) => ({ rule, ranges: ruleAreas(sheet, rule).map(rangeA1).join(" ") })) : []; },
    remove(at: number) { const id = model()?.id, list = own(); if (!id || !list[at]) return; list.splice(at, 1); if (list.length) look.set(`rules:${id}`, JSON.stringify(list)); else look.delete(`rules:${id}`); setVersion((n) => n + 1); },
    /** The rule at `at` said again (its ranges kept), or moved one place up, over the one before it. */
    change(at: number, rule: Omit<SheetRule, "ranges" | "anchor">) { const id = model()?.id, list = own(), was = list[at]; if (!id || !was) return; list[at] = { ...rule, ...(was.stop ? { stop: true } : {}), ranges: was.ranges, anchor: was.anchor }; look.set(`rules:${id}`, JSON.stringify(list)); setVersion((n) => n + 1); },
    raise(at: number) { const id = model()?.id, list = own(); if (!id || at < 1 || !list[at]) return; [list[at - 1], list[at]] = [list[at]!, list[at - 1]!]; look.set(`rules:${id}`, JSON.stringify(list)); setVersion((n) => n + 1); },
    /** A rule on `area` (clipped to the tab) put first, as a spreadsheet puts a new one. */
    add(area: Range, rule: Omit<SheetRule, "ranges" | "anchor">) {
      const sheet = model(), size = sheet?.size();
      if (!sheet?.id || !size || area.top >= size.rows || area.left >= size.cols) return;
      const from = key(sheet.rowAt(area.top)!, sheet.colAt(area.left)!), to = key(sheet.rowAt(Math.min(area.bottom, size.rows - 1))!, sheet.colAt(Math.min(area.right, size.cols - 1))!);
      look.set(`rules:${sheet.id}`, JSON.stringify([{ ...rule, ranges: [[from, to]], anchor: a1(area.top, area.left) }, ...readRules(look.get(`rules:${sheet.id}`))].slice(0, RULE_LIMIT)));
      setVersion((n) => n + 1);
    },
    count: () => { const id = model()?.id; return id ? readRules(look.get(`rules:${id}`)).length : 0; },
    clear() { const id = model()?.id; if (id) look.delete(`rules:${id}`); setVersion((n) => n + 1); },
  };
}
export type SheetRules = ReturnType<typeof createSheetRules>;

const OPS: readonly { value: SheetRuleOp; label: string }[] = [
  { value: ">", label: "Greater than" }, { value: "<", label: "Less than" }, { value: "between", label: "Between" }, { value: "=", label: "Equal to" },
  { value: ">=", label: "Greater than or equal to" }, { value: "<=", label: "Less than or equal to" }, { value: "<>", label: "Not equal to" }, { value: "notBetween", label: "Not between" },
];
const TEXTS: readonly { value: SheetTextOp; label: string }[] = [{ value: "contains", label: "Contains" }, { value: "notContains", label: "Does not contain" }, { value: "begins", label: "Begins with" }, { value: "ends", label: "Ends with" }];
type RuleKind = SheetRule["kind"];
/** A rule's kind and test the prompt opens on. */
export type RulePreset = { kind: RuleKind; op?: SheetRuleOp | SheetTextOp };
// Excel's highlight presets, by its own colours.
const said = (rule: SheetRule) => rule.kind === "formula" ? `Formula =${rule.a}` : rule.kind === "text" ? `Text ${TEXTS.find((one) => one.value === rule.op)?.label.toLowerCase() ?? rule.op} "${rule.a}"`
  : `Cell value ${OPS.find((one) => one.value === rule.op)?.label.toLowerCase() ?? rule.op} ${rule.a}${rule.b !== undefined ? ` and ${rule.b}` : ""}`;
const LOOKS = [
  { value: "f=#ffc7ce c=#9c0006", label: "Light red fill with dark red text" }, { value: "f=#ffeb9c c=#9c5700", label: "Yellow fill with dark yellow text" },
  { value: "f=#c6efce c=#006100", label: "Green fill with dark green text" }, { value: "f=#ffc7ce", label: "Light red fill" }, { value: "c=#9c0006", label: "Red text" }, { value: "b", label: "Bold text" },
];

/** A new rule for the selection (`area`, A1 in the title), and the tab's rules taken off. `onClose`: closed, whatever was done. */
export function RulePrompt(props: { area: Range | null; rules: SheetRules; act(label: string, run: () => void): void; onClose(): void }) {
  const [kind, setKind] = createSignal<RuleKind>("value"), [op, setOp] = createSignal<SheetRuleOp | SheetTextOp>(">"), [a, setA] = createSignal(""), [b, setB] = createSignal(""), [style, setStyle] = createSignal(LOOKS[0]!.value);
  const two = () => kind() === "value" && (op() === "between" || op() === "notBetween");
  const rule = () => { const text = (said: string) => kind() === "text" ? said : said.trim().replace(/^=/, ""); return { kind: kind(), ...(kind() !== "formula" ? { op: op() } : {}), a: text(a()), ...(two() ? { b: text(b()) } : {}), style: style() }; };
  // Opened from the menu on a kind, the form starts on it.
  createEffect(on(() => props.area, (area) => { const start = props.rules.preset(); if (!area || !start) return; props.rules.prefer(null); setKind(start.kind); setOp(start.op ?? (start.kind === "text" ? "contains" : ">")); setA(""); setB(""); }));
  const choose = (next: RuleKind) => { setKind(next); if (next === "text" && !TEXTS.some((one) => one.value === op())) setOp("contains"); if (next === "value" && !OPS.some((one) => one.value === op())) setOp(">"); };
  // Only a rule this sheet can draw is taken: one it cannot read would hold for nothing.
  const readable = () => Boolean(rule().a && (!two() || rule().b) && compileRule(rule()));
  // A rule picked from the list is edited in the form, and saved over itself.
  const [editing, setEditing] = createSignal<number | null>(null);
  const pick = (at: number, one: SheetRule) => { setEditing(at); setKind(one.kind); setOp(one.op ?? ">"); setA(one.a); setB(one.b ?? ""); setStyle(one.style); };
  const add = (event: SubmitEvent) => {
    event.preventDefault();
    const area = props.area, at = editing();
    if (area && readable()) props.act(at === null ? "Conditional formatting" : "Edit rule", () => at === null ? props.rules.add(area, rule()) : props.rules.change(at, rule()));
    setEditing(null); props.onClose();
  };
  return <Dialog open={props.area !== null} title={editing() === null ? "New formatting rule" : "Edit formatting rule"} description={props.area ? `Cells ${a1(props.area.top, props.area.left)}${props.area.bottom > props.area.top || props.area.right > props.area.left ? `:${a1(props.area.bottom, props.area.right)}` : ""}` : undefined} onOpenChange={(open) => { if (!open) { setEditing(null); props.onClose(); } }}>
    <CardForm onSubmit={add}>
      <Segmented label="Rule" value={kind()} options={[{ value: "value", label: "Cell value" }, { value: "text", label: "Text" }, { value: "formula", label: "Formula" }]} onChange={choose} />
      <Show when={kind() === "text"}>
        <Field label="Text" plain><Select aria-label="Text test" value={op()} onChange={(event) => setOp(event.currentTarget.value as SheetTextOp)}><For each={TEXTS}>{(one) => <option value={one.value}>{one.label}</option>}</For></Select></Field>
        <Input aria-label="Text" value={a()} onInput={(event) => setA(event.currentTarget.value)} />
      </Show>
      <Show when={kind() === "value"} fallback={kind() === "text" ? undefined : <Field label="Formats where this is true"><Input aria-label="Formula" placeholder="=$B1>100" value={a()} onInput={(event) => setA(event.currentTarget.value)} /></Field>}>
        <Field label="Cell value is" plain><Select aria-label="Comparison" value={op()} onChange={(event) => setOp(event.currentTarget.value as SheetRuleOp)}><For each={OPS}>{(one) => <option value={one.value}>{one.label}</option>}</For></Select></Field>
        <Input aria-label={two() ? "From" : "Value"} value={a()} onInput={(event) => setA(event.currentTarget.value)} />
        <Show when={two()}><Input aria-label="To" value={b()} onInput={(event) => setB(event.currentTarget.value)} /></Show>
      </Show>
      <Field label="Format with" plain><Select aria-label="Format with" value={style()} onChange={(event) => setStyle(event.currentTarget.value)}><For each={LOOKS}>{(one) => <option value={one.value}>{one.label}</option>}</For></Select></Field>
      <Show when={props.area && props.rules.list().length}>
        <Field label="This sheet's rules, first over the rest" plain>
          <For each={props.rules.list()}>{(one, at) => <Row label={said(one.rule)} meta={one.ranges} selected={editing() === at()}
            end={<>
              <Button type="button" variant="ghost" onClick={() => pick(at(), one.rule)}>Edit</Button>
              <Show when={at() > 0}><Button type="button" variant="ghost" onClick={() => { props.act("Rule order", () => props.rules.raise(at())); setEditing(null); }}>Up</Button></Show>
              <Button type="button" variant="ghost" onClick={() => { props.act("Delete rule", () => props.rules.remove(at())); setEditing(null); }}>Delete</Button>
            </>} />}</For>
        </Field>
      </Show>
      <Actions>
        <Show when={props.area && props.rules.count()}><Button type="button" variant="ghost" outline onClick={() => { props.act("Clear rules", () => props.rules.clear()); setEditing(null); props.onClose(); }}>Clear sheet's rules</Button></Show>
        <Button type="button" variant="ghost" outline onClick={() => { setEditing(null); props.onClose(); }}>Cancel</Button><Button type="submit" disabled={!readable()}>{editing() === null ? "Add" : "Save"}</Button>
      </Actions>
    </CardForm>
  </Dialog>;
}

const MENU: readonly (RulePreset & { label: string })[] = [
  { kind: "value", op: ">", label: "Greater than…" }, { kind: "value", op: "<", label: "Less than…" }, { kind: "value", op: "between", label: "Between…" }, { kind: "value", op: "=", label: "Equal to…" },
  { kind: "text", op: "contains", label: "Text that contains…" }, { kind: "formula", label: "Formula…" },
];
/** The cell menu's Conditional formatting: a rule of each kind, the prompt opened on it (`open`, sheet.tsx), and the tab's rules to manage. */
export function RulesMenu(props: { rules: SheetRules; open(): void }) {
  return <MenuSection>
    <MenuSub phone={matchMedia(PHONE_LAYOUT_QUERY).matches}>
      <MenuSubTrigger icon={<Icons.Label />} meta={props.rules.count() ? String(props.rules.count()) : undefined}>Conditional formatting</MenuSubTrigger>
      <MenuSubContent>
        <MenuSection><For each={MENU}>{(one) => <MenuRow onSelect={() => { props.rules.prefer({ kind: one.kind, op: one.op }); props.open(); }}>{one.label}</MenuRow>}</For></MenuSection>
        <MenuSection><MenuRow keys={["Alt", "H", "L"]} onSelect={() => props.open()}>Manage rules…</MenuRow></MenuSection>
      </MenuSubContent>
    </MenuSub>
  </MenuSection>;
}
