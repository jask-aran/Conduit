import { settleRooms } from "./motion";

/** Said at a travel's start, before its end is measured: a hide takes the composer out of typing now (composer.tsx). */
export const KEYBOARD_TRAVEL_EVENT = "conduit:keyboard-travel";

/**
 * The keyboard's travel with no layout in it, while the native composer is up (native-phone-composer.ts).
 * Setting --app-height every frame costs a whole-app style and layout pass (5-13ms on a phone), so the layout changes
 * only at the travel's ends (start: the keyboard's lower position, the taller; end: its final one). Between them the
 * composer's dock and the transcript above it each ride one transform animation on the system's curve (CSS linear()),
 * which the compositor runs at the display's rate with no frame waiting on script or layout.
 * A transcript follows the Scroll to latest rule (the caller's `away`): at the bottom it rides, held against the
 * composer; scrolled up it never moves (the same rule as holdAgainstKeyboard in transcript.tsx), except a scroll clamp
 * as the scroller grows, which is put on the travel too. The animation starts in phase from the shell's wall-clock stamp.
 */
const RIDERS = ".ui-composer-dock";
const SCROLLERS = ".ui-chat-scroller";
const shown = (element: Element) => element.getClientRects().length > 0;

/** Whether a travel should be drawn this way now: the native composer is mirroring the web one. */
export const travelsWithoutLayout = () => !!document.querySelector(".ui-phone-composer[data-native-mirror]");

/** The system's curve as CSS: linear() through its samples. */
export const travelEasing = (curve: number[]) => CSS.supports("animation-timing-function", "linear(0, 1)") && curve.length >= 2
  ? `linear(${curve.map((value) => Math.min(1.5, Math.max(-0.5, value))).join(", ")})` : "cubic-bezier(.2, 0, 0, 1)";

/** rest: the navigation bar's room with no keyboard (the shell's --safe-area-inset-bottom-rest), which the keyboard
 *  covers before the composer moves at all. */
export type Travel = { from: number; to: number; durationMs: number; curve: number[]; startedAt?: number; rest?: number };

/** The curve of what rides the composer: it sits on the keyboard or the navigation bar's room, whichever is higher, so
 *  it moves only while the keyboard is above that room (the keyboard's own curve left a band of page under it). */
function ridingCurve(travel: Travel): number[] {
  const rest = travel.rest ?? 0;
  const at = (progress: number) => Math.max(rest, travel.from + (travel.to - travel.from) * progress);
  const start = at(0), end = at(1);
  if (!rest || Math.abs(end - start) < 0.5) return travel.curve;
  return travel.curve.map((progress) => Math.round(((at(progress) - start) / (end - start)) * 1000) / 1000);
}

/** One travel. `setKeyboard(height)` sets the shell's keyboard height and lays the app out for it. away: the latest is
 *  out of view (Scroll to latest is showing); log: a readout of the travel for a diagnostic. */
export function travelWithoutLayout(travel: Travel, setKeyboard: (height: number) => void, options: { away: boolean; log?: (name: string, detail: string) => void }) {
  const low = Math.min(travel.from, travel.to);
  const riding = travelEasing(ridingCurve(travel));
  const riders = [...document.querySelectorAll(RIDERS)].filter(shown);
  const away = options.away;
  const scrollers = away ? [] : [...document.querySelectorAll(SCROLLERS)].filter(shown);
  // Scrolled up: marked, so the transcript's hold leaves it be, and its scroll read so a clamp can be carried.
  // The element that scrolls: a thread's viewport inside its scroller, a room's scroller itself.
  const still = away ? [...document.querySelectorAll<HTMLElement>(".ui-chat-viewport")].filter(shown) : [];
  for (const scroller of still) scroller.setAttribute("data-keyboard-away", "");
  const scrolls = still.map((scroller) => scroller.scrollTop);
  // Where the composer's top sits at each end, measured, not computed: it moves by the keyboard's travel (less the
  // navigation bar's room) and by the rooms its own change takes or gives (field, edit pills), so all of it rides here.
  const probe = riders[0]?.querySelector(".ui-phone-composer") ?? riders[0] ?? scrollers[0];
  const top = (height: number) => { setKeyboard(height); return probe ? probe.getBoundingClientRect().top : 0; };
  const atFrom = top(travel.from);
  document.dispatchEvent(new CustomEvent(KEYBOARD_TRAVEL_EVENT, { detail: { hiding: travel.to < travel.from } }));
  settleRooms();
  const atTo = top(travel.to), atLow = top(low);
  // Laid out at the lower keyboard (the taller scroller) for the travel: any clamp has happened now.
  const clamps = still.map((scroller, index) => ({ scroller, shift: (scrolls[index] ?? scroller.scrollTop) - scroller.scrollTop }))
    .filter(({ shift }) => shift > 0.5);
  const duration = Math.max(1, travel.durationMs);
  const along = travel.startedAt ? Math.min(duration - 1, Math.max(0, Date.now() - travel.startedAt)) : 0;
  const clamped = clamps.map(({ scroller, shift }) => {
    const animation = scroller.animate([{ transform: `translateY(${-shift}px)` }, { transform: "none" }], { duration, easing: riding, fill: "forwards" });
    animation.currentTime = along;
    return animation;
  });
  const animations = [...riders, ...scrollers].map((element) => {
    const animation = element.animate(
      [{ transform: `translateY(${atFrom - atLow}px)` }, { transform: `translateY(${atTo - atLow}px)` }],
      { duration, easing: riding, fill: "forwards" });
    animation.currentTime = along;
    return animation;
  });
  options.log?.("travel", `${Math.round(travel.from)}->${Math.round(travel.to)} moves ${Math.round(atTo - atFrom)} ${animations.length} parts, ${Math.round(along)}ms in`);
  let done = false;
  let landAt = travel.to;
  const land = () => {
    if (done) return;
    done = true;
    // The final layout and the transforms' removal in one task, so one frame shows both.
    setKeyboard(landAt);
    for (const animation of [...animations, ...clamped]) animation.cancel();
    for (const scroller of still) scroller.removeAttribute("data-keyboard-away");
  };
  void Promise.all([...animations, ...clamped].map((animation) => animation.finished)).then(land, () => undefined);
  if (!animations.length && !clamped.length) window.setTimeout(land, duration - along);
  return {
    get running() { return !done; },
    /** The system reported where the keyboard ended: land there (now, if this travel has already landed). */
    settle(height: number) { landAt = height; if (done) setKeyboard(height); },
    cancel() {
      if (done) return; done = true;
      for (const animation of [...animations, ...clamped]) animation.cancel();
      for (const scroller of still) scroller.removeAttribute("data-keyboard-away");
    },
  };
}
