import { createSignal, onCleanup, onMount } from "solid-js";

/** Where a portal mounts: the fullscreen element while one is up (a menu or dialog over a fullscreen video), else the body. */
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
