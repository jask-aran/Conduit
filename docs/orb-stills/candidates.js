/*
 * Every frame considered for a settled turn's orb, as frame functions in the
 * thinking-orbs engine's contract: (size, t, opts) -> { dots, lines }. The
 * package's own animations come from its MODE_FRAMES; everything else is
 * built from the engine's exported pieces -- its camera (makeProj), its dot
 * scaling (radiusScale) and its z-sort (finalizeFrame) -- in its depth
 * language: near dots larger and brighter, far ones smaller and dimmer.
 *
 * The shipped frame is conduit-web/src/client/chat/orb-stills.ts; "Plain
 * sphere" below is the same geometry.
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

/* The package's states, and the options that calm some of them. */
export const STATES = ["working", "searching", "solving", "listening", "connecting", "weaving", "composing", "breathing", "shaping"];
export const CALMED = [
  ["globe, no scan (searching, scanMul 0)", animation("searching", { scanMul: 0 })],
  ["ring, no wobble (breathing, wobMul 0)", animation("breathing", { wobMul: 0 })],
  ["sash, no wobble (composing, wobMul 0)", animation("composing", { wobMul: 0 })],
  ["outline held on its circle (shaping, shape 0)", animation("shaping", { shape: 0 })],
  ["custom: Fibonacci sphere", fibonacciSphere],
];

/* Each candidate: [label, outcome, frame, how it is shown]. `outcome` sets
   the header's verb; `tint: true` draws it in the destructive colour. */
export const ROUNDS = [
  ["Shipped: plain sphere", [
    ["Done", "Done", plainSphere],
    ["Interrupted, red", "Interrupted", plainSphere, { tint: true }],
    ["Failed, red", "Failed", plainSphere, { tint: true }],
  ]],
  ["Round 1 — Done as the package's outline, Interrupted as the last step's state", [
    ["Done: outline held on its circle", "Done", still("shaping", { shape: 0 })],
    ["Failed: the same circle, red", "Failed", still("shaping", { shape: 0 }), { tint: true }],
    ["Interrupted: last step (working), 50%", "Interrupted", still("working"), { opacity: 0.5 }],
    ["Interrupted: last step (searching), 50%", "Interrupted", still("searching"), { opacity: 0.5 }],
  ]],
  ["Round 2 — Interrupted as a stop", [
    ["square (outline, shape 2)", "Interrupted", still("shaping", { shape: 2 })],
    ["square, 60%", "Interrupted", still("shaping", { shape: 2 }), { opacity: 0.6 }],
    ["circle with a gap", "Interrupted", () => gapped(still("shaping", { shape: 0 })(), -Math.PI / 4, 0.75)],
    ["circle with a gap, 60%", "Interrupted", () => gapped(still("shaping", { shape: 0 })(), -Math.PI / 4, 0.75), { opacity: 0.6 }],
    ["circle, 50%", "Interrupted", still("shaping", { shape: 0 }), { opacity: 0.5 }],
  ]],
  ["Round 3 — 3D stills from the engine's pieces", [
    ["Done: armillary (every orbit closed)", "Done", armillary],
    ["Done: plain sphere", "Done", plainSphere],
    ["Done: ringed planet", "Done", ringedPlanet],
    ["Done: tick pressed into the orb", "Done", () => pressed(TICK)],
    ["Interrupted: half-built sphere", "Interrupted", halfBuilt, { opacity: 0.6 }],
    ["Interrupted: dotted cube (the stop square in 3D)", "Interrupted", cube, { opacity: 0.6 }],
    ["Interrupted: orbits stalled mid-flight", "Interrupted", stalledOrbits, { opacity: 0.6 }],
    ["Interrupted: sphere stuck mid-twist", "Interrupted", midTwist, { opacity: 0.6 }],
    ["Failed: shattered sphere", "Failed", shattered, { tint: true }],
    ["Failed: split sphere", "Failed", split, { tint: true }],
  ]],
  ["Round 4 — two sets", [
    ["A · Done: tick pressed in", "Done", () => pressed(TICK)],
    ["A · Interrupted: stop square pressed in", "Interrupted", () => pressed(SQUARE)],
    ["A · Failed: cross pressed in", "Failed", () => pressed(CROSS), { tint: true }],
    ["B · Done: the orb at rest", "Done", plainSphere],
    ["B · Interrupted: dotted cube", "Interrupted", cube, { opacity: 0.6 }],
    ["B · Failed: the orb burst apart", "Failed", shattered, { tint: true }],
  ]],
];
