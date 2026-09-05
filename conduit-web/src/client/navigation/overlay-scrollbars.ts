const EDGE = 16;
const DWELL = 180;
const HIDDEN = ".message-scroller-viewport, .xterm-viewport, .terminal-shortcuts, .terminal-mobile-keys, .katex-display, .incremark-math-block";
type Target = { element: HTMLElement; axis: "x" | "y" };

export function scrollbarGeometry(view: number, content: number, position: number, track: number) {
  const range = Math.max(0, content - view);
  const size = Math.min(track, Math.max(28, track * view / Math.max(1, content)));
  const travel = track - size;
  return { range, size, travel, offset: range ? Math.max(0, Math.min(range, position)) / range * travel : 0 };
}

/** One mouse-only overlay, shared by all ordinary overflow containers. */
export function bindOverlayScrollbars() {
  if (!("showPopover" in HTMLElement.prototype)) return () => {};
  const media = matchMedia("(hover: hover) and (pointer: fine) and (forced-colors: none)");
  const bar = document.createElement("div");
  bar.className = "overlay-scrollbar";
  bar.popover = "manual";
  // This supplements the scroll container's existing keyboard interface.
  bar.setAttribute("aria-hidden", "true");
  const thumb = document.createElement("div");
  thumb.className = "overlay-scrollbar-thumb";
  bar.append(thumb);
  let target: Target | null = null;
  let timer = 0;
  let frame = 0;
  let shown = false;
  let pointer = { x: -1, y: -1 };
  let drag: { id: number; coordinate: number; scroll: number } | null = null;

  function hide() {
    clearTimeout(timer);
    timer = 0;
    cancelAnimationFrame(frame);
    frame = 0;
    drag = null;
    if (shown && bar.isConnected) bar.hidePopover();
    bar.remove();
    shown = false;
    target = null;
  }

  function bounds(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    const sx = rect.width / Math.max(1, element.offsetWidth);
    const sy = rect.height / Math.max(1, element.offsetHeight);
    const left = rect.left + element.clientLeft * sx;
    const top = rect.top + element.clientTop * sy;
    let right = left + element.clientWidth * sx;
    let bottom = top + element.clientHeight * sy;
    let visibleLeft = Math.max(0, left);
    let visibleTop = Math.max(0, top);
    right = Math.min(innerWidth, right);
    bottom = Math.min(innerHeight, bottom);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      const clip = parent.getBoundingClientRect();
      if (style.overflowX !== "visible") {
        visibleLeft = Math.max(visibleLeft, clip.left);
        right = Math.min(right, clip.right);
      }
      if (style.overflowY !== "visible") {
        visibleTop = Math.max(visibleTop, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
    }
    return { left: visibleLeft, top: visibleTop, right, bottom };
  }

  function near(candidate: Target) {
    const r = bounds(candidate.element);
    return pointer.x >= r.left && pointer.x <= r.right && pointer.y >= r.top && pointer.y <= r.bottom
      && (candidate.axis === "y" ? r.right - pointer.x <= EDGE : r.bottom - pointer.y <= EDGE);
  }

  function metrics(candidate: Target) {
    const e = candidate.element;
    const r = bounds(e);
    const vertical = candidate.axis === "y";
    const length = Math.max(0, (vertical ? r.bottom - r.top : r.right - r.left) - 4);
    const geometry = scrollbarGeometry(vertical ? e.clientHeight : e.clientWidth,
      vertical ? e.scrollHeight : e.scrollWidth, vertical ? e.scrollTop : e.scrollLeft, length);
    return { ...geometry, r, length, vertical };
  }

  function paint() {
    if (!target || !target.element.isConnected || (!drag && !near(target))) { hide(); return; }
    const m = metrics(target);
    if (!m.range || m.length < 28 || getComputedStyle(target.element).visibility === "hidden") { hide(); return; }
    bar.dataset.axis = target.axis;
    bar.style.left = `${m.vertical ? m.r.right - 12 : m.r.left + 2}px`;
    bar.style.top = `${m.vertical ? m.r.top + 2 : m.r.bottom - 12}px`;
    bar.style.width = `${m.vertical ? 12 : m.length}px`;
    bar.style.height = `${m.vertical ? m.length : 12}px`;
    thumb.style.width = m.vertical ? "8px" : `${m.size}px`;
    thumb.style.height = m.vertical ? `${m.size}px` : "8px";
    thumb.style.transform = `translate${m.vertical ? "Y" : "X"}(${m.offset}px)`;
    // Only the visible control follows layout/scroll changes. No idle polling,
    // transcript observers, or per-scroll-container components.
    frame = requestAnimationFrame(paint);
  }

  function reveal() {
    timer = 0;
    if (!target || !target.element.isConnected || !near(target)) { hide(); return; }
    // Stay inside modal dismissal boundaries without touching editor-owned DOM.
    (target.element.closest('[role="dialog"], dialog, [role="menu"]') ?? document.body).append(bar);
    bar.showPopover();
    shown = true;
    paint();
  }

  function findTarget(event: PointerEvent): Target | null {
    // The sidebar's transparent rail covers the final 6px of its scrollport.
    const path = event.target instanceof Element && event.target.closest('[data-sidebar="rail"]')
      ? document.elementsFromPoint(pointer.x, pointer.y) : event.composedPath();
    for (const element of path) {
      if (!(element instanceof HTMLElement) || element.matches(HIDDEN)) continue;
      const style = getComputedStyle(element);
      for (const axis of ["y", "x"] as const) {
        const overflow = axis === "y" ? style.overflowY : style.overflowX;
        const excess = axis === "y" ? element.scrollHeight - element.clientHeight : element.scrollWidth - element.clientWidth;
        const candidate = { element, axis };
        if (/^(auto|scroll)$/.test(overflow) && excess > 1 && near(candidate)) return candidate;
      }
    }
    return null;
  }

  function move(event: PointerEvent) {
    pointer = { x: event.clientX, y: event.clientY };
    if (!media.matches || event.pointerType !== "mouse") return;
    if (drag && target) {
      const m = metrics(target);
      const delta = (m.vertical ? pointer.y : pointer.x) - drag.coordinate;
      const position = drag.scroll + delta * m.range / Math.max(1, m.travel);
      if (m.vertical) target.element.scrollTop = position;
      else target.element.scrollLeft = position;
      return;
    }
    if (event.buttons) { hide(); return; }
    if (shown && target && near(target) && event.composedPath().includes(bar)) return;
    const next = findTarget(event);
    if (next?.element === target?.element && next?.axis === target?.axis) return;
    hide();
    target = next;
    if (target) timer = window.setTimeout(reveal, DWELL);
  }

  function down(event: PointerEvent) {
    if (!target || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const m = metrics(target);
    const coordinate = m.vertical ? event.clientY : event.clientX;
    if (event.target !== thumb) {
      const start = (m.vertical ? m.r.top : m.r.left) + 2;
      const position = (coordinate - start - m.size / 2) / Math.max(1, m.travel) * m.range;
      if (m.vertical) target.element.scrollTop = position;
      else target.element.scrollLeft = position;
    }
    drag = { id: event.pointerId, coordinate, scroll: m.vertical ? target.element.scrollTop : target.element.scrollLeft };
    bar.setPointerCapture(event.pointerId);
  }

  function release() {
    if (drag && bar.hasPointerCapture(drag.id)) bar.releasePointerCapture(drag.id);
    drag = null;
    if (target && !near(target)) hide();
  }
  function leave(event: PointerEvent) { if (!event.relatedTarget && !drag) hide(); }
  function wheel(event: WheelEvent) {
    if (!target) return;
    // The top-layer control is outside the native scroll chain.
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? target.element.clientHeight : 1;
    target.element.scrollBy({
      left: (event.deltaX + (event.shiftKey ? event.deltaY : 0)) * scale,
      top: (event.shiftKey ? 0 : event.deltaY) * scale,
      behavior: "instant",
    });
    event.preventDefault();
  }
  function outsideDown(event: PointerEvent) {
    if (!(event.target instanceof Node) || !bar.contains(event.target)) hide();
  }
  function syncMedia() {
    hide();
    document.documentElement.toggleAttribute("data-overlay-scrollbars", media.matches);
  }
  bar.addEventListener("pointerdown", down);
  bar.addEventListener("pointerup", release);
  bar.addEventListener("pointercancel", hide);
  bar.addEventListener("lostpointercapture", release);
  bar.addEventListener("wheel", wheel, { passive: false });
  document.addEventListener("pointermove", move, { passive: true });
  document.addEventListener("pointerout", leave);
  document.addEventListener("pointerdown", outsideDown, true);
  document.addEventListener("keydown", hide, true);
  window.addEventListener("blur", hide);
  media.addEventListener("change", syncMedia);
  syncMedia();
  return () => {
    hide();
    document.documentElement.removeAttribute("data-overlay-scrollbars");
    document.removeEventListener("pointermove", move);
    document.removeEventListener("pointerout", leave);
    document.removeEventListener("pointerdown", outsideDown, true);
    document.removeEventListener("keydown", hide, true);
    window.removeEventListener("blur", hide);
    media.removeEventListener("change", syncMedia);
  };
}
