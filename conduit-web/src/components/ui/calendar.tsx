/*
 * A month's days to pick one from, in a popover: never exported from the library's barrel, so it loads with what uses it (the sheet), not at start.
 */
import { createMemo, createSignal, For, Show, type JSX } from "solid-js";
import { Button, Input } from "./controls";
import { CalendarIcon } from "lucide-solid";
import * as Icons from "./icons";
import { Popover, PopoverContent } from "./menus";
import { Section } from "./popover";
import "./styles/calendar.css";

/** A day of the calendar, its month counted from 1. */
export type CalendarDay = { year: number; month: number; day: number };
const DAY_MS = 864e5, WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }), LONG = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeZone: "UTC" });
const count = (one: CalendarDay) => Date.UTC(one.year, one.month - 1, one.day) / DAY_MS;
const dayOf = (n: number): CalendarDay => { const at = new Date(n * DAY_MS); return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() }; };
/** The same day `by` months on, kept inside its month (31 January and a month: 28 or 29 February). */
const months = (n: number, by: number) => { const at = dayOf(n), first = Date.UTC(at.year, at.month - 1 + by, 1) / DAY_MS, last = dayOf(Date.UTC(at.year, at.month + by, 0) / DAY_MS).day; return first + Math.min(at.day, last) - 1; };
/** Today where the person is. */
export const today = (): CalendarDay => { const now = new Date(); return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() }; };

/**
 * The month of the cursor's day, weeks from Monday: the arrows move the cursor by a day and Up and Down by a week, PageUp and PageDown by a month,
 * Home and End to the week's ends; Enter or a press picks. The chosen day is current, today marked; Escape is the popover's. A character typed is
 * `onType`'s, so a date can be typed where the calendar was opened.
 */
export function Calendar(props: { value?: CalendarDay | null; onPick(day: CalendarDay): void; onType?(key: string): void; autofocus?: boolean }) {
  const [cursor, setCursor] = createSignal(count(props.value ?? today()));
  const now = count(today()), chosen = () => props.value ? count(props.value) : null;
  const days = createMemo(() => {
    const at = dayOf(cursor()), first = Date.UTC(at.year, at.month - 1, 1) / DAY_MS, start = first - (new Date(first * DAY_MS).getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, n) => start + n);
  });
  const month = () => dayOf(cursor()).month;
  const keys: Record<string, (n: number) => number> = { ArrowLeft: (n) => n - 1, ArrowRight: (n) => n + 1, ArrowUp: (n) => n - 7, ArrowDown: (n) => n + 7, PageUp: (n) => months(n, -1), PageDown: (n) => months(n, 1), Home: (n) => n - (new Date(n * DAY_MS).getUTCDay() + 6) % 7, End: (n) => n + 6 - (new Date(n * DAY_MS).getUTCDay() + 6) % 7 };
  const key: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const move = keys[event.key];
    if (move) { event.preventDefault(); setCursor(move(cursor())); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onPick(dayOf(cursor())); return; }
    if (event.key.length === 1 && props.onType) { event.preventDefault(); props.onType(event.key); }
  };
  return <Section>
    <div class="ui-title ui-calendar-head"><span>{MONTH.format(cursor() * DAY_MS)}</span><small>
      <Button variant="ghost" size="icon-xs" aria-label="Previous month" tabIndex={-1} onClick={() => setCursor((n) => months(n, -1))}><Icons.ChevronLeft /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Next month" tabIndex={-1} onClick={() => setCursor((n) => months(n, 1))}><Icons.ChevronRight /></Button>
    </small></div>
    <div class="ui-calendar" role="grid" tabIndex={0} aria-label={LONG.format(cursor() * DAY_MS)} onKeyDown={key} ref={(grid) => { if (props.autofocus) queueMicrotask(() => grid.focus()); }}>
      <For each={WEEKDAYS}>{(name) => <span class="ui-calendar-weekday" aria-hidden="true">{name}</span>}</For>
      <For each={days()}>{(n) => <button type="button" class="ui-calendar-day" tabIndex={-1} aria-label={LONG.format(n * DAY_MS)}
        data-outside={dayOf(n).month !== month() ? "" : undefined} data-highlighted={n === cursor() ? "" : undefined} data-checked={n === chosen() ? "" : undefined} data-today={n === now ? "" : undefined}
        onPointerMove={() => { if (n !== cursor() && dayOf(n).month === month()) setCursor(n); }} onClick={() => props.onPick(dayOf(n))}>{dayOf(n).day}</button>}</For>
    </div>
  </Section>;
}

/** The calendar in a popover at `at` (a box in `frame`'s coordinates; null: shut), as a cell's list opens. */
export function CalendarPopover(props: { at: DOMRect | null; frame: () => HTMLElement | undefined; value?: CalendarDay | null; onPick(day: CalendarDay): void; onType?(key: string): void; onClose(): void }) {
  return <Popover open={props.at !== null} onOpenChange={(open) => { if (!open) props.onClose(); }} anchorRef={props.frame} placement="bottom-start" anchorRect={() => props.at ?? undefined}>
    <PopoverContent aria-label="Pick a date" width="sm" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}>
      <Show when={props.at}><Calendar value={props.value} onPick={props.onPick} onType={props.onType} autofocus /></Show>
    </PopoverContent>
  </Popover>;
}

/** A date typed or picked: the field, and beside it the calendar's button. `read` and `write` turn its text into a day and back. */
export function DateField(props: { value: string; onInput(text: string): void; read(text: string): CalendarDay | null; write(day: CalendarDay): string; "aria-label": string; placeholder?: string; autofocus?: boolean }) {
  const [open, setOpen] = createSignal(false);
  let box: HTMLDivElement | undefined, input: HTMLInputElement | undefined;
  return <div class="ui-date-field" ref={box}>
    <Input aria-label={props["aria-label"]} placeholder={props.placeholder} value={props.value} onInput={(event) => props.onInput(event.currentTarget.value)} ref={(field) => { input = field; if (props.autofocus) queueMicrotask(() => field.focus()); }}
      onKeyDown={(event) => { if (event.altKey && event.key === "ArrowDown") { event.preventDefault(); setOpen(true); } }} />
    <Button variant="ghost" size="icon-sm" aria-label="Pick a date" aria-expanded={open()} onClick={() => setOpen((was) => !was)}><CalendarIcon /></Button>
    <Popover open={open()} onOpenChange={setOpen} anchorRef={() => box} placement="bottom-end">
      <PopoverContent aria-label="Pick a date" width="sm" onOpenAutoFocus={(event) => event.preventDefault()}>
        <Show when={open()}><Calendar value={props.read(props.value)} autofocus onPick={(day) => { props.onInput(props.write(day)); setOpen(false); }} onType={(key) => { setOpen(false); props.onInput(props.value + key); input?.focus(); }} /></Show>
      </PopoverContent>
    </Popover>
  </div>;
}
