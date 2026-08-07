import {
  PANEL_GEOMETRY_MOTION_EVENT,
  type PanelGeometryMotionDetail,
  type PanelGeometryMotionSource,
} from "../panel-motion";

function transformX(element: HTMLElement) {
  const transform = getComputedStyle(element).transform;
  if (transform === "none") return 0;
  return new DOMMatrixReadOnly(transform).m41;
}

export function mountTranscriptPanelMotion(
  transcript: HTMLElement,
  motionShell: HTMLElement,
) {
  let motion: Animation | null = null;
  const activeIds = new Map<PanelGeometryMotionSource, number>();
  const resizeStarts = new Map<PanelGeometryMotionSource, { size: number; width: number }>();

  const setTransform = (next: number) => {
    motion?.cancel();
    motion = null;
    motionShell.style.transform = next ? `translateX(${next}px)` : "";
  };

  const animateTransform = (current: number, next: number, duration: number, easing: string) => {
    motion?.cancel();
    motionShell.style.removeProperty("transform");
    const nextMotion = motionShell.animate([
      { transform: `translateX(${current}px)` },
      { transform: `translateX(${next}px)` },
    ], {
      duration,
      easing,
      // Retain the zero-transform effect until the next motion. Releasing it
      // at finish makes Chromium repaint the full KaTeX transcript.
      fill: "forwards",
    });
    motion = nextMotion;
  };

  const onMotion = (event: Event) => {
    const detail = (event as CustomEvent<PanelGeometryMotionDetail>).detail;
    if (detail.phase === "begin") {
      const current = transformX(motionShell);
      activeIds.set(detail.source, detail.id);
      if (detail.targetSize == null) {
        resizeStarts.set(detail.source, {
          size: detail.size,
          width: motionShell.getBoundingClientRect().width,
        });
        transcript.dataset.panelMotion = "resize";
        setTransform(0);
        return;
      }
      transcript.dataset.panelMotion = "translate";
      const delta = detail.targetSize - detail.size;
      const naturalShift = detail.source === "sidebar" ? delta / 2 : -delta / 2;
      animateTransform(current - naturalShift, 0, detail.duration || 0, detail.easing || "linear");
      return;
    }
    if (detail.id !== activeIds.get(detail.source)) return;
    if (detail.phase === "change") {
      const start = resizeStarts.get(detail.source);
      if (!start) return;
      const delta = detail.size - start.size;
      motionShell.style.width = `${Math.max(0, start.width - delta)}px`;
      return;
    }
    const wasResize = resizeStarts.has(detail.source);
    activeIds.delete(detail.source);
    resizeStarts.delete(detail.source);
    if (!activeIds.size) {
      if (wasResize) {
        setTransform(0);
        motionShell.style.removeProperty("width");
      }
      delete transcript.dataset.panelMotion;
    }
  };

  window.addEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
  return () => {
    window.removeEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
    activeIds.clear();
    resizeStarts.clear();
    setTransform(0);
    motionShell.style.removeProperty("width");
    delete transcript.dataset.panelMotion;
  };
}
