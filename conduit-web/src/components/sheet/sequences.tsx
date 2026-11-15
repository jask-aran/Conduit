/*
 * Key sequences on the grid, as a spreadsheet's: Alt pressed and let go alone (or held with the first letter) starts one, each letter narrows it, and
 * Escape or a key that matches nothing ends it. Each is one entry in SHEET_SEQUENCES: a ribbon tool by its name (tools.tsx), or a doing of its own.
 * The keys are Excel's Home tab's where it has them; the letters choosing an ink (R, A, G, B, N) and a number format after Alt H N are Conduit's,
 * since Excel picks those from a gallery with the arrows.
 */
import { createEffect, createMemo, createSignal, For, Show, type Accessor } from "solid-js";
import { Actions, Item, Section } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Input } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { Popover, PopoverContent } from "@/components/ui/menus";
import type { SheetLook, SheetRange, SheetToolId } from "./host";
import type { SheetSizes } from "./sizes";

/** A size asked for in pixels, prefilled with what it is now; `apply` is given the number set. */
export type SizeQuestion = { title: string; value: number; apply(size: number): void };
/** What a sequence acts on. `selection`: the cells selected, whole rows or columns included. */
export type SheetSequenceContext = { selection(): SheetRange | null; sizes: SheetSizes; look(): SheetLook; ask(question: SizeQuestion): void };
/** `keys`: the keys after Alt, letters upper-case. `tool`: the ribbon tool it presses, named as the ribbon names it; else `run`, with its own `label`. */
export type SheetSequence = { keys: string } & ({ tool: SheetToolId } | { label: string; run(ctx: SheetSequenceContext): void });

const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, at) => from + at);
const rowsOf = (ctx: SheetSequenceContext) => { const area = ctx.selection(); return area ? span(area.top, area.bottom) : []; };
const colsOf = (ctx: SheetSequenceContext) => { const area = ctx.selection(); return area ? span(area.left, area.right) : []; };

const INKS = [["R", "red"], ["A", "amber"], ["G", "green"], ["B", "blue"], ["N", "none"]] as const;
export const SHEET_SEQUENCES: readonly SheetSequence[] = [
  { keys: "H1", tool: "bold" }, { keys: "H2", tool: "italic" }, { keys: "H3", tool: "underline" }, { keys: "HW", tool: "wrap" },
  { keys: "HAL", tool: "align-left" }, { keys: "HAC", tool: "align-center" }, { keys: "HAR", tool: "align-right" },
  { keys: "HAT", tool: "valign-top" }, { keys: "HAM", tool: "valign-middle" }, { keys: "HAB", tool: "valign-bottom" },
  { keys: "HBA", tool: "borders-all" }, { keys: "HBS", tool: "borders-outer" }, { keys: "HBP", tool: "borders-top" }, { keys: "HBO", tool: "borders-bottom" },
  { keys: "HBL", tool: "borders-left" }, { keys: "HBR", tool: "borders-right" }, { keys: "HBN", tool: "borders-none" },
  ...INKS.map(([key, ink]) => ({ keys: `HH${key}`, tool: `fill-${ink}` as const })), ...INKS.map(([key, ink]) => ({ keys: `HFC${key}`, tool: `color-${ink}` as const })),
  { keys: "HNG", tool: "format-general" }, { keys: "HNN", tool: "format-number" }, { keys: "HNC", tool: "format-currency" }, { keys: "HNP", tool: "format-percent" }, { keys: "HND", tool: "format-date" }, { keys: "HNT", tool: "format-time" },
  { keys: "H0", tool: "decimals-more" }, { keys: "H9", tool: "decimals-fewer" },
  { keys: "HOH", label: "Row height", run: (ctx) => { const rows = rowsOf(ctx); if (rows.length) ctx.ask({ title: "Row height", value: ctx.sizes.height(rows[0]!) ?? ctx.look().row, apply: (size) => ctx.sizes.setHeights(rows, size) }); } },
  { keys: "HOW", label: "Column width", run: (ctx) => { const cols = colsOf(ctx); if (cols.length) ctx.ask({ title: "Column width", value: ctx.sizes.width(cols[0]!) ?? ctx.look().width, apply: (size) => ctx.sizes.setWidths(cols, size) }); } },
  { keys: "HOI", label: "Fit column width", run: (ctx) => ctx.sizes.fitColumns(colsOf(ctx), ctx.look()) },
  { keys: "HOA", label: "Fit row height", run: (ctx) => ctx.sizes.fitRows(rowsOf(ctx), ctx.look()) },
  // Excel's View keys: Freeze panes freezes the rows above and the columns left of the selection, or unfreezes what is frozen.
  { keys: "WFF", label: "Freeze panes", run: (ctx) => { const area = ctx.selection(), now = ctx.sizes.freeze(); if (now.rows || now.cols) ctx.sizes.setFreeze(0, 0); else if (area) ctx.sizes.setFreeze(area.top, area.left); } },
  { keys: "WFR", label: "Freeze top row", run: (ctx) => ctx.sizes.setFreeze(1, ctx.sizes.freeze().cols) },
  { keys: "WFC", label: "Freeze first column", run: (ctx) => ctx.sizes.setFreeze(ctx.sizes.freeze().rows, 1) },
  { keys: "HOD", label: "Default width", run: (ctx) => ctx.ask({ title: "Default width", value: ctx.sizes.standard() ?? ctx.look().width, apply: (size) => ctx.sizes.setStandard(size) }) },
];
/** What a sequence's first letters lead to, named as the next keys are listed. */
export const SEQUENCE_GROUPS: Readonly<Record<string, string>> = { H: "Home", HO: "Format", HA: "Align", HB: "Borders", HH: "Fill colour", HF: "Font", HFC: "Text colour", HN: "Number format", W: "View", WF: "Freeze panes" };

/** The sequence typed so far (null when none is), the keys that may come next, and the grid's key listeners. `named`: a tool's label, as its ribbon says it. */
export function createSequenceKeys(run: (sequence: SheetSequence) => void, named: (tool: SheetToolId) => string) {
  const label = (one: SheetSequence) => "tool" in one ? named(one.tool) : one.label;
  const [typed, setTyped] = createSignal<string | null>(null);
  let alt = false, used = false;
  const next = createMemo(() => {
    const now = typed(), keys = new Map<string, string>();
    if (now !== null) for (const one of SHEET_SEQUENCES) if (one.keys.startsWith(now) && one.keys.length > now.length) {
      const key = one.keys[now.length]!, whole = now + key;
      if (!keys.has(key)) keys.set(key, one.keys === whole ? label(one) : SEQUENCE_GROUPS[whole] ?? label(one));
    }
    return [...keys].map(([key, label]) => ({ key, label }));
  });
  const step = (letter: string) => {
    const now = (typed() ?? "") + letter, done = SHEET_SEQUENCES.find((one) => one.keys === now);
    setTyped(done || !SHEET_SEQUENCES.some((one) => one.keys.startsWith(now)) ? null : now);
    if (done) run(done);
  };
  const letter = (event: KeyboardEvent) => /^(Key[A-Z]|Digit\d)$/.test(event.code) ? event.code.slice(-1) : null;
  const keydown = (event: KeyboardEvent) => {
    if (event.key === "Alt") { alt = true; used = false; return; }
    if (typed() !== null) {
      if (event.key === "Shift" || event.key === "Control" || event.key === "Meta") return;
      event.preventDefault(); event.stopPropagation();
      const pressed = letter(event);
      if (pressed && !event.ctrlKey && !event.metaKey) step(pressed); else setTyped(null);
      return;
    }
    used = true;
    const pressed = alt && event.altKey && !event.ctrlKey && !event.metaKey ? letter(event) : null;
    if (pressed && SHEET_SEQUENCES.some((one) => one.keys.startsWith(pressed))) { event.preventDefault(); event.stopPropagation(); setTyped(""); step(pressed); }
  };
  // Let go alone, Alt starts a sequence; the browser's own use of it (a window's menu, on Windows) is held back.
  const keyup = (event: KeyboardEvent) => {
    if (event.key !== "Alt") return;
    if (alt && !used && typed() === null) { event.preventDefault(); setTyped(""); }
    alt = false;
  };
  const end = () => { alt = false; setTyped(null); };
  /** Listens on the grid's element, ahead of the grid: only while it has the keyboard. */
  const attach = (into: HTMLElement) => {
    into.addEventListener("keydown", keydown, true); into.addEventListener("keyup", keyup, true); into.addEventListener("focusout", end);
    return () => { into.removeEventListener("keydown", keydown, true); into.removeEventListener("keyup", keyup, true); into.removeEventListener("focusout", end); };
  };
  /** The key that presses a ribbon tool next, while a sequence leading to it is typed (past Alt alone, where every tool's would be H). */
  const tip = (tool: SheetToolId) => {
    const now = typed();
    if (!now) return undefined;
    const one = SHEET_SEQUENCES.find((sequence) => "tool" in sequence && sequence.tool === tool);
    return one && one.keys.length > now.length && one.keys.startsWith(now) ? one.keys[now.length] : undefined;
  };
  return { typed, next, attach, end, tip };
}

/** The keys that may come next and are not drawn on a tool of the ribbon in `anchor` (its keytips) or a row of the menu a sequence opened: sizes, a folded ribbon. Under the ribbon's end. */
export function SequenceHint(props: { typed: Accessor<string | null>; next: Accessor<{ key: string; label: string }[]>; anchor: () => HTMLElement | undefined }) {
  // Read once the ribbon has drawn its keytips for what is typed.
  const [drawn, setDrawn] = createSignal<ReadonlySet<string>>(new Set());
  createEffect(() => { props.typed(); requestAnimationFrame(() => setDrawn(new Set([...props.anchor()?.querySelectorAll(".ui-markup-tip") ?? [], ...document.querySelectorAll("[data-piece=MenuContent] .ui-keycap")].map((tip) => tip.textContent ?? "")))); });
  const rest = () => props.next().filter((one) => !drawn().has(one.key));
  return <Popover open={props.typed() !== null && rest().length > 0} anchorRef={props.anchor} placement="bottom-end">
    <PopoverContent aria-label="Keys" width="sm" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      <Section title={["Alt", ...(props.typed() ?? "")].join(" ")}>
        <For each={rest()}>{(one) => <Item keys={[one.key]} keysFirst>{one.label}</Item>}</For>
      </Section>
    </PopoverContent>
  </Popover>;
}

/** Asks for a size; Enter sets it. `onClose`: closed either way, set or not. */
export function SizePrompt(props: { question: SizeQuestion | null; onClose(): void }) {
  const [value, setValue] = createSignal("");
  const size = () => Number(value());
  const set = (event: SubmitEvent) => { event.preventDefault(); if (size() > 0) props.question?.apply(size()); props.onClose(); };
  return <Dialog open={props.question !== null} title={props.question?.title ?? ""} onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <Show when={props.question}>{(question) => { setValue(String(question().value)); return <CardForm onSubmit={set}>
      <Input type="number" min="1" aria-label={`${question().title} in pixels`} value={value()} onInput={(event) => setValue(event.currentTarget.value)} ref={(field) => queueMicrotask(() => field.select())} />
      <Actions><Button type="button" variant="ghost" outline onClick={() => props.onClose()}>Cancel</Button><Button type="submit" disabled={!(size() > 0)}>Set</Button></Actions>
    </CardForm>; }}</Show>
  </Dialog>;
}
