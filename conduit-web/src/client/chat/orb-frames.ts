import { finalizeFrame, makeProj, radiusScale, type Dot, type ModeFrame } from "thinking-orbs/engine";

/*
 * The orb's frames drawn for Conduit rather than taken from the library,
 * built from the engine's own pieces -- its camera, its dot scaling and its
 * z-sort -- in its depth language: near dots larger and brighter, far ones
 * smaller and dimmer. So they are the same object as the library's, moving
 * differently. `t` is seconds. The catalogue in docs/orb-stills shows each
 * beside every other frame the orb can draw, and which state uses each.
 */
const TAU = Math.PI * 2;
const SPIN = 0.5;
const LAT_RINGS = 6;
const LON_DENSITY = 17;

/* The searching state's lat/lon lattice, without its scan, turned to `yaw`. */
function sphere(size: number, yaw: number) {
  const c = size / 2;
  const scale = radiusScale(size, 0.6);
  const project = makeProj(yaw, 0.42, c, c, c * 0.82);
  const dots: Dot[] = [];
  for (let ring = 0; ring <= LAT_RINGS; ring++) {
    const lat = -Math.PI / 2 + (ring / LAT_RINGS) * Math.PI;
    const count = Math.max(1, Math.round(Math.abs(Math.cos(lat)) * LON_DENSITY));
    for (let index = 0; index < count; index++) {
      const lon = (index / count) * TAU;
      const [x, y, z] = project(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      const depth = (z + 1) / 2;
      dots.push({ x, y, z, r: (1.05 + 2.975 * depth) * scale, white: 0.62 - 0.54 * depth });
    }
  }
  return finalizeFrame(dots, [], 0.3);
}

/* A finished turn's mark: the sphere turning slowly, a full turn in about
   twelve seconds. */
export const PLAIN_SPHERE: ModeFrame = (size, t) => sphere(size, 0.55 + t * SPIN);

/* How far a sphere has turned by `t`, told as a loop of segments --
   [seconds, radians, easing]; a segment without radians is a hold. */
type Ease = (x: number) => number;
type Segment = [seconds: number, radians?: number, ease?: Ease];
const smooth: Ease = (x) => x * x * (3 - 2 * x);
const linear: Ease = (x) => x;
const easeIn: Ease = (x) => x ** 3;
const easeOut: Ease = (x) => 1 - (1 - x) ** 3;
/* Past the mark and back: `c` is how far past. */
const back = (c: number): Ease => (x) => 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
const backOut = back(1.7);
/* Past the mark and back, and past again, dying away. */
const spring: Ease = (x) => 1 - Math.exp(-7 * x) * Math.cos(14 * x);

function turning(segments: Segment[]) {
  const period = segments.reduce((sum, [seconds]) => sum + seconds, 0);
  const lap = segments.reduce((sum, [, radians = 0]) => sum + radians, 0);
  return (t: number) => {
    const loops = Math.floor(t / period);
    let rest = t - loops * period;
    let angle = loops * lap;
    for (const [seconds, radians = 0, ease = smooth] of segments) {
      if (rest < seconds) return angle + radians * ease(rest / seconds);
      angle += radians;
      rest -= seconds;
    }
    return angle;
  };
}

/* The sputter: brief stretches of the plain sphere's turn, each snagging to
   a stop, and between them jolts past the mark and back, stutters, kicks
   backwards and jolts that ring -- about fourteen seconds before it repeats.
   Every change of pace keeps its speed where it meets a cruise: a cubic ease
   out starts at three times its average speed, so one out of a cruise covers
   a third of what the cruise would have in that time, and an ease back in
   ends at cruising speed the same way. */
const cruise = (seconds: number): Segment => [seconds, SPIN * seconds, linear];
const slow = (seconds: number): Segment => [seconds, (SPIN * seconds) / 3, easeOut];
const recover = (seconds: number): Segment => [seconds, (SPIN * seconds) / 3, easeIn];
const sputter = turning([
  cruise(1.2), slow(0.3), [0.4],
  [0.14, 0.3, back(2.2)], [0.35],
  [0.08, 0.06, backOut], [0.1], [0.08, 0.06, backOut], [0.1], [0.1, 0.1, backOut], [0.5],
  [0.18, -0.1], [0.3],
  [0.22, 0.45, spring], [0.3],
  recover(0.6), cruise(0.8), slow(0.3), [0.5],
  [0.12, 0.2, back(2.2)], [0.2], [0.16, 0.34, back(2.2)], [0.45],
  ...Array.from({ length: 5 }, (): Segment[] => [[0.06, 0.04, backOut], [0.08]]).flat(), [0.4],
  [0.14, -0.06], [0.2], [0.14, 0.28, back(2.5)], [0.6],
  recover(0.5), cruise(0.6), slow(0.25), [0.35],
  [0.2, 0.36, spring], [0.25],
  [0.08, 0.06, backOut], [0.1], [0.08, 0.06, backOut], [0.7],
  recover(0.8),
]);

/* A turn that did not finish, stopped or failed: the sphere sputtering. */
export const SPUTTERING_SPHERE: ModeFrame = (size, t) => sphere(size, 0.55 + sputter(t));

/* Points on a circle of radius `r` in the plane through the centre with
   normal `n`, by angle. */
function circle(n: [number, number, number]) {
  const length = Math.hypot(...n);
  const [nx, ny, nz] = n.map((value) => value / length) as [number, number, number];
  const u0: [number, number, number] = Math.abs(ny) < 0.9 ? [-nz, 0, nx] : [1, 0, 0];
  const ul = Math.hypot(...u0);
  const u = u0.map((value) => value / ul) as [number, number, number];
  const v: [number, number, number] = [ny * u[2] - nz * u[1], nz * u[0] - nx * u[2], nx * u[1] - ny * u[0]];
  return (angle: number, r: number): [number, number, number] =>
    [0, 1, 2].map((i) => (u[i]! * Math.cos(angle) + v[i]! * Math.sin(angle)) * r) as [number, number, number];
}

/* Three orbits at different tilts, each with its particle running on and
   the stretch of orbit it has just covered drawn with it, the rest faint. */
const ORBITS: { normal: [number, number, number]; radius: number; reach: number; start: number; speed: number }[] = [
  { normal: [0, 1, 0], radius: 0.98, reach: 0.72, start: 0.4, speed: 1.4 },
  { normal: [0.9, 0.35, 0.2], radius: 0.9, reach: 0.45, start: 2.2, speed: -1.1 },
  { normal: [-0.35, 0.45, 0.85], radius: 0.82, reach: 0.6, start: 4.1, speed: 1.8 },
];
const ORBIT_DOTS = 24;

/* Editing: the orbits trailed. */
export const ORBITS_TRAILED: ModeFrame = (size, t) => {
  const c = size / 2;
  const radius = c * 0.82;
  const scale = radiusScale(size, 0.6);
  const project = makeProj(0.5 + t * 0.12, 0.42, c, c, 1);
  const dots: Dot[] = [];
  for (const orbit of ORBITS) {
    const at = circle(orbit.normal);
    const from = orbit.start + t * orbit.speed;
    for (let index = 0; index < ORBIT_DOTS; index++) {
      const f = index / ORBIT_DOTS;
      const [x, y, z] = project(...at(from + f * TAU, radius * orbit.radius));
      const depth = (z / radius + 1) / 2;
      dots.push(f <= orbit.reach
        ? { x, y, z, r: (0.8 + 2.4 * depth) * scale, white: 0.62 - 0.54 * depth }
        : { x, y, z, r: (0.6 + 1.2 * depth) * scale, white: 0.62 - 0.54 * depth, a: 0.22 });
    }
    const [x, y, z] = project(...at(from + orbit.reach * TAU, radius * orbit.radius));
    const depth = (z / radius + 1) / 2;
    dots.push({ x, y, z: z + 0.01, r: (2.2 + 3 * depth) * scale, white: 0.28 - 0.22 * depth });
  }
  return finalizeFrame(dots, [], 0.3);
};
