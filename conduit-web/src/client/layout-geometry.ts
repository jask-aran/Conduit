import { unitPx } from "../components/ui/layout";

/* Widths in the desktop unit (--u-space: 16px at 100%), so they grow with the Interface size as the page does. */

/** A dashboard's composer at its least and its gutters. */
export const MIN_MAIN_PANE_UNITS = 33;

/** The narrowest a workspace view goes beside the chat in the main pane's
 *  split, as the dock's own minimum. */
export const MIN_SPLIT_PANE_UNITS = 18.75;

export const minMainPaneWidth = () => unitPx(MIN_MAIN_PANE_UNITS);
export const minSplitPaneWidth = () => unitPx(MIN_SPLIT_PANE_UNITS);

