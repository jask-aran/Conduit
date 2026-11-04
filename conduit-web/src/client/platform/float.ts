import { registerPlugin } from "@capacitor/core";
import { createEffect, createRoot } from "solid-js";
import { installedClientKind } from "./installed-client";
import { httpUrl } from "../api/transport.js";
import type { VoiceDictationSettings } from "../chat/voice-dictation-types";
import { activeOrigin } from "./servers";

export type FloatAudio = Pick<VoiceDictationSettings, "otherAudio" | "otherAudioLevel">;
export interface FloatStatus {
  enabled: boolean;
  overlayPermission: boolean;
  micPermission: boolean;
  /** What a hold on Float talks to before a slot is chosen. */
  holdTarget: FloatHoldTarget;
}
export type FloatHoldTarget = "jbot" | "chat";

const nativeFloat = registerPlugin<{
  start(options: FloatAudio & { origin: string; tokenOrigin: string }): Promise<FloatStatus>;
  stop(): Promise<FloatStatus>;
  status(): Promise<FloatStatus>;
  setOrigin(options: { origin: string; tokenOrigin: string }): Promise<void>;
  openOverlaySettings(): Promise<FloatStatus>;
  setHoldTarget(options: { holdTarget: FloatHoldTarget }): Promise<FloatStatus>;
}>("ConduitFloat");

// Keep native calls ordered: a pending settings update must finish before a later Turn off.
let pending: Promise<unknown> = Promise.resolve();
function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const result = pending.then(action);
  pending = result.catch(() => {});
  return result;
}

export const conduitFloat = {
  start(settings: FloatAudio) {
    // Dial the selected path, but read the secure token under the server's stable origin.
    const origin = new URL(httpUrl("/")).origin;
    const tokenOrigin = activeOrigin() || origin;
    return enqueue(() => nativeFloat.start({ otherAudio: settings.otherAudio, otherAudioLevel: settings.otherAudioLevel, origin, tokenOrigin }));
  },
  stop: () => enqueue(() => nativeFloat.stop()),
  status: () => enqueue(() => nativeFloat.status()),
  openOverlaySettings: () => enqueue(() => nativeFloat.openOverlaySettings()),
  setHoldTarget: (holdTarget: FloatHoldTarget) => enqueue(() => nativeFloat.setHoldTarget({ holdTarget })),
};

// This module lives for the page's lifetime, including when Settings is closed.
if (installedClientKind === "android") createRoot(() => createEffect(() => {
  const tokenOrigin = activeOrigin() || "";
  let origin = "";
  try { if (tokenOrigin) origin = new URL(httpUrl("/")).origin; }
  catch { return; } // No selected route yet; follow the next path update.
  void enqueue(() => nativeFloat.setOrigin({ origin, tokenOrigin })).catch(() => {});
}));
