import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { MODE_FRAMES, paintFrame, resolvePreset, type OrbState } from "thinking-orbs/engine";

export type { OrbState };

/*
 * A turn's mark: a dotted orb whose motion says what it is doing, drawn by
 * thinking-orbs' canvas engine -- the geometry and painter are the library's,
 * only the loop is Conduit's, since its own component is React. The 20px
 * preset is the one tuned for inline text.
 *
 * Live, it plays, and paints only while on screen and the tab is visible. A
 * change of state is held off until the current one has shown for a moment,
 * then dips through a short fade, so quick tool calls do not flicker it.
 * Paused -- a settled turn, or reduced motion -- it is one still frame.
 */
const SIZE = 20;
const DWELL_MS = 800;
const FADE_MS = 90;
const STILL_AT = 0.6;

/* A CSS colour, var() included, as the painter's RGB: resolved on the canvas
   itself, then read back off a one-pixel fill. */
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

export function ThinkingOrb(props: { state: OrbState; paused?: boolean; tint?: string; class?: string }) {
  let canvas!: HTMLCanvasElement;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const playing = () => !props.paused && !reduced;

  const [shown, setShown] = createSignal(props.state);
  const [fading, setFading] = createSignal(false);
  let since = performance.now();
  let pending: ReturnType<typeof setTimeout> | undefined;
  createEffect(on(() => props.state, (next) => {
    clearTimeout(pending);
    setFading(false);
    if (next === shown()) return;
    const settle = () => { setShown(props.state); since = performance.now(); setFading(false); };
    if (!playing()) return settle();
    pending = setTimeout(() => {
      setFading(true);
      pending = setTimeout(settle, FADE_MS);
    }, Math.max(0, DWELL_MS - (performance.now() - since)));
  }, { defer: true }));
  onCleanup(() => clearTimeout(pending));

  const preset = createMemo(() => resolvePreset(shown(), SIZE));

  onMount(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = Math.round(SIZE * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const tint = createMemo(() => props.tint ? rgbOf(canvas, props.tint) : undefined);
    const draw = (seconds: number) => {
      const { mode, speed, opts } = preset();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      paintFrame(ctx, MODE_FRAMES[mode](SIZE, seconds * speed, opts), Boolean(canvas.closest(".dark")), tint());
    };

    let frame = 0;
    let visible = true;
    const loop = () => { draw(performance.now() / 1000); frame = requestAnimationFrame(loop); };
    const sync = () => {
      cancelAnimationFrame(frame);
      if (playing() && visible && document.visibilityState !== "hidden") frame = requestAnimationFrame(loop);
    };
    // Still, it is drawn once for each change of what it shows.
    createEffect(() => {
      preset();
      tint();
      if (playing()) draw(performance.now() / 1000);
      else draw(STILL_AT);
      sync();
    });
    const observer = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); sync(); });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    });
  });
  return <canvas ref={canvas} class={props.class} data-fading={fading() ? "true" : undefined} aria-hidden="true" />;
}
