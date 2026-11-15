// @ts-nocheck -- vendored as published (see LICENSE and COMMIT beside this file); checked upstream under its own compiler options
/**
 * Flies: the prey. Each wanders on smooth noise with the odd dart, shies from the cursor, now and then lands
 * to rest, and blunders into webs. Crossing a thread of capture spiral may stick it there; a stuck fly
 * struggles, shaking the silk so the spider feels where it is, and tears free if left long enough.
 *
 * mode: fly · rest · stuck · wrapped (carried) · held (being eaten at the hub) · gone (waiting to respawn)
 */
import { TAU, angleDiff, clamp, noise1, rand, randInt, type Vec } from "./math";
import { SPIRAL, type OrbWeb, type ThreadPoint } from "./web";
import type { Pointer, World } from "./world";

const STICK = 0.07;

export type FlyMode = "fly" | "rest" | "stuck" | "wrapped" | "held" | "gone";

export class Fly {
  x: number;
  y: number;
  /** Where it was last frame, so a web can tell whether it crossed a thread. */
  ox: number;
  oy: number;
  h = rand(0, TAU);
  v = rand(60, 120);
  readonly seed = randInt(1, 1e5);
  phase = rand(0, TAU);
  readonly depth = rand(0.55, 1);
  mode: FlyMode = "fly";
  timer = 0;
  /** The opening catch: a point on a web it flies straight for, and the web that takes it. */
  aim: Vec | null = null;
  aimWeb: OrbWeb | null = null;
  /** Stuck: which web, which of its builds, which thread, how far along. */
  web: OrbWeb | null = null;
  gen = 0;
  link = -1;
  at = 0;
  /** How far the spider has wrapped it, and how far it has been eaten. */
  wrap = 0;
  digest = 0;
  hunted = false;
  respawn = 0;
  /** Seconds left before a stuck fly tears free. */
  escape = 0;

  constructor(x: number, y: number) {
    this.x = this.ox = x;
    this.y = this.oy = y;
  }

  free(speed = 220) {
    if (this.web) {
      const i = this.web.prey.indexOf(this);
      if (i >= 0) this.web.prey.splice(i, 1);
    }
    this.mode = "fly";
    this.web = null;
    this.hunted = false;
    this.wrap = 0;
    this.v = speed;
    this.h = rand(0, TAU);
  }

  stick(web: OrbWeb, link: number, at: number) {
    this.mode = "stuck";
    this.web = web;
    this.gen = web.gen;
    this.link = link;
    this.at = at;
    this.aim = null;
    this.hunted = false;
    this.wrap = 0;
    this.digest = 0;
    this.timer = 0;
    this.escape = rand(16, 26);
    web.prey.push(this);
    web.jolt(link, at, 3);
  }
}

export class Swarm {
  flies: Fly[] = [];

  constructor(private world: World) {}

  populate(n: number) {
    const { width: W, height: H } = this.world;
    this.flies = [];
    for (let i = 0; i < n; i++) this.flies.push(new Fly(rand(0.05, 0.95) * W, rand(0.1, 0.9) * H));
  }

  /** A fly let loose at the pointer; dropped onto silk, it is caught there. */
  release(x: number, y: number) {
    let f = this.flies.find((o) => o.mode === "gone");
    if (!f) {
      if (this.flies.length >= 26) f = this.flies.find((o) => o.mode === "fly" || o.mode === "rest");
      if (!f) this.flies.push((f = new Fly(x, y)));
    }
    if (f.web) f.free();
    f.x = f.ox = x;
    f.y = f.oy = y;
    f.mode = "fly";
    f.v = rand(140, 200);
    f.h = rand(0, TAU);
    const w = this.world;
    for (const web of [...w.webs].reverse()) {
      const hit = web.snap(x, y, w.cw * 0.9, tmpHit);
      if (hit && web.kind[hit.link] === SPIRAL) {
        f.stick(web, hit.link, hit.t);
        return f;
      }
    }
    return f;
  }

  update(dt: number) {
    const w = this.world;
    const { width: W, height: H, time: t, pointer } = w;
    for (const f of this.flies) {
      f.phase += dt;
      switch (f.mode) {
        case "fly":
          this.fly(f, dt, W, H, t, pointer);
          break;
        case "rest":
          f.timer -= dt;
          if (f.timer <= 0 || (pointer.active && Math.hypot(pointer.x - f.x, pointer.y - f.y) < 90)) f.free(200);
          break;
        case "stuck": {
          const web = f.web;
          if (!web || web.gen !== f.gen || web.state[f.link] !== 1) {
            f.free();
            break;
          }
          web.pos(f.link, f.at, f);
          if (f.wrap > 0) break;
          f.timer -= dt;
          if (f.timer <= 0) {
            web.jolt(f.link, f.at, rand(1, 2.6) * (web.radius / 300));
            f.timer = rand(0.06, 0.45);
          }
          if (!f.hunted) f.escape -= dt;
          if (f.escape <= 0) {
            web.cut(f.link, true);
            f.free(260);
          }
          break;
        }
        case "gone":
          f.respawn -= dt;
          if (f.respawn <= 0) this.enter(f, W, H);
          break;
      }
    }
  }

  private fly(f: Fly, dt: number, W: number, H: number, t: number, pointer: Pointer) {
    f.ox = f.x;
    f.oy = f.y;
    // Wander on smooth noise, with the odd dart.
    f.h += noise1(t * 0.9 + f.seed, f.seed) * 3.4 * dt + (Math.random() - 0.5) * 5 * dt;
    let vt = 80 + 55 * noise1(t * 0.6 + f.seed * 0.37, f.seed + 1);
    if (Math.random() < dt * 0.5) {
      f.h += rand(-2.2, 2.2);
      f.v = rand(180, 250);
    }
    let want: number | null = null;
    let rate = 0;
    if (pointer.active) {
      const d = Math.hypot(f.x - pointer.x, f.y - pointer.y);
      if (d < 120) (want = Math.atan2(f.y - pointer.y, f.x - pointer.x)), (rate = 9), (vt = 230);
    }
    if (want === null && f.aim) (want = Math.atan2(f.aim.y - f.y, f.aim.x - f.x)), (rate = 6), (vt = 130);
    const m = 36;
    if (want === null && (f.x < m || f.x > W - m || f.y < m || f.y > H - m)) (want = Math.atan2(H / 2 - f.y, W / 2 - f.x)), (rate = 4);
    if (want !== null) f.h += clamp(angleDiff(f.h, want), -rate * dt, rate * dt);
    f.v += (vt - f.v) * Math.min(1, dt * 2.2);
    f.x = clamp(f.x + Math.cos(f.h) * f.v * dt, -20, W + 20);
    f.y = clamp(f.y + Math.sin(f.h) * f.v * dt, -20, H + 20);

    for (const web of this.world.webs) {
      const hit = web.catches(f.ox, f.oy, f.x, f.y, tmpHit);
      // Only the aimed web takes the opening fly; otherwise any web may.
      if (hit && (f.aim ? f.aimWeb === web : Math.random() < STICK * (0.4 + 0.6 * web.depth))) {
        f.stick(web, hit.link, hit.t);
        return;
      }
    }
    // Settle for a rest now and then, away from the edges.
    if (!f.aim && f.x > m && f.x < W - m && f.y > m && f.y < H - m && Math.random() < dt * 0.045) {
      f.mode = "rest";
      f.timer = rand(2.5, 7);
    }
  }

  /** A new fly drifts in from an edge. */
  private enter(f: Fly, W: number, H: number) {
    const side = randInt(0, 3);
    const along = rand(0.15, 0.85);
    f.x = f.ox = side === 0 ? -10 : side === 1 ? W + 10 : along * W;
    f.y = f.oy = side === 2 ? -10 : side === 3 ? H + 10 : along * H;
    f.web = null;
    f.mode = "fly";
    f.h = Math.atan2(H / 2 - f.y, W / 2 - f.x) + rand(-0.6, 0.6);
    f.v = 120;
    f.wrap = 0;
    f.digest = 0;
    f.hunted = false;
  }
}

const tmpHit: ThreadPoint = { link: -1, t: 0 };
