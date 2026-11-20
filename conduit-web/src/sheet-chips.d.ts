import type * as Y from "yjs";
import type { FormatSheet } from "./sheet-formats.js";

export const CHIP: "chip:";
export type SheetArtifactType = "paper" | "sheet" | "site" | "markdown";
/** What a cell is shown as. A link's `url` is written as the cell's own link and not kept in the chip. */
export type SheetChip =
  | { kind: "link"; title?: string; url?: string }
  | { kind: "person"; id: string; name: string; role?: string }
  | { kind: "artifact"; id: string; name: string; type?: SheetArtifactType }
  | { kind: "date" };
export function cleanChip(chip: unknown): SheetChip | null;
export function readChip(text: unknown): SheetChip | null;
export function hostOf(url: string): string;
export function writeChip(look: Y.Map<unknown>, cells: Y.Map<string>, sheet: FormatSheet, row: number, col: number, chip: SheetChip | null): void;
export function clearChips(look: Y.Map<unknown>, ids: Iterable<string>): void;
export function copyChips(look: Y.Map<unknown>, sheet: FormatSheet, pairs: Iterable<readonly [number, number, number, number]>): void;
/** POST /v0/document/:id/cells `{ op: "chip", at, chip, tab? }`: the cell `at` (A1) shown as `chip`, or plain again with `chip: null`. */
export type SheetChipOp = { op: "chip"; at: string; chip: SheetChip | null; tab?: string };
