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
