import {
  PANEL_GEOMETRY_MOTION_EVENT,
  type PanelGeometryMotionDetail,
  type PanelGeometryMotionSource,
} from "../panel-motion";

const VISIBILITY_ATTRIBUTE = "data-transcript-visibility";
const INTRINSIC_SIZE_PROPERTY = "contain-intrinsic-block-size";
const OVERSCAN_PX = 120;

interface TableLock {
  table: HTMLTableElement;
  width: string;
  marginLeft: string;
}

function blockSize(entry: ResizeObserverEntry) {
  const borderBox = entry.borderBoxSize;
  if (borderBox[0]) return borderBox[0].blockSize;
  return entry.contentRect.height;
}

export function mountTranscriptVisibility(
  transcript: HTMLElement,
  viewport: HTMLElement,
  thread: HTMLElement,
) {
  const activeIds = new Map<PanelGeometryMotionSource, number>();
  const resizeIds = new Map<PanelGeometryMotionSource, number>();
  const managed = new Set<HTMLElement>();
  let tableLocks: TableLock[] = [];
  let refreshFrame: number | null = null;
  let refreshIdle: number | null = null;
  let fontsReady = document.fonts.status === "loaded";

  const setIntrinsicSize = (element: HTMLElement, height: number) => {
    if (height > 0) element.style.setProperty(INTRINSIC_SIZE_PROPERTY, `auto ${height}px`);
  };
  const show = (element: HTMLElement) => {
    element.removeAttribute(VISIBILITY_ATTRIBUTE);
  };
  const hide = (element: HTMLElement) => {
    element.setAttribute(VISIBILITY_ATTRIBUTE, "hidden");
  };
  const clear = (element: HTMLElement) => {
    show(element);
    element.style.removeProperty(INTRINSIC_SIZE_PROPERTY);
  };

  const sizeObserver = new ResizeObserver((entries) => {
    if (activeIds.size) return;
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      if (element.getAttribute(VISIBILITY_ATTRIBUTE) !== "hidden") {
        setIntrinsicSize(element, blockSize(entry));
      }
    }
  });

  const cancelRefresh = () => {
    if (refreshFrame != null) cancelAnimationFrame(refreshFrame);
    if (refreshIdle != null) cancelIdleCallback(refreshIdle);
    refreshFrame = null;
    refreshIdle = null;
  };

  const refresh = () => {
    refreshFrame = null;
    if (!fontsReady || activeIds.size) return;
    const viewportRect = viewport.getBoundingClientRect();
    const top = viewportRect.top - OVERSCAN_PX;
    const bottom = viewportRect.bottom + OVERSCAN_PX;
    const next = new Set<HTMLElement>();
    const rows = [...thread.querySelectorAll<HTMLElement>('[data-slot="message-scroller-item"]')];

    for (const row of rows) {
      const blocks = [...row.querySelectorAll<HTMLElement>(".chat-markdown > .incremark > *")];
      if (blocks.length) {
        show(row);
        for (const block of blocks) next.add(block);
      } else {
        next.add(row);
      }
    }

    const measurements = [...next].map((element) => ({
      element,
      rect: element.getBoundingClientRect(),
    }));
    let revealed = false;
    for (const { element, rect } of measurements) {
      setIntrinsicSize(element, rect.height);
      const visible = rect.bottom >= top && rect.top <= bottom;
      if (visible) {
        revealed ||= element.getAttribute(VISIBILITY_ATTRIBUTE) === "hidden";
        show(element);
      } else {
        hide(element);
      }
      if (!managed.has(element)) sizeObserver.observe(element);
    }
    for (const element of managed) {
      if (next.has(element)) continue;
      sizeObserver.unobserve(element);
      clear(element);
    }
    managed.clear();
    for (const element of next) managed.add(element);
    if (revealed) refreshFrame = requestAnimationFrame(refresh);
  };

  const scheduleRefresh = (idle = false) => {
    if (!fontsReady || activeIds.size || refreshFrame != null || refreshIdle != null) return;
    if (idle) {
      refreshIdle = requestIdleCallback(() => {
        refreshIdle = null;
        refreshFrame = requestAnimationFrame(refresh);
      }, { timeout: 500 });
      return;
    }
    refreshFrame = requestAnimationFrame(refresh);
  };

  const lockTables = () => {
    if (tableLocks.length) return;
    tableLocks = [...thread.querySelectorAll<HTMLTableElement>(".chat-markdown table")]
      .filter((table) => !table.closest(`[${VISIBILITY_ATTRIBUTE}="hidden"]`))
      .map((table) => {
        const rect = table.getBoundingClientRect();
        const computed = getComputedStyle(table);
        const lock = {
          table,
          width: table.style.width,
          marginLeft: table.style.marginLeft,
        };
        table.style.width = `${rect.width}px`;
        table.style.marginLeft = computed.marginLeft;
        return lock;
      });
  };

  const unlockTables = () => {
    for (const lock of tableLocks) {
      if (!lock.table.isConnected) continue;
      lock.table.style.width = lock.width;
      lock.table.style.marginLeft = lock.marginLeft;
    }
    tableLocks = [];
  };

  const reset = () => {
    activeIds.clear();
    resizeIds.clear();
    cancelRefresh();
    unlockTables();
    for (const element of managed) {
      sizeObserver.unobserve(element);
      clear(element);
    }
    managed.clear();
    scheduleRefresh(true);
  };

  const onMotion = (event: Event) => {
    const detail = (event as CustomEvent<PanelGeometryMotionDetail>).detail;
    if (detail.phase === "begin") {
      cancelRefresh();
      if (!activeIds.size) refresh();
      activeIds.set(detail.source, detail.id);
      if (detail.targetSize == null) {
        resizeIds.set(detail.source, detail.id);
        lockTables();
      }
      return;
    }
    if (activeIds.get(detail.source) !== detail.id) return;
    if (detail.phase === "change") return;
    activeIds.delete(detail.source);
    if (resizeIds.get(detail.source) === detail.id) resizeIds.delete(detail.source);
    if (!resizeIds.size) unlockTables();
    if (!activeIds.size) scheduleRefresh(true);
  };

  const mutationObserver = new MutationObserver(() => scheduleRefresh(true));
  const viewportObserver = new ResizeObserver(() => scheduleRefresh());
  const onScroll = () => scheduleRefresh();
  window.addEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
  viewport.addEventListener("scroll", onScroll, { passive: true });
  mutationObserver.observe(thread, { childList: true, subtree: true });
  viewportObserver.observe(viewport);
  void document.fonts.ready.then(() => {
    fontsReady = true;
    scheduleRefresh(true);
  });

  return {
    reset,
    destroy: () => {
      window.removeEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
      viewport.removeEventListener("scroll", onScroll);
      mutationObserver.disconnect();
      viewportObserver.disconnect();
      sizeObserver.disconnect();
      cancelRefresh();
      unlockTables();
      for (const element of managed) clear(element);
      managed.clear();
    },
  };
}
