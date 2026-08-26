import { createEffect, createSignal, onCleanup } from "solid-js";
import { Settings as SettingsCore } from "./settings-core";
import {
  COMPOSER_SURFACE_CHANGE_EVENT,
  saveComposerSurface,
  selectedComposerSurface,
  type ComposerSurfaceMode,
} from "../chat/composer-surface";
import type { VoiceDictationSettings } from "../chat/voice-dictation-types";
import "./voice-settings.css";

type CoreProps = Parameters<typeof SettingsCore>[0];
type SettingsProps = Omit<CoreProps, "composerSurface" | "onComposerSurfaceChange" | "voiceSettings"> & {
  voiceSettings: VoiceDictationSettings;
};

// Current main owns the single Settings dialog, including the complete Voice
// section. This shell only supplies rebuild-owned presentation preferences; it
// never swaps Settings trees and performs no Voice lifecycle translation.
export function Settings(props: SettingsProps) {
  const [composerSurface, setComposerSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());

  createEffect(() => {
    if (!props.open) return;
    setComposerSurface(selectedComposerSurface());
  });

  createEffect(() => {
    if (typeof window === "undefined") return;
    const syncSurface = () => setComposerSurface(selectedComposerSurface());
    window.addEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncSurface);
    onCleanup(() => window.removeEventListener(COMPOSER_SURFACE_CHANGE_EVENT, syncSurface));
  });

  const updateComposerSurface = (surface: ComposerSurfaceMode) => {
    setComposerSurface(saveComposerSurface(surface));
  };

  return <SettingsCore
      {...props}
      composerSurface={composerSurface()}
      onComposerSurfaceChange={updateComposerSurface}
      voiceSettings={props.voiceSettings}
    />;
}
