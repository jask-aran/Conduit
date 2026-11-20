/*
 * Which cells of the shown tab hold anything, kept as one byte a cell a column, so Ctrl and an arrow and Ctrl+End jump without reading the
 * doc cell by cell (a 50,000-row column read so took 20 to 35 ms a press). Built from the doc's filled cells alone, kept as cells are typed, built
 * again only after rows, columns or the tab change.
 */
import type * as Y from "yjs";
import type { SheetView } from "@/sheet-format.js";

export type SheetFilled = { has(row: number, col: number): boolean; last(): { row: number; col: number } };

export function createFilled(cells: Y.Map<string>, model: SheetView): SheetFilled & { off(): void } {
  let cols: (Uint8Array | undefined)[] | null = null, rows = 0, last: { row: number; col: number } | null = null;
  // Built in idle slices after each change of rows, columns or tab (all of 150,000 cells at once is 30 ms), and finished at once by a jump that comes sooner.
  let making: { into: (Uint8Array | undefined)[]; rest: IterableIterator<[string, string]> } | null = null, idle = 0;
  const work = (until: () => boolean) => {
    if (!making) return;
    const { into, rest } = making;
    for (let n = 0; ; n++) {
      if ((n & 1023) === 0 && until()) return void (idle = requestIdleCallback((deadline) => work(() => deadline.timeRemaining() < 1)));
      const next = rest.next();
      if (next.done) break;
      const [cell, input] = next.value;
      if (!input) continue;
      const cut = cell.indexOf(":"), row = model.indexOfRow(cell.slice(0, cut));
      if (row < 0) continue;
      const col = model.indexOfCol(cell.slice(cut + 1));
      if (col >= 0) (into[col] ??= new Uint8Array(rows))[row] = 1;
    }
    cols = into; making = null;
  };
  const start = () => {
    cancelIdleCallback(idle);
    cols = null; last = null; rows = model.size().rows; making = { into: [], rest: cells.entries() };
    idle = requestIdleCallback((deadline) => work(() => deadline.timeRemaining() < 1));
  };
  const ready = () => { if (!cols && !making) start(); work(() => false); return cols!; };
  const off = model.onChange((change) => {
    if (change.structure) return start();
    if (!change.cells) return;
    last = null;
    const into = cols ?? making?.into;
    if (into) for (const { row, col } of change.cells) if (row < rows) (into[col] ??= new Uint8Array(rows))[row] = model.input(row, col) ? 1 : 0;
  });
  start();
  return {
    has: (row, col) => (cols ?? ready())[col]?.[row] === 1,
    // As a spreadsheet's last cell: the last row and the last column holding anything, each on its own.
    last: () => {
      if (last) return last;
      let row = 0, col = 0;
      ready().forEach((one, at) => { if (!one) return; const end = one.lastIndexOf(1); if (end >= 0) { col = at; row = Math.max(row, end); } });
      return last = { row, col };
    },
    off: () => { off(); cancelIdleCallback(idle); },
  };
}
