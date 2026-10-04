import { For, Show, createSignal, createUniqueId, onCleanup } from "solid-js";
import { createPhoneMenuPanels, PhoneMenuSubmenu } from "@/components/phone-menu-panels";
// Kobalte's public dropdown-menu entrypoint does not expose this hook, but its
// menu content uses the same context. The compiled chunk keeps the context
// identity shared with the public component.
// @ts-expect-error Kobalte does not publish declarations for this internal chunk.
import { useMenuContext } from "../../../node_modules/@kobalte/core/dist/chunk/L544S5A4.jsx";
import { ChevronRightIcon, FolderIcon, PaperclipIcon, PlusIcon, SearchIcon, ShieldCheckIcon } from "lucide-solid";
import {
  Menu,
  MenuContent,
  MenuGroup,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
} from "@/components/primitives";
import type { Template } from "../api/contracts";
import type { ActiveChatStore } from "../state/active-chat";
import type { ComposerModels } from "./composer-models";
import type { ComposerPermissions } from "./composer-permissions";
import type { ServiceLevelSettings } from "../state/service-level-settings";
import { HarnessMark } from "../harness-brand";
import { StepSlider } from "./step-slider";
import { contextUsagePercent } from "./context-metrics";
import { isWorkspace, PlaceGlyph, type PlaceOptions } from "./place-picker";

const thinkingLabel = (value: string) => value ? value[0]!.toUpperCase() + value.slice(1) : "Off";
type MobileOptionsPanel = "root" | "models" | "effort" | "profiles" | "permissions" | "places";

export function MobileComposerOptions(props: {
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
  const { panel, go, settling, returnToRoot, keepForChild, reset } = createPhoneMenuPanels<MobileOptionsPanel>("root", open);
  const context = () => contextUsagePercent(composer.chat.contextUsage());
  /* A choice in a submenu returns to the options rather than closing them:
     the next thing is often beside it -- a new model's effort. */
  const chosen = (apply: () => void) => { apply(); go("root"); };
  const preserveFocus = (event: Event) => event.preventDefault();

  return <div class="composer-mobile-plus">
    <Menu modal={false} open={open()} onOpenChange={(value) => { setOpen(value); if (!value) reset(); }}>
      <MobileComposerPlusTrigger serverOnline={composer.serverOnline} />
      <MenuContent class="composer-options-menu" data-settling={settling()} onOpenAutoFocus={preserveFocus} onCloseAutoFocus={preserveFocus} onFocusOutside={preserveFocus} onPointerDownOutside={keepForChild}>
        <div class="composer-options-parent" data-panel-open={panel() !== "root"} onPointerDown={returnToRoot}>
         <MenuGroup>
          <MenuLabel class="composer-options-label composer-options-header"><span>{composer.profiles.length ? "Profile" : "Model"}</span>
            <Show when={context() != null}><span class="composer-options-context">{Math.round(context()!)}% context</span></Show></MenuLabel>
          <Show when={composer.profiles.length}>
            <MenuItem closeOnSelect={false} onSelect={() => go("profiles")} class="composer-options-value" aria-label={`Profile ${selectedProfileLabel()}`}>
              <HarnessMark id={composer.activeProfile?.implementation || "conduit"} class="size-4" /><span>{selectedProfileLabel()}</span><ChevronRightIcon />
            </MenuItem>
            <MenuLabel class="composer-options-label">Model</MenuLabel>
          </Show>
          <MenuItem disabled={!composer.serverOnline} closeOnSelect={false} onSelect={() => go("models")} class="composer-options-value composer-options-model" aria-label={`Model ${selectedModelLabel()}`}>
            <span>{selectedModelLabel()}</span><ChevronRightIcon />
          </MenuItem>
          <MenuSeparator />
          <StepSlider label="Effort" value={composer.models.effort()} disabled={!composer.serverOnline || levels().length < 2}
            options={levels().map((level) => ({ value: level, label: thinkingLabel(level) }))}
            valueControl={(label) => <button type="button" class="step-slider-value" disabled={!composer.serverOnline || levels().length < 2}
              onClick={() => go("effort")}>{label()}<ChevronRightIcon /></button>}
            onChange={(value) => void composer.models.chooseEffort(value)} />
          <Show when={composer.permissions?.profiles().length}>
            <MenuSeparator />
            <MenuLabel class="composer-options-label">Permissions</MenuLabel>
            <MenuItem closeOnSelect={false} onSelect={() => go("permissions")} class="composer-options-value" aria-label={`Permissions ${selectedPermissionLabel()}`}>
              <ShieldCheckIcon /><span>{selectedPermissionLabel()}</span><ChevronRightIcon />
            </MenuItem>
          </Show>
          <MenuSeparator />
          <MenuItem disabled={!composer.serverOnline} onSelect={composer.onOpenAttachments}>
            <PaperclipIcon /><span>Attach files</span>
          </MenuItem>
          <Show when={composer.place}>{(place) => {
            const placed = () => place().current && place().current!.slug !== "chat" ? place().current! : null;
            return <>
              <MenuSeparator />
              <MenuLabel class="composer-options-label">Project</MenuLabel>
              <MenuItem closeOnSelect={false} disabled={place().disabled} onSelect={() => go("places")} class="composer-options-value" aria-label={placed() ? `Project ${placed()!.name}` : "Add to a project folder"}>
                <PlaceGlyph project={placed()} /><span>{placed()?.name || "Add to a project folder"}</span><ChevronRightIcon />
              </MenuItem>
            </>;
          }}</Show>
         </MenuGroup>
        </div>
        <Show when={panel() === "models"}>
          <PhoneMenuSubmenu parent=".composer-options-menu" settling={settling()} class="composer-model-menu">
            <MenuGroup>
              <Show when={composer.onOpenModelSelector}>
                <MenuItem onSelect={() => composer.onOpenModelSelector?.()}><SearchIcon /><span>Search all models…</span></MenuItem>
                <MenuSeparator />
              </Show>
              <MenuLabel class="composer-options-label">Model</MenuLabel>
              <MenuRadioGroup value={composer.models.model()} onChange={(value) => chosen(() => void composer.models.chooseModel(value))}>
                <For each={composer.models.models()}>{(item) => <MenuRadioItem onSelect={() => go("root")} class="composer-model-option" value={item.spec} closeOnSelect={false}><span>{item.label}</span><small>{item.provider}</small></MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
          </PhoneMenuSubmenu>
        </Show>
        <Show when={panel() === "effort"}>
          <PhoneMenuSubmenu parent=".composer-options-menu" settling={settling()} class="composer-effort-menu">
            <MenuGroup>
              <MenuLabel class="composer-options-label">Effort</MenuLabel>
              <MenuRadioGroup value={composer.models.effort()} onChange={(value) => chosen(() => void composer.models.chooseEffort(value))}>
                <For each={levels()}>{(level) => <MenuRadioItem onSelect={() => go("root")} value={level} closeOnSelect={false}>{thinkingLabel(level)}</MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
          </PhoneMenuSubmenu>
        </Show>
        <Show when={panel() === "profiles"}>
          <PhoneMenuSubmenu parent=".composer-options-menu" settling={settling()} class="composer-profile-menu">
            <MenuGroup>
              <MenuLabel class="composer-options-label">Profile</MenuLabel>
              <MenuRadioGroup value={composer.activeProfile?.id || ""} onChange={(value) => chosen(() => composer.onChooseProfile(value))}>
                <For each={composer.profiles}>{(item) => <MenuRadioItem onSelect={() => go("root")} value={item.id} disabled={(profileLocked() && item.id !== composer.activeProfile?.id) || item.disabled} closeOnSelect={false}>
                  <HarnessMark id={item.implementation || "conduit"} class="size-4" /><span class="composer-profile-copy"><span>{item.label}</span><small>{item.implementation || "conduit"}</small></span></MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
          </PhoneMenuSubmenu>
        </Show>
        <Show when={panel() === "places" && composer.place}>{(_) => {
          const place = composer.place!;
          const root = () => place.projects.find((project) => project.slug === "chat");
          const places = () => place.projects.filter((project) => project.slug !== "chat" && project.state !== "cloning")
            .sort((left, right) => Number(isWorkspace(left)) - Number(isWorkspace(right)) || left.name.localeCompare(right.name));
          return <PhoneMenuSubmenu parent=".composer-options-menu" settling={settling()} class="composer-places-menu">
            <MenuGroup>
              <MenuLabel class="composer-options-label">Project</MenuLabel>
              <Show when={place.current && place.current.slug !== "chat" && root()}>
                <MenuItem onSelect={() => place.onChoose(root()!)}><FolderIcon /><span>No folder</span></MenuItem>
              </Show>
              <For each={places()}>{(project) =>
                <MenuItem class={project.id === place.current?.id ? "composer-place-current" : undefined} onSelect={() => { if (project.id !== place.current?.id) place.onChoose(project); }}>
                  <PlaceGlyph project={project} /><span>{project.name}</span>
                </MenuItem>}
              </For>
            </MenuGroup>
          </PhoneMenuSubmenu>;
        }}</Show>
        <Show when={panel() === "permissions"}>
          <PhoneMenuSubmenu parent=".composer-options-menu" settling={settling()} class="composer-permissions-menu">
            <MenuGroup>
              <MenuLabel class="composer-options-label">Permissions</MenuLabel>
              <MenuRadioGroup value={composer.permissions?.selected() || ""} onChange={(value) => chosen(() => void composer.permissions?.choose(value))}>
                <For each={composer.permissions?.profiles() || []}>{(profile) => <MenuRadioItem onSelect={() => go("root")} class="composer-model-option" value={profile.id} disabled={!profile.allowed} closeOnSelect={false}><span>{profile.label}</span><Show when={profile.description}><small>{profile.description}</small></Show></MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
            <Show when={composer.serviceLevels?.levels().length}>
              <MenuSeparator />
              <MenuGroup>
                <MenuLabel class="composer-options-label">Service level</MenuLabel>
                <MenuRadioGroup value={composer.serviceLevels?.selected() || ""} onChange={(value) => chosen(() => void composer.serviceLevels?.choose(value))}>
                  <For each={composer.serviceLevels?.levels() || []}>{(level) => <MenuRadioItem onSelect={() => go("root")} value={level.id} closeOnSelect={false}>{level.label}</MenuRadioItem>}</For>
                </MenuRadioGroup>
              </MenuGroup>
            </Show>
          </PhoneMenuSubmenu>
        </Show>
      </MenuContent>
    </Menu>
  </div>;
}

function MobileComposerPlusTrigger(props: {
  serverOnline: boolean;
}) {
  const menu = useMenuContext();
  const triggerId = `composer-plus-${createUniqueId()}`;
  onCleanup(menu.registerTriggerId(triggerId));

  return <button
    type="button"
    ref={menu.setTriggerRef}
    id={triggerId}
    class="composer-plus-trigger"
    aria-label="Message options"
    title="Message options"
    aria-haspopup="true"
    aria-expanded={menu.isOpen()}
    aria-controls={menu.isOpen() ? menu.contentId() : undefined}
    disabled={!props.serverOnline}
    onPointerDown={(event) => { event.preventDefault(); }}
    onClick={(event) => { event.preventDefault(); menu.toggle(false); }}
  ><PlusIcon /></button>;
}

export default MobileComposerOptions;
