import { HarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { createSignal, For, Index, onMount, Show, type JSX } from "solid-js";

import { Menu, MenuContent, MenuSection, MenuRadioGroup, MenuRadioItem, MenuControl } from "@/components/menus";
import { DashDay, GroupAction, GroupCompactHeading } from "@/components/ui/dashboard";

import { SplitGroupMore, watchFold } from "./split";
import type { Project } from "../../api/contracts";
import { PlaceGlyph } from "../../chat/place-picker";

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
    <DashDay>{group.label}</DashDay>
    <For each={group.rows}>{props.children}</For>
  </>}</For>;
}

export function ShowMore(props: { total: number; shown: number; onMore: () => void }) {
  return <Show when={props.total > props.shown}><SplitGroupMore onClick={props.onMore}>Show more <small>{props.total - props.shown}</small></SplitGroupMore></Show>;
}

type ProfileLike = { id: string; label: string; implementation?: string };

/** The profile a chat runs under: the one it was started from, else, for a
 *  harness chat that records no template, the profile electing its harness. */
export function profileOf(profiles: ProfileLike[], chat: { templateId?: string | null; harnessId?: string; backend?: { implementation: string } }) {
  if (chat.templateId) return chat.templateId;
  const harness = chat.harnessId || chat.backend?.implementation;
  return (harness && profiles.find((profile) => profile.implementation === harness)?.id) || "";
}

/** One choice in the Filters menu: a name and its options, one in force. */
export type ListChoice = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; short?: string; detail?: JSX.Element; icon?: JSX.Element; disabled?: boolean }>;
};

function ChoiceGroup(props: { choice: ListChoice }) {
  return <MenuSection title={props.choice.label}>
    <MenuRadioGroup value={props.choice.value} onChange={(value: string) => props.choice.onChange(value)}>
      <For each={props.choice.options}>{(option) => <MenuRadioItem value={option.value} disabled={option.disabled} icon={option.icon} meta={option.detail}>
        {option.label}
      </MenuRadioItem>}</For>
    </MenuRadioGroup>
  </MenuSection>;
}

/** One choice as its own quiet dropdown, naming the option in force. */
function ChoiceFilter(props: { choice: ListChoice }) {
  const current = () => props.choice.options.find((option) => option.value === props.choice.value) ?? props.choice.options[0];
  return <Menu modal={false}>
    <MenuControl as={GroupAction} title={props.choice.label}>{current()?.short ?? current()?.label}<Icons.ChevronDown /></MenuControl>
    <MenuContent><ChoiceGroup choice={props.choice} /></MenuContent>
  </Menu>;
}

/**
 * The heading's filters on its one line, beside the switches: each choice its
 * own dropdown, and as room runs out the last ones fold, in order, into a ⋯
 * menu before search (the children), as watchFold has it.
 */
export function FilterBar(props: { choices: Array<ListChoice | false | null | undefined>; children?: JSX.Element }) {
  const choices = () => props.choices.filter(Boolean) as ListChoice[];
  const [fit, setFit] = createSignal(Infinity);
  let more!: HTMLSpanElement;
  onMount(() => watchFold(more, setFit));
  return <>
    <Index each={choices()}>{(choice, index) => <span data-fold data-folded={index >= fit() ? "" : undefined}><ChoiceFilter choice={choice()} /></span>}</Index>
    <span ref={more} data-fold-more data-folded={fit() >= choices().length ? "" : undefined}><FiltersMenu title="More filters" trigger={<Icons.More />} choices={choices().slice(fit())} /></span>
    {props.children}
  </>;
}

/** On one column the heading's switches and filters fold into one menu:
 *  each choice a group, the current option bold (no tick). */
export function FiltersMenu(props: { choices: Array<ListChoice | false | null | undefined>; title?: string; trigger?: JSX.Element }) {
  const choices = () => props.choices.filter(Boolean) as ListChoice[];
  return <Menu modal={false}>
    <MenuControl as={GroupAction} title={props.title ?? "Filters"}>{props.trigger ?? <>Filters<Icons.ChevronDown /></>}</MenuControl>
    <MenuContent>
      <For each={choices()}>{(choice) => <ChoiceGroup choice={choice} />}</For>
    </MenuContent>
  </Menu>;
}

export const sortChoice = (sort: "latest" | "created", onSort: (sort: "latest" | "created") => void): ListChoice => ({
  label: "Sort by", value: sort, onChange: (value) => onSort(value as "latest" | "created"),
  options: [{ value: "latest", label: "Latest activity", short: "Latest" }, { value: "created", label: "Created" }],
});

export const profileChoice = (profiles: ProfileLike[], used: Set<string>, value: string, onChange: (id: string) => void): ListChoice | null => profiles.length ? {
  label: "Profile", value, onChange,
  options: [
    { value: "", label: "All profiles", icon: <Icons.Profile /> },
    ...profiles.map((item) => ({ value: item.id, label: item.label, icon: <HarnessMark id={item.implementation || "conduit"} />, disabled: !used.has(item.id) && item.id !== value })),
  ],
} : null;

export const placeChoice = (label: string, all: string, places: Array<{ id: string; label: string; project: Project }>, value: string, onChange: (id: string) => void): ListChoice | null => places.length ? {
  label, value, onChange,
  options: [
    { value: "", label: all, icon: <Icons.Profile /> },
    ...places.map((item) => ({ value: item.id, label: item.label, icon: <PlaceGlyph project={item.project} /> })),
  ],
} : null;

export const harnessChoice = (harnesses: Array<{ id: string; label: string }>, value: string, onChange: (id: string) => void): ListChoice => ({
  label: "Harness", value, onChange,
  options: [
    { value: "", label: "All harnesses", icon: <Icons.Profile /> },
    ...harnesses.map((item) => ({ value: item.id, label: item.label, icon: <HarnessMark id={item.id} /> })),
  ],
});

/** The chats list's compact heading: the list showing and its count. */
export function CompactHeading(props: { label: string; count: number; where?: string | false }) {
  return <GroupCompactHeading label={props.label} count={props.count} where={props.where} />;
}

export function ListSearch(props: { label: string; onClick: () => void }) {
  return <GroupAction aria-label={props.label} title={props.label} onClick={props.onClick}><Icons.Search /></GroupAction>;
}
