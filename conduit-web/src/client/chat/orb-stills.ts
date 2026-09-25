import { finalizeFrame, makeProj, radiusScale, type Dot, type ModeFrame } from "thinking-orbs/engine";

/*
 * A settled turn's mark: the orb at rest, with how the turn ended pressed into
 * the face toward the viewer -- a tick for Done, the stop button's square for
 * Interrupted, a cross for Failed.
 *
 * Drawn in the engine's own terms, so it is the same object as the live orb
 * rather than an icon beside it: the globe is the searching state's lat/lon
 * lattice, projected by the engine's camera and shaded in its depth language
 * -- near dots larger and brighter -- then dimmed so the glyph leads. The
 * glyph is laid on the sphere in the same dots, raised just off its surface
 * and shaded by its own depth, so its strokes bend with the curve.
 */
type Stroke = [number, number][];

const GLYPHS: Record<"done" | "interrupted" | "failed", Stroke[]> = {
  done: [[[-0.5, 0.02], [-0.16, -0.34], [0.52, 0.36]]],
  interrupted: [[[-0.4, 0.4], [0.4, 0.4], [0.4, -0.4], [-0.4, -0.4], [-0.4, 0.4]]],
  failed: [[[-0.42, 0.42], [0.42, -0.42]], [[0.42, 0.42], [-0.42, -0.42]]],
};

const LAT_RINGS = 6;
const LON_DENSITY = 17;
/* How far apart the glyph's dots are, in sphere radii, and how far above the
   surface they sit. */
const STEP = 0.14;
const RAISED = 1.06;

function pressed(strokes: Stroke[]): ModeFrame {
  return (size) => {
    const c = size / 2;
    const radius = c * 0.82;
    const scale = radiusScale(size, 0.6);
    const project = makeProj(0.55, 0.42, c, c, radius);
    const dots: Dot[] = [];
    for (let ring = 0; ring <= LAT_RINGS; ring++) {
      const lat = -Math.PI / 2 + (ring / LAT_RINGS) * Math.PI;
      const count = Math.max(1, Math.round(Math.abs(Math.cos(lat)) * LON_DENSITY));
      for (let index = 0; index < count; index++) {
        const lon = (index / count) * Math.PI * 2;
        const [x, y, z] = project(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
        const depth = (z + 1) / 2;
        dots.push({ x, y, z, r: (1.05 + 2.975 * depth) * scale, white: 0.62 - 0.54 * depth, a: 0.28 + 0.3 * depth });
      }
    }
    // The glyph is placed in the camera's frame, on the hemisphere facing it.
    for (const stroke of strokes) {
      for (let segment = 0; segment < stroke.length - 1; segment++) {
        const [from, to] = [stroke[segment]!, stroke[segment + 1]!];
        const steps = Math.max(1, Math.round(Math.hypot(to[0] - from[0], to[1] - from[1]) / STEP));
        for (let step = segment ? 1 : 0; step <= steps; step++) {
          const u = from[0] + (to[0] - from[0]) * (step / steps);
          const v = from[1] + (to[1] - from[1]) * (step / steps);
          const w = Math.sqrt(Math.max(0, 1 - u * u - v * v)) * RAISED;
          const depth = (w + 1) / 2;
          dots.push({ x: c + u * radius * RAISED, y: c - v * radius * RAISED, z: 2 + w, r: (1.8 + 1.5 * depth) * scale, white: 0.3 - 0.3 * depth });
        }
      }
    }
    return finalizeFrame(dots, [], 0.3);
  };
}

export const ORB_STILLS = {
  done: pressed(GLYPHS.done),
  interrupted: pressed(GLYPHS.interrupted),
  failed: pressed(GLYPHS.failed),
};
