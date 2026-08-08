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
  let releaseFrame: number | null = null;
  const activeIds = new Map<PanelGeometryMotionSource, number>();
  const resizeStarts = new Map<PanelGeometryMotionSource, { size: number; width: number }>();

  const cancelRelease = () => {
    if (releaseFrame != null) cancelAnimationFrame(releaseFrame);
    releaseFrame = null;
  };

  const setTransform = (next: number) => {
    motion?.cancel();
    motion = null;
    motionShell.style.transform = next ? `translateX(${next}px)` : "";
  };

  const releasePreviewWidth = () => {
    cancelRelease();
    releaseFrame = requestAnimationFrame(() => {
      releaseFrame = null;
      if (activeIds.size || resizeStarts.size || !motionShell.style.width) return;
      const parentWidth = transcript.clientWidth;
      const previewWidth = motionShell.getBoundingClientRect().width;
      if (Math.abs(parentWidth - previewWidth) > 1) {
        motionShell.style.width = `${parentWidth}px`;
        releasePreviewWidth();
        return;
      }
      motionShell.style.removeProperty("width");
    });
  };

  const reset = () => {
    activeIds.clear();
    resizeStarts.clear();
    setTransform(0);
    if (motionShell.style.width) {
      motionShell.style.width = `${transcript.clientWidth}px`;
      releasePreviewWidth();
    }
    delete transcript.dataset.panelMotion;
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
      cancelRelease();
      const current = transformX(motionShell);
      activeIds.set(detail.source, detail.id);
      if (detail.targetSize == null) {
        const width = transcript.clientWidth;
        motionShell.style.width = `${width}px`;
        resizeStarts.set(detail.source, {
          size: detail.size,
          width,
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
    if (wasResize) {
      setTransform(0);
      motionShell.style.width = `${transcript.clientWidth}px`;
    }
    if (!resizeStarts.size && motionShell.style.width) releasePreviewWidth();
    if (!activeIds.size) {
      delete transcript.dataset.panelMotion;
    }
  };

  const onPageLeave = () => reset();
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") reset();
  };
  const orphanObserver = new ResizeObserver(() => {
    if (!activeIds.size && !resizeStarts.size && motionShell.style.width) releasePreviewWidth();
  });
  window.addEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
  window.addEventListener("blur", onPageLeave);
  document.addEventListener("visibilitychange", onVisibilityChange);
  orphanObserver.observe(transcript);
  return {
    reset,
    destroy: () => {
      window.removeEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
      window.removeEventListener("blur", onPageLeave);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      orphanObserver.disconnect();
      cancelRelease();
      activeIds.clear();
      resizeStarts.clear();
      setTransform(0);
      motionShell.style.removeProperty("width");
      delete transcript.dataset.panelMotion;
    },
  };
}
