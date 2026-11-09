import { createSignal } from "solid-js";

/* The phone's voice composer carries scroll-to-latest in its row: the
   transcript says whether the latest is out of view and takes the press.
   The transcript drawn last owns it (a jbot chat in a sheet over a thread);
   one leaving gives up only what is still its own. */
export const [latestAway, setLatestAway] = createSignal(false);
let scroller: (() => void) | null = null;
export const setLatestScroller = (scroll: () => void) => { scroller = scroll; };
/** Give up Scroll to latest, if it is still this transcript's. */
export const dropLatestScroller = (scroll: () => void) => { if (scroller !== scroll) return; scroller = null; setLatestAway(false); };
/** Say whether the latest is out of view, for the transcript that owns Scroll to latest. */
export const tellLatestAway = (scroll: () => void, away: boolean) => { if (scroller === scroll) setLatestAway(away); };
export const scrollToLatest = () => scroller?.();
