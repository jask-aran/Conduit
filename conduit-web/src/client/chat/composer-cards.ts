import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import "./composer-cards.css";

/**
 * How a card that belongs to the composer goes: back down into it when the
 * composer takes it (sent, or put back to edit), faded in place when the reader
 * removes it, or at once when its removal has already been drawn.
 */
export type CardExit = "drop" | "fade" | "none";

const LEAVE_MS = { drop: 200, fade: 150 } as const;
const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Keep what a composer card last showed on screen while it leaves.
 *
 * The data a card draws from empties the moment the composer takes it back, and
 * Solid removes the card with it, so there is nothing left to leave. This holds
 * the last present value for the length of the exit and says it is leaving;
 * the card draws that value with `data-leaving`, and CSS plays the exit.
 */
export function createLeaving<T>(source: () => T, present: (value: T) => boolean, exit: () => CardExit = () => "drop") {
  const [held, setHeld] = createSignal<T>(source());
  const [leaving, setLeaving] = createSignal<Exclude<CardExit, "none"> | null>(null);
  createEffect(() => {
    const next = source();
    if (present(next)) { setLeaving(null); setHeld(() => next); return; }
    const style = untrack(exit);
    if (style === "none" || reduced() || !present(untrack(held))) { setLeaving(null); setHeld(() => next); return; }
    setLeaving(style);
    const done = setTimeout(() => { setLeaving(null); setHeld(() => next); }, LEAVE_MS[style]);
    onCleanup(() => clearTimeout(done));
  });
  return { value: held, leaving };
}

/**
 * Fade one card out in place before it is taken away. The animation is handed
 * back so a removal that fails can put the card back.
 */
export async function fadeOut(element: Element | null | undefined, duration: number = LEAVE_MS.fade): Promise<Animation | null> {
  if (!element || reduced() || typeof (element as HTMLElement).animate !== "function") return null;
  const animation = (element as HTMLElement).animate([{ opacity: 1 }, { opacity: 0 }],
    { duration, easing: "cubic-bezier(.4, 0, 1, 1)", fill: "forwards" });
  await animation.finished.catch(() => undefined);
  return animation;
}
