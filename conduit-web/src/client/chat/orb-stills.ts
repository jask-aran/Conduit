import { finalizeFrame, makeProj, radiusScale, type Dot, type ModeFrame } from "thinking-orbs/engine";

/*
 * A settled turn's mark: the orb at rest. The searching state's lat/lon
 * lattice, without its scan, projected by the engine's camera and shaded in
 * its depth language -- near dots larger and brighter, far ones smaller and
 * dimmer -- so it is the same object as the live orb, stopped. Every
 * candidate considered for it is on the contact sheet in docs/orb-stills.
 */
const LAT_RINGS = 6;
const LON_DENSITY = 17;

export const ORB_AT_REST: ModeFrame = (size) => {
  const c = size / 2;
  const scale = radiusScale(size, 0.6);
  const project = makeProj(0.55, 0.42, c, c, c * 0.82);
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
