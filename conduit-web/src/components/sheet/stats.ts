import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import type { SheetView } from "@/sheet-format.js";
import type { SheetRange } from "./host";

/** A selection's figures: `count` of cells with anything, the rest over its numbers only (none where it has no number). */
export type SheetFigures = { count: number; numbers: number; sum: number; min: number; max: number };

// Wait for the selection to rest (keys held, a drag) before reading any of it; then read in slices that leave the frame's budget (6.94 ms at 144 Hz) to the page.
const SETTLE_MS = 120, SLICE_MS = 3;
const yieldTask = () => new Promise<void>((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => resolve(); channel.port2.postMessage(null); });

/** The figures of the cells selected, read from the model's computed values off the per-key path; null for one cell or none. Whole rows or columns count only the tab's own cells. */
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
    onCleanup(() => { over = true; clearTimeout(wait); });
    const wait = setTimeout(async () => {
      const done: SheetFigures = { count: 0, numbers: 0, sum: 0, min: Infinity, max: -Infinity };
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
    }, SETTLE_MS);
  });
  return figures;
}
