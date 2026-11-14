/*
 * Key sequences on the grid, as a spreadsheet's: Alt pressed and let go alone (or held with the first letter) starts one, each letter narrows it, and
 * Escape or a key that matches nothing ends it. A tool is one entry in SHEET_SEQUENCES.
 */
import { createMemo, createSignal, For, Show, type Accessor } from "solid-js";
import { Actions, Item, Section } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Input } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { Popover, PopoverContent } from "@/components/ui/menus";
import type { SheetLook, SheetRange } from "./host";
import type { SheetSizes } from "./sizes";

/** A size asked for in pixels, prefilled with what it is now; `apply` is given the number set. */
export type SizeQuestion = { title: string; value: number; apply(size: number): void };
/** What a sequence acts on. `selection`: the cells selected, whole rows or columns included. */
export type SheetSequenceContext = { selection(): SheetRange | null; sizes: SheetSizes; look(): SheetLook; ask(question: SizeQuestion): void };
/** `keys`: the letters after Alt, upper-case. */
export type SheetSequence = { keys: string; label: string; run(ctx: SheetSequenceContext): void };

const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, at) => from + at);
const rowsOf = (ctx: SheetSequenceContext) => { const area = ctx.selection(); return area ? span(area.top, area.bottom) : []; };
const colsOf = (ctx: SheetSequenceContext) => { const area = ctx.selection(); return area ? span(area.left, area.right) : []; };

export const SHEET_SEQUENCES: readonly SheetSequence[] = [
  { keys: "HOH", label: "Row height", run: (ctx) => { const rows = rowsOf(ctx); if (rows.length) ctx.ask({ title: "Row height", value: ctx.sizes.height(rows[0]!) ?? ctx.look().row, apply: (size) => ctx.sizes.setHeights(rows, size) }); } },
  { keys: "HOW", label: "Column width", run: (ctx) => { const cols = colsOf(ctx); if (cols.length) ctx.ask({ title: "Column width", value: ctx.sizes.width(cols[0]!) ?? ctx.look().width, apply: (size) => ctx.sizes.setWidths(cols, size) }); } },
  { keys: "HOI", label: "Fit column width", run: (ctx) => ctx.sizes.fitColumns(colsOf(ctx), ctx.look()) },
  { keys: "HOA", label: "Fit row height", run: (ctx) => ctx.sizes.fitRows(rowsOf(ctx), ctx.look()) },
];
/** What a sequence's first letters lead to, named as the next keys are listed. */
export const SEQUENCE_GROUPS: Readonly<Record<string, string>> = { H: "Home", HO: "Format" };

/** The sequence typed so far (null when none is), the keys that may come next, and the grid's key listeners. */
export function createSequenceKeys(run: (sequence: SheetSequence) => void) {
  const [typed, setTyped] = createSignal<string | null>(null);
  let alt = false, used = false;
  const next = createMemo(() => {
    const now = typed(), keys = new Map<string, string>();
    if (now !== null) for (const one of SHEET_SEQUENCES) if (one.keys.startsWith(now) && one.keys.length > now.length) {
      const key = one.keys[now.length]!, whole = now + key;
      if (!keys.has(key)) keys.set(key, one.keys === whole ? one.label : SEQUENCE_GROUPS[whole] ?? one.label);
    }
    return [...keys].map(([key, label]) => ({ key, label }));
  });
  const step = (letter: string) => {
    const now = (typed() ?? "") + letter, done = SHEET_SEQUENCES.find((one) => one.keys === now);
    setTyped(done || !SHEET_SEQUENCES.some((one) => one.keys.startsWith(now)) ? null : now);
    if (done) run(done);
  };
  const letter = (event: KeyboardEvent) => /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : null;
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
  return { typed, next, attach, end };
}

/** The keys that may come next in the sequence typed so far, under `anchor` (the formula field). */
export function SequenceHint(props: { typed: Accessor<string | null>; next: Accessor<{ key: string; label: string }[]>; anchor: () => HTMLElement | undefined }) {
  return <Popover open={props.typed() !== null} anchorRef={props.anchor} placement="bottom-start">
    <PopoverContent aria-label="Keys" width="sm" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      <Section title={["Alt", ...(props.typed() ?? "")].join(" ")}>
        <For each={props.next()}>{(one) => <Item keys={[one.key]} keysFirst>{one.label}</Item>}</For>
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
