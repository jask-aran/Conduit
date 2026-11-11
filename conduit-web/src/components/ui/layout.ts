/* vite.config.js turns these queries into the CSS custom media (--conduit-phone-layout, --conduit-wide-layout) the
   library's styles use. */

export const MOBILE_LAYOUT_BREAKPOINT_PX = 760;

const TOUCH_ONLY_QUERY = "(hover: none) and (pointer: coarse)";

export const touchOnly = () => typeof matchMedia === "function" && matchMedia(TOUCH_ONLY_QUERY).matches;

export const PHONE_LAYOUT_QUERY = `(max-width: ${MOBILE_LAYOUT_BREAKPOINT_PX}px) and ${TOUCH_ONLY_QUERY}`;

// A phone's layout is the phone presentation (header.css): its root says so before anything is drawn.
if (typeof window !== "undefined") {
  const phone = matchMedia(PHONE_LAYOUT_QUERY), root = document.documentElement;
  const mark = () => { if (phone.matches) root.dataset.presentation = "phone"; else delete root.dataset.presentation; };
  mark();
  phone.addEventListener("change", mark);
}

export const NON_PHONE_LAYOUT_QUERY = `(min-width: ${MOBILE_LAYOUT_BREAKPOINT_PX + 1}px), (hover: hover), (pointer: fine), (pointer: none)`;

// Measured once and kept until the window or the Interface size changes.
let unit: number | undefined;
if (typeof window !== "undefined") for (const change of ["resize", "conduit:ui-scale"]) addEventListener(change, () => { unit = undefined; });
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
