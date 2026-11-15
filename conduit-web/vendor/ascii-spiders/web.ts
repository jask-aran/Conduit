// @ts-nocheck -- vendored as published (see LICENSE and COMMIT beside this file); checked upstream under its own compiler options
/**
 * An orb web as a Verlet mesh of silk.
 *
 * Geometry follows a real orb: mooring lines out to unseen twigs, a frame polygon, radials from the hub to
 * the frame, a small hub mesh, a free zone, then the sticky capture spiral, laid as straight chords between
 * radials. Argiope webs add a stabilimentum, the zigzag ribbon above and below the hub.
 *
 * Silk is a one-sided constraint: a thread resists stretching but goes slack instead of pushing, so the
 * pre-tensioned web hangs, sags a touch under gravity and the spider's weight, rings when plucked, and
 * snaps when pulled too far.
 *
 * `route` is the order the spider builds it in, node to node: frame, then radials in alternating order
 * (each laid out from the hub and walked back), hub rings, the capture spiral from the outside in, and
 * the stabilimentum. Walking the route backwards is how the spider eats the web before rebuilding.
 */
import type { Fly } from "./flies";
import { TAU, angleDiff, clamp, closestT, crossAlong, hash3, lerp, noise1, rand, randInt, type Vec } from "./math";

export const MOOR = 1;
export const FRAME = 2;
export const RADIAL = 3;
export const HUB = 4;
export const SPIRAL = 5;
export const STAB = 6;

// Indexed by kind. Rest length as a fraction of the drawn length (pre-tension), stiffness, and the stretch
// that snaps a thread. Capture silk is the stretchiest; the frame and radials are dragline silk.
const TENSION = [1, 0.99, 0.975, 0.965, 0.975, 0.985, 0.99];
const STIFF = [1, 1, 1, 1, 0.9, 0.7, 0.8];
const BREAK = [99, 99, 2.4, 2.0, 2.2, 2.1, 2.2];
/** How bright each kind of silk reads: the capture spiral is finest, the stabilimentum a dense ribbon. */
export const SILK_ALPHA = [0, 0.75, 0.95, 1, 1, 0.8, 1.8];

const ITERATIONS = 6;
const wrap = (a: number) => ((a % TAU) + TAU) % TAU;
const pairKey = (a: number, b: number) => (a < b ? a * 1048576 + b : b * 1048576 + a);

/** A corner of the frame, moored to a twig at (mx, my). */
export interface FramePoint {
  x: number;
  y: number;
  mx: number;
  my: number;
}

/** One leg of the build route: walk from node to node, laying `link` on the way if `lay`. */
export interface RouteStep {
  from: number;
  to: number;
  link: number;
  lay: boolean;
}

/** A point on a thread: which link, and how far along it (0..1). */
export interface ThreadPoint {
  link: number;
  t: number;
}

export interface WebOptions {
  /** The hub. */
  cx: number;
  cy: number;
  /** Rough reach of the capture area. */
  radius: number;
  /** 0 far and faint → 1 near. */
  depth: number;
  /** The ASCII cell, so spacing is chosen in glyphs and every spiral turn gets its own row. */
  cw: number;
  ch: number;
  /** Add an argiope's stabilimentum. */
  stab?: boolean;
  /** The frame's corners, each moored to its own twig, so neighbouring webs can share twigs and tile. */
  frame?: FramePoint[] | null;
}

interface Anchor {
  a: number;
  x: number;
  y: number;
  mx?: number;
  my?: number;
}

interface Radial {
  th: number;
  L: number;
}

export class OrbWeb {
  cx: number;
  cy: number;
  radius: number;
  depth: number;
  cw: number;
  ch: number;
  stab: boolean;
  frame: FramePoint[] | null;
  /** Where the web was first strung; rebuilt webs stay near it. */
  readonly home: Vec;
  /** The loose end of the thread being laid: the spider has it, so it doesn't swing. */
  held = -1;
  /** Bumped each rebuild, so prey stuck to an old web can tell. */
  gen = 0;
  /** Flies stuck to this web. */
  readonly prey: Fly[] = [];

  seed = 0;
  /** Nodes. */
  n = 0;
  x = new Float32Array(0);
  y = new Float32Array(0);
  ox = new Float32Array(0);
  oy = new Float32Array(0);
  pin = new Uint8Array(0);
  on = new Uint8Array(0);
  deg = new Uint16Array(0);
  speed = new Float32Array(0);
  /** Links (threads). state: 0 unlaid · 1 laid · 2 broken. */
  m = 0;
  la = new Int32Array(0);
  lb = new Int32Array(0);
  kind = new Uint8Array(0);
  state = new Uint8Array(0);
  rest = new Float32Array(0);
  /** Where on a capture thread a dew bead sits, or -1. */
  dew = new Float32Array(0);
  hub = 0;
  chain: number[][] = [];
  rad: Radial[] = [];
  N = 0;
  T = 0;
  rin = 0;
  spacing = 0;
  route: RouteStep[] = [];
  spiralStart = 0;
  radialsLaid = 0;
  laid = 0;
  broken = 0;
  /** Furthest free node from the hub. */
  outer = 0;

  constructor({ cx, cy, radius, depth, cw, ch, stab = false, frame = null }: WebOptions) {
    this.cx = cx;
    this.cy = cy;
    this.radius = radius;
    this.depth = depth;
    this.cw = cw;
    this.ch = ch;
    this.stab = stab;
    this.frame = frame;
    this.home = { x: cx, y: cy };
    this.generate();
  }

  /** Build a fresh web around (cx, cy). `startNear` picks the frame corner the route starts from. */
  generate(startNear: Vec | null = null) {
    const { cx, cy, radius: R, cw, ch } = this;
    this.seed = randInt(1, 1e6);
    const X: number[] = [];
    const Y: number[] = [];
    const PIN: number[] = [];
    const node = (x: number, y: number, pin = 0) => (X.push(x), Y.push(y), PIN.push(pin), X.length - 1);
    const LA: number[] = [];
    const LB: number[] = [];
    const LK: number[] = [];
    const links = new Map<number, number>();
    const link = (a: number, b: number, kind: number) => {
      LA.push(a);
      LB.push(b);
      LK.push(kind);
      links.set(pairKey(a, b), LA.length - 1);
      return LA.length - 1;
    };

    // Anchors: the frame's corners, strung off twigs we never see. The hub sits high in a real orb, so the
    // frame reaches further below it.
    const anchors: Anchor[] = [];
    if (this.frame) {
      for (const f of this.frame) {
        const x = f.x + rand(-0.5, 0.5) * cw;
        const y = f.y + rand(-0.5, 0.5) * ch;
        anchors.push({ a: wrap(Math.atan2(y - cy, x - cx)), x, y, mx: f.mx, my: f.my });
      }
    } else {
      const n = R > 200 ? randInt(4, 5) : randInt(3, 4);
      const a0 = rand(0, TAU);
      for (let i = 0; i < n; i++) {
        const a = a0 + ((i + rand(-0.2, 0.2)) * TAU) / n;
        const r = R * rand(1.1, 1.3) * (Math.sin(a) > 0.25 ? 1.15 : 1);
        anchors.push({ a: wrap(a), x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
      }
    }
    anchors.sort((p, q) => p.a - q.a);
    const nA = anchors.length;

    const hitFrame = (th: number) => {
      const dx = Math.cos(th);
      const dy = Math.sin(th);
      let best = Infinity;
      for (let i = 0; i < nA; i++) {
        const p = anchors[i];
        const q = anchors[(i + 1) % nA];
        const ex = q.x - p.x;
        const ey = q.y - p.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const wx = p.x - cx;
        const wy = p.y - cy;
        const s = (wx * ey - wy * ex) / den;
        const u = (dy * wx - dx * wy) / den;
        if (s > 0 && u >= -1e-6 && u <= 1 + 1e-6 && s < best) best = s;
      }
      return Number.isFinite(best) ? best : R;
    };

    // Radials, about ten glyphs apart at the rim, so each reads as its own line.
    const N = clamp(Math.round((TAU * R) / (cw * 10)), 9, 20);
    const t0 = rand(0, TAU);
    const rad: Radial[] = [];
    for (let k = 0; k < N; k++) {
      const th = t0 + ((k + rand(-0.16, 0.16)) * TAU) / N;
      rad.push({ th: wrap(th), L: hitFrame(th) });
    }

    // Hub mesh, free zone, then the capture spiral: an open one, a turn every three rows or so, so the
    // webs stay quiet behind everything.
    const hub = node(cx, cy);
    const h1 = Math.max(cw * 1.2, R * 0.05);
    const h2 = h1 * 1.9;
    const rin = Math.max(h2 + ch * 1.5, R * 0.27);
    const spacing = ch * rand(3, 3.5);
    let outSum = 0;
    for (const r of rad) outSum += r.L * 0.86;
    const T = Math.max(2, Math.round((outSum / N - rin) / spacing));
    const spiral = new Int32Array(T * N);
    const chain: number[][] = [];
    const frameNode: number[] = [];
    for (let k = 0; k < N; k++) {
      const c = Math.cos(rad[k].th);
      const s = Math.sin(rad[k].th);
      const ck = [hub, node(cx + c * h1, cy + s * h1), node(cx + c * h2, cy + s * h2)];
      const rout = Math.max(rin + spacing, rad[k].L * 0.86);
      for (let j = T - 1; j >= 0; j--) {
        const r = lerp(rout, rin, (j + k / N) / T);
        const i = node(cx + c * r, cy + s * r);
        spiral[j * N + k] = i;
        ck.push(i);
      }
      const F = node(cx + c * rad[k].L, cy + s * rad[k].L);
      ck.push(F);
      frameNode.push(F);
      chain.push(ck);
    }

    // Frame: anchors and radial ends, in order round the hub.
    const fp = anchors.map((p) => ({ a: p.a, i: node(p.x, p.y, 1) }));
    const anchorNodes = fp.map((p) => p.i);
    for (let k = 0; k < N; k++) fp.push({ a: rad[k].th, i: frameNode[k] });
    fp.sort((p, q) => p.a - q.a);
    for (let i = 0; i < fp.length; i++) link(fp[i].i, fp[(i + 1) % fp.length].i, FRAME);

    // Mooring lines out past the anchors: to the shared twig, or out at a slant.
    anchorNodes.forEach((ai, n) => {
      const an = anchors[n];
      if (an.mx !== undefined && an.my !== undefined) {
        link(ai, node(an.mx, an.my, 1), MOOR);
        return;
      }
      const a = Math.atan2(Y[ai] - cy, X[ai] - cx) + rand(-0.35, 0.35);
      const len = R * rand(0.35, 0.7);
      link(ai, node(X[ai] + Math.cos(a) * len, Y[ai] + Math.sin(a) * len, 1), MOOR);
    });

    for (let k = 0; k < N; k++) {
      const ck = chain[k];
      for (let i = 0; i < ck.length - 1; i++) link(ck[i], ck[i + 1], RADIAL);
    }
    for (let k = 0; k < N; k++) {
      link(chain[k][1], chain[(k + 1) % N][1], HUB);
      link(chain[k][2], chain[(k + 1) % N][2], HUB);
    }
    const spiralSeq: number[] = [];
    for (let j = 0; j < T; j++) {
      for (let k = 0; k < N; k++) {
        spiralSeq.push(spiral[j * N + k]);
        const next = k < N - 1 ? spiral[j * N + k + 1] : j < T - 1 ? spiral[(j + 1) * N] : -1;
        if (next >= 0) link(spiral[j * N + k], next, SPIRAL);
      }
    }

    // Stabilimentum: a zigzag between the two radials either side of straight up, and of straight down.
    const bands: { k: number; c: number }[][] = [];
    if (this.stab) {
      for (const dir of [-Math.PI / 2, Math.PI / 2]) {
        let kA = 0;
        for (let k = 1; k < N; k++) if (Math.abs(angleDiff(rad[k].th, dir)) < Math.abs(angleDiff(rad[kA].th, dir))) kA = k;
        const kB = (angleDiff(rad[kA].th, dir) > 0 ? kA + 1 : kA - 1 + N) % N;
        const M = Math.min(T, 6) + 1;
        const zig: { k: number; c: number }[] = [];
        for (let m = 0; m <= M; m++) zig.push({ k: m % 2 ? kB : kA, c: 2 + m });
        for (let m = 1; m < zig.length; m++) link(chain[zig[m - 1].k][zig[m - 1].c], chain[zig[m].k][zig[m].c], STAB);
        bands.push(zig);
      }
    }

    // ── the build route ──
    const route: RouteStep[] = [];
    const walk = (seq: number[], lay: boolean) => {
      for (let i = 1; i < seq.length; i++) {
        const l = links.get(pairKey(seq[i - 1], seq[i]));
        route.push({ from: seq[i - 1], to: seq[i], link: l ?? -1, lay: lay && l !== undefined });
      }
    };
    // Start at the frame point nearest the spider, or at an anchor.
    let s0 = fp.findIndex((p) => p.i === anchorNodes[0]);
    if (startNear) {
      let best = Infinity;
      for (let i = 0; i < fp.length; i++) {
        const d = Math.hypot(X[fp[i].i] - startNear.x, Y[fp[i].i] - startNear.y);
        if (d < best) (best = d), (s0 = i);
      }
    }
    const ring: number[] = [];
    for (let i = 0; i <= fp.length; i++) ring.push(fp[(s0 + i) % fp.length].i);
    walk(ring, true);
    // Along the frame to the first radial end, then down that radial to the hub.
    let r0 = 0;
    const toR0 = [ring[0]];
    for (let i = 0; i < fp.length; i++) {
      const ni = ring[i];
      if (i > 0) toR0.push(ni);
      const k = frameNode.indexOf(ni);
      if (k >= 0) {
        r0 = k;
        break;
      }
    }
    walk(toR0, false);
    walk([...chain[r0]].reverse(), true);
    // The rest of the radials in alternating order (bit-reversed), so tension stays balanced.
    const order = [r0];
    const seen = new Set(order);
    for (let i = 1; order.length < N && i < N * 8; i++) {
      let f = 0;
      let b = 0.5;
      for (let n = i; n; n >>= 1, b *= 0.5) if (n & 1) f += b;
      const k = (r0 + Math.round(f * N)) % N;
      if (!seen.has(k)) seen.add(k), order.push(k);
    }
    for (let k = 0; k < N; k++) if (!seen.has(k)) order.push(k);
    for (let o = 1; o < order.length; o++) {
      walk(chain[order[o]], true);
      walk([...chain[order[o]]].reverse(), false);
    }
    // Hub rings.
    walk([hub, chain[0][1]], false);
    walk([...chain.map((c) => c[1]), chain[0][1]], true);
    walk([chain[0][1], chain[0][2]], false);
    walk([...chain.map((c) => c[2]), chain[0][2]], true);
    // Out to the rim, spiral in, back to the hub.
    walk(chain[0].slice(2, 3 + T), false);
    this.spiralStart = route.length;
    walk(spiralSeq, true);
    walk([chain[N - 1][3], chain[N - 1][2], chain[N - 1][1], hub], false);
    for (const zig of bands) {
      walk(chain[zig[0].k].slice(0, zig[0].c + 1), false);
      walk(zig.map((z) => chain[z.k][z.c]), true);
      const last = zig[zig.length - 1];
      walk(chain[last.k].slice(0, last.c + 1).reverse(), false);
    }

    // ── typed state ──
    const n = X.length;
    const m = LA.length;
    this.n = n;
    this.m = m;
    this.x = Float32Array.from(X);
    this.y = Float32Array.from(Y);
    this.ox = Float32Array.from(X);
    this.oy = Float32Array.from(Y);
    this.pin = Uint8Array.from(PIN);
    this.on = new Uint8Array(n);
    this.deg = new Uint16Array(n);
    this.speed = new Float32Array(n);
    this.la = Int32Array.from(LA);
    this.lb = Int32Array.from(LB);
    this.kind = Uint8Array.from(LK);
    this.state = new Uint8Array(m);
    this.rest = new Float32Array(m);
    this.dew = new Float32Array(m).fill(-1);
    for (let l = 0; l < m; l++) {
      const k = LK[l];
      this.rest[l] = Math.hypot(X[LB[l]] - X[LA[l]], Y[LB[l]] - Y[LA[l]]) * TENSION[k];
      // Dew catches on the capture spiral: a few beads per web that glint.
      if (k === SPIRAL && hash3(this.seed, l, 3) < 0.085) this.dew[l] = 0.2 + 0.6 * hash3(this.seed, l, 5);
    }
    this.hub = hub;
    this.chain = chain;
    this.rad = rad;
    this.N = N;
    this.T = T;
    this.rin = rin;
    this.spacing = spacing;
    this.route = route;
    this.radialsLaid = 0;
    this.laid = 0;
    this.broken = 0;
    let outer = 0;
    for (let i = 0; i < n; i++) if (!PIN[i]) outer = Math.max(outer, Math.hypot(X[i] - cx, Y[i] - cy));
    this.outer = outer;
    this.prey.length = 0;

    // Mooring lines were spun on an earlier night: they are up from the start.
    for (let l = 0; l < m; l++) if (LK[l] === MOOR) this.lay(l);
  }

  get hubPinned() {
    return this.radialsLaid < 4;
  }

  /** Free to move: not pinned to a twig, not the hub before it has radials, not the end the spider holds. */
  isFree(i: number) {
    return !this.pin[i] && i !== this.held && !(i === this.hub && this.hubPinned);
  }

  lay(l: number) {
    if (l < 0 || this.state[l] === 1) return;
    const a = this.la[l];
    const b = this.lb[l];
    this.state[l] = 1;
    this.deg[a]++;
    this.deg[b]++;
    this.on[a] = 1;
    this.on[b] = 1;
    this.laid++;
    if (this.kind[l] === RADIAL && (a === this.hub || b === this.hub)) this.radialsLaid++;
  }

  /** Take a thread down: `broken` marks it snapped rather than eaten. */
  cut(l: number, broken = false) {
    if (l < 0 || this.state[l] !== 1) return;
    const a = this.la[l];
    const b = this.lb[l];
    this.state[l] = broken ? 2 : 0;
    if (broken) this.broken++;
    else this.laid--;
    if (this.kind[l] === RADIAL && (a === this.hub || b === this.hub)) this.radialsLaid--;
    for (const i of [a, b]) {
      if (--this.deg[i] === 0 && !this.pin[i]) this.on[i] = 0;
    }
  }

  /** Everything up to route step `upTo` laid at once (scene start and reduced motion). */
  buildInstant(upTo = this.route.length) {
    for (let s = 0; s < upTo; s++) if (this.route[s].lay) this.lay(this.route[s].link);
    for (let i = 0; i < 240; i++) this.step(0);
  }

  get damage() {
    return this.broken / Math.max(1, this.laid + this.broken);
  }

  step(t: number) {
    const { n, x, y, ox, oy, on, speed, la, lb, state, rest, kind, m } = this;
    const g = 0.012 * (this.radius / 300);
    const wind = noise1(t * 0.12, this.seed) * 0.0026 * (this.radius / 300);
    for (let i = 0; i < n; i++) {
      if (!on[i] || !this.isFree(i)) continue;
      const vx = (x[i] - ox[i]) * 0.962;
      const vy = (y[i] - oy[i]) * 0.962;
      ox[i] = x[i];
      oy[i] = y[i];
      x[i] += vx + wind;
      y[i] += vy + g;
    }
    for (let it = 0; it < ITERATIONS; it++) {
      for (let l = 0; l < m; l++) {
        if (state[l] !== 1) continue;
        const a = la[l];
        const b = lb[l];
        const dx = x[b] - x[a];
        const dy = y[b] - y[a];
        const d = Math.sqrt(dx * dx + dy * dy);
        const r = rest[l];
        if (d <= r) continue; // slack silk pushes nothing
        const wa = this.isFree(a) ? 1 : 0;
        const wb = this.isFree(b) ? 1 : 0;
        const ws = wa + wb;
        if (!ws) continue;
        const k = ((d - r) / (d * ws)) * STIFF[kind[l]];
        x[a] += dx * k * wa;
        y[a] += dy * k * wa;
        x[b] -= dx * k * wb;
        y[b] -= dy * k * wb;
      }
    }
    for (let l = 0; l < m; l++) {
      if (state[l] !== 1) continue;
      const a = la[l];
      const b = lb[l];
      if (Math.hypot(x[b] - x[a], y[b] - y[a]) > rest[l] * BREAK[kind[l]]) this.cut(l, true);
    }
    for (let i = 0; i < n; i++) speed[i] = on[i] ? Math.hypot(x[i] - ox[i], y[i] - oy[i]) : 0;
  }

  /**
   * The pointer through the silk: threads it touches are nudged away and dragged a little along its path,
   * then spring back and ring. Returns how much silk it touched.
   */
  pluck(px: number, py: number, vx: number, vy: number, R: number) {
    if (Math.hypot(px - this.cx, py - this.cy) > this.outer + R) return 0;
    const { x, y, la, lb, state, kind, m } = this;
    let total = 0;
    const force = Math.min(R * 0.12, 2.2);
    for (let l = 0; l < m; l++) {
      if (state[l] !== 1 || kind[l] === MOOR) continue;
      const a = la[l];
      const b = lb[l];
      const ax = x[a];
      const ay = y[a];
      const bx = x[b];
      const by = y[b];
      if ((ax < px - R && bx < px - R) || (ax > px + R && bx > px + R) || (ay < py - R && by < py - R) || (ay > py + R && by > py + R)) continue;
      const t = closestT(px, py, ax, ay, bx, by);
      const dx = ax + (bx - ax) * t - px;
      const dy = ay + (by - ay) * t - py;
      const d = Math.hypot(dx, dy);
      if (d >= R) continue;
      const k = 1 - d / R;
      const nx = d > 1e-3 ? dx / d : 0;
      const ny = d > 1e-3 ? dy / d : 0;
      const fx = nx * force * k + vx * k * 0.2;
      const fy = ny * force * k + vy * k * 0.2;
      if (this.isFree(a)) (x[a] += fx * (1 - t)), (y[a] += fy * (1 - t));
      if (this.isFree(b)) (x[b] += fx * t), (y[b] += fy * t);
      total += k;
    }
    return total;
  }

  /** A struggling fly or a landing foot: shake a thread at t. */
  jolt(l: number, t: number, s: number) {
    if (l < 0 || this.state[l] !== 1) return;
    const a = this.la[l];
    const b = this.lb[l];
    const ang = rand(0, TAU);
    const dx = Math.cos(ang) * s;
    const dy = Math.sin(ang) * s;
    if (this.isFree(a)) (this.x[a] += dx * (1 - t)), (this.y[a] += dy * (1 - t));
    if (this.isFree(b)) (this.x[b] += dx * t), (this.y[b] += dy * t);
  }

  /** Pull a point of a thread down by `w` px (the spider's weight through a foot). */
  load(l: number, t: number, w: number) {
    if (l < 0 || this.state[l] !== 1) return;
    const a = this.la[l];
    const b = this.lb[l];
    if (this.isFree(a)) this.y[a] += w * (1 - t);
    if (this.isFree(b)) this.y[b] += w * t;
  }

  /** Nearest point of live silk to (px, py) within r. Writes link and t into `out`. */
  snap<T extends ThreadPoint>(px: number, py: number, r: number, out: T): T | null {
    const { x, y, la, lb, state, kind, m } = this;
    let best = r * r;
    let found = -1;
    let ft = 0;
    for (let l = 0; l < m; l++) {
      if (state[l] !== 1 || kind[l] === MOOR) continue;
      const a = la[l];
      const b = lb[l];
      const t = closestT(px, py, x[a], y[a], x[b], y[b]);
      const qx = x[a] + (x[b] - x[a]) * t - px;
      const qy = y[a] + (y[b] - y[a]) * t - py;
      const d2 = qx * qx + qy * qy;
      if (d2 < best) (best = d2), (found = l), (ft = t);
    }
    if (found < 0) return null;
    out.link = found;
    out.t = ft;
    return out;
  }

  /** Where the capture spiral crosses the segment (x0, y0) → (x1, y1), as { link, t }. */
  catches(x0: number, y0: number, x1: number, y1: number, out: ThreadPoint): ThreadPoint | null {
    if (Math.hypot(x1 - this.cx, y1 - this.cy) > this.outer + 4) return null;
    const { x, y, la, lb, state, kind, m } = this;
    for (let l = 0; l < m; l++) {
      if (state[l] !== 1 || kind[l] !== SPIRAL) continue;
      const a = la[l];
      const b = lb[l];
      const u = crossAlong(x0, y0, x1, y1, x[a], y[a], x[b], y[b]);
      if (u >= 0) {
        out.link = l;
        out.t = u;
        return out;
      }
    }
    return null;
  }

  pos<T extends Vec>(l: number, t: number, out: T): T {
    const a = this.la[l];
    const b = this.lb[l];
    out.x = this.x[a] + (this.x[b] - this.x[a]) * t;
    out.y = this.y[a] + (this.y[b] - this.y[a]) * t;
    return out;
  }

  /** Hub → along the radial nearest (px, py) → the last node short of it. Node indices. */
  pathToward(px: number, py: number) {
    const hx = this.x[this.hub];
    const hy = this.y[this.hub];
    const ang = Math.atan2(py - hy, px - hx);
    const dist = Math.hypot(px - hx, py - hy);
    let k = 0;
    for (let i = 1; i < this.N; i++) if (Math.abs(angleDiff(this.rad[i].th, ang)) < Math.abs(angleDiff(this.rad[k].th, ang))) k = i;
    const path = [this.hub];
    const ck = this.chain[k];
    for (let i = 1; i < ck.length - 1; i++) {
      const ni = ck[i];
      if (Math.hypot(this.x[ni] - hx, this.y[ni] - hy) > dist - this.spacing * 0.5) break;
      path.push(ni);
    }
    return path;
  }
}
