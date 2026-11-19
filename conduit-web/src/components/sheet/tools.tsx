/*
 * A sheet's edit tools as its ribbon draws them (host.ts SheetTool): each sets the selection's style (styles.ts) or number format (formats.ts) and
 * shows what its first cell wears. Their names are stable: a key sequence is bound to a tool by its name (sequences.tsx). The text styles, each worn on its own, stand
 * in one menu under the text glyph with Clear formatting at its foot; Fill down and Fill right in another.
 */
import type { Accessor } from "solid-js";
import { Swatch } from "@/components/ui";
import { sheetChartIcons, sheetToolIcons } from "@/components/ui/sheet-icons";
import { CHART_KINDS, type SheetChartKind } from "@/sheet-charts.js";
import { SHEET_BORDERS, SHEET_INKS, type SheetBorders, type SheetInk } from "@/sheet-styles.js";
import { SHEET_PRESETS, type SheetFormats } from "./formats";
import { SHEET_TOOLS, type SheetRange, type SheetTool, type SheetToolId, type SheetToolName } from "./host";
import type { SheetStyles } from "./styles";
import { SHEET_INK_TOKENS } from "./theme";

const TOGGLES = [["bold", "Bold", ["Ctrl", "B"]], ["italic", "Italic", ["Ctrl", "I"]], ["underline", "Underline", ["Ctrl", "U"]], ["strike", "Strikethrough", ["Ctrl", "5"]], ["wrap", "Wrap text", undefined]] as const;
const STYLE = "Text style";
const INK_LABELS: Readonly<Record<SheetInk, string>> = { red: "Red", amber: "Amber", green: "Green", blue: "Blue" };
const BORDER_LABELS: Readonly<Record<SheetBorders, string>> = { all: "All borders", outer: "Outside borders", top: "Top border", bottom: "Bottom border", left: "Left border", right: "Right border", none: "No borders" };
const ALIGNS = [["left", "Align left"], ["center", "Align centre"], ["right", "Align right"]] as const;
const VALIGNS = [["top", "Align top"], ["middle", "Align middle"], ["bottom", "Align bottom"]] as const;

/** `done`: after a tool has run (the grid takes focus back). `fit`: the rows of a range whose wrapping changed are fitted to their lines. `spread`: Fill down or Fill right (sheet.tsx). `act`: a tool's run is one step of the history, by its label. `chart`: a chart of the selection asked for (sheet.tsx), where one can be. */
export function createSheetTools(options: { tip(name: SheetToolId): string | undefined; at: Accessor<SheetRange | null>; styles: SheetStyles; formats: SheetFormats; offered?: readonly SheetToolName[]; fit(range: SheetRange): void; spread(range: SheetRange, way: "down" | "right"): void; act(label: string, run: () => void): void; chart?(kind: SheetChartKind): void; done(): void }): SheetTool[] {
  const { at, styles, formats } = options, offered = options.offered ?? SHEET_TOOLS;
  const worn = () => { const range = at(); return range && styles.worn(range.top, range.left); };
  const tool = (name: SheetToolId, label: string, icon: SheetTool["icon"], run: (range: SheetRange) => void, rest: Partial<SheetTool> & { on?(): boolean } = {}): SheetTool => {
    const { on, ...more } = rest;
    return { name, label, icon, ...more, get tip() { return options.tip(name); }, get active() { return on?.() ?? false; }, get pressed() { return on && !more.menu ? on() : undefined; }, get disabled() { return !at(); }, run: () => { const range = at(); if (range) options.act(label, () => run(range)); options.done(); } };
  };
  const mark = (name: keyof typeof sheetToolIcons) => { const Icon = sheetToolIcons[name]; return () => <Icon />; };
  const inks = (name: "color" | "fill", menu: string, none: string, noun: string) => [undefined, ...SHEET_INKS].map((ink?: SheetInk) => tool(`${name}-${ink ?? "none"}`, ink ? `${INK_LABELS[ink]} ${noun}` : none,
    ink ? () => <Swatch colour={`var(${SHEET_INK_TOKENS[ink]})`} /> : mark(name), (range) => styles.set(range, { [name]: ink ?? null }),
    { menu, compact: true, swatch: ink && `var(${SHEET_INK_TOKENS[ink]})`, on: () => (worn()?.[name] ?? undefined) === ink }));
  const all: Record<SheetToolName, () => SheetTool[]> = {
    bold: () => [], italic: () => [], underline: () => [], strike: () => [], wrap: () => [],
    clear: () => [tool("clear", "Clear formatting", mark("clear"), (range) => { styles.clear(range); formats.set(range, "General"); options.fit(range); }, { menu: STYLE, glyph: mark("text-style") })],
    color: () => inks("color", "Text colour", "Default text", "text"),
    fill: () => inks("fill", "Fill colour", "No fill", "fill"),
    borders: () => SHEET_BORDERS.map((kind) => tool(`borders-${kind}`, BORDER_LABELS[kind], mark("borders"), (range) => styles.borders(range, kind), { menu: "Borders" })),
    align: () => ALIGNS.map(([side, label]) => tool(`align-${side}`, label, mark(`align-${side}`), (range) => styles.set(range, { align: worn()?.align === side ? null : side }), { menu: "Align", on: () => worn()?.align === side })),
    valign: () => VALIGNS.map(([side, label]) => tool(`valign-${side}`, label, mark(`valign-${side}`), (range) => styles.set(range, { valign: side === "middle" ? null : side }), { menu: "Vertical align", on: () => (worn()?.valign ?? "middle") === side })),
    format: () => SHEET_PRESETS.map((preset) => tool(`format-${preset.name.toLowerCase()}` as SheetToolId, preset.name, mark("format"), (range) => formats.set(range, preset.format),
      { menu: "Number format", on: () => { const range = at(), format = range && formats.at(range.top, range.left); return Boolean(range) && (format ?? "General") === preset.format; } })),
    decimals: () => [tool("decimals-more", "More decimals", mark("decimals-more"), (range) => formats.decimals(range, 1)), tool("decimals-fewer", "Fewer decimals", mark("decimals-fewer"), (range) => formats.decimals(range, -1))],
    // Each kind asks the agent for a chart of the selection: nothing is drawn here until it makes one.
    chart: () => options.chart ? CHART_KINDS.map((kind) => { const Icon = sheetChartIcons[kind]; return tool(`chart-${kind}`, `${kind[0]!.toUpperCase()}${kind.slice(1)} chart`, () => <Icon />, () => options.chart!(kind), { menu: "Chart", glyph: () => <sheetChartIcons.column /> }); }) : [],
    spread: () => (["down", "right"] as const).map((way) => tool(`spread-${way}`, `Fill ${way}`, mark(`spread-${way}`), (range) => options.spread(range, way), { menu: "Fill", glyph: mark("spread-down"), keys: ["Ctrl", way === "down" ? "D" : "R"] })),
  };
  for (const [name, label, keys] of TOGGLES) all[name] = () => [tool(name, label, mark(name), (range) => { styles.set(range, { [name]: !worn()?.[name] }); if (name === "wrap") options.fit(range); }, { menu: STYLE, glyph: mark("text-style"), keys: keys && [...keys], on: () => Boolean(worn()?.[name]) })];
  return SHEET_TOOLS.filter((name) => offered.includes(name)).flatMap((name) => all[name]());
}
