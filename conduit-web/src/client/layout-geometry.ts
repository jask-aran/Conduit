/** Shared responsive geometry for the chat shell and panel surfaces. */
export const MOBILE_LAYOUT_BREAKPOINT_PX = 760;

/** Phone chrome needs both a narrow viewport and a phone-like primary pointer. */
export const PHONE_LAYOUT_QUERY = `(max-width: ${MOBILE_LAYOUT_BREAKPOINT_PX}px) and (hover: none) and (pointer: coarse)`;

/** The desktop shell is the complement used by Conduit's supported pointer types. */
export const NON_PHONE_LAYOUT_QUERY = `(min-width: ${MOBILE_LAYOUT_BREAKPOINT_PX + 1}px), (hover: hover), (pointer: fine), (pointer: none)`;

/** The narrowest the main pane goes on desktop: a dashboard's composer at its
 *  least (split.css) and its gutters. The workspace panel stops growing here. */
export const MIN_MAIN_PANE_WIDTH = 420;

/** The narrowest a workspace view goes beside the chat in the main pane's
 *  split, as the dock's own minimum. */
export const MIN_SPLIT_PANE_WIDTH = 240;

