import { createEffect, createSignal, onCleanup } from "solid-js";
import { Settings as SettingsCore } from "./settings-core";
import {
  COMPOSER_SURFACE_CHANGE_EVENT,
  liquidGlassRuntimeEnabled,
  saveComposerSurface,
  saveLiquidGlassRuntime,
  selectedComposerSurface,
  type ComposerSurfaceMode,
} from "../chat/composer-surface";
import "./voice-settings.css";

const METEOR_FIELD_STORAGE_KEY = "conduit:meteor-field";

type CoreProps = Parameters<typeof SettingsCore>[0];
type CoreVoiceSettings = CoreProps["voiceSettings"];
type ShellVoiceSettings = Omit<CoreVoiceSettings, "captureProfile" | "warmMicrophone"> & Partial<Pick<CoreVoiceSettings, "captureProfile" | "warmMicrophone">>;
type SettingsProps = Omit<CoreProps, "meteorField" | "onMeteorFieldChange" | "composerSurface" | "onComposerSurfaceChange" | "liquidGlassRuntimeEnabled" | "onLiquidGlassRuntimeChange" | "voiceSettings"> & {
  voiceSettings: ShellVoiceSettings;
};

const selectedMeteorField = () => typeof localStorage === "undefined" || localStorage.getItem(METEOR_FIELD_STORAGE_KEY) !== "false";
const applyMeteorField = (enabled: boolean) => {
  if (typeof document !== "undefined") document.documentElement.dataset.meteorField = enabled ? "on" : "off";
};
if (typeof document !== "undefined") applyMeteorField(selectedMeteorField());

// Current main owns the single Settings dialog, including the complete Voice
// section. This shell only supplies rebuild-owned presentation preferences; it
// never swaps Settings trees and performs no Voice lifecycle translation.
export function Settings(props: SettingsProps) {
  const [meteorField, setMeteorField] = createSignal(selectedMeteorField());
  const [composerSurface, setComposerSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  const [liquidGlassEnabled, setLiquidGlassEnabled] = createSignal(liquidGlassRuntimeEnabled());

  createEffect(() => {
    if (!props.open) return;
    setMeteorField(selectedMeteorField());
    setComposerSurface(selectedComposerSurface());
    setLiquidGlassEnabled(liquidGlassRuntimeEnabled());
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const syncSurface = () => setComposerSurface(selectedComposerSurface());
    window.addEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncSurface);
    onCleanup(() => window.removeEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncSurface));
  });

  const updateMeteorField = (enabled: boolean) => {
    setMeteorField(enabled);
    localStorage.setItem(METEOR_FIELD_STORAGE_KEY, String(enabled));
    applyMeteorField(enabled);
  };

  const updateComposerSurface = (surface: ComposerSurfaceMode) => {
    setComposerSurface(saveComposerSurface(surface));
  };

  const updateLiquidGlassRuntime = (enabled: boolean) => {
    if (enabled === liquidGlassEnabled()) return;
    setLiquidGlassEnabled(saveLiquidGlassRuntime(enabled));
    if (!enabled) setComposerSurface("frost");
    window.location.reload();
  };

  const voiceSettings = (): CoreVoiceSettings => ({
    ...props.voiceSettings,
    captureProfile: props.voiceSettings.captureProfile === "processed" ? "processed" : "raw",
    warmMicrophone: props.voiceSettings.warmMicrophone === true,
  });

  return <SettingsCore
      {...props}
      meteorField={meteorField()}
      onMeteorFieldChange={updateMeteorField}
      composerSurface={composerSurface()}
      onComposerSurfaceChange={updateComposerSurface}
      liquidGlassRuntimeEnabled={liquidGlassEnabled()}
      onLiquidGlassRuntimeChange={updateLiquidGlassRuntime}
      voiceSettings={voiceSettings()}
    />;
}
