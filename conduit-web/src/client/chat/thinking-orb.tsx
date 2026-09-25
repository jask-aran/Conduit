import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from "solid-js";
import { MODE_FRAMES, paintFrame, resolvePreset, type ModeFrame, type ModeOpts, type OrbState } from "thinking-orbs/engine";

export type { ModeFrame, ModeOpts, OrbState };

/*
 * A turn's mark: a dotted orb whose motion says what it is doing, drawn by
 * thinking-orbs' canvas engine -- the geometry and painter are the library's,
 * only the loop is Conduit's, since its own component is React. The 20px
 * preset is the one tuned for inline text.
 *
 * Live, it plays, and paints only while on screen and the tab is visible. A
 * change of state is held off until the current one has shown for a moment,
 * then crossfades: the new state fades in over the old as the old fades out,
 * both still moving, so there is never a frame with nothing in it. Paused --
 * a settled turn, or reduced motion -- it is one still frame, and changes
 * without a fade. `frame` replaces the state's geometry outright, for a
 * still drawn in the engine's terms rather than taken from an animation.
 */
const SIZE = 20;
const DWELL_MS = 250;
const FADE_MS = 200;
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

type Shown = { state: OrbState; opts?: ModeOpts; frame?: ModeFrame };

export function ThinkingOrb(props: { state: OrbState; opts?: ModeOpts; frame?: ModeFrame; paused?: boolean; tint?: string; class?: string }) {
  let front!: HTMLCanvasElement;
  let back!: HTMLCanvasElement;
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    const preset = resolvePreset(item.state, SIZE);
    return { ...preset, opts: { ...preset.opts, ...item.opts }, frame: item.frame ?? MODE_FRAMES[preset.mode] };
  };
  const frontPreset = createMemo(() => presetOf(shown()));
  const backPreset = createMemo(() => { const item = leaving(); return item ? presetOf(item) : null; });

  onMount(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const canvas of [front, back]) canvas.width = canvas.height = Math.round(SIZE * dpr);
    const frontContext = front.getContext("2d");
    const backContext = back.getContext("2d");
    if (!frontContext || !backContext) return;
    const tint = createMemo(() => props.tint ? rgbOf(front, props.tint) : undefined);
    const paintOn = (ctx: CanvasRenderingContext2D, preset: ReturnType<typeof presetOf> | null, seconds: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
      front.style.opacity = String(progress);
      back.style.opacity = String(1 - progress);
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
      frontPreset();
      tint();
      if (playing()) draw(performance.now() / 1000);
      else { setLeaving(null); draw(STILL_AT); }
      sync();
    });
    const observer = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); sync(); });
    observer.observe(front);
    document.addEventListener("visibilitychange", sync);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    });
  });
  return <span class={`thinking-orb ${props.class || ""}`} aria-hidden="true">
    <canvas ref={back} />
    <canvas ref={front} />
  </span>;
}
