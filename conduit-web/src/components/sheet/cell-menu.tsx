import { createSignal, For, Show, type JSX } from "solid-js";
import { SearchSection } from "@/components/ui";
import { PHONE_LAYOUT_QUERY } from "@/components/ui/layout";
import { MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubTrigger } from "@/components/ui/menus";

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

/** The menu's own focus on opening goes to its search field, so typing searches; on a phone it stays, so a long press does not raise the keyboard. */
export const focusSearch = (event: Event) => {
  const field = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>("input.ui-search");
  if (field && !matchMedia(PHONE_LAYOUT_QUERY).matches) { event.preventDefault(); field.focus(); }
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
