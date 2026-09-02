import {
  PANEL_GEOMETRY_MOTION_EVENT,
  type PanelGeometryMotionDetail,
  type PanelGeometryMotionSource,
} from "../panel-motion";

const VISIBILITY_ATTRIBUTE = "data-transcript-visibility";
const INTRINSIC_SIZE_PROPERTY = "contain-intrinsic-block-size";
const INTRINSIC_INLINE_SIZE_PROPERTY = "contain-intrinsic-inline-size";
const OVERSCAN_PX = 120;
const DISPLAY_MATH_SELECTOR = ".incremark-math-block, .katex-display";
const SETTLED_MESSAGE_SELECTOR = '.chat-markdown[data-settled="true"]';

interface TableLock {
  table: HTMLTableElement;
  width: string;
  marginLeft: string;
}

function intrinsicBlockSize(element: HTMLElement, borderBoxSize: number) {
  const style = getComputedStyle(element);
  const border = Number.parseFloat(style.borderBlockStartWidth)
    + Number.parseFloat(style.borderBlockEndWidth);
  return Math.max(0, borderBoxSize - border);
}

function blockSize(entry: ResizeObserverEntry) {
  const borderBox = entry.borderBoxSize;
  const size = borderBox[0]?.blockSize ?? entry.target.getBoundingClientRect().height;
  return intrinsicBlockSize(entry.target as HTMLElement, size);
}

function intrinsicInlineSize(element: HTMLElement, borderBoxSize: number) {
  const style = getComputedStyle(element);
  const border = Number.parseFloat(style.borderInlineStartWidth)
    + Number.parseFloat(style.borderInlineEndWidth);
  return Math.max(0, borderBoxSize - border);
}

function inlineSize(entry: ResizeObserverEntry) {
  const borderBox = entry.borderBoxSize;
  const size = borderBox[0]?.inlineSize ?? entry.target.getBoundingClientRect().width;
  return intrinsicInlineSize(entry.target as HTMLElement, size);
}

function containsDisplayMath(element: HTMLElement) {
  return element.matches(DISPLAY_MATH_SELECTOR) || Boolean(element.querySelector(DISPLAY_MATH_SELECTOR));
}

// Three observers share the work, and the split is the whole point of this
// module's shape:
//   - IntersectionObserver decides what is on screen. It is the only thing that
//     runs while scrolling, and it costs no main-thread layout at all.
//   - ResizeObserver records each managed block's rendered size so the
//     placeholder it leaves behind is the right shape.
//   - MutationObserver keeps the managed set in step with the DOM.
// A synchronous measuring pass still exists, but only for the moments where the
// caller must see the new layout in the same frame -- a code block collapsing,
// a panel finishing its motion, the viewport resizing. Scrolling never enters
// it, so transcript length no longer sets the cost of a scroll frame.
export function mountTranscriptVisibility(
  transcript: HTMLElement,
  viewport: HTMLElement,
  thread: HTMLElement,
) {
  const activeIds = new Map<PanelGeometryMotionSource, number>();
  const resizeIds = new Map<PanelGeometryMotionSource, number>();
  const managed = new Set<HTMLElement>();
  let tableLocks: TableLock[] = [];
  let measureFrame: number | null = null;
  let measureIdle: number | null = null;
  let syncFrame: number | null = null;
  let settleFrame: number | null = null;
  let refreshing = false;
  let fontsReady = document.fonts.status === "loaded";

  // content-visibility applies size containment on BOTH axes, so a hidden block
  // contributes zero intrinsic inline size. Any ancestor that sizes to its
  // content -- a shrink-to-fit code card, an auto-layout table -- then rewidens
  // as blocks cross the overscan band, which reads as a horizontal shimmy while
  // scrolling. Pin the measured inline size alongside the block size so the
  // horizontal axis cannot move when a block leaves the viewport.
  const setIntrinsicSize = (element: HTMLElement, height: number, width: number) => {
    if (height > 0) {
      const value = `auto ${height}px`;
      if (element.style.getPropertyValue(INTRINSIC_SIZE_PROPERTY) !== value) {
        element.style.setProperty(INTRINSIC_SIZE_PROPERTY, value);
      }
    }
    if (width > 0) {
      const value = `auto ${width}px`;
      if (element.style.getPropertyValue(INTRINSIC_INLINE_SIZE_PROPERTY) !== value) {
        element.style.setProperty(INTRINSIC_INLINE_SIZE_PROPERTY, value);
      }
    }
  };
  const show = (element: HTMLElement) => {
    if (!element.hasAttribute(VISIBILITY_ATTRIBUTE)) return false;
    element.removeAttribute(VISIBILITY_ATTRIBUTE);
    return true;
  };
  const hide = (element: HTMLElement) => {
    if (element.getAttribute(VISIBILITY_ATTRIBUTE) === "hidden") return false;
    element.setAttribute(VISIBILITY_ATTRIBUTE, "hidden");
    return true;
  };
  const clear = (element: HTMLElement) => {
    show(element);
    element.style.removeProperty(INTRINSIC_SIZE_PROPERTY);
    element.style.removeProperty(INTRINSIC_INLINE_SIZE_PROPERTY);
  };

  // Toggling content-visibility resizes the thread. The transcript's own
  // ResizeObserver must not read that as new content and chase the tail, so
  // every visibility change holds this flag through the following frame.
  const holdRefreshing = () => {
    refreshing = true;
    if (settleFrame != null) cancelAnimationFrame(settleFrame);
    settleFrame = requestAnimationFrame(() => {
      settleFrame = requestAnimationFrame(() => {
        settleFrame = null;
        if (measureFrame == null) refreshing = false;
      });
    });
  };

  const sizeObserver = new ResizeObserver((entries) => {
    if (activeIds.size) return;
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      if (element.getAttribute(VISIBILITY_ATTRIBUTE) !== "hidden") {
        setIntrinsicSize(element, blockSize(entry), inlineSize(entry));
      }
    }
  });

  const visibilityObserver = new IntersectionObserver((entries) => {
    // Panel motion animates the viewport itself. Its intersections describe a
    // geometry that is still moving, so let the pass at motion end settle them.
    if (activeIds.size) return;
    let changed = false;
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      if (!managed.has(element)) continue;
      changed = (entry.isIntersecting ? show(element) : hide(element)) || changed;
    }
    if (changed) holdRefreshing();
  }, { root: viewport, rootMargin: `${OVERSCAN_PX}px 0px` });

  const cancelRefresh = () => {
    if (measureFrame != null) cancelAnimationFrame(measureFrame);
    if (measureIdle != null) cancelIdleCallback(measureIdle);
    if (syncFrame != null) cancelAnimationFrame(syncFrame);
    if (settleFrame != null) cancelAnimationFrame(settleFrame);
    measureFrame = null;
    measureIdle = null;
    syncFrame = null;
    settleFrame = null;
    refreshing = false;
  };

  // Reconcile the managed set with the DOM. This reads no geometry, so it is
  // what streaming pays: new blocks start observed and fully rendered, and the
  // observers take it from there.
  const syncMembership = () => {
    const next = new Set<HTMLElement>();
    const stableIncremarkBlocks = new Set<HTMLElement>();
    const settledIncremarkBlocks = new Set<HTMLElement>();

    for (const row of thread.querySelectorAll<HTMLElement>('[data-slot="message-scroller-item"]')) {
      const blocks = [...row.querySelectorAll<HTMLElement>(".chat-markdown > .incremark > *")];
      if (!blocks.length) {
        next.add(row);
        continue;
      }
      show(row);
      const hasDisplayMath = blocks.some(containsDisplayMath);
      for (const block of blocks) {
        next.add(block);
        if (block.closest(SETTLED_MESSAGE_SELECTOR)) settledIncremarkBlocks.add(block);
        else if (hasDisplayMath) stableIncremarkBlocks.add(block);
      }
    }

    const virtualized = new Set<HTMLElement>();
    for (const element of next) {
      // A message that contains display math stays fully laid out until it
      // settles: content-visibility on either the KaTeX block or a sibling was
      // observed changing the root's intrinsic inline geometry and shifting
      // equations. Settlement gives the root explicit inline-size containment,
      // and only then can every top-level block be managed independently
      // without changing its centring basis.
      if (!settledIncremarkBlocks.has(element)
        && (stableIncremarkBlocks.has(element) || containsDisplayMath(element))) continue;
      virtualized.add(element);
    }

    for (const element of managed) {
      if (virtualized.has(element)) continue;
      visibilityObserver.unobserve(element);
      sizeObserver.unobserve(element);
      clear(element);
    }
    for (const element of virtualized) {
      if (managed.has(element)) continue;
      sizeObserver.observe(element);
      visibilityObserver.observe(element);
    }
    managed.clear();
    for (const element of virtualized) managed.add(element);
    return virtualized;
  };

  // Reads every managed rect, then writes every attribute. Interleaving the two
  // would force a layout per block; the transcript is long enough for that to
  // be the difference between a frame and a stall.
  const measurePass = () => {
    const virtualized = syncMembership();
    const viewportRect = viewport.getBoundingClientRect();
    const top = viewportRect.top - OVERSCAN_PX;
    const bottom = viewportRect.bottom + OVERSCAN_PX;
    const measurements = [...virtualized].map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        element,
        height: intrinsicBlockSize(element, rect.height),
        width: intrinsicInlineSize(element, rect.width),
        visible: rect.bottom >= top && rect.top <= bottom,
      };
    });
    let revealed = false;
    for (const { element, height, width, visible } of measurements) {
      setIntrinsicSize(element, height, width);
      if (visible) revealed = show(element) || revealed;
      else hide(element);
    }
    return revealed;
  };

  const refresh = () => {
    measureFrame = null;
    if (!fontsReady || activeIds.size) return;
    // Revealing a block relaid the ones after it, so anything that moved into
    // the band during this pass needs one more look.
    if (measurePass()) measureFrame = requestAnimationFrame(refresh);
    holdRefreshing();
  };

  const scheduleRefresh = (idle = false) => {
    if (!fontsReady || activeIds.size || measureFrame != null || measureIdle != null) return;
    if (idle) {
      measureIdle = requestIdleCallback(() => {
        measureIdle = null;
        measureFrame = requestAnimationFrame(refresh);
      }, { timeout: 500 });
      return;
    }
    measureFrame = requestAnimationFrame(refresh);
  };

  const scheduleSync = () => {
    if (!fontsReady || activeIds.size || syncFrame != null
      || measureFrame != null || measureIdle != null) return;
    syncFrame = requestAnimationFrame(() => {
      syncFrame = null;
      syncMembership();
    });
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
      visibilityObserver.unobserve(element);
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
      if (detail.source === "workspace" && detail.targetSize == null) {
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

  const mutationObserver = new MutationObserver((records) => {
    // A collapse commits a large height change in one go. Leaving it to the
    // observers left every cached intrinsic size stale for a frame or more,
    // which showed as empty placeholders where the text should be.
    const deliberate = records.some((record) => record.attributeName === "data-collapsed");
    if (deliberate) scheduleRefresh();
    else scheduleSync();
  });
  const viewportObserver = new ResizeObserver(() => scheduleRefresh());
  // Backgrounding must not disturb geometry. Clearing the intrinsic sizes here
  // relaid out the whole transcript while hidden, which moved scrollTop under
  // the browser and flashed a second relayout on return. Park the scheduler
  // instead and keep every measurement, so the tab comes back exactly as left.
  // window "blur" is deliberately not observed: it fires for devtools and for a
  // second window, where the transcript is still fully visible.
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      cancelRefresh();
      unlockTables();
      // Abandon in-flight panel motions: their end events may never arrive
      // while hidden, and a stuck activeIds entry would gate every future
      // refresh. Dropping the tracking costs nothing -- the geometry stays.
      activeIds.clear();
      resizeIds.clear();
      return;
    }
    scheduleRefresh(true);
  };
  window.addEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
  document.addEventListener("visibilitychange", onVisibility);
  mutationObserver.observe(thread, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-settled", "data-collapsed"],
  });
  viewportObserver.observe(viewport);
  void document.fonts.ready.then(() => {
    fontsReady = true;
    scheduleRefresh(true);
  });

  return {
    reset,
    refreshing: () => refreshing,
    /** Re-measure now, discarding anything already queued. */
    refreshNow: () => {
      cancelRefresh();
      refresh();
    },
    destroy: () => {
      window.removeEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
      mutationObserver.disconnect();
      viewportObserver.disconnect();
      visibilityObserver.disconnect();
      sizeObserver.disconnect();
      cancelRefresh();
      unlockTables();
      for (const element of managed) clear(element);
      managed.clear();
    },
  };
}
