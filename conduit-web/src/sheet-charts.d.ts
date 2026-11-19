import type { Range, SheetView } from "./sheet-format.js";

export type SheetChartKind = "bar" | "column" | "line" | "area" | "pie" | "scatter";
export const CHART_KINDS: readonly SheetChartKind[];
export const CHART_LIMIT: number;
type Size = { width: number; height: number };
export const CHART_SIZE: Size, CHART_LEAST: Size, CHART_MOST: Size;
/** A chart in a tab's look (`charts:<tabId>`): its range's corners and the cell it stands on, each "<rowId>:<colId>"; its size in pixels at 100%. */
export type SheetChart = { id: string; kind: SheetChartKind; from: string; to: string; labels: "col" | "row"; title?: string; at: string; width: number; height: number };
/** A chart as sheet.json and an agent read it: its range and cell by A1. */
export type SheetChartA1 = Omit<SheetChart, "from" | "to" | "at"> & { range: string; at: string };
/** What an agent asks for (sheets.js `chart`): any field of a chart by A1; `title: null` takes the title off. */
export type SheetChartSpec = Partial<Omit<SheetChartA1, "id" | "title">> & { title?: string | null };
type Ids = Pick<SheetView, "indexOfRow" | "indexOfCol">;
export function readCharts(text: unknown): SheetChart[];
export function chartPlace(view: Ids, chart: SheetChart): { area: Range; at: { row: number; col: number } } | null;
export function chartsA1(view: Ids, text: unknown): SheetChartA1[];
export function chartIds(view: Pick<SheetView, "size" | "rowAt" | "colAt">, list: unknown): string | undefined;
export function chartFrom(view: SheetView, spec: SheetChartSpec, was: SheetChart | undefined, id: string): SheetChart;
export function keptCharts(view: SheetView, text: unknown, isRows: boolean, at: number, count: number): string | null | undefined;
export type SheetChartData = { labels: string[]; x: (number | null)[]; series: { name: string; values: (number | null)[] }[] };
export function chartData(area: Range, labels: "col" | "row", read: (row: number, col: number) => { value: unknown; text: string }, hidden?: { rows: ReadonlySet<number>; cols: ReadonlySet<number> }): SheetChartData;
export function chartSize(chart: Partial<Size>): Size;
