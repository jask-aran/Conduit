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
export function createLeaving<T>(source: () => T, present: (value: T) => boolean, exit: () => CardExit = () => "drop", hold: `--duration-${string}` = "--duration-quick") {
  const [held, setHeld] = createSignal<T>(source());
  const [leaving, setLeaving] = createSignal<Exclude<CardExit, "none"> | null>(null);
  createEffect(() => {
    const next = source();
    if (present(next)) { setLeaving(null); setHeld(() => next); return; }
    const style = untrack(exit);
    if (style === "none" || reducedMotion() || !present(untrack(held))) { setLeaving(null); setHeld(() => next); return; }
    setLeaving(style);
    const done = setTimeout(() => { setLeaving(null); setHeld(() => next); }, duration(hold));
    onCleanup(() => clearTimeout(done));
  });
  return { value: held, leaving };
}

/**
 * A list whose items leave as a card does: one gone from `source` is kept, marked leaving, for the length of its exit
 * (`hold`), where it was, so its row can close its room instead of vanishing. Items are named by `key`: `keys` is the
 * list to draw (stable strings, so rows keep their identity), `get` an item's latest value, `leaving` whether it is going.
 */
export function createLeavingList<T>(source: () => T[], key: (item: T) => string, hold: `--duration-${string}` = "--duration-gentle") {
  const [keys, setKeys] = createSignal<string[]>([]);
  const [values, setValues] = createSignal(new Map<string, T>());
  const [going, setGoing] = createSignal(new Set<string>());
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  createEffect(() => {
    const next = source();
    const present = new Map(next.map((item) => [key(item), item] as const));
    const was = untrack(keys);
    const leaving = new Set(untrack(going));
    const stay = reducedMotion();
    const order = [...was];
    for (const k of was) {
      if (present.has(k)) { leaving.delete(k); const timer = timers.get(k); if (timer) { clearTimeout(timer); timers.delete(k); } continue; }
      if (stay) continue;
      if (!leaving.has(k)) {
        leaving.add(k);
        timers.set(k, setTimeout(() => {
          timers.delete(k);
          setKeys((list) => list.filter((item) => item !== k));
          setGoing((set) => { const copy = new Set(set); copy.delete(k); return copy; });
        }, duration(hold)));
      }
    }
    for (const k of present.keys()) if (!order.includes(k)) order.push(k);
    setValues((map) => { const copy = new Map(map); for (const [k, item] of present) copy.set(k, item); return copy; });
    setGoing(leaving);
    setKeys(stay ? order.filter((k) => present.has(k)) : order);
  });
  onCleanup(() => { for (const timer of timers.values()) clearTimeout(timer); });
  return { keys, get: (k: string) => values().get(k), leaving: (k: string) => going().has(k) };
}

/**
 * Rows gone from the data but still drawn while they fade: `leave(ghost)` puts one in `list` for the length of its
 * exit (`hold`, so a slowed Animation speed waits as long as the fade takes). A ghost replaces any already leaving
 * that is the `same` as it.
 */
export function createLeavingRows<T>(same: (a: T, b: T) => boolean = (a, b) => a === b, hold: `--duration-${string}` = "--duration-quick") {
  const [list, setList] = createSignal<T[]>([]);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const leave = (ghost: T) => {
    setList((rows) => [...rows.filter((row) => !same(row, ghost)), ghost]);
    const timer = setTimeout(() => { timers.delete(timer); setList((rows) => rows.filter((row) => row !== ghost)); }, duration(hold));
    timers.add(timer);
  };
  onCleanup(() => { for (const timer of timers) clearTimeout(timer); });
  return { list, leave };
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
