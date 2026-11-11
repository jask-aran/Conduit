import { HarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { createSignal, For, Index, onMount, Show, type JSX } from "solid-js";

import { DropdownMenu, MenuContent, MenuSection, MenuRadioGroup, MenuRadioItem, MenuControl } from "@/components/ui/menus";
import { DashDay, GroupAction, GroupCompactHeading } from "@/components/ui/dashboard";

import { SplitGroupMore } from "./split";
import { foldRow } from "@/components/ui/fit";
import { isMobileLayout } from "../../navigation/mobile-layout";
import type { Project } from "../../api/contracts";
import { PlaceGlyph } from "../../chat/place-picker";

export const CHAT_PAGE = 40;

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

function ChoiceFilter(props: { choice: ListChoice }) {
  const current = () => props.choice.options.find((option) => option.value === props.choice.value) ?? props.choice.options[0];
  return <DropdownMenu modal={false}>
    <MenuControl as={GroupAction} title={props.choice.label}>{current()?.short ?? current()?.label}<Icons.ChevronDown /></MenuControl>
    <MenuContent><ChoiceGroup choice={props.choice} /></MenuContent>
  </DropdownMenu>;
}

export function FilterBar(props: { choices: Array<ListChoice | false | null | undefined>; children?: JSX.Element }) {
  const choices = () => props.choices.filter(Boolean) as ListChoice[];
  const [fit, setFit] = createSignal(Infinity);
  let more!: HTMLSpanElement;
  onMount(() => foldRow(more, setFit, isMobileLayout));
  return <>
    <Index each={choices()}>{(choice, index) => <span data-fold data-folded={index >= fit() ? "" : undefined}><ChoiceFilter choice={choice()} /></span>}</Index>
    <span ref={more} data-fold-more data-folded={fit() >= choices().length ? "" : undefined}><FiltersMenu title="More filters" trigger={<Icons.More />} choices={choices().slice(fit())} /></span>
    {props.children}
  </>;
}

export function FiltersMenu(props: { choices: Array<ListChoice | false | null | undefined>; title?: string; trigger?: JSX.Element }) {
  const choices = () => props.choices.filter(Boolean) as ListChoice[];
  return <DropdownMenu modal={false}>
    <MenuControl as={GroupAction} title={props.title ?? "Filters"}>{props.trigger ?? <>Filters<Icons.ChevronDown /></>}</MenuControl>
    <MenuContent>
      <For each={choices()}>{(choice) => <ChoiceGroup choice={choice} />}</For>
    </MenuContent>
  </DropdownMenu>;
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

export function CompactHeading(props: { label: string; count: number; where?: string | false }) {
  return <GroupCompactHeading label={props.label} count={props.count} where={props.where} />;
}

export function ListSearch(props: { label: string; onClick: () => void }) {
  return <GroupAction aria-label={props.label} title={props.label} onClick={props.onClick}><Icons.Search /></GroupAction>;
}
