/*
 * The orb's catalogue: the thinking-orbs library's animations, the stills its
 * own options hold them at, the frames made for Conduit, and which state of a
 * turn uses each. Every frame is a function in the engine's contract --
 * (size, t, opts) -> { dots, lines } -- so the page draws them all the same
 * way. The library's come from its MODE_FRAMES; Conduit's are built from the
 * engine's exported pieces -- its camera (makeProj), its dot scaling
 * (radiusScale) and its z-sort (finalizeFrame) -- in its depth language:
 * near dots larger and brighter, far ones smaller and dimmer.
 *
 * The app's copies are conduit-web/src/client/chat/orb-stills.ts (the plain
 * sphere) and the state table in turn-trace.tsx; IN_APP below mirrors them.
 */
import { MODE_FRAMES, finalizeFrame, makeProj, radiusScale, resolvePreset } from "../../conduit-web/node_modules/thinking-orbs/dist/engine.es.js";

const S = 20, C = S / 2, R = C * 0.82, rs = radiusScale(S, 0.6), TAU = Math.PI * 2;

/* The package's animation for a state at the 20px preset, at time `t`, with
   any of its documented options overridden. */
export const animation = (state, over = {}) => (t) => {
  const { mode, speed, opts } = resolvePreset(state, S);
  return MODE_FRAMES[mode](S, t * speed, { ...opts, ...over });
};
/* The same, held at the moment Conduit shows a still: 0.6s in. */
const still = (state, over) => () => animation(state, over)(0.6);

const shade = (x, y, z, depth, { rBase = 1.05, rDepth = 2.975, boost = 0, lift = 0, a = 1 } = {}) =>
  ({ x, y, z, r: (rBase + rDepth * depth + boost) * rs, white: 0.62 - 0.54 * depth - lift, a });

function lattice(latRings, lonDensity, keep = () => true) {
  const out = [];
  for (let li = 0; li <= latRings; li++) {
    const lat = -Math.PI / 2 + (li / latRings) * Math.PI, c = Math.cos(lat), s = Math.sin(lat);
    const n = Math.max(1, Math.round(Math.abs(c) * lonDensity));
    for (let j = 0; j < n; j++) { const lon = (j / n) * TAU; const p = [c * Math.cos(lon), s, c * Math.sin(lon)]; if (keep(p, lat)) out.push({ p, li }); }
  }
  return out;
}

/* Points on a ring of radius r in the plane with normal n. */
function ring(n) {
  const l = Math.hypot(...n), N = n.map((v) => v / l);
  let u = Math.abs(N[1]) < 0.9 ? [-N[2], 0, N[0]] : [1, 0, 0]; const ul = Math.hypot(...u); u = u.map((v) => v / ul);
  const v = [N[1] * u[2] - N[2] * u[1], N[2] * u[0] - N[0] * u[2], N[0] * u[1] - N[1] * u[0]];
  return (a, r) => [0, 1, 2].map((i) => (u[i] * Math.cos(a) + v[i] * Math.sin(a)) * r);
}

/* A frame with the dots inside an arc of the circle dropped. */
const gapped = (frame, at, half) => ({ ...frame, dots: frame.dots.filter((d) => {
  const a = Math.atan2(d.y - C, d.x - C); return Math.abs(Math.atan2(Math.sin(a - at), Math.cos(a - at))) > half;
}) });

function plainSphere() {
  const pt = makeProj(0.55, 0.42, C, C, R);
  return finalizeFrame(lattice(6, 17).map(({ p }) => { const [x, y, z] = pt(...p); return shade(x, y, z, (z + 1) / 2); }), [], 0.3);
}

function fibonacciSphere(t) {
  const n = 64, dots = [];
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n, r = Math.sqrt(1 - y * y), a = i * 2.39996 + t;
    const x = Math.cos(a) * r, z = Math.sin(a) * r, tilt = 0.35;
    const y2 = y * Math.cos(tilt) - z * Math.sin(tilt), z2 = y * Math.sin(tilt) + z * Math.cos(tilt);
    dots.push({ x: C + x * 7.2, y: C + y2 * 7.2, z: z2, r: 0.45 + 0.35 * (z2 + 1) / 2, white: 0.15 + 0.6 * (1 - (z2 + 1) / 2) });
  }
  return finalizeFrame(dots, [], 0.3);
}

/* The orb at rest, dimmed, with a glyph laid on the face toward the viewer
   in the same dots, raised off the surface and shaded by its own depth. */
function pressed(strokes) {
  const pt = makeProj(0.55, 0.42, C, C, R), dots = [];
  for (const { p } of lattice(6, 17)) { const [x, y, z] = pt(...p); const d = (z + 1) / 2; dots.push(shade(x, y, z, d, { a: 0.28 + 0.3 * d })); }
  for (const stroke of strokes) for (let s = 0; s < stroke.length - 1; s++) {
    const [a, b] = [stroke[s], stroke[s + 1]], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.14));
    for (let k = s ? 1 : 0; k <= n; k++) {
      const u = a[0] + (b[0] - a[0]) * (k / n), v = a[1] + (b[1] - a[1]) * (k / n), w = Math.sqrt(Math.max(0, 1 - u * u - v * v)) * 1.06, d = (w + 1) / 2;
      dots.push({ x: C + u * R * 1.06, y: C - v * R * 1.06, z: 2 + w, r: (1.8 + 1.5 * d) * rs, white: 0.3 - 0.3 * d });
    }
  }
  return finalizeFrame(dots, [], 0.3);
}
const TICK = [[[-0.5, 0.02], [-0.16, -0.34], [0.52, 0.36]]];
const SQUARE = [[[-0.4, 0.4], [0.4, 0.4], [0.4, -0.4], [-0.4, -0.4], [-0.4, 0.4]]];
const CROSS = [[[-0.42, 0.42], [0.42, -0.42]], [[0.42, 0.42], [-0.42, -0.42]]];

const ORBITS = [[[0, 1, 0], 0.98], [[0.9, 0.35, 0.2], 0.9], [[-0.35, 0.45, 0.85], 0.82]];

function armillary() {
  const pt = makeProj(0.5, 0.42, C, C, 1), dots = [];
  for (const [n, rr] of ORBITS) { const at = ring(n); for (let k = 0; k < 24; k++) { const [x, y, z] = pt(...at((k / 24) * TAU, R * rr)); dots.push(shade(x, y, z, (z / R + 1) / 2, { rBase: 0.9, rDepth: 2.6 })); } }
  const [x, y] = pt(0, 0, 0); dots.push({ x, y, z: 0, r: 1.1, white: 0.02 });
  return finalizeFrame(dots, [], 0.3);
}

function ringedPlanet() {
  const pt = makeProj(0.4, 0.38, C, C, 1), dots = [];
  for (const { p } of lattice(5, 13)) { const [x, y, z] = pt(...p.map((v) => v * R * 0.6)); dots.push(shade(x, y, z, (z / (R * 0.6) + 1) / 2, { rBase: 0.8, rDepth: 2.4 })); }
  const at = ring([0.25, 1, -0.15]); for (let k = 0; k < 30; k++) { const [x, y, z] = pt(...at((k / 30) * TAU, R * 1.05)); dots.push(shade(x, y, z, (z / R + 1) / 2, { rBase: 0.8, rDepth: 2.6 })); }
  return finalizeFrame(dots, [], 0.3);
}

function halfBuilt() {
  const pt = makeProj(0.5, 0.5, C, C, R);
  return finalizeFrame(lattice(8, 17, (_p, lat) => lat <= 0.25).map(({ p, li }) => { const [x, y, z] = pt(...p); return shade(x, y, z, (z + 1) / 2, li === 5 ? { boost: 0.9, lift: 0.18 } : {}); }), [], 0.3);
}

function cube() {
  const pt = makeProj(0.62, 0.52, C, C, R * 0.62), dots = [], seen = new Set();
  const add = (p) => { const k = p.map((v) => v.toFixed(2)).join(); if (seen.has(k)) return; seen.add(k); const [x, y, z] = pt(...p); dots.push(shade(x, y, z, (z / 1.7 + 1) / 2, { rBase: 0.9, rDepth: 2.8 })); };
  for (const a of [-1, 1]) for (const b of [-1, 1]) for (let k = 0; k <= 5; k++) { const t = -1 + (2 * k) / 5; add([t, a, b]); add([a, t, b]); add([a, b, t]); }
  return finalizeFrame(dots, [], 0.3);
}

function stalledOrbits() {
  const pt = makeProj(0.5, 0.42, C, C, 1), dots = [];
  const reach = [[0.72, 0.4], [0.45, 2.2], [0.6, 4.1]];
  ORBITS.forEach(([n, rr], i) => { const at = ring(n); const [f0, from] = reach[i];
    for (let k = 0; k < 24; k++) { const f = k / 24; const [x, y, z] = pt(...at(from + f * TAU, R * rr)); dots.push(shade(x, y, z, (z / R + 1) / 2, f <= f0 ? { rBase: 0.8, rDepth: 2.4 } : { rBase: 0.6, rDepth: 1.2, a: 0.22 })); }
    const [x, y, z] = pt(...at(from + f0 * TAU, R * rr)); const d = (z / R + 1) / 2; dots.push({ x, y, z: z + 0.01, r: (2.2 + 3 * d) * rs, white: 0.28 - 0.22 * d }); });
  return finalizeFrame(dots, [], 0.3);
}

function midTwist() {
  const pt = makeProj(0.55, 0.42, C, C, R);
  return finalizeFrame(lattice(6, 17).map(({ p }) => { let [x0, y0, z0] = p, active = false;
    if (y0 > 0.3) { active = true; const c = Math.cos(0.62), s = Math.sin(0.62); [x0, z0] = [x0 * c - z0 * s, x0 * s + z0 * c]; }
    else if (x0 > 0.35) { active = true; const c = Math.cos(0.7), s = Math.sin(0.7); [y0, z0] = [y0 * c - z0 * s, y0 * s + z0 * c]; }
    const [x, y, z] = pt(x0, y0, z0); return shade(x, y, z, (z + 1) / 2, active ? { boost: 0.4, lift: 0.1 } : {}); }), [], 0.3);
}

function shattered() {
  const pt = makeProj(0.5, 0.42, C, C, R * 0.8);
  return finalizeFrame(lattice(6, 17).map(({ p }) => { const q = p.map((v) => v + (Math.sign(v) || 1) * 0.2); const [x, y, z] = pt(...q); return shade(x, y, z, (z / 1.2 + 1) / 2); }), [], 0.3);
}

function split() {
  const pt = makeProj(0.5, 0.42, C, C, R * 0.88);
  return finalizeFrame(lattice(6, 17).map(({ p }) => { const side = p[0] + 0.35 * Math.sin(p[1] * 6) > 0 ? 1 : -1; const [x, y, z] = pt(p[0] + side * 0.16, p[1] - side * 0.06, p[2]); return shade(x, y, z, (z / 1.1 + 1) / 2); }), [], 0.3);
}

/* The library's nine animations, at the 20px preset. */
export const LIBRARY = [
  ["working", "particles on tilted orbits"],
  ["searching", "a scan meridian sweeps a dotted globe"],
  ["solving", "bands scramble, then click back solved"],
  ["listening", "a waveform rolls through the rings"],
  ["connecting", "a constellation wires itself"],
  ["weaving", "three strands plait around the sphere"],
  ["composing", "an undulating multi-band sash"],
  ["breathing", "a ring slowly morphing"],
  ["shaping", "dotted outline: circle, triangle, square"],
].map(([state, what]) => [state, what, animation(state)]);

/* The same animations held or calmed by the library's documented options. */
export const LIBRARY_HELD = [
  ["searching · scanMul 0", "the globe without its scan", animation("searching", { scanMul: 0 })],
  ["breathing · wobMul 0", "the ring without its wobble", animation("breathing", { wobMul: 0 })],
  ["composing · wobMul 0", "the sash without its wobble", animation("composing", { wobMul: 0 })],
  ["shaping · shape 0", "the outline held on its circle", animation("shaping", { shape: 0 })],
  ["shaping · shape 1", "held on its triangle", animation("shaping", { shape: 1 })],
  ["shaping · shape 2", "held on its square", animation("shaping", { shape: 2 })],
];

/* Made for Conduit. All are stills but the Fibonacci sphere, which turns. */
export const CREATED = [
  ["plain sphere", "the searching globe's lattice at rest, without its scan", plainSphere],
  ["Fibonacci sphere", "evenly spread dots on a turning sphere", fibonacciSphere],
  ["armillary", "three orbits, each closed", armillary],
  ["ringed planet", "a small globe inside a tilted ring", ringedPlanet],
  ["tick pressed in", "the sphere dimmed, a tick laid on its face", () => pressed(TICK)],
  ["square pressed in", "the same, with the stop square", () => pressed(SQUARE)],
  ["cross pressed in", "the same, with a cross", () => pressed(CROSS)],
  ["half-built sphere", "the lattice up to just above its equator", halfBuilt],
  ["dotted cube", "the stop square in 3D", cube],
  ["orbits stalled", "three orbits, each drawn only as far as its particle got", stalledOrbits],
  ["sphere mid-twist", "two slabs of the lattice turned partway", midTwist],
  ["shattered sphere", "the lattice's octants pushed apart", shattered],
  ["split sphere", "the lattice parted along a jagged seam", split],
  ["circle with a gap", "the library's circle with an arc of dots removed", () => gapped(still("shaping", { shape: 0 })(), -Math.PI / 4, 0.75)],
];

/* Each state a turn's header shows, the orb it shows it with, and a line of
   the kind that sits under it. */
export const IN_APP = [
  ["Starting", "", "library · connecting", animation("connecting")],
  ["Thinking", "Weighing Shirakawa-go against Gokayama", "library · working", animation("working")],
  ["Searching", "\u201cgassho house group of 6\u201d", "library · searching", animation("searching")],
  ["Fetching", "yusuke-gokayama.com/en/guesthouse/", "library · searching", animation("searching")],
  ["Reading", "src/client/chat/turn-trace.tsx", "library · weaving", animation("weaving")],
  ["Editing", "src/client/chat/turn-trace.tsx", "library · shaping", animation("shaping")],
  ["Running", "npm run typecheck", "library · solving", animation("solving")],
  ["Using get_search_content", "Any tool without a kind of its own", "library · solving", animation("solving")],
  ["Running 3 tools", "Several at once", "library · solving", animation("solving")],
  ["Writing", "Weighing Shirakawa-go against Gokayama", "library · composing", animation("composing")],
  ["Done", "Fetched yusuke-gokayama.com/en/guesthouse/", "created · plain sphere", plainSphere, { settled: true }],
  ["Interrupted", "Clarifying room availability and pricing details", "created · plain sphere, destructive tint", plainSphere, { settled: true, tint: true }],
  ["Failed", "The provider returned an error", "created · plain sphere, destructive tint", plainSphere, { settled: true, tint: true }],
];
/* Not used by a turn: listening is kept for dictation; breathing has no state. */
