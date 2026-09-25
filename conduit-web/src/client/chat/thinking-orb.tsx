import { createMemo, createEffect, onCleanup, onMount } from "solid-js";
import { MODE_FRAMES, paintFrame, resolvePreset, type OrbState } from "thinking-orbs/engine";

export type { OrbState };

/*
 * A turn's live mark: a dotted orb whose motion says what it is doing, drawn
 * by thinking-orbs' canvas engine -- the geometry and painter are the
 * library's, only the loop is Conduit's, since its own component is React.
 * The 20px preset is the one tuned for inline text; CSS sizes the box.
 * It paints only while on screen and the tab is visible, and holds one
 * still frame under reduced motion.
 */
const SIZE = 20;

export function ThinkingOrb(props: { state: OrbState; class?: string }) {
  let canvas!: HTMLCanvasElement;
  const preset = createMemo(() => resolvePreset(props.state, SIZE));
  onMount(() => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = Math.round(SIZE * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const draw = (seconds: number) => {
      const { mode, speed, opts } = preset();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SIZE, SIZE);
      paintFrame(ctx, MODE_FRAMES[mode](SIZE, seconds * speed, opts), Boolean(canvas.closest(".dark")));
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      createEffect(() => { preset(); draw(0.6); });
      return;
    }
    let frame = 0;
    let visible = true;
    const loop = () => { draw(performance.now() / 1000); frame = requestAnimationFrame(loop); };
    const sync = () => {
      cancelAnimationFrame(frame);
      if (visible && document.visibilityState !== "hidden") frame = requestAnimationFrame(loop);
    };
    const observer = new IntersectionObserver(([entry]) => { visible = Boolean(entry?.isIntersecting); sync(); });
    observer.observe(canvas);
    document.addEventListener("visibilitychange", sync);
    draw(performance.now() / 1000);
    sync();
    onCleanup(() => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    });
  });
  return <canvas ref={canvas} class={props.class} aria-hidden="true" />;
}
