// @ts-nocheck -- vendored as published (see LICENSE and COMMIT beside this file); checked upstream under its own compiler options
/**
 * A spider seen from above: prosoma and abdomen as ellipses, eight two-bone legs, and a tetrapod gait.
 *
 * Feet are planted in the world and only move when they step. A foot steps once its rest spot (where it
 * would sit relative to the body) drifts too far, and only while its neighbours stand, so the legs fall
 * into the alternating L1 R2 L3 R4 / R1 L2 R3 L4 rhythm without being told to. On a web, each step lands
 * on the nearest thread and the foot then rides that thread as the silk moves.
 *
 * What makes it move well: heading is sprung, so turns swing and settle; strides are long, eased in and
 * out, and arc outward as the foot lifts; never more than four legs are off the silk at once, and a long
 * stride takes longer, so the feet reach rather than flick; the body leans toward the feet it stands on,
 * so it sways in time with the gait; the abdomen breathes; at rest a foot now and then lets go and
 * re-grips; and a tug on the silk brings a foreleg up toward it.
 */
import { TAU, angleDiff, clamp, lerp, type Vec } from "./math";
import type { OrbWeb } from "./web";

const D = Math.PI / 180;

/** The orb weavers. */
export type SpiderKind = "araneus" | "argiope" | "nephila";
/** Every body the renderer knows, the jumping spider included. */
export type SpeciesKind = SpiderKind | "jumper";

export interface Species {
  /** Half-length and half-width, in body lengths. */
  prosoma: [number, number];
  abdomen: [number, number];
  /** Leg lengths, front pair first, in body lengths. */
  legLen: [number, number, number, number];
  /** Degrees from the heading: where each hip sits round the prosoma, and where each foot rests. */
  hip: [number, number, number, number];
  rest: [number, number, number, number];
  /** How far out each foot rests, as a fraction of its leg. */
  reach: [number, number, number, number];
  pattern: "cross" | "bands" | "spots" | "jumper";
  tint: [number, number, number];
  /** Leg shade, and how much darker the banded half of each segment is. */
  leg: number;
  band: number;
  /** A rounded-box prosoma, and the jumper's great front eyes. */
  boxy?: boolean;
  eyes?: boolean;
}

/**
 * Proportions are fractions of the body length B. Angles are degrees from the heading: hips round the
 * prosoma, and where each foot rests. Leg lengths are in body lengths, front pair first.
 */
export const SPECIES: Record<SpeciesKind, Species> = {
  // European garden spider: a round abdomen marked with a pale cross, legs I and II long and forward.
  araneus: {
    prosoma: [0.18, 0.15], abdomen: [0.32, 0.29],
    legLen: [1.5, 1.38, 0.95, 1.3], hip: [34, 68, 106, 142],
    rest: [26, 60, 108, 152], reach: [0.86, 0.82, 0.74, 0.84],
    pattern: "cross", tint: [1.1, 0.96, 0.8], leg: 176, band: 0.16,
  },
  // Wasp spider: a long banded abdomen, legs held in pairs so the spider makes an X on its zigzag.
  argiope: {
    prosoma: [0.16, 0.14], abdomen: [0.36, 0.22],
    legLen: [1.55, 1.45, 0.9, 1.35], hip: [32, 62, 112, 146],
    rest: [16, 28, 140, 158], reach: [0.9, 0.88, 0.78, 0.9],
    pattern: "bands", tint: [1.12, 1.02, 0.66], leg: 184, band: 0.45,
  },
  // Golden orb weaver: a long slim abdomen and very long thin legs.
  nephila: {
    prosoma: [0.15, 0.12], abdomen: [0.4, 0.15],
    legLen: [1.95, 1.7, 0.9, 1.6], hip: [34, 66, 108, 144],
    rest: [22, 52, 112, 158], reach: [0.88, 0.84, 0.76, 0.88],
    pattern: "spots", tint: [1.08, 1.0, 0.82], leg: 176, band: 0.3,
  },
  // Jumping spider: a boxy prosoma with two huge front eyes, a short abdomen, short stout legs.
  jumper: {
    prosoma: [0.26, 0.22], abdomen: [0.25, 0.2],
    legLen: [0.98, 0.8, 0.82, 0.96], hip: [30, 66, 110, 148],
    rest: [24, 70, 116, 160], reach: [0.8, 0.82, 0.82, 0.84],
    pattern: "jumper", tint: [0.94, 0.97, 1.06], leg: 160, band: 0.22, boxy: true, eyes: true,
  },
};

/** Where a foot found silk: which web, which thread, how far along it. */
export interface SilkHit {
  web: OrbWeb | null;
  link: number;
  t: number;
}

/** Finds silk near (x, y) within r, writing into `out`; null off the web. */
export type Snap = (x: number, y: number, r: number, out: SilkHit) => SilkHit | null;

export interface Leg {
  /** -1 left, 1 right; 0 is the front pair. */
  side: number;
  i: number;
  L: number;
  femur: number;
  tibia: number;
  hipA: number;
  restA: number;
  reach: number;
  /** The foot, where a step started, and where it is headed. */
  fx: number;
  fy: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t: number;
  dur: number;
  planted: boolean;
  raised: boolean;
  /** The thread the foot holds, and the one it is stepping to. */
  web: OrbWeb | null;
  link: number;
  at: number;
  toWeb: OrbWeb | null;
  toLink: number;
  toAt: number;
  /** Hip and knee, solved for drawing. */
  hx: number;
  hy: number;
  kx: number;
  ky: number;
  /** Neighbours this foot waits for before it steps. */
  wait: Leg[];
}

export class Spider {
  readonly kind: SpeciesKind;
  readonly sp: Species;
  /** Body length in px. */
  readonly B: number;
  /** Where the body is carried (on the thread, or on the wall). */
  x = 0;
  y = 0;
  h = Math.PI / 2;
  /** Turning speed: heading is sprung, so it swings into turns and settles instead of snapping. */
  hv = 0;
  vx = 0;
  vy = 0;
  /** Weight shift: the body leans toward the feet it stands on, so it sways with the gait. */
  dx = 0;
  dy = 0;
  /** Drawn scale: a jumper crouches, and grows a touch in the air, as if nearer. */
  scale = 1;
  /** The abdomen rises and falls. */
  breath = 1;
  /** Feet follow the body instead of stepping (mid-jump). */
  airborne = false;
  /** Raise a foreleg toward a tug. */
  reach: { dir: number; amount: number } | null = null;
  still = 0;
  t = Math.random() * 10;
  readonly id = Math.floor(Math.random() * 1e6);
  readonly legs: Leg[] = [];

  constructor(kind: SpeciesKind, B: number) {
    this.kind = kind;
    this.sp = SPECIES[kind];
    this.B = B;
    const sp = this.sp;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const L = sp.legLen[i] * B;
        this.legs.push({
          side, i, L,
          femur: L * 0.46, tibia: L * 0.56,
          hipA: sp.hip[i] * D, restA: sp.rest[i] * D, reach: sp.reach[i] * L,
          fx: 0, fy: 0, sx: 0, sy: 0, tx: 0, ty: 0,
          t: 1, dur: 0.12, planted: true, raised: false,
          web: null, link: -1, at: 0, toWeb: null, toLink: -1, toAt: 0,
          hx: 0, hy: 0, kx: 0, ky: 0,
          wait: [],
        });
      }
    }
    // Neighbours a foot waits for: same side front and back, and its opposite number.
    for (const leg of this.legs) {
      leg.wait = this.legs.filter((o) => o !== leg && ((o.side === leg.side && Math.abs(o.i - leg.i) === 1) || (o.side !== leg.side && o.i === leg.i)));
    }
  }

  /** The drawn body position: the carried one plus the weight shift. */
  get rx() {
    return this.x + this.dx;
  }
  get ry() {
    return this.y + this.dy;
  }

  get prosomaU() {
    return this.sp.prosoma[0] * this.B * 0.92;
  }
  get abdomenU() {
    return -this.sp.abdomen[0] * this.B * 0.95;
  }

  /** Body frame → world: u forward, v to the spider's right. `shifted` uses the drawn position. */
  toWorld<T extends Vec>(u: number, v: number, out: T, shifted = false): T {
    const c = Math.cos(this.h);
    const s = Math.sin(this.h);
    out.x = (shifted ? this.rx : this.x) + u * c - v * s;
    out.y = (shifted ? this.ry : this.y) + u * s + v * c;
    return out;
  }

  /** Spinnerets: the tip of the abdomen, where silk comes out. */
  spinneret<T extends Vec>(out: T): T {
    return this.toWorld((this.abdomenU - this.sp.abdomen[0] * this.B * 0.92) * this.scale, 0, out, true);
  }

  hipLocal(leg: Leg, out: { u: number; v: number }) {
    const [pa, pb] = this.sp.prosoma;
    out.u = this.prosomaU + Math.cos(leg.hipA) * pa * this.B * 0.72;
    out.v = leg.side * Math.sin(leg.hipA) * pb * this.B * 0.86;
    return out;
  }

  restWorld<T extends Vec>(leg: Leg, out: T, tuck = 1): T {
    const hip = this.hipLocal(leg, tmpL);
    const r = leg.reach * tuck;
    return this.toWorld(hip.u + Math.cos(leg.restA) * r, hip.v + leg.side * Math.sin(leg.restA) * r, out);
  }

  /** Put the spider down with every foot at rest (and on silk, given a snap). */
  place(x: number, y: number, h: number, snap: Snap | null = null) {
    this.x = x;
    this.y = y;
    this.h = h;
    this.hv = 0;
    this.vx = this.vy = 0;
    for (const leg of this.legs) {
      this.restWorld(leg, tmpW);
      leg.fx = tmpW.x;
      leg.fy = tmpW.y;
      leg.planted = true;
      leg.t = 1;
      leg.web = null;
      leg.link = -1;
      if (snap) this.grip(leg, snap, tmpW.x, tmpW.y, leg.L * 0.5, true);
    }
  }

  /** Find silk for a foot near (x, y). When `now`, the foot moves there at once. */
  grip(leg: Leg, snap: Snap, x: number, y: number, r: number, now: boolean) {
    const hit = snap(x, y, r, tmpS);
    const web = hit?.web;
    if (!hit || !web) {
      leg.toLink = -1;
      if (now) (leg.web = null), (leg.link = -1);
      return false;
    }
    leg.toWeb = web;
    leg.toLink = hit.link;
    leg.toAt = hit.t;
    if (now) {
      leg.web = web;
      leg.link = hit.link;
      leg.at = hit.t;
      web.pos(hit.link, hit.t, tmpP);
      leg.fx = tmpP.x;
      leg.fy = tmpP.y;
    }
    return true;
  }

  /** Turn toward `target` on a spring: it swings into the turn and settles without snapping. */
  steer(target: number, dt: number, k = 70) {
    const c = 2 * Math.sqrt(k) * 0.92;
    this.hv += (k * angleDiff(this.h, target) - c * this.hv) * dt;
    this.hv = clamp(this.hv, -6, 6);
    this.h = (((this.h + this.hv * dt) % TAU) + TAU) % TAU;
  }

  /** Lift a foot and send it to (tx, ty), landing on silk if there is any. */
  stepTo(leg: Leg, tx: number, ty: number, dur: number, snap: Snap | null, grip = true) {
    leg.sx = leg.fx;
    leg.sy = leg.fy;
    leg.tx = tx;
    leg.ty = ty;
    leg.toLink = -1;
    if (snap && grip) this.grip(leg, snap, tx, ty, leg.L * 0.42, false);
    leg.t = 0;
    leg.dur = dur;
    leg.planted = false;
    leg.web = null;
  }

  /**
   * Move the feet for this frame. `snap(x, y, r, out)` finds silk (or null off the web); `land(leg)` is
   * told about each foot that lands, so the web can feel it.
   */
  updateLegs(dt: number, snap: Snap | null = null, land: ((leg: Leg) => void) | null = null) {
    this.t += dt;
    this.breath = 1 + 0.035 * Math.sin(this.t * 1.9 + (this.id % 7));
    const speed = Math.hypot(this.vx, this.vy);
    this.still = speed < 4 ? this.still + dt : 0;
    let stepping = 0;
    for (const leg of this.legs) if (!leg.planted) stepping++;
    // A foreleg raised toward a tug, on the side it came from.
    const reach = this.reach;
    let raise: Leg | null = null;
    if (reach && reach.amount > 0.25) {
      const side = Math.sin(reach.dir - this.h) >= 0 ? 1 : -1;
      raise = this.legs.find((l) => l.i === 0 && l.side === side) ?? null;
    }

    for (const leg of this.legs) {
      if (this.airborne) {
        this.restWorld(leg, tmpW, leg.i < 2 ? 0.85 : 0.6);
        leg.fx = tmpW.x;
        leg.fy = tmpW.y;
        leg.planted = true;
        leg.t = 1;
        leg.web = null;
        leg.link = -1;
        continue;
      }
      if (leg.planted) {
        if (leg.web) {
          if (leg.web.state[leg.link] === 1) {
            leg.web.pos(leg.link, leg.at, tmpP);
            leg.fx = tmpP.x;
            leg.fy = tmpP.y;
          } else leg.web = null;
        }
        if (leg === raise && reach) {
          // Held up and out toward the tug, testing the silk.
          this.hipLocal(leg, tmpL);
          this.toWorld(tmpL.u, tmpL.v, tmpW);
          const tx = tmpW.x + Math.cos(reach.dir) * leg.L * 0.92;
          const ty = tmpW.y + Math.sin(reach.dir) * leg.L * 0.92;
          if (!leg.raised || Math.hypot(leg.fx - tx, leg.fy - ty) > leg.L * 0.2) this.stepTo(leg, tx, ty, 0.22, null, false);
          leg.raised = true;
          continue;
        }
        this.restWorld(leg, tmpW);
        const err = Math.hypot(leg.fx - tmpW.x, leg.fy - tmpW.y);
        const moving = this.still === 0;
        const threshold = leg.raised ? 0 : moving ? leg.L * 0.34 : leg.L * 0.15;
        const ready = leg.wait.every((o) => o.planted);
        const desperate = err > leg.L * 0.85;
        // At rest, tidy one foot at a time; on the move, any foot whose neighbours stand.
        // Never more than half the legs in the air, so the body always stands on four (a tetrapod gait).
        if (err > threshold && stepping < 4 && (desperate || (ready && (moving || (stepping === 0 && this.still > 0.2))))) {
          // Long, unhurried strides: the foot reaches well ahead of where the body is going.
          let dur = clamp(leg.L / (speed * 1.3 + leg.L * 2.8), 0.14, 0.34);
          let tx = tmpW.x;
          let ty = tmpW.y;
          if (speed > 1) {
            const lead = dur * 1.1 + (leg.L * 0.26) / Math.max(speed, 40);
            tx += this.vx * lead;
            ty += this.vy * lead;
          }
          // A long stride takes longer: the foot never whips across faster than about three leg lengths
          // a second, so catching up after a turn reads as a reach, not a flick.
          dur = clamp(Math.max(dur, Math.hypot(tx - leg.fx, ty - leg.fy) / (leg.L * 3)), 0.14, 0.5);
          leg.raised = false;
          this.stepTo(leg, tx, ty, dur, snap);
          stepping++;
        }
      } else {
        leg.t = Math.min(1, leg.t + dt / leg.dur);
        let tx = leg.tx;
        let ty = leg.ty;
        if (leg.toLink >= 0 && leg.toWeb) {
          if (leg.toWeb.state[leg.toLink] === 1) {
            leg.toWeb.pos(leg.toLink, leg.toAt, tmpP);
            tx = tmpP.x;
            ty = tmpP.y;
          } else leg.toLink = -1;
        }
        // Ease in and out, and arc outward as the foot lifts, so each step reads as a reach.
        const e = 0.5 - 0.5 * Math.cos(Math.PI * leg.t);
        const lift = Math.sin(Math.PI * leg.t);
        let fx = lerp(leg.sx, tx, e);
        let fy = lerp(leg.sy, ty, e);
        const ox = fx - this.x;
        const oy = fy - this.y;
        const ol = Math.hypot(ox, oy) || 1;
        fx += (ox / ol) * lift * leg.L * 0.1;
        fy += (oy / ol) * lift * leg.L * 0.1;
        leg.fx = fx;
        leg.fy = fy;
        if (leg.t >= 1) {
          leg.planted = true;
          if (leg.toLink >= 0 && leg.toWeb) {
            leg.web = leg.toWeb;
            leg.link = leg.toLink;
            leg.at = leg.toAt;
            land?.(leg);
          }
        }
      }
    }
    if (raise === null) for (const leg of this.legs) if (leg.raised && leg.planted) leg.raised = false;

    // Now and then, at rest, one foot lets go and takes a fresh grip.
    if (!this.airborne && this.still > 1.4 && stepping === 0 && Math.random() < dt * 0.35) {
      const leg = this.legs[Math.floor(Math.random() * 8)];
      if (!leg.raised) {
        this.restWorld(leg, tmpW);
        const a = Math.random() * TAU;
        this.stepTo(leg, tmpW.x + Math.cos(a) * leg.L * 0.07, tmpW.y + Math.sin(a) * leg.L * 0.07, 0.2, snap);
      }
    }

    // Weight shift toward the feet on the ground: the body sways in time with the gait.
    let px = 0;
    let py = 0;
    let rx = 0;
    let ry = 0;
    let n = 0;
    for (const leg of this.legs) {
      if (!leg.planted || leg.raised) continue;
      this.restWorld(leg, tmpW);
      px += leg.fx;
      py += leg.fy;
      rx += tmpW.x;
      ry += tmpW.y;
      n++;
    }
    let tx = 0;
    let ty = 0;
    if (n && !this.airborne) {
      tx = ((px - rx) / n) * 0.22;
      ty = ((py - ry) / n) * 0.22;
      const m = Math.hypot(tx, ty);
      const cap = this.B * 0.07;
      if (m > cap) (tx *= cap / m), (ty *= cap / m);
    }
    const k = 1 - Math.exp(-dt * 9);
    this.dx += (tx - this.dx) * k;
    this.dy += (ty - this.dy) * k;
  }

  /** Hips and knees for drawing: each knee bends away from the body's midline. */
  solve() {
    const bx = this.rx;
    const by = this.ry;
    for (const leg of this.legs) {
      const hip = this.hipLocal(leg, tmpL);
      this.toWorld(hip.u * this.scale, hip.v * this.scale, tmpW, true);
      leg.hx = tmpW.x;
      leg.hy = tmpW.y;
      const a = leg.femur * this.scale;
      const b = leg.tibia * this.scale;
      const dx = leg.fx - leg.hx;
      const dy = leg.fy - leg.hy;
      const d0 = Math.hypot(dx, dy) || 1e-3;
      const d = clamp(d0, Math.abs(a - b) + 1e-3, a + b - 1e-3);
      const base = Math.atan2(dy, dx);
      const A = Math.acos(clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1));
      // Of the two knees, take the one further out on the leg's own side.
      const rx = -Math.sin(this.h);
      const ry = Math.cos(this.h);
      const k1x = leg.hx + Math.cos(base + A) * a;
      const k1y = leg.hy + Math.sin(base + A) * a;
      const k2x = leg.hx + Math.cos(base - A) * a;
      const k2y = leg.hy + Math.sin(base - A) * a;
      const o1 = leg.side * ((k1x - bx) * rx + (k1y - by) * ry);
      const o2 = leg.side * ((k2x - bx) * rx + (k2y - by) * ry);
      leg.kx = o1 >= o2 ? k1x : k2x;
      leg.ky = o1 >= o2 ? k1y : k2y;
    }
  }

  /** Turn toward `target` heading (sprung; `rate` sets how firmly). */
  turnToward(target: number, rate: number, dt: number) {
    this.steer(target, dt, rate * rate * 1.2);
  }
}

const tmpL = { u: 0, v: 0 };
const tmpW: Vec = { x: 0, y: 0 };
const tmpP: Vec = { x: 0, y: 0 };
const tmpS: SilkHit = { web: null, link: -1, t: 0 };
