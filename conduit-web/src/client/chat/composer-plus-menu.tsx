import { createSignal, For, Show } from "solid-js";
import { GaugeIcon, PaperclipIcon, PlusIcon, ShieldCheckIcon } from "lucide-solid";
import { Button, MenuNote, Rule } from "@/components/ui";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubTrigger, useMenuBack } from "@/components/menus";
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
    <Menu.Trigger as={Button} variant="ghost" size="icon-sm" aria-label="Attach and more" title="Attach and more" disabled={props.disabled}><PlusIcon /></Menu.Trigger>
    <MenuContent>
      <Show when={has("model")}>
        <MenuSub>
          <MenuSubTrigger disabled={!props.modelSwitch} meta={model()?.label || props.models.model() || "Not selected"}>Model</MenuSubTrigger>
          <MenuSubContent>
            <ModelMenuItems models={props.models.models()} model={props.models.model()} thinkingLevel={props.models.effort()} notice={props.models.notice()}
              onModelChange={(value) => void props.models.chooseModel(value)} onThinkingLevelChange={(value) => void props.models.chooseEffort(value)}
              onSearchModels={props.onOpenModelSelector} searchShortcut={props.modelSelectorShortcut} />
          </MenuSubContent>
        </MenuSub>
      </Show>
      <Show when={has("profile") && props.profiles.length}>
        <MenuSub>
          <MenuSubTrigger icon={<HarnessMark id={props.activeProfile?.implementation || "conduit"} />} meta={props.activeProfile?.label || "General"}>Profile</MenuSubTrigger>
          <MenuSubContent><ProfileChoices profiles={props.profiles} active={props.activeProfile} locked={props.chat.status() !== "draft"} onChoose={props.onChooseProfile} /></MenuSubContent>
        </MenuSub>
      </Show>
      <Show when={has("permissions") && props.permissions?.profiles().length}>
        <MenuSub>
          <MenuSubTrigger icon={<ShieldCheckIcon />} meta={permission()?.label || "Default"}>Permissions</MenuSubTrigger>
          <MenuSubContent><PermissionChoices permissions={props.permissions!} /></MenuSubContent>
        </MenuSub>
      </Show>
      <Show when={has("permissions") && props.serviceLevels?.levels().length}>
        <MenuSub>
          <MenuSubTrigger icon={<GaugeIcon />} meta={service()?.label || "Default"}>Service level</MenuSubTrigger>
          <MenuSubContent><ServiceChoices levels={props.serviceLevels!} /></MenuSubContent>
        </MenuSub>
      </Show>
      <Show when={props.place}>
        <Show when={anyFolded()}><Rule /></Show>
        <MenuSub>
          <MenuSubTrigger disabled={props.place!.disabled} icon={<PlaceGlyph project={placed()} />} meta={placed()?.name || "None"}>Project</MenuSubTrigger>
          <MenuSubContent>
            {/* The folder button's own list. Keys stay with its search, not the menu's typeahead. */}
            <div ref={(element) => requestAnimationFrame(() => element.querySelector("input")?.focus())}
              onKeyDown={(event) => { if (event.key !== "Escape") event.stopPropagation(); }}>
              <PlaceList {...props.place!} onDone={() => setOpen(false)} />
            </div>
          </MenuSubContent>
        </MenuSub>
      </Show>
      <Show when={has("context") && context() != null}><MenuNote>{Math.round(context()!)}% of context used</MenuNote></Show>
      <Show when={props.onAttach}>
        <Show when={anyFolded() || props.place}><Rule /></Show>
        <MenuRow icon={<PaperclipIcon />} onSelect={() => props.onAttach?.()}>Attach files</MenuRow>
      </Show>
    </MenuContent>
  </Menu>;
}

/** back: in a phone's submenu, a choice returns to the options rather than closing them -- the next pick is often beside it. */
const picked = (back: boolean | undefined, apply: (value: string) => void) => {
  const parent = useMenuBack();
  return (value: string) => { apply(value); if (back) parent(); };
};

/** The profiles to start the chat with; once it has started, only its own. */
export function ProfileChoices(props: { profiles: Template[]; active?: Template | null; locked: boolean; back?: boolean; onChoose: (id: string) => void }) {
  const choose = picked(props.back, (id) => props.onChoose(id));
  return <MenuSection title="Profile"><MenuRadioGroup value={props.active?.id || ""} onChange={choose}>
    <For each={props.profiles}>{(item) => <MenuRadioItem value={item.id} closeOnSelect={!props.back} disabled={(props.locked && item.id !== props.active?.id) || item.disabled}
      icon={<HarnessMark id={item.implementation || "conduit"} />} meta={item.implementation || "conduit"}>{item.label}</MenuRadioItem>}</For>
  </MenuRadioGroup></MenuSection>;
}

export function PermissionChoices(props: { permissions: ComposerPermissions; back?: boolean }) {
  const choose = picked(props.back, (value) => void props.permissions.choose(value));
  return <MenuSection title="Permissions"><MenuRadioGroup value={props.permissions.selected() || ""} onChange={choose}>
    <For each={props.permissions.profiles()}>{(profile) => <MenuRadioItem value={profile.id} closeOnSelect={!props.back} disabled={!profile.allowed} detail={profile.description || undefined}>{profile.label}</MenuRadioItem>}</For>
  </MenuRadioGroup></MenuSection>;
}

export function ServiceChoices(props: { levels: ServiceLevelSettings; back?: boolean }) {
  const choose = picked(props.back, (value) => void props.levels.choose(value));
  return <MenuSection title="Service level"><MenuRadioGroup value={props.levels.selected() || ""} onChange={choose}>
    <For each={props.levels.levels()}>{(level) => <MenuRadioItem value={level.id} closeOnSelect={!props.back}>{level.label}</MenuRadioItem>}</For>
  </MenuRadioGroup></MenuSection>;
}
