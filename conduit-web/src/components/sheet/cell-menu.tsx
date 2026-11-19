import { createSignal, For, Show, type JSX } from "solid-js";
import { Actions, Item, SearchSection, Section } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Field, Input, Switch } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { Row } from "@/components/ui/row";
import { PHONE_LAYOUT_QUERY } from "@/components/ui/layout";
import { MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubTrigger, Popover, PopoverContent, Select } from "@/components/ui/menus";
import type { SheetBox } from "./host";

/** One row of the cell menu: a doing, or (`sub`) a submenu of them. */
export type SheetMenuEntry = { label: string; icon?: JSX.Element; keys?: string[]; meta?: string; destructive?: boolean; disabled?: boolean; run?(): void; sub?: SheetMenuEntry[] };

const has = (entry: SheetMenuEntry, query: string): boolean => entry.label.toLowerCase().includes(query) || Boolean(entry.sub?.some((one) => has(one, query)));
// The typing is the field's: the menu's own keys would pick a row by its first letter. Down goes into the rows, Enter picks the first one shown.
const keys = (event: KeyboardEvent) => {
  if (event.key === "Escape" || event.key === "Tab") return;
  event.stopPropagation();
  if (event.key !== "ArrowDown" && event.key !== "Enter") return;
  const first = (event.currentTarget as HTMLElement).closest("[role=menu]")?.querySelector<HTMLElement>("[role=menuitem]:not([data-disabled])");
  if (!first) return;
  event.preventDefault();
  first.focus();
  if (event.key === "Enter") first.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
};

/**
 * The menu's own focus on opening goes to its search field, so typing searches; on a phone it stays, so a long press does not raise the keyboard.
 * After a task, as the menu's list focuses itself in one (Kobalte's deferred autofocus) queued before this.
 */
export const focusSearch = (event: Event) => {
  const field = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>("input.ui-search");
  if (field && !matchMedia(PHONE_LAYOUT_QUERY).matches) { event.preventDefault(); setTimeout(() => field.focus()); }
};

/** The cell menu's groups under a field that keeps the rows (or submenus holding them) whose names hold what is typed. `after`: sections shown while nothing is. */
export function SheetMenu(props: { groups: (SheetMenuEntry[] | false | null | undefined)[]; after?: JSX.Element }) {
  const [query, setQuery] = createSignal(""), phone = matchMedia(PHONE_LAYOUT_QUERY).matches;
  const shown = () => { const asked = query().trim().toLowerCase(); return props.groups.flatMap((group) => { const kept = group ? group.filter((entry) => !asked || has(entry, asked)) : []; return kept.length ? [kept] : []; }); };
  const row = (entry: SheetMenuEntry) => <MenuRow icon={entry.icon} keys={entry.keys} meta={entry.meta} destructive={entry.destructive} disabled={entry.disabled} onSelect={() => entry.run?.()}>{entry.label}</MenuRow>;
  return <>
    <SearchSection placeholder="Search the menu" value={query()} onInput={setQuery} field={{ "aria-label": "Search the menu", onKeyDown: keys }} />
    <For each={shown()}>{(group) => <MenuSection><For each={group}>{(entry) => entry.sub
      ? <MenuSub phone={phone}><MenuSubTrigger icon={entry.icon} meta={entry.meta}>{entry.label}</MenuSubTrigger><MenuSubContent><MenuSection><For each={entry.sub}>{row}</For></MenuSection></MenuSubContent></MenuSub>
      : row(entry)}</For></MenuSection>}</For>
    <Show when={!query().trim()}>{props.after}</Show>
  </>;
}

/** What deleting or inserting a block of cells does to what is round it, as a spreadsheet asks: the cells shift, or whole rows or columns go or come. */
export type SheetShiftWay = "up" | "left" | "down" | "right" | "rows" | "cols";
const SHIFTS: Record<"delete" | "insert", { way: SheetShiftWay; label: string; key: string }[]> = {
  delete: [{ way: "left", label: "Shift cells left", key: "L" }, { way: "up", label: "Shift cells up", key: "U" }, { way: "rows", label: "Entire row", key: "R" }, { way: "cols", label: "Entire column", key: "C" }],
  insert: [{ way: "right", label: "Shift cells right", key: "I" }, { way: "down", label: "Shift cells down", key: "D" }, { way: "rows", label: "Entire row", key: "R" }, { way: "cols", label: "Entire column", key: "C" }],
};

/** Asked at the block: the arrows and Enter, or a row's letter, choose; Escape leaves it as it was. */
export function ShiftPrompt(props: { asked: { verb: "delete" | "insert"; box: SheetBox } | null; frame: () => HTMLElement | undefined; onChoose(way: SheetShiftWay): void; onClose(): void }) {
  const [active, setActive] = createSignal(0), list = () => SHIFTS[props.asked?.verb ?? "delete"];
  const choose = (way: SheetShiftWay) => { props.onChoose(way); props.onClose(); };
  const keys = (event: KeyboardEvent) => {
    const by = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0, letter = list().find((one) => one.key === event.key.toUpperCase());
    if (by) setActive((at) => Math.min(list().length - 1, Math.max(0, at + by)));
    else if (event.key === "Enter") choose(list()[active()]!.way);
    else if (letter && !event.ctrlKey && !event.metaKey && !event.altKey) choose(letter.way);
    else return;
    event.preventDefault();
  };
  return <Popover open={props.asked !== null} onOpenChange={(open) => { if (!open) props.onClose(); }} anchorRef={props.frame} placement="bottom-start"
    anchorRect={() => { const box = props.asked?.box; return box && new DOMRect(box.left, box.top, box.width, box.height); }}>
    <PopoverContent aria-label={props.asked?.verb === "insert" ? "Insert cells" : "Delete cells"} width="sm" onOpenAutoFocus={(event) => { event.preventDefault(); setActive(0); }}>
      <div tabIndex={-1} onKeyDown={keys} ref={(element) => queueMicrotask(() => element.focus())}>
        <Section title={props.asked?.verb === "insert" ? "Insert" : "Delete"}>
          <For each={list()}>{(one, at) => <Item keys={[one.key]} active={active() === at()} onCursor={() => setActive(at())} onClick={() => choose(one.way)}>{one.label}</Item>}</For>
        </Section>
      </div>
    </PopoverContent>
  </Popover>;
}

/** Remove duplicates asked about its range: whether its first row is a header, which stays. */
export function DedupePrompt(props: { asked: { range: string; header: boolean } | null; onRemove(header: boolean): void; onClose(): void }) {
  const [header, setHeader] = createSignal(false);
  return <Dialog open={props.asked !== null} title="Remove duplicates" description={props.asked ? `Rows of ${props.asked.range} that repeat one above them` : undefined} onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <Show when={props.asked}>{(asked) => { setHeader(asked().header); return <CardForm onSubmit={(event) => { event.preventDefault(); props.onRemove(header()); props.onClose(); }}>
      <Row density="line" element="label" label="Has a header row" end={<Switch label="Has a header row" checked={header()} onChange={setHeader} />} />
      <Actions><Button type="button" variant="ghost" outline onClick={() => props.onClose()}>Cancel</Button><Button type="submit">Remove</Button></Actions>
    </CardForm>; }}</Show>
  </Dialog>;
}

const SEPARATORS = [{ value: ",", label: "Comma" }, { value: ";", label: "Semicolon" }, { value: "\t", label: "Tab" }, { value: " ", label: "Space" }, { value: "", label: "Other" }];
/** Split text to columns asked for its separator: one of the usual, or one typed. */
export function SplitPrompt(props: { open: boolean; onSplit(separator: string): void; onClose(): void }) {
  const [chosen, setChosen] = createSignal(","), [typed, setTyped] = createSignal("");
  const separator = () => chosen() || typed();
  return <Dialog open={props.open} title="Split text to columns" onOpenChange={(open) => { if (!open) props.onClose(); }}>
    <CardForm onSubmit={(event) => { event.preventDefault(); if (separator()) props.onSplit(separator()); props.onClose(); }}>
      <Field label="Separator" plain><Select aria-label="Separator" value={chosen()} onChange={(event) => setChosen(event.currentTarget.value)}><For each={SEPARATORS}>{(one) => <option value={one.value}>{one.label}</option>}</For></Select></Field>
      <Show when={!chosen()}><Input aria-label="Separator" value={typed()} onInput={(event) => setTyped(event.currentTarget.value)} ref={(field) => queueMicrotask(() => field.focus())} /></Show>
      <Actions><Button type="button" variant="ghost" outline onClick={() => props.onClose()}>Cancel</Button><Button type="submit" disabled={!separator()}>Split</Button></Actions>
    </CardForm>
  </Dialog>;
}
