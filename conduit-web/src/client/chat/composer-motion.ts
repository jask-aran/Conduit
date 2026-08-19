import {
  PANEL_GEOMETRY_MOTION_EVENT,
  type PanelGeometryMotionDetail,
  type PanelGeometryMotionSource,
} from "../panel-motion";

type MotionStart = {
  id: number;
  size: number;
  width: number;
};

function transformX(element: HTMLElement) {
  const transform = getComputedStyle(element).transform;
  if (transform === "none") return 0;
  return new DOMMatrixReadOnly(transform).m41;
}

function panelShift(source: PanelGeometryMotionSource, delta: number) {
  return source === "sidebar" ? delta / 2 : -delta / 2;
}

function availableWidth(shell: HTMLElement) {
  const stack = shell.parentElement;
  if (!stack) return shell.clientWidth;
  const style = getComputedStyle(stack);
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  return Math.max(0, stack.clientWidth - padding);
}

export function mountComposerPanelMotion(composerShell: HTMLElement) {
  let motion: Animation | null = null;
  let releaseFrame: number | null = null;
  const stack = composerShell.parentElement;
  const activeIds = new Map<PanelGeometryMotionSource, number>();
  const starts = new Map<PanelGeometryMotionSource, MotionStart>();

  const cancelRelease = () => {
    if (releaseFrame != null) cancelAnimationFrame(releaseFrame);
    releaseFrame = null;
  };

  const setTransform = (next: number) => {
    motion?.cancel();
    motion = null;
    composerShell.style.transform = next ? `translateX(${next}px)` : "";
  };

  const releaseGeometry = () => {
    cancelRelease();
    releaseFrame = requestAnimationFrame(() => {
      releaseFrame = null;
      if (activeIds.size || starts.size) return;
      composerShell.style.removeProperty("width");
      composerShell.style.removeProperty("transform");
    });
  };

  const constrainWidthIfNeeded = () => {
    if (!starts.size) return;
    const pinnedWidth = Math.min(...[...starts.values()].map((start) => start.width));
    const available = availableWidth(composerShell);
    if (available < pinnedWidth) composerShell.style.width = `${available}px`;
  };

  const reset = () => {
    activeIds.clear();
    starts.clear();
    setTransform(0);
    composerShell.style.removeProperty("width");
    delete composerShell.dataset.panelMotion;
  };

  const onMotion = (event: Event) => {
    const detail = (event as CustomEvent<PanelGeometryMotionDetail>).detail;
    if (detail.phase === "begin") {
      cancelRelease();
      activeIds.set(detail.source, detail.id);
      const width = composerShell.getBoundingClientRect().width;
      composerShell.style.width = `${width}px`;
      starts.set(detail.source, { id: detail.id, size: detail.size, width });
      composerShell.dataset.panelMotion = detail.targetSize == null ? "edge" : "translate";

      if (detail.targetSize != null) {
        const shift = panelShift(detail.source, detail.targetSize - detail.size);
        const current = transformX(composerShell);
        motion?.cancel();
        composerShell.style.removeProperty("transform");
        motion = composerShell.animate([
          { transform: `translateX(${current - shift}px)` },
          { transform: "translateX(0px)" },
        ], {
          duration: detail.duration || 0,
          easing: detail.easing || "linear",
          fill: "forwards",
        });
      } else {
        setTransform(0);
      }
      return;
    }

    if (detail.id !== activeIds.get(detail.source)) return;
    if (detail.phase === "change") {
      const start = starts.get(detail.source);
      if (!start) return;
      constrainWidthIfNeeded();
      const shift = panelShift(detail.source, detail.size - start.size);
      setTransform(-shift);
      return;
    }

    activeIds.delete(detail.source);
    starts.delete(detail.source);
    if (!activeIds.size) setTransform(0);
    if (!starts.size) {
      delete composerShell.dataset.panelMotion;
      releaseGeometry();
    }
  };

  const onPageLeave = () => reset();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") reset();
  };

  window.addEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
  window.addEventListener("blur", onPageLeave);
  document.addEventListener("visibilitychange", onVisibility);
  const stackObserver = stack ? new ResizeObserver(constrainWidthIfNeeded) : null;
  if (stack) stackObserver?.observe(stack);

  return {
    reset,
    destroy: () => {
      window.removeEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
      window.removeEventListener("blur", onPageLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      stackObserver?.disconnect();
      cancelRelease();
      activeIds.clear();
      starts.clear();
      setTransform(0);
      composerShell.style.removeProperty("width");
      delete composerShell.dataset.panelMotion;
    },
  };
}
