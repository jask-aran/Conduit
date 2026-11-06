import { scaleMotion } from "@/components/ui/motion";

/*
 * Animation speed (Settings → Appearance), per device: every motion drawn at its normal length or slowed down, to
 * look at one closely. The library scales the duration tokens (motion.ts scaleMotion); this is the device's choice.
 */
const KEY = "conduit:motion-scale";

export const MOTION_SCALE_OPTIONS = [1, 2, 4, 10] as const;
export type MotionScale = typeof MOTION_SCALE_OPTIONS[number];

export function motionScale(): MotionScale {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (MOTION_SCALE_OPTIONS.some((option) => option === saved)) return saved as MotionScale;
  } catch { /* unavailable */ }
  return 1;
}

export function applyMotionScale(scale = motionScale()) {
  scaleMotion(scale);
}

export function saveMotionScale(scale: MotionScale): MotionScale {
  try { localStorage.setItem(KEY, String(scale)); } catch { /* this session only */ }
  applyMotionScale(scale);
  return scale;
}
