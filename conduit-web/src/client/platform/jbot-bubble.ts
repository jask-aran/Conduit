import { registerPlugin } from "@capacitor/core";
import { createEffect, createRoot } from "solid-js";
import { installedClientKind } from "./installed-client";
import { httpUrl } from "../api/transport.js";
import type { VoiceDictationSettings } from "../chat/voice-dictation-types";
import { activeOrigin } from "./servers";

export type JbotBubbleAudio = Pick<VoiceDictationSettings, "otherAudio" | "otherAudioLevel">;
export interface JbotBubbleStatus {
  enabled: boolean;
  overlayPermission: boolean;
  micPermission: boolean;
}

const bubble = registerPlugin<{
  start(options: JbotBubbleAudio & { origin: string; tokenOrigin: string }): Promise<JbotBubbleStatus>;
  stop(): Promise<JbotBubbleStatus>;
  status(): Promise<JbotBubbleStatus>;
  setOrigin(options: { origin: string; tokenOrigin: string }): Promise<void>;
  openOverlaySettings(): Promise<JbotBubbleStatus>;
}>("ConduitBubble");

// Keep native calls ordered: a pending settings update must finish before a later Turn off.
let pending: Promise<unknown> = Promise.resolve();
function enqueue<T>(action: () => Promise<T>): Promise<T> {
  const result = pending.then(action);
  pending = result.catch(() => {});
  return result;
}

export const jbotBubble = {
  start(settings: JbotBubbleAudio) {
    // Dial the selected path, but read the secure token under the server's stable origin.
    const origin = new URL(httpUrl("/")).origin;
    const tokenOrigin = activeOrigin() || origin;
    return enqueue(() => bubble.start({ otherAudio: settings.otherAudio, otherAudioLevel: settings.otherAudioLevel, origin, tokenOrigin }));
  },
  stop: () => enqueue(() => bubble.stop()),
  status: () => enqueue(() => bubble.status()),
  openOverlaySettings: () => enqueue(() => bubble.openOverlaySettings()),
};

// This module lives for the page's lifetime, including when Settings is closed.
if (installedClientKind === "android") createRoot(() => createEffect(() => {
  const tokenOrigin = activeOrigin() || "";
  let origin = "";
  try { if (tokenOrigin) origin = new URL(httpUrl("/")).origin; }
  catch { return; } // No selected route yet; follow the next path update.
  void enqueue(() => bubble.setOrigin({ origin, tokenOrigin })).catch(() => {});
}));
