import { For, Show } from "solid-js";
import { PaperclipIcon, PlusIcon, SlidersHorizontalIcon, UserRoundIcon } from "lucide-solid";
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
import type { ModelSettings } from "../state/model-settings";

const thinkingLabel = (value: string) => value ? value[0]!.toUpperCase() + value.slice(1) : "Off";

export function MobileComposerOptions(props: {
  composer: {
    models: ModelSettings;
    profiles: Template[];
    activeProfile?: Template | null;
    chat: ActiveChatStore;
    serverOnline: boolean;
    onChooseProfile: (id: string) => void;
    onOpenSettings: (section: string) => void;
    onOpenAttachments: () => void;
  };
}) {
  const composer = props.composer;
  const selectedModel = () => composer.models.models().find((item) => item.spec === composer.models.model());
  const levels = () => selectedModel()?.thinkingLevels || ["off"];
  const profileLocked = () => composer.chat.status() !== "draft";

  return <div class="composer-mobile-plus">
    <Menu>
      <MenuTrigger class="composer-plus-trigger" aria-label="Message options" title="Message options" disabled={!composer.serverOnline}><PlusIcon /></MenuTrigger>
      <MenuContent class="composer-options-menu">
        <MenuGroup>
          <MenuLabel class="composer-options-label">Message options</MenuLabel>
          <MenuSub>
            <MenuSubTrigger disabled={!composer.serverOnline} class="composer-options-subtrigger">
              <SlidersHorizontalIcon /><span>Model and effort</span>
            </MenuSubTrigger>
            <MenuSubContent class="composer-options-submenu composer-model-menu">
              <MenuGroup>
                <MenuLabel class="composer-options-label">Model</MenuLabel>
                <Show when={composer.models.notice()}><div class="composer-option-note">{composer.models.notice()}</div></Show>
                <MenuRadioGroup value={composer.models.model()} onChange={(value) => void composer.models.chooseModel(value)}>
                  <For each={composer.models.models()}>{(item) => <MenuRadioItem value={item.spec}><span class="truncate">{item.label}</span><span class="ml-auto text-xs text-muted-foreground">{item.provider}</span></MenuRadioItem>}</For>
                </MenuRadioGroup>
              </MenuGroup>
              <MenuSeparator />
              <MenuGroup>
                <MenuLabel class="composer-options-label">Thinking</MenuLabel>
                <MenuRadioGroup value={composer.models.effort()} onChange={(value) => void composer.models.chooseEffort(value)}>
                  <For each={levels()}>{(level) => <MenuRadioItem value={level}>{thinkingLabel(level)}</MenuRadioItem>}</For>
                </MenuRadioGroup>
              </MenuGroup>
              <MenuSeparator />
              <MenuItem onSelect={() => composer.onOpenSettings("models")}>Manage models…</MenuItem>
            </MenuSubContent>
          </MenuSub>
          <Show when={composer.profiles.length}>
            <MenuSub>
              <MenuSubTrigger class="composer-options-subtrigger">
                <UserRoundIcon /><span>Profile</span>
              </MenuSubTrigger>
              <MenuSubContent class="composer-options-submenu composer-profile-menu">
                <MenuGroup>
                  <MenuLabel class="composer-options-label">Profile</MenuLabel>
                  <Show when={profileLocked()}><div class="composer-option-note">Locked after the first message.</div></Show>
                  <MenuRadioGroup value={composer.activeProfile?.id || ""} onChange={composer.onChooseProfile}>
                    <For each={composer.profiles}>{(item) => <MenuRadioItem value={item.id} disabled={profileLocked() || item.disabled}>{item.label}</MenuRadioItem>}</For>
                  </MenuRadioGroup>
                </MenuGroup>
                <MenuSeparator />
                <MenuItem onSelect={() => composer.onOpenSettings("profiles")}>Manage profiles…</MenuItem>
              </MenuSubContent>
            </MenuSub>
          </Show>
          <MenuItem disabled={!composer.serverOnline} onSelect={composer.onOpenAttachments}>
            <PaperclipIcon /><span>Attach files</span>
          </MenuItem>
        </MenuGroup>
      </MenuContent>
    </Menu>
  </div>;
}

export default MobileComposerOptions;
