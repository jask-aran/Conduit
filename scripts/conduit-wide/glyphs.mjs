// Conduit Wide: every glyph drawn from the settings below. The tuning page and the font build both import this
// file, so what the page shows is what the font is. Units are font units (1000 to the em), y up from the baseline.
// The defaults reproduce Druk Wide Super's proportions (measured, not traced): stems 364, round counters, shoulders
// that spring from below the stem's top.
//
// C o c n u d i t are drawn straight from the settings. Every other glyph is drawn once at those default proportions
// and then refitted: its outline is cut into vertical zones (stems, holes, diagonals) and horizontal ones (strokes,
// holes), and each zone is resized to the current weight, hole size, stretch, contrast and x-height.

export const CAP = 744;
const DESC = -188;

export const SETTINGS = [
  { key: "weight", label: "Weight", min: 240, max: 460, step: 2, value: 364, about: "Thickness of the upright strokes" },
  { key: "contrast", label: "Horizontal strokes", min: 0.3, max: 0.65, step: 0.005, value: 0.465, about: "Top and bottom strokes as a share of the uprights" },
  { key: "xHeight", label: "x-height", min: 470, max: 620, step: 2, value: 538, about: "Height of the lowercase" },
  { key: "counter", label: "Hole size", min: 120, max: 420, step: 2, value: 241, about: "Width of the hole in the o; every other hole follows it" },
  { key: "stretch", label: "Stretch", min: 0, max: 600, step: 5, value: 0, about: "Extra width in round letters (C, O, o, d, 0…)" },
  { key: "straightShare", label: "Straight letters stretch", min: 0, max: 1, step: 0.01, value: 0.4, about: "How much of the stretch straight and diagonal letters take (i, l, t, f take none)" },
  { key: "flat", label: "Flat top", min: 0, max: 400, step: 2, value: 84, about: "Straight run along the top and bottom of round letters" },
  { key: "squareness", label: "Squareness", min: 0.5, max: 0.92, step: 0.01, value: 0.62, about: "From elliptical (left) to squarish (right) curves" },
  { key: "shoulderDrop", label: "Shoulder drop", min: 0, max: 200, step: 1, value: 101, about: "How far below the stem's top the arches of n, h, m, r, u, b, d, p, q spring" },
  { key: "aperture", label: "C opening", min: 30, max: 260, step: 2, value: 102, about: "Height of the slot that opens the C and c" },
  { key: "dotGap", label: "i dot gap", min: 10, max: 140, step: 1, value: 31, about: "Space between the i or j and its dot" },
  { key: "spacing", label: "Spacing", min: 0, max: 90, step: 1, value: 27, about: "Room beside straight sides; round sides get half, diagonals overhang" },
  { key: "tracking", label: "Tracking", min: -80, max: 120, step: 1, value: 0, about: "Added between every pair" },
];
export const PAIRS = ["Co", "on", "nd", "du", "ui", "it"];
export const DEFAULTS = Object.fromEntries([...SETTINGS.map((s) => [s.key, s.value]), ...PAIRS.map((pair) => [`kern_${pair}`, 0])]);
export const CHARSET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:;!?'\"-–—()/&@#";

const OVERSHOOT = 14;
const corner = (rx, ry = rx) => ({ rx, ry });

// A contour is a list of points [x, y, corner?, curve?]. A corner rounds that point, reaching rx along horizontal
// edges and ry along vertical ones, clamped so neighbouring corners never overlap. A curve [c1, c2] makes the edge to
// the next point a cubic with those handles instead of a line. A contour marked `hole` cuts out of the others.
function outline(points, k) {
  const n = points.length;
  const reach = points.map(([x, y, c], i) => {
    if (!c) return [0, 0];
    const along = ([ax, ay]) => (Math.abs(ay - y) < 1e-6 ? c.rx : Math.abs(ax - x) < 1e-6 ? c.ry : Math.min(c.rx, c.ry));
    return [along(points[(i + n - 1) % n]), along(points[(i + 1) % n])];
  });
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const length = Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1]);
    const want = reach[i][1] + reach[j][0];
    if (want > length) { reach[i][1] *= length / want; reach[j][0] *= length / want; }
  }
  const toward = ([x, y], [tx, ty], d) => { const l = Math.hypot(tx - x, ty - y) || 1; return [x + (tx - x) * d / l, y + (ty - y) * d / l]; };
  const segments = [];
  points.forEach((p, i) => {
    const [inD, outD] = reach[i];
    const prev = points[(i + n - 1) % n];
    const arrive = (to) => segments.push(prev[3] ? ["C", prev[3][0], prev[3][1], to] : ["L", to]);
    if (!inD && !outD) { arrive([p[0], p[1]]); return; }
    const a = toward(p, prev, inD), b = toward(p, points[(i + 1) % n], outD);
    arrive(a);
    segments.push(["C", [a[0] + (p[0] - a[0]) * k, a[1] + (p[1] - a[1]) * k], [b[0] + (p[0] - b[0]) * k, b[1] + (p[1] - b[1]) * k], b]);
  });
  return segments;
}

// Outer contours run counter-clockwise and holes clockwise, so overlapping pieces join and holes cut (nonzero fill).
function orient(points) {
  let area = 0;
  points.forEach(([x, y], i) => { const [u, v] = points[(i + 1) % points.length]; area += x * v - u * y; });
  if ((area > 0) === !points.hole) return points;
  const n = points.length;
  return keep(points, points.map((_, i) => {
    const p = points[n - 1 - i], before = points[(2 * n - 2 - i) % n];
    return [p[0], p[1], p[2], before[3] && [before[3][1], before[3][0]]];
  }));
}

const keep = (from, to) => { to.hole = from.hole; return to; };
const mark = (points) => { points.hole = true; return points; };
const move = (points, f) => keep(points, points.map(([x, y, c, curve]) => [...f(x, y), c, curve?.map(([cx, cy]) => f(cx, cy))]));
const flip = (points, w) => move(points, (x, y) => [w - x, y]);
const turn = (points, w, h) => move(points, (x, y) => [w - x, h - y]);
const shift = (points, dx, dy = 0) => move(points, (x, y) => [x + dx, y + dy]);
const box = (x0, y0, x1, y1, c) => [[x0, y0, c], [x1, y0, c], [x1, y1, c], [x0, y1, c]];
const box4 = (x0, y0, x1, y1, [bl, br, tr, tl]) => [[x0, y0, bl], [x1, y0, br], [x1, y1, tr], [x0, y1, tl]];
// A hole: round ends, and a flat run between them once it is wider than it is tall.
const hole = (x0, y0, x1, y1) => mark(box(x0, y0, x1, y1, corner(Math.min(x1 - x0, (y1 - y0) * 1.05) / 2, (y1 - y0) / 2)));
const oval = (x0, y0, x1, y1) => mark(box(x0, y0, x1, y1, corner((x1 - x0) / 2, (y1 - y0) / 2)));
// A hole against a stem on its left, rounded on its right.
const slot = (x0, y0, x1, y1, r = corner((y1 - y0) / 2)) => mark(box4(x0, y0, x1, y1, [null, r, r, null]));

// n's outline: an upright with a shoulder that springs from below its top and arches over a round-topped hole.
const arch = (S, H, X, drop, cw, stemTop = X) => {
  const w = 2 * S + cw, hi = X + 12, spring = S * 0.82, round = corner(cw / 2);
  return [[0, 0], [S, 0], [S, hi - H * 1.22, round], [S + cw, hi - H * 1.22, round], [S + cw, 0], [w, 0], [w, hi, corner(S * 0.73, hi * 0.36)],
    [S + spring, hi, null, [[S + spring * 0.5, hi], [S + drop * 0.45, X - drop * 0.55]]], [S, X - drop], [S, stemTop], [0, stemTop]];
};

// The slab-round letters (o, c, C), n, u, d, i, t, drawn straight from the settings.
function core(p) {
  const S = p.weight, H = S * p.contrast, X = p.xHeight, drop = p.shoulderDrop;
  const out = {}, add = (ch, width, contours, sides) => { out[ch] = { width, contours, sides }; };

  const lo = -OVERSHOOT, hi = X + OVERSHOOT, cw = p.counter + p.stretch;
  let w = 2 * S + cw;
  const R = corner((w - p.flat - p.stretch) / 2, (hi - lo) / 2);
  add("o", w, [box(0, lo, w, hi, R), hole(S, lo + H, S + cw, hi - H)], "rr");

  const open = (w, lo, hi, H, R, cw, slot) => {
    const mid = (lo + hi) / 2, x = S + cw, ch = hi - lo - 2 * H, ci = corner(Math.min(cw, ch * 1.05) / 2, ch / 2);
    return [[0, lo, R], [w, lo, R], [w, mid - slot / 2], [x, mid - slot / 2], [x, lo + H, ci], [S, lo + H, ci], [S, hi - H, ci], [x, hi - H, ci], [x, mid + slot / 2], [w, mid + slot / 2], [w, hi, R], [0, hi, R]];
  };
  add("c", w, [open(w, lo, hi, H, R, cw, p.aperture * 0.8)], "rr");
  const HC = H * 1.4, cwC = p.counter * 1.63 + p.stretch * 1.15, capLo = -15, capHi = CAP + 15;
  w = 2 * S + cwC;
  add("C", w, [open(w, capLo, capHi, HC, corner((w - p.flat * 0.4 - p.stretch * 1.15) / 2, (capHi - capLo) / 2), cwC, p.aperture)], "rr");

  const cwN = p.counter * 0.855 + p.stretch * p.straightShare;
  w = 2 * S + cwN;
  const n = arch(S, H, X, drop, cwN);
  add("n", w, [n], "ss");
  add("u", w, [turn(n, w, X)], "ss");

  // d: o's left half meeting an upright, joined top and bottom the way n's shoulder is
  const cwD = p.counter * 0.85 + p.stretch, dLo = -6, dHi = X + 4, top = drop * 0.62, bottom = drop * 0.7, reach = S * 0.69;
  w = 2 * S + cwD;
  const stem = w - S, bowl = corner(S * 0.8, (dHi - dLo) / 2);
  add("d", w, [[[w, 0], [w, CAP], [stem, CAP], [stem, X - top, null, [[stem - top * 0.6, X - top + top * 0.4], [stem - reach * 0.5, dHi]]], [stem - reach, dHi],
    [0, dHi, bowl], [0, dLo, bowl], [stem - reach, dLo, null, [[stem - reach * 0.5, dLo], [stem - bottom * 0.6, bottom * 0.6]]], [stem, bottom], [stem, 0]],
    hole(S, dLo + H, S + cwD, dHi - H)], "rs");

  add("i", S, [box(0, 0, S, X), box(0, X + p.dotGap, S, CAP)], "ss");

  const left = S * 0.275, bar = H * 1.17, foot = H * 1.2, tTop = X + (CAP - X) * 0.76;
  w = left + S + S * 0.27;
  add("t", w, [[[left, 0, corner(S * 0.44, foot * 0.76)], [w, 0], [w, foot], [left + S, foot, corner(S * 0.13)], [left + S, X - bar], [w, X - bar], [w, X], [left + S, X], [left + S, tTop], [left, tTop], [left, X], [0, X], [0, X - bar], [left, X - bar]]], "rr");
  return out;
}

// The default proportions every other glyph is drawn at.
const BS = 364, BH = 169, BX = 538, BC = 241;

// Every other glyph at the default proportions. Each lists its vertical zones (xz edges, xk kinds: s stem, c hole,
// d diagonal, k kept) and optionally horizontal ones (yz edges, yk kinds: h stroke, c hole), whether it sits on the
// x-height (lc), how much of the stretch it takes (share: 1 round, "s" straight, 0 none), and its sides.
function sketch(p) {
  const S = BS, H = BH, X = BX, drop = p.shoulderDrop, flat = p.flat;
  const out = {};
  const add = (ch, w, contours, o) => { out[ch] = { w, contours, sides: "ss", share: "s", hang: [0, 0], ...o }; };
  const base = core({ ...p, weight: BS, contrast: BH / BS, xHeight: BX, counter: BC, stretch: 0 });

  // b p q g: d's bowl and stem, mirrored and turned
  const d = base.d.contours, dw = base.d.width, bowlY = { yz: [-6, 163, 373, 542], yk: "hch" };
  const dz = { xz: [0, S, dw - S, dw], xk: "scs", share: 1, lc: true };
  add("b", dw, d.map((c) => flip(c, dw)), { ...dz, ...bowlY, sides: "sr" });
  const descend = (c, to) => move(c, (x, y) => [x, y < -150 ? to : y]);
  const pq = d.map((c) => descend(turn(c, dw, X), DESC)), pqY = { yz: [-4, 165, 375, 544], yk: "hch" };
  add("p", dw, pq, { ...dz, ...pqY, sides: "sr" });
  const q = pq.map((c) => flip(c, dw));
  add("q", dw, q, { ...dz, ...pqY, sides: "rs" });
  const sx = dw - S;
  add("g", dw, [...q.map((c) => descend(c, 0)),
    [[dw, 80], [dw, -196, corner(330, 250)], [33, -196, corner(380, 190)], [33, 0], [397, 0], [397, -34, corner(80, 34)], [sx, -34, corner(100)], [sx, 80]]],
    { ...dz, ...pqY, sides: "rs" });

  // h m r: n's arch
  const archY = { yz: [0, 344, 550], yk: "ch", lc: true };
  add("h", 2 * S + 206, [arch(S, H, X, drop, 206, CAP)], { xz: [0, S, S + 206, 2 * S + 206], xk: "scs", ...archY });
  add("m", 1452, [arch(S, H, X, drop, 180), shift(arch(S, H, X, drop, 179), 544)], { xz: [0, S, 544, 908, 1087, 1452], xk: "scscs", ...archY });
  const r = arch(S, H, X, drop, 134).map(([x, y, c, curve], i) => [x, i === 4 || i === 5 ? 218 : y, c, curve]);
  add("r", 2 * S + 134, [r], { xz: [0, S, S + 134, 2 * S + 134], xk: "scs", ...archY, sides: "sr" });

  // a: a hooded stem with a spur, over a small bowl
  add("a", 915, [
    [[509, 0, corner(92, 68)], [915, 0], [915, 177], [870, 177, corner(14)], [870, 551, corner(400, 190)], [13, 551, corner(330, 170)], [13, 361], [351, 361], [351, 405, corner(80, 40)], [509, 405, corner(60, 34)]],
    box4(0, -10, 549, 335, [corner(250, 170), corner(300, 150), null, corner(200, 150)]),
    hole(353, 127, 509, 241),
  ], { xz: [0, 353, 509, 870, 915], xk: "scsk", share: 1, lc: true, sides: "rr" });

  // e: the o, its hole split by a bar into a closed eye and a slot open to the right
  {
    const w = 944, lo = -15, hi = 553, x1 = 580, R = corner((w - flat) / 2, (hi - lo) / 2);
    add("e", w, [
      [[0, lo, R], [w, lo, R], [w, 206], [x1, 206], [x1, 154, corner(100, 52)], [S, 154, corner(108, 85)], [S, 239], [w, 239], [w, hi, R], [0, hi, R]],
      mark([[S, 347], [x1, 347], [x1, 407, corner(108, 60)], [S, 407, corner(108, 60)]]),
    ], { xz: [0, S, x1, w], xk: "scs", share: 1, lc: true, sides: "rr", yz: [-15, 154, 206, 239, 347, 407, 553], yk: "hcchch" });
  }

  // s: two hooks sharing a spine, each ending in a level cut
  add("s", 869, [[
    [0, 184], [367, 184], [367, 132, corner(60, 52)], [490, 132, corner(63, 36)], [490, 205, corner(40, 36)], [9, 205, corner(256, 140)],
    [9, 553, corner(380, 170)], [847, 553, corner(380, 170)], [847, 382], [490, 382], [490, 422, corner(60, 40)], [368, 422, corner(62, 30)],
    [368, 357, corner(22, 33)], [869, 357, corner(280, 176)], [869, -15, corner(400, 190)], [0, -15, corner(385, 190)],
  ]], { xz: [0, 367, 490, 869], xk: "scs", share: 1, lc: true, sides: "rr" });

  add("f", 583, [[[112, 0], [477, 0], [477, 340], [583, 340], [583, 538], [477, 538], [477, 578, corner(28, 30)], [583, 578], [583, 744], [112, 744, corner(216, 174)], [112, 538], [0, 538], [0, 340], [112, 340]]],
    { xz: [0, 112, 477, 583], xk: "ksk", share: 0, lc: true, sides: "rr" });
  add("j", 424, [[[60, X], [424, X], [424, DESC, corner(165)], [0, DESC], [0, -20], [60, -20, corner(30, 35)]], box(60, X + p.dotGap, 424, CAP)],
    { xz: [0, 60, 424], xk: "ks", share: 0, lc: true, hang: [60, 0] });
  add("k", 899, [[[0, 0], [0, CAP], [S, CAP], [S, 343], [483, 538], [865, 538], [714, 314], [899, 0], [499, 0], [S, 229], [S, 0]]],
    { xz: [0, S, 899], xk: "sd", lc: true, sides: "sd" });
  add("l", S, [box(0, 0, S, CAP)], { xz: [0, S], xk: "s", share: 0, lc: true });
  add("v", 961, [[[220, 0], [0, 538], [389, 538], [488, 216], [579, 538], [961, 538], [752, 0]]], { xz: [0, 389, 579, 961], xk: "dcd", lc: true, sides: "dd" });
  add("w", 1386, [[[192, 0], [0, 538], [379, 538], [452, 217], [521, 538], [888, 538], [955, 220], [1026, 538], [1386, 538], [1202, 0], [767, 0], [705, 258], [643, 0]]],
    { xz: [0, 379, 521, 888, 1026, 1386], xk: "dcdcd", lc: true, sides: "dd" });
  add("x", 979, [[[4, 0], [188, 284], [0, 538], [397, 538], [488, 394], [566, 538], [958, 538], [784, 288], [979, 0], [578, 0], [487, 162], [392, 0]]],
    { xz: [0, 397, 566, 979], xk: "dcd", lc: true, sides: "dd" });
  add("y", 933, [[[0, 538], [386, 538], [491, 233], [575, 538], [933, 538], [718, 3, null, [[680, -95], [580, -188]]], [493, DESC], [129, DESC], [129, -11], [268, -11, corner(24, 40)], [249, 57]]],
    { xz: [0, 386, 575, 933], xk: "dcd", lc: true, sides: "dd" });
  add("z", 771, [[[1, 0], [1, 177], [337, 353], [0, 353], [0, 538], [771, 538], [771, 361], [443, 196], [771, 196], [771, 0]]], { xz: [0, 771], xk: "d", lc: true, sides: "rr" });

  // Capitals: stems 380, strokes about 1.2 of the lowercase ones
  add("A", 1258, [[[0, 0], [351, 744], [885, 744], [1258, 0], [834, 0], [795, 89], [423, 89], [384, 0]], mark([[518, 309], [698, 309], [607, 515]])],
    { xz: [0, 518, 698, 1258], xk: "dcd", sides: "dd" });
  add("B", 1145, [box4(0, 0, 1145, 440, [null, corner(326, 220), corner(200, 100), null]), box4(0, 400, 1101, 744, [null, corner(200, 100), corner(282, 170), null]),
    slot(380, 479, 713, 551), slot(380, 200, 741, 292)], { xz: [0, 380, 727, 1145], xk: "scs", sides: "sr", yz: [0, 200, 292, 479, 551, 744], yk: "hchch" });
  add("D", 1154, [box4(0, 0, 1154, 744, [null, corner(560, 360), corner(560, 360), null]), slot(380, 230, 761, 513, corner(230, 141))],
    { xz: [0, 380, 761, 1154], xk: "scs", share: 1, sides: "sr", yz: [0, 230, 513, 744], yk: "hch" });
  add("E", 901, [[[0, 0], [901, 0], [901, 210], [374, 210], [374, 274], [891, 274], [891, 478], [374, 478], [374, 536], [897, 536], [897, 744], [0, 744]]],
    { xz: [0, 374, 901], xk: "sc", sides: "sr", yz: [0, 210, 274, 478, 536, 744], yk: "hchch" });
  add("F", 880, [[[0, 0], [374, 0], [374, 269], [872, 269], [872, 476], [374, 476], [374, 536], [880, 536], [880, 744], [0, 744]]],
    { xz: [0, 374, 880], xk: "sc", sides: "sr", yz: [0, 269, 476, 536, 744], yk: "chch" });
  add("G", 1186, [[[1186, 0], [1186, 423], [582, 423], [582, 271], [783, 271], [783, 205, corner(170, 66)], [391, 205, corner(200, 164)], [391, 534, corner(200, 164)],
    [793, 534, corner(185, 40)], [793, 463], [1181, 463], [1181, 759, corner(550, 240)], [0, 759, corner(500, 370)], [0, -15, corner(500, 370)], [886, -15, corner(370, 93)], [886, 78], [931, 0]]],
    { xz: [0, 391, 793, 1186], xk: "scs", share: 1, sides: "rs" });
  add("H", 1158, [[[0, 744], [380, 744], [380, 497], [778, 497], [778, 744], [1158, 744], [1158, 0], [778, 0], [778, 265], [380, 265], [380, 0], [0, 0]]],
    { xz: [0, 380, 778, 1158], xk: "scs", yz: [0, 265, 497, 744], yk: "chc" });
  add("I", 379, [box(0, 0, 379, CAP)], { xz: [0, 379], xk: "s", share: 0 });
  add("J", 1013, [[[632, 744], [1013, 744], [1013, -11, corner(470, 390)], [0, -11, corner(450, 345)], [0, 356], [360, 356], [360, 256, corner(130, 90)], [632, 256, corner(130, 134)]]],
    { xz: [0, 360, 632, 1013], xk: "scs", sides: "rs" });
  add("K", 1182, [[[0, 0], [0, 744], [380, 744], [380, 480], [718, 744], [1180, 744], [738, 410], [1182, 0], [686, 0], [380, 297], [380, 0]]],
    { xz: [0, 380, 1182], xk: "sd", sides: "sd" });
  add("L", 896, [[[0, 0], [896, 0], [896, 265], [380, 265], [380, 744], [0, 744]]], { xz: [0, 380, 896], xk: "sc", sides: "sr" });
  add("M", 1335, [[[0, 744], [501, 744], [676, 413], [858, 744], [1335, 744], [1335, 0], [957, 0], [957, 368], [757, 0], [576, 0], [377, 368], [377, 0], [0, 0]]],
    { xz: [0, 377, 957, 1335], xk: "scs" });
  add("N", 1159, [[[429, 744], [779, 406], [779, 744], [1159, 744], [1159, 0], [772, 0], [380, 372], [380, 0], [0, 0], [0, 744]]], { xz: [0, 380, 779, 1159], xk: "scs" });
  const O = [box(0, -15, 1208, 759, corner((1208 - flat * 0.6) / 2, 387)), oval(391, 224, 816, 522)], OZ = { xz: [0, 391, 816, 1208], xk: "scs", share: 1, sides: "rr", yz: [-15, 224, 522, 759], yk: "hch" };
  add("O", 1208, O, OZ);
  add("Q", 1208, [...O, [[462, -11], [462, -155], [941, -155], [790, -6]]], OZ);
  add("P", 1104, [[[0, 0], [380, 0], [380, 203], [1104, 203, corner(365, 258)], [1104, 744, corner(365, 258)], [0, 744]], slot(380, 428, 713, 526)],
    { xz: [0, 380, 713, 1104], xk: "scs", sides: "sr", yz: [0, 203, 428, 526, 744], yk: "khch" });
  add("R", 1132, [[[0, 0], [380, 0], [380, 238], [736, 238, corner(144, 125)], [736, 0], [1132, 0], [1119, 90], [1119, 400, corner(176, 200)], [0, 400]],
    box4(0, 330, 1115, 744, [null, corner(200, 100), corner(293, 188), null]), slot(380, 447, 726, 541)],
    { xz: [0, 380, 736, 1132], xk: "scs", sides: "sr", yz: [0, 238, 447, 541, 744], yk: "khch" });
  add("S", 1131, [[
    [0, 253], [445, 253], [445, 173, corner(118, 60)], [677, 173, corner(114, 52)], [677, 281, corner(40, 56)], [12, 281, corner(370, 234)], [12, 757, corner(470, 230)],
    [1103, 757, corner(490, 239)], [1103, 518], [667, 518], [667, 578, corner(110, 58)], [445, 578, corner(108, 40)], [445, 490, corner(40, 50)], [1131, 490, corner(390, 232)],
    [1131, -15, corner(510, 260)], [0, -15, corner(490, 262)],
  ]], { xz: [0, 445, 667, 1131], xk: "scs", share: 1, sides: "rr" });
  add("T", 1022, [[[321, 0], [701, 0], [701, 488], [1022, 488], [1022, 744], [0, 744], [0, 488], [321, 488]]], { xz: [0, 321, 701, 1022], xk: "csc", sides: "rr" });
  add("U", 1154, [[[0, 744], [382, 744], [382, 267, corner(195, 171)], [772, 267, corner(195, 171)], [772, 744], [1154, 744], [1154, -13, corner(560, 400)], [0, -13, corner(560, 400)]]],
    { xz: [0, 382, 772, 1154], xk: "scs" });
  add("V", 1224, [[[354, 0], [0, 744], [431, 744], [636, 285], [830, 744], [1224, 744], [897, 0]]], { xz: [0, 431, 830, 1224], xk: "dcd", sides: "dd" });
  add("W", 1776, [[[260, 0], [0, 744], [436, 744], [561, 305], [678, 744], [1133, 744], [1248, 297], [1366, 744], [1776, 744], [1509, 0], [1000, 0], [889, 413], [775, 0]]],
    { xz: [0, 436, 678, 1133, 1366, 1776], xk: "dcdcd", sides: "dd" });
  add("X", 1243, [[[0, 0], [287, 393], [18, 744], [478, 744], [629, 523], [780, 744], [1212, 744], [959, 392], [1243, 0], [786, 0], [617, 232], [447, 0]]],
    { xz: [0, 478, 780, 1243], xk: "dcd", sides: "dd" });
  add("Y", 1226, [[[425, 0], [805, 0], [805, 259], [1226, 744], [823, 744], [629, 520], [438, 744], [0, 744], [425, 264]]], { xz: [0, 425, 805, 1226], xk: "dsd", sides: "dd" });
  add("Z", 995, [[[992, 744], [992, 565], [549, 254], [995, 254], [995, 0], [0, 0], [0, 181], [431, 503], [3, 503], [3, 744]]], { xz: [0, 995], xk: "d", sides: "rr" });

  // Figures
  add("0", 1170, [box(0, -15, 1170, 759, corner((1170 - flat * 0.5) / 2, 387)), oval(391, 224, 779, 523)],
    { xz: [0, 391, 779, 1170], xk: "scs", share: 1, sides: "rr", yz: [-15, 224, 523, 759], yk: "hch" });
  add("1", 573, [[[0, 399], [0, 583, null, [[106, 586], [233, 669]]], [262, 744], [573, 744], [573, 0], [193, 0], [193, 399]]], { xz: [0, 193, 573], xk: "ks", share: 0, sides: "rs" });
  add("2", 1050, [[[0, 0], [1050, 0], [1050, 281], [720, 281], [720, 208], [324, 208, null, [[340, 240], [470, 270]]], [603, 288], [1041, 288, corner(438, 220)],
    [1041, 759, corner(530, 235)], [10, 759, corner(480, 277)], [10, 477], [391, 477], [391, 561, corner(130, 80)], [644, 561, corner(110, 40)], [644, 483, corner(30)],
    [466, 463, null, [[250, 420], [0, 260]]], [0, 92]]], { xz: [0, 391, 644, 1050], xk: "scs", sides: "rr" });
  add("3", 1125, [
    [[0, 280], [386, 280], [386, 200, corner(160, 80)], [709, 200, corner(130, 40)], [709, 291, corner(40)], [417, 291], [417, 440], [1125, 440, corner(450, 190)], [1125, -15, corner(560, 270)], [0, -15, corner(520, 290)]],
    [[417, 479], [702, 479, corner(40, 30)], [702, 555, corner(150, 40)], [390, 555, corner(150, 65)], [390, 490], [8, 490], [8, 759, corner(500, 250)], [1092, 759, corner(510, 190)], [1092, 420, corner(150, 80)], [417, 420]],
  ], { xz: [0, 417, 709, 1125], xk: "scs", share: 1, sides: "rr" });
  add("4", 1105, [[[514, 749], [941, 749], [941, 348], [1105, 348], [1105, 119], [941, 119], [941, 0], [558, 0], [558, 119], [0, 119], [0, 319]], mark([[558, 546], [321, 348], [558, 348]])],
    { xz: [0, 558, 941, 1105], xk: "csk", sides: "rr" });
  add("5", 1037, [
    [[11, 300], [393, 300], [393, 549], [985, 549], [985, 744], [11, 744]],
    [[0, 244], [389, 244], [389, 192, corner(134, 52)], [645, 192, corner(122, 72)], [645, 336, corner(122, 72)], [389, 336, corner(134, 52)], [389, 280], [11, 280], [11, 440], [393, 440],
      [393, 451, null, [[430, 470], [540, 511]]], [660, 511], [1037, 511, corner(377, 247)], [1037, -15, corner(530, 270)], [0, -15, corner(498, 255)]],
  ], { xz: [0, 389, 645, 1037], xk: "scs", share: 1, sides: "rr" });
  const six = [[[0, -15, corner(520, 375)], [1112, -15, corner(540, 250)], [1112, 483, corner(400, 230)], [700, 483, null, [[560, 483], [430, 450]]], [393, 416],
    [393, 560, corner(180, 140)], [682, 560, corner(110, 49)], [682, 511], [1077, 511], [1077, 759, corner(500, 250)], [0, 759, corner(530, 375)]], oval(411, 187, 720, 307)];
  const sixZ = { xz: [0, 393, 720, 1112], xk: "scs", share: 1, sides: "rr" };
  add("6", 1112, six, sixZ);
  add("9", 1112, six.map((c) => turn(c, 1112, CAP)), { ...sixZ, xz: [0, 392, 719, 1112] });
  add("7", 1009, [[[306, 0], [721, 0], [721, 46, null, [[725, 180], [800, 300]]], [843, 353], [1009, 559], [1009, 744], [0, 744], [0, 396], [351, 396], [351, 523], [680, 523],
    [471, 351, null, [[380, 270], [306, 180]]], [306, 78]]], { xz: [0, 351, 721, 1009], xk: "scd", sides: "rr" });
  add("8", 1103, [box(0, -15, 1103, 430, corner(520, 222)), box(16, 360, 1086, 759, corner(500, 199)), oval(414, 479, 689, 568), oval(395, 190, 709, 293)],
    { xz: [0, 395, 709, 1103], xk: "scs", share: 1, sides: "rr" });

  // Punctuation
  const dot = box(0, 0, 359, 232), dotTop = box(0, X - 232, 359, X);
  const comma = [[0, 0], [0, 232], [359, 232], [359, 46, null, [[359, -10], [316, -95]]], [281, -135], [95, -135, null, [[128, -85], [144, -35]]], [146, 0]];
  const mark359 = { xz: [0, 359], xk: "s", share: 0 };
  add(".", 359, [dot], mark359);
  add(",", 359, [comma], mark359);
  add(":", 359, [dot, dotTop], { ...mark359, lc: true });
  add(";", 359, [comma, dotTop], { ...mark359, lc: true });
  add("!", 360, [[[20, 300], [340, 300], [360, 744], [0, 744]], box(0, 0, 360, 232)], { xz: [0, 360], xk: "s", share: 0 });
  add("?", 980, [
    [[0, 470], [360, 470], [360, 566, corner(120, 50)], [620, 566, corner(100, 46)], [620, 430], [980, 430, corner(250, 150)], [980, 759, corner(460, 240)], [0, 759, corner(460, 270)]],
    box(310, 290, 670, 440), box(310, 0, 670, 232),
  ], { xz: [0, 360, 620, 980], xk: "scs", sides: "rr" });
  const tick = [[20, 460], [300, 460], [320, 744], [0, 744]];
  add("'", 320, [tick], { xz: [0, 320], xk: "s", share: 0, sides: "rr" });
  add('"', 720, [tick, shift(tick, 400)], { xz: [0, 320, 400, 720], xk: "sks", share: 0, sides: "rr" });
  const dash = (w) => add(w === 347 ? "-" : w === 600 ? "–" : "—", w, [box(0, 190, w, 404)], { xz: [0, w], xk: "k", share: 0, sides: "rr", yz: [0, 190, 404], yk: "ch" });
  [347, 600, 1000].forEach(dash);
  const paren = [[0, -120, corner(240, 420)], [330, -120], [330, 30], [260, 30, corner(90, 280)], [260, 714, corner(90, 280)], [330, 714], [330, 864], [0, 864, corner(240, 420)]];
  add("(", 330, [paren], { xz: [0, 260, 330], xk: "sk", share: 0, sides: "rr" });
  add(")", 330, [flip(paren, 330)], { xz: [0, 70, 330], xk: "ks", share: 0, sides: "rr" });
  add("/", 770, [[[0, -60], [330, -60], [770, 804], [440, 804]]], { xz: [0, 770], xk: "k", share: 0, sides: "rr" });
  add("#", 1040, [[[160, 0], [400, 0], [490, 744], [250, 744]], [[580, 0], [820, 0], [910, 744], [670, 744]], box(30, 170, 1000, 350), box(70, 400, 1040, 580)],
    { xz: [0, 400, 580, 1040], xk: "scs", sides: "rr" });
  {
    const w = 1060, lo = -15, hi = 470, h = 150, x0 = 340, x1 = 600, ci = corner(130, 60);
    add("&", w, [
      [[0, lo, corner(400, 230)], [w, lo], [w, 190], [x1, 190], [x1, lo + h, ci], [x0, lo + h, ci], [x0, hi - h, ci], [x1, hi - h, ci], [x1, 250], [760, 250], [w, 480], [w, 560], [700, 560], [700, hi], [0, hi, corner(380, 220)]],
      box(60, 400, 700, 759, corner(320, 170)), oval(300, 530, 460, 640),
    ], { xz: [0, x0, x1, w], xk: "scs", sides: "rr" });
  }
  add("@", 1200, [box(0, -100, 1200, 760, corner(520, 430)), oval(150, 30, 1050, 630), box(300, 140, 800, 500, corner(220, 180)), oval(450, 250, 640, 390), box(700, 140, 880, 520)],
    { xz: [0, 450, 640, 1200], xk: "kck", sides: "rr" });
  return out;
}

// A piecewise-linear refit: zone i spans edges[i]..edges[i+1] and becomes (width * size[kind] + extra[i]) wide.
function refit(edges, kinds, size, extra) {
  const to = [edges[0]];
  [...kinds].forEach((kind, i) => to.push(to[i] + Math.max(8, (edges[i + 1] - edges[i]) * size[kind] + (extra[i] ?? 0))));
  const last = edges.length - 1;
  return (v) => {
    if (v <= edges[0]) return v;
    for (let i = 0; i < last; i++) if (v <= edges[i + 1]) return to[i] + (v - edges[i]) * (to[i + 1] - to[i]) / (edges[i + 1] - edges[i]);
    return v - edges[last] + to[last];
  };
}

function fitted(g, p) {
  const S = p.weight, H = S * p.contrast, X = p.xHeight;
  const share = g.share === "s" ? p.straightShare : g.share, stretch = p.stretch * share;
  const kinds = [...g.xk], widths = kinds.map((_, i) => g.xz[i + 1] - g.xz[i]);
  const takers = kinds.includes("c") ? "c" : "d", room = kinds.reduce((t, k, i) => t + (k === takers ? widths[i] : 0), 0);
  const fx = refit(g.xz, g.xk, { s: S / BS, d: S / BS, c: p.counter / BC, k: 1 }, kinds.map((k, i) => (k === takers ? stretch * widths[i] / room : 0)));
  let fy = (y) => y;
  if (g.yz) {
    const yk = [...g.yk], heights = yk.map((_, i) => g.yz[i + 1] - g.yz[i]);
    const strokes = yk.reduce((t, k, i) => t + (k === "h" ? heights[i] : 0), 0), holes = yk.reduce((t, k, i) => t + (k === "c" ? heights[i] : 0), 0);
    // Strokes thicken into the holes, never past a sliver of them, so the glyph keeps its height.
    const thick = Math.min(strokes * H / BH, strokes + holes * 0.85), spare = strokes - thick;
    fy = refit(g.yz, g.yk, { h: thick / strokes, c: 1, k: 1 }, yk.map((k, i) => (k === "c" ? spare * heights[i] / holes : 0)));
  }
  const fh = g.lc ? (y) => (y <= 0 ? y : y <= BX ? y * X / BX : X + (y - BX) * (CAP - X) / (CAP - BX)) : (y) => y;
  const f = ([x, y]) => [fx(x), fh(fy(y))];
  const k = p.squareness;
  return {
    width: fx(g.w), sides: g.sides, hang: g.hang,
    segments: g.contours.map((c) => outline(orient(c), k).map((s) => (s[0] === "L" ? ["L", f(s[1])] : ["C", f(s[1]), f(s[2]), f(s[3])]))),
  };
}

export function draw(p) {
  const out = {};
  for (const [ch, g] of Object.entries(core(p))) out[ch] = { width: g.width, sides: g.sides, hang: [0, 0], segments: g.contours.map((c) => outline(orient(c), p.squareness)) };
  for (const [ch, g] of Object.entries(sketch(p))) out[ch] = fitted(g, p);
  for (const g of Object.values(out)) {
    const bearing = (side) => p.spacing * (side === "r" ? 0.5 : side === "d" ? -0.4 : 1);
    g.left = bearing(g.sides[0]) - g.hang[0]; g.right = bearing(g.sides[1]) - g.hang[1];
    g.advance = g.left + g.width + g.right;
  }
  return out;
}

// Pen positions for a line of text: each glyph's x offset, with tracking and the pair kerning.
export function layout(text, p, glyphs = draw(p)) {
  let x = 0;
  const placed = [];
  [...text].forEach((ch, i) => {
    if (ch === " ") { x += 300 + p.tracking; return; }
    const g = glyphs[ch];
    if (!g) return;
    placed.push({ ch, x: x + g.left, glyph: g });
    x += g.advance + p.tracking + (p[`kern_${ch}${text[i + 1]}`] ?? 0);
  });
  return { placed, width: x - p.tracking };
}

// SVG path data, y flipped so the baseline sits at `baseline` in the drawing.
export function svgPath(segments, dx = 0, baseline = 0) {
  const pt = ([x, y]) => `${(x + dx).toFixed(1)} ${(baseline - y).toFixed(1)}`;
  return segments.map((contour) => {
    const last = contour[contour.length - 1];
    return `M${pt(last[0] === "L" ? last[1] : last[3])}` + contour.map((s) => (s[0] === "L" ? `L${pt(s[1])}` : `C${pt(s[1])} ${pt(s[2])} ${pt(s[3])}`)).join("") + "Z";
  }).join("");
}
