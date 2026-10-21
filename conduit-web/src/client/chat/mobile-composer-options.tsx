import { HarnessMark } from "@/components/ui";
import { Icons } from "@/components/ui";
import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";

import { Section, Slider } from "@/components/ui";
import { DropdownMenu, MenuContent, MenuPillTrigger, MenuRadioGroup, MenuRadioItem, MenuRow, MenuSection, MenuSub, MenuSubContent, MenuSubTrigger, MenuSubValue, useMenuBack } from "@/components/menus";
import type { Template } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import type { ComposerModels } from "./composer-models";
import type { ComposerPermissions } from "./composer-permissions";
import type { ServiceLevelSettings } from "../state/service-level-settings";

import { contextUsagePercent } from "./context-metrics";
import { isWorkspace, PlaceGlyph, type PlaceOptions } from "./place-picker";
import { PermissionChoices, ProfileChoices, ServiceChoices } from "./composer-plus-menu";

const thinkingLabel = (value: string) => value ? value[0]!.toUpperCase() + value.slice(1) : "Off";

export function MobileComposerOptions(props: {
  /** Told when the menu opens and closes (a PhoneComposer dims under it). */
  onOpenChange?: (open: boolean) => void;
  composer: {
    models: ComposerModels;
    permissions?: ComposerPermissions;
    serviceLevels?: ServiceLevelSettings;
    profiles: Template[];
    activeProfile?: Template | null;
    chat: ActiveChatStore;
    serverOnline: boolean;
    onChooseProfile: (id: string) => void;
    onOpenSettings: (section: string) => void;
    onOpenModelSelector?: () => void;
    onOpenAttachments: () => void;
    place?: PlaceOptions;
  };
}) {
  const composer = props.composer;
  const selectedModel = () => composer.models.models().find((item) => item.spec === composer.models.model());
  const selectedModelLabel = () => selectedModel()?.label || composer.models.model() || "Not selected";
  const selectedProfileLabel = () => composer.activeProfile?.label || composer.activeProfile?.id || "General";
  const selectedPermissionLabel = () => composer.permissions?.profiles().find((profile) => profile.id === composer.permissions?.selected())?.label || "Default";
  const levels = () => selectedModel()?.thinkingLevels?.length ? selectedModel()!.thinkingLevels! : ["off"];
  const profileLocked = () => composer.chat.status() !== "draft";
  const [open, setOpen] = createSignal(false);
  const context = () => contextUsagePercent(composer.chat.contextUsage());
  const preserveFocus = (event: Event) => event.preventDefault();

  /* The bubble composer's other controls dim while the menu is open, as a
     parent menu does under its submenu. */
  let root!: HTMLButtonElement;
  createEffect(() => props.onOpenChange?.(open()));
  /* Closing hands focus back to the trigger; with the text pill open it goes
     back to the textarea instead, in the same task, so the keyboard stays. */
  let typingAtOpen: HTMLTextAreaElement | null = null;
  const composerTextarea = () => {
    const active = document.activeElement;
    return active instanceof HTMLTextAreaElement && root.closest(".ui-phone-composer")?.contains(active) ? active : null;
  };
  const restoreTyping = () => {
    const textarea = typingAtOpen;
    if (!textarea) return;
    // Kept until the close has run: the menu root focuses the trigger after this.
    setTimeout(() => { if (!open()) typingAtOpen = null; });
    textarea.focus({ preventScroll: true });
    queueMicrotask(() => { if (document.activeElement !== textarea) textarea.focus({ preventScroll: true }); });
  };
  /* With the text pill open, tapping out of the menu closes only the menu: the
     tap's default focus change would blur the textarea and drop the keyboard. */
  const keepKeyboard = (event: PointerEvent) => {
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement) || !root.closest(".ui-phone-composer")?.contains(active)) return;
    if ((event.target as Element | null)?.closest?.('[data-slot="ui-menu-content"], [data-slot="ui-menu-sub-content"]')) return;
    event.preventDefault();
  };
  createEffect(() => {
    if (!open()) return;
    window.addEventListener("pointerdown", keepKeyboard, true);
    onCleanup(() => window.removeEventListener("pointerdown", keepKeyboard, true));
  });

  const placed = () => composer.place?.current && composer.place.current.slug !== "chat" ? composer.place.current : null;
  return <DropdownMenu modal={false} placement="top-start" open={open()} onOpenChange={(value) => { if (value) typingAtOpen = composerTextarea(); setOpen(value); }}>
      <MenuPillTrigger label="Message options" icon={<Icons.Add />} open={open()} disabled={!composer.serverOnline} keep={() => typingAtOpen !== null} ref={(element) => { root = element; }} />
      <MenuContent keep={() => typingAtOpen !== null} onOpenAutoFocus={preserveFocus} onCloseAutoFocus={(event) => { event.preventDefault(); restoreTyping(); }} onFocusOutside={preserveFocus}>
        {/* A phone option shows its value, not its name: the section names it. */}
        <MenuSection title={composer.profiles.length ? "Profile" : "Model"} note={context() != null ? `${Math.round(context()!)}% context` : undefined}>
          <Show when={composer.profiles.length}>
            <MenuSub phone>
              <MenuSubTrigger icon={<HarnessMark id={composer.activeProfile?.implementation || "conduit"} />} aria-label={`Profile ${selectedProfileLabel()}`}>{selectedProfileLabel()}</MenuSubTrigger>
              <MenuSubContent><ProfileChoices profiles={composer.profiles} active={composer.activeProfile} locked={profileLocked()} back onChoose={composer.onChooseProfile} /></MenuSubContent>
            </MenuSub>
          </Show>
        </MenuSection>
        <MenuSection title={composer.profiles.length ? "Model" : undefined}>
          <MenuSub phone>
            <MenuSubTrigger disabled={!composer.serverOnline} aria-label={`Model ${selectedModelLabel()}`}>{selectedModelLabel()}</MenuSubTrigger>
            <MenuSubContent><ModelChoices composer={composer} /></MenuSubContent>
          </MenuSub>
        </MenuSection>
        <Section kind="slider">
          <Slider label="Effort" value={composer.models.effort()} disabled={!composer.serverOnline || levels().length < 2}
            options={levels().map((level) => ({ value: level, label: thinkingLabel(level) }))} onChange={(value) => void composer.models.chooseEffort(value)}
            control={(shown) => <MenuSub phone>
              <MenuSubValue disabled={!composer.serverOnline || levels().length < 2}>{shown()}</MenuSubValue>
              <MenuSubContent><EffortChoices composer={composer} levels={levels()} /></MenuSubContent>
            </MenuSub>} />
        </Section>
        <Show when={composer.permissions?.profiles().length}>
          <MenuSection title="Permissions">
            <MenuSub phone>
              <MenuSubTrigger icon={<Icons.Permissions />} aria-label={`Permissions ${selectedPermissionLabel()}`}>{selectedPermissionLabel()}</MenuSubTrigger>
              <MenuSubContent>
                <PermissionChoices permissions={composer.permissions!} back />
                <Show when={composer.serviceLevels?.levels().length}><ServiceChoices levels={composer.serviceLevels!} back /></Show>
              </MenuSubContent>
            </MenuSub>
          </MenuSection>
        </Show>
        <MenuSection>
          <MenuRow icon={<Icons.Attach />} disabled={!composer.serverOnline} onSelect={composer.onOpenAttachments}>Attach files</MenuRow>
        </MenuSection>
        <Show when={composer.place}>{(place) => <MenuSection title="Project">
          <MenuSub phone>
            <MenuSubTrigger disabled={place().disabled} icon={<PlaceGlyph project={placed()} />} aria-label={placed() ? `Project ${placed()!.name}` : "Add to a project folder"}>{placed()?.name || "Add to a project folder"}</MenuSubTrigger>
            <MenuSubContent><PlaceChoices place={place()} /></MenuSubContent>
          </MenuSub>
        </MenuSection>}</Show>
      </MenuContent>
    </DropdownMenu>;
}

type Options = Parameters<typeof MobileComposerOptions>[0]["composer"];

function ModelChoices(props: { composer: Options }) {
  const back = useMenuBack();
  return <>
    <Show when={props.composer.onOpenModelSelector}>
      <MenuSection><MenuRow icon={<Icons.Search />} onSelect={() => props.composer.onOpenModelSelector?.()}>Search all models…</MenuRow></MenuSection>
    </Show>
    <MenuSection title="Model"><MenuRadioGroup value={props.composer.models.model()} onChange={(value) => { void props.composer.models.chooseModel(value); back(); }}>
      <For each={props.composer.models.models()}>{(item) => <MenuRadioItem value={item.spec} closeOnSelect={false} meta={item.provider}>{item.label}</MenuRadioItem>}</For>
    </MenuRadioGroup></MenuSection>
  </>;
}

function EffortChoices(props: { composer: Options; levels: string[] }) {
  const back = useMenuBack();
  return <MenuSection title="Effort"><MenuRadioGroup value={props.composer.models.effort()} onChange={(value) => { void props.composer.models.chooseEffort(value); back(); }}>
    <For each={props.levels}>{(level) => <MenuRadioItem value={level} closeOnSelect={false}>{thinkingLabel(level)}</MenuRadioItem>}</For>
  </MenuRadioGroup></MenuSection>;
}

/** Projects before workspaces, and "No folder" first when the chat is in one. */
function PlaceChoices(props: { place: PlaceOptions }) {
  const root = () => props.place.projects.find((project) => project.slug === "chat");
  const places = () => props.place.projects.filter((project) => project.slug !== "chat" && project.state !== "cloning")
    .sort((left, right) => Number(isWorkspace(left)) - Number(isWorkspace(right)) || left.name.localeCompare(right.name));
  const choose = (id: string) => {
    const project = props.place.projects.find((item) => item.id === id);
    if (project && id !== props.place.current?.id) props.place.onChoose(project);
  };
  return <MenuSection title="Project"><MenuRadioGroup value={props.place.current?.id || ""} onChange={choose}>
    <Show when={props.place.current && props.place.current.slug !== "chat" && root()}>
      <MenuRadioItem value={root()!.id} icon={<Icons.Folder />}>No folder</MenuRadioItem>
    </Show>
    <For each={places()}>{(project) => <MenuRadioItem value={project.id} icon={<PlaceGlyph project={project} />}>{project.name}</MenuRadioItem>}</For>
  </MenuRadioGroup></MenuSection>;
}

export default MobileComposerOptions;
