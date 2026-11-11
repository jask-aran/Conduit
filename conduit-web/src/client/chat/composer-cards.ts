import { duration, easing, reducedMotion } from "@/components/ui/motion";
import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { Motion } from "@/components/ui";

export type CardExit = "drop" | "fade" | "none";

/** The data a card draws from empties the moment the composer takes it back, and Solid removes the card with it, so
 *  this holds the last present value for the length of the exit. */
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

/** `hold` is a duration token, not a literal, so a slowed Animation speed waits as long as the fade takes. */
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

export const riderMotion = (leaving: Exclude<CardExit, "none"> | null): Motion => leaving === "drop" ? "leaving" : leaving === "fade" ? "removing" : "entering";

/** The animation is handed back so a removal that fails can put the card back. */
export async function fadeOut(element: Element | null | undefined, durationMs: number = duration("--duration-quick")): Promise<Animation | null> {
  if (!element || reducedMotion() || typeof (element as HTMLElement).animate !== "function") return null;
  const animation = (element as HTMLElement).animate([{ opacity: 1 }, { opacity: 0 }],
    { duration: durationMs, easing: easing("--ease-leave"), fill: "forwards" });
  await animation.finished.catch(() => undefined);
  return animation;
}
