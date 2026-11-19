import { unitPx } from "../components/ui/layout";

/* Widths in the desktop unit (--u-space: 16px at 100%), so they grow with the Interface size as the page does. */

/** A dashboard's composer at its least and its gutters. */
export const MIN_MAIN_PANE_UNITS = 33;

/** The narrowest a workspace view goes beside the chat in the main pane's
 *  split, as the dock's own minimum. */
export const MIN_SPLIT_PANE_UNITS = 18.75;

/** An artifact's text at its narrowest measure (the paper body's basis, --measure-xl), the sheet's own padding round it
 *  (--space-4xl each side) and its column's gutters at their least (--space-xs each side, as snug); the folded ribbon
 *  (its three sets on one row with the row's padding) and the header's tab and buttons fit within it, so an artifact and
 *  a chat stand side by side at 1440 wide with the sidebar open. */
export const MIN_ARTIFACT_PANE_UNITS = 30 + 2 * 2 + 2 * 0.25;

export const minMainPaneWidth = () => unitPx(MIN_MAIN_PANE_UNITS);
export const minArtifactPaneWidth = () => unitPx(MIN_ARTIFACT_PANE_UNITS);
export const minSplitPaneWidth = () => unitPx(MIN_SPLIT_PANE_UNITS);

