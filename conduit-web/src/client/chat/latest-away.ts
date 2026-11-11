import { createSignal } from "solid-js";

/* The transcript drawn last owns Scroll to latest (a jbot chat in a sheet over a thread); one leaving gives up only
   what is still its own. */
export const [latestAway, setLatestAway] = createSignal(false);
let scroller: (() => void) | null = null;
export const setLatestScroller = (scroll: () => void) => { scroller = scroll; };
export const dropLatestScroller = (scroll: () => void) => { if (scroller !== scroll) return; scroller = null; setLatestAway(false); };
export const tellLatestAway = (scroll: () => void, away: boolean) => { if (scroller === scroll) setLatestAway(away); };
export const scrollToLatest = () => scroller?.();
