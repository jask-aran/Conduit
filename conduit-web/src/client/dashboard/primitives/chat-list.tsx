import { For, Show, type JSX } from "solid-js";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "lucide-solid";
import { Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/primitives";
import { HarnessMark } from "../../harness-brand";
import { SplitGroupMore } from "./split";

// The chats list at the head of every dashboard's left column, so the Conduit,
// project and workspace dashboards read and behave alike: the list's name (a
// switch where there is a choice) at the left, then always the filter menu and
// search at the right, and rows grouped by day and paged.

export const CHAT_PAGE = 40;

/** The day heading a timestamp falls under, as the search overlay groups them. */
export function dayGroup(value: number, currentTime = Date.now()) {
  if (!value) return "Earlier";
  const today = new Date(currentTime); today.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  if (value >= today.getTime()) return "Today";
  if (value >= today.getTime() - day) return "Yesterday";
  if (value >= today.getTime() - 6 * day) return "This week";
  if (value >= today.getTime() - 29 * day) return "This month";
  return "Earlier";
}

export function groupByDay<T>(rows: T[], at: (row: T) => number, currentTime = Date.now()) {
  const groups: Array<{ label: string; rows: T[] }> = [];
  for (const row of rows) {
    const label = dayGroup(at(row), currentTime);
    if (groups.at(-1)?.label !== label) groups.push({ label, rows: [] });
    groups.at(-1)!.rows.push(row);
  }
  return groups;
}

export function DayGroups<T>(props: { groups: Array<{ label: string; rows: T[] }>; children: (row: T) => JSX.Element }) {
  return <For each={props.groups}>{(group) => <>
    <div class="split-day">{group.label}</div>
    <For each={group.rows}>{props.children}</For>
  </>}</For>;
}

export function ShowMore(props: { total: number; shown: number; onMore: () => void }) {
  return <Show when={props.total > props.shown}><SplitGroupMore onClick={props.onMore}>Show more <small>{props.total - props.shown}</small></SplitGroupMore></Show>;
}

/**
 * Sort, unread and harness choices behind one quiet trigger that names what
 * is in force, so the heading keeps its shape whichever list is showing.
 */
export function ListFilter(props: {
  sort?: "latest" | "created";
  onSort?: (sort: "latest" | "created") => void;
  unreadOnly?: boolean;
  onUnreadOnly?: (value: boolean) => void;
  harnesses?: Array<{ id: string; label: string }>;
  harness?: string;
  onHarness?: (id: string) => void;
}) {
  const summary = () => props.harnesses
    ? props.harnesses.find((item) => item.id === props.harness)?.label || "All harnesses"
    : `${props.sort === "created" ? "Created" : "Latest"}${props.unreadOnly ? " · Unread" : ""}`;
  return <Menu modal={false}>
    <MenuTrigger class="split-list-filter" title="Filter and sort">{summary()}<ChevronDownIcon /></MenuTrigger>
    <MenuContent class="w-48">
      <Show when={props.onSort}>
        <MenuGroup>
          <MenuLabel>Sort by</MenuLabel>
          <MenuRadioGroup value={props.sort} onChange={(value: string) => props.onSort!(value as "latest" | "created")}>
            <MenuRadioItem value="latest">Latest activity</MenuRadioItem>
            <MenuRadioItem value="created">Created</MenuRadioItem>
          </MenuRadioGroup>
        </MenuGroup>
      </Show>
      <Show when={props.onUnreadOnly}>
        <MenuSeparator />
        <MenuItem closeOnSelect={false} onSelect={() => props.onUnreadOnly!(!props.unreadOnly)}><span class="split-check">{props.unreadOnly ? <CheckIcon /> : null}</span>Unread only</MenuItem>
      </Show>
      <Show when={props.harnesses}>
        <MenuGroup>
          <MenuLabel>Harness</MenuLabel>
          <MenuRadioGroup value={props.harness || ""} onChange={(value: string) => props.onHarness?.(value)}>
            <MenuRadioItem value="">All harnesses</MenuRadioItem>
            <For each={props.harnesses}>{(item) => <MenuRadioItem value={item.id}><HarnessMark id={item.id} />{item.label}</MenuRadioItem>}</For>
          </MenuRadioGroup>
        </MenuGroup>
      </Show>
    </MenuContent>
  </Menu>;
}

export function ListSearch(props: { label: string; onClick: () => void }) {
  return <button type="button" aria-label={props.label} title={props.label} onClick={props.onClick}><SearchIcon /></button>;
}
