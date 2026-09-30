export const PANEL_GEOMETRY_MOTION_EVENT = "conduit:panel-geometry-motion";

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
  /**
   * Each pane's width as the mover has just set it (a pane-edge drag), so a
   * transcript beside another pane takes its share without measuring -- which,
   * straight after the weights are written, would force a layout per pane.
   */
  panes?: { element: HTMLElement; width: number }[];
};

export function dispatchPanelGeometryMotion(detail: PanelGeometryMotionDetail) {
  window.dispatchEvent(new CustomEvent<PanelGeometryMotionDetail>(PANEL_GEOMETRY_MOTION_EVENT, { detail }));
}
