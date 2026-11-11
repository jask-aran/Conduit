import { Icons } from "@/components/ui";
import { createMemo, For, Show } from "solid-js";

import { Picker, Section, Slider, Spinner, Note } from "@/components/ui";
import { DropdownMenu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubValue } from "@/components/ui/menus";
import type { ModelOption } from "../api/contracts";

const LEVEL_NAMES: Record<string, string> = { xhigh: "Extra high" };
export const thinkingLabel = (value: string, model?: ModelOption) =>
  model?.thinkingLabels?.[value || "off"] || (value ? LEVEL_NAMES[value] || value[0]!.toUpperCase() + value.slice(1) : "Off");

type ModelMenuProps = {
  models: ModelOption[];
  model: string;
  thinkingLevel: string;
  notice?: string;
  onModelChange: (spec: string) => void;
  onThinkingLevelChange: (level: string) => void;
  onSearchModels?: () => void;
  searchShortcut?: string | null;
  onManageModels?: () => void;
};

export function ModelMenuItems(props: ModelMenuProps) {
  const selected = createMemo(() => props.models.find((item) => item.spec === props.model));
  const selectableModels = createMemo(() => props.models.filter((item) => !item.outsideScope));
  const levels = createMemo(() => selected()?.thinkingLevels?.length ? selected()!.thinkingLevels! : ["off"]);
  return <>
    <Show when={props.onSearchModels}>
      <MenuSection><MenuRow icon={<Icons.Search />} keys={props.searchShortcut?.split(/\s+/)} onSelect={() => props.onSearchModels?.()}>Search all models…</MenuRow></MenuSection>
    </Show>
    <Show when={!props.onSearchModels && props.notice}><Note kind="menu">{props.notice}</Note></Show>
    <MenuSection><MenuRadioGroup value={props.model} onChange={props.onModelChange}>
      <For each={selectableModels()}>{(item) => <MenuRadioItem value={item.spec} closeOnSelect={false} title={item.label} meta={item.provider}>{item.label}</MenuRadioItem>}</For>
    </MenuRadioGroup></MenuSection>
    <Show when={selected()}>
      <Section kind="slider">
        <Slider label="Thinking" value={levels().length > 1 ? props.thinkingLevel : levels()[0]!} disabled={levels().length < 2}
          options={levels().map((level) => ({ value: level, label: thinkingLabel(level, selected()) }))} onChange={props.onThinkingLevelChange}
          control={levels().length < 2 ? undefined : (shown) => <MenuSub>
            <MenuSubValue>{shown()}</MenuSubValue>
            <MenuSubContent><MenuSection title="Thinking"><MenuRadioGroup value={props.thinkingLevel} onChange={props.onThinkingLevelChange}>
              <For each={levels()}>{(level) => <MenuRadioItem value={level}>{thinkingLabel(level, selected())}</MenuRadioItem>}</For>
            </MenuRadioGroup></MenuSection></MenuSubContent>
          </MenuSub>} />
      </Section>
    </Show>
    <Show when={props.onManageModels}><MenuSection><MenuRow onSelect={props.onManageModels}>Manage models…</MenuRow></MenuSection></Show>
  </>;
}

export function ModelSelector(props: {
  models: ModelOption[];
  model: string;
  thinkingLevel: string;
  notice?: string;
  loading?: boolean;
  disabled?: boolean;
  onModelChange: (spec: string) => void;
  onThinkingLevelChange: (level: string) => void;
  onSearchModels?: () => void;
  searchShortcut?: string | null;
  onManageModels?: () => void;
  quiet?: string;
  /** `bottom-end` where the trigger ends a line, so the menu stays put as a choice renames the trigger. */
  placement?: "bottom-start" | "bottom-end";
}) {
  const selected = createMemo(() => props.models.find((item) => item.spec === props.model));
  const label = createMemo(() => selected()?.label || props.model);
  // A catalogue already held stands while the next one loads: the agent's own spinner already says something is
  // starting, and a second one here churns the composer.
  const pending = createMemo(() => Boolean(props.loading) && !label());

  return <DropdownMenu placement={props.placement}>
    <DropdownMenu.Trigger as={Picker} subject={Boolean(props.onSearchModels)} aria-label={pending() ? "Connecting to model" : `${label() || "Model"} ${props.thinkingLevel || "off"}`} disabled={props.disabled || pending()}
      icon={pending() ? <Spinner /> : undefined} value={pending() ? "Connecting…" : label() || "Model"} quiet={pending() ? undefined : props.quiet ?? (selected()?.thinkingLabels?.[props.thinkingLevel || "off"] || props.thinkingLevel || "off")} />
    <MenuContent><ModelMenuItems {...props} /></MenuContent>
  </DropdownMenu>;
}
