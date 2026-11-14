import { createSignal, onCleanup } from "solid-js";
import type { ArtifactCommand } from "../commands/command-registry.ts";
import type { ArtifactKind } from "./artifacts";

/*
 * The artifact whose pane the person last worked in, and what it offers the command palette and the shortcuts. Each
 * offer is one of the registry's ARTIFACT_COMMANDS; one a kind leaves out (a site has no blocks to move) is neither
 * listed nor run. While one is held, the palette lists its commands in place of the chat's.
 */
export type FocusedArtifact = { id: string; kind: ArtifactKind; offers: Partial<Record<ArtifactCommand, () => void>> };
const [holder, setHolder] = createSignal<(() => FocusedArtifact | null) | null>(null);
export const focusedArtifact = () => holder()?.() ?? null;

/** `pane`: the artifact's pane. It is held from a press or focus inside it until one lands in another pane; a menu or dialog over the app takes nothing. */
export function holdArtifact(pane: () => HTMLElement | undefined, about: () => FocusedArtifact | null) {
  const seen = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && pane()?.contains(target)) setHolder(() => about);
    else if (holder() === about && !target?.closest('[role="dialog"], [role="menu"], [role="listbox"]')) setHolder(null);
  };
  document.addEventListener("pointerdown", seen, true); document.addEventListener("focusin", seen, true);
  onCleanup(() => { document.removeEventListener("pointerdown", seen, true); document.removeEventListener("focusin", seen, true); if (holder() === about) setHolder(null); });
}

/** A block someone asked to be shown (a comment's card in a thread, pressed): kept until its paper's pane has an editor to show it in. */
const [wanted, setWanted] = createSignal<{ id: string; block: string } | null>(null);
export const blockWanted = (id: string) => wanted()?.id === id ? wanted()!.block : undefined;
export const blockShown = () => setWanted(null);
window.addEventListener("conduit:open-artifact", (event) => { const { id, block } = (event as CustomEvent<{ id: string; block?: string }>).detail; if (block) setWanted({ id, block: block.split(" ")[0]! }); });
