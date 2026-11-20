import { createEffect, createMemo, createSignal, For, on, Show, type Component, type JSX } from "solid-js";
import { Actions, Item, SearchSection, Section } from "@/components/ui";
import { CardForm } from "@/components/ui/card";
import { Button, Field, Input, Switch } from "@/components/ui/controls";
import { Dialog } from "@/components/ui/dialog";
import { Row } from "@/components/ui/row";
import { PHONE_LAYOUT_QUERY } from "@/components/ui/layout";
import { MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubTrigger, Popover, PopoverContent, Select } from "@/components/ui/menus";
import type { SheetBox } from "./host";

/** One row of the cell menu: a doing, or (`sub`) a submenu of them, made as it opens (or as a search reads it), when given as a function. Its icon is
 * a component, made only where a row shows it. */
export type SheetMenuEntry = { label: string; icon?: Component; keys?: string[]; meta?: string; destructive?: boolean; disabled?: boolean; run?(): void; sub?: SheetMenuEntry[] | (() => SheetMenuEntry[]) };

const subOf = (entry: SheetMenuEntry) => typeof entry.sub === "function" ? entry.sub() : entry.sub;
// Searched, every row stands in one list (a submenu's with the submenu's name beside it), so Enter runs the first; each typed word starts a word of
// its name, its submenu's, or a word said for one of those.
type Leaf = { entry: SheetMenuEntry; under?: string; words: string[] };
const SAID: Record<string, string[]> = { delete: ["remove"], remove: ["delete"], insert: ["add"], add: ["insert"], clear: ["erase"], cell: ["cells"] };
const leaves = (entries: SheetMenuEntry[], under?: string): Leaf[] => entries.flatMap((entry) => {
  const sub = subOf(entry);
  if (sub) return leaves(sub, entry.label);
  const words = `${under ?? ""} ${entry.label}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return [{ entry, under, words: [...words, ...words.flatMap((word) => SAID[word] ?? [])] }];
});
const matches = (leaf: Leaf, asked: string[]) => asked.every((word) => leaf.words.some((one) => one.startsWith(word)));
// The typing is the field's: the menu's own keys would pick a row by its first letter. Down goes into the rows, Enter picks the first one shown.
const keys = (event: KeyboardEvent) => {
  if (event.key === "Escape" || event.key === "Tab") return;
  event.stopPropagation();
  if (event.key !== "ArrowDown" && event.key !== "Enter") return;
  const first = (event.currentTarget as HTMLElement).closest("[role=menu]")?.querySelector<HTMLElement>("[role=menuitem]:not([data-disabled]):not([hidden])");
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

/** A context menu opened from the keyboard (Shift+F10, the Menu key) on `target` at a point. The browser's own contextmenu for the same key (Windows
 * sends one as the key comes up) is held back: it would open the menu a second time, at the element's middle. */
export const menuAt = (target: Element, x: number, y: number) => {
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: x, clientY: y }));
  const twice = (event: Event) => { if (event.isTrusted && !(event as PointerEvent).pointerType) { event.preventDefault(); event.stopPropagation(); } };
  window.addEventListener("contextmenu", twice, true); setTimeout(() => window.removeEventListener("contextmenu", twice, true), 800);
};

const FIRST = 12, STEP = 8, FOUND = 5;
/**
 * The cell menu's groups under a field that keeps the rows (and submenus' rows) whose names hold what is typed. `after`: sections shown while nothing
 * is; `more`: rows found only by a search (the ribbon's tools, which `after` shows as submenus).
 */
export function SheetMenu(props: { groups: (SheetMenuEntry[] | false | null | undefined)[]; after?: JSX.Element; more?: () => SheetMenuEntry[] }) {
  const [query, setQuery] = createSignal(""), phone = matchMedia(PHONE_LAYOUT_QUERY).matches;
  const groups = createMemo(() => props.groups.filter((group): group is SheetMenuEntry[] => Boolean(group && group.length)));
  // A first screenful is made as it opens, the rest a few rows a task after it, so no task holds a frame: searching and the arrows reach them by then.
  const [limit, setLimit] = createSignal(FIRST), [away, setAway] = createSignal(false);
  const grow = () => setTimeout(() => { if (away() || limit() === Infinity) return; if (limit() < groups().flat().length) { setLimit(limit() + STEP); grow(); } else setLimit(Infinity); });
  requestAnimationFrame(grow);
  const before = createMemo(() => { let n = 0; return new Map(groups().map((group) => { const at = n; n += group.length; return [group, at]; })); });
  const asked = createMemo(() => query().trim().toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean), [], { equals: (one, two) => one.join(" ") === two.join(" ") });
  const searching = createMemo(() => asked().length > 0);
  // Its own rows are hidden as a search starts and let go a task later (each row kept would cost every arrow); cleared, they are made again as at opening.
  createEffect(on(searching, (now) => { if (now) setTimeout(() => setAway(searching())); else { setAway(false); setLimit(FIRST); requestAnimationFrame(grow); } }, { defer: true }));
  // Read once a search starts, as stable rows: a row is made when it first matches (a few a task), then hidden and passed over by the arrows when it
  // stops.
  const all = createMemo<Leaf[] | undefined>((was) => was ?? (searching() ? leaves([...groups().flat(), ...props.more?.() ?? []]) : undefined));
  const hits = createMemo(() => new Set(searching() ? all()?.filter((leaf) => matches(leaf, asked())) : []));
  const [tick, setTick] = createSignal(0);
  const made = createMemo<Leaf[]>((was) => {
    tick();
    const had = new Set(was), now = hits();
    let fresh = 0;
    const next = (all() ?? []).filter((leaf) => had.has(leaf) || (now.has(leaf) && fresh++ < FOUND));
    if (fresh > FOUND) setTimeout(() => setTick((n) => n + 1));
    return next;
  }, []);
  const row = (entry: SheetMenuEntry, meta = entry.meta, off = () => false) => <MenuRow icon={entry.icon && <entry.icon />} keys={entry.keys} meta={meta}
    destructive={entry.destructive} hidden={off()} disabled={entry.disabled || off()} onSelect={() => entry.run?.()}>{entry.label}</MenuRow>;
  return <>
    <SearchSection placeholder="Search the menu" value={query()} onInput={setQuery} field={{ "aria-label": "Search the menu", onKeyDown: keys }} />
    <Show when={!away()}><For each={groups()}>{(group) => {
      const kept = () => group.slice(0, Math.max(0, limit() - (before().get(group) ?? 0)));
      return <MenuSection hidden={searching() || !kept().length}><For each={kept()}>{(entry) => entry.sub
        ? <MenuSub phone={phone}><MenuSubTrigger icon={entry.icon && <entry.icon />} meta={entry.meta}>{entry.label}</MenuSubTrigger>
          <MenuSubContent><MenuSection><For each={subOf(entry)}>{(one) => row(one)}</For></MenuSection></MenuSubContent></MenuSub>
        : row(entry)}</For></MenuSection>;
    }}</For>
    <Show when={limit() === Infinity}><div hidden={searching()}>{props.after}</div></Show></Show>
    <MenuSection hidden={!searching()}><For each={made()}>{(leaf) => row(leaf.entry, leaf.entry.meta ?? leaf.under, () => !hits().has(leaf))}</For></MenuSection>
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
