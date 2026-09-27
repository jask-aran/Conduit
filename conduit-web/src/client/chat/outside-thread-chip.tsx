import { createSignal, onCleanup, onMount } from "solid-js";
import { COMPOSER_SURFACE_CHANGE_EVENT, selectedComposerSurface, type ComposerSurfaceMode } from "./composer-surface";
import "./outside-thread-chip.css";

/**
 * Beside the breadcrumb of a thread Conduit does not keep: that it is not in
 * Conduit, and tracking, the one thing to do about it. Tracking keeps a
 * thread in a workspace, so in any other folder it says it will make the
 * folder one. Floating chrome, so the composer's material.
 */
export function OutsideThreadChip(props: { harness: string; folder: string; workspace: boolean; busy: boolean; onTrack: () => void }) {
  const [surface, setSurface] = createSignal<ComposerSurfaceMode>(selectedComposerSurface());
  onMount(() => {
    const changed = (event: Event) => setSurface((event as CustomEvent<ComposerSurfaceMode>).detail);
    window.addEventListener(COMPOSER_SURFACE_CHANGE_EVENT, changed);
    onCleanup(() => window.removeEventListener(COMPOSER_SURFACE_CHANGE_EVENT, changed));
  });
  const name = () => props.folder.split("/").filter(Boolean).at(-1) || props.folder;
  const detail = () => props.workspace
    ? `${props.harness} keeps this thread. Tracking keeps it in Conduit.`
    : `${props.harness} keeps this thread. Tracking keeps it in Conduit and makes ${name()} a workspace.`;
  return <span class="outside-thread-chip composer-surface-material" data-composer-surface={surface()} title={detail()}>
    <span>Not in Conduit</span>
    <button type="button" tabIndex={-1} disabled={props.busy} aria-label={props.workspace ? "Track in Conduit" : `Track in Conduit, making ${name()} a workspace`} onClick={props.onTrack}>{props.busy ? "Tracking…" : "Track"}</button>
  </span>;
}
