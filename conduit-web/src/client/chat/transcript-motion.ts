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
  // Edge motions (resize + open/close shell easing) pin a preview width so the
  // heavy transcript does not take natural flex width on every frame.
  const edgeStarts = new Map<PanelGeometryMotionSource, { size: number; width: number }>();

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
      if (activeIds.size || edgeStarts.size || !motionShell.style.width) return;
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
    edgeStarts.clear();
    setTransform(0);
    if (motionShell.style.width) {
      motionShell.style.width = `${transcript.clientWidth}px`;
      releasePreviewWidth();
    }
    delete transcript.dataset.panelMotion;
  };

  const onMotion = (event: Event) => {
    const detail = (event as CustomEvent<PanelGeometryMotionDetail>).detail;
    if (detail.phase === "begin") {
      cancelRelease();
      activeIds.set(detail.source, detail.id);
      // Edge path (resize + open/close): pin width, follow shell on change.
      // targetSize inverse-translate is only for atomic shell commits — it
      // jumps then slides if the shell is already CSS-easing.
      if (detail.targetSize != null) {
        transcript.dataset.panelMotion = "translate";
        const current = transformX(motionShell);
        const delta = detail.targetSize - detail.size;
        const naturalShift = detail.source === "sidebar" ? delta / 2 : -delta / 2;
        motion?.cancel();
        motionShell.style.removeProperty("transform");
        motion = motionShell.animate([
          { transform: `translateX(${current - naturalShift}px)` },
          { transform: "translateX(0px)" },
        ], {
          duration: detail.duration || 0,
          easing: detail.easing || "linear",
          fill: "forwards",
        });
        return;
      }
      const width = transcript.clientWidth;
      motionShell.style.width = `${width}px`;
      edgeStarts.set(detail.source, {
        size: detail.size,
        width,
      });
      transcript.dataset.panelMotion = "edge";
      setTransform(0);
      return;
    }
    if (detail.id !== activeIds.get(detail.source)) return;
    if (detail.phase === "change") {
      const start = edgeStarts.get(detail.source);
      if (!start) return;
      const delta = detail.size - start.size;
      motionShell.style.width = `${Math.max(0, start.width - delta)}px`;
      return;
    }
    const wasEdge = edgeStarts.has(detail.source);
    activeIds.delete(detail.source);
    edgeStarts.delete(detail.source);
    if (wasEdge) {
      setTransform(0);
      motionShell.style.width = `${transcript.clientWidth}px`;
    }
    if (!edgeStarts.size && motionShell.style.width) releasePreviewWidth();
    if (!activeIds.size) {
      delete transcript.dataset.panelMotion;
    }
  };

  const onPageLeave = () => reset();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") reset();
  };
  const orphanObserver = new ResizeObserver(() => {
    if (!activeIds.size && !edgeStarts.size && motionShell.style.width) releasePreviewWidth();
  });
  window.addEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
  window.addEventListener("blur", onPageLeave);
  document.addEventListener("visibilitychange", onVisibility);
  orphanObserver.observe(transcript);
  return {
    reset,
    destroy: () => {
      window.removeEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
      window.removeEventListener("blur", onPageLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      orphanObserver.disconnect();
      cancelRelease();
      activeIds.clear();
      edgeStarts.clear();
      setTransform(0);
      motionShell.style.removeProperty("width");
      delete transcript.dataset.panelMotion;
    },
  };
}
