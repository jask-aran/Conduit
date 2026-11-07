import { createSignal, onCleanup, Show, untrack, type JSX } from "solid-js";

/** Run once the page is idle (a frame's spare time), within `timeout` ms. */
export const idle = (run: () => void, timeout = 400) => typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout }) : window.setTimeout(run, 50);
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
