import { settleRooms } from "./motion";

/** Said at a travel's start, before its end is measured: a hide takes the composer out of typing now (composer.tsx). */
export const KEYBOARD_TRAVEL_EVENT = "conduit:keyboard-travel";

/**
 * The keyboard's travel with no layout in it, while the native composer is up (native-phone-composer.ts).
 *
 * Drawn the old way, a travel sets --app-height on every frame, and every frame is then a whole-app style and layout
 * pass (5-13ms on a phone): the transcript falls to every other frame at 120Hz, and further behind on anything faster.
 * Here the layout changes twice, at the travel's ends: at its start the app is laid out at the keyboard's lower
 * position (the taller of the two), at its end at the keyboard's final one. Between them what rides the keyboard --
 * the composer's dock (its riders; its field and row are drawn natively) and the transcript above it -- is
 * moved by one transform animation each, on the system's own curve (CSS linear() from its samples), which the
 * compositor runs at the display's rate whatever that is, with no frame waiting on script or layout.
 *
 * What a transcript does follows one rule, the same one that shows Scroll to latest (the caller's `away`): at the bottom (no
 * pill) it rides the keyboard, held against the composer; scrolled up (the pill showing) it does not move at all --
 * the keyboard and composer come up over it, and what is being read stays where it is. The transcript's own hold
 * (transcript.tsx, holdAgainstKeyboard) keeps the same rule, so neither the ride nor the layout at the ends moves it.
 * The one thing that can still shift one scrolled up is the scroller growing as the keyboard leaves past the end of
 * what there is to show (its scroll clamped); that shift is put on the travel too, from where it was back to rest.
 *
 * The animation is started in phase: the shell stamps when the system began the travel (wall clock, the same one
 * Date.now reads), so a description that took a few frames to cross the bridge starts that far along, not behind.
 */
const RIDERS = ".ui-composer-dock";
const SCROLLERS = ".ui-chat-scroller, .ui-dash-conversation-scroll";
const shown = (element: Element) => element.getClientRects().length > 0;

/** Whether a travel should be drawn this way now: the native composer is mirroring the web one. */
export const travelsWithoutLayout = () => !!document.querySelector(".ui-phone-composer[data-native-mirror]");

/** The system's curve as CSS: linear() through its samples. */
export const travelEasing = (curve: number[]) => CSS.supports("animation-timing-function", "linear(0, 1)") && curve.length >= 2
  ? `linear(${curve.map((value) => Math.min(1.5, Math.max(-0.5, value))).join(", ")})` : "cubic-bezier(.2, 0, 0, 1)";

/** rest: the navigation bar's room with no keyboard (the shell's --safe-area-inset-bottom-rest), which the keyboard
 *  covers before the composer moves at all. */
export type Travel = { from: number; to: number; durationMs: number; curve: number[]; startedAt?: number; rest?: number };

/**
 * The curve of what rides the composer: the composer sits on the keyboard or on the navigation bar's room, whichever is
 * higher, so it moves only while the keyboard is above that room -- landing (or setting off) while the keyboard is
 * still in the bar's room. The keyboard's own curve spread the composer's move over the keyboard's whole travel: the
 * transcript arrived after the composer, a band of page showing under it until it did.
 */
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
  const still = away ? [...document.querySelectorAll<HTMLElement>(".ui-chat-viewport, .ui-dash-conversation-scroll")].filter(shown) : [];
  for (const scroller of still) scroller.setAttribute("data-keyboard-away", "");
  const scrolls = still.map((scroller) => scroller.scrollTop);
  // Where the composer's top sits at each end, measured, not computed: what rides the keyboard -- the riders at the
  // dock's top, and a transcript held against the composer -- moves with it, and it moves by the keyboard's travel
  // (less the navigation bar's room, given up as the keyboard takes it) and by the rooms the composer's own change
  // takes or gives (the field, the edit pills). Measured once as it starts, then again with the composer's change
  // made and its rooms settled at once (they are hidden: the native composer draws them), so all of it rides here.
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
