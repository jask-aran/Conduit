import { createSignal } from "solid-js";
import { Menu } from "@/components/ui";
import { Calendar, DateField, today, type CalendarDay } from "@/components/ui/calendar";
import { row, token, type Page } from "../model";

const iso = (day: CalendarDay) => `${day.year}-${String(day.month).padStart(2, "0")}-${String(day.day).padStart(2, "0")}`;
const fromIso = (text: string): CalendarDay | null => { const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim()); return hit ? { year: +hit[1]!, month: +hit[2]!, day: +hit[3]! } : null; };
function Picking() {
  const [day, setDay] = createSignal<CalendarDay | null>({ ...today(), day: 1 });
  return <Menu width="sm"><Calendar value={day()} onPick={setDay} /></Menu>;
}
function Field() {
  const [text, setText] = createSignal("");
  return <DateField aria-label="Date" placeholder="2026-01-30" value={text()} onInput={setText} read={fromIso} write={iso} />;
}

export const calendarPage: Page = {
  title: "Calendar",
  summary: "a month's days to pick one from, in a popover: the cursor washed and moved by the arrows (a week up and down, a month with PageUp and PageDown), the chosen day current, today dotted. Imported from components/ui/calendar.tsx, never the barrel, so it loads with what uses it.",
  preview: () => <Picking />,
  usage: `import { CalendarPopover, DateField } from "@/components/ui/calendar";

<CalendarPopover at={box()} frame={() => pane} value={day()} onPick={pick} onClose={close} />
<DateField aria-label="Date" value={text()} onInput={setText} read={read} write={write} />`,
  anatomy: { scene: () => <Picking />, parts: [
    { selector: ".ui-calendar-head > span", name: "Month", does: "names the month the cursor is in", from: "Calendar" },
    { selector: ".ui-calendar-head .ui-button", name: "Month arrows", does: "step a month back or on", from: "Calendar" },
    { selector: ".ui-calendar-weekday", name: "Weekday", does: "heads each column, weeks from Monday", from: "Calendar" },
    { selector: ".ui-calendar-day[data-highlighted]", name: "Cursor", does: "the day Enter picks; the pointer moves it too", from: "Calendar" },
    { selector: ".ui-calendar-day[data-checked]", name: "Chosen", does: "the day the value holds, current weight, no fill", from: "Calendar value" },
  ] },
  examples: [
    row("pick a day", "Arrows, PageUp and PageDown move the cursor; Enter or a press picks", () => <Picking />, { surfaces: ["frost"], code: "<Calendar value onPick>" }),
    row("date field", "Typed, or picked from the calendar its button (or Alt+Down) opens", () => <Field />, { code: "<DateField value onInput read write>" }),
  ],
  tokens: [{ title: "Calendar", tokens: [
    token("--control-sm", "Day height"),
    token("--control-xs", "Weekday height and least day width"),
    token("--radius-control", "Day corner"),
    token("--tint", "Cursor wash"),
    token("--weight-current", "Chosen day"),
  ] }],
  api: ["Calendar", "CalendarPopover", "DateField"],
};
