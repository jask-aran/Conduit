import { reducedMotion } from "./motion";
import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { MODE_FRAMES, paintFrame, resolvePreset, type ModeFrame, type ModeOpts, type OrbState } from "thinking-orbs/engine";

export type { ModeFrame, ModeOpts, OrbState };

/*
 * A turn's mark: a dotted orb drawn by thinking-orbs' canvas engine (its geometry and painter; the loop is Conduit's,
 * since its own component is React). Live, it paints only while on screen and the tab is visible; a change of state
 * waits until the current one has shown for a moment, then crossfades with both still moving, so no frame is empty.
 * Paused (a settled turn, reduced motion) it is one still frame and changes without a fade. `frame` is given plain
 * seconds, not the state's preset speed.
 */
const SIZE = 20;
const DWELL_MS = 250;
const FADE_MS = 200;
const STILL_AT = 0.6;

/* A CSS colour, var() included, as the painter's RGB: resolved on the canvas, read back off a one-pixel fill. */
function rgbOf(element: HTMLElement, color: string) {
  const before = element.style.color;
  element.style.color = color;
  const resolved = getComputedStyle(element).color;
  element.style.color = before;
  const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  if (!probe) return undefined;
  probe.fillStyle = resolved;
  probe.fillRect(0, 0, 1, 1);
  const [r, g, b] = probe.getImageData(0, 0, 1, 1).data;
  return { r: r!, g: g!, b: b! };
}

type Shown = { state: OrbState; opts?: ModeOpts; frame?: ModeFrame };

/* One animation frame loop for every orb on the page, running only while one plays: a loop per orb drew every settled
 * turn in view every frame (docs/design/performance-pass.md, 13). */
type Player = { draw: (now: number) => void; interval: number; last: number };
const players = new Set<Player>();
let tick = 0;
let wait: ReturnType<typeof setTimeout> | undefined;
// Asking for a frame runs a whole frame (style, observers, commit) whether or not anything draws, so with only
// throttled orbs playing the loop sleeps until the next is due.
const schedule = () => {
  if (tick || wait !== undefined || !players.size) return;
  const now = performance.now();
  let due = Infinity;
  for (const player of players) due = Math.min(due, player.last + player.interval - now);
  if (due <= 8) tick = requestAnimationFrame(run);
  else wait = setTimeout(() => { wait = undefined; tick = requestAnimationFrame(run); }, due - 8);
};
const run = (now: number) => {
  tick = 0;
  for (const player of players) {
    if (now - player.last < player.interval - 1) continue;
    player.last = now;
    player.draw(now);
  }
  schedule();
};
// A newly playing orb may be due before the sleep ends, so the sleep is redone.
const play = (player: Player) => { players.add(player); clearTimeout(wait); wait = undefined; schedule(); };
const stop = (player: Player) => {
  players.delete(player);
  if (players.size) return;
  if (tick) cancelAnimationFrame(tick);
  clearTimeout(wait);
  tick = 0;
  wait = undefined;
};

/* A settled orb's slow turn (~12s a turn, ~0.3px a step at 20px) reads the same at 15 draws a second; the sputter
   wants 30. */
export const settledOrbRate = (unfinished: boolean) => unfinished ? 30 : 15;

/**
 * Orb: a dotted orb whose motion says what it is doing (a turn's mark, the mic listening). state: one of the
 * library's states; frame: a frame drawn for Conduit instead (orb-frames: PLAIN_SPHERE a settled turn,
 * SPUTTERING_SPHERE one that did not finish, ORBITS_TRAILED editing); tint: a colour for its dots; paused: one still
 * frame; rate: draws a second (settledOrbRate). It fills its box: the parent sizes it.
 */
export function Orb(props: { state: OrbState; opts?: ModeOpts; frame?: ModeFrame; paused?: boolean; tint?: string; class?: string; rate?: number }) {
  let front!: HTMLCanvasElement;
  let back!: HTMLCanvasElement;
  const reduced = reducedMotion();
  const playing = () => !props.paused && !reduced;

  // What is shown, and what it is fading from while a crossfade runs.
  const [shown, setShown] = createSignal<Shown>({ state: props.state, opts: props.opts, frame: props.frame });
  const [leaving, setLeaving] = createSignal<Shown | null>(null);
  let since = performance.now();
  let fadeFrom = 0;
  let pending: ReturnType<typeof setTimeout> | undefined;
  createEffect(on(() => [props.state, props.opts, props.frame] as const, ([state, opts, frame]) => {
    clearTimeout(pending);
    const next = { state, opts, frame };
    const current = shown();
    if (state === current.state && opts === current.opts && frame === current.frame) return;
    if (!playing()) { setLeaving(null); setShown(next); since = performance.now(); return; }
    pending = setTimeout(() => {
      setLeaving(shown());
      setShown({ state: props.state, opts: props.opts, frame: props.frame });
      since = fadeFrom = performance.now();
    }, Math.max(0, DWELL_MS - (performance.now() - since)));
  }, { defer: true }));
  onCleanup(() => clearTimeout(pending));

  const presetOf = (item: Shown) => {
    if (item.frame) return { speed: 1, opts: item.opts || {}, frame: item.frame };
    const preset = resolvePreset(item.state, SIZE);
    return { speed: preset.speed, opts: { ...preset.opts, ...item.opts }, frame: MODE_FRAMES[preset.mode] };
  };
  const frontPreset = createMemo(() => presetOf(shown()));
  const backPreset = createMemo(() => { const item = leaving(); return item ? presetOf(item) : null; });

  onMount(() => {
    /* The canvas is as many pixels across as its box is on screen (rem-sized, times density and zoom), the 20px geometry
       drawn scaled to fill it; drawn at 20px and stretched, every dot blurred above 100%. */
    let pixels = 0;
    const fit = (side: number) => {
      const next = Math.max(1, Math.min(256, Math.round(side)));
      if (next === pixels) return false;
      pixels = next;
      for (const canvas of [front, back]) canvas.width = canvas.height = pixels;
      return true;
    };
    fit((front.getBoundingClientRect().width || SIZE) * (window.devicePixelRatio || 1));
    const frontContext = front.getContext("2d");
    const backContext = back.getContext("2d");
    if (!frontContext || !backContext) return;
    const tint = createMemo(() => props.tint ? rgbOf(front, props.tint) : undefined);
    const paintOn = (ctx: CanvasRenderingContext2D, preset: ReturnType<typeof presetOf> | null, seconds: number) => {
      ctx.setTransform(pixels / SIZE, 0, 0, pixels / SIZE, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      if (!preset) return;
      paintFrame(ctx, preset.frame(SIZE, seconds * preset.speed, preset.opts), Boolean(front.closest(".dark")), tint());
    };
    const draw = (seconds: number) => {
      const fading = backPreset();
      const progress = fading ? Math.min(1, (performance.now() - fadeFrom) / FADE_MS) : 1;
      if (fading && progress >= 1) setLeaving(null);
      paintOn(frontContext, frontPreset(), seconds);
      paintOn(backContext, progress < 1 ? fading : null, seconds);
      // Written only when it changes: each write is a style recalc, per draw.
      const opacity = String(progress);
      if (front.style.opacity !== opacity) { front.style.opacity = opacity; back.style.opacity = String(1 - progress); }
    };

    // The rate and whether it plays, as last read in the effect: sync also runs from the observers, outside any root,
    // where reading a caller's computed prop would make a computation each time that is never disposed.
    let visible = true, rate = 0, plays = false;
    const player: Player = { draw: (now) => draw(now / 1000), interval: 0, last: 0 };
    const sync = () => {
      player.interval = rate ? 1000 / rate : 0;
      if (plays && visible && document.visibilityState !== "hidden") play(player); else stop(player);
    };
    // Still, it is drawn once for each change of what it shows.
    createEffect(() => {
      frontPreset();
      tint();
      rate = props.rate ?? 0;
      plays = playing();
      if (playing()) draw(performance.now() / 1000);
      else { setLeaving(null); draw(STILL_AT); }
      sync();
    });
    const observer = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); sync(); });
    observer.observe(front);
    // Watched in device pixels so a zoom still reaches it; resizing a canvas clears it, so a resize repaints at once.
    const resized = new ResizeObserver(([entry]) => {
      const side = (entry?.contentRect.width || 0) * (window.devicePixelRatio || 1);
      if (side && fit(side)) draw(plays ? performance.now() / 1000 : STILL_AT);
    });
    try { resized.observe(front, { box: "device-pixel-content-box" }); } catch { resized.observe(front); }
    document.addEventListener("visibilitychange", sync);
    onCleanup(() => {
      stop(player);
      observer.disconnect();
      resized.disconnect();
      document.removeEventListener("visibilitychange", sync);
    });
  });
  return <span class={`ui-orb thinking-orb ${props.class || ""}`} aria-hidden="true">
    <canvas ref={back} />
    <canvas ref={front} />
  </span>;
}
