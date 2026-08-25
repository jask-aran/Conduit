import { createMemo, For, Show } from "solid-js";
import { ChevronDownIcon } from "lucide-solid";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/primitives";
import type { ModelOption } from "../api/contracts";

const thinkingLabel = (value: string) => value ? value[0]!.toUpperCase() + value.slice(1) : "Off";

export function ModelSelector(props: {
  models: ModelOption[];
  model: string;
  thinkingLevel: string;
  notice?: string;
  disabled?: boolean;
  onModelChange: (spec: string) => void;
  onThinkingLevelChange: (level: string) => void;
  onManageModels?: () => void;
}) {
  const selected = createMemo(() => props.models.find((item) => item.spec === props.model));
  const levels = createMemo(() => selected()?.thinkingLevels || ["off"]);

  return <Menu>
    <MenuTrigger class="model-trigger" aria-label={`${selected()?.label || props.model || "Model"} ${props.thinkingLevel || "off"}`} disabled={props.disabled}>
      <span>{selected()?.label || props.model || "Model"}</span>
      <span class="text-muted-foreground">{props.thinkingLevel || "off"}</span>
      <ChevronDownIcon />
    </MenuTrigger>
    <MenuContent class="w-72">
      <MenuGroup>
        <MenuLabel>Model</MenuLabel>
        <Show when={props.notice}><div class="px-2 pb-2 text-xs text-muted-foreground">{props.notice}</div></Show>
        <MenuRadioGroup value={props.model} onChange={props.onModelChange}>
          <For each={props.models}>{(item) => <MenuRadioItem value={item.spec}><span class="truncate">{item.label}</span><span class="ml-auto text-xs text-muted-foreground">{item.provider}</span></MenuRadioItem>}</For>
        </MenuRadioGroup>
      </MenuGroup>
      <Show when={selected()}><MenuSeparator />
        <MenuGroup>
          <MenuLabel>Thinking</MenuLabel>
          <MenuRadioGroup value={props.thinkingLevel} onChange={props.onThinkingLevelChange}>
            <For each={levels()}>{(level) => <MenuRadioItem value={level}>{thinkingLabel(level)}</MenuRadioItem>}</For>
          </MenuRadioGroup>
        </MenuGroup>
      </Show>
      <Show when={props.onManageModels}><MenuSeparator /><MenuItem onSelect={props.onManageModels}>Manage models…</MenuItem></Show>
    </MenuContent>
  </Menu>;
}
