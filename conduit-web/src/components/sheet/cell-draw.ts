/*
 * How the grid draws a cell's style (styles.ts) and an import's frozen mark: its fill, ink, weight and size through the cell's theme, which the grid draws
 * itself; underlines, a line through, wrapped lines, top or bottom alignment and a format's fill (the `$` at the left of an accounting figure) drawn here
 * in its place; its edges and the mark over what it drew. A workbook's own colours are fitted to the theme (shade.ts). Part of the grid's island
 * (grid.ts), so it is loaded only with a sheet.
 */
import { getMiddleCenterBias, measureTextCached, type DrawCellCallback, type Theme } from "@glideapps/glide-data-grid";
import { SHEET_FILL } from "./formats";
import type { SheetInk } from "@/sheet-styles.js";
import type { SheetLook } from "./host";
import { shade } from "./shade";
import { PLAIN, textSize, type SheetCellStyle } from "./styles";
import { wrapLines } from "./wrap";

/** What the grid's own cells carry for this (grid.ts TextCell). */
/** `block`: a row of a merge over several rows, drawn here against the merge's box (grid.ts). */
export type StyledCell = { worn?: SheetCellStyle; frozen?: boolean; displayData?: string; contentAlign?: "left" | "right" | "center"; block?: unknown; pill?: SheetPill };
/** A dropdown cell's value as a pill in its option's ink (none: a plain wash); `known` false marks a value not among the options. One object for each, made once (sheet.tsx). */
export type SheetPill = { ink?: SheetInk; known: boolean };
// The grid's own measure of a line's height in a font: the box of these letters.
const EM = "ABCi09jgqpy";

export function createCellLook(look: SheetLook) {
  const [weight, size] = String(look.grid.baseFontStyle).split(" ") as [string, string];
  const ink = (colour: string, role: "text" | "fill", on?: string) => colour.startsWith("#") ? shade(colour, role === "text" && on?.startsWith("#") ? "over" : role) : look.palette[colour as keyof SheetLook["palette"]][role];
  // One theme for each style and ink, made once: the grid compares them by identity and merges each into its own as it draws.
  const themes = new Map<SheetCellStyle | undefined, Map<string, Partial<Theme> | undefined>>();
  const theme = (style?: SheetCellStyle, over = ""): Partial<Theme> | undefined => {
    let byInk = themes.get(style);
    if (!byInk) themes.set(style, byInk = new Map());
    if (byInk.has(over)) return byInk.get(over);
    const made: Partial<Theme> = {};
    if (style?.fill) made.bgCell = ink(style.fill, "fill");
    if (over || style?.color) made.textDark = over || ink(style!.color!, "text", style!.fill);
    if (style?.bold || style?.italic || style?.size) made.baseFontStyle = `${style.italic ? "italic " : ""}${style.bold ? look.strong : weight} ${textSize(size, style.size)}`;
    const out = Object.keys(made).length ? made : undefined;
    byInk.set(over, out);
    return out;
  };
  // The text as the grid would place it, then moved, broken, lined or spread to the cell's edges as the style and format say; the grid has already set its font and ink.
  const text = (args: Parameters<DrawCellCallback>[0], style: SheetCellStyle, cell: StyledCell) => {
    const { ctx, rect, theme: drawn } = args, padX = drawn.cellHorizontalPadding, padY = drawn.cellVerticalPadding, font = `${drawn.baseFontStyle} ${drawn.fontFamily}`, shown = cell.displayData!;
    const spread = shown.indexOf(SHEET_FILL), lines = spread < 0 && style.wrap ? wrapLines(ctx, shown, font, rect.width - 2 * padX) : [shown.split("\n", 1)[0]!];
    const box = measureTextCached(EM, ctx, font), em = box.actualBoundingBoxAscent + box.actualBoundingBoxDescent, step = drawn.lineHeight * em, tall = em + step * (lines.length - 1);
    const top = style.valign === "top" ? rect.y + padY : style.valign === "bottom" ? rect.y + rect.height - padY - tall : Math.max(rect.y + padY, rect.y + rect.height / 2 - tall / 2);
    const clip = spread >= 0 || tall + 2 * padY > rect.height, bias = getMiddleCenterBias(ctx, font);
    const at = (align: CanvasTextAlign) => align === "right" ? rect.x + rect.width - padX - 0.5 : align === "center" ? rect.x + rect.width / 2 : rect.x + padX + 0.5;
    if (clip) { ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip(); }
    lines.forEach((line, n) => {
      const middle = top + n * step + em / 2;
      // A fill's mark and the character it repeats (only space is drawn: as the gap) part the line into its left and right; where they would meet, it is one, at the right.
      const left = line.slice(0, spread), right = line.slice(spread + 2);
      const pieces: [string, CanvasTextAlign][] = spread < 0 ? [[line, cell.contentAlign ?? "left"]]
        : measureTextCached(left, ctx, font).width + measureTextCached(right, ctx, font).width > rect.width - 2 * padX ? [[`${left}${right}`.trim(), "right"]] : [[left, "left"], [right, "right"]];
      for (const [piece, align] of pieces) {
        const x = at(align);
        ctx.textAlign = align;
        ctx.fillText(piece, x, middle + bias);
        if (!style.underline && !style.strike) continue;
        const width = measureTextCached(piece, ctx, font).width, from = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
        if (style.underline) ctx.fillRect(from, Math.round(middle + em / 2), width, 1);
        if (style.strike) ctx.fillRect(from, Math.round(middle), width, 1);
      }
    });
    ctx.textAlign = "start";
    if (clip) ctx.restore();
  };
  // The value in a rounded wash of its ink, and the arrow that opens the options at the cell's right end; a value not among them in plain text, marked.
  const pill = (args: Parameters<DrawCellCallback>[0], cell: StyledCell, { ink, known }: SheetPill) => {
    const { ctx, rect, theme: drawn } = args, padX = drawn.cellHorizontalPadding, font = `${drawn.baseFontStyle} ${drawn.fontFamily}`, shown = cell.displayData ?? "";
    const box = measureTextCached(EM, ctx, font), em = box.actualBoundingBoxAscent + box.actualBoundingBoxDescent, middle = rect.y + rect.height / 2, arrow = Number(look.grid.headerIconSize) / 2;
    const room = rect.width - 3 * padX - arrow, ink0 = ctx.fillStyle;
    ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
    if (shown && known) {
      const tall = Math.min(rect.height - 2, em + 2 * drawn.cellVerticalPadding), wide = Math.min(room, measureTextCached(shown, ctx, font).width + padX);
      ctx.fillStyle = ink ? look.palette[ink].fill : look.mark;
      ctx.beginPath(); ctx.roundRect(rect.x + padX / 2, middle - tall / 2, wide + padX, tall, tall / 2); ctx.fill();
    }
    ctx.fillStyle = ink0;
    if (shown) { ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, padX + room, rect.height); ctx.clip(); ctx.fillText(shown, rect.x + padX + 0.5, middle + getMiddleCenterBias(ctx, font)); ctx.restore(); }
    const x = rect.x + rect.width - padX - arrow, y = middle - arrow / 4;
    ctx.fillStyle = String(look.grid.textMedium);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + arrow, y); ctx.lineTo(x + arrow / 2, y + arrow / 2); ctx.closePath(); ctx.fill();
    if (shown && !known) { ctx.fillStyle = look.error; ctx.beginPath(); ctx.moveTo(rect.x + 1, rect.y + 1); ctx.lineTo(rect.x + 1 + look.corner, rect.y + 1); ctx.lineTo(rect.x + 1, rect.y + 1 + look.corner); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = ink0;
  };
  const draw: DrawCellCallback = (args, content) => {
    const cell = args.cell as StyledCell, style = cell.worn, shown = cell.displayData;
    if (cell.pill) pill(args, cell, cell.pill);
    else if (shown && (style?.custom || cell.block || shown.includes(SHEET_FILL))) text(args, style ?? PLAIN, cell); else content();
    if (!style?.edges && !cell.frozen) return;
    // The grid keeps note of the ink it set for a column's text, so it is put back.
    const { ctx, rect: { x, y, width, height } } = args, was = ctx.fillStyle;
    if (style?.edges) {
      const w = style.edgeWeight;
      ctx.fillStyle = style.edgeColor ? shade(style.edgeColor, "edge") : look.edge;
      // The first row's top is under the column letters' line: its top edge is drawn just inside.
      if (style.edges & 1) ctx.fillRect(x, args.row === 0 ? y + 1 : y, width, w);
      if (style.edges & 2) ctx.fillRect(x + width - w, y, w, height);
      if (style.edges & 4) ctx.fillRect(x, y + height - w, width, w);
      if (style.edges & 8) ctx.fillRect(x, y, w, height);
    }
    if (cell.frozen) {
      ctx.fillStyle = look.warn;
      ctx.beginPath(); ctx.moveTo(x + width - 1 - look.corner, y + 1); ctx.lineTo(x + width - 1, y + 1); ctx.lineTo(x + width - 1, y + 1 + look.corner); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = was;
  };
  return { theme, draw };
}
