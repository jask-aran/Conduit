/*
 * The tab's charts over the grid (sheet-charts.js), loaded with the sheet but apart from it. Each is drawn once from its range's cells as they change
 * (chart-draw.ts) and only moved as the grid scrolls. Pressed, a chart is selected: dragged it moves to the cell its corner is let go over, its corner
 * handle sizes it, and with the keyboard the arrows move it a cell, Shift and the arrows size it, Delete takes it off and Tab goes to the next chart.
 * Each of those is one step of the sheet's history.
 */
import * as Y from "yjs";
import { createEffect, createMemo, createSignal, Index, onCleanup, Show, type JSX } from "solid-js";
import { CHART_LEAST, CHART_MOST, chartData, chartPlace, chartSize, readCharts, type SheetChart } from "@/sheet-charts.js";
import { rangeA1, type SheetView } from "@/sheet-format.js";
import { drawChart } from "./chart-draw";
import type { SheetGrid } from "./host";

// What Shift and an arrow size a chart by, at 100%.
const STEP = 24;
// How far (px) a press moves before it is a drag.
const SLOP = 3;
const clamp = (n: number, least: number, most: number) => Math.min(most, Math.max(least, Math.round(n)));

export default function SheetCharts(props: { look: Y.Map<number | string>; model: SheetView; grid: () => SheetGrid | undefined; scrolled: () => number; zoom: () => number;
  hidden: () => ReadonlySet<number>; hiddenCols: () => ReadonlySet<number>; text(row: number, col: number): string; act(label: string, run: () => void): void; undo(): void; redo(): void }) {
  const sheet = props.model;
  const [tick, setTick] = createSignal(0), [selected, setSelected] = createSignal<string | null>(null);
  const bump = () => setTick((n) => n + 1);
  const watch = (event: Y.YMapEvent<number | string>) => { if ([...event.keysChanged].some((name) => name.startsWith("charts:"))) bump(); };
  props.look.observe(watch);
  const off = sheet.onChange(bump);
  onCleanup(() => { props.look.unobserve(watch); off(); });
  const name = () => `charts:${sheet.id}`;
  const list = createMemo(() => { tick(); return sheet.id ? readCharts(props.look.get(name())) : []; });
  // The caption's size, which the drawing is laid out from.
  let layer: HTMLDivElement | undefined;
  const font = () => layer ? parseFloat(getComputedStyle(layer).fontSize) || 12 : 12;
  const save = (label: string, id: string, change: Partial<SheetChart> | null) => props.act(label, () => {
    const all = readCharts(props.look.get(name())), next = change ? all.map((one) => one.id === id ? { ...one, ...change } : one) : all.filter((one) => one.id !== id);
    if (next.length) props.look.set(name(), JSON.stringify(next)); else props.look.delete(name());
  });
  const area = createMemo(() => { props.scrolled(); tick(); return props.grid()?.area() ?? null; });
  // A press anywhere but on a chart lets it go.
  const away = (event: PointerEvent) => { if (!(event.target instanceof Element && event.target.closest(".ui-sheet-chart"))) setSelected(null); };
  addEventListener("pointerdown", away, true);
  onCleanup(() => removeEventListener("pointerdown", away, true));
  const focusChart = (id: string) => layer?.querySelector<HTMLElement>(`[data-chart="${CSS.escape(id)}"]`)?.focus();
  createEffect(() => { const id = selected(); if (id && !list().some((one) => one.id === id)) setSelected(null); });

  // The layer covers the cells and clips what runs past them: placed in the frame it stands in.
  const spot = createMemo((): JSX.CSSProperties => {
    const frame = area(), base = layer?.offsetParent?.getBoundingClientRect();
    return frame && base ? { left: `${frame.left - base.left}px`, top: `${frame.top - base.top}px`, width: `${frame.width}px`, height: `${frame.height}px` } : { visibility: "hidden" };
  });
  return <div ref={layer} class="ui-sheet-charts" style={spot()}>
    <Index each={list()}>{(chart) => {
      const place = createMemo(() => { tick(); return chartPlace(sheet, chart()); });
      // Drawn again when its cells, its look or the hidden lines change, never as the grid scrolls.
      const art = createMemo(() => {
        const at = place();
        if (!at) return "";
        const data = chartData(at.area, chart().labels, (row, col) => ({ value: sheet.value(row, col), text: props.text(row, col) }), { rows: props.hidden(), cols: props.hiddenCols() });
        return drawChart(chart().kind, data, chartSize(chart()), chart().title, font());
      });
      const [drag, setDrag] = createSignal<{ x: number; y: number; width: number; height: number } | null>(null);
      const box = createMemo(() => {
        props.scrolled();
        const at = place(), frame = area(), cell = at && frame && props.grid()?.origin(at.at.row, at.at.col), size = chartSize(chart()), zoom = props.zoom(), moved = drag();
        if (!cell || !frame) return null;
        return { x: cell.left - frame.left + (moved?.x ?? 0), y: cell.top - frame.top + (moved?.y ?? 0), width: size.width * zoom + (moved?.width ?? 0), height: size.height * zoom + (moved?.height ?? 0), cell };
      });
      // A press moves the chart, or (on its handle) sizes it, by the pointer; let go, it lands where it was let go, as one step.
      const press = (event: PointerEvent, sizing: boolean) => {
        if (event.button !== 0) return;
        event.preventDefault(); event.stopPropagation();
        setSelected(chart().id); focusChart(chart().id);
        const from = { x: event.clientX, y: event.clientY }, target = event.currentTarget as HTMLElement;
        target.setPointerCapture(event.pointerId);
        let went = false;
        const move = (moved: PointerEvent) => {
          const x = moved.clientX - from.x, y = moved.clientY - from.y;
          went ||= Math.hypot(x, y) > SLOP;
          if (went) setDrag(sizing ? { x: 0, y: 0, width: x, height: y } : { x, y, width: 0, height: 0 });
        };
        const up = () => {
          target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); target.removeEventListener("pointercancel", up);
          const now = box(), moved = drag(), zoom = props.zoom();
          setDrag(null);
          if (!went || !now || !moved) return;
          if (sizing) return save("Resize chart", chart().id, { width: clamp(now.width / zoom, CHART_LEAST.width, CHART_MOST.width), height: clamp(now.height / zoom, CHART_LEAST.height, CHART_MOST.height) });
          const frame = area(), cell = frame && props.grid()?.cellAt(frame.left + Math.max(0, now.x) + 1, frame.top + Math.max(0, now.y) + 1), row = cell && sheet.rowAt(cell.row), col = cell && sheet.colAt(cell.col);
          if (row && col && `${row}:${col}` !== chart().at) save("Move chart", chart().id, { at: `${row}:${col}` });
        };
        target.addEventListener("pointermove", move); target.addEventListener("pointerup", up); target.addEventListener("pointercancel", up);
      };
      const key = (event: KeyboardEvent) => {
        const at = place(), mod = event.ctrlKey || event.metaKey;
        if (mod && !event.altKey && (event.key === "z" || event.key === "y")) { event.preventDefault(); event.stopPropagation(); return event.key === "y" || event.shiftKey ? props.redo() : props.undo(); }
        if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); save("Delete chart", chart().id, null); return props.grid()?.focus(); }
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setSelected(null); return props.grid()?.focus(); }
        if (event.key === "Tab") {
          const all = list(), next = all[(all.findIndex((one) => one.id === chart().id) + (event.shiftKey ? all.length - 1 : 1)) % all.length];
          if (next && next.id !== chart().id) { event.preventDefault(); setSelected(next.id); focusChart(next.id); }
          return;
        }
        const step = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, [number, number]>)[event.key];
        if (!step || !at || mod || event.altKey) return;
        event.preventDefault();
        if (event.shiftKey) { const size = chartSize(chart()); return save("Resize chart", chart().id, { width: clamp(size.width + step[0] * STEP, CHART_LEAST.width, CHART_MOST.width), height: clamp(size.height + step[1] * STEP, CHART_LEAST.height, CHART_MOST.height) }); }
        const { rows, cols } = sheet.size(), row = sheet.rowAt(clamp(at.at.row + step[1], 0, rows - 1)), col = sheet.colAt(clamp(at.at.col + step[0], 0, cols - 1));
        if (row && col && `${row}:${col}` !== chart().at) save("Move chart", chart().id, { at: `${row}:${col}` });
      };
      // The wheel over a chart scrolls the grid under it.
      const wheel = (event: WheelEvent) => { const scroller = layer?.parentElement?.querySelector<HTMLElement>(".ui-spreadsheet-rows .dvn-scroller"); if (scroller) { event.preventDefault(); scroller.scrollBy(event.deltaX, event.deltaY); } };
      return <Show when={box()}>{(now) => <div class="ui-sheet-chart" data-chart={chart().id} data-selected={selected() === chart().id ? "" : undefined} tabindex="0" role="figure"
        aria-label={`${chart().title ?? `${chart().kind[0]!.toUpperCase()}${chart().kind.slice(1)} chart`} of ${place() ? rangeA1(place()!.area) : ""}`}
        style={{ transform: `translate(${now().x}px, ${now().y}px)`, width: `${now().width}px`, height: `${now().height}px` }}
        onPointerDown={(event) => press(event, false)} onKeyDown={key} onWheel={wheel} onFocus={() => setSelected(chart().id)} onContextMenu={(event) => event.preventDefault()}>
        <div class="ui-sheet-chart-art" innerHTML={art()} />
        <Show when={selected() === chart().id}><span class="ui-sheet-chart-handle" onPointerDown={(event) => press(event, true)} /></Show>
      </div>}</Show>;
    }}</Index>
  </div>;
}
