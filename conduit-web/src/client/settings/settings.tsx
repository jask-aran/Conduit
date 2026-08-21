import { createEffect, createSignal, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";
import { Field, FieldLabel } from "@/components/primitives";
import { Settings as SettingsCore } from "./settings-core";
import {
  COMPOSER_SURFACE_CHANGE_EVENT,
  COMPOSER_SURFACE_OPTIONS,
  saveComposerSurface,
  selectedComposerSurface,
  type ComposerSurfaceMode,
} from "../chat/composer-surface";
import "./voice-settings.css";

const METEOR_FIELD_STORAGE_KEY = "conduit:meteor-field";

const selectedMeteorField = () => typeof localStorage === "undefined" || localStorage.getItem(METEOR_FIELD_STORAGE_KEY) !== "false";
const applyMeteorField = (enabled: boolean) => {
  if (typeof document !== "undefined") document.documentElement.dataset.meteorField = enabled ? "on" : "off";
};
if (typeof document !== "undefined") applyMeteorField(selectedMeteorField());

// The rebuild owns composer material as a three-way preference. Current main's
// Settings dialog is otherwise the canonical Settings implementation, including
// the complete Voice section. This wrapper supplies only rebuild-specific app
// preferences; it does not switch Settings implementations or translate Voice.
export function Settings(props: any) {
  const [meteorField, setMeteorField] = createSignal(selectedMeteorField());
  const [composerSurface, setComposerSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  const [surfaceMount, setSurfaceMount] = createSignal<HTMLElement | null>(null);

  createEffect(() => {
    if (!props.open) return;
    setMeteorField(selectedMeteorField());
    setComposerSurface(selectedComposerSurface());
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const syncSurface = () => setComposerSurface(selectedComposerSurface());
    window.addEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncSurface);
    onCleanup(() => window.removeEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncSurface));
  });

  createEffect(() => {
    setSurfaceMount(null);
    if (!props.open || typeof document === "undefined") return;
    const syncMount = () => {
      const group = document.querySelector<HTMLElement>(".settings-dialog .settings-content[data-section='ui'] > [data-slot='field-group']");
      setSurfaceMount(group || null);
    };
    requestAnimationFrame(syncMount);
    const observer = new MutationObserver(syncMount);
    const dialog = document.querySelector<HTMLElement>(".settings-dialog");
    if (dialog) observer.observe(dialog, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-section"] });
    onCleanup(() => observer.disconnect());
  });

  const updateMeteorField = (enabled: boolean) => {
    setMeteorField(enabled);
    localStorage.setItem(METEOR_FIELD_STORAGE_KEY, String(enabled));
    applyMeteorField(enabled);
  };

  const updateComposerSurface = (surface: ComposerSurfaceMode) => {
    setComposerSurface(saveComposerSurface(surface));
  };

  const voiceSettings = () => ({
    shortcut: props.voiceSettings?.shortcut || "Ctrl+Shift+D",
    activation: props.voiceSettings?.activation === "toggle" ? "toggle" as const : "push_to_talk" as const,
    autoSend: props.voiceSettings?.autoSend === true,
    inputDeviceId: typeof props.voiceSettings?.inputDeviceId === "string" ? props.voiceSettings.inputDeviceId : "",
    captureProfile: props.voiceSettings?.captureProfile === "processed" ? "processed" as const : "raw" as const,
    warmMicrophone: props.voiceSettings?.warmMicrophone === true,
  });

  return <>
    <SettingsCore
      {...props}
      meteorField={meteorField()}
      onMeteorFieldChange={updateMeteorField}
      liquidGlassSurface={composerSurface() === "liquid"}
      onLiquidGlassSurfaceChange={(enabled: boolean) => updateComposerSurface(enabled ? "liquid" : composerSurface() === "static" ? "static" : "frost")}
      voiceSettings={voiceSettings()}
      onVoiceSettingsSave={(settings: unknown) => props.onVoiceSettingsSave(settings)}
    />
    <Show when={surfaceMount()}>{(mount) => <Portal mount={mount()}>
      <Field class="performance-composer-surface-setting">
        <FieldLabel for="composer-surface-mode">Composer material</FieldLabel>
        <select id="composer-surface-mode" aria-label="Composer material" value={composerSurface()} onChange={(event) => updateComposerSurface(event.currentTarget.value as ComposerSurfaceMode)}>
          {COMPOSER_SURFACE_OPTIONS.map((option) => <option value={option.value}>{option.label}</option>)}
        </select>
        <small>{COMPOSER_SURFACE_OPTIONS.find((option) => option.value === composerSurface())?.description}</small>
      </Field>
    </Portal>}</Show>
  </>;
}
