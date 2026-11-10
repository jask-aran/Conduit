import { createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";

/** Where there is no requestIdleCallback, how long idle waits. */
const IDLE_FALLBACK_MS = 50;

/** Run once the page is idle (a frame's spare time), within `timeout` ms. */
export const idle = (run: () => void, timeout = 400) => typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout }) : window.setTimeout(run, IDLE_FALLBACK_MS);
export const cancelIdle = (handle: number) => typeof cancelIdleCallback === "function" ? cancelIdleCallback(handle) : clearTimeout(handle);

/**
 * What need not be drawn with the rest: built in idle time after it (an older message's foot actions, unseen until
 * the row is revealed). now: drawn with the rest after all (the latest exchange's, shown).
 */
export function Later(props: { now?: boolean; children: JSX.Element }) {
  const [ready, setReady] = createSignal(Boolean(untrack(() => props.now)));
  if (!ready()) { const handle = idle(() => setReady(true)); onCleanup(() => cancelIdle(handle)); }
  return <Show when={ready() || props.now}>{props.children}</Show>;
}

/** Run once `element` stops scrolling (no scroll for `ms`): where a reader is, kept as they stop, so leaving it reads
 *  nothing (a scroll position remembered at the moment a page changes reads the next page's layout). Undone with the
 *  owner. */
export function onScrollRest(element: HTMLElement, run: () => void, ms = 200) {
  let timer = 0;
  const scrolled = () => { clearTimeout(timer); timer = window.setTimeout(run, ms); };
  element.addEventListener("scroll", scrolled, { passive: true });
  onCleanup(() => { clearTimeout(timer); element.removeEventListener("scroll", scrolled); });
}
