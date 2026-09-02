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
  const edgeStarts = new Map<PanelGeometryMotionSource, { size: number; width: number; shift: number }>();
  let transformSource: PanelGeometryMotionSource | null = null;

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
    transformSource = null;
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
        edgeStarts.delete(detail.source);
        if (!edgeStarts.size) motionShell.style.removeProperty("width");
        transformSource = detail.source;
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
      transformSource = null;
      const width = transcript.clientWidth;
      motionShell.style.width = `${width}px`;
      edgeStarts.set(detail.source, {
        size: detail.size,
        width,
        shift: 0,
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
      if (detail.source !== "workspace") {
        // The sidebar eases over a fixed distance, so it keeps taking real
        // width: the transcript is meant to fill the space as the rail
        // collapses, and freezing it leaves the thread visually static for the
        // whole animation.
        motionShell.style.width = `${Math.max(0, start.width - delta)}px`;
        return;
      }
      // A pointer drag is unbounded and commits a new width every frame. Every
      // one of those re-laid out the whole transcript, and a long answer is
      // many independent layout roots -- each Incremark message root, each
      // scrolling KaTeX block, each code card. Measured on a 143Hz display
      // against a formula-heavy answer that was 20.8ms a frame, every frame
      // over budget. The shell keeps its width and moves on the compositor
      // instead; the real width is committed once, on release.
      start.shift = -delta / 2;
      let shift = 0;
      for (const entry of edgeStarts.values()) shift += entry.shift;
      setTransform(shift);
      return;
    }
    const wasEdge = edgeStarts.has(detail.source);
    const ownsTransform = transformSource === detail.source;
    activeIds.delete(detail.source);
    edgeStarts.delete(detail.source);
    if (wasEdge) {
      if (transformSource == null) setTransform(0);
      motionShell.style.width = `${transcript.clientWidth}px`;
    } else if (ownsTransform) {
      transformSource = null;
      setTransform(0);
    }
    if (!edgeStarts.size && motionShell.style.width) releasePreviewWidth();
    if (!activeIds.size) {
      delete transcript.dataset.panelMotion;
    }
  };

  // Only a genuinely hidden document needs the pinned preview width released; window
  // "blur" also fires for devtools and a second window, where the shell is
  // still on screen and resetting it forces a needless relayout.
  const onVisibility = () => {
    if (document.visibilityState === "hidden") reset();
  };
  const orphanObserver = new ResizeObserver(() => {
    if (!activeIds.size && !edgeStarts.size && motionShell.style.width) releasePreviewWidth();
  });
  window.addEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
  document.addEventListener("visibilitychange", onVisibility);
  orphanObserver.observe(transcript);
  return {
    reset,
    destroy: () => {
      window.removeEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
      orphanObserver.disconnect();
      cancelRelease();
      activeIds.clear();
      edgeStarts.clear();
      transformSource = null;
      setTransform(0);
      motionShell.style.removeProperty("width");
      delete transcript.dataset.panelMotion;
    },
  };
}
