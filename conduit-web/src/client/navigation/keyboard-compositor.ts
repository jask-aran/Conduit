import { logKeyboardEvent } from "./keyboard-probe.ts";

/**
 * SPIKE (revertible: this file and its two calls in mobile-layout.ts): the keyboard's travel drawn on the compositor.
 *
 * The shell sends the whole travel once (from, to, duration and the system's own curve), and mobile-layout.ts draws
 * it by setting --app-height every frame -- a relayout of the whole app per frame, on the main thread, which is where
 * the composer falls behind the keyboard. Here the layout moves twice instead, never mid-travel: at the start it takes
 * the taller of the two heights (the keyboard's lower position), and at the end the final one. Between them the parts
 * that ride the keyboard -- the composer's dock, and a transcript already at its foot -- are moved by a transform
 * animation on the system's curve (CSS linear() from its samples), which the compositor runs at the display's rate
 * with no frame waiting on the main thread. A transcript scrolled up stays where it is, as it does now.
 *
 * Settings › Interface › Keyboard motion (this device's) chooses it or the per-frame layout; the palette's Switch
 * keyboard motion flips it. Both stay, so a phone can compare them.
 */
export type KeyboardMotion = "compositor" | "layout";
export const KEYBOARD_MOTIONS: { value: KeyboardMotion; label: string }[] = [
  { value: "compositor", label: "Compositor" }, { value: "layout", label: "Per-frame layout" },
];
const KEY = "conduit.keyboard";
export function keyboardMotion(): KeyboardMotion {
  try { return localStorage.getItem(KEY) === "layout" ? "layout" : "compositor"; } catch { return "compositor"; }
}
export function saveKeyboardMotion(motion: KeyboardMotion): KeyboardMotion {
  try { localStorage.setItem(KEY, motion); } catch { /* this page only */ }
  return motion;
}
export const compositorKeyboard = () => keyboardMotion() === "compositor";

const RIDERS = ".ui-composer-dock";
const SCROLLERS = ".ui-chat-scroller, .ui-dash-conversation-scroll";
const atFoot = (scroller: Element) => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
const shown = (element: Element) => element.getClientRects().length > 0;

export type Travel = { from: number; to: number; durationMs: number; curve: number[] };

/**
 * Runs one travel. `setKeyboard(height)` sets the shell's keyboard height and lays the app out for it (sync()).
 * Returns a handle: `finish()` lands it now (an end the system reported early), `cancel()` drops it for a new one.
 */
export function travelOnCompositor(travel: Travel, setKeyboard: (height: number) => void) {
  const low = Math.min(travel.from, travel.to);
  const easing = CSS.supports("animation-timing-function", "linear(0, 1)") && travel.curve.length >= 2
    ? `linear(${travel.curve.map((value) => Math.min(1.5, Math.max(-0.5, value))).join(", ")})` : "cubic-bezier(.2, 0, 0, 1)";
  const riders = [...document.querySelectorAll(RIDERS)].filter(shown);
  const scrollers = [...document.querySelectorAll(SCROLLERS)].filter((scroller) => shown(scroller) && atFoot(scroller));
  // Where the composer actually sits at each end, measured rather than computed: the keyboard's height is not the
  // composer's travel (the navigation bar's room is given up as the keyboard takes it), so moving by the keyboard's
  // height overshot by the bar and snapped back. Laid out at each end in turn, read, then left at the lower one.
  // The row, not the dock: the dock's box holds the navigation bar's room below the row while the keyboard is down, and
  // measuring it moved the composer a bar's height too far.
  const probe = riders[0]?.querySelector(".ui-phone-row") ?? riders[0] ?? scrollers[0];
  const foot = (height: number) => { setKeyboard(height); return probe ? probe.getBoundingClientRect().bottom : 0; };
  const atFrom = foot(travel.from), atTo = foot(travel.to), atLow = foot(low);
  const moving = [...riders, ...scrollers];
  const animations = moving.map((element) => element.animate(
    [{ transform: `translateY(${atFrom - atLow}px)` }, { transform: `translateY(${atTo - atLow}px)` }],
    { duration: Math.max(1, travel.durationMs), easing, fill: "forwards" },
  ));
  logKeyboardEvent("spike-start", `${Math.round(travel.from)}->${Math.round(travel.to)} moves ${Math.round(atTo - atFrom)} ${moving.length} parts`);
  let done = false;
  // Where it lands: the height announced at the start, unless the system has since reported where it ended.
  let landAt = travel.to;
  const land = () => {
    if (done) return;
    done = true;
    // The final layout and the transforms' removal in one task, so one frame shows both.
    setKeyboard(landAt);
    for (const animation of animations) animation.cancel();
    logKeyboardEvent("spike-end", Math.round(landAt));
  };
  void Promise.all(animations.map((animation) => animation.finished)).then(land, () => undefined);
  if (!animations.length) window.setTimeout(land, travel.durationMs);
  return {
    get running() { return !done; },
    /** The system's progress said it began earlier than the bridge delivered it: run ahead to meet it, once. */
    catchUp(lagMs: number) {
      if (done || lagMs <= 0) return;
      for (const animation of animations) animation.currentTime = Math.min(travel.durationMs, Number(animation.currentTime || 0) + Math.min(48, lagMs));
    },
    /** The system reported where the keyboard ended: land there (now, if this travel has already landed). */
    settle(height: number) {
      landAt = height;
      if (done) setKeyboard(height);
    },
    finish: land,
    cancel() {
      if (done) return;
      done = true;
      for (const animation of animations) animation.cancel();
    },
  };
}
