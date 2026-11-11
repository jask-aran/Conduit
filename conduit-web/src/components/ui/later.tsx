import { createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";

const IDLE_FALLBACK_MS = 50;

export const idle = (run: () => void, timeout = 400) => typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout }) : window.setTimeout(run, IDLE_FALLBACK_MS);
export const cancelIdle = (handle: number) => typeof cancelIdleCallback === "function" ? cancelIdleCallback(handle) : clearTimeout(handle);

export function Later(props: { now?: boolean; children: JSX.Element }) {
  const [ready, setReady] = createSignal(Boolean(untrack(() => props.now)));
  if (!ready()) { const handle = idle(() => setReady(true)); onCleanup(() => cancelIdle(handle)); }
  return <Show when={ready() || props.now}>{props.children}</Show>;
}

/** Kept as the reader stops, so leaving reads nothing: a scroll position read at the moment a page changes reads the
 *  next page's layout. */
export function onScrollRest(element: HTMLElement, run: () => void, ms = 200) {
  let timer = 0;
  const scrolled = () => { clearTimeout(timer); timer = window.setTimeout(run, ms); };
  element.addEventListener("scroll", scrolled, { passive: true });
  onCleanup(() => { clearTimeout(timer); element.removeEventListener("scroll", scrolled); });
}
