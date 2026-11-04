import { registerPlugin } from "@capacitor/core";
import { installedClientKind } from "./installed-client";
import type { VoiceDictationSettings } from "../chat/voice-dictation-types";

const audio = registerPlugin<{
  lower(options: { level: number }): Promise<void>;
  mute(): Promise<void>;
  restore(): Promise<void>;
}>("ConduitAudio");

// Preserve start/stop order even when a native call finishes after capture stops.
let pending = Promise.resolve();
function enqueue(action: () => Promise<void>) {
  if (installedClientKind !== "android") return;
  pending = pending.then(action).catch((error) => {
    console.warn("Could not change other audio volume", error);
  });
}

export function lowerOtherAudio(settings: Pick<VoiceDictationSettings, "otherAudio" | "otherAudioLevel">) {
  if (settings.otherAudio === "lower") enqueue(() => audio.lower({ level: settings.otherAudioLevel }));
  else if (settings.otherAudio === "mute") enqueue(() => audio.mute());
}

export function restoreOtherAudio() {
  enqueue(() => audio.restore());
}
