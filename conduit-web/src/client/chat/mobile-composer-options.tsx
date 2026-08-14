import { For, Show, createUniqueId, onCleanup } from "solid-js";
import type { ParentProps } from "solid-js";
// Kobalte's public dropdown-menu entrypoint does not expose this hook, but its
// menu content uses the same context. The compiled chunk keeps the context
// identity shared with the public component.
// @ts-expect-error Kobalte does not publish declarations for this internal chunk.
import { useMenuContext } from "../../../node_modules/@kobalte/core/dist/chunk/L544S5A4.jsx";
import type { FocusOutsideEvent } from "@kobalte/core";
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
  MenuSubTrigger,
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
  const selectedModelLabel = () => selectedModel()?.label || composer.models.model() || "Not selected";
  const selectedProfileLabel = () => composer.activeProfile?.label || composer.activeProfile?.id || "General";
  const levels = () => selectedModel()?.thinkingLevels || ["off"];
  const profileLocked = () => composer.chat.status() !== "draft";
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

  const preserveComposerFocusOnPointerDown = (_event: PointerEvent) => {
    captureComposerFocus();
  };

  const restoreComposerFocusAfterInteraction = (event: MouseEvent) => {
    const target = event.target;
    if (target instanceof Element && target.closest('[aria-haspopup="true"]')) return;
    requestAnimationFrame(focusComposer);
  };

  const keepComposerFocusInsideMenu = (event: FocusOutsideEvent) => {
    const target = event.detail.originalEvent.target;
    if (target instanceof HTMLTextAreaElement && target.getAttribute("aria-label") === "Message Pi") event.preventDefault();
  };

  return <div class="composer-mobile-plus">
    <Menu modal={false}>
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
      <MenuContent class="composer-options-menu" onOpenAutoFocus={preserveComposerFocus} onCloseAutoFocus={preserveComposerFocusOnClose} onFocusOutside={keepComposerFocusInsideMenu} onPointerDown={preserveComposerFocusOnPointerDown} onClick={restoreComposerFocusAfterInteraction}>
        <MenuGroup>
          <MenuLabel class="composer-options-label">Message options</MenuLabel>
          <MenuSub>
            <MobileComposerSubTrigger disabled={!composer.serverOnline} captureComposerFocus={captureComposerFocus} restoreComposerFocus={() => requestAnimationFrame(focusComposer)}>
              <SlidersHorizontalIcon /><span>Model</span><span class="composer-options-preview ml-auto max-w-28 truncate text-right text-xs italic text-muted-foreground">{selectedModelLabel()}</span>
            </MobileComposerSubTrigger>
            <MenuContent class="composer-options-submenu composer-model-menu" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()} onFocusOutside={keepComposerFocusInsideMenu} onPointerDown={preserveComposerFocusOnPointerDown} onClick={restoreComposerFocusAfterInteraction}>
              <MenuGroup>
                <MenuLabel class="composer-options-label">Model</MenuLabel>
                <Show when={composer.models.notice()}><div class="composer-option-note">{composer.models.notice()}</div></Show>
                <MenuRadioGroup value={composer.models.model()} onChange={(value) => void composer.models.chooseModel(value)}>
                  <For each={composer.models.models()}>{(item) => <MobileComposerSubmenuRadioItem value={item.spec} restoreComposerFocus={() => requestAnimationFrame(focusComposer)}><span class="truncate">{item.label}</span><span class="ml-auto text-xs text-muted-foreground">{item.provider}</span></MobileComposerSubmenuRadioItem>}</For>
                </MenuRadioGroup>
              </MenuGroup>
              <MenuSeparator />
              <MenuItem onSelect={() => composer.onOpenSettings("models")}>Manage models…</MenuItem>
            </MenuContent>
          </MenuSub>
          <MenuSeparator />
          <MenuGroup>
            <MenuLabel class="composer-options-label">Effort</MenuLabel>
            <MenuRadioGroup value={composer.models.effort()} onChange={(value) => void composer.models.chooseEffort(value)}>
              <For each={levels()}>{(level) => <MenuRadioItem value={level} closeOnSelect={false}>{thinkingLabel(level)}</MenuRadioItem>}</For>
            </MenuRadioGroup>
          </MenuGroup>
          <Show when={composer.profiles.length}>
            <MenuSeparator />
            <MenuSub>
              <MobileComposerSubTrigger captureComposerFocus={captureComposerFocus} restoreComposerFocus={() => requestAnimationFrame(focusComposer)}>
                <UserRoundIcon /><span>Profile</span><span class="composer-options-preview ml-auto max-w-28 truncate text-right text-xs italic text-muted-foreground">{selectedProfileLabel()}</span>
              </MobileComposerSubTrigger>
              <MenuContent class="composer-options-submenu composer-profile-menu" onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()} onFocusOutside={keepComposerFocusInsideMenu} onPointerDown={preserveComposerFocusOnPointerDown} onClick={restoreComposerFocusAfterInteraction}>
                <MenuGroup>
                  <MenuLabel class="composer-options-label">Profile</MenuLabel>
                  <Show when={profileLocked()}><div class="composer-option-note">Locked after the first message.</div></Show>
                  <MenuRadioGroup value={composer.activeProfile?.id || ""} onChange={composer.onChooseProfile}>
                    <For each={composer.profiles}>{(item) => <MobileComposerSubmenuRadioItem value={item.id} disabled={profileLocked() || item.disabled} restoreComposerFocus={() => requestAnimationFrame(focusComposer)}>{item.label}</MobileComposerSubmenuRadioItem>}</For>
                  </MenuRadioGroup>
                </MenuGroup>
                <MenuSeparator />
                <MenuItem onSelect={() => composer.onOpenSettings("profiles")}>Manage profiles…</MenuItem>
              </MenuContent>
            </MenuSub>
          </Show>
          <MenuSeparator />
          <MenuItem disabled={!composer.serverOnline} onSelect={composer.onOpenAttachments}>
            <PaperclipIcon /><span>Attach files</span>
          </MenuItem>
        </MenuGroup>
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

function MobileComposerSubTrigger(props: ParentProps<{
  disabled?: boolean;
  captureComposerFocus: () => void;
  restoreComposerFocus: () => void;
}>) {
  const menu = useMenuContext();
  return <MenuSubTrigger
    disabled={props.disabled}
    onPointerDown={(event) => {
      props.captureComposerFocus();
      event.preventDefault();
      if (!props.disabled) menu.open(true);
      requestAnimationFrame(props.restoreComposerFocus);
    }}
    onPointerUp={(event) => { event.preventDefault(); }}
    onClick={() => props.restoreComposerFocus()}
    class="composer-options-subtrigger"
  >{props.children}</MenuSubTrigger>;
}

function MobileComposerSubmenuRadioItem(props: ParentProps<{
  value: string;
  disabled?: boolean;
  restoreComposerFocus: () => void;
}>) {
  const menu = useMenuContext();
  return <MenuRadioItem value={props.value} disabled={props.disabled} closeOnSelect={false} onSelect={() => { menu.close(false); requestAnimationFrame(props.restoreComposerFocus); }}>{props.children}</MenuRadioItem>;
}

export default MobileComposerOptions;
