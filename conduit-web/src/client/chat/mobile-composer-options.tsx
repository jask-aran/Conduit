import { createSignal, For, Show } from "solid-js";
import { PaperclipIcon, PlusIcon, SlidersHorizontalIcon, UserRoundIcon } from "lucide-solid";
import { Button, Dialog, DialogContent, Menu, MenuContent, MenuGroup, MenuItem, MenuLabel, MenuTrigger } from "@/components/primitives";
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
  const [modelSheetOpen, setModelSheetOpen] = createSignal(false);
  const [profileSheetOpen, setProfileSheetOpen] = createSignal(false);
  const composer = props.composer;
  const selectedModel = () => composer.models.models().find((item) => item.spec === composer.models.model());
  const levels = () => selectedModel()?.thinkingLevels || ["off"];
  return <>
    <div class="composer-mobile-plus">
      <Menu>
        <MenuTrigger class="composer-plus-trigger" aria-label="Message options" title="Message options" disabled={!composer.serverOnline}><PlusIcon /></MenuTrigger>
        <MenuContent class="composer-options-menu">
          <MenuGroup>
            <MenuLabel>Message options</MenuLabel>
            <MenuItem disabled={!composer.serverOnline} onSelect={() => setModelSheetOpen(true)}>
              <SlidersHorizontalIcon /><span>Model and effort</span><span class="composer-option-value">{selectedModel()?.label || composer.models.model() || "Model"} · {thinkingLabel(composer.models.effort())}</span>
            </MenuItem>
            <Show when={composer.profiles.length}>
              <MenuItem onSelect={() => setProfileSheetOpen(true)}>
                <UserRoundIcon /><span>Profile</span><span class="composer-option-value">{composer.activeProfile?.label || "General"}</span>
              </MenuItem>
            </Show>
            <MenuItem disabled={!composer.serverOnline} onSelect={composer.onOpenAttachments}>
              <PaperclipIcon /><span>Attach files</span>
            </MenuItem>
          </MenuGroup>
        </MenuContent>
      </Menu>
    </div>
    <Dialog open={modelSheetOpen()} onOpenChange={setModelSheetOpen}>
      <DialogContent class="mobile-composer-options-sheet" title="Model and effort" closeLabel="Close model and effort">
        <div class="mobile-composer-options-scroll">
          <section class="composer-option-section" aria-labelledby="composer-model-title">
            <h3 id="composer-model-title">Model</h3>
            <Show when={composer.models.notice()}><p class="composer-option-note">{composer.models.notice()}</p></Show>
            <div class="composer-option-list" role="radiogroup" aria-labelledby="composer-model-title">
              <For each={composer.models.models()}>{(item) => <Button type="button" variant={composer.models.model() === item.spec ? "outline" : "ghost"} class="composer-option-choice" role="radio" aria-checked={composer.models.model() === item.spec} onClick={() => void composer.models.chooseModel(item.spec)}><span>{item.label}</span><span class="composer-option-choice-meta">{item.provider}</span></Button>}</For>
            </div>
          </section>
          <section class="composer-option-section" aria-labelledby="composer-effort-title">
            <h3 id="composer-effort-title">Thinking</h3>
            <div class="composer-option-list" role="radiogroup" aria-labelledby="composer-effort-title">
              <For each={levels()}>{(level) => <Button type="button" variant={composer.models.effort() === level ? "outline" : "ghost"} class="composer-option-choice" role="radio" aria-checked={composer.models.effort() === level} onClick={() => void composer.models.chooseEffort(level)}>{thinkingLabel(level)}</Button>}</For>
            </div>
          </section>
          <Button type="button" variant="ghost" class="composer-sheet-manage" onClick={() => { setModelSheetOpen(false); composer.onOpenSettings("models"); }}>Manage models…</Button>
        </div>
      </DialogContent>
    </Dialog>
    <Show when={composer.profiles.length}>
      <Dialog open={profileSheetOpen()} onOpenChange={setProfileSheetOpen}>
        <DialogContent class="mobile-composer-options-sheet" title="Profile" closeLabel="Close profile choices">
          <div class="mobile-composer-options-scroll">
            <Show when={composer.chat.status() !== "draft"}><p class="composer-option-note">Locked for this chat after the first message.</p></Show>
            <div class="composer-option-list" role="radiogroup" aria-label="Profile choices">
              <For each={composer.profiles}>{(item) => <Button type="button" variant={composer.activeProfile?.id === item.id ? "outline" : "ghost"} class="composer-option-choice" role="radio" aria-checked={composer.activeProfile?.id === item.id} disabled={composer.chat.status() !== "draft" || item.disabled} onClick={() => { composer.onChooseProfile(item.id); setProfileSheetOpen(false); }}>{item.label}</Button>}</For>
            </div>
            <Button type="button" variant="ghost" class="composer-sheet-manage" onClick={() => { setProfileSheetOpen(false); composer.onOpenSettings("profiles"); }}>Manage profiles…</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Show>
  </>;
}

export default MobileComposerOptions;
