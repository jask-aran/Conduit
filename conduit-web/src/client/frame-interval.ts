/**
 * How long this browser actually takes to draw a frame.
 *
 * The server paces paint so a reader is not sent frames faster than they can
 * be shown, and until now it guessed at the rate: a constant chosen for 60Hz,
 * which is half of what a 144Hz panel draws and twice what some phones do. The
 * browser is the only party that knows, so it measures itself once and tells
 * the server on connect.
 *
 * `requestAnimationFrame` is driven by the compositor, so the gap between two
 * callbacks is the real refresh interval. The median of a short run is taken
 * rather than the mean, because the first frames after a connect are the ones
 * most likely to be late.
 */
const SAMPLES = 8;

/** 60Hz, used when nothing can be measured. The server clamps it anyway. */
export const ASSUMED_FRAME_MS = 16;

let measured: Promise<number> | null = null;

export function frameIntervalMs(): Promise<number> {
  // A hidden tab's frames are throttled to something like once a second, which
  // is not this display's rate and must not be remembered as if it were. The
  // answer is not cached, so the next connect measures again.
  if (typeof document !== "undefined" && document.hidden) return Promise.resolve(ASSUMED_FRAME_MS);
  if (typeof requestAnimationFrame !== "function") return Promise.resolve(ASSUMED_FRAME_MS);
  measured ||= new Promise<number>((resolve) => {
    const gaps: number[] = [];
    let previous = 0;
    const tick = (now: number) => {
      if (previous) gaps.push(now - previous);
      previous = now;
      if (gaps.length < SAMPLES) { requestAnimationFrame(tick); return; }
      const sorted = [...gaps].sort((a, b) => a - b);
      resolve(sorted[Math.floor(sorted.length / 2)] || ASSUMED_FRAME_MS);
    };
    requestAnimationFrame(tick);
  });
  return measured;
}
