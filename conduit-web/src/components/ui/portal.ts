import { createSignal, onCleanup, onMount } from "solid-js";

/** The fullscreen element while one is up, so a menu or dialog shows over a fullscreen video. */
export function createFullscreenPortalMount() {
  const [mount, setMount] = createSignal<HTMLElement>();
  const sync = () => setMount(document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : undefined);
  onMount(() => {
    sync();
    document.addEventListener("fullscreenchange", sync);
  });
  onCleanup(() => document.removeEventListener("fullscreenchange", sync));
  return mount;
}
