import { createSignal, For, Show } from "solid-js";
import { GaugeIcon, PaperclipIcon, PlusIcon, ShieldCheckIcon } from "lucide-solid";
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
} from "@/components/primitives";
import type { Template } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import type { ServiceLevelSettings } from "../state/service-level-settings";
import type { ComposerModels } from "./composer-models";
import type { ComposerPermissions } from "./composer-permissions";
import type { ComposerFold } from "./composer-folds";
import { contextUsagePercent } from "./context-metrics";
import { ModelMenuItems } from "./model-selector";
import { PlaceGlyph, PlaceList, type PlaceOptions } from "./place-picker";
import { HarnessMark } from "../harness-brand";

/**
 * The desktop composer's +: Attach, the project, and each control the row has folded away
 * for want of room, as a submenu showing its value -- the desktop menus'
 * parent and child pattern (the model selector's), with the same choices the
 * control itself offers. The phone has its own options menu.
 */
export function ComposerPlusMenu(props: {
  folded: ReadonlySet<ComposerFold>;
  chat: ActiveChatStore;
  models: ComposerModels;
  permissions?: ComposerPermissions;
  serviceLevels?: ServiceLevelSettings;
  profiles: Template[];
  activeProfile?: Template | null;
  place?: PlaceOptions;
  disabled: boolean;
  modelSwitch: boolean;
  onChooseProfile: (id: string) => void;
  onOpenModelSelector?: () => void;
  modelSelectorShortcut?: string | null;
  onAttach?: () => void;
}) {
  const has = (key: ComposerFold) => props.folded.has(key);
  const model = () => props.models.models().find((item) => item.spec === props.models.model());
  const permission = () => props.permissions?.profiles().find((profile) => profile.id === props.permissions?.selected());
  const service = () => props.serviceLevels?.levels().find((level) => level.id === props.serviceLevels?.selected());
  const context = () => contextUsagePercent(props.chat.contextUsage());
  const placed = () => props.place?.current && props.place.current.slug !== "chat" ? props.place.current : null;
  const anyFolded = () => props.folded.size > 0;
  const [open, setOpen] = createSignal(false);

  return <Menu open={open()} onOpenChange={setOpen}>
    <MenuTrigger class="composer-plus-trigger" aria-label="Attach and more" title="Attach and more" disabled={props.disabled}><PlusIcon /></MenuTrigger>
    <MenuContent class="composer-plus-menu">
      <Show when={has("model")}>
        <MenuSub>
          <MenuSubTrigger disabled={!props.modelSwitch}><span class="composer-plus-name">Model</span><span class="composer-plus-value">{model()?.label || props.models.model() || "Not selected"}</span></MenuSubTrigger>
          <MenuSubContent class="composer-quick-model-menu">
            <ModelMenuItems models={props.models.models()} model={props.models.model()} thinkingLevel={props.models.effort()} notice={props.models.notice()}
              onModelChange={(value) => void props.models.chooseModel(value)} onThinkingLevelChange={(value) => void props.models.chooseEffort(value)}
              onSearchModels={props.onOpenModelSelector} searchShortcut={props.modelSelectorShortcut} />
          </MenuSubContent>
        </MenuSub>
      </Show>
      <Show when={has("profile") && props.profiles.length}>
        <MenuSub>
          <MenuSubTrigger><HarnessMark id={props.activeProfile?.implementation || "conduit"} class="size-4" /><span class="composer-plus-name">Profile</span><span class="composer-plus-value">{props.activeProfile?.label || "General"}</span></MenuSubTrigger>
          <MenuSubContent class="w-72">
            <MenuGroup><MenuLabel>Profile</MenuLabel><MenuRadioGroup value={props.activeProfile?.id || ""} onChange={props.onChooseProfile}>
              <For each={props.profiles}>{(item) => <MenuRadioItem value={item.id} disabled={(props.chat.status() !== "draft" && item.id !== props.activeProfile?.id) || item.disabled}><HarnessMark id={item.implementation || "conduit"} class="size-4" /><span class="composer-profile-copy"><span>{item.label}</span><small>{item.implementation || "conduit"}</small></span></MenuRadioItem>}</For>
            </MenuRadioGroup></MenuGroup>
          </MenuSubContent>
        </MenuSub>
      </Show>
      <Show when={has("permissions") && props.permissions?.profiles().length}>
        <MenuSub>
          <MenuSubTrigger><ShieldCheckIcon /><span class="composer-plus-name">Permissions</span><span class="composer-plus-value">{permission()?.label || "Default"}</span></MenuSubTrigger>
          <MenuSubContent class="w-72">
            <MenuGroup><MenuLabel>Permissions</MenuLabel><MenuRadioGroup value={props.permissions?.selected() || ""} onChange={(value) => void props.permissions?.choose(value)}>
              <For each={props.permissions?.profiles() || []}>{(profile) => <MenuRadioItem value={profile.id} disabled={!profile.allowed}><span class="shrink-0 whitespace-nowrap">{profile.label}</span><Show when={profile.description}><span class="ml-auto max-w-40 truncate text-xs text-muted-foreground">{profile.description}</span></Show></MenuRadioItem>}</For>
            </MenuRadioGroup></MenuGroup>
          </MenuSubContent>
        </MenuSub>
      </Show>
      <Show when={has("permissions") && props.serviceLevels?.levels().length}>
        <MenuSub>
          <MenuSubTrigger><GaugeIcon /><span class="composer-plus-name">Service level</span><span class="composer-plus-value">{service()?.label || "Default"}</span></MenuSubTrigger>
          <MenuSubContent>
            <MenuGroup><MenuLabel>Service level</MenuLabel><MenuRadioGroup value={props.serviceLevels?.selected() || ""} onChange={(value) => void props.serviceLevels?.choose(value)}>
              <For each={props.serviceLevels?.levels() || []}>{(level) => <MenuRadioItem value={level.id}>{level.label}</MenuRadioItem>}</For>
            </MenuRadioGroup></MenuGroup>
          </MenuSubContent>
        </MenuSub>
      </Show>
      <Show when={props.place}>
        <Show when={anyFolded()}><MenuSeparator /></Show>
        <MenuSub>
          <MenuSubTrigger disabled={props.place!.disabled}><PlaceGlyph project={placed()} /><span class="composer-plus-name">Project</span><span class="composer-plus-value">{placed()?.name || "None"}</span></MenuSubTrigger>
          <MenuSubContent class="composer-place-menu">
            {/* The folder button's own list. Keys stay with its search, not the menu's typeahead. */}
            <div ref={(element) => requestAnimationFrame(() => element.querySelector("input")?.focus())}
              onKeyDown={(event) => { if (event.key !== "Escape") event.stopPropagation(); }}>
              <PlaceList {...props.place!} onDone={() => setOpen(false)} />
            </div>
          </MenuSubContent>
        </MenuSub>
      </Show>
      <Show when={has("context") && context() != null}>
        <div class="composer-plus-context">{Math.round(context()!)}% of context used</div>
      </Show>
      <Show when={props.onAttach}>
        <Show when={anyFolded() || props.place}><MenuSeparator /></Show>
        <MenuItem onSelect={() => props.onAttach?.()}><PaperclipIcon /><span>Attach files</span></MenuItem>
      </Show>
    </MenuContent>
  </Menu>;
}
