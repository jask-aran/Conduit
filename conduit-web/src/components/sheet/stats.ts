import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import type { SheetView } from "@/sheet-format.js";
import type { SheetRange } from "./host";

/** A selection's figures: `count` of cells with anything, the rest over its numbers only (none where it has no number), and the cells they are of. */
export type SheetFigures = { count: number; numbers: number; sum: number; min: number; max: number; range: SheetRange };

// Read in a task of its own, never the selection's, in slices that leave the frame's budget (6.94 ms at 144 Hz) to the page; a new selection drops it.
const SLICE_MS = 3;
const yieldTask = () => new Promise<void>((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => resolve(); channel.port2.postMessage(null); });

/** The figures of the cells selected, read from the model's computed values off the selection's task; null for one cell or none. Whole rows or columns count only the tab's own cells. */
/** `others`: the ranges selected besides it, counted too, each cell once where they overlap. */
export function createFigures(model: Accessor<SheetView | undefined>, selection: Accessor<SheetRange | null>, others: Accessor<readonly SheetRange[]> = () => []): Accessor<SheetFigures | null> {
  const [figures, setFigures] = createSignal<SheetFigures | null>(null);
  const [changed, setChanged] = createSignal(0);
  createEffect(() => { const sheet = model(); if (sheet) onCleanup(sheet.onChange(() => setChanged((n) => n + 1))); });
  createEffect(() => {
    changed();
    const sheet = model(), range = selection(), more = others();
    if (!sheet || !range || (!more.length && range.top === range.bottom && range.left === range.right)) return setFigures(null);
    const { rows, cols } = sheet.size(), areas = [...more, range].map((one) => ({ ...one, bottom: Math.min(one.bottom, rows - 1), right: Math.min(one.right, cols - 1) })), area = areas.at(-1)!;
    // The ranges before each that it overlaps: a cell in one of those is counted there.
    const before = areas.map((one, n) => areas.slice(0, n).filter((two) => two.top <= one.bottom && two.bottom >= one.top && two.left <= one.right && two.right >= one.left));
    let over = false;
    onCleanup(() => { over = true; });
    void (async () => {
      await yieldTask();
      if (over) return;
      const done: SheetFigures = { count: 0, numbers: 0, sum: 0, min: Infinity, max: -Infinity, range: area };
      let until = performance.now() + SLICE_MS;
      for (let n = 0; n < areas.length; n++) for (let r = areas[n]!.top, { bottom, left, right } = areas[n]!, over = before[n]!; r <= bottom; r++) {
        for (let c = left; c <= right; c++) {
          if (over.length && over.some((two) => r >= two.top && r <= two.bottom && c >= two.left && c <= two.right)) continue;
          const value = sheet.value(r, c);
          if (value === null || value === "") continue;
          done.count++;
          if (typeof value !== "number") continue;
          done.numbers++; done.sum += value;
          if (value < done.min) done.min = value;
          if (value > done.max) done.max = value;
        }
        if (performance.now() > until) { await yieldTask(); if (over) return; until = performance.now() + SLICE_MS; }
      }
      setFigures(done.count ? done : null);
    })();
  });
  return figures;
}
