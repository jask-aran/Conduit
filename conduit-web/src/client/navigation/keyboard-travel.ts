import { logKeyboardEvent } from "./keyboard-probe.ts";

/**
 * The keyboard's travel with no layout in it, while the native composer is up (components/ui/native-phone-composer.ts).
 *
 * Drawn the old way, a travel sets --app-height on every frame, and every frame is then a whole-app style and layout
 * pass (5-13ms on a phone): the transcript falls to every other frame at 120Hz, and further behind on anything faster.
 * Here the layout changes twice, at the travel's ends: at its start the app is laid out at the keyboard's lower
 * position (the taller of the two), at its end at the keyboard's final one. Between them what rides the keyboard --
 * the composer's dock (its riders; its field and row are drawn natively) and a transcript already at its foot -- is
 * moved by one transform animation each, on the system's own curve (CSS linear() from its samples), which the
 * compositor runs at the display's rate whatever that is, with no frame waiting on script or layout. A transcript
 * scrolled up stays where it is.
 *
 * The animation is started in phase: the shell stamps when the system began the travel (wall clock, the same one
 * Date.now reads), so a description that took a few frames to cross the bridge starts that far along, not behind.
 */
const RIDERS = ".ui-composer-dock";
const SCROLLERS = ".ui-chat-scroller, .ui-dash-conversation-scroll";
const atFoot = (scroller: Element) => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
const shown = (element: Element) => element.getClientRects().length > 0;

/** Whether a travel should be drawn this way now: the native composer is mirroring the web one. */
export const travelsWithoutLayout = () => !!document.querySelector(".ui-phone-composer[data-native-mirror]");

export type Travel = { from: number; to: number; durationMs: number; curve: number[]; startedAt?: number };

/** One travel. `setKeyboard(height)` sets the shell's keyboard height and lays the app out for it. */
export function travelWithoutLayout(travel: Travel, setKeyboard: (height: number) => void) {
  const low = Math.min(travel.from, travel.to);
  const easing = CSS.supports("animation-timing-function", "linear(0, 1)") && travel.curve.length >= 2
    ? `linear(${travel.curve.map((value) => Math.min(1.5, Math.max(-0.5, value))).join(", ")})` : "cubic-bezier(.2, 0, 0, 1)";
  const riders = [...document.querySelectorAll(RIDERS)].filter(shown);
  const scrollers = [...document.querySelectorAll(SCROLLERS)].filter((scroller) => shown(scroller) && atFoot(scroller));
  // Where the composer's row sits at each end, measured, not computed: the keyboard's height is not its travel (the
  // navigation bar's room is given up as the keyboard takes it). The row, not the dock, whose box holds that room.
  const probe = riders[0]?.querySelector(".ui-phone-row") ?? riders[0] ?? scrollers[0];
  const foot = (height: number) => { setKeyboard(height); return probe ? probe.getBoundingClientRect().bottom : 0; };
  const atFrom = foot(travel.from), atTo = foot(travel.to), atLow = foot(low);
  const duration = Math.max(1, travel.durationMs);
  const along = travel.startedAt ? Math.min(duration - 1, Math.max(0, Date.now() - travel.startedAt)) : 0;
  const animations = [...riders, ...scrollers].map((element) => {
    const animation = element.animate(
      [{ transform: `translateY(${atFrom - atLow}px)` }, { transform: `translateY(${atTo - atLow}px)` }],
      { duration, easing, fill: "forwards" });
    animation.currentTime = along;
    return animation;
  });
  logKeyboardEvent("travel", `${Math.round(travel.from)}->${Math.round(travel.to)} moves ${Math.round(atTo - atFrom)} ${animations.length} parts, ${Math.round(along)}ms in`);
  let done = false;
  let landAt = travel.to;
  const land = () => {
    if (done) return;
    done = true;
    // The final layout and the transforms' removal in one task, so one frame shows both.
    setKeyboard(landAt);
    for (const animation of animations) animation.cancel();
  };
  void Promise.all(animations.map((animation) => animation.finished)).then(land, () => undefined);
  if (!animations.length) window.setTimeout(land, duration - along);
  return {
    get running() { return !done; },
    /** The system reported where the keyboard ended: land there (now, if this travel has already landed). */
    settle(height: number) { landAt = height; if (done) setKeyboard(height); },
    cancel() { if (done) return; done = true; for (const animation of animations) animation.cancel(); },
  };
}
