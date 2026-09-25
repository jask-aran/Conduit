import { finalizeFrame, makeProj, radiusScale, type Dot, type ModeFrame } from "thinking-orbs/engine";

/*
 * A settled turn's mark: the plain sphere. The searching state's lat/lon
 * lattice, without its scan, projected by the engine's camera and shaded in
 * its depth language -- near dots larger and brighter, far ones smaller and
 * dimmer -- so it is the same object as the live orb, calmed. It turns
 * slowly, a full turn in about twelve seconds, `t` being seconds. The
 * catalogue in docs/orb-stills shows it beside every other frame the orb can
 * draw, and which state uses each.
 */
const LAT_RINGS = 6;
const LON_DENSITY = 17;
const SPIN = 0.5;

export const PLAIN_SPHERE: ModeFrame = (size, t) => {
  const c = size / 2;
  const scale = radiusScale(size, 0.6);
  const project = makeProj(0.55 + t * SPIN, 0.42, c, c, c * 0.82);
  const dots: Dot[] = [];
  for (let ring = 0; ring <= LAT_RINGS; ring++) {
    const lat = -Math.PI / 2 + (ring / LAT_RINGS) * Math.PI;
    const count = Math.max(1, Math.round(Math.abs(Math.cos(lat)) * LON_DENSITY));
    for (let index = 0; index < count; index++) {
      const lon = (index / count) * Math.PI * 2;
      const [x, y, z] = project(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      const depth = (z + 1) / 2;
      dots.push({ x, y, z, r: (1.05 + 2.975 * depth) * scale, white: 0.62 - 0.54 * depth });
    }
  }
  return finalizeFrame(dots, [], 0.3);
};
