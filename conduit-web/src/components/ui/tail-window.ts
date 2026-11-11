import { cancelIdle, idle } from "./later";
import { createComputed, createEffect, createMemo, createSignal, on, onCleanup, untrack } from "solid-js";

export function createTailWindow<T>(options: {
  items: () => readonly T[];
  key: () => unknown;
  fills: () => boolean;
  tail?: number;
  estimate?: (item: T) => number;
  room?: () => number;
  whole?: () => boolean;
  scroller?: () => HTMLElement | null | undefined;
  step?: number;
  settle?: () => void;
}) {
  const tail = options.tail ?? 3;
  const step = options.step ?? 8;
  const [offset, setOffset] = createSignal(0);
  const [drawn, setDrawn] = createSignal(false);
  let openedFor: unknown = undefined;
  let frame = 0;
  // A new list starts at its tail, once it has items: before it is drawn (a computation runs ahead of the render).
  createComputed(on([options.key, () => options.items().length] as const, ([key, length]) => {
    if (key === openedFor) return;
    // Nothing yet (a chat still loading, or an empty one): nothing to draw; its items open the window when they come.
    if (!length) return void setDrawn(true);
    openedFor = key;
    cancelIdle(frame);
    let start = untrack(() => options.whole?.()) ? 0 : Math.max(0, length - tail);
    const room = start && options.estimate && options.room?.();
    if (room) {
      const items = untrack(options.items);
      let height = 0;
      start = length;
      while (start > 0 && (height < room * 1.25 || length - start < tail)) height += options.estimate!(items[--start]!);
    }
    // All of it fits the tail: drawn whole, at once (an unchanged offset would never say so).
    setDrawn(start === 0);
    setOffset(start);
  }));
  const shown = createMemo(() => {
    const items = options.items();
    const start = Math.min(offset(), items.length);
    return start ? items.slice(start) : items;
  });
  createEffect(on(offset, (start) => {
    if (untrack(drawn) && start === 0) return;
    // Measured only until drawn: a measure is a forced layout a step.
    if (start > 0 && !untrack(drawn) && !options.fills()) return void setOffset(Math.max(0, start - tail));
    setDrawn(true);
    if (!start) return;
    // In idle time, never in a frame: the page may be sliding over it (a phone's drawer shutting onto it).
    cancelIdle(frame);
    frame = idle(() => {
      const scroller = options.scroller?.();
      const fromFoot = scroller ? scroller.scrollHeight - scroller.scrollTop : 0;
      setOffset((at) => Math.max(0, at - step));
      options.settle?.();
      if (scroller) scroller.scrollTop = scroller.scrollHeight - fromFoot;
    });
  }));
  onCleanup(() => cancelIdle(frame));
  return { shown, offset, drawn };
}
