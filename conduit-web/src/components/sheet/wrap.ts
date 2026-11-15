/*
 * A wrapped cell's lines: its text broken at spaces (a word longer than the line at its letters) to the width it has, in its font. One function for
 * the grid, which draws them (cell-draw.ts), and for fitting a row (sizes.ts), which counts them, so the two never disagree.
 */
const KEPT = 4_000;
let kept = new Map<string, readonly string[]>();

/** `measure`: a canvas context already set to the cell's font, named by `font` (the cache's key). */
export function wrapLines(measure: CanvasRenderingContext2D, text: string, font: string, width: number): readonly string[] {
  const named = `${font}\u0000${Math.floor(width)}\u0000${text}`, had = kept.get(named);
  if (had) return had;
  const lines: string[] = [], fits = (line: string) => measure.measureText(line).width <= width;
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (fits(next) || !line && !word) { line = next; continue; }
      if (line) lines.push(line);
      // A word wider than the line is cut where it runs out.
      line = word;
      while (line.length > 1 && !fits(line)) {
        let cut = line.length - 1;
        while (cut > 1 && !fits(line.slice(0, cut))) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    lines.push(line);
  }
  if (kept.size >= KEPT) kept = new Map();
  kept.set(named, lines);
  return lines;
}
