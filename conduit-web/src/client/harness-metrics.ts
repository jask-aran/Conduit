type HarnessMetric = Record<string, unknown> & { stage: string };

// Vite replaces this value at build time. The normal production build does
// not include a live harness recorder; the deterministic browser runner sets
// VITE_CONDUIT_HARNESS=1 for its managed dev server.
const harnessBuildEnabled = import.meta.env.VITE_CONDUIT_HARNESS === "1";

export type HarnessRecorder = {
  record?: (metric: HarnessMetric) => void;
  enabled?: boolean;
};

/**
 * Return the opt-in recorder without touching a timer or allocating a metric.
 * Production pages do not install `__conduitHarness`, so callers can guard
 * all measurement work with this one check.
 */
export function getHarnessRecorder(): HarnessRecorder | null {
  if (!harnessBuildEnabled) return null;
  if (typeof window === "undefined") return null;
  const harness = (window as Window & { __conduitHarness?: HarnessRecorder }).__conduitHarness;
  if (harness?.enabled === false || typeof harness?.record !== "function") return null;
  return harness;
}

export function recordHarnessMetric(recorder: HarnessRecorder | null, metric: HarnessMetric) {
  if (!recorder) return;
  recorder.record?.({ ...metric, at: performance.now() });
}
