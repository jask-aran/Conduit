import { Capacitor, registerPlugin } from "@capacitor/core";
import { createEffect, on } from "solid-js";
import { touchOnly } from "./layout";

/* Never a timed buzz: a key click is 10-20ms of drive, and a long one-shot rings on in the actuator. fold, open and
 * dismiss are felt only just after a touch, so what opens on its own (a drawer shut from the keyboard) is not. */
export type Haptic = "select" | "press" | "confirm" | "destructive" | "hold" | "fold" | "open" | "dismiss";
export type HapticProp = Haptic | false;
export type HapticEffect = "tick" | "click" | "thud" | "settle" | "rise" | "knock";
export const HAPTIC_EFFECT: Record<Haptic, HapticEffect> = { select: "tick", press: "click", confirm: "rise", destructive: "knock", hold: "thud", fold: "tick", open: "click", dismiss: "settle" };

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
/** Plays a press at the new strength, so the choice is felt as it is made. */
export function saveHapticStrength(strength: HapticStrength): HapticStrength {
  try { localStorage.setItem(STRENGTH_KEY, strength); } catch { /* kept for this page only */ }
  playEffect(HAPTIC_EFFECT.press);
  return strength;
}

type Step = { primitive: string; scale: number; delay: number };
// Effect tokens are read once each: a computed-style read on a tap forces the page's style.
const read = new Map<HapticEffect, Step[]>();
function steps(effect: HapticEffect): Step[] {
  let known = read.get(effect);
  if (!known) read.set(effect, known = parseSteps(getComputedStyle(document.documentElement).getPropertyValue(`--haptic-${effect}`).trim()));
  return known;
}
function parseSteps(value: string): Step[] {
  return value.split(",").map((part) => part.trim().split(/\s+/)).filter((words) => words[0])
    .map(([primitive, scale, delay]) => ({ primitive: primitive!, scale: Number(scale ?? 1) || 0, delay: Number(delay ?? 0) || 0 }));
}

const native = registerPlugin<{ play(options: { steps: Step[]; weight: string }): Promise<void> }>("ConduitHaptics");
const hasNative = () => Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("ConduitHaptics");
const BROWSER_MS: Record<string, number> = { tick: 6, "low-tick": 6, click: 10, "quick-rise": 10, "quick-fall": 8, "slow-rise": 14, spin: 14, thud: 16 };

function scaledEffect(effect: HapticEffect): { steps: Step[]; weight: string } | null {
  const gain = HAPTIC_STRENGTHS.find((option) => option.value === hapticStrength())!.gain;
  if (!gain) return null;
  const scaled = steps(effect).map((step) => ({ ...step, scale: Math.min(1, step.scale * gain) }));
  if (!scaled.length) return null;
  const weight = scaled.some((step) => step.primitive === "thud") ? "heavy" : scaled.some((step) => step.primitive !== "tick" && step.primitive !== "low-tick") ? "click" : "tick";
  return { steps: scaled, weight };
}
export function hapticSteps(kind: Haptic) { return touchOnly() ? scaledEffect(HAPTIC_EFFECT[kind]) : null; }

function playEffect(effect: HapticEffect) {
  const scaledOne = scaledEffect(effect);
  if (!scaledOne) return;
  const { steps: scaled, weight } = scaledOne;
  if (hasNative()) { void native.play({ steps: scaled, weight }).catch(() => undefined); return; }
  if (typeof navigator.vibrate !== "function") return;
  const top = scaled.reduce((best, step) => step.scale > best.scale ? step : best);
  navigator.vibrate(Math.max(1, Math.round((BROWSER_MS[top.primitive] ?? 8) * Math.min(1, .5 + top.scale / 2))));
}

// Read ahead of the first touch, while the page is idle.
if (typeof requestIdleCallback === "function") requestIdleCallback(() => { for (const effect of new Set(Object.values(HAPTIC_EFFECT))) steps(effect); });
let touchedAt = -Infinity;
// One feel per touch: a piece told twice (open prop and onOpenChange) or two pieces one tap reached is felt once.
// A different effect straight after replaces it (the platform plays the latest).
let last = { kind: "", at: -Infinity };
// Down as well as up: a tap outside a menu closes it on the way down.
const touched = (event: PointerEvent) => { if (event.pointerType === "touch") touchedAt = performance.now(); };
if (typeof addEventListener === "function") for (const type of ["pointerdown", "pointerup"] as const) addEventListener(type, touched, { capture: true, passive: true });
export function haptic(kind: Haptic) {
  if (!touchOnly()) return;
  const now = performance.now();
  if ((kind === "fold" || kind === "open" || kind === "dismiss") && now - touchedAt > 600) return;
  if (last.kind === HAPTIC_EFFECT[kind] && now - last.at < 120) return;
  last = { kind: HAPTIC_EFFECT[kind], at: now };
  playEffect(HAPTIC_EFFECT[kind]);
}

export function feel(prop: HapticProp | undefined, fallback: Haptic) { if (prop !== false) haptic(prop ?? fallback); }

export function overlayHaptics(open: () => boolean | undefined) {
  createEffect(on(open, (now, was) => { if (now && !was) haptic("open"); else if (!now && was) haptic("dismiss"); }, { defer: true }));
}
