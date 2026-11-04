import { Capacitor, registerPlugin } from "@capacitor/core";
import { createEffect, on } from "solid-js";
import { touchOnly } from "./layout";

/**
 * Haptics: what a touch that changes something feels like on a phone. Two layers, as colour has:
 *
 * Effects are tokens (styles/foundations.css, --haptic-*): each a short list of the platform's clear primitives
 * (tick, low-tick, click, thud, quick-rise, slow-rise, quick-fall, spin), every one at a scale (0-1) and after a
 * delay (ms) -- `click .7` or `tick .5, click .7 40`. Never a timed buzz: a key click is 10-20ms of drive, and a long
 * one-shot rings on in the actuator (Android's haptics principles).
 *
 * Kinds are meanings, each a piece's own (callers do not fire them), and each names its effect:
 * - select (tick): a side chosen in a Segmented (a pill one too);
 * - press (click): a PillButton that acts at once (the mic, Send, Stop: its haptic prop);
 * - hold (thud): a long press opening a context menu;
 * - fold (tick): what an Expand or Disclosure holds opening or shutting;
 * - open (click): an overlay opening (a menu, submenu, popover, dialog, the phone's drawer: a tap or a swipe in);
 * - dismiss (settle): an overlay closing (a menu, submenu, popover, dialog, the phone's drawer).
 * fold, open and dismiss are felt only just after a touch, so what opens or closes on its own (rows a search filters in,
 * a drawer shut by navigation from the keyboard) is not. Only a touch screen with nothing that hovers feels them.
 *
 * The person's strength (Settings › Interface › Haptics, this device's) scales every effect; off is silent. In the app
 * the native player (ConduitHapticsPlugin) composes the primitives, falling back to the nearest predefined click;
 * in a browser, a vibration of a few milliseconds.
 */
export type Haptic = "select" | "press" | "hold" | "fold" | "open" | "dismiss";
export type HapticEffect = "tick" | "click" | "thud" | "settle";
export const HAPTIC_EFFECT: Record<Haptic, HapticEffect> = { select: "tick", press: "click", hold: "thud", fold: "tick", open: "click", dismiss: "settle" };

export type HapticStrength = "off" | "light" | "medium" | "strong";
export const HAPTIC_STRENGTHS: { value: HapticStrength; label: string; gain: number }[] = [
  { value: "off", label: "Off", gain: 0 }, { value: "light", label: "Light", gain: .6 },
  { value: "medium", label: "Medium", gain: 1 }, { value: "strong", label: "Strong", gain: 1.45 },
];
const STRENGTH_KEY = "conduit.haptics";
export function hapticStrength(): HapticStrength {
  let stored: string | null = null;
  try { stored = localStorage.getItem(STRENGTH_KEY); } catch { /* no storage: the default */ }
  return HAPTIC_STRENGTHS.some((option) => option.value === stored) ? stored as HapticStrength : "medium";
}
/** Saves this device's strength and plays a press at it, so the choice is felt as it is made. */
export function saveHapticStrength(strength: HapticStrength): HapticStrength {
  try { localStorage.setItem(STRENGTH_KEY, strength); } catch { /* kept for this page only */ }
  playEffect(HAPTIC_EFFECT.press);
  return strength;
}

type Step = { primitive: string; scale: number; delay: number };
/** An effect token's steps: `primitive scale [delay]`, comma separated. */
function steps(effect: HapticEffect): Step[] {
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--haptic-${effect}`).trim();
  return value.split(",").map((part) => part.trim().split(/\s+/)).filter((words) => words[0])
    .map(([primitive, scale, delay]) => ({ primitive: primitive!, scale: Number(scale ?? 1) || 0, delay: Number(delay ?? 0) || 0 }));
}

const native = registerPlugin<{ play(options: { steps: Step[]; weight: string }): Promise<void> }>("ConduitHaptics");
const hasNative = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("ConduitHaptics");
/* A browser has only a vibration: a few milliseconds by the strongest step's primitive. */
const BROWSER_MS: Record<string, number> = { tick: 6, "low-tick": 6, click: 10, "quick-rise": 10, "quick-fall": 8, "slow-rise": 14, spin: 14, thud: 16 };

/** Plays an effect token at this device's strength (the gallery plays them directly). */
export function playEffect(effect: HapticEffect) {
  const gain = HAPTIC_STRENGTHS.find((option) => option.value === hapticStrength())!.gain;
  if (!gain) return;
  const scaled = steps(effect).map((step) => ({ ...step, scale: Math.min(1, step.scale * gain) }));
  if (!scaled.length) return;
  // The nearest predefined effect where the primitives are missing: the heaviest step's.
  const weight = scaled.some((step) => step.primitive === "thud") ? "heavy" : scaled.some((step) => step.primitive !== "tick" && step.primitive !== "low-tick") ? "click" : "tick";
  if (hasNative()) { void native.play({ steps: scaled, weight }).catch(() => undefined); return; }
  if (typeof navigator.vibrate !== "function") return;
  const top = scaled.reduce((best, step) => step.scale > best.scale ? step : best);
  navigator.vibrate(Math.max(1, Math.round((BROWSER_MS[top.primitive] ?? 8) * Math.min(1, .5 + top.scale / 2))));
}

let touchedAt = -Infinity;
// One feel per touch: a piece told both by its own change and by its owner's (an overlay's open prop and its
// onOpenChange) is felt once.
let last = { kind: "", at: -Infinity };
// Down as well as up: a tap outside a menu closes it on the way down.
const touched = (event: PointerEvent) => { if (event.pointerType === "touch") touchedAt = performance.now(); };
if (typeof addEventListener === "function") for (const type of ["pointerdown", "pointerup"] as const) addEventListener(type, touched, { capture: true, passive: true });
export function haptic(kind: Haptic) {
  if (!touchOnly()) return;
  const now = performance.now();
  if ((kind === "fold" || kind === "open" || kind === "dismiss") && now - touchedAt > 600) return;
  if (last.kind === kind && now - last.at < 120) return;
  last = { kind, at: now };
  playEffect(HAPTIC_EFFECT[kind]);
}

/** An overlay's own haptics, whoever opens or shuts it: felt opening and shutting (just after a touch). */
export function overlayHaptics(open: () => boolean | undefined) {
  createEffect(on(open, (now, was) => { if (now && !was) haptic("open"); else if (!now && was) haptic("dismiss"); }, { defer: true }));
}
