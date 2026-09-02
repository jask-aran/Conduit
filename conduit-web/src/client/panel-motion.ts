export const PANEL_GEOMETRY_MOTION_EVENT = "conduit:panel-geometry-motion";

/** Authored open/close duration. Frame rate stays at the display refresh. */
export const PANEL_MOTION_DURATION_MS = 160;

export type PanelGeometryMotionSource = "sidebar" | "workspace";

export type PanelGeometryMotionDetail = {
  phase: "begin" | "change" | "end";
  id: number;
  source: PanelGeometryMotionSource;
  size: number;
  /** When set, transcript uses inverse-translate mode around one layout commit. */
  targetSize?: number;
  duration?: number;
  easing?: string;
};

export function dispatchPanelGeometryMotion(detail: PanelGeometryMotionDetail) {
  window.dispatchEvent(new CustomEvent<PanelGeometryMotionDetail>(PANEL_GEOMETRY_MOTION_EVENT, { detail }));
}
