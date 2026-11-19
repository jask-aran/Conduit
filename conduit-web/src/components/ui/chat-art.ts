import { createEffect, createRoot, createSignal, onCleanup, onMount } from "solid-js";
import animeClouds from "./assets/art/anime-clouds.webp";
import jadeCoast from "./assets/art/jade-coast.webp";
import pineLake from "./assets/art/pine-lake.webp";
import summerHills from "./assets/art/summer-hills.webp";
import peachTide from "./assets/art/peach-tide.webp";
import blackHole from "./assets/art/black-hole.webp";
import stackedDither from "./assets/art/stacked-dither.gif";
import sceneWaves from "./assets/art/scene-waves.webp";
import sceneSharks from "./assets/art/scene-sharks.webp";
import sceneSpiders from "./assets/art/scene-spiders.webp";

/** A background that moves and is its own picture: never dithered over, only dimmed. */
export type ChatArtScene = "waves" | "stacked-dither" | "sharks" | "spiders";
/** `image` is a still of the scene, for choosing it by. */
export const chatArtScenes: { id: ChatArtScene; label: string; image: string }[] = [{ id: "waves", label: "Waves", image: sceneWaves }, { id: "stacked-dither", label: "Stacked dither", image: stackedDither }, { id: "sharks", label: "Sharks", image: sceneSharks }, { id: "spiders", label: "Spiders", image: sceneSpiders }];
export const wavePalettes = ["midnight", "peach", "ember", "moss", "lilac", "mono"] as const;
export const waveColours = ["blue", "purple", "green", "amber", "rose", "mono"] as const;
export type AnimationOptions = { waveColour: typeof waveColours[number]; speed: number; cell: number; palette: typeof wavePalettes[number]; well: number; sharks: number; webs: number; flies: number; jumper: boolean };
export type ChatArtLook = AnimationOptions & { image: string; scene?: ChatArtScene; dither: boolean; dot: number; levels: number; strength: number; brightness: number; fade: number };
export const chatArtLook: Omit<ChatArtLook, "image"> = { waveColour: "blue", speed: 1, cell: 2, palette: "midnight", well: 0, sharks: 4, webs: 6, flies: 24, jumper: true, dither: true, dot: 2, levels: 4, strength: 1, brightness: 0.6, fade: 0.6 };

export const chatArtSet = [
  { id: "anime-clouds", label: "Anime clouds", image: animeClouds },
  { id: "jade-coast", label: "Jade coast", image: jadeCoast },
  { id: "pine-lake", label: "Pine lake", image: pineLake },
  { id: "summer-hills", label: "Summer hills", image: summerHills },
  { id: "peach-tide", label: "Peach tide", image: peachTide },
  { id: "black-hole", label: "Black hole", image: blackHole },
];
// The one picture every window onto it shows its part of; null is none. Whoever holds the person's choice sets it.
const panes = new Map<HTMLElement, number>();
const sync = () => void import("./chat-art-draw").then(({ syncArt }) => syncArt(chatArt(), new Set(panes.keys())));
export const [chatArt, setChatArt] = createRoot(() => {
  const signal = createSignal<ChatArtLook | null>(null);
  createEffect(() => { if (signal[0]() || panes.size) sync(); });
  return signal;
});

/** For a view's root element: the pane the view stands in is a window onto the art while the view is mounted;
    `dim` for a view that covers its pane, which shows the picture faintly through itself; `"shade"` for a view whose
    muted text stands on the picture, which is shaded under it. */
export function createArtWindow(dim: boolean | "shade" = false) {
  let inside: Element | undefined;
  onMount(() => {
    // A dimmed view is screened over the picture, which only reaches as far as the nearest layer that isolates it.
    const pane = inside?.closest<HTMLElement>(dim === true ? ".ui-sheet-fill, .ui-sheet, .ui-dock-surface" : ".ui-sheet, .ui-dock-surface");
    if (!pane) return;
    panes.set(pane, (panes.get(pane) ?? 0) + 1);
    pane.toggleAttribute("data-art-dim", dim === true);
    pane.toggleAttribute("data-art-shade", dim === "shade");
    if (chatArt()) sync();
    // Counted: a pane's next view mounts before the one it replaces is cleaned up.
    onCleanup(() => { const left = panes.get(pane)! - 1; if (left) panes.set(pane, left); else { panes.delete(pane); sync(); } });
  });
  return (element: Element) => { inside = element; };
}
