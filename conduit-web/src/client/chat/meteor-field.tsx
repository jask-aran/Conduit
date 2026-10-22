import { createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js";
import { DEFAULT_SEED, DEFAULT_SETTINGS, MeteorShower, simulateMeteors, type MeteorEvent } from "@jask-aran/solid-components/meteor-shower";

/*
 * One meteor shower across the whole shell (AppShell's row), seen through every pane that shows it: each pane's
 * Sheet backdrop draws the same timeline, shifted by where the pane sits in the row, so the panes read as windows
 * onto one field behind them. The timeline is the package's DefaultMeteorShower's (its seed, settings and cycle),
 * kept here once so every pane's meteors start together; a pane opened later joins mid-flight.
 */
const TIMELINE_SECONDS = 600;
const INITIAL_ELAPSED_SECONDS = 12;
const EPSILON = 1e-3;

/** In flight at `elapsed`, and the next one scheduled. */
const activeWindow = (events: readonly MeteorEvent[], elapsed: number, maxActive: number) => {
  const flying = events.filter((event) => event.startTime <= elapsed && event.startTime + event.duration > elapsed).slice(0, Math.max(0, maxActive));
  const next = events.find((event) => event.startTime > elapsed);
  return next ? [...flying, next] : flying;
};
/** Keeps meteors already in the DOM the same objects, so a new window never restarts them. */
const retainWindow = (previous: readonly MeteorEvent[], next: readonly MeteorEvent[]) => {
  const kept = new Map(previous.map((event) => [event.id, event]));
  return next.map((event) => { const old = kept.get(event.id); return old && old.startTime === event.startTime && old.duration === event.duration ? old : event; });
};
/** When the window next changes: a launch or a landing. */
const nextChange = (events: readonly MeteorEvent[], elapsed: number, end: number) => {
  let at = end;
  for (const event of events) {
    if (event.startTime > elapsed + EPSILON) at = Math.min(at, event.startTime);
    const landing = event.startTime + event.duration;
    if (landing > elapsed + EPSILON) at = Math.min(at, landing);
  }
  return at;
};

export function createMeteorField() {
  let shell: HTMLElement | undefined;
  let start = performance.now() - INITIAL_ELAPSED_SECONDS * 1000;
  let timer: number | undefined;
  let pending = { width: 1, height: 1 };
  const [viewport, setViewport] = createSignal({ width: 1, height: 1 });
  const [shellWidth, setShellWidth] = createSignal(1);
  const [elapsed, setElapsed] = createSignal(INITIAL_ELAPSED_SECONDS);
  const [cycle, setCycle] = createSignal(0);
  const live = () => Math.max(0, (performance.now() - start) / 1000);
  const events = createMemo(() => (cycle(), simulateMeteors({ durationSeconds: TIMELINE_SECONDS, seed: DEFAULT_SEED, settings: DEFAULT_SETTINGS, viewport: viewport() })));
  // A new forecast for the same field keeps what is already flying; a field sized afresh starts clean.
  let forecastFor = viewport();
  const shown = createMemo<MeteorEvent[]>((previous) => {
    const next = activeWindow(events(), elapsed(), DEFAULT_SETTINGS.maxActive ?? 30);
    const same = forecastFor === viewport();
    forecastFor = viewport();
    return same ? retainWindow(previous, next) : next;
  }, []);
  const schedule = () => {
    window.clearTimeout(timer);
    const now = live();
    timer = window.setTimeout(() => {
      // The cycle ends: begin again at the shell's size now.
      if (live() >= TIMELINE_SECONDS - EPSILON) { start = performance.now(); setViewport(pending); setElapsed(0); setCycle((n) => n + 1); }
      else setElapsed(live());
      schedule();
    }, Math.max(1, (nextChange(events(), now, TIMELINE_SECONDS) - now) * 1000));
  };
  let observer: ResizeObserver | undefined;
  let watchers = 0;
  /** The row the field spans. Its size at the start of a cycle is the field's (a resize waits for the next). */
  const observe = (element: HTMLElement) => {
    shell = element;
    observer?.disconnect();
    observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      pending = { width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) };
      setShellWidth(pending.width);
      // The first size the row has (its ref runs before it is laid out) is the field's.
      if (viewport().width <= 1) setViewport(pending);
    });
    observer.observe(element);
    pending = { width: Math.max(1, element.clientWidth), height: Math.max(1, element.clientHeight) };
    setShellWidth(pending.width);
    setViewport(pending);
  };
  onCleanup(() => { window.clearTimeout(timer); observer?.disconnect(); });

  /** The field as one pane sees it: put in a Sheet's backdrop. */
  const Window = (): JSX.Element => {
    let frame!: HTMLDivElement;
    const [offset, setOffset] = createSignal(0);
    onMount(() => {
      if (watchers++ === 0) { setElapsed(live()); schedule(); }
      const measure = () => { if (shell && frame.parentElement) setOffset(frame.parentElement.getBoundingClientRect().left - shell.getBoundingClientRect().left); };
      const moved = new ResizeObserver(measure);
      moved.observe(frame.parentElement ?? frame);
      if (shell) moved.observe(shell);
      // No read now: the observers' first call comes after the layout, before the paint. One here forced the
      // whole new pane's layout inside the click that opened it.
      onCleanup(() => { moved.disconnect(); if (--watchers === 0) window.clearTimeout(timer); });
    });
    return <div ref={frame} class="solid-meteor-shower" style={{ width: `${shellWidth()}px`, transform: `translateX(${-offset()}px)` }}>
      <MeteorShower events={shown()} elapsedSeconds={live()} entryOffset={DEFAULT_SETTINGS.entryOffset ?? 12} removeOnAnimationEnd={false} />
    </div>;
  };
  return { observe, Window };
}
