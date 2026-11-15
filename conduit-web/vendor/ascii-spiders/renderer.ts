// @ts-nocheck -- vendored as published (see LICENSE and COMMIT beside this file); checked upstream under its own compiler options
/**
 * Draws the World as a grid of ASCII cells, in the ascii-sharks hand (same grid, same font, same
 * paper and black):
 *
 *   silk    every thread is sampled through the cells it crosses. Each cell keeps the thread's direction,
 *           how much thread it holds, and where in the cell it runs, then picks one glyph: - _ ¯ for level
 *           threads, / \ | for the rest; where threads cross the strongest runs on through, and only the
 *           hub gets a * knot. Silk is faint, and brightens (cyan on black) where it is ringing.
 *   dew     a few beads on the capture spiral that twinkle.
 *   flies   one glyph each: x/+ on the wing, a stuck one thrashing, a wrapped one as @ shrinking to ·.
 *   spiders legs as stroke glyphs; bodies supersampled into blocks with carved glyphs, shaded from the
 *           top-left like the sharks, with each species' markings.
 */
import { clamp, hash3, type Vec } from "./math";
import type { Spider } from "./spider";
import { FRAME, HUB, MOOR, SILK_ALPHA, STAB, type OrbWeb } from "./web";
import type { Weaver } from "./weaver";
import type { World } from "./world";

const LEVELS = 24;
const ACCENTS = ["#e0892c", "#e03a32", "#b44ae0", "#33c8cc", "#3cb54a", "#3150e8", "#d9c14a"];
const PAPER = [247, 246, 243];
const INK = [35, 35, 35];

export type Theme = "dark" | "light";
/**
 * How much to draw. The blueprint pages step through these: the frame and its mooring lines, then the
 * radials and hub, then the whole web, then everything (spiders, flies and dew).
 */
export type Stage = "frame" | "radials" | "spiral" | "full";

type RGB = [number, number, number];

interface Palette {
  bg: string;
  grid: string;
  silk: RGB;
  ring: RGB;
  silkGain: number;
  dew: RGB;
  fly: RGB;
  heat: RGB;
  glyphLit: string;
  glyphShadow: string;
  eye: string;
  fleck: string;
  spot: string;
  fang: string;
  accents: string[];
  legLevel: (l: number) => number;
  legBlock: (l: number) => number;
  tone: (level: number, tr: number, tg: number, tb: number) => string;
}

const PALETTES: Record<Theme, Palette> = {
  dark: {
    bg: "#000",
    grid: "rgba(255,255,255,0.055)",
    silk: [214, 222, 238],
    ring: [110, 230, 255],
    silkGain: 1,
    dew: [240, 246, 255],
    fly: [226, 234, 250],
    heat: [255, 120, 60],
    glyphLit: "#0e0f13",
    glyphShadow: "#1b1d24",
    eye: "#d7deec",
    fleck: "#ffffff",
    spot: "#f2f6ff",
    fang: "#33c8cc",
    accents: ACCENTS,
    /** Legs stand out from the silk as filled cells: a bright glyph on a dim block on black... */
    legLevel: (l) => l * 1.12,
    legBlock: (l) => l * 0.34,
    tone: (level, tr, tg, tb) =>
      `rgb(${Math.min(255, Math.round(level * tr))},${Math.min(255, Math.round(level * tg))},${Math.min(255, Math.round(level * tb + 4))})`,
  },
  // Graphite on paper, as in ascii-sharks: lit surfaces fade toward the paper, shadow sinks toward the ink.
  light: {
    bg: "#f7f6f3",
    grid: "rgba(35,35,35,0.08)",
    silk: [35, 35, 35],
    ring: [35, 35, 35],
    silkGain: 0.85,
    dew: [35, 35, 35],
    fly: [35, 35, 35],
    heat: [35, 35, 35],
    glyphLit: "#232323",
    glyphShadow: "#161616",
    eye: "#f7f6f3",
    fleck: "#f7f6f3",
    spot: "#f7f6f3",
    fang: "#f7f6f3",
    accents: [],
    /** ...and a dark glyph on a pale graphite block on paper. */
    legLevel: (l) => 250 - l * 1.25,
    legBlock: (l) => 250 - l * 0.5,
    tone: (level, tr, tg, tb) => {
      const k = clamp(level / 255, 0, 1);
      const ch = (i: number, t: number) => Math.max(0, Math.min(PAPER[i], Math.round((INK[i] + (PAPER[i] - INK[i]) * k) * (1 + (t - 1) * 0.5))));
      return `rgb(${ch(0, tr)},${ch(1, tg)},${ch(2, tb)})`;
    },
  },
};

// Body cells.
const BODY = 1;
const MARK = 3;
const SPOT = 4;
const EYE = 5;
const FANG = 6;
const CROSS = 7;
const BAND = 8;
const SKIN_RAMP = ":;t%SX8#@";
const MARK_GLYPHS = "#%@";
const SPOT_GLYPHS = "o°o";
const EDGE_HEAVY = ":;";
const EDGE_LIGHT = ".',`";
const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

/** The last kind of silk each stage draws. */
const STAGE_KINDS: Record<Stage, number> = { frame: FRAME, radials: HUB, spiral: STAB, full: STAB };

/** A line glyph for a direction (as cos 2φ, sin 2φ) and where in the cell it runs (0 top → 1 bottom). */
function lineGlyph(nc: number, ns: number, m: number) {
  const phi = 0.5 * Math.atan2(ns, nc);
  const a = Math.abs(phi);
  if (a < 0.5) return m < 0.3 ? "¯" : m > 0.7 ? "_" : "-";
  if (a > 1.12) return "|";
  return phi > 0 ? "\\" : "/";
}

/**
 * The glyph for a cell of thread, from its accumulated direction moments. Only the hub, where the radials
 * all meet, gets a knot; where two or three threads cross, the strongest runs on through (radials over
 * the finer spiral), so the web reads as clean lines instead of a field of + and x.
 */
function strokeGlyph(cov: number, c2: number, s2: number, v: number, count: number, dc: number, ds: number, dv: number) {
  const nc = c2 / cov;
  const ns = s2 / cov;
  if (count >= 4 && Math.hypot(nc, ns) < 0.6) return "*";
  if (count >= 2) return lineGlyph(dc, ds, dv);
  return lineGlyph(nc, ns, v / cov);
}

/** Thread accumulated per cell; reset lazily by frame stamp. */
class Strokes {
  cols = 0;
  rows = 0;
  cov = new Float32Array(0);
  c2 = new Float32Array(0);
  s2 = new Float32Array(0);
  v = new Float32Array(0);
  /** The strongest thread's direction and place in the cell: it runs on through a crossing. */
  dc = new Float32Array(0);
  ds = new Float32Array(0);
  dv = new Float32Array(0);
  /** Brightness, and how hard the silk there is ringing. */
  a = new Float32Array(0);
  e = new Float32Array(0);
  count = new Uint16Array(0);
  last = new Int32Array(0);
  seen = new Uint32Array(0);
  cells = new Int32Array(0);
  length = 0;
  frame = 0;
  line = 0;
  /** Webs come far to near; a clearly nearer thread hides a farther one. */
  layered = false;
  private id = 0;
  private pc2 = 0;
  private ps2 = 0;

  resize(cols: number, rows: number) {
    const n = cols * rows;
    this.cols = cols;
    this.rows = rows;
    this.cov = new Float32Array(n);
    this.c2 = new Float32Array(n);
    this.s2 = new Float32Array(n);
    this.v = new Float32Array(n);
    this.dc = new Float32Array(n);
    this.ds = new Float32Array(n);
    this.dv = new Float32Array(n);
    this.a = new Float32Array(n);
    this.e = new Float32Array(n);
    this.count = new Uint16Array(n);
    this.last = new Int32Array(n);
    this.seen = new Uint32Array(n);
    this.cells = new Int32Array(n);
    this.length = 0;
    this.frame = 0;
    this.line = 0;
  }

  begin() {
    this.frame++;
    this.length = 0;
  }

  /**
   * One glyph per step along the line's major axis, as a hand-drawn ASCII line is: one cell per column
   * for a level thread, one per row for a steep one. Cell centres are claimed half-open, so threads that
   * meet end to end never double up, while two different threads through one cell make a crossing.
   */
  add(x0: number, y0: number, x1: number, y1: number, cw: number, ch: number, a: number, e = 0) {
    const gx0 = x0 / cw;
    const gy0 = y0 / ch;
    const dx = x1 / cw - gx0;
    const dy = y1 / ch - gy0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;
    this.id = ++this.line;
    const phi = Math.atan2(dy, dx);
    this.pc2 = Math.cos(2 * phi);
    this.ps2 = Math.sin(2 * phi);
    let any = false;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const lo = Math.min(gx0, gx0 + dx);
      const hi = Math.max(gx0, gx0 + dx);
      for (let c = Math.ceil(lo - 0.5); c + 0.5 < hi; c++) {
        const gy = gy0 + (dy * (c + 0.5 - gx0)) / dx;
        this.plot(c, Math.floor(gy), gy - Math.floor(gy), a, e);
        any = true;
      }
    } else {
      const lo = Math.min(gy0, gy0 + dy);
      const hi = Math.max(gy0, gy0 + dy);
      for (let r = Math.ceil(lo - 0.5); r + 0.5 < hi; r++) {
        const gx = gx0 + (dx * (r + 0.5 - gy0)) / dy;
        this.plot(Math.floor(gx), r, 0.5, a, e);
        any = true;
      }
    }
    // A stub shorter than a cell still shows, at its middle.
    if (!any) {
      const gy = gy0 + dy / 2;
      this.plot(Math.floor(gx0 + dx / 2), Math.floor(gy), gy - Math.floor(gy), a * Math.min(1, len * 1.5), e);
    }
  }

  private plot(c: number, r: number, v: number, a: number, e: number) {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return;
    const i = r * this.cols + c;
    if (this.seen[i] !== this.frame) {
      this.seen[i] = this.frame;
      this.cells[this.length++] = i;
      this.clear(i);
    } else if (this.layered) {
      // Webs come far to near: a clearly nearer thread hides a farther one rather than crossing it,
      // and a clearly farther one is hidden behind.
      if (a > this.a[i] * 1.35) this.clear(i);
      else if (a * 1.35 < this.a[i]) return;
    }
    this.cov[i] += 1;
    this.c2[i] += this.pc2;
    this.s2[i] += this.ps2;
    this.v[i] += v;
    if (this.last[i] !== this.id) (this.last[i] = this.id), this.count[i]++;
    if (a > this.a[i]) (this.a[i] = a), (this.dc[i] = this.pc2), (this.ds[i] = this.ps2), (this.dv[i] = v);
    if (e > this.e[i]) this.e[i] = e;
  }

  private clear(i: number) {
    this.cov[i] = this.c2[i] = this.s2[i] = this.v[i] = this.a[i] = this.e[i] = 0;
    this.count[i] = 0;
    this.last[i] = 0;
  }

  glyph(i: number) {
    return strokeGlyph(this.cov[i], this.c2[i], this.s2[i], this.v[i], this.count[i], this.dc[i], this.ds[i], this.dv[i]);
  }
}

export class AsciiRenderer {
  /** How much to draw: the blueprint pages step through the stages. */
  stage: Stage = "full";
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private silk = new Strokes();
  private legStrokes = new Strokes();
  private fontFamily = "ui-monospace, Menlo, monospace";
  private cw = 12;
  private ch = 17;
  private cols = 0;
  private rows = 0;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private frame = 0;
  private buckets = Array.from({ length: (LEVELS + 1) * 2 }, () => ({ cells: [] as number[], glyphs: [] as string[] }));
  private palette: Palette = PALETTES.dark;
  private silkStyles: string[] = [];
  private ringStyles: string[] = [];
  private flyStyles: string[] = [];
  private dewStyles: string[] = [];
  // The top layer: flies and spiders, which hide the silk under them.
  private topSeen = new Uint32Array(0);
  private topCells = new Int32Array(0);
  private topGlyph: string[] = [];
  private topColor: string[] = [];
  private topBlock: (string | null)[] = [];
  private topN = 0;
  // What the last body sample hit.
  private hitFlag = 0;
  private hitShade = 0;
  private hitKey = 0;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
    this.bg = document.createElement("canvas");
    this.setTheme("dark");
  }

  get cellWidth() {
    return this.cw;
  }

  get cellHeight() {
    return this.ch;
  }

  setFontFamily(f: string) {
    if (f) this.fontFamily = f;
  }

  setTheme(theme: Theme) {
    const p = (this.palette = PALETTES[theme] ?? PALETTES.dark);
    const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${a.toFixed(3)})`;
    this.silkStyles = [];
    this.ringStyles = [];
    this.flyStyles = [];
    this.dewStyles = [];
    for (let l = 0; l <= LEVELS; l++) {
      const a = l / LEVELS;
      this.silkStyles.push(rgba(p.silk, a));
      this.ringStyles.push(rgba(p.ring, a));
      this.flyStyles.push(rgba(p.fly, a));
      this.dewStyles.push(rgba(p.dew, a));
    }
    if (this.cols > 0) this.paintBackground();
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.cw = clamp(Math.round(width / 124), 8, 13);
    this.ch = Math.round(this.cw * 1.45);
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.bg.width = this.canvas.width;
    this.bg.height = this.canvas.height;
    const n = this.cols * this.rows;
    this.silk.resize(this.cols, this.rows);
    this.legStrokes.resize(this.cols, this.rows);
    this.topSeen = new Uint32Array(n);
    this.topCells = new Int32Array(n);
    this.topGlyph = new Array<string>(n);
    this.topColor = new Array<string>(n);
    this.topBlock = new Array<string | null>(n);
    this.topN = 0;
    this.paintBackground();
  }

  private paintBackground() {
    const g = this.bg.getContext("2d");
    if (!g) return;
    const { width: W, height: H, dpr, cw, ch } = this;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = this.palette.bg;
    g.fillRect(0, 0, this.bg.width, this.bg.height);
    g.strokeStyle = this.palette.grid;
    g.lineWidth = 1;
    g.beginPath();
    for (let c = 0; c <= Math.ceil(W / cw); c++) {
      const x = Math.round(c * cw * dpr) + 0.5;
      g.moveTo(x, 0);
      g.lineTo(x, H * dpr);
    }
    for (let r = 0; r <= Math.ceil(H / ch); r++) {
      const y = Math.round(r * ch * dpr) + 0.5;
      g.moveTo(0, y);
      g.lineTo(W * dpr, y);
    }
    g.stroke();
  }

  private cell(x: number, y: number) {
    const c = Math.floor(x / this.cw);
    const r = Math.floor(y / this.ch);
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1;
    return r * this.cols + c;
  }

  /** The top layer: flies and spiders, which hide the silk under them. Later puts win. */
  private put(i: number, glyph: string, color: string, block: string | null = null) {
    if (i < 0) return;
    if (this.topSeen[i] !== this.frame) {
      this.topSeen[i] = this.frame;
      this.topCells[this.topN++] = i;
    }
    this.topGlyph[i] = glyph;
    this.topColor[i] = color;
    this.topBlock[i] = block;
  }

  render(world: World) {
    const { ctx, dpr, cw, ch, palette: p } = this;
    if (!this.cols) return;
    this.frame++;
    this.topN = 0;
    const t = world.time;
    const full = this.stage === "full";

    if (full) {
      this.drawFlies(world);
      for (const b of world.heat) {
        const i = this.cell(b.x, b.y);
        const a = Math.round(clamp(b.life, 0, 1) * LEVELS);
        this.put(i, b.life > 0.5 ? "*" : "·", `rgba(${p.heat[0]},${p.heat[1]},${p.heat[2]},${(a / LEVELS).toFixed(2)})`);
      }
      // Far webs' spiders first, so nearer ones draw over them; the jumper is nearest of all.
      for (const w of world.weavers) this.drawSpider(w.spider, 0.72 + 0.28 * w.web.depth, t);
      if (world.jumper) this.drawSpider(world.jumper.spider, 1, t);
    }

    // ── silk ──
    const S = this.silk;
    S.begin();
    S.layered = true;
    const upTo = STAGE_KINDS[this.stage];
    for (const web of world.webs) this.addWeb(web, S, upTo);
    if (full) {
      for (const w of world.weavers) this.addThreads(w, S);
      const jd = world.jumper?.drag;
      if (jd && world.jumper) {
        world.jumper.spider.spinneret(tmp);
        S.add(jd.x, jd.y, tmp.x, tmp.y, cw, ch, 0.5 * jd.life * p.silkGain);
      }
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (const b of this.buckets) (b.cells.length = 0), (b.glyphs.length = 0);
    for (let k = 0; k < S.length; k++) {
      const i = S.cells[k];
      if (this.topSeen[i] === this.frame) continue;
      const cov = S.cov[i];
      if (cov < 0.1) continue;
      const e = S.e[i];
      const a = S.a[i] * (S.count[i] >= 4 ? 1.25 : 1) + clamp((e - 0.12) * 0.4, 0, 0.5);
      const ringing = e > 0.45 ? 1 : 0;
      const b = this.buckets[ringing * (LEVELS + 1) + clamp(Math.round(a * LEVELS), 1, LEVELS)];
      b.cells.push(i);
      b.glyphs.push(S.glyph(i));
    }
    const { cols } = this;
    for (let k = 0; k < this.buckets.length; k++) {
      const b = this.buckets[k];
      if (!b.cells.length) continue;
      ctx.fillStyle = k > LEVELS ? this.ringStyles[k - LEVELS - 1] : this.silkStyles[k];
      for (let j = 0; j < b.cells.length; j++) {
        const i = b.cells[j];
        ctx.fillText(b.glyphs[j], (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
      }
    }

    if (full) this.drawDew(world, t);

    // ── top layer ──
    for (let k = 0; k < this.topN; k++) {
      const i = this.topCells[k];
      const x = (i % cols) * cw;
      const y = ((i / cols) | 0) * ch;
      const block = this.topBlock[i];
      if (block) {
        ctx.fillStyle = block;
        ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
      }
      ctx.fillStyle = this.topColor[i];
      ctx.fillText(this.topGlyph[i], x + cw / 2, y + ch / 2 + 1);
    }
  }

  /** Near webs read clearly; far ones are a whisper. */
  private silkAlpha(web: OrbWeb) {
    return (0.04 + 0.36 * web.depth ** 1.6) * this.palette.silkGain;
  }

  private addWeb(web: OrbWeb, S: Strokes, upTo: number) {
    const { cw, ch } = this;
    const base = this.silkAlpha(web);
    const { x, y, la, lb, state, kind, speed, m } = web;
    for (let l = 0; l < m; l++) {
      if (state[l] !== 1 || kind[l] > upTo) continue;
      const a = la[l];
      const b = lb[l];
      const e = Math.max(speed[a], speed[b]);
      S.add(x[a], y[a], x[b], y[b], cw, ch, base * SILK_ALPHA[kind[l]], kind[l] === MOOR ? 0 : e);
    }
  }

  /** A weaver's loose silk: the thread it is laying (or reeling in), and the lines to its parcels. */
  private addThreads(w: Weaver, S: Strokes) {
    const { cw, ch } = this;
    const web = w.web;
    const base = this.silkAlpha(web);
    const sp = w.spider;
    if (w.partial >= 0) S.add(web.x[w.partial], web.y[w.partial], sp.rx, sp.ry, cw, ch, Math.min(1, base * 2.4));
    for (const parcel of [w.state === "carry" ? w.prey : null, w.bundle]) {
      if (!parcel) continue;
      sp.spinneret(tmp);
      S.add(tmp.x, tmp.y, parcel.x, parcel.y, cw, ch, Math.min(1, base * 2));
    }
  }

  private drawDew(world: World, t: number) {
    const { ctx, cw, ch, cols } = this;
    for (const web of world.webs) {
      const { dew, state, m } = web;
      for (let l = 0; l < m; l++) {
        if (dew[l] < 0 || state[l] !== 1) continue;
        web.pos(l, dew[l], tmp);
        const i = this.cell(tmp.x, tmp.y);
        if (i < 0 || this.topSeen[i] === this.frame) continue;
        const tw = 0.5 + 0.5 * Math.sin(t * (0.8 + hash3(l, web.seed, 9) * 1.4) + l * 1.37);
        const a = (0.3 + 0.6 * tw) * (0.45 + 0.55 * web.depth) * this.palette.silkGain;
        ctx.fillStyle = this.dewStyles[clamp(Math.round(a * LEVELS), 1, LEVELS)];
        ctx.fillText(tw > 0.94 ? "+" : "·", (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
      }
    }
  }

  private drawFlies(world: World) {
    for (const f of world.swarm.flies) {
      if (f.mode === "gone") continue;
      const i = this.cell(f.x, f.y);
      if (i < 0) continue;
      let g: string;
      let a = 0.5 + 0.45 * f.depth;
      switch (f.mode) {
        case "fly":
          g = Math.floor(f.phase * 12 + f.seed) % 2 ? "x" : "+";
          break;
        case "rest":
          g = "x";
          break;
        case "stuck":
          g = f.wrap > 0 ? (f.wrap < 0.5 ? "%" : "@") : Math.floor(f.phase * 15) % 3 ? "*" : "x";
          a = 1;
          break;
        case "wrapped":
          g = "@";
          a = 0.9;
          break;
        default: // held: shrinks as it is eaten
          g = f.digest < 0.35 ? "@" : f.digest < 0.65 ? "0" : f.digest < 0.88 ? "o" : "·";
          a = 0.85;
      }
      this.put(i, g, this.flyStyles[clamp(Math.round(a * LEVELS), 1, LEVELS)]);
    }
  }

  // ── spiders ──

  private drawSpider(sp: Spider, dim: number, t: number) {
    const { cw, ch, palette: p } = this;
    const spec = sp.sp;
    const [tr, tg, tb] = spec.tint;
    sp.solve();

    // Legs: stroke glyphs, each segment its own shade; banded species alternate light and dark.
    const L = this.legStrokes;
    L.begin();
    for (const leg of sp.legs) {
      const lv = spec.leg * (leg.i === 0 && spec.eyes ? 0.9 : 1);
      const band = spec.band;
      this.segment(L, leg.hx, leg.hy, leg.kx, leg.ky, lv, lv * (1 - band));
      this.segment(L, leg.kx, leg.ky, leg.fx, leg.fy, lv * 0.92, lv * (1 - band) * 0.92);
    }
    for (let k = 0; k < L.length; k++) {
      const i = L.cells[k];
      if (L.cov[i] < 0.12) continue;
      const lv = L.a[i] * dim;
      this.put(i, L.glyph(i), p.tone(p.legLevel(lv), tr, tg, tb), p.tone(p.legBlock(lv), tr, tg, tb));
    }

    // Body: supersample each cell of the bounding box against the two ellipses.
    const s = sp.scale;
    const B = sp.B * s;
    const reach = (spec.prosoma[0] + spec.abdomen[0]) * 2.1 * B;
    const c0 = Math.max(0, Math.floor((sp.rx - reach) / cw));
    const c1 = Math.min(this.cols - 1, Math.floor((sp.rx + reach) / cw));
    const r0 = Math.max(0, Math.floor((sp.ry - reach) / ch));
    const r1 = Math.min(this.rows - 1, Math.floor((sp.ry + reach) / ch));
    const tick = Math.floor(t * 2.4);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const x = c * cw;
        const y = r * ch;
        const center = this.sample(sp, x + cw / 2, y + ch / 2);
        const flag = this.hitFlag;
        const shade = this.hitShade;
        const key = this.hitKey;
        let hits = center ? 1 : 0;
        for (let k = 0; k < SUBSAMPLES.length; k += 2) if (this.sample(sp, x + SUBSAMPLES[k] * cw, y + SUBSAMPLES[k + 1] * ch)) hits++;
        if (!hits) continue;
        const i = r * this.cols + c;
        const cover = hits / 5;
        if (!center || cover < 0.6) {
          const set = cover >= 0.5 ? EDGE_HEAVY : EDGE_LIGHT;
          this.put(i, set[(key >>> 8) % set.length], p.tone((70 + cover * 80) * dim, tr, tg, tb));
          continue;
        }
        const roll = hash3(key, (tick + (key % 97) / 41) | 0, 7);
        let level: number;
        let glyph: string;
        let color: string;
        let ttr = tr;
        let ttg = tg;
        let ttb = tb;
        const dark = spec.eyes;
        switch (flag) {
          case EYE:
            level = 8;
            glyph = dark ? "O" : "o";
            color = p.eye;
            break;
          case FANG:
            level = 26;
            glyph = "v";
            color = p.fang;
            break;
          case MARK:
            level = 22 + shade * 26;
            glyph = MARK_GLYPHS[(key >>> 8) % MARK_GLYPHS.length];
            color = p.tone(70, tr, tg, tb);
            break;
          case SPOT:
            level = 120 + shade * 80;
            glyph = SPOT_GLYPHS[(key >>> 8) % SPOT_GLYPHS.length];
            color = p.spot;
            break;
          case CROSS:
            level = 110 + shade * 70;
            glyph = "+";
            color = p.spot;
            break;
          case BAND:
            // Argiope's bright bands: warm yellow on black, a paler graphite on paper.
            level = 120 + shade * 110;
            ttr = 1.18;
            ttg = 1.06;
            ttb = 0.42;
            glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * 6), 0, 8)];
            color = shade > 0.5 ? p.glyphLit : p.glyphShadow;
            break;
          default:
            level = dark ? 30 + shade * 96 : 48 + shade * 150;
            glyph = SKIN_RAMP[clamp(Math.floor((1 - shade) * 8.99) + (((key >>> 4) % 3) - 1), 0, SKIN_RAMP.length - 1)];
            if (p.accents.length && roll < 0.06) color = p.accents[key % p.accents.length];
            else if (roll < 0.1) color = p.fleck;
            else color = shade > 0.55 ? p.glyphLit : p.glyphShadow;
        }
        this.put(i, glyph, color, p.tone(level * dim, ttr, ttg, ttb));
      }
    }
  }

  /** A leg segment in two halves, so banded legs alternate shade along their length. */
  private segment(L: Strokes, x0: number, y0: number, x1: number, y1: number, l0: number, l1: number) {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    L.add(x0, y0, mx, my, this.cw, this.ch, l0);
    L.add(mx, my, x1, y1, this.cw, this.ch, l1);
  }

  /**
   * Classify a point against a spider's body. Body frame: u forward from the pedicel, v to the right.
   * Writes hitFlag, hitShade and hitKey (a body-anchored hash, so glyphs ride along with the body).
   */
  private sample(sp: Spider, px: number, py: number) {
    const spec = sp.sp;
    const s = sp.scale;
    const B = sp.B;
    const c = Math.cos(sp.h);
    const sn = Math.sin(sp.h);
    const dx = (px - sp.rx) / s;
    const dy = (py - sp.ry) / s;
    const u = dx * c + dy * sn;
    const v = -dx * sn + dy * c;
    const pa = spec.prosoma[0] * B;
    const pb = spec.prosoma[1] * B;
    const pu = sp.prosomaU;
    const cw = this.cw / s;
    this.hitKey = (hash3(Math.round(u / (cw * 0.9)), Math.round(v / (cw * 0.9)), sp.id) * 4294967295) >>> 0;

    // Prosoma: an ellipse, or a rounded box for the jumper.
    let eu = (u - pu) / pa;
    let ev = v / pb;
    let e = spec.boxy ? Math.pow(Math.abs(eu) ** 3 + Math.abs(ev) ** 3, 2 / 3) : eu * eu + ev * ev;
    if (e < 1) {
      this.hitShade = this.lit(eu / pa, ev / pb, Math.sqrt(e), c, sn) * 0.92;
      this.hitFlag = BODY;
      if (spec.eyes) {
        // Two great forward eyes, at least a cell each, and the iridescent fangs between them.
        const er = Math.max(pb * 0.38, cw * 0.62);
        const ex = u - (pu + pa * 0.5);
        for (const side of [-1, 1]) {
          const ey = v - side * Math.max(pb * 0.46, cw * 0.7);
          if (ex * ex + ey * ey < er * er) this.hitFlag = EYE;
        }
        if (this.hitFlag === BODY && eu > 0.78 && Math.abs(ev) < 0.42) this.hitFlag = FANG;
      }
      return true;
    }

    // Abdomen. The abdomen breathes.
    const aa = spec.abdomen[0] * B * sp.breath;
    const ab = spec.abdomen[1] * B * (2 - sp.breath);
    eu = (u - sp.abdomenU) / aa;
    ev = v / ab;
    e = eu * eu + ev * ev;
    if (e >= 1) return false;
    const across = Math.sqrt(e);
    this.hitShade = this.lit(eu / aa, ev / ab, across, c, sn);
    this.hitFlag = BODY;
    const ch = this.ch / s;
    const au = u - sp.abdomenU;
    switch (spec.pattern) {
      case "cross": {
        // The garden spider's cross on a dark scalloped folium.
        const mid = Math.abs(v) < Math.max(ab * 0.16, cw * 0.55);
        const bar = Math.abs(au - aa * 0.28) < Math.max(aa * 0.12, ch * 0.5) && Math.abs(v) < ab * 0.5;
        if ((mid && eu > -0.45 && eu < 0.78) || bar) this.hitFlag = CROSS;
        else if (Math.abs(ev) < 0.62 + 0.12 * Math.sin(eu * 9) && eu < 0.6) this.hitFlag = MARK;
        break;
      }
      case "bands": {
        const n = Math.max(2, Math.round((aa * 2) / (ch * 1.7)));
        if (Math.sin((eu * 0.5 + 0.5) * Math.PI * n * 2 + 0.6) > 0.15) this.hitFlag = MARK;
        else this.hitFlag = BAND;
        break;
      }
      case "spots": {
        const lane = Math.abs(Math.abs(v) - ab * 0.5) < Math.max(ab * 0.22, cw * 0.45);
        if (lane && Math.sin(eu * 9) > 0.3) this.hitFlag = SPOT;
        break;
      }
      case "jumper": {
        // Phidippus: a pale triangle and two spots on black, a pale band across the front.
        if (eu > 0.72) this.hitFlag = SPOT;
        else if (eu > -0.05 && eu < 0.45 && Math.abs(v) < Math.max(ab * 0.32 * (1 - (0.45 - eu)), cw * 0.5)) this.hitFlag = SPOT;
        else if (Math.abs(eu + 0.45) < 0.16 && Math.abs(Math.abs(v) - ab * 0.5) < Math.max(ab * 0.16, cw * 0.4)) this.hitFlag = SPOT;
        break;
      }
    }
    return true;
  }

  /** Rounded body lit from the top-left, as the sharks are. */
  private lit(nu: number, nv: number, across: number, c: number, sn: number) {
    const l = Math.hypot(nu, nv) || 1;
    const nx = (nu * c - nv * sn) / l;
    const ny = (nu * sn + nv * c) / l;
    const facing = (nx * -0.6 + ny * -0.8) * across;
    return clamp(0.58 - across * across * 0.42 + facing * 0.26, 0, 1);
  }
}

const tmp: Vec = { x: 0, y: 0 };
