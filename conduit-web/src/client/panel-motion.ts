export const PANEL_GEOMETRY_MOTION_EVENT = "conduit:panel-geometry-motion";

export type PanelGeometryMotionSource = "sidebar" | "workspace";

export type PanelGeometryMotionDetail = {
  phase: "begin" | "change" | "end";
  id: number;
  source: PanelGeometryMotionSource;
  size: number;
  targetSize?: number;
  duration?: number;
  easing?: string;
};

export function dispatchPanelGeometryMotion(detail: PanelGeometryMotionDetail) {
  window.dispatchEvent(new CustomEvent<PanelGeometryMotionDetail>(PANEL_GEOMETRY_MOTION_EVENT, { detail }));
}
