export const PANEL_GEOMETRY_MOTION_EVENT = "conduit:panel-geometry-motion";

/** Authored open/close duration. Frame rate stays at the display refresh. */
export const PANEL_MOTION_DURATION_MS = 160;

export type PanelGeometryMotionSource = "sidebar" | "workspace";

export type PanelGeometryMotionDetail = {
  phase: "begin" | "change" | "end";
  id: number;
  source: PanelGeometryMotionSource;
  size: number;
  /** When set, transcript uses inverse-translate mode. Omit for edge/resize preview. */
  targetSize?: number;
  duration?: number;
  easing?: string;
};

export function dispatchPanelGeometryMotion(detail: PanelGeometryMotionDetail) {
  window.dispatchEvent(new CustomEvent<PanelGeometryMotionDetail>(PANEL_GEOMETRY_MOTION_EVENT, { detail }));
}

/** Approximate CSS `ease` (cubic-bezier(0.25, 0.1, 0.25, 1)) with a smoothstep-like curve. */
export function panelMotionEase(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

export type PanelEdgeAnimation = {
  cancel: () => void;
};

/**
 * Animate a scalar edge on animation frames at the display refresh rate.
 * Used for sidebar/workspace open-close so the real flex shell moves continuously.
 */
export function animatePanelEdge(options: {
  from: number;
  to: number;
  durationMs?: number;
  onUpdate: (value: number, progress: number) => void;
  onComplete?: () => void;
}): PanelEdgeAnimation {
  const durationMs = options.durationMs ?? PANEL_MOTION_DURATION_MS;
  const { from, to, onUpdate, onComplete } = options;
  let frame = 0;
  let cancelled = false;
  // First paint is the start edge so open/close is never a single end-state frame.
  onUpdate(from, 0);
  const startedAt = performance.now();

  const tick = (now: number) => {
    if (cancelled) return;
    const progress = durationMs <= 0 ? 1 : Math.min(1, (now - startedAt) / durationMs);
    const value = from + (to - from) * panelMotionEase(progress);
    onUpdate(value, progress);
    if (progress < 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    frame = 0;
    onComplete?.();
  };

  frame = requestAnimationFrame(tick);

  return {
    cancel: () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    },
  };
}
