// @ts-nocheck -- vendored as published (see LICENSE and COMMIT beside this file); checked upstream under its own compiler options
/**
 * An orb weaver and its web, as one life:
 *
 *   build    walk the web's route, laying each thread as it goes
 *   idle     hang head-down at the hub; turn toward anything that tugs the silk
 *   hunt     run out along the nearest radial to a struggling fly
 *   wrap     circle it, swathing it in silk
 *   carry    take the bundle back to the hub and feed on it there
 *   eat      once the web is old, torn or has fed it enough, walk the route backwards, reeling it in
 *   move     shift a little and start again
 *
 * It glides rather than marches: speed eases in and out, brakes into sharp corners and for the end of a
 * run, and slows to touch each radial as the spiral goes down, so the build has a rhythm. Heading is
 * sprung, so the body swings into each turn. While it lays a thread it holds the loose end, so the new
 * silk doesn't swing about under it.
 */
import type { Fly } from "./flies";
import { angleDiff, clamp, lerp, rand, type Vec } from "./math";
import { Spider, type Leg, type SilkHit, type Snap, type SpiderKind } from "./spider";
import { SPIRAL, type OrbWeb } from "./web";
import type { World } from "./world";

const DOWN = Math.PI / 2;
// Laying speeds per kind of thread (px/s at a 300 px web); walking existing silk is faster. Unhurried:
// the easing, braking and sprung turns carry the smoothness, not the pace.
const LAY_SPEED = [0, 70, 66, 72, 42, 46, 38];
const WALK = 80;
const HUNT = 85;
const CARRY = 60;
const WRAP = 3.6;

export type WeaverState = "build" | "idle" | "hunt" | "wrap" | "carry" | "return" | "eat" | "move";

export class Weaver {
  readonly spider: Spider;
  state: WeaverState = "build";
  /** Where along the web's route it is. */
  step = 0;
  /** Current speed along the silk, eased. */
  v = 0;
  /** A short slowdown at each radial while the spiral goes down. */
  tap = 0;
  /** Node path out to prey and back, and how many of its waypoints are passed. */
  path: number[] | null = null;
  wp = 0;
  prey: Fly | null = null;
  /** The meal hanging off the spinnerets at the hub. */
  bundle: Fly | null = null;
  catches = 0;
  age = 0;
  life = rand(150, 260);
  /** How strongly, and from where, something last tugged the silk. */
  alert = 0;
  alertDir = DOWN;
  /** The node the thread being laid (or reeled in) runs from, or -1. */
  partial = -1;
  heading: number | null = null;
  goal: Vec = { x: 0, y: 0 };
  private timer = 0;
  private spin = 0;
  private wrapFrom: Vec = { x: 0, y: 0 };
  readonly snap: Snap;
  readonly land: (leg: Leg) => void;

  constructor(private world: World, readonly web: OrbWeb, kind: SpiderKind, size = web.radius * 0.31) {
    this.spider = new Spider(kind, size);
    this.snap = (x: number, y: number, r: number, out: SilkHit) => {
      const hit = this.web.snap(x, y, r, out);
      if (hit) hit.web = this.web;
      return hit;
    };
    this.land = (leg: Leg) => this.web.jolt(leg.link, leg.at, 0.1 * this.scale);
  }

  get scale() {
    return clamp(this.web.radius / 300, 0.5, 1.25);
  }

  /** Start partway through the route: 0 is a bare scaffold, route.length a finished web. */
  startAt(step: number) {
    const web = this.web;
    const st = web.route[step];
    web.held = st && st.lay ? st.from : -1;
    web.buildInstant(step);
    if (step >= web.route.length) {
      this.state = "idle";
      this.spider.place(web.x[web.hub], web.y[web.hub], DOWN, this.snap);
      this.age = rand(0, this.life * 0.4);
    } else {
      this.state = "build";
      this.step = step;
      const n = web.route[step].from;
      const to = web.route[step].to;
      this.spider.place(web.x[n], web.y[n], Math.atan2(web.y[to] - web.y[n], web.x[to] - web.x[n]), this.snap);
    }
  }

  /** Something tugged the silk at (x, y). */
  feel(x: number, y: number, amount: number) {
    if (this.state !== "idle") return;
    const web = this.web;
    this.alert = Math.min(1, this.alert + amount * 0.08);
    this.alertDir = Math.atan2(y - web.y[web.hub], x - web.x[web.hub]);
  }

  /** Walk the body toward (tx, ty). Returns the leftover distance once there, or -1 on the way. */
  private advance(tx: number, ty: number, dist: number) {
    const sp = this.spider;
    const dx = tx - sp.x;
    const dy = ty - sp.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-3) this.heading = Math.atan2(dy, dx);
    if (d <= dist) {
      sp.x = tx;
      sp.y = ty;
      return dist - d;
    }
    sp.x += (dx / d) * dist;
    sp.y += (dy / d) * dist;
    return -1;
  }

  /**
   * The speed to aim for, heading to (tx, ty) and then on to (nx, ny): full speed on the straight, easing
   * down as a sharp corner (or the end of the run) comes up.
   */
  private cruise(vmax: number, tx: number, ty: number, nx: number | null, ny: number | null) {
    const sp = this.spider;
    const d = Math.hypot(tx - sp.x, ty - sp.y);
    let through = 0;
    if (nx !== null && ny !== null) {
      const turn = Math.abs(angleDiff(Math.atan2(ty - sp.y, tx - sp.x), Math.atan2(ny - ty, nx - tx)));
      through = 1 - Math.min(1, turn / 2.2);
    }
    return vmax * lerp(0.2 + 0.8 * through, 1, clamp(d / (sp.B * 1.2), 0, 1));
  }

  /** Ease the current speed toward `vt`; the distance to cover this frame. */
  private pace(vt: number, vmax: number, dt: number) {
    this.v += (vt - this.v) * (1 - Math.exp(-dt * 4.5));
    return Math.max(this.v, vmax * 0.06) * dt;
  }

  /**
   * Glide through waypoints: pts(k) is the k-th one ahead ([x, y]), null past the last. `this.wp` counts
   * the ones passed. Returns true at the end.
   */
  private glide(dt: number, vmax: number, pts: (k: number) => [number, number] | null) {
    const a = pts(0);
    if (!a) return true;
    const b = pts(1);
    let dist = this.pace(this.cruise(vmax, a[0], a[1], b ? b[0] : null, b ? b[1] : null), vmax, dt);
    while (dist > 0) {
      const p = pts(0);
      if (!p) return true;
      const left = this.advance(p[0], p[1], dist);
      if (left < 0) return false;
      dist = left;
      this.wp++;
    }
    return pts(0) === null;
  }

  update(dt: number) {
    const sp = this.spider;
    const web = this.web;
    const px = sp.x;
    const py = sp.y;
    this.heading = null;
    this.partial = -1;
    const s = this.scale;

    switch (this.state) {
      case "build":
      case "eat": {
        const back = this.state === "eat";
        const dir = back ? -1 : 1;
        this.tap = Math.max(0, this.tap - dt);
        const route = web.route;
        const st = route[this.step];
        if (st) {
          const to = back ? st.from : st.to;
          const nst = route[this.step + dir];
          const nn = nst ? (back ? nst.from : nst.to) : -1;
          const vmax = (st.lay ? LAY_SPEED[web.kind[st.link]] : WALK) * s * (back ? 1.4 : 1) * (this.tap > 0 ? 0.35 : 1);
          let dist = this.pace(this.cruise(vmax, web.x[to], web.y[to], nn >= 0 ? web.x[nn] : null, nn >= 0 ? web.y[nn] : null), vmax, dt);
          while (dist > 0) {
            const cur = route[this.step];
            if (!cur) break;
            const target = back ? cur.from : cur.to;
            // Reeling in: the thread ahead is taken up as the spider walks it.
            if (back && cur.lay && web.state[cur.link] === 1) web.cut(cur.link);
            const left = this.advance(web.x[target], web.y[target], dist);
            if (left < 0) {
              // The thread still to lay (or still to reel in) runs from the last node to the body.
              if (cur.lay) this.partial = cur.from;
              break;
            }
            dist = left;
            if (!back && cur.lay) {
              web.lay(cur.link);
              // A touch at each radial while the sticky spiral goes down.
              if (web.kind[cur.link] === SPIRAL) this.tap = 0.1;
            }
            this.step += dir;
          }
        }
        // Hold the loose end while laying, so the new thread doesn't swing about under the spider.
        web.held = !back && this.partial >= 0 && web.deg[this.partial] <= 1 ? this.partial : -1;
        if (!back && this.step >= route.length) {
          this.state = "idle";
          this.age = 0;
          this.catches = 0;
        } else if (back && this.step < 0) {
          this.state = "move";
          this.relocate();
        }
        break;
      }

      case "move": {
        this.wp = 0;
        if (this.glide(dt, WALK * 0.7 * s, (k) => (k === 0 ? [this.goal.x, this.goal.y] : null))) {
          this.state = "build";
          this.step = 0;
        }
        break;
      }

      case "idle": {
        this.age += dt;
        const hx = web.x[web.hub];
        const hy = web.y[web.hub];
        // Lean a little toward a tug, then settle.
        this.alert = Math.max(0, this.alert - dt * 0.7);
        const lean = sp.B * 0.14 * this.alert;
        sp.x = hx + Math.cos(this.alertDir) * lean;
        sp.y = hy + Math.sin(this.alertDir) * lean;
        this.heading = DOWN + clamp(angleDiff(DOWN, this.alertDir), -1, 1) * this.alert;
        sp.reach = this.alert > 0.3 ? { dir: this.alertDir, amount: this.alert } : null;
        const fly = web.prey.find((f) => f.mode === "stuck" && f.web === web && f.gen === web.gen);
        if (fly) {
          this.prey = fly;
          fly.hunted = true;
          this.path = web.pathToward(fly.x, fly.y);
          this.wp = 1;
          this.state = "hunt";
          sp.reach = null;
        } else if (!this.bundle && !web.prey.some((f) => f.mode === "stuck") &&
          (this.catches >= 3 || web.damage > 0.22 || this.age > this.life)) {
          this.state = "eat";
          this.step = web.route.length - 1;
          sp.reach = null;
        }
        break;
      }

      case "hunt":
      case "carry": {
        const fly = this.prey;
        if (!fly || (this.state === "hunt" && fly.mode !== "stuck")) {
          // It got away.
          this.prey = null;
          this.path = [...(this.path ?? [web.hub])].slice(0, Math.max(1, this.wp)).reverse();
          this.wp = 0;
          this.state = "return";
          break;
        }
        const hunting = this.state === "hunt";
        const path = this.path ?? [web.hub];
        const done = this.glide(dt, (hunting ? HUNT : CARRY) * s, (k) => {
          const i = this.wp + k;
          if (i < path.length) return [web.x[path[i]], web.y[path[i]]];
          if (i === path.length) return hunting ? [fly.x, fly.y] : [web.x[web.hub], web.y[web.hub]];
          return null;
        });
        if (done) {
          if (hunting) {
            this.state = "wrap";
            this.timer = WRAP;
            this.spin = Math.atan2(sp.y - fly.y, sp.x - fly.x);
            this.wrapFrom = { x: sp.x, y: sp.y };
          } else {
            // A meal already on the go is finished off as the new one is hung up.
            if (this.bundle) (this.bundle.mode = "gone"), (this.bundle.respawn = rand(2, 6));
            fly.mode = "held";
            this.bundle = fly;
            this.prey = null;
            this.catches++;
            this.state = "idle";
          }
        }
        if (this.state === "carry") this.tow(this.prey, dt);
        break;
      }

      case "return": {
        const path = this.path ?? [web.hub];
        if (this.glide(dt, CARRY * s, (k) => (this.wp + k < path.length ? [web.x[path[this.wp + k]], web.y[path[this.wp + k]]] : null))) this.state = "idle";
        break;
      }

      case "wrap": {
        const fly = this.prey;
        if (!fly) {
          this.state = "idle";
          break;
        }
        this.timer -= dt;
        // Turn the parcel round under the legs, paying out silk: the circling eases in and out.
        const k = 1 - this.timer / WRAP;
        this.spin += dt * 1.3 * Math.sin(Math.PI * clamp(k, 0, 1)) ** 0.6;
        const r = sp.B * 0.28 * clamp(k * 4, 0, 1);
        sp.x = lerp(this.wrapFrom.x, fly.x, clamp(k * 4, 0, 1)) + Math.cos(this.spin) * r;
        sp.y = lerp(this.wrapFrom.y, fly.y, clamp(k * 4, 0, 1)) + Math.sin(this.spin) * r;
        this.heading = Math.atan2(fly.y - sp.y, fly.x - sp.x);
        fly.wrap = 1 - this.timer / WRAP;
        if (Math.random() < dt * 4) web.jolt(fly.link, fly.at, 0.25 * s);
        if (this.timer <= 0) {
          const i = web.prey.indexOf(fly);
          if (i >= 0) web.prey.splice(i, 1);
          fly.web = null;
          fly.mode = "wrapped";
          this.path = [...(this.path ?? [web.hub])].reverse();
          this.wp = 0;
          this.v = 0;
          this.state = "carry";
        }
        break;
      }
    }

    // Feeding at the hub: the bundle hangs off the spinnerets and shrinks.
    if (this.bundle) {
      this.tow(this.bundle, dt);
      this.bundle.digest += dt / 18;
      if (this.bundle.digest >= 1) {
        this.bundle.mode = "gone";
        this.bundle.respawn = rand(2, 6);
        this.bundle = null;
      }
    }

    sp.vx = (sp.x - px) / Math.max(dt, 1e-4);
    sp.vy = (sp.y - py) / Math.max(dt, 1e-4);
    if (this.heading !== null) sp.steer(this.heading, dt, this.state === "idle" ? 34 : 64);
    sp.updateLegs(dt, this.snap, this.land);
  }

  /** The parcel trails the spinnerets on a short line. */
  private tow(f: Fly | null, dt: number) {
    if (!f) return;
    const sp = this.spider;
    sp.spinneret(tmp);
    const back = sp.B * 0.16;
    const tx = tmp.x - Math.cos(sp.h) * back;
    const ty = tmp.y - Math.sin(sp.h) * back;
    const k = Math.min(1, dt * 12);
    f.x += (tx - f.x) * k;
    f.y += (ty - f.y) * k;
  }

  /** After eating the web: a new site close by, and the route's first corner to walk to. */
  private relocate() {
    const web = this.web;
    const { width: W, height: H } = this.world;
    const R = web.radius;
    const j = web.frame ? 0.06 : 1;
    web.cx = clamp(web.home.x + rand(-0.18, 0.18) * R * j, R * 0.4, W - R * 0.4);
    web.cy = clamp(web.home.y + rand(-0.14, 0.14) * R * j, R * 0.4, H - R * 0.4);
    web.generate({ x: this.spider.x, y: this.spider.y });
    web.gen++;
    const n = web.route[0].from;
    this.goal = { x: web.x[n], y: web.y[n] };
    this.life = rand(150, 260);
  }

  /** The spider's weight, through every foot on silk. */
  weigh() {
    const sp = this.spider;
    const w = (sp.B / 90) * 0.05;
    for (const leg of sp.legs) if (leg.planted && leg.web) leg.web.load(leg.link, leg.at, w);
  }
}

const tmp: Vec = { x: 0, y: 0 };
