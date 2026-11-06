/*
 * Animation speed (Settings → Appearance), per device: every motion drawn at its normal length or slowed down, to
 * look at one closely. It multiplies the duration tokens (foundations.css --duration-*), which the stylesheet's
 * transitions and the code's animations both read (motion.ts duration()), so whatever waits for a motion to end
 * waits as long as it now takes. A motion with a length of its own, not a token, keeps it.
 */
const KEY = "conduit:motion-scale";
const TOKENS = ["quick", "gentle", "fold", "travel", "follow", "flash", "spin", "pulse", "breathe"].map((name) => `--duration-${name}`);

export const MOTION_SCALE_OPTIONS = [1, 2, 4, 10] as const;
export type MotionScale = typeof MOTION_SCALE_OPTIONS[number];

export function motionScale(): MotionScale {
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (MOTION_SCALE_OPTIONS.some((option) => option === saved)) return saved as MotionScale;
  } catch { /* unavailable */ }
  return 1;
}

const ms = (value: string) => {
  const text = value.trim();
  const number = parseFloat(text);
  return Number.isFinite(number) ? (text.endsWith("ms") ? number : number * 1000) : null;
};

export function applyMotionScale(scale = motionScale()) {
  const root = document.documentElement;
  for (const token of TOKENS) root.style.removeProperty(token);
  if (scale === 1) return;
  // The stylesheet's own lengths, read with nothing set over them.
  const styles = getComputedStyle(root);
  for (const token of TOKENS) {
    const base = ms(styles.getPropertyValue(token));
    if (base !== null) root.style.setProperty(token, `${Math.round(base * scale)}ms`);
  }
}

export function saveMotionScale(scale: MotionScale): MotionScale {
  try { localStorage.setItem(KEY, String(scale)); } catch { /* this session only */ }
  applyMotionScale(scale);
  return scale;
}
