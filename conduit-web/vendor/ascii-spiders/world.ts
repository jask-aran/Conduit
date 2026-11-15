// @ts-nocheck -- vendored as published (see LICENSE and COMMIT beside this file); checked upstream under its own compiler options
/**
 * The spiders' wall: orb webs strung over the whole page wherever there is room, the weavers that live on
 * them, the flies they catch, and a jumping spider loose on the wall.
 *
 * Webs: no grid. They come in mixed sizes, biggest first, and each goes into the emptiest part of the page
 * left (best of many random candidates, by clearance from the webs already there), so together they cover
 * it without piling up. Frames are irregular polygons at odd angles, and run off the edges. One web always
 * hangs in the bottom-left. Spiders take the first webs; the smaller ones left over are old and empty, and
 * fainter.
 *
 * Move through a web to pluck it: the silk rings, and its spider turns toward the tug. A fly dropped on
 * silk sticks there and the spider comes for it.
 */
import { Swarm } from "./flies";
import { Jumper } from "./jumper";
import { clamp, lerp, rand } from "./math";
import type { SpiderKind } from "./spider";
import { Weaver } from "./weaver";
import { OrbWeb } from "./web";

export type { SpiderKind };

/** Which orb weavers to put on the wall, one per web; size scales the body (default 1). */
export interface SpiderSpec {
  kind: SpiderKind;
  size?: number;
}

export interface WorldOptions {
  /** Fly population. 0 leaves none. Default: scaled to the area. */
  flies?: number;
  /**
   * Total webs. Webs past the roster are empty. Default: scaled to the area, and at least one per spider
   * when a roster is given (the default roster just fills what the area holds).
   */
  webs?: number;
  /** A jumping spider loose on the wall. Default true. */
  jumper?: boolean;
  /** Keep web hubs out of a soft ellipse in the middle, for a headline. Default false. */
  clearCentre?: boolean;
  /** Every weaver starts on a bare frame and builds its web. Default false: most start at home. */
  build?: boolean;
  /** The first web always hangs in the bottom-left. Default true. */
  corner?: boolean;
}

export interface Pointer {
  x: number;
  y: number;
  /** Where it was last step, so a move plucks the silk it crossed. */
  lx: number;
  ly: number;
  active: boolean;
}

/** A spark where the jumping spider took a fly. */
export interface Heat {
  x: number;
  y: number;
  life: number;
}

/** The bottom-left one, then the rest. */
const DEFAULT_SPIDERS: SpiderSpec[] = [
  { kind: "araneus" },
  { kind: "nephila" },
  { kind: "argiope" },
  { kind: "nephila" },
  { kind: "araneus" },
  { kind: "argiope" },
];

interface Site {
  x: number;
  y: number;
  R: number;
}

export class World {
  time = 0;
  width = 0;
  height = 0;
  /** The ASCII cell, so webs space their threads in glyphs. */
  cw = 12;
  ch = 17;
  webs: OrbWeb[] = [];
  weavers: Weaver[] = [];
  jumper: Jumper | null = null;
  readonly swarm: Swarm;
  heat: Heat[] = [];
  readonly pointer: Pointer = { x: 0, y: 0, lx: 0, ly: 0, active: false };
  private readonly spiders: SpiderSpec[];
  /** A roster was asked for: every spider in it gets a web. */
  private readonly cast: boolean;

  constructor(spiders?: SpiderSpec[], private options: WorldOptions = {}) {
    this.spiders = spiders ?? DEFAULT_SPIDERS;
    this.cast = spiders !== undefined;
    this.swarm = new Swarm(this);
  }

  /** Lay the wall out for a W × H canvas. `settled` is for a single still frame: every web finished. */
  layout(W: number, H: number, cw: number, ch: number, settled: boolean) {
    this.width = W;
    this.height = H;
    this.cw = cw;
    this.ch = ch;
    const { options } = this;
    const ms = Math.min(W, H);
    const corner = options.corner ?? true;
    const count = clamp(Math.round((W * H) / 215000), 2, 10);
    const room = count + (corner ? 1 : 0);
    const total = Math.max(0, Math.round(options.webs ?? (this.cast ? Math.max(this.spiders.length, room) : room)));
    const roster = this.spiders.slice(0, total);
    const free = total - (corner && total > 0 ? 1 : 0);
    // Sizes from the area each free web would get, never more than the canvas can hold (a lone web keeps its
    // frame inside it).
    const base = Math.min(Math.sqrt((W * H) / Math.max(1, free)) * 0.5, ms * (free <= 1 ? 0.34 : 0.45));
    const sizes = Array.from({ length: free }, (_, i) => base * lerp(1.3, 0.72, free > 1 ? i / (free - 1) : 0) * rand(0.92, 1.08));
    // One always hangs in the bottom-left; the rest find their own room around it.
    const placed: Site[] = [];
    if (corner && total > 0) placed.push({ x: rand(0.12, 0.2) * W, y: rand(0.72, 0.8) * H, R: base * rand(0.92, 1.02) });
    const full = W > 700 && H > 500;
    for (const R of sizes) {
      let best: (Site & { score: number }) | null = null;
      for (let k = 0; k < 300; k++) {
        const x = rand(0.06, 0.94) * W;
        const y = rand(0.08, 0.94) * H;
        // On a full page, clear of a floating nav bar at the top centre.
        if (full && y < 130 && Math.abs(x - W / 2) < 190) continue;
        if (options.clearCentre && ((x - W / 2) / (W * 0.32)) ** 2 + ((y - H / 2) / (H * 0.26)) ** 2 < 1) continue;
        let score = Math.min(x, W - x, y, H - y) / (R * 0.55); // the page edge counts, softly
        for (const p of placed) score = Math.min(score, Math.hypot(x - p.x, y - p.y) / (p.R + R));
        if (!best || score > best.score) best = { x, y, R, score };
      }
      if (best) placed.push(best);
    }

    this.webs = [];
    this.weavers = [];
    placed.forEach((p, i) => {
      const spec = roster[i];
      const kind = spec?.kind ?? null;
      // Empty webs are old and faint, unless the wall has no spiders at all to set them off.
      const depth = kind || !roster.length ? rand(0.78, 1) : rand(0.5, 0.6);
      const web = new OrbWeb({ cx: p.x, cy: p.y, radius: p.R, depth, cw, ch, stab: kind === "argiope" });
      this.webs.push(web);
      // Spiders vary a little with their webs, not as much.
      if (kind) this.weavers.push(new Weaver(this, web, kind, lerp(base, p.R, 0.35) * 0.31 * (spec.size ?? 1)));
      else web.buildInstant();
    });
    this.webs.sort((a, b) => a.depth - b.depth);
    // Far to near, so nearer spiders draw over farther ones.
    const home = corner ? (this.weavers[0] ?? null) : null;
    this.weavers.sort((a, b) => a.web.depth - b.web.depth);

    if (options.build) {
      for (const w of this.weavers) w.startAt(0);
    } else {
      // Most are home on finished webs; one is partway round its capture spiral, one has only just begun.
      // The bottom-left one always starts at home, so it's there from the first frame.
      const busy = this.weavers.filter((w) => w !== home);
      for (const w of this.weavers) {
        const route = w.web.route.length;
        const k = busy.length - 1 - busy.indexOf(w); // 0 is the nearest
        if (!settled && w !== home && k === 1) w.startAt(Math.round(w.web.spiralStart + (route - w.web.spiralStart) * 0.3));
        else if (!settled && w !== home && k === 3) w.startAt(Math.round(w.web.spiralStart * 0.35));
        else w.startAt(route);
      }
    }

    this.jumper = null;
    if (options.jumper ?? true) {
      this.jumper = new Jumper(this, clamp(ms * 0.1, 50, 104));
      this.jumper.place(W * 0.62, H * 0.74);
    }

    this.swarm.populate(Math.max(0, Math.round(options.flies ?? clamp(Math.round((W * H) / 140000), 5, 12))));
    // An opening catch: one fly is headed for the near web.
    const near = this.weavers[this.weavers.length - 1];
    const f = this.swarm.flies[0];
    if (!settled && near && f) {
      const web = near.web;
      const a = rand(-0.6, 0.6) + (Math.random() < 0.5 ? 0 : Math.PI);
      const r = web.rin + (web.radius * 0.86 - web.rin) * 0.55;
      f.aim = { x: web.cx + Math.cos(a) * r, y: web.cy + Math.sin(a) * r };
      f.aimWeb = web;
      f.x = f.ox = clamp(web.cx + Math.cos(a) * web.outer * 1.25, 10, W - 10);
      f.y = f.oy = clamp(web.cy + Math.sin(a) * web.outer * 1.25, 10, H - 10);
      f.h = Math.atan2(f.aim.y - f.y, f.aim.x - f.x);
    }
    if (settled) for (const fly of this.swarm.flies) (fly.mode = "rest"), (fly.timer = 99);
  }

  step(dt: number) {
    this.time += dt;
    const p = this.pointer;
    if (p.active) {
      const vx = p.x - p.lx;
      const vy = p.y - p.ly;
      if (vx || vy) {
        for (const web of this.webs) {
          const touched = web.pluck(p.x, p.y, vx, vy, this.cw * 1.15);
          if (touched > 0.2) this.weavers.find((w) => w.web === web)?.feel(p.x, p.y, touched);
        }
      }
    }
    p.lx = p.x;
    p.ly = p.y;
    for (const w of this.weavers) w.update(dt);
    this.jumper?.update(dt);
    this.swarm.update(dt);
    for (const w of this.weavers) w.weigh();
    for (const web of this.webs) web.step(this.time);
    for (const b of this.heat) b.life -= dt * 1.4;
    this.heat = this.heat.filter((b) => b.life > 0);
  }

  /** Drop a fly at (x, y): onto silk, it sticks there. */
  release(x: number, y: number) {
    return this.swarm.release(x, y);
  }

  /** A spark of glyphs where a fly was taken. */
  burst(x: number, y: number) {
    const { cw, ch } = this;
    for (let i = 0; i < 6; i++) this.heat.push({ x: x + rand(-1.6, 1.6) * cw, y: y + rand(-1.2, 1.2) * ch, life: rand(0.8, 1.3) });
  }
}
