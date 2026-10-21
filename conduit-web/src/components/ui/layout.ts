/* Layout: the phone and wide layouts, the touch-only test, and pixels for a length in the unit. vite.config.js turns
   the queries into the CSS custom media (--conduit-phone-layout, --conduit-wide-layout) the library's styles use. */

/** The widest a phone layout goes. */
export const MOBILE_LAYOUT_BREAKPOINT_PX = 760;

/** Query for a primary pointer with touch input and no hover. */
export const TOUCH_ONLY_QUERY = "(hover: none) and (pointer: coarse)";

/** Whether the primary pointer has touch input and no hover. */
export const touchOnly = () => typeof matchMedia === "function" && matchMedia(TOUCH_ONLY_QUERY).matches;

/** Phone chrome needs both a narrow viewport and a phone-like primary pointer. */
export const PHONE_LAYOUT_QUERY = `(max-width: ${MOBILE_LAYOUT_BREAKPOINT_PX}px) and ${TOUCH_ONLY_QUERY}`;

/** The desktop shell is the complement used by Conduit's supported pointer types. */
export const NON_PHONE_LAYOUT_QUERY = `(min-width: ${MOBILE_LAYOUT_BREAKPOINT_PX + 1}px), (hover: hover), (pointer: fine), (pointer: none)`;

// Measured once and kept until the window or the Interface size changes.
let unit: number | undefined;
if (typeof window !== "undefined") for (const change of ["resize", "conduit:ui-scale"]) addEventListener(change, () => { unit = undefined; });
/** Pixels for a length in the unit, at the root (the chrome's region). */
export function unitPx(units: number) {
  if (unit === undefined) {
    const probe = document.createElement("div");
    probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;width:var(--u-space)";
    document.body.append(probe);
    unit = probe.getBoundingClientRect().width || 16;
    probe.remove();
  }
  return units * unit;
}
