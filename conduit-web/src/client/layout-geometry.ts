import { unitPx } from "../components/ui/layout";

/* Widths in the desktop unit (--u-space: 16px at 100%), so they grow with the Interface size as the page does; unitPx
 * gives pixels. They were pixels at the old 12.8px unit, which held a fifth less once the unit grew. */

/** The narrowest the main pane goes on desktop: a dashboard's composer at its
 *  least (components/ui/styles/dashboard.css) and its gutters. The workspace panel stops growing here. */
export const MIN_MAIN_PANE_UNITS = 33;

/** The narrowest a workspace view goes beside the chat in the main pane's
 *  split, as the dock's own minimum. */
export const MIN_SPLIT_PANE_UNITS = 18.75;

export const minMainPaneWidth = () => unitPx(MIN_MAIN_PANE_UNITS);
export const minSplitPaneWidth = () => unitPx(MIN_SPLIT_PANE_UNITS);

