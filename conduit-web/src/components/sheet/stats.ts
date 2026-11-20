import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import type { SheetView } from "@/sheet-format.js";
import type { SheetRange } from "./host";

/** A selection's figures: `count` of cells with anything, the rest over its numbers only (none where it has no number), and the cells they are of. */
export type SheetFigures = { count: number; numbers: number; sum: number; min: number; max: number; range: SheetRange };

// Read in a task of its own, never the selection's, in slices that leave the frame's budget (6.94 ms at 144 Hz) to the page; a new selection drops it.
const SLICE_MS = 3;
const yieldTask = () => new Promise<void>((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => resolve(); channel.port2.postMessage(null); });

/** The figures of the cells selected, read from the model's computed values off the selection's task; null for one cell or none. Whole rows or columns count only the tab's own cells. */
export function createFigures(model: Accessor<SheetView | undefined>, selection: Accessor<SheetRange | null>): Accessor<SheetFigures | null> {
  const [figures, setFigures] = createSignal<SheetFigures | null>(null);
  const [changed, setChanged] = createSignal(0);
  createEffect(() => { const sheet = model(); if (sheet) onCleanup(sheet.onChange(() => setChanged((n) => n + 1))); });
  createEffect(() => {
    changed();
    const sheet = model(), range = selection();
    if (!sheet || !range || (range.top === range.bottom && range.left === range.right)) return setFigures(null);
    const { rows, cols } = sheet.size(), area = { ...range, bottom: Math.min(range.bottom, rows - 1), right: Math.min(range.right, cols - 1) };
    let over = false;
    onCleanup(() => { over = true; });
    void (async () => {
      await yieldTask();
      if (over) return;
      const done: SheetFigures = { count: 0, numbers: 0, sum: 0, min: Infinity, max: -Infinity, range: area };
      let until = performance.now() + SLICE_MS;
      for (let r = area.top; r <= area.bottom; r++) {
        for (let c = area.left; c <= area.right; c++) {
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
