import {
  PANEL_GEOMETRY_MOTION_EVENT,
  type PanelGeometryMotionDetail,
  type PanelGeometryMotionSource,
} from "../panel-motion";
import { usePanelMotion } from "./transcript-appearance";

function transformX(element: HTMLElement) {
  const transform = getComputedStyle(element).transform;
  if (transform === "none") return 0;
  return new DOMMatrixReadOnly(transform).m41;
}

function layoutWidth(element: HTMLElement) {
  // Do not replace this with clientWidth. Windows display scaling produces
  // fractional CSS widths. Rounding 709.19px to 709px was enough to wrap an
  // earlier line, add 10px to the thread and move every later block on the
  // initial pointer-down, before the resize handle had moved.
  return element.getBoundingClientRect().width;
}

export function mountTranscriptPanelMotion(
  transcript: HTMLElement,
  motionShell: HTMLElement,
  setScrollTop: (next: number) => void,
) {
  let motion: Animation | null = null;
  let releaseFrame: number | null = null;
  const activeIds = new Map<PanelGeometryMotionSource, number>();
  // Edge motions (resize + open/close shell easing) pin a preview width so the
  // heavy transcript does not take natural flex width on every frame.
  const edgeStarts = new Map<PanelGeometryMotionSource, { size: number; width: number; contentWidth: number; gutter: number; canTranslate: boolean; shift: number }>();
  let transformSource: PanelGeometryMotionSource | null = null;
  const panelMotionMode = usePanelMotion();

  const cancelRelease = () => {
    if (releaseFrame != null) cancelAnimationFrame(releaseFrame);
    releaseFrame = null;
  };

  const setTransform = (next: number) => {
    motion?.cancel();
    motion = null;
    motionShell.style.transform = next ? `translateX(${next}px)` : "";
  };

  const setWidthPreservingAnchor = (width: number) => {
    // Reflow is allowed to change line breaks, but it must not move the user's
    // reading position when blocks above the viewport gain or lose lines. Use
    // the first block whose top edge is visible: an intersecting block that
    // began above the viewport can itself grow, so anchoring its top does not
    // protect the later text the user can see. Disable native anchoring for
    // this transaction so Chrome and Conduit do not both apply a correction.
    const viewport = transcript.querySelector<HTMLElement>(".message-scroller-viewport");
    const viewportTop = viewport?.getBoundingClientRect().top ?? 0;
    const blocks = [...transcript.querySelectorAll<HTMLElement>(".chat-markdown > .incremark > *")];
    const anchor = blocks.find((element) => element.getBoundingClientRect().top >= viewportTop)
      ?? blocks.find((element) => element.getBoundingClientRect().bottom > viewportTop);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const overflowAnchor = viewport?.style.overflowAnchor;
    if (viewport) viewport.style.overflowAnchor = "none";
    motionShell.style.width = `${width}px`;
    if (viewport && anchor && anchorTop != null) {
      const delta = anchor.getBoundingClientRect().top - anchorTop;
      if (Math.abs(delta) > 0.05) setScrollTop(viewport.scrollTop + delta);
    }
    if (viewport) viewport.style.overflowAnchor = overflowAnchor || "";
  };

  const releasePreviewWidth = () => {
    cancelRelease();
    releaseFrame = requestAnimationFrame(() => {
      releaseFrame = null;
      if (activeIds.size || edgeStarts.size || !motionShell.style.width) return;
      const parentWidth = layoutWidth(transcript);
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
      motionShell.style.width = `${layoutWidth(transcript)}px`;
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
      // Preserve the exact rendered shell width. The panel begin event must be
      // geometry-neutral; all visible movement starts with a change event.
      const width = layoutWidth(motionShell);
      const thread = transcript.querySelector<HTMLElement>(".thread");
      const contentWidth = thread?.getBoundingClientRect().width || width;
      const gutter = thread ? Number.parseFloat(getComputedStyle(thread).getPropertyValue("--transcript-column-gutter")) || 0 : 0;
      motionShell.style.width = `${width}px`;
      edgeStarts.set(detail.source, {
        size: detail.size,
        width,
        contentWidth,
        gutter,
        canTranslate: contentWidth + gutter < width - 1,
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
      const availableWidth = Math.max(0, start.width - delta);
      if (panelMotionMode() === "reflow" || !start.canTranslate) {
        start.shift = 0;
        setWidthPreservingAnchor(availableWidth);
        let shift = 0;
        for (const entry of edgeStarts.values()) shift += entry.shift;
        setTransform(shift);
        return;
      }
      // Keep the transcript at its settled shape while a panel edge moves.
      // The compositor follows the changing center, then one final layout
      // commit adopts the target width. The "reflow" preference opts back
      // into taking real width every frame.
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
      setWidthPreservingAnchor(layoutWidth(transcript));
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
