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
  /** Hold to talk: a hold on Float records at once (off by default; a tap opens the radial either way). */
  holdToTalk: boolean;
  /** Show each slot's name beside it in Float's radial. */
  slotNames: boolean;
  /** Float stays out of sight until the side key calls it. */
  sideKeyOnly: boolean;
  /** The side key takes a screenshot as it opens Float. */
  sideKeyScreenshot: boolean;
  /** The side key starts dictating (to sideKeyTarget); a second press sends. */
  sideKeyDictates: boolean;
  sideKeyTarget: FloatHoldTarget;
  /** Float screen context, the Accessibility service: screenshots with no prompt, the screen's text, and the frost. */
  screenContext: boolean;
  /** Conduit is the phone's digital assistant: a long press on home hands Float the screen. */
  assistant: boolean;
  /** Samsung's side key press-and-hold to the assistant: "unset" until set up once, "none" off Samsung. */
  sideKey: "set" | "unset" | "none";
  /** What a hold on Float talks to. */
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
  openScreenContextSettings(): Promise<FloatStatus>;
  setUpScreenContext(): Promise<FloatStatus>;
  openAssistantSettings(): Promise<FloatStatus>;
  setUpAssistant(): Promise<FloatStatus>;
  openSideKeySettings(): Promise<FloatStatus>;
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
  openScreenContextSettings: () => enqueue(() => nativeFloat.openScreenContextSettings()),
  /** Walks through what screen context needs (Allow restricted settings, then Accessibility), each step skippable. */
  setUpScreenContext: () => enqueue(() => nativeFloat.setUpScreenContext()),
  openAssistantSettings: () => enqueue(() => nativeFloat.openAssistantSettings()),
  /** Make Conduit the assistant, then (Samsung) the side key's press and hold, each step skippable. */
  setUpAssistant: () => enqueue(() => nativeFloat.setUpAssistant()),
  openSideKeySettings: () => enqueue(() => nativeFloat.openSideKeySettings()),
  setSlotNames: (slotNames: boolean) => enqueue(() => nativeFloat.setSlotNames({ slotNames })),
  setSideKey: (options: { sideKeyOnly?: boolean; sideKeyScreenshot?: boolean; sideKeyDictates?: boolean; sideKeyTarget?: FloatHoldTarget }) =>
    enqueue(() => nativeFloat.setSideKey(options)),
  setHold: (options: { holdToTalk?: boolean; holdTarget?: FloatHoldTarget }) => enqueue(() => nativeFloat.setHold(options)),
};

// This module lives for the page's lifetime, including when Settings is closed.
if (installedClientKind === "android") createRoot(() => createEffect(() => {
  const tokenOrigin = activeOrigin() || "";
  let origin = "";
  try { if (tokenOrigin) origin = new URL(httpUrl("/")).origin; }
  catch { return; } // No selected route yet; follow the next path update.
  void enqueue(() => nativeFloat.setOrigin({ origin, tokenOrigin })).catch(() => {});
}));
