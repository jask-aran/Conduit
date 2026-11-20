/*
 * The conditional formats an import keeps (`rulesKept:<tabId>`, xlsx-styles.js `sheetRules`) drawn as Excel draws them: colour scales, data bars, icon sets,
 * top and bottom N, above and below average, duplicate and unique values. Each rule's figures over its ranges (lowest, highest, thresholds, the Nth value,
 * the average, the repeated values) are read once a change of the sheet, as the first cell it covers is drawn (rules.tsx keeps each cell's result).
 */
import { valueText, type Range, type SheetView } from "@/sheet-format.js";
import { ruleAreas } from "@/sheet-rules.js";
import { decodeStyle, type SheetHex, type StyleAttrs } from "@/sheet-styles.js";

/** A data bar: its length as a share of the cell's room, its colour, and whether it is solid (Excel 2007's fades). */
export type SheetBar = { share: number; ink: SheetHex; solid: boolean };
/** An icon set's name (Excel's, `3Arrows`…) and which of its icons, 0 the lowest. */
export type SheetIcon = { set: string; at: number };
/** What a kept rule lays over a cell: a fill, a bar, an icon, its value hidden, or its dxf (as a drawn rule's style) and number format. */
export type KeptMark = { fill?: SheetHex; bar?: SheetBar; icon?: SheetIcon; bare?: boolean; attrs?: StyleAttrs; fmt?: string };

type Kept = { ranges: [string, string][]; xml: string; colors?: string[]; style?: string; fmt?: string; dxf?: string };
type Cfvo = { type: string; val: number; gte: boolean };
type Figures = { nums: number[]; low: number; high: number; mean: number; sd: number; counts: Map<string, number> };
type Rule = { areas: Range[] | null; figures: Figures | null; test(value: unknown, figures: Figures): KeptMark | undefined };

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
const yes = (tag: string, name: string, or: boolean) => { const said = attr(tag, name); return said === undefined ? or : said === "1" || said === "true"; };
const hexOf = (tag: string) => { const rgb = attr(tag, "rgb"); return rgb && /^[0-9a-f]{6,8}$/i.test(rgb) ? `#${rgb.slice(-6).toLowerCase()}` : "#000000"; };
// PERCENTILE.INC over sorted figures.
const percentile = (sorted: number[], p: number) => { if (!sorted.length) return NaN; const at = (sorted.length - 1) * Math.min(1, Math.max(0, p)), low = Math.floor(at); return sorted[low]! + (sorted[Math.min(low + 1, sorted.length - 1)]! - sorted[low]!) * (at - low); };
const point = (cfvo: Cfvo, f: Figures, sorted: () => number[]) => {
  switch (cfvo.type) {
    case "min": case "autoMin": return cfvo.type === "autoMin" ? Math.min(0, f.low) : f.low;
    case "max": case "autoMax": return cfvo.type === "autoMax" ? Math.max(0, f.high) : f.high;
    case "percent": return f.low + (f.high - f.low) * cfvo.val / 100;
    case "percentile": return percentile(sorted(), cfvo.val / 100);
    default: return cfvo.val;
  }
};
const mix = (one: string, two: string, share: number) => `#${[1, 3, 5].map((at) => Math.round(parseInt(one.slice(at, at + 2), 16) * (1 - share) + parseInt(two.slice(at, at + 2), 16) * share).toString(16).padStart(2, "0")).join("")}` as SheetHex;

// An import before kept rules carried their style: its dxf read here, by its plain colours (a theme's are the hub's to resolve).
const dxfMark = (dxf: string): KeptMark => {
  const font = /<font\b[\s\S]*?<\/font>/.exec(dxf)?.[0] ?? "", fill = /<fill\b[\s\S]*?<\/fill>/.exec(dxf)?.[0] ?? "", ink = /<color\b[^>]*rgb="[^"]*"[^>]*>/.exec(font)?.[0];
  const ground = /<(?:bgColor|fgColor)\b[^>]*rgb="[^"]*"[^>]*>/.exec(fill)?.[0], fmt = /<numFmt\b[^>]*>/.exec(dxf)?.[0];
  const attrs: StyleAttrs = { ...(/<b\b(?![^>]*val="(?:0|false)")/.test(font) ? { b: true } : {}), ...(/<i\b(?![^>]*val="(?:0|false)")/.test(font) ? { i: true } : {}), ...(ink ? { c: hexOf(ink) as SheetHex } : {}), ...(ground ? { f: hexOf(ground) as SheetHex } : {}) };
  return { attrs, ...(fmt && attr(fmt, "formatCode") ? { fmt: attr(fmt, "formatCode")!.replace(/&quot;/g, '"').replace(/&amp;/g, "&") } : {}) };
};

function compile(one: Kept): Rule["test"] | null {
  const head = /^<cfRule\b[^>]*>/.exec(one.xml)?.[0] ?? "", type = attr(head, "type");
  const cfvos: Cfvo[] = (one.xml.match(/<cfvo\b[^>]*>/g) ?? []).map((tag) => ({ type: attr(tag, "type") ?? "num", val: Number(attr(tag, "val") ?? 0), gte: yes(tag, "gte", true) }));
  const inks = (one.colors ?? (one.xml.match(/<color\b[^>]*>/g) ?? []).map(hexOf)) as SheetHex[];
  const marked: KeptMark | undefined = one.style !== undefined ? { attrs: decodeStyle(one.style), ...(one.fmt ? { fmt: one.fmt } : {}) } : one.dxf ? dxfMark(one.dxf) : undefined;
  // Sorted once a rule's figures are read, only where a percentile asks for it.
  let sorted: number[] | null = null, from: Figures | null = null;
  const sort = (f: Figures) => () => { if (from !== f) { from = f; sorted = [...f.nums].sort((a, b) => a - b); } return sorted!; };
  if (type === "colorScale" && cfvos.length >= 2 && inks.length >= cfvos.length) return (value, f) => {
    if (typeof value !== "number") return undefined;
    const at = cfvos.map((cfvo) => point(cfvo, f, sort(f)));
    if (value <= at[0]!) return { fill: inks[0] };
    for (let n = 1; n < at.length; n++) if (value <= at[n]!) return { fill: mix(inks[n - 1]!, inks[n]!, at[n]! > at[n - 1]! ? (value - at[n - 1]!) / (at[n]! - at[n - 1]!) : 1) };
    return { fill: inks[at.length - 1] };
  };
  if (type === "dataBar" && cfvos.length >= 2) {
    const bar = /<dataBar\b[^>]*>/.exec(one.xml)?.[0] ?? "", shortest = Number(attr(bar, "minLength") ?? 10) / 100, longest = Number(attr(bar, "maxLength") ?? 90) / 100, bare = !yes(bar, "showValue", true);
    // Excel 2010's solid bars say so in the sheet's extension list, which is not kept: a kept bar is Excel 2007's gradient.
    return (value, f) => {
      if (typeof value !== "number") return undefined;
      const low = point(cfvos[0]!, f, sort(f)), high = point(cfvos[1]!, f, sort(f)), share = high > low ? Math.min(1, Math.max(0, (value - low) / (high - low))) : 1;
      return { bar: { share: shortest + (longest - shortest) * share, ink: inks[0] ?? "#638ec6", solid: false }, ...(bare ? { bare } : {}) };
    };
  }
  if (type === "iconSet" && cfvos.length >= 2) {
    const tag = /<iconSet\b[^>]*>/.exec(one.xml)?.[0] ?? "", set = attr(tag, "iconSet") ?? "3TrafficLights1", reverse = yes(tag, "reverse", false), bare = !yes(tag, "showValue", true);
    return (value, f) => {
      if (typeof value !== "number") return undefined;
      let at = 0;
      for (let n = 1; n < cfvos.length; n++) { const edge = point(cfvos[n]!, f, sort(f)); if (cfvos[n]!.gte ? value >= edge : value > edge) at = n; }
      return { icon: { set, at: reverse ? cfvos.length - 1 - at : at }, ...(bare ? { bare } : {}) };
    };
  }
  if (!marked) return null;
  if (type === "top10") {
    const rank = Number(attr(head, "rank") ?? 10), percent = yes(head, "percent", false), bottom = yes(head, "bottom", false);
    return (value, f) => {
      if (typeof value !== "number" || !f.nums.length) return undefined;
      const count = Math.max(1, percent ? Math.floor(f.nums.length * rank / 100) : rank), list = sort(f)(), edge = bottom ? list[Math.min(count, list.length) - 1]! : list[Math.max(0, list.length - count)]!;
      return (bottom ? value <= edge : value >= edge) ? marked : undefined;
    };
  }
  if (type === "aboveAverage") {
    const above = yes(head, "aboveAverage", true), equal = yes(head, "equalAverage", false), spread = Number(attr(head, "stdDev") ?? 0);
    return (value, f) => {
      if (typeof value !== "number" || !f.nums.length) return undefined;
      const edge = f.mean + (above ? 1 : -1) * spread * f.sd;
      return (above ? value > edge || (equal && value === edge) : value < edge || (equal && value === edge)) ? marked : undefined;
    };
  }
  if (type === "duplicateValues" || type === "uniqueValues") {
    const twice = type === "duplicateValues";
    return (value, f) => { const text = valueText(value).toLowerCase(), count = f.counts.get(text) ?? 0; return text && (twice ? count > 1 : count === 1) ? marked : undefined; };
  }
  return null;
}
/** The kept rules a look's text holds, each asked of a cell as it is drawn: the first that marks it, of each kind, is laid. */
export function keptRules(text: unknown) {
  let list: Kept[] = [];
  try { const read = typeof text === "string" ? JSON.parse(text) : []; list = Array.isArray(read) ? read.filter((one) => Array.isArray(one?.ranges) && typeof one.xml === "string") : []; } catch { list = []; }
  const rules = list.flatMap((one) => { const test = compile(one); return test ? [{ kept: one, rule: { areas: null, figures: null, test } as Rule }] : []; });
  const figuresOf = (sheet: SheetView, areas: Range[]): Figures => {
    const nums: number[] = [], counts = new Map<string, number>();
    for (const area of areas) for (let row = area.top; row <= area.bottom; row++) for (let col = area.left; col <= area.right; col++) {
      const value = sheet.value(row, col);
      if (typeof value === "number") nums.push(value);
      const text = valueText(value).toLowerCase();
      if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
    }
    let low = Infinity, high = -Infinity, sum = 0;
    for (const n of nums) { if (n < low) low = n; if (n > high) high = n; sum += n; }
    const mean = nums.length ? sum / nums.length : 0, sd = nums.length > 1 ? Math.sqrt(nums.reduce((all, n) => all + (n - mean) ** 2, 0) / (nums.length - 1)) : 0;
    return { nums, low, high, mean, sd, counts };
  };
  return {
    size: rules.length,
    /** Each rule's figures read again as they are next asked. */
    changed() { for (const { rule } of rules) { rule.areas = null; rule.figures = null; } },
    /** What the rules lay over a cell, the first of each kind winning; undefined for none. */
    at(sheet: SheetView, row: number, col: number): KeptMark | undefined {
      let out: KeptMark | undefined;
      for (const { kept, rule } of rules) {
        rule.areas ??= ruleAreas(sheet, kept);
        if (!rule.areas.some((area) => row >= area.top && row <= area.bottom && col >= area.left && col <= area.right)) continue;
        rule.figures ??= figuresOf(sheet, rule.areas);
        const mark = rule.test(sheet.value(row, col), rule.figures);
        if (mark) out = { ...mark, ...out, ...(mark.attrs && out?.attrs ? { attrs: { ...mark.attrs, ...out.attrs } } : {}) };
      }
      return out;
    },
  };
}

// Excel's icon colours.
const RED = "#e5493a", YELLOW = "#f2c037", GREEN = "#3fa45b", GREY = "#7f7f7f", BLUE = "#4f81bd", BLACK = "#404040", PINK = "#f4a3a3";
/** An icon's side for a row this tall. */
export const iconSize = (tall: number) => Math.max(8, Math.min(16, tall - 6));
/** An icon set's icon drawn at a cell's left, with canvas paths. */
export function drawIcon(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; width: number; height: number }, { set, at }: SheetIcon, pad: number) {
  const size = iconSize(rect.height), x = rect.x + pad, y = rect.y + (rect.height - size) / 2, r = size / 2, cx = x + r, cy = y + r, count = Number(set[0]) || 3;
  const was = [ctx.fillStyle, ctx.strokeStyle, ctx.lineWidth] as const;
  const circle = (ink: string) => { ctx.fillStyle = ink; ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.fill(); };
  const stroke = (ink: string, points: number[][]) => { ctx.strokeStyle = ink; ctx.lineWidth = Math.max(1.5, size / 8); ctx.lineCap = "round"; ctx.beginPath(); points.forEach(([px, py], n) => n ? ctx.lineTo(cx + px! * r, cy + py! * r) : ctx.moveTo(cx + px! * r, cy + py! * r)); ctx.stroke(); };
  ctx.save();
  if (/Arrows/.test(set)) {
    // Down, then turning through the diagonals and flat to up; a grey set in grey.
    const turns = count === 3 ? [180, 90, 0] : count === 4 ? [180, 135, 45, 0] : [180, 135, 90, 45, 0], inks = count === 3 ? [RED, YELLOW, GREEN] : count === 4 ? [RED, YELLOW, YELLOW, GREEN] : [RED, YELLOW, YELLOW, YELLOW, GREEN];
    ctx.translate(cx, cy); ctx.rotate((turns[at] ?? 0) * Math.PI / 180);
    ctx.fillStyle = /Gray/.test(set) ? GREY : inks[at] ?? GREY;
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r, 0); ctx.lineTo(r * 0.35, 0); ctx.lineTo(r * 0.35, r); ctx.lineTo(-r * 0.35, r); ctx.lineTo(-r * 0.35, 0); ctx.lineTo(-r, 0); ctx.closePath(); ctx.fill();
  } else if (/Rating/.test(set)) {
    // Signal bars, as many filled as the rating (4Rating's lowest has one).
    const filled = set === "4Rating" ? at + 1 : at, wide = size / 4;
    for (let n = 0; n < 4; n++) { ctx.fillStyle = n < filled ? BLUE : `${GREY}66`; const tall = size * (n + 1) / 4; ctx.fillRect(x + n * wide + 0.5, y + size - tall, wide - 1, tall); }
  } else if (/Symbols/.test(set)) {
    // A cross, a mark and a tick, in circles (3Symbols) or alone (3Symbols2).
    const ink = [RED, YELLOW, GREEN][at] ?? GREY, ringed = set === "3Symbols", line = ringed ? "#ffffff" : ink;
    if (ringed) circle(ink);
    if (at === 0) { stroke(line, [[-0.4, -0.4], [0.4, 0.4]]); stroke(line, [[0.4, -0.4], [-0.4, 0.4]]); }
    else if (at === 1) { stroke(line, [[0, -0.5], [0, 0.15]]); stroke(line, [[0, 0.45], [0, 0.46]]); }
    else stroke(line, [[-0.45, 0], [-0.1, 0.4], [0.45, -0.4]]);
  } else if (set === "3Signs") {
    ctx.fillStyle = [RED, YELLOW, GREEN][at] ?? GREY; ctx.beginPath();
    if (at === 0) { ctx.moveTo(cx, y); ctx.lineTo(x + size, cy); ctx.lineTo(cx, y + size); ctx.lineTo(x, cy); } else if (at === 1) { ctx.moveTo(cx, y); ctx.lineTo(x + size, y + size); ctx.lineTo(x, y + size); } else ctx.arc(cx, cy, r, 0, 2 * Math.PI);
    ctx.fill();
  } else if (set === "5Quarters") {
    ctx.strokeStyle = BLACK; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r - 0.5, 0, 2 * Math.PI); ctx.stroke();
    if (at) { ctx.fillStyle = BLACK; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r - 0.5, -Math.PI / 2, -Math.PI / 2 + at * Math.PI / 2); ctx.fill(); }
  } else {
    // Traffic lights, flags and the rest as lights: red to green, or red to black.
    const inks = set === "4RedToBlack" ? [BLACK, GREY, PINK, RED] : count === 4 ? [BLACK, RED, YELLOW, GREEN] : [RED, YELLOW, GREEN];
    circle(inks[at] ?? GREY);
  }
  ctx.restore();
  [ctx.fillStyle, ctx.strokeStyle, ctx.lineWidth] = was;
}
