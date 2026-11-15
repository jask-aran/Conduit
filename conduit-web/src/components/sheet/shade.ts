/*
 * A workbook's own colours (`#rrggbb`, sheet-styles.js) fitted to the dark grid: made for white paper, they are drawn with their lightness turned over
 * and their hue kept (OKLab), so a pale band is a deep one under the same text and dark ink is light. Fills keep to a band just over the background,
 * text and edges above a floor that reads on it. The true colour stays in the look, for export.
 */
type Role = "fill" | "text" | "edge" | "over";
// Lightness (OKLab L) a fill is mapped into, just over the grid's background, and the least a line or text on the background is drawn at (`over`: text on a fill, turned with it).
const FILL_FROM = 0.26, FILL_SPAN = 0.55, FILL_CHROMA = 1.5, TEXT_TURN = 0.75, FLOOR: Record<Role, number> = { fill: 0, text: 0.6, edge: 0.55, over: 0 };

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const oklab = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => toLinear(parseInt(hex.slice(at, at + 2), 16) / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s] as const;
};
const rgb = (L: number, a: number, b: number) => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
};
const made = new Map<string, string>();

/** A workbook colour as the grid draws it in `role`, as rgb (the grid reads only that). */
export function shade(hex: string, role: Role): string {
  const id = `${role}${hex}`, kept = made.get(id);
  if (kept) return kept;
  const [L, a, b] = oklab(hex), turned = role === "fill" ? FILL_FROM + (1 - L) * FILL_SPAN : Math.max(FLOOR[role], 1 - L * TEXT_TURN);
  // Less chroma until it is a colour the screen has.
  let chroma = role === "fill" ? FILL_CHROMA : 1, out = rgb(turned, a * chroma, b * chroma);
  while (out.some((v) => v < -1e-4 || v > 1 + 1e-4) && chroma > 0.02) { chroma *= 0.9; out = rgb(turned, a * chroma, b * chroma); }
  const text = `rgb(${out.map((v) => Math.round(toGamma(Math.min(1, Math.max(0, v))) * 255)).join(", ")})`;
  made.set(id, text);
  return text;
}
