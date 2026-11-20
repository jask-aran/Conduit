/*
 * Row and column groups, as Excel's outline: `outline:<lineId>` in the look is a row's or column's level, 1 to 7 (sheet.json and xlsx see `outline:5`,
 * `outline:C`), so a group follows its lines through inserts, moves and sorts. A collapsed group's lines are hidden (`hidden:<id>`). A group's control
 * stands on the line after its last, as Excel's summary row below and column right; a group running to the tab's edge has it on the line before its first.
 */
import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js";
import type * as Y from "yjs";
import type { SheetView } from "@/sheet-format.js";

export const OUTLINE_LEVELS = 7;
export type OutlineKind = "rows" | "cols";
/** A line as the headers draw it: its level, and whether a group's control stands on it (`open` or `shut`). */
export type OutlineLine = { level: number; control?: "open" | "shut" };
const PLAIN: OutlineLine = { level: 0 };

export function createSheetOutline(look: Y.Map<number | string>, model: Accessor<SheetView | undefined>) {
  const levels = new Map<string, number>(), [changed, setChanged] = createSignal(0), tails = new Map<OutlineKind, { key: string; at: number }>();
  let version = 0;
  const index = (name: string) => { if (!name.startsWith("outline:")) return false; const value = look.get(name); if (typeof value === "number" && value > 0) levels.set(name.slice(8), value); else levels.delete(name.slice(8)); return true; };
  for (const name of look.keys()) index(name);
  const observe = (event: Y.YMapEvent<number | string>) => { let any = false; for (const name of event.keysChanged) any = index(name) || any; if (any) { version++; setChanged((n) => n + 1); } };
  look.observe(observe);
  onCleanup(() => look.unobserve(observe));
  // Rows or columns moved keep the tab's size and maybe its last line, but not which lines are grouped where.
  createEffect(() => { const off = model()?.onChange((change) => { if (change.structure) version++; }); if (off) onCleanup(off); });
  const id = (kind: OutlineKind, n: number) => n < 0 ? undefined : kind === "rows" ? model()?.rowAt(n) : model()?.colAt(n);
  const level = (kind: OutlineKind, n: number) => { const one = id(kind, n); return one ? levels.get(one) ?? 0 : 0; };
  const size = (kind: OutlineKind) => { const sheet = model(); return sheet ? sheet.size()[kind] : 0; };
  /** The group whose control stands on line `n`, from its first line to its last. */
  const groupAt = (kind: OutlineKind, n: number) => {
    const here = level(kind, n), last = size(kind) - 1;
    if (level(kind, n - 1) > here) { let from = n - 1; while (from > 0 && level(kind, from - 1) > here) from--; return { from, to: n - 1 }; }
    if (n < last && level(kind, n + 1) > here) { let to = n + 1; while (to < last && level(kind, to + 1) > here) to++; if (to === last) return { from: n + 1, to }; }
    return null;
  };
  /** The first line of the grouped run that reaches the tab's last line (its size where none does), worked out once a change. */
  const tail = (kind: OutlineKind) => {
    const last = size(kind) - 1, key = `${version}:${last}:${id(kind, last)}`, kept = tails.get(kind);
    if (kept?.key === key) return kept.at;
    let at = last + 1;
    while (at > 0 && level(kind, at - 1) > 0) at--;
    tails.set(kind, { key, at });
    return at;
  };
  const hidden = (kind: OutlineKind, n: number) => { const one = id(kind, n); return one !== undefined && look.has(`hidden:${one}`); };
  return {
    changed,
    /** Read as the headers draw, so it is a map read or two; nothing scans the tab. */
    line(kind: OutlineKind, n: number): OutlineLine {
      if (!levels.size) return PLAIN;
      const own = level(kind, n), before = level(kind, n - 1);
      if (before > own) return { level: own, control: hidden(kind, n - 1) ? "shut" : "open" };
      // At the edge only: the outermost group after it runs to the tab's last line.
      if (!own && n + 1 === tail(kind) && n + 1 < size(kind)) return { level: own, control: hidden(kind, n + 1) ? "shut" : "open" };
      return own ? { level: own } : PLAIN;
    },
    /** The lines from `from` to `to` one level deeper (`by` 1) or shallower (-1), in the caller's transaction. */
    group(kind: OutlineKind, from: number, to: number, by: 1 | -1) {
      for (let n = from; n <= to; n++) {
        const one = id(kind, n);
        if (!one) continue;
        const next = Math.max(0, Math.min(OUTLINE_LEVELS, (levels.get(one) ?? 0) + by));
        if (next) look.set(`outline:${one}`, next); else look.delete(`outline:${one}`);
      }
    },
    /** The control of the innermost group line `n` is in, or the one standing on it: its line, and whether it is shut. */
    around(kind: OutlineKind, n: number): { line: number; shut: boolean } | undefined {
      const own = level(kind, n), last = size(kind) - 1;
      if (!own) { const here = this.line(kind, n).control; return here ? { line: n, shut: here === "shut" } : undefined; }
      let to = n, from = n;
      while (to < last && level(kind, to + 1) >= own) to++;
      while (from > 0 && level(kind, from - 1) >= own) from--;
      const at = to < last ? to + 1 : from - 1;
      return at >= 0 ? { line: at, shut: hidden(kind, n) } : undefined;
    },
    /** The group whose control is on line `n` collapsed (its lines hidden) or, collapsed, shown again; false where none is there. In the caller's transaction. */
    toggle(kind: OutlineKind, n: number) {
      const group = groupAt(kind, n);
      if (!group) return false;
      let shut = true;
      for (let at = group.from; at <= group.to && shut; at++) shut = hidden(kind, at);
      for (let at = group.from; at <= group.to; at++) { const one = id(kind, at); if (one) { if (shut) look.delete(`hidden:${one}`); else look.set(`hidden:${one}`, 1); } }
      return true;
    },
  };
}
export type SheetOutline = ReturnType<typeof createSheetOutline>;
