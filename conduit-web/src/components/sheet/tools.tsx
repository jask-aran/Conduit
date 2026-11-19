/*
 * A sheet's edit tools as its ribbon draws them (host.ts SheetTool), in SHEET_TOOLS' order: each sets the selection's style (styles.ts), number format
 * (formats.ts) or merge, and shows what its first cell wears. Their names are stable: a key sequence is bound to a tool by its name (sequences.tsx).
 * Bold and Italic stand alone; Underline and Strikethrough share one menu, Wrap and Clip another, and each ink set ends in any colour.
 */
import type { Accessor } from "solid-js";
import { Swatch } from "@/components/ui";
import { sheetChartIcons, sheetMergeIcons, sheetToolIcons } from "@/components/ui/sheet-icons";
import { CHART_KINDS, type SheetChartKind } from "@/sheet-charts.js";
import { SHEET_BORDERS, SHEET_INKS, type SheetBorders, type SheetInk } from "@/sheet-styles.js";
import { SHEET_PRESETS, type SheetFormats } from "./formats";
import { SHEET_TOOLS, type SheetRange, type SheetTool, type SheetToolId, type SheetToolName } from "./host";
import type { SheetMergeKind } from "./merges";
import type { SheetBrush, SheetStyles } from "./styles";
import { SHEET_INK_TOKENS } from "./theme";

const TOGGLES = [["bold", "Bold", ["Ctrl", "B"], undefined], ["italic", "Italic", ["Ctrl", "I"], undefined], ["underline", "Underline", ["Ctrl", "U"], "Underline"], ["strike", "Strikethrough", ["Ctrl", "5"], "Underline"]] as const;
const INK_LABELS: Readonly<Record<SheetInk, string>> = { red: "Red", amber: "Amber", green: "Green", blue: "Blue" };
const BORDER_LABELS: Readonly<Record<SheetBorders, string>> = { all: "All borders", outer: "Outside borders", inner: "Inside borders", top: "Top border", bottom: "Bottom border", left: "Left border", right: "Right border", none: "No borders" };
const ALIGNS = [["left", "Align left"], ["center", "Align centre"], ["right", "Align right"]] as const;
const VALIGNS = [["top", "Align top"], ["middle", "Align middle"], ["bottom", "Align bottom"]] as const;
const MERGES = [["center", "Merge & Center"], ["across", "Merge across"], ["cells", "Merge cells"], ["none", "Unmerge cells"]] as const;

/**
 * `done`: after a tool has run (the grid takes focus back). `fit`: the rows of a range whose wrapping changed are fitted to their lines. `spread`: Fill down
 * or Fill right (sheet.tsx). `merge`: Merge, or unmerge (null), the selection, as its own named step. `act`: a tool's run is one step of the history, by its label (a colour dragged in the picker one step, by `join`). `chart`: a chart of the selection
 * asked for (sheet.tsx), where one can be.
 */
export function createSheetTools(options: { tip(name: SheetToolId): string | undefined; at: Accessor<SheetRange | null>; styles: SheetStyles; formats: SheetFormats; offered?: readonly SheetToolName[]; fit(range: SheetRange): void; spread(range: SheetRange, way: "down" | "right"): void; merge?(kind: SheetMergeKind | null): void; brush?: SheetBrush; act(label: string, run: () => void, join?: string): void; chart?(kind: SheetChartKind): void; done(): void }): SheetTool[] {
  const { at, styles, formats } = options, offered = options.offered ?? SHEET_TOOLS;
  const worn = () => { const range = at(); return range && styles.worn(range.top, range.left); };
  // `own`: the run names its own step (a merge, which may ask first). `hue`: the swatch it shows now.
  const tool = (name: SheetToolId, label: string, icon: SheetTool["icon"], run: (range: SheetRange) => void, rest: Partial<SheetTool> & { on?(): boolean; own?: boolean; hue?(): string | undefined } = {}): SheetTool => {
    const { on, own, hue, ...more } = rest;
    const made: SheetTool = { name, label, icon, ...more, get tip() { return options.tip(name); }, get active() { return on?.() ?? false; }, get pressed() { return on && !more.menu ? on() : undefined; }, get disabled() { return !at(); },
      run: () => { const range = at(); if (range) { if (own) run(range); else options.act(label, () => run(range)); } options.done(); } };
    // A getter of its own: spread into the tool, it would be read once.
    return hue ? Object.defineProperty(made, "swatch", { get: hue, enumerable: true }) : made;
  };
  const mark = (name: keyof typeof sheetToolIcons) => { const Icon = sheetToolIcons[name]; return () => <Icon />; };
  const inks = (name: "color" | "fill", menu: string, none: string, noun: string) => {
    const now = () => worn()?.[name] ?? undefined;
    const named = [undefined, ...SHEET_INKS].map((ink?: SheetInk) => tool(`${name}-${ink ?? "none"}`, ink ? `${INK_LABELS[ink]} ${noun}` : none,
      ink ? () => <Swatch colour={`var(${SHEET_INK_TOKENS[ink]})`} /> : mark(name), (range) => styles.set(range, { [name]: ink ?? null }),
      { menu, compact: true, swatch: ink && `var(${SHEET_INK_TOKENS[ink]})`, on: () => now() === ink }));
    // Any other colour, as a workbook's own are kept: `#rrggbb`, fitted to the theme as it is drawn (shade.ts).
    const label = `Any ${noun} colour`, hex = () => { const on = now(); return on?.startsWith("#") ? on : undefined; };
    const any = tool(`${name}-any`, label, mark(name), () => {}, { menu, compact: true, on: () => Boolean(hex()), hue: hex,
      pick: (picked: string) => { const range = at(); if (range) options.act(label, () => styles.set(range, { [name]: picked.toLowerCase() }), `${label} ${range.top}:${range.left}:${range.bottom}:${range.right}`); } });
    return [...named, any];
  };
  const all: Record<SheetToolName, () => SheetTool[]> = {
    bold: () => [], italic: () => [], underline: () => [], strike: () => [],
    // The painter takes the selection's look as it is pressed, and lays it on the next cells chosen (styles.ts createSheetBrush).
    paint: () => options.brush ? [tool("paint", "Format painter", mark("paint"), () => options.brush!.toggle(), { own: true, on: () => options.brush!.held() })] : [],
    clear: () => [tool("clear", "Clear formatting", mark("clear"), (range) => { styles.clear(range); formats.set(range, "General"); options.fit(range); }, { keys: ["Ctrl", "\\"] })],
    wrap: () => [
      tool("clip", "Clip", mark("clip"), (range) => { styles.set(range, { wrap: false }); options.fit(range); }, { menu: "Wrapping", on: () => !worn()?.wrap }),
      tool("wrap", "Wrap", mark("wrap"), (range) => { styles.set(range, { wrap: !worn()?.wrap }); options.fit(range); }, { menu: "Wrapping", on: () => Boolean(worn()?.wrap) }),
    ],
    color: () => inks("color", "Text colour", "Default text", "text"),
    fill: () => inks("fill", "Fill colour", "No fill", "fill"),
    borders: () => SHEET_BORDERS.map((kind) => tool(`borders-${kind}`, BORDER_LABELS[kind], mark("borders"), (range) => styles.borders(range, kind), { menu: "Borders" })),
    // Merging asks first where it would empty cells, and names its own step.
    merge: () => options.merge ? MERGES.map(([kind, label]) => tool(`merge-${kind}`, label, () => kind === "none" ? <sheetMergeIcons.unmerge /> : <sheetMergeIcons.merge />, () => options.merge!(kind === "none" ? null : kind), { menu: "Merge", own: true, glyph: () => <sheetMergeIcons.merge /> })) : [],
    align: () => ALIGNS.map(([side, label]) => tool(`align-${side}`, label, mark(`align-${side}`), (range) => styles.set(range, { align: worn()?.align === side ? null : side }), { menu: "Align", on: () => worn()?.align === side })),
    valign: () => VALIGNS.map(([side, label]) => tool(`valign-${side}`, label, mark(`valign-${side}`), (range) => styles.set(range, { valign: side === "middle" ? null : side }), { menu: "Vertical align", on: () => (worn()?.valign ?? "middle") === side })),
    format: () => SHEET_PRESETS.map((preset) => tool(`format-${preset.id}` as SheetToolId, preset.name, mark("format"), (range) => formats.set(range, preset.format),
      { menu: "Number format", glyph: mark("format"), on: () => { const range = at(), format = range && formats.at(range.top, range.left); return Boolean(range) && (format ?? "General") === preset.format; } }))
      .concat(tool("format-custom", "Custom format…", mark("format"), (range) => formats.ask(range), { menu: "Number format", own: true, on: () => { const range = at(), format = range && formats.at(range.top, range.left); return Boolean(format) && !SHEET_PRESETS.some((one) => one.format === format); } })),
    decimals: () => [tool("decimals-more", "More decimals", mark("decimals-more"), (range) => formats.decimals(range, 1)), tool("decimals-fewer", "Fewer decimals", mark("decimals-fewer"), (range) => formats.decimals(range, -1))],
    // Each kind asks the agent for a chart of the selection: nothing is drawn here until it makes one.
    chart: () => options.chart ? CHART_KINDS.map((kind) => { const Icon = sheetChartIcons[kind]; return tool(`chart-${kind}`, `${kind[0]!.toUpperCase()}${kind.slice(1)} chart`, () => <Icon />, () => options.chart!(kind), { menu: "Chart", own: true, glyph: () => <sheetChartIcons.column /> }); }) : [],
    spread: () => (["down", "right"] as const).map((way) => tool(`spread-${way}`, `Fill ${way}`, mark(`spread-${way}`), (range) => options.spread(range, way), { menu: "Fill", glyph: mark("spread-down"), keys: ["Ctrl", way === "down" ? "D" : "R"] })),
  };
  for (const [name, label, keys, menu] of TOGGLES) all[name] = () => [tool(name, label, mark(name), (range) => styles.set(range, { [name]: !worn()?.[name] }), { menu, glyph: menu && mark("underline"), keys: [...keys], on: () => Boolean(worn()?.[name]) })];
  return SHEET_TOOLS.filter((name) => offered.includes(name)).flatMap((name) => all[name]());
}
