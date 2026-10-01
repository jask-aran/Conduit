import { createMemo, For, Show } from "solid-js";
import { ChevronDownIcon, SearchIcon } from "lucide-solid";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuSub,
  MenuSubContent,
  MenuSubTrigger,
  MenuTrigger,
  Spinner,
} from "@/components/primitives";
import type { ModelOption } from "../api/contracts";
import { StepSlider } from "./step-slider";

const thinkingLabel = (value: string) => value ? value[0]!.toUpperCase() + value.slice(1) : "Off";

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

/** The model menu's contents: the model selector's, and the composer +'s Model submenu. */
export function ModelMenuItems(props: ModelMenuProps) {
  const selected = createMemo(() => props.models.find((item) => item.spec === props.model));
  const selectableModels = createMemo(() => props.models.filter((item) => !item.outsideScope));
  // A model with no levels still shows the slider, held on its one setting.
  const levels = createMemo(() => selected()?.thinkingLevels?.length ? selected()!.thinkingLevels! : ["off"]);
  return <>
      <Show when={props.onSearchModels}>
        <MenuItem onSelect={() => props.onSearchModels?.()}><SearchIcon class="size-3.5" /><span>Search all models…</span><Show when={props.searchShortcut}><kbd class="composer-menu-shortcut">{props.searchShortcut}</kbd></Show></MenuItem>
        <MenuSeparator />
      </Show>
      <Show when={!props.onSearchModels && props.notice}><div class="px-2 pb-2 text-xs text-muted-foreground">{props.notice}</div></Show>
      <MenuRadioGroup value={props.model} onChange={props.onModelChange}>
        <For each={selectableModels()}>{(item) => <MenuRadioItem class="composer-model-option" value={item.spec} closeOnSelect={false}><span title={item.label}>{item.label}</span><small>{item.provider}</small></MenuRadioItem>}</For>
      </MenuRadioGroup>
      <Show when={selected()}><MenuSeparator />
        <StepSlider label="Thinking" value={levels().length > 1 ? props.thinkingLevel : levels()[0]!} disabled={levels().length < 2}
          options={levels().map((level) => ({ value: level, label: thinkingLabel(level) }))}
          valueControl={levels().length < 2 ? undefined : (label) => <MenuSub>
            <MenuSubTrigger class="step-slider-value">{label()}</MenuSubTrigger>
            <MenuSubContent>
              <MenuGroup><MenuLabel>Thinking</MenuLabel><MenuRadioGroup value={props.thinkingLevel} onChange={props.onThinkingLevelChange}>
                <For each={levels()}>{(level) => <MenuRadioItem value={level}>{thinkingLabel(level)}</MenuRadioItem>}</For>
              </MenuRadioGroup></MenuGroup>
            </MenuSubContent>
          </MenuSub>}
          onChange={props.onThinkingLevelChange} />
      </Show>
      <Show when={props.onManageModels}><MenuSeparator /><MenuItem onSelect={props.onManageModels}>Manage models…</MenuItem></Show>
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
}) {
  const selected = createMemo(() => props.models.find((item) => item.spec === props.model));
  const selectableModels = createMemo(() => props.models.filter((item) => !item.outsideScope));
  // A model with no levels still shows the slider, held on its one setting.
  const levels = createMemo(() => selected()?.thinkingLevels?.length ? selected()!.thinkingLevels! : ["off"]);
  const label = createMemo(() => selected()?.label || props.model);
  // A catalogue we already hold is the answer while the next one loads: the
  // agent's own spinner already says something is starting, so swapping this
  // trigger for a second one just churns the composer.
  const pending = createMemo(() => Boolean(props.loading) && !label());

  return <Menu>
    <MenuTrigger class="model-trigger" classList={{ "composer-model-trigger": Boolean(props.onSearchModels) }} aria-label={pending() ? "Connecting to model" : `${label() || "Model"} ${props.thinkingLevel || "off"}`} disabled={props.disabled || pending()}>
      <Show when={!pending()} fallback={<><Spinner /><span>Connecting…</span></>}>
        <span>{label() || "Model"}</span>
        <span class="text-muted-foreground">{props.thinkingLevel || "off"}</span>
        <ChevronDownIcon />
      </Show>
    </MenuTrigger>
    <MenuContent class={props.onSearchModels ? "composer-quick-model-menu" : "w-72"}>
      <ModelMenuItems {...props} />
    </MenuContent>
  </Menu>;
}
