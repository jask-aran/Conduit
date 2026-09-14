import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";

export type InlineRowKind = "context" | "removed" | "added";

/** What one line of an inline comparison stands for. */
export interface InlineRow {
  kind: InlineRowKind;
  /** 1-based line in the original document, for context and removed rows. */
  original: number | null;
  /** 1-based line in the modified document, for context and added rows. */
  modified: number | null;
}

export interface InlineDiff {
  doc: string;
  rows: InlineRow[];
  added: number;
  removed: number;
  /** False when the diff fell back to fast, imprecise matching. */
  precise: boolean;
}

export interface InlineDiffConfig {
  scanLimit?: number;
  timeout?: number;
}

/**
 * Lays a comparison out as one document holding both sides: removed lines,
 * then the lines that replaced them, then the context around both. Because
 * every line is real text rather than a widget, a selection can run straight
 * through a change, the gutter can number both sides, and search and copy
 * reach the removed half the same as any other line.
 */
export function buildInlineDiff(original: string, modified: string, config?: InlineDiffConfig): InlineDiff {
  const a = Text.of(original.split("\n"));
  const b = Text.of(modified.split("\n"));
  const chunks = Chunk.build(a, b, config);
  const lines: string[] = [];
  const rows: InlineRow[] = [];
  let lineA = 1;
  let lineB = 1;
  const take = (doc: Text, number: number, kind: InlineRowKind, original: number | null, modified: number | null) => {
    lines.push(doc.line(number).text);
    rows.push({ kind, original, modified });
  };
  const lineNumberAt = (doc: Text, position: number) => doc.lineAt(Math.max(0, Math.min(position, doc.length))).number;
  for (const chunk of chunks) {
    const startA = lineNumberAt(a, chunk.fromA);
    const startB = lineNumberAt(b, chunk.fromB);
    while (lineB < startB && lineB <= b.lines) {
      take(b, lineB, "context", lineA, lineB);
      lineA++;
      lineB++;
    }
    lineA = startA;
    if (chunk.toA > chunk.fromA) {
      const endA = lineNumberAt(a, chunk.endA);
      for (let number = startA; number <= endA; number++) take(a, number, "removed", number, null);
      lineA = endA + 1;
    }
    if (chunk.toB > chunk.fromB) {
      const endB = lineNumberAt(b, chunk.endB);
      for (let number = startB; number <= endB; number++) take(b, number, "added", null, number);
      lineB = endB + 1;
    }
  }
  while (lineB <= b.lines) {
    take(b, lineB, "context", lineA, lineB);
    lineA++;
    lineB++;
  }
  return {
    doc: lines.join("\n"),
    rows,
    added: rows.reduce((count, row) => count + (row.kind === "added" ? 1 : 0), 0),
    removed: rows.reduce((count, row) => count + (row.kind === "removed" ? 1 : 0), 0),
    precise: chunks.every((chunk) => chunk.precise),
  };
}

/** The side a row belongs to, and its line number there. */
export function inlineRowSide(row: InlineRow): { side: "original" | "modified"; line: number } {
  return row.kind === "removed"
    ? { side: "original", line: row.original ?? 1 }
    : { side: "modified", line: row.modified ?? row.original ?? 1 };
}

/** The number the gutter shows for a row: each side counts in its own document. */
export function inlineRowNumber(row: InlineRow | undefined): string {
  if (!row) return "";
  return String(row.kind === "removed" ? row.original ?? "" : row.modified ?? "");
}

/** Finds the row standing for a line of one side, as a 1-based document line. */
export function inlineDocLine(rows: readonly InlineRow[], side: "original" | "modified", line: number): number | null {
  const index = rows.findIndex((row) => side === "original"
    ? row.kind !== "added" && row.original === line
    : row.kind !== "removed" && row.modified === line);
  return index < 0 ? null : index + 1;
}

/**
 * Runs of context long enough to be worth folding away, as 1-based inclusive
 * document lines, keeping `margin` lines of context on each side of a change.
 */
export function unchangedRuns(rows: readonly InlineRow[], options: { margin?: number; minSize?: number } = {}): { from: number; to: number }[] {
  const margin = options.margin ?? 3;
  const minSize = options.minSize ?? 8;
  const runs: { from: number; to: number }[] = [];
  let start = 0;
  for (let index = 0; index <= rows.length; index++) {
    if (index < rows.length && rows[index]!.kind === "context") {
      if (!start) start = index + 1;
      continue;
    }
    if (start) {
      const head = start === 1 ? start : start + margin;
      const tail = index === rows.length ? index : index - margin;
      if (tail - head + 1 >= minSize) runs.push({ from: head, to: tail });
      start = 0;
    }
  }
  return runs;
}
