// @ts-nocheck -- vendored as published (see LICENSE and COMMIT beside this file); checked upstream under its own compiler options
export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number) =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export const randInt = (lo: number, hi: number) =>
  Math.floor(rand(lo, hi + 1));

export const ease = (t: number) => t * t * (3 - 2 * t);

export const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

export function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Shortest signed angle from a to b, in (-PI, PI]. */
export function angleDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Cheap integer hash → [0, 1). Deterministic, so textures stay put. */
export function hash3(x: number, y: number, z: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth 1D value noise in [-1, 1]. */
export function noise1(x: number, seed = 0) {
  const i = Math.floor(x);
  const f = x - i;
  const a = hash3(i, seed, 91) * 2 - 1;
  const b = hash3(i + 1, seed, 91) * 2 - 1;
  return a + (b - a) * f * f * (3 - 2 * f);
}

/** Parameter of the point on segment a→b closest to p, in [0, 1]. */
export function closestT(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const sx = bx - ax;
  const sy = by - ay;
  const l2 = sx * sx + sy * sy;
  if (l2 < 1e-9) return 0;
  return clamp(((px - ax) * sx + (py - ay) * sy) / l2, 0, 1);
}

/** Where segments p0→p1 and q0→q1 cross: the parameter along q, or -1. */
export function crossAlong(
  p0x: number, p0y: number, p1x: number, p1y: number,
  q0x: number, q0y: number, q1x: number, q1y: number,
) {
  const rx = p1x - p0x;
  const ry = p1y - p0y;
  const sx = q1x - q0x;
  const sy = q1y - q0y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return -1;
  const qpx = q0x - p0x;
  const qpy = q0y - p0y;
  const t = (qpx * sy - qpy * sx) / den;
  const u = (qpx * ry - qpy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? u : -1;
}

/** A point, written into by the geometry helpers so hot loops don't allocate. */
export interface Vec {
  x: number;
  y: number;
}
