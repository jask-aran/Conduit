import { createContext, useContext, type Accessor } from "solid-js";
import { cssTime } from "./shared";

/** The media query for the reader's reduced-motion preference. */
export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// One query, read each call: making one each time adds a parse and a lookup.
let reducedMotionQuery: MediaQueryList | undefined;

/** Read the current reduced-motion preference; false without matchMedia. */
export function reducedMotion(): boolean {
  if (typeof matchMedia !== "function") return false;
  reducedMotionQuery ??= matchMedia(REDUCED_MOTION_QUERY);
  return reducedMotionQuery.matches;
}
/** How long a "Copied" confirmation holds before the copy control returns to rest. A hold, not a motion. */
export const COPY_FEEDBACK_MS = 1200;

/** Read a duration token in milliseconds. */
export function duration(token: `--duration-${string}`, element: Element = document.documentElement): number {
  return cssTime(element, token, 0);
}

/** Read an easing token from the current styles. */
export function easing(token: `--ease-${string}`, element: Element = document.documentElement): string {
  return getComputedStyle(element).getPropertyValue(token).trim() || "ease";
}

/*
 * Moves: the library's named moves (styles/motion.css). A part makes one, named in data-move -- fade, fold, tuck,
 * collapse, wipe, give -- and says its state in data-out (not shown) and, when it gives its room, data-folded.
 * Whatever holds parts that move themselves (a frost fades itself, never through its holder) tells them through a
 * MoveScope: whether they are out, how one that folds gives its room, whether a menu is over them, whether the voice
 * is on.
 */
export type MoveScope = {
  /** The parts are not shown: each fades itself (a voice control stays). */
  out?: Accessor<boolean>;
  /** A menu opened from one of them is over the rest: they dim at once, its opener lit. */
  under?: Accessor<boolean>;
  /** The voice is on (listening): an Aura among them glows. */
  voice?: Accessor<boolean>;
};
export const MoveContext = createContext<MoveScope>({});
export const useMoveScope = () => useContext(MoveContext);

/** Glide: a block that grows (a new line of captions) glides what was there up into place, over the quick duration,
 *  rather than jumping. Returns its stop. */
export function glide(element: HTMLElement): () => void {
  let height = 0;
  const observer = new ResizeObserver(() => {
    const next = element.offsetHeight;
    if (height && next > height) element.animate([{ transform: `translateY(${next - height}px)` }, { transform: "none" }], { duration: duration("--duration-quick"), easing: "ease-out" });
    height = next;
  });
  observer.observe(element);
  return () => observer.disconnect();
}

/*
 * The keyboard's travel under way, if one is (the shell says so as one starts): a room given while the keyboard moves
 * goes on the keyboard's own time and curve, so what moves with both -- the transcript above a closing composer -- makes
 * one move that ends with the keyboard, not a second one after it.
 */
let travel: { ends: number; easing: string } | null = null;
const travelWatchers = new Set<() => void>();
export function keyboardTravel(durationMs: number, easing: string) {
  travel = { ends: performance.now() + durationMs, easing };
  expected = 0;
  for (const watcher of travelWatchers) watcher();
}
const travelLeft = () => travel && travel.ends - performance.now() > 16 ? travel : null;
/*
 * A keyboard is about to come (the native composer is opening it): a holder taking its room holds where it is until
 * the travel starts, then takes it on the keyboard's time and curve -- one motion with the keyboard and the transcript,
 * not the room on the tap and the keyboard a beat after. Given up after `withinMs` without one (a hardware keyboard).
 */
let expected = 0;
/** Every live collapse, so a travel can settle them all at once (settleRooms). */
const collapses = new Set<() => void>();
/*
 * Settle every collapse to what its state now says, at once and unanimated. The native composer's keyboard travel does
 * this after measuring where the (hidden) web composer starts and before measuring where it ends: the whole change --
 * the keyboard's and the rooms' -- then rides the travel's one compositor animation (client/navigation/keyboard-travel.ts)
 * rather than a room gliding by layout on the main thread beside it.
 */
export function settleRooms() {
  expected = 0;
  for (const settle of collapses) settle();
}
export function expectKeyboardTravel(withinMs = 400) {
  expected = performance.now() + withinMs;
  setTimeout(() => { if (expected && performance.now() >= expected) { expected = 0; for (const watcher of travelWatchers) watcher(); } }, withinMs + 10);
}

/** Measured collapse: content and room glide together, from the first frame both ways (the content fades over the
 *  quick duration as its room goes), so what moves with the room -- a transcript above the composer -- makes one move. */
export function collapse(holder: HTMLElement): () => void {
  const content = holder.firstElementChild;
  if (!(content instanceof HTMLElement)) return () => {};
  const input = content.querySelector("textarea");
  const measure = () => {
    if (!input) return content.getBoundingClientRect().height;
    const style = getComputedStyle(content);
    return Math.max(parseFloat(style.minHeight) || 0, input.getBoundingClientRect().height
      + (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
      + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0));
  };
  const preference = matchMedia(REDUCED_MOTION_QUERY);
  let out = holder.hasAttribute("data-out");
  let height = out ? 0 : measure();
  let margin = parseFloat(getComputedStyle(holder).marginBlockEnd) || 0;
  let animation: Animation | undefined;
  const overflow = holder.style.overflow;
  let startedAt = 0, holding = false;
  const sync = (retime = false) => {
    const nextOut = holder.hasAttribute("data-out");
    const nextHeight = nextOut ? 0 : measure();
    const gap = parseFloat(getComputedStyle(holder.parentElement ?? holder).rowGap) || 0;
    const nextMargin = nextOut ? -gap : 0;
    if (!retime && height === nextHeight && margin === nextMargin && !preference.matches) return;
    // With the native composer drawing it, this composer is hidden: its room's change rides the keyboard travel's
    // transform instead (settleRooms), so it never glides; held until then when a keyboard is on its way.
    const mirrored = !!holder.closest("[data-native-mirror]");
    if (mirrored && !(performance.now() < expected)) {
      animation?.cancel(); animation = undefined; holding = false; holder.style.overflow = overflow;
      if (nextOut && !out) content.style.height = `${height}px`; else if (!nextOut) content.style.removeProperty("height");
      out = nextOut; height = nextHeight; margin = nextMargin;
      return;
    }
    // Taking its room with a keyboard on the way: held at its current height until the keyboard moves (see above).
    if ((mirrored || !nextOut) && performance.now() < expected && !travelLeft() && !preference.matches) {
      const from = animation ? holder.getBoundingClientRect().height : height;
      const fromM = animation ? parseFloat(getComputedStyle(holder).marginBlockEnd) || 0 : margin;
      animation?.cancel();
      holder.style.overflow = "clip";
      animation = holder.animate([{ height: `${from}px`, marginBlockEnd: `${fromM}px` }, { height: `${from}px`, marginBlockEnd: `${fromM}px` }], { duration: 1e6, fill: "both" });
      holding = true;
      return;
    }
    const fromHeight = animation ? holder.getBoundingClientRect().height : height;
    const fromMargin = animation ? parseFloat(getComputedStyle(holder).marginBlockEnd) || 0 : margin;
    animation?.cancel();
    const delay = 0;
    // Going, what it holds keeps the height it had and stays at its foot (the holder's own CSS) while its room goes from
    // above it, so it fades where it stands rather than being pressed flat; coming, it fills the holder again.
    if (nextOut && !out) content.style.height = `${fromHeight}px`;
    else if (!nextOut) content.style.removeProperty("height");
    out = nextOut; height = nextHeight; margin = nextMargin;
    animation = undefined;
    holder.style.overflow = overflow;
    if (preference.matches) return;
    holder.style.overflow = "clip";
    const riding = travelLeft();
    const current = holder.animate([
      { height: `${fromHeight}px`, marginBlockEnd: `${fromMargin}px` },
      { height: `${height}px`, marginBlockEnd: `${margin}px` },
    ], { duration: riding ? riding.ends - performance.now() : duration("--duration-gentle", holder), easing: riding?.easing ?? easing("--ease-room", holder), delay, fill: "both" });
    animation = current; startedAt = performance.now();
    current.onfinish = () => {
      if (animation !== current) return;
      animation = undefined; current.cancel(); holder.style.overflow = overflow;
    };
  };
  const sizes = new ResizeObserver(() => sync());
  sizes.observe(content);
  if (input) sizes.observe(input);
  const state = new MutationObserver(() => sync());
  // A glide that began a moment before the keyboard said it was moving (the two news cross in either order) is put on
  // the keyboard's time from where it has got to.
  const retime = () => { if (holding) { holding = false; sync(true); } else if (animation && performance.now() - startedAt < 80) sync(true); };
  travelWatchers.add(retime);
  const settle = () => { if (!holding && !animation) { sync(); return; } holding = false; animation?.cancel(); animation = undefined; sync(); };
  collapses.add(settle);
  state.observe(holder, { attributes: true, attributeFilter: ["data-out"] });
  const onPreference = () => sync();
  preference.addEventListener("change", onPreference);
  return () => {
    sizes.disconnect(); state.disconnect(); preference.removeEventListener("change", onPreference); travelWatchers.delete(retime); collapses.delete(settle);
    animation?.cancel(); holder.style.overflow = overflow;
  };
}
