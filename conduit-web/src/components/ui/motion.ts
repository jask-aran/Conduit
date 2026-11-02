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
  /** How a part that folds gives its room: fold (to nothing, after it fades) or tuck (under its neighbour, as it fades). */
  move?: "fold" | "tuck";
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
