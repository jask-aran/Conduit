import { For, Show, createSignal, createUniqueId, onCleanup } from "solid-js";
// Kobalte's public dropdown-menu entrypoint does not expose this hook, but its
// menu content uses the same context. The compiled chunk keeps the context
// identity shared with the public component.
// @ts-expect-error Kobalte does not publish declarations for this internal chunk.
import { useMenuContext } from "../../../node_modules/@kobalte/core/dist/chunk/L544S5A4.jsx";
import type { FocusOutsideEvent } from "@kobalte/core";
import { ChevronLeftIcon, ChevronRightIcon, PaperclipIcon, PlusIcon, SlidersHorizontalIcon, UserRoundIcon } from "lucide-solid";
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
import type { ModelSettings } from "../state/model-settings";

const thinkingLabel = (value: string) => value ? value[0]!.toUpperCase() + value.slice(1) : "Off";
type OptionsView = "root" | "model" | "profile";

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
  const selectedModelLabel = () => selectedModel()?.label || composer.models.model() || "Not selected";
  const selectedProfileLabel = () => composer.activeProfile?.label || composer.activeProfile?.id || "General";
  const levels = () => selectedModel()?.thinkingLevels || ["off"];
  const profileLocked = () => composer.chat.status() !== "draft";
  const [view, setView] = createSignal<OptionsView>("root");
  let composerFocusBeforeOpen: HTMLTextAreaElement | null = null;
  let keyboardOpenBeforeOpen = false;
  let restoreFocusOnClose = false;

  const captureComposerFocus = () => {
    if (composerFocusBeforeOpen) {
      return;
    }
    const active = document.activeElement;
    if (!(active instanceof HTMLTextAreaElement) || active.getAttribute("aria-label") !== "Message Pi") {
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

  const captureComposerFocusOnPointerDown = (_event: PointerEvent) => {
    captureComposerFocus();
  };

  const preserveComposerFocusOnPointerDown = (event: PointerEvent) => {
    captureComposerFocus();
    if (keyboardOpenBeforeOpen) event.preventDefault();
  };

  const restoreComposerFocusAfterInteraction = (_event: MouseEvent) => {
    requestAnimationFrame(focusComposer);
  };

  const keepComposerFocusInsideMenu = (event: FocusOutsideEvent) => {
    const target = event.detail.originalEvent.target;
    if (target instanceof HTMLTextAreaElement && target.getAttribute("aria-label") === "Message Pi") event.preventDefault();
  };

  return <div class="composer-mobile-plus">
    <Menu modal={false} onOpenChange={(open) => { if (!open) setView("root"); }}>
      <MobileComposerPlusTrigger
        serverOnline={composer.serverOnline}
        captureComposerFocus={captureComposerFocus}
        onToggle={(wasOpen) => {
          if (!wasOpen) setView("root");
          restoreFocusOnClose = wasOpen;
          if (wasOpen) {
            requestAnimationFrame(() => { if (restoreFocusOnClose) focusComposer(); });
            window.setTimeout(() => { if (restoreFocusOnClose) restoreComposerFocusAfterClose(); }, 500);
          }
        }}
      />
      <MenuContent class="composer-options-menu" onOpenAutoFocus={preserveComposerFocus} onCloseAutoFocus={preserveComposerFocusOnClose} onFocusOutside={keepComposerFocusInsideMenu} onPointerDown={captureComposerFocusOnPointerDown} onClick={restoreComposerFocusAfterInteraction}>
        <Show when={view() === "root"}>
          <MenuGroup>
            <MenuLabel class="composer-options-label">Message options</MenuLabel>
            <MenuItem disabled={!composer.serverOnline} closeOnSelect={false} onPointerDown={preserveComposerFocusOnPointerDown} onSelect={() => setView("model")}>
              <SlidersHorizontalIcon /><span>Model</span><span class="composer-options-preview ml-auto max-w-28 truncate text-right text-xs italic text-muted-foreground">{selectedModelLabel()}</span><ChevronRightIcon class="menu-chevron" />
            </MenuItem>
            <MenuSeparator />
            <MenuGroup>
              <MenuLabel class="composer-options-label">Effort</MenuLabel>
              <MenuRadioGroup value={composer.models.effort()} onChange={(value) => void composer.models.chooseEffort(value)}>
                <For each={levels()}>{(level) => <MenuRadioItem value={level} closeOnSelect={false} onPointerDown={preserveComposerFocusOnPointerDown}>{thinkingLabel(level)}</MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
            <Show when={composer.profiles.length}>
              <MenuSeparator />
              <MenuItem closeOnSelect={false} onPointerDown={preserveComposerFocusOnPointerDown} onSelect={() => setView("profile")}>
                <UserRoundIcon /><span>Profile</span><span class="composer-options-preview ml-auto max-w-28 truncate text-right text-xs italic text-muted-foreground">{selectedProfileLabel()}</span><ChevronRightIcon class="menu-chevron" />
              </MenuItem>
            </Show>
            <MenuSeparator />
            <MenuItem disabled={!composer.serverOnline} onSelect={composer.onOpenAttachments}>
              <PaperclipIcon /><span>Attach files</span>
            </MenuItem>
          </MenuGroup>
        </Show>
        <Show when={view() === "model"}>
          <div class="composer-options-panel composer-model-menu">
            <MenuGroup>
              <MenuItem closeOnSelect={false} onPointerDown={preserveComposerFocusOnPointerDown} onSelect={() => setView("root")} textValue="Back to message options">
                <ChevronLeftIcon /><span>Message options</span>
              </MenuItem>
              <MenuSeparator />
              <MenuLabel class="composer-options-label">Model</MenuLabel>
              <Show when={composer.models.notice()}><div class="composer-option-note">{composer.models.notice()}</div></Show>
              <MenuRadioGroup value={composer.models.model()} onChange={(value) => void composer.models.chooseModel(value)}>
                <For each={composer.models.models()}>{(item) => <MenuRadioItem value={item.spec} closeOnSelect={false} onPointerDown={preserveComposerFocusOnPointerDown} onSelect={() => setView("root")}><span class="truncate">{item.label}</span><span class="ml-auto text-xs text-muted-foreground">{item.provider}</span></MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem onSelect={() => composer.onOpenSettings("models")}>Manage models…</MenuItem>
          </div>
        </Show>
        <Show when={view() === "profile"}>
          <div class="composer-options-panel composer-profile-menu">
            <MenuGroup>
              <MenuItem closeOnSelect={false} onPointerDown={preserveComposerFocusOnPointerDown} onSelect={() => setView("root")} textValue="Back to message options">
                <ChevronLeftIcon /><span>Message options</span>
              </MenuItem>
              <MenuSeparator />
              <MenuLabel class="composer-options-label">Profile</MenuLabel>
              <Show when={profileLocked()}><div class="composer-option-note">Locked after the first message.</div></Show>
              <MenuRadioGroup value={composer.activeProfile?.id || ""} onChange={composer.onChooseProfile}>
                <For each={composer.profiles}>{(item) => <MenuRadioItem value={item.id} disabled={profileLocked() || item.disabled} closeOnSelect={false} onPointerDown={preserveComposerFocusOnPointerDown} onSelect={() => setView("root")}>{item.label}</MenuRadioItem>}</For>
              </MenuRadioGroup>
            </MenuGroup>
            <MenuSeparator />
            <MenuItem onSelect={() => composer.onOpenSettings("profiles")}>Manage profiles…</MenuItem>
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
