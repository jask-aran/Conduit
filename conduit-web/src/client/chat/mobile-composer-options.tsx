import { For, Show, createSignal, createUniqueId, onCleanup } from "solid-js";
// Kobalte's public dropdown-menu entrypoint does not expose this hook, but its
// menu content uses the same context. The compiled chunk keeps the context
// identity shared with the public component.
// @ts-expect-error Kobalte does not publish declarations for this internal chunk.
import { useMenuContext } from "../../../node_modules/@kobalte/core/dist/chunk/L544S5A4.jsx";
import type { FocusOutsideEvent } from "@kobalte/core";
import { ChevronRightIcon, PaperclipIcon, PlusIcon, SearchIcon, ShieldCheckIcon } from "lucide-solid";
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

const thinkingLabel = (value: string) => value ? value[0]!.toUpperCase() + value.slice(1) : "Off";
type MobileOptionsPanel = "root" | "models" | "effort" | "profiles" | "permissions";

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
  };
}) {
  const composer = props.composer;
  const selectedModel = () => composer.models.models().find((item) => item.spec === composer.models.model());
  const selectedModelLabel = () => selectedModel()?.label || composer.models.model() || "Not selected";
  const selectedProfileLabel = () => composer.activeProfile?.label || composer.activeProfile?.id || "General";
  const selectedPermissionLabel = () => composer.permissions?.profiles().find((profile) => profile.id === composer.permissions?.selected())?.label || "Default";
  const levels = () => selectedModel()?.thinkingLevels || ["off"];
  const profileLocked = () => composer.chat.status() !== "draft";
  const [panel, setPanel] = createSignal<MobileOptionsPanel>("root");
  const context = () => contextUsagePercent(composer.chat.contextUsage());
  /* A choice in a submenu returns to the options rather than closing them:
     the next thing is often beside it -- a new model's effort. */
  const chosen = (apply: () => void) => { apply(); go("root"); };
  /* A tap that changes the panel lands on pointerup, and the panel changes
     under the finger -- but the same tap's compatibility mouse events follow,
     onto whatever is now beneath it: the effort slider took them as a second
     choice, a submenu row as a highlight that read as a second pick. The
     whole menu stays inert until that tap is over.
     A timer alone lost the race on a slow re-render, so the tap's mouse events
     are dropped outright until the next finger comes down; the timer only
     keeps the new panel from being hit-tested in the meantime. */
  const go = (next: MobileOptionsPanel) => { setPanel(next); settle(); };
  const [settling, setSettling] = createSignal(false);
  let settleTimer: number | undefined;
  let ghostTimer: number | undefined;
  let dropGhosts = false;
  const settle = () => {
    setSettling(true);
    dropGhosts = true;
    window.clearTimeout(settleTimer);
    window.clearTimeout(ghostTimer);
    settleTimer = window.setTimeout(() => setSettling(false), 400);
    ghostTimer = window.setTimeout(() => { dropGhosts = false; }, 1500);
  };
  const dropGhost = (event: Event) => {
    if (!dropGhosts) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const nextTap = () => { dropGhosts = false; };
  const ghostEvents = ["mousedown", "mouseup", "click"] as const;
  window.addEventListener("pointerdown", nextTap, true);
  for (const type of ghostEvents) window.addEventListener(type, dropGhost, true);
  onCleanup(() => {
    window.clearTimeout(settleTimer);
    window.clearTimeout(ghostTimer);
    window.removeEventListener("pointerdown", nextTap, true);
    for (const type of ghostEvents) window.removeEventListener(type, dropGhost, true);
  });
  let composerFocusBeforeOpen: HTMLTextAreaElement | null = null;
  let keyboardOpenBeforeOpen = false;
  let restoreFocusOnClose = false;

  const captureComposerFocus = () => {
    if (composerFocusBeforeOpen) {
      return;
    }
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement) || active.getAttribute("aria-label") !== "Message the agent") {
      composerFocusBeforeOpen = null;
      keyboardOpenBeforeOpen = false;
      return;
    }
    composerFocusBeforeOpen = active;
    const viewport = window.visualViewport;
    keyboardOpenBeforeOpen = !viewport || window.innerHeight - viewport.height > 120;
  };

  const focusComposer = () => {
    if (keyboardOpenBeforeOpen && composerFocusBeforeOpen?.isConnected) composerFocusBeforeOpen.focus({ preventScroll: true });
  };

  const preserveComposerFocus = (event: Event) => {
    event.preventDefault();
    focusComposer();
  };

  const restoreComposerFocusAfterClose = () => {
    const target = composerFocusBeforeOpen;
    const restore = keyboardOpenBeforeOpen;
    const refocus = () => { if (restore && target?.isConnected) target.focus({ preventScroll: true }); };
    refocus();
    if (restore) {
      window.setTimeout(refocus, 80);
      window.setTimeout(refocus, 240);
    }
    focusComposer();
    composerFocusBeforeOpen = null;
    keyboardOpenBeforeOpen = false;
    restoreFocusOnClose = false;
  };

  const preserveComposerFocusOnClose = (event: Event) => {
    if (restoreFocusOnClose) {
      event.preventDefault();
      restoreComposerFocusAfterClose();
      return;
    }
    composerFocusBeforeOpen = null;
    keyboardOpenBeforeOpen = false;
  };

  const preserveComposerFocusOnPointerDown = (_event: PointerEvent) => {
    captureComposerFocus();
  };

  const restoreComposerFocusAfterInteraction = (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Element && target.closest('[aria-haspopup="true"]')) return;
    requestAnimationFrame(focusComposer);
  };

  const keepMenuOpenOnFocusOutside = (event: FocusOutsideEvent) => event.preventDefault();
  const returnToRoot = (event: PointerEvent) => {
    if (panel() === "root") return;
    event.preventDefault();
    event.stopPropagation();
    go("root");
  };

  return <div class="composer-mobile-plus">
    <Menu modal={false} onOpenChange={(open) => { if (!open) setPanel("root"); }}>
      <MobileComposerPlusTrigger
        serverOnline={composer.serverOnline}
        captureComposerFocus={captureComposerFocus}
        onToggle={(wasOpen) => {
          restoreFocusOnClose = wasOpen;
          if (wasOpen) {
            requestAnimationFrame(() => { if (restoreFocusOnClose) focusComposer(); });
            window.setTimeout(() => { if (restoreFocusOnClose) restoreComposerFocusAfterClose(); }, 500);
          }
        }}
      />
      <MenuContent class="composer-options-menu" data-settling={settling()} onOpenAutoFocus={preserveComposerFocus} onCloseAutoFocus={preserveComposerFocusOnClose} onFocusOutside={keepMenuOpenOnFocusOutside} onPointerDown={preserveComposerFocusOnPointerDown} onClick={restoreComposerFocusAfterInteraction}>
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
         </MenuGroup>
        </div>
        <Show when={panel() === "models"}>
          <div class="composer-options-submenu composer-model-menu">
            <MenuGroup>
              <Show when={composer.onOpenModelSelector}>
                <MenuItem onSelect={() => composer.onOpenModelSelector?.()}><SearchIcon /><span>Search all models…</span></MenuItem>
                <MenuSeparator />
              </Show>
              <MenuLabel class="composer-options-label">Model</MenuLabel>
              <MenuRadioGroup value={composer.models.model()} onChange={(value) => chosen(() => void composer.models.chooseModel(value))}>
                <For each={composer.models.models()}>{(item) => <MenuRadioItem class="composer-model-option" value={item.spec} closeOnSelect={false}><span>{item.label}</span><small>{item.provider}</small></MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
          </div>
        </Show>
        <Show when={panel() === "effort"}>
          <div class="composer-options-submenu composer-effort-menu">
            <MenuGroup>
              <MenuLabel class="composer-options-label">Effort</MenuLabel>
              <MenuRadioGroup value={composer.models.effort()} onChange={(value) => chosen(() => void composer.models.chooseEffort(value))}>
                <For each={levels()}>{(level) => <MenuRadioItem value={level} closeOnSelect={false}>{thinkingLabel(level)}</MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
          </div>
        </Show>
        <Show when={panel() === "profiles"}>
          <div class="composer-options-submenu composer-profile-menu">
            <MenuGroup>
              <MenuLabel class="composer-options-label">Profile</MenuLabel>
              <MenuRadioGroup value={composer.activeProfile?.id || ""} onChange={(value) => chosen(() => composer.onChooseProfile(value))}>
                <For each={composer.profiles}>{(item) => <MenuRadioItem value={item.id} disabled={(profileLocked() && item.id !== composer.activeProfile?.id) || item.disabled} closeOnSelect={false}>
                  <HarnessMark id={item.implementation || "conduit"} class="size-4" /><span class="composer-profile-copy"><span>{item.label}</span><small>{item.implementation || "conduit"}</small></span></MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
          </div>
        </Show>
        <Show when={panel() === "permissions"}>
          <div class="composer-options-submenu composer-permissions-menu">
            <MenuGroup>
              <MenuLabel class="composer-options-label">Permissions</MenuLabel>
              <MenuRadioGroup value={composer.permissions?.selected() || ""} onChange={(value) => chosen(() => void composer.permissions?.choose(value))}>
                <For each={composer.permissions?.profiles() || []}>{(profile) => <MenuRadioItem class="composer-model-option" value={profile.id} disabled={!profile.allowed} closeOnSelect={false}><span>{profile.label}</span><Show when={profile.description}><small>{profile.description}</small></Show></MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
            <Show when={composer.serviceLevels?.levels().length}>
              <MenuSeparator />
              <MenuGroup>
                <MenuLabel class="composer-options-label">Service level</MenuLabel>
                <MenuRadioGroup value={composer.serviceLevels?.selected() || ""} onChange={(value) => chosen(() => void composer.serviceLevels?.choose(value))}>
                  <For each={composer.serviceLevels?.levels() || []}>{(level) => <MenuRadioItem value={level.id} closeOnSelect={false}>{level.label}</MenuRadioItem>}</For>
                </MenuRadioGroup>
              </MenuGroup>
            </Show>
          </div>
        </Show>
      </MenuContent>
    </Menu>
  </div>;
}

function MobileComposerPlusTrigger(props: {
  serverOnline: boolean;
  captureComposerFocus: () => void;
  onToggle: (wasOpen: boolean) => void;
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
    onPointerDown={(event) => { props.captureComposerFocus(); event.preventDefault(); }}
    onTouchStart={props.captureComposerFocus}
    onClick={(event) => { event.preventDefault(); props.onToggle(menu.isOpen()); menu.toggle(false); }}
  ><PlusIcon /></button>;
}

export default MobileComposerOptions;
