/*
 * How the grid draws a cell's style (styles.ts) and an import's frozen mark: its fill, ink and weight through the cell's theme, which the grid draws
 * itself; underlines, a line through, wrapped lines and top or bottom alignment drawn here in its place; its edges and the mark over what it drew.
 * Part of the grid's island (grid.ts), so it is loaded only with a sheet.
 */
import { getMiddleCenterBias, measureTextCached, type DrawCellCallback, type Theme } from "@glideapps/glide-data-grid";
import type { SheetLook } from "./host";
import type { SheetCellStyle } from "./styles";
import { wrapLines } from "./wrap";

/** What the grid's own cells carry for this (grid.ts TextCell). */
export type StyledCell = { worn?: SheetCellStyle; frozen?: boolean; displayData?: string; contentAlign?: "left" | "right" | "center" };
// The grid's own measure of a line's height in a font: the box of these letters.
const EM = "ABCi09jgqpy";

export function createCellLook(look: SheetLook) {
  const [weight, size] = String(look.grid.baseFontStyle).split(" ");
  // One theme for each style and ink, made once: the grid compares them by identity and merges each into its own as it draws.
  const themes = new Map<SheetCellStyle | undefined, Map<string, Partial<Theme> | undefined>>();
  const theme = (style?: SheetCellStyle, ink = ""): Partial<Theme> | undefined => {
    let byInk = themes.get(style);
    if (!byInk) themes.set(style, byInk = new Map());
    if (byInk.has(ink)) return byInk.get(ink);
    const made: Partial<Theme> = {};
    if (style?.fill) made.bgCell = look.palette[style.fill].fill;
    if (ink || style?.color) made.textDark = ink || look.palette[style!.color!].text;
    if (style?.bold || style?.italic) made.baseFontStyle = `${style.italic ? "italic " : ""}${style.bold ? look.strong : weight} ${size}`;
    const out = Object.keys(made).length ? made : undefined;
    byInk.set(ink, out);
    return out;
  };
  // The text as the grid would place it, then moved, broken or lined as the style says; the grid has already set its font and ink.
  const text = (args: Parameters<DrawCellCallback>[0], style: SheetCellStyle, cell: StyledCell) => {
    const { ctx, rect, theme: drawn } = args, padX = drawn.cellHorizontalPadding, padY = drawn.cellVerticalPadding, font = `${drawn.baseFontStyle} ${drawn.fontFamily}`;
    const lines = style.wrap ? wrapLines(ctx, cell.displayData!, font, rect.width - 2 * padX) : [cell.displayData!.split("\n", 1)[0]!];
    const box = measureTextCached(EM, ctx, font), em = box.actualBoundingBoxAscent + box.actualBoundingBoxDescent, step = drawn.lineHeight * em, tall = em + step * (lines.length - 1);
    const top = style.valign === "top" ? rect.y + padY : style.valign === "bottom" ? rect.y + rect.height - padY - tall : Math.max(rect.y + padY, rect.y + rect.height / 2 - tall / 2);
    const clip = tall + 2 * padY > rect.height, align = cell.contentAlign ?? "left", bias = getMiddleCenterBias(ctx, font);
    const x = align === "right" ? rect.x + rect.width - padX - 0.5 : align === "center" ? rect.x + rect.width / 2 : rect.x + padX + 0.5;
    if (clip) { ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip(); }
    ctx.textAlign = align;
    lines.forEach((line, n) => {
      const middle = top + n * step + em / 2;
      ctx.fillText(line, x, middle + bias);
      if (!style.underline && !style.strike) return;
      const width = measureTextCached(line, ctx, font).width, from = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
      if (style.underline) ctx.fillRect(from, Math.round(middle + em / 2), width, 1);
      if (style.strike) ctx.fillRect(from, Math.round(middle), width, 1);
    });
    ctx.textAlign = "start";
    if (clip) ctx.restore();
  };
  const draw: DrawCellCallback = (args, content) => {
    const cell = args.cell as StyledCell, style = cell.worn;
    if (style?.custom && cell.displayData) text(args, style, cell); else content();
    if (!style?.edges && !cell.frozen) return;
    // The grid keeps note of the ink it set for a column's text, so it is put back.
    const { ctx, rect: { x, y, width, height } } = args, ink = ctx.fillStyle;
    if (style?.edges) {
      ctx.fillStyle = look.edge;
      if (style.edges & 1) ctx.fillRect(x, y, width, 1);
      if (style.edges & 2) ctx.fillRect(x + width - 1, y, 1, height);
      if (style.edges & 4) ctx.fillRect(x, y + height - 1, width, 1);
      if (style.edges & 8) ctx.fillRect(x, y, 1, height);
    }
    if (cell.frozen) {
      ctx.fillStyle = look.warn;
      ctx.beginPath(); ctx.moveTo(x + width - 1 - look.corner, y + 1); ctx.lineTo(x + width - 1, y + 1); ctx.lineTo(x + width - 1, y + 1 + look.corner); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = ink;
  };
  return { theme, draw };
}
