// @ts-nocheck -- vendored as published (see LICENSE and COMMIT beside this file); checked upstream under its own compiler options
import { AsciiRenderer, type Stage, type Theme } from "./renderer";
import { World, type SpiderSpec } from "./world";

const STEP = 1 / 60;
const MAX_STEPS = 4;

export interface SpiderOptions {
  /** Fly population. 0 leaves none. Default: scaled to the canvas area. */
  flies?: number;
  /** Black stage (default) or paper. */
  theme?: Theme;
  /** How much to draw: "frame", "radials", "spiral" or "full" (default). The blueprint pages step through these. */
  stage?: Stage;
  /** Moving the cursor plucks the silk, and a click drops a fly. Default true. */
  pointer?: boolean;
  /** Settle the webs, draw one frame, and stop. Reduced-motion users get this regardless. */
  still?: boolean;
  /** A jumping spider loose on the wall. Default true. */
  jumper?: boolean;
  /** Total webs; the ones past the spiders are empty. 0 leaves only the jumper and the flies. Default: scaled to the area. */
  webs?: number;
  /** Keep web hubs out of a soft ellipse in the middle, for a headline. Default false. */
  clearCentre?: boolean;
  /** Every spider starts on a bare frame and builds its web from scratch. Default false. */
  build?: boolean;
  /** The first web always hangs in the bottom-left. Default true; false places every web by room alone. */
  corner?: boolean;
  /** Drive the loop from a 16 ms timer instead of animation frames (headless browsers barely fire them). */
  clock?: boolean;
}

/**
 * Wires World + AsciiRenderer to a canvas: fixed-timestep loop, resize,
 * pointer input, pausing off-screen, and prefers-reduced-motion.
 */
export class SpiderEngine {
  readonly world: World;
  readonly renderer: AsciiRenderer;
  private raf = 0;
  private timer = 0;
  private last = 0;
  private acc = 0;
  private visible = true;
  private size = "";
  private still: boolean;
  private pointer: boolean;
  private clock: boolean;
  private reducedMotion: MediaQueryList;
  private resizeObserver: ResizeObserver;
  private intersectionObserver: IntersectionObserver;
  private disposed = false;

  constructor(private canvas: HTMLCanvasElement, spiders?: SpiderSpec[], options: SpiderOptions = {}) {
    this.world = new World(spiders, {
      flies: options.flies,
      webs: options.webs,
      jumper: options.jumper,
      clearCentre: options.clearCentre,
      build: options.build,
      corner: options.corner,
    });
    this.renderer = new AsciiRenderer(canvas);
    this.renderer.setFontFamily(getComputedStyle(canvas).fontFamily);
    this.renderer.setTheme(options.theme ?? "dark");
    this.renderer.stage = options.stage ?? "full";
    this.still = options.still ?? false;
    this.pointer = options.pointer ?? true;
    this.clock = options.clock ?? false;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.intersectionObserver = new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      this.schedule();
    });
    this.intersectionObserver.observe(canvas);

    this.reducedMotion.addEventListener("change", this.onMotionPreference);
    document.addEventListener("visibilitychange", this.onVisibility);
    if (this.pointer) {
      window.addEventListener("pointermove", this.onPointerMove, { passive: true });
      window.addEventListener("pointerdown", this.onPointerDown, { passive: true });
      document.documentElement.addEventListener("pointerleave", this.onPointerLeave);
      window.addEventListener("blur", this.onPointerLeave);
    }

    this.resize();
    // Canvas text can't trigger a webfont load; once the mono face is in, redraw.
    document.fonts?.load(`600 16px ${getComputedStyle(canvas).fontFamily}`).then(() => {
      if (!this.disposed) this.renderer.render(this.world);
    });
    this.schedule();
  }

  destroy() {
    this.disposed = true;
    this.stop();
    this.resizeObserver.disconnect();
    this.intersectionObserver.disconnect();
    this.reducedMotion.removeEventListener("change", this.onMotionPreference);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerdown", this.onPointerDown);
    document.documentElement.removeEventListener("pointerleave", this.onPointerLeave);
    window.removeEventListener("blur", this.onPointerLeave);
  }

  /** A single frame instead of a loop: asked for, or the user's motion preference. */
  private get frozen() {
    return this.still || this.reducedMotion.matches;
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    // Webs are strung for a size; only lay the wall out again when it really changes.
    const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
    if (size === this.size) return;
    this.size = size;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.resize(rect.width, rect.height, dpr);
    this.world.layout(rect.width, rect.height, this.renderer.cellWidth, this.renderer.cellHeight, this.frozen);
    if (this.frozen) for (let i = 0; i < 120; i++) this.world.step(STEP);
    this.renderer.render(this.world);
  }

  private stop() {
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.raf = 0;
    this.timer = 0;
  }

  private schedule() {
    this.stop();
    if (this.disposed) return;
    if (!this.visible || document.hidden || this.frozen) {
      this.renderer.render(this.world);
      return;
    }
    this.last = performance.now();
    if (this.clock) this.timer = window.setInterval(() => this.tick(performance.now()), 16);
    else this.raf = requestAnimationFrame(this.frame);
  }

  /** Renders drawn, so a reader copying the canvas can skip frames with nothing new. (Conduit) */
  frames = 0;
  private frame = (now: number) => {
    this.tick(now);
    this.raf = requestAnimationFrame(this.frame);
  };

  private tick(now: number) {
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < MAX_STEPS) {
      this.world.step(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.acc = 0;
    // Conduit: drawn only when the world has stepped (60 a second); a faster display would redraw the same frame.
    if (steps) { this.renderer.render(this.world); this.frames++; }
  }

  private onMotionPreference = () => {
    // Going still lays the wall out again, settled, so the frame shows finished webs.
    if (this.frozen) this.size = "";
    this.resize();
    this.schedule();
  };

  private onVisibility = () => this.schedule();

  private toLocal(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
    return { x, y, inside };
  }

  private onPointerMove = (e: PointerEvent) => {
    const { x, y, inside } = this.toLocal(e);
    const p = this.world.pointer;
    if (!p.active) (p.lx = x), (p.ly = y);
    p.x = x;
    p.y = y;
    p.active = inside && (e.pointerType !== "touch" || e.pressure > 0);
  };

  private onPointerDown = (e: PointerEvent) => {
    const { x, y, inside } = this.toLocal(e);
    if (inside && !this.frozen) this.world.release(x, y);
  };

  private onPointerLeave = () => {
    this.world.pointer.active = false;
  };
}
