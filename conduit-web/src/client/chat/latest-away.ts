import { createSignal } from "solid-js";

/* The phone's voice composer carries scroll-to-latest in its row: the
   transcript says whether the latest is out of view and takes the press. */
export const [latestAway, setLatestAway] = createSignal(false);
let scroller: (() => void) | null = null;
export const setLatestScroller = (scroll: (() => void) | null) => { scroller = scroll; };
export const scrollToLatest = () => scroller?.();
