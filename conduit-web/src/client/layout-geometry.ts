/** Shared responsive geometry for the chat shell and panel surfaces. */
export const MOBILE_LAYOUT_BREAKPOINT_PX = 760;

/** Phone chrome needs both a narrow viewport and a phone-like primary pointer. */
export const PHONE_LAYOUT_QUERY = `(max-width: ${MOBILE_LAYOUT_BREAKPOINT_PX}px) and (hover: none) and (pointer: coarse)`;

/** The desktop shell is the complement used by Conduit's supported pointer types. */
export const NON_PHONE_LAYOUT_QUERY = `(min-width: ${MOBILE_LAYOUT_BREAKPOINT_PX + 1}px), (hover: hover), (pointer: fine), (pointer: none)`;

/* Widths in the desktop unit (--u-space: 16px at 100%), so they grow with the Interface size as the page does; unitPx
 * gives pixels. They were pixels at the old 12.8px unit, which held a fifth less once the unit grew. */

/** The narrowest the main pane goes on desktop: a dashboard's composer at its
 *  least (components/ui/styles/dashboard.css) and its gutters. The workspace panel stops growing here. */
export const MIN_MAIN_PANE_UNITS = 33;

/** The narrowest a workspace view goes beside the chat in the main pane's
 *  split, as the dock's own minimum. */
export const MIN_SPLIT_PANE_UNITS = 18.75;

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
export const minMainPaneWidth = () => unitPx(MIN_MAIN_PANE_UNITS);
export const minSplitPaneWidth = () => unitPx(MIN_SPLIT_PANE_UNITS);

