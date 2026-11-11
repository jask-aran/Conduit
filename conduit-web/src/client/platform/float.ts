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
  holdToTalk: boolean;
  slotNames: boolean;
  sideKeyOnly: boolean;
  sideKeyScreenshot: boolean;
  sideKeyDictates: boolean;
  sideKeyTarget: FloatHoldTarget;
  /** The Accessibility service: screenshots with no prompt, the screen's text, and the frost. */
  screenContext: boolean;
  assistant: boolean;
  /** "none" off Samsung. */
  sideKey: "set" | "unset" | "none";
  holdTarget: FloatHoldTarget;
}
export type FloatHoldTarget = "jbot" | "chat";

const nativeFloat = registerPlugin<{
  start(options: FloatAudio & { origin: string; tokenOrigin: string }): Promise<FloatStatus>;
  stop(): Promise<FloatStatus>;
  status(): Promise<FloatStatus>;
  setOrigin(options: { origin: string; tokenOrigin: string }): Promise<void>;
  openOverlaySettings(): Promise<FloatStatus>;
  setSlotNames(options: { slotNames: boolean }): Promise<FloatStatus>;
  setSideKey(options: { sideKeyOnly?: boolean; sideKeyScreenshot?: boolean; sideKeyDictates?: boolean; sideKeyTarget?: FloatHoldTarget }): Promise<FloatStatus>;
  setHold(options: { holdToTalk?: boolean; holdTarget?: FloatHoldTarget }): Promise<FloatStatus>;
  setUp(): Promise<FloatStatus>;
  takeOpenSettings(): Promise<{ section: string | null }>;
  addListener(event: "openSettings", handler: () => void): Promise<{ remove(): Promise<void> }>;
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
  setUp: () => enqueue(() => nativeFloat.setUp()),
  setSlotNames: (slotNames: boolean) => enqueue(() => nativeFloat.setSlotNames({ slotNames })),
  setSideKey: (options: { sideKeyOnly?: boolean; sideKeyScreenshot?: boolean; sideKeyDictates?: boolean; sideKeyTarget?: FloatHoldTarget }) =>
    enqueue(() => nativeFloat.setSideKey(options)),
  setHold: (options: { holdToTalk?: boolean; holdTarget?: FloatHoldTarget }) => enqueue(() => nativeFloat.setHold(options)),
};

// The request waits natively until asked for: on a cold start the intent arrives before the page is listening.
// Whatever the installed app calls the section, it means this one.
export function onFloatOpensSettings(open: (section: string) => void) {
  if (installedClientKind !== "android") return;
  const take = () => void nativeFloat.takeOpenSettings().then(({ section }) => { if (section) open("device"); }).catch(() => {});
  void nativeFloat.addListener("openSettings", take).catch(() => {});
  take();
}

// This module lives for the page's lifetime, including when Settings is closed.
if (installedClientKind === "android") createRoot(() => createEffect(() => {
  const tokenOrigin = activeOrigin() || "";
  let origin = "";
  try { if (tokenOrigin) origin = new URL(httpUrl("/")).origin; }
  catch { return; } // No selected route yet; follow the next path update.
  void enqueue(() => nativeFloat.setOrigin({ origin, tokenOrigin })).catch(() => {});
}));
