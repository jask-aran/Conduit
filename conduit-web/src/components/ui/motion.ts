import { createContext, createSignal, onCleanup, useContext, type Accessor } from "solid-js";
import { cssTime } from "./shared";

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// One query, read each call: making one each time adds a parse and a lookup.
let reducedMotionQuery: MediaQueryList | undefined;

export function reducedMotion(): boolean {
  if (typeof matchMedia !== "function") return false;
  reducedMotionQuery ??= matchMedia(REDUCED_MOTION_QUERY);
  return reducedMotionQuery.matches;
}
export const COPY_FEEDBACK_MS = 1200;
export function createFlash(ms = COPY_FEEDBACK_MS): { on: Accessor<boolean>; flash: () => void } {
  const [on, setOn] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));
  return { on, flash: () => { setOn(true); clearTimeout(timer); timer = setTimeout(() => setOn(false), ms); } };
}

export function duration(token: `--duration-${string}`, element: Element = document.documentElement): number {
  return cssTime(element, token, 0);
}

/** Also calls then once the token's duration (and a beat) has passed, since a transition that never runs (reduced
 *  motion, nothing to change) sends neither event. */
export function whenMotionEnds(element: Element | null | undefined, property: string, token: `--duration-${string}`, then: () => void): () => void {
  let timer = 0;
  const heard = (event: Event) => { if (event.target === element && (event as TransitionEvent).propertyName === property) done(); };
  const cancel = () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    element?.removeEventListener("transitionend", heard);
    element?.removeEventListener("transitioncancel", heard);
  };
  const done = () => { cancel(); then(); };
  element?.addEventListener("transitionend", heard);
  // A cancel is heard from the next frame: one sent in this frame is the motion this one turned back, not this one.
  const frame = requestAnimationFrame(() => element?.addEventListener("transitioncancel", heard));
  timer = window.setTimeout(done, duration(token, element ?? undefined) + 100);
  return cancel;
}

/* Scales the duration tokens, which CSS transitions and duration() both read, so whatever waits for a motion waits as
   long as it takes. */
const SCALED_DURATIONS = ["quick", "gentle", "fold", "travel", "follow", "flash", "spin", "pulse", "breathe"].map((name) => `--duration-${name}`);

const ms = (value: string) => {
  const text = value.trim();
  const number = parseFloat(text);
  return Number.isFinite(number) ? (text.endsWith("ms") ? number : number * 1000) : null;
};

export function scaleMotion(scale: number) {
  const root = document.documentElement;
  for (const token of SCALED_DURATIONS) root.style.removeProperty(token);
  if (scale === 1) return;
  // The stylesheet's own lengths, read with nothing set over them.
  const styles = getComputedStyle(root);
  for (const token of SCALED_DURATIONS) {
    const base = ms(styles.getPropertyValue(token));
    if (base !== null) root.style.setProperty(token, `${Math.round(base * scale)}ms`);
  }
}

export function easing(token: `--ease-${string}`, element: Element = document.documentElement): string {
  return getComputedStyle(element).getPropertyValue(token).trim() || "ease";
}

export type MoveScope = {
  out?: Accessor<boolean>;
  under?: Accessor<boolean>;
  voice?: Accessor<boolean>;
};
export const MoveContext = createContext<MoveScope>({});
export const useMoveScope = () => useContext(MoveContext);

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

/* The keyboard's travel under way, if any: a room given meanwhile goes on the keyboard's time and curve, so the
   transcript above a closing composer makes one move ending with the keyboard, not a second after it. */
let travel: { ends: number; easing: string } | null = null;
const travelWatchers = new Set<() => void>();
export function keyboardTravel(durationMs: number, easing: string) {
  travel = { ends: performance.now() + durationMs, easing };
  expected = 0;
  for (const watcher of travelWatchers) watcher();
}
const travelLeft = () => travel && travel.ends - performance.now() > 16 ? travel : null;
/* A keyboard is about to come (the native composer opens it): a holder taking its room holds until the travel starts,
   then rides it, one motion rather than the room on the tap and the keyboard a beat after. Given up after `withinMs`
   (a hardware keyboard). */
let expected = 0;
const collapses = new Set<() => void>();
/* Called between measuring the hidden web composer's start and end, so the whole change rides the keyboard travel's
   one compositor animation rather than a room gliding by layout on the main thread. */
export function settleRooms() {
  expected = 0;
  for (const settle of collapses) settle();
}
export function expectKeyboardTravel(withinMs = 400) {
  expected = performance.now() + withinMs;
  setTimeout(() => { if (expected && performance.now() >= expected) { expected = 0; for (const watcher of travelWatchers) watcher(); } }, withinMs + 10);
}

/** Content and room glide together from the first frame both ways, so what moves with the room makes one move. */
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
    // Going, its content keeps its height at the foot while the room goes from above, so it fades rather than flattens.
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
  // A glide begun just before the keyboard said it was moving (either order happens) moves onto the keyboard's time.
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
