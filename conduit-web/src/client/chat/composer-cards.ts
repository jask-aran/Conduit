import { duration, easing, reducedMotion } from "@/components/ui/motion";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { Motion } from "@/components/ui";

/**
 * How a card that belongs to the composer goes: back down into it when the
 * composer takes it (sent, or put back to edit), faded in place when the reader
 * removes it, or at once when its removal has already been drawn.
 */
export type CardExit = "drop" | "fade" | "none";

/**
 * Keep what a composer card last showed on screen while it leaves.
 *
 * The data a card draws from empties the moment the composer takes it back, and
 * Solid removes the card with it, so there is nothing left to leave. This holds
 * the last present value for the length of the exit and says it is leaving;
 * the card draws that value as its Rider's motion (riderMotion), and the library plays the exit.
 */
export function createLeaving<T>(source: () => T, present: (value: T) => boolean, exit: () => CardExit = () => "drop") {
  const [held, setHeld] = createSignal<T>(source());
  const [leaving, setLeaving] = createSignal<Exclude<CardExit, "none"> | null>(null);
  createEffect(() => {
    const next = source();
    if (present(next)) { setLeaving(null); setHeld(() => next); return; }
    const style = untrack(exit);
    if (style === "none" || reducedMotion() || !present(untrack(held))) { setLeaving(null); setHeld(() => next); return; }
    setLeaving(style);
    const done = setTimeout(() => { setLeaving(null); setHeld(() => next); }, duration("--duration-quick"));
    onCleanup(() => clearTimeout(done));
  });
  return { value: held, leaving };
}

/** A leaving card's Rider motion: dropping back into the composer, or removed (faded in place); else it rises in. */
export const riderMotion = (leaving: Exclude<CardExit, "none"> | null): Motion => leaving === "drop" ? "leaving" : leaving === "fade" ? "removing" : "entering";

/**
 * Fade one card out in place before it is taken away. The animation is handed
 * back so a removal that fails can put the card back.
 */
export async function fadeOut(element: Element | null | undefined, durationMs: number = duration("--duration-quick")): Promise<Animation | null> {
  if (!element || reducedMotion() || typeof (element as HTMLElement).animate !== "function") return null;
  const animation = (element as HTMLElement).animate([{ opacity: 1 }, { opacity: 0 }],
    { duration: durationMs, easing: easing("--ease-leave"), fill: "forwards" });
  await animation.finished.catch(() => undefined);
  return animation;
}
