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
import { drawIcon, iconSize, type SheetBar } from "./scales";
import { PLAIN, textSize, type SheetCellStyle } from "./styles";
import { wrapLines } from "./wrap";

/** What the grid's own cells carry for this (grid.ts TextCell). */
/** `block`: a row of a merge over several rows, drawn here against the merge's box (grid.ts). */
/** `arrow`: a date cell's, at its right end, which opens its calendar; `mark`: a filter's caret there (grid.ts). The text keeps clear of either. */
export type StyledCell = { worn?: SheetCellStyle; frozen?: boolean; displayData?: string; contentAlign?: "left" | "right" | "center"; block?: unknown; pill?: SheetPill; spill?: SheetSpill; link?: string; arrow?: boolean; mark?: number };
/** Text running on into an empty cell from a filled one `offset` pixels to its left, in that cell's font and ink (none: the grid's). */
export type SheetSpill = { text: string; offset: number; font?: string; ink?: string };
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
    // A workbook's face where the device has it, else the sheet's own.
    if (style?.face) made.fontFamily = `"${style.face}", ${look.grid.fontFamily}`;
    const out = Object.keys(made).length ? made : undefined;
    byInk.set(over, out);
    return out;
  };
  // The text as the grid would place it, then moved, broken, lined or spread to the cell's edges as the style and format say; the grid has already set its font and ink.
  // Turned text, about the cell's middle: stacked (255) letter under letter, else at its angle; clipped to the cell.
  const turned = (args: Parameters<DrawCellCallback>[0], style: SheetCellStyle, shown: string) => {
    const { ctx, rect, theme: drawn } = args, font = `${drawn.baseFontStyle} ${drawn.fontFamily}`, box = measureTextCached(EM, ctx, font), em = box.actualBoundingBoxAscent + box.actualBoundingBoxDescent;
    ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
    ctx.textAlign = "center";
    if (style.rotate === 255) { const step = em * drawn.lineHeight, top = rect.y + rect.height / 2 - (step * (shown.length - 1)) / 2; [...shown].forEach((letter, n) => ctx.fillText(letter, rect.x + rect.width / 2, top + n * step)); }
    else { ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2); ctx.rotate(-style.rotate! * Math.PI / 180); ctx.fillText(shown.split("\n", 1)[0]!, 0, getMiddleCenterBias(ctx, font)); }
    ctx.restore(); ctx.textAlign = "start";
  };
  const text = (args: Parameters<DrawCellCallback>[0], style: SheetCellStyle, cell: StyledCell) => {
    if (style.rotate) return turned(args, style, cell.displayData!);
    const { ctx, rect: whole, theme: drawn } = args, padX = drawn.cellHorizontalPadding, padY = drawn.cellVerticalPadding, shown0 = cell.displayData!;
    // An indent level is three of the font's spaces wide (Excel's), from the side the text is aligned to; shrink to fit draws the text smaller until it fits.
    let font = `${drawn.baseFontStyle} ${drawn.fontFamily}`, shown = shown0;
    const was = ctx.font;
    // A kept rule's icon stands at the cell's left, the text in the room past it.
    const indent = style.indent ? style.indent * 3 * measureTextCached(" ", ctx, font).width : 0, right = cell.contentAlign === "right", room = style.icon ? iconSize(whole.height) + padX : 0;
    const rect = indent || room ? { ...whole, x: whole.x + room + (right ? 0 : indent), width: whole.width - indent - room } : whole;
    if (style.shrink && !style.wrap) { const room = rect.width - 2 * padX, wide = measureTextCached(shown, ctx, font).width; if (wide > room && room > 0) { font = font.replace(/([\d.]+)px/, (_, px: string) => `${Math.max(1, Math.floor(Number(px) * room / wide * 10) / 10)}px`); ctx.font = font; } }
    // Excel's Fill repeats the text across the cell as many whole times as fit.
    if (style.repeat && shown) { const one = measureTextCached(shown, ctx, font).width; if (one > 0) shown = shown.repeat(Math.max(1, Math.floor((rect.width - 2 * padX) / one))); }
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
        if (!style.underline && !style.double && !style.strike && !cell.link) continue;
        const width = measureTextCached(piece, ctx, font).width, from = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
        if (style.underline || style.double) ctx.fillRect(from, Math.round(middle + em / 2), width, 1);
        if (style.double) ctx.fillRect(from, Math.round(middle + em / 2) + 2, width, 1);
        // A link is the text colour with a muted underline.
        else if (cell.link) { const ink = ctx.fillStyle; ctx.fillStyle = String(look.grid.textMedium); ctx.fillRect(from, Math.round(middle + em / 2), width, 1); ctx.fillStyle = ink; }
        if (style.strike) ctx.fillRect(from, Math.round(middle), width, 1);
      }
    });
    ctx.textAlign = "start";
    if (clip) ctx.restore();
    ctx.font = was;
  };
  // The arrow at a cell's right end that opens its options or calendar.
  const drawArrow = (ctx: CanvasRenderingContext2D, rect: { x: number; y: number; width: number; height: number }, padX: number) => {
    const arrow = Number(look.grid.headerIconSize) / 2, x = rect.x + rect.width - padX - arrow, y = rect.y + rect.height / 2 - arrow / 4, was = ctx.fillStyle;
    ctx.fillStyle = String(look.grid.textMedium);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + arrow, y); ctx.lineTo(x + arrow / 2, y + arrow / 2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = was;
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
    drawArrow(ctx, rect, padX);
    if (shown && !known) { ctx.fillStyle = look.error; ctx.beginPath(); ctx.moveTo(rect.x + 1, rect.y + 1); ctx.lineTo(rect.x + 1 + look.corner, rect.y + 1); ctx.lineTo(rect.x + 1, rect.y + 1 + look.corner); ctx.closePath(); ctx.fill(); }
    ctx.restore();
    ctx.fillStyle = ink0;
  };
  const spill = (args: Parameters<DrawCellCallback>[0], { text, offset, font: own, ink }: SheetSpill) => {
    const { ctx, rect, theme: drawn } = args, padX = drawn.cellHorizontalPadding, font = `${own ?? drawn.baseFontStyle} ${drawn.fontFamily}`, was = [ctx.font, ctx.fillStyle] as const;
    // Measured in its own font: the cache's font is only its key.
    ctx.font = font;
    if (measureTextCached(text, ctx, font).width + padX <= offset) { ctx.font = was[0]; return; }
    ctx.save(); ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.width, rect.height); ctx.clip();
    ctx.fillStyle = ink ?? drawn.textDark;
    ctx.fillText(text, rect.x - offset + padX + 0.5, rect.y + rect.height / 2 + getMiddleCenterBias(ctx, font));
    ctx.restore();
    [ctx.font, ctx.fillStyle] = was;
  };
  // A data bar from the cell's left, under its text: Excel 2007's fades to the right.
  const bar = ({ ctx, rect }: Parameters<DrawCellCallback>[0], { share, ink, solid }: SheetBar) => {
    const was = ctx.fillStyle, x = rect.x + 2, y = rect.y + 2, wide = Math.max(0, (rect.width - 4) * share), tall = Math.max(0, rect.height - 5);
    if (solid) ctx.fillStyle = ink;
    else { const fade = ctx.createLinearGradient(x, 0, x + wide, 0); fade.addColorStop(0, ink); fade.addColorStop(1, `${ink}26`); ctx.fillStyle = fade; }
    ctx.fillRect(x, y, wide, tall);
    ctx.fillStyle = was;
  };
  const draw: DrawCellCallback = (args, content) => {
    const cell = args.cell as StyledCell, style = cell.worn, shown = style?.bare ? "" : cell.displayData;
    if (style?.bar) bar(args, style.bar);
    if (style?.icon) drawIcon(args.ctx, args.rect, style.icon, args.theme.cellHorizontalPadding);
    // A date's arrow or a filter's caret at the right end: the text is drawn in the room left of it.
    const end = cell.arrow || cell.mark ? Number(look.grid.headerIconSize) / 2 + args.theme.cellHorizontalPadding : 0;
    if (cell.pill) pill(args, cell, cell.pill);
    else if (shown && end && cell.contentAlign === "right") text({ ...args, rect: { ...args.rect, width: args.rect.width - end } }, style ?? PLAIN, cell);
    else if (shown && (style?.custom || cell.block || cell.link || shown.includes(SHEET_FILL))) text(args, style ?? PLAIN, cell); else if (!style?.bare) content();
    if (cell.arrow) drawArrow(args.ctx, args.rect, args.theme.cellHorizontalPadding);
    if (cell.spill) spill(args, cell.spill);
    if (!style?.edges && !cell.frozen && !style?.diagonal) return;
    // The grid keeps note of the ink it set for a column's text, so it is put back.
    const { ctx, rect: { x, y, width, height } } = args, was = ctx.fillStyle;
    if (style?.edges) {
      const w = style.edgeWeight;
      ctx.fillStyle = style.edgeColor ? shade(style.edgeColor, "edge") : look.edge;
      // The first row's top is under the column letters' line: its top edge is drawn just inside.
      // A dashed or dotted edge in runs of its line; a double one as two lines a pixel apart.
      const line = style.edgeLine, run = line === "dotted" ? 1 : 3, rule = (left: number, top: number, wide: number, tall: number) => {
        if (line === "double") { if (wide > tall) { ctx.fillRect(left, top, wide, 1); ctx.fillRect(left, top + tall - 1, wide, 1); } else { ctx.fillRect(left, top, 1, tall); ctx.fillRect(left + wide - 1, top, 1, tall); } return; }
        if (!line) return ctx.fillRect(left, top, wide, tall);
        const along = wide > tall;
        for (let at = 0, end = along ? wide : tall; at < end; at += 2 * run) along ? ctx.fillRect(left + at, top, Math.min(run, end - at), tall) : ctx.fillRect(left, top + at, wide, Math.min(run, end - at));
      };
      if (style.edges & 1) rule(x, args.row === 0 ? y + 1 : y, width, w);
      if (style.edges & 2) rule(x + width - w, y, w, height);
      if (style.edges & 4) rule(x, y + height - w, width, w);
      if (style.edges & 8) rule(x, y, w, height);
    }
    if (style?.diagonal) {
      ctx.strokeStyle = style.edgeColor ? shade(style.edgeColor, "edge") : look.edge; ctx.lineWidth = 1; ctx.beginPath();
      if (style.diagonal !== "up") { ctx.moveTo(x, y); ctx.lineTo(x + width, y + height); }
      if (style.diagonal !== "down") { ctx.moveTo(x, y + height); ctx.lineTo(x + width, y); }
      ctx.stroke();
    }
    if (cell.frozen) {
      ctx.fillStyle = look.warn;
      ctx.beginPath(); ctx.moveTo(x + width - 1 - look.corner, y + 1); ctx.lineTo(x + width - 1, y + 1); ctx.lineTo(x + width - 1, y + 1 + look.corner); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = was;
  };
  return { theme, draw };
}
