/*
 * A chart drawn as SVG markup from what its range holds (sheet-charts.js chartData), at its size at 100%: worked out once each time its cells or its
 * look change, never as the grid scrolls (charts.tsx moves it whole). Colours are the app's tokens, so it follows the theme; the series take the
 * sheet's inks in one fixed order, the first in the text colour. `font`: the caption's size in pixels, which every gap is measured from.
 */
import type { SheetChartData, SheetChartKind } from "@/sheet-charts.js";

const INKS = ["--foreground", "--status-success", "--status-warn", "--destructive", "--status-unread", "--muted-foreground"].map((name) => `var(${name})`);
const MUTED = "var(--muted-foreground)", RULE = "var(--border)", TEXT = "var(--foreground)", GROUND = "var(--background)";
// How wide a character of the caption's face is, near enough to keep labels apart without measuring them.
const CHAR = 0.58;
const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const fit = (text: string, room: number, font: number) => { const most = Math.max(1, Math.floor(room / (font * CHAR))); return text.length <= most ? text : `${text.slice(0, Math.max(1, most - 1))}…`; };
const wide = (text: string, font: number) => text.length * font * CHAR;
const r = (n: number) => Math.round(n * 10) / 10;
/** A number as an axis says it: 1.2k, 3M. */
const figure = (n: number) => {
  const size = Math.abs(n);
  for (const [at, unit] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "k"]] as const) if (size >= at) return `${Number((n / at).toPrecision(3))}${unit}`;
  return String(Number(n.toPrecision(4)));
};
/** Ticks at a round step over [lo, hi]. */
const ticks = (lo: number, hi: number, zero: boolean) => {
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) { hi = lo + (Math.abs(lo) || 1); if (!zero) lo -= Math.abs(lo) || 1; }
  const rough = (hi - lo) / 5, power = 10 ** Math.floor(Math.log10(rough)), step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((one) => one >= rough)!;
  const first = Math.floor(lo / step) * step, last = Math.ceil(hi / step) * step, out: number[] = [];
  for (let at = first; at <= last + step / 2; at += step) out.push(Number(at.toPrecision(12)));
  return out;
};
const text = (x: number, y: number, words: string, font: number, rest = "") => `<text x="${r(x)}" y="${r(y)}" font-size="${r(font)}" ${rest}>${esc(words)}</text>`;
const tip = (words: string) => `<title>${esc(words)}</title>`;

export function drawChart(kind: SheetChartKind, data: SheetChartData, size: { width: number; height: number }, title: string | undefined, font: number): string {
  const { width, height } = size, pad = font, parts: string[] = [];
  let top = pad;
  if (title) { parts.push(text(width / 2, top + font, fit(title, width - 2 * pad, font * 1.2), font * 1.2, `text-anchor="middle" font-weight="600" style="fill:${TEXT}"`)); top += font * 2; }
  const pie = kind === "pie";
  // A pie is its first series in the cells' order, its largest slices kept and the rest one more as Other; every other kind is up to as many series
  // as there are inks.
  const shares = pie ? (() => {
    const all = data.labels.map((label, n) => ({ label, value: data.series[0]?.values[n] ?? 0 })).filter((one) => one.value !== null && one.value > 0) as { label: string; value: number }[];
    if (all.length <= INKS.length) return all;
    const kept = new Set([...all].sort((a, b) => b.value - a.value).slice(0, INKS.length - 1));
    return [...all.filter((one) => kept.has(one)), { label: "Other", value: all.filter((one) => !kept.has(one)).reduce((sum, one) => sum + one.value, 0) }];
  })() : [];
  const series = pie ? [] : data.series.slice(0, INKS.length);
  const numbers = series.flatMap((one) => one.values.filter((value): value is number => value !== null));
  if (pie ? !shares.length : !numbers.length) {
    parts.push(text(width / 2, (top + height) / 2, pie ? "No values above zero to chart" : "No numbers to chart in this range", font, `text-anchor="middle" style="fill:${MUTED}"`));
    return svg(width, height, parts);
  }
  // The legend: a swatch and a name for each series (each slice of a pie, with its share), in rows under the title.
  const total = shares.reduce((sum, one) => sum + one.value, 0);
  const keys = pie ? shares.map((one) => `${one.label} ${Math.round((one.value / total) * 100)}%`) : series.length > 1 ? series.map((one) => one.name) : [];
  if (keys.length) {
    const swatch = font * 0.7, room = width - 2 * pad;
    let x = pad, rows = 1;
    keys.forEach((name, n) => {
      const label = fit(name, room - swatch - font * 0.4, font), span = swatch + font * 0.4 + wide(label, font) + font;
      if (x > pad && x + span - font > pad + room) { x = pad; rows++; }
      const y = top + (rows - 1) * font * 1.5;
      parts.push(`<rect x="${r(x)}" y="${r(y + (font - swatch) / 2)}" width="${r(swatch)}" height="${r(swatch)}" rx="${r(swatch / 4)}" style="fill:${INKS[n]}"/>`, text(x + swatch + font * 0.4, y + font * 0.85, label, font, `style="fill:${MUTED}"`));
      x += span;
    });
    top += rows * font * 1.5 + font * 0.25;
  }
  const bottom = height - pad;
  if (pie) {
    const radius = Math.max(0, Math.min(width - 2 * pad, bottom - top) / 2), cx = width / 2, cy = (top + bottom) / 2;
    let from = -Math.PI / 2;
    shares.forEach((one, n) => {
      const sweep = (one.value / total) * Math.PI * 2, to = from + sweep, at = (angle: number) => `${r(cx + radius * Math.cos(angle))} ${r(cy + radius * Math.sin(angle))}`;
      const shape = shares.length === 1 ? `<circle cx="${r(cx)}" cy="${r(cy)}" r="${r(radius)}"` : `<path d="M${r(cx)} ${r(cy)}L${at(from)}A${r(radius)} ${r(radius)} 0 ${sweep > Math.PI ? 1 : 0} 1 ${at(to)}Z"`;
      parts.push(`${shape} style="fill:${INKS[n]};stroke:${GROUND};stroke-width:2">${tip(`${one.label}: ${one.value} (${Math.round((one.value / total) * 100)}%)`)}${shares.length === 1 ? "</circle>" : "</path>"}`);
      from = to;
    });
    return svg(width, height, parts);
  }
  const across = kind === "bar", scatter = kind === "scatter", count = data.labels.length;
  const xs = scatter ? data.x.map((x, n) => x ?? n + 1) : [];
  const values = ticks(Math.min(...numbers), Math.max(...numbers), kind === "bar" || kind === "column" || kind === "area"), low = values[0]!, high = values.at(-1)!;
  const valueWords = values.map(figure), labelFont = font;
  // The plot's box: the value axis's figures at the left (a bar chart's labels there instead), a line of labels under it.
  const leftWords = across ? data.labels : valueWords, leftRoom = Math.min(width * 0.3, Math.max(...leftWords.map((one) => wide(one, labelFont)))) + font * 0.5;
  const plot = { left: pad + leftRoom, right: width - pad, top: top + font * 0.5, bottom: bottom - font * 1.4 };
  if (plot.right - plot.left < font * 2 || plot.bottom - plot.top < font * 2) return svg(width, height, parts);
  const scale = (value: number, lo: number, hi: number, from: number, to: number) => from + ((value - lo) / (hi - lo)) * (to - from);
  const valueAt = (value: number) => across ? scale(value, low, high, plot.left, plot.right) : scale(value, low, high, plot.bottom, plot.top);
  // Gridlines across the value axis, recessive; the baseline at zero a step stronger.
  values.forEach((value, n) => {
    const at = valueAt(value), line = across ? `x1="${r(at)}" x2="${r(at)}" y1="${r(plot.top)}" y2="${r(plot.bottom)}"` : `x1="${r(plot.left)}" x2="${r(plot.right)}" y1="${r(at)}" y2="${r(at)}"`;
    parts.push(`<line ${line} style="stroke:${value === 0 ? MUTED : RULE};stroke-width:1"/>`);
    parts.push(across ? text(at, plot.bottom + font * 1.2, valueWords[n]!, labelFont, `text-anchor="middle" style="fill:${MUTED}"`) : text(plot.left - font * 0.5, at + font * 0.35, valueWords[n]!, labelFont, `text-anchor="end" style="fill:${MUTED}"`));
  });
  // Along the other axis: the labels in bands (a scatter: its x values on a scale of their own).
  const xTicks = scatter ? ticks(Math.min(...xs), Math.max(...xs), false) : [];
  const along = (n: number) => scatter ? scale(xs[n]!, xTicks[0]!, xTicks.at(-1)!, plot.left, plot.right) : across ? plot.top + (n + 0.5) * ((plot.bottom - plot.top) / count) : plot.left + (n + 0.5) * ((plot.right - plot.left) / count);
  const band = (across ? plot.bottom - plot.top : plot.right - plot.left) / Math.max(1, count);
  if (scatter) xTicks.forEach((x) => parts.push(text(scale(x, xTicks[0]!, xTicks.at(-1)!, plot.left, plot.right), plot.bottom + font * 1.2, figure(x), labelFont, `text-anchor="middle" style="fill:${MUTED}"`)));
  else if (across) data.labels.forEach((label, n) => { if (band >= font * 1.1 || n % Math.ceil((font * 1.1) / band) === 0) parts.push(text(plot.left - font * 0.5, along(n) + font * 0.35, fit(label, leftRoom - font * 0.5, labelFont), labelFont, `text-anchor="end" style="fill:${MUTED}"`)); });
  else {
    // Every kth label, so none runs into the next.
    const widest = Math.max(...data.labels.map((one) => wide(one, labelFont))) + font, every = Math.max(1, Math.ceil(Math.min(widest, font * 8) / band));
    data.labels.forEach((label, n) => { if (n % every === 0) parts.push(text(along(n), plot.bottom + font * 1.2, fit(label, band * every - font * 0.5, labelFont), labelFont, `text-anchor="middle" style="fill:${MUTED}"`)); });
  }
  const say = (n: number, one: { name: string }, value: number) => tip(`${data.labels[n]}${series.length > 1 ? ` · ${one.name}` : ""}: ${value}`);
  if (kind === "bar" || kind === "column") {
    // Each band's bars side by side, a surface gap between them.
    const group = band * 0.72, each = group / series.length, zero = valueAt(Math.max(low, Math.min(0, high)));
    series.forEach((one, s) => one.values.forEach((value, n) => {
      if (value === null) return;
      const start = along(n) - group / 2 + s * each, end = valueAt(value), thick = Math.max(1, each - (series.length > 1 ? 2 : 0));
      const box = across ? `x="${r(Math.min(zero, end))}" y="${r(start)}" width="${r(Math.abs(end - zero))}" height="${r(thick)}"` : `x="${r(start)}" y="${r(Math.min(zero, end))}" width="${r(thick)}" height="${r(Math.abs(end - zero))}"`;
      parts.push(`<rect ${box} rx="1" style="fill:${INKS[s]}">${say(n, one, value)}</rect>`);
    }));
  } else {
    const dots = scatter || count <= 30;
    series.forEach((one, s) => {
      // A line breaks at a cell with no number; an area is filled down to the baseline under each run of numbers.
      const runs: [number, number][][] = [[]];
      one.values.forEach((value, n) => { if (value === null) { if (runs.at(-1)!.length) runs.push([]); } else runs.at(-1)!.push([along(n), valueAt(value)]); });
      for (const run of runs.filter((points) => points.length)) {
        const line = run.map(([x, y], n) => `${n ? "L" : "M"}${r(x)} ${r(y)}`).join("");
        if (kind === "area") { const base = valueAt(Math.max(low, Math.min(0, high))); parts.push(`<path d="${line}L${r(run.at(-1)![0])} ${r(base)}L${r(run[0]![0])} ${r(base)}Z" style="fill:${INKS[s]};fill-opacity:0.22"/>`); }
        if (!scatter) parts.push(`<path d="${line}" style="fill:none;stroke:${INKS[s]};stroke-width:2;stroke-linejoin:round;stroke-linecap:round"/>`);
      }
      if (dots) one.values.forEach((value, n) => { if (value !== null) parts.push(`<circle cx="${r(along(n))}" cy="${r(valueAt(value))}" r="${scatter ? 4 : 3}" style="fill:${INKS[s]};stroke:${GROUND};stroke-width:1.5">${say(n, one, value)}</circle>`); });
    });
  }
  return svg(width, height, parts);
}
const svg = (width: number, height: number, parts: string[]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img">${parts.join("")}</svg>`;
