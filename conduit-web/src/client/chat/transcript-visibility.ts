import {
  PANEL_GEOMETRY_MOTION_EVENT,
  type PanelGeometryMotionDetail,
  type PanelGeometryMotionSource,
} from "../panel-motion";

const VISIBILITY_ATTRIBUTE = "data-transcript-visibility";
const INTRINSIC_SIZE_PROPERTY = "contain-intrinsic-block-size";
const INTRINSIC_INLINE_SIZE_PROPERTY = "contain-intrinsic-inline-size";
const OVERSCAN_PX = 120;

// A placeholder (contain-intrinsic-size) is the size of the content box, and sizes read from a rect are border boxes,
// so padding and borders come off. A block's insets do not change as it resizes, so they are read once: at settlement
// every block of a long answer is observed at once.
const insets = new WeakMap<Element, { block: number; inline: number }>();

function insetsOf(element: HTMLElement) {
  let known = insets.get(element);
  if (!known) {
    const style = getComputedStyle(element);
    const sum = (...values: string[]) => values.reduce((total, value) => total + Number.parseFloat(value), 0);
    known = {
      block: sum(style.borderBlockStartWidth, style.borderBlockEndWidth, style.paddingBlockStart, style.paddingBlockEnd),
      inline: sum(style.borderInlineStartWidth, style.borderInlineEndWidth, style.paddingInlineStart, style.paddingInlineEnd),
    };
    insets.set(element, known);
  }
  return known;
}

function intrinsicBlockSize(element: HTMLElement, borderBoxSize: number) {
  return Math.max(0, borderBoxSize - insetsOf(element).block);
}

function intrinsicInlineSize(element: HTMLElement, borderBoxSize: number) {
  return Math.max(0, borderBoxSize - insetsOf(element).inline);
}

const ROW_SELECTOR = '[data-slot="message-scroller-item"]';

// Scrolling runs only the IntersectionObservers, which cost no main-thread layout, so transcript length does not set
// the cost of a scroll frame. The synchronous measuring pass is only for moments the caller must see the new layout in
// the same frame: a code block collapsing, a panel finishing its motion, the viewport resizing.
export function mountTranscriptVisibility(
  viewport: HTMLElement,
  thread: HTMLElement,
  /** The viewport has no scroll anchoring. */
  shiftScroll: (delta: number) => void = (delta) => { viewport.scrollTop += delta; },
) {
  const activeIds = new Map<PanelGeometryMotionSource, number>();
  const managed = new Set<HTMLElement>();
  let measureFrame: number | null = null;
  let measureIdle: number | null = null;
  let syncFrame: number | null = null;
  let settleFrame: number | null = null;
  let refreshing = false;
  let fontsReady = document.fonts.status === "loaded";

  // content-visibility applies size containment on BOTH axes, so a hidden block
  // contributes zero intrinsic inline size, and an ancestor that sizes to its
  // content rewidens as blocks cross the overscan band. The inline size is pinned too.
  // The measured size alone, not `auto`: with `auto` the browser prefers the size it last remembered drawing, which
  // can be stale.
  const setIntrinsicSize = (element: HTMLElement, height: number, width: number) => {
    for (const [property, size] of [[INTRINSIC_SIZE_PROPERTY, height], [INTRINSIC_INLINE_SIZE_PROPERTY, width]] as const) {
      if (size > 0 && element.style.getPropertyValue(property) !== `${size}px`) element.style.setProperty(property, `${size}px`);
    }
  };
  // Only a shown element is size-observed: a hidden one's size is contained, so it cannot change, and every
  // observation costs the browser a check each frame.
  const show = (element: HTMLElement) => {
    const state = element.getAttribute(VISIBILITY_ATTRIBUTE);
    // A collapsed block comes back only with its whole run (expandAbove).
    if (state == null || state === "collapsed") return false;
    element.removeAttribute(VISIBILITY_ATTRIBUTE);
    if (managed.has(element)) sizeObserver.observe(element);
    return true;
  };
  // A formula still waiting in the render queue is an empty box shorter than
  // the formula. Hidden, its placeholder would keep the empty box's height, so
  // it stays laid out until the queue drains.
  const pendingMath = (element: HTMLElement) =>
    element.matches(".incremark-math-block:empty") || element.querySelector(".incremark-math-block:empty") !== null;
  const hide = (element: HTMLElement) => {
    const state = element.getAttribute(VISIBILITY_ATTRIBUTE);
    if (state === "hidden" || state === "collapsed") return false;
    if (pendingMath(element)) return false;
    element.setAttribute(VISIBILITY_ATTRIBUTE, "hidden");
    sizeObserver.unobserve(element);
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
    // Every read before any write: a size written between two reads makes the next read recalculate style.
    const sizes = entries
      .filter((entry) => (entry.target as HTMLElement).getAttribute(VISIBILITY_ATTRIBUTE) !== "hidden")
      .map((entry) => [entry.target as HTMLElement, entry.contentBoxSize[0]!.blockSize, entry.contentBoxSize[0]!.inlineSize] as const);
    for (const [element, height, width] of sizes) setIntrinsicSize(element, height, width);
  });

  const visibilityObserver = new IntersectionObserver((entries) => {
    // Panel motion animates the viewport itself. Its intersections describe a
    // geometry that is still moving, so let the pass at motion end settle them.
    if (activeIds.size) return;
    let changed = false;
    const hidden: HTMLElement[] = [];
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      if (!managed.has(element)) continue;
      if (entry.isIntersecting) changed = show(element) || changed;
      else if (hide(element)) { changed = true; hidden.push(element); }
    }
    if (hidden.length) collapseFrom(hidden);
    if (changed) holdRefreshing();
  }, { root: viewport, rootMargin: `${OVERSCAN_PX}px 0px` });

  // Told by an observer whose root reaches a viewport further up, so finding a run reads no layout.
  const farAbove = new Set<HTMLElement>();
  // A run's blocks brought back as the reader nears them report where they are, which collapses nothing: they go
  // again only when something next hides.
  const returning = new Set<HTMLElement>();
  const farObserver = new IntersectionObserver((entries) => {
    if (activeIds.size) return;
    const containers = new Set<HTMLElement>();
    for (const entry of entries) {
      const element = entry.target as HTMLElement;
      if (!managed.has(element)) continue;
      const quiet = returning.delete(element);
      if (entry.isIntersecting || entry.boundingClientRect.bottom > (entry.rootBounds?.top ?? 0)) { farAbove.delete(element); continue; }
      farAbove.add(element);
      if (!quiet && element.parentElement?.classList.contains("incremark")) containers.add(element.parentElement);
    }
    for (const container of containers) collapseAbove(container);
  }, { root: viewport, rootMargin: "100% 0px 0px 0px" });
  const observe = (element: HTMLElement) => {
    visibilityObserver.observe(element);
    farObserver.observe(element);
  };
  const unobserve = (element: HTMLElement) => {
    visibilityObserver.unobserve(element);
    farObserver.unobserve(element);
    farAbove.delete(element);
    returning.delete(element);
  };

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

  // Per row, so a streamed frame touches only the row it changed.
  const rowElements = new Map<HTMLElement, HTMLElement[]>();

  // Every top-level block, a streaming answer's included: keeping every formula written so far laid out makes a long
  // mathematical answer's frames grow with it.
  const elementsOf = (row: HTMLElement) => {
    const blocks = [...row.querySelectorAll<HTMLElement>(".chat-markdown > .incremark > *")];
    if (!blocks.length) return [row];
    show(row);
    return blocks;
  };

  const release = (element: HTMLElement) => {
    if (element.getAttribute(VISIBILITY_ATTRIBUTE) === "collapsed" && element.parentElement) expandAbove(element.parentElement);
    unobserve(element);
    sizeObserver.unobserve(element);
    clear(element);
    managed.delete(element);
  };

  const syncRow = (row: HTMLElement) => {
    order = null;
    const previous = rowElements.get(row) ?? [];
    const next = row.isConnected ? elementsOf(row) : [];
    const kept = new Set(next);
    for (const element of previous) if (!kept.has(element)) release(element);
    for (const element of next) {
      if (managed.has(element)) continue;
      managed.add(element);
      sizeObserver.observe(element);
      observe(element);
    }
    if (next.length) rowElements.set(row, next);
    else rowElements.delete(row);
  };

  // A hidden block is still in layout: every frame the browser lays out, pre-paints and checks each one. A run of
  // COLLAPSE_BATCH or more hidden blocks wholly a viewport or more above the reader leaves layout (display: none), its
  // height kept as the answer's top padding: not inherited, so setting it restyles the answer alone, where a custom
  // property would restyle every element of it.
  const COLLAPSE_BATCH = 16;
  const collapsedAbove = new Map<HTMLElement, HTMLElement[]>();
  const runIsLeading = (container: HTMLElement, run: HTMLElement[]) => run.every((block, index) => container.children[index] === block);
  const setSpacer = (container: HTMLElement, height: number) => {
    container.style.paddingTop = `${Math.max(0, height)}px`;
  };
  const expandAbove = (container: HTMLElement) => {
    const run = collapsedAbove.get(container);
    if (!run) return;
    collapsedAbove.delete(container);
    order = null;
    const next = container.children[run.length] as HTMLElement | undefined;
    // Where the first block left sits in its answer: a scroll the layout clamps does not move it.
    const offset = () => next!.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const before = next?.isConnected ? offset() : null;
    for (const block of run) {
      if (block.getAttribute(VISIBILITY_ATTRIBUTE) === "collapsed") block.setAttribute(VISIBILITY_ATTRIBUTE, "hidden");
      if (managed.has(block)) { observe(block); returning.add(block); }
    }
    container.style.removeProperty("padding-top");
    if (before == null || !next) return;
    const moved = offset() - before;
    if (Math.abs(moved) > 0.01 && next.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().top) shiftScroll(moved);
  };
  const expandAll = () => { for (const container of [...collapsedAbove.keys()]) expandAbove(container); };
  const collapseAbove = (container: HTMLElement) => {
    const run = collapsedAbove.get(container) ?? [];
    if (!runIsLeading(container, run)) { expandAbove(container); return; }
    let end = run.length;
    while (end < container.children.length) {
      const child = container.children[end] as HTMLElement;
      if (!farAbove.has(child) || child.getAttribute(VISIBILITY_ATTRIBUTE) !== "hidden") break;
      end += 1;
    }
    const next = container.children[end] as HTMLElement | undefined;
    if (end - run.length < COLLAPSE_BATCH || !next) return;
    // Measured within the answer, which a scroll the layout clamps does not move. The spacer is set before the run
    // leaves layout, so the answer never lays out shorter.
    const offset = () => next.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const before = offset();
    const marginTop = Number.parseFloat(getComputedStyle(next).marginTop) || 0;
    let height = before - marginTop;
    setSpacer(container, height);
    const added = [...container.children].slice(run.length, end) as HTMLElement[];
    for (const block of added) {
      unobserve(block);
      block.setAttribute(VISIBILITY_ATTRIBUTE, "collapsed");
    }
    collapsedAbove.set(container, [...run, ...added]);
    order = null;
    const error = offset() - before;
    if (Math.abs(error) > 0.01) setSpacer(container, height -= error);
  };
  const collapseFrom = (hidden: Iterable<HTMLElement>) => {
    const containers = new Set<HTMLElement>();
    for (const element of hidden) {
      const container = element.parentElement;
      if (container?.classList.contains("incremark") && element !== container.lastElementChild) containers.add(container);
    }
    for (const container of containers) collapseAbove(container);
  };
  const expandNear = () => {
    if (!collapsedAbove.size) return;
    const view = viewport.getBoundingClientRect();
    for (const [container, run] of [...collapsedAbove]) {
      const next = container.children[run.length] as HTMLElement | undefined;
      if (!next || next.getBoundingClientRect().top > view.top - view.height / 2) expandAbove(container);
    }
  };

  // This reads no geometry, so it is what streaming pays.
  const syncMembership = (rows?: Iterable<HTMLElement>) => {
    if (rows) {
      for (const row of rows) syncRow(row);
    } else {
      const present = new Set(thread.querySelectorAll<HTMLElement>(ROW_SELECTOR));
      for (const row of [...rowElements.keys()]) if (!present.has(row)) syncRow(row);
      for (const row of present) syncRow(row);
    }
    for (const [container, run] of [...collapsedAbove]) {
      if (!container.isConnected) collapsedAbove.delete(container);
      else if (!runIsLeading(container, run)) expandAbove(container);
    }
    return managed;
  };

  // Reads every managed rect, then writes every attribute: interleaving the two would force a layout per block.
  // A collapsed run comes back to be measured only when what it was measured against may have changed (a resize, a
  // panel's motion, the fonts): expanding every run when an answer settles moves the page by sub-pixel rounding.
  let refreshExpands = false;
  const measurePass = (expand = true) => {
    if (expand) expandAll();
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
    const expand = refreshExpands;
    refreshExpands = false;
    // Revealing a block relays the ones after it, so anything that moved into
    // the band during this pass needs one more look.
    if (measurePass(expand)) measureFrame = requestAnimationFrame(refresh);
    holdRefreshing();
  };

  const scheduleRefresh = (idle = false, expand = true) => {
    refreshExpands ||= expand;
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

  // null means a change outside any row, so everything is looked at.
  let dirtyRows: Set<HTMLElement> | null = new Set();
  const scheduleSync = (rows: Set<HTMLElement> | null) => {
    if (dirtyRows && rows) for (const row of rows) dirtyRows.add(row);
    else dirtyRows = null;
    if (!fontsReady || activeIds.size || syncFrame != null
      || measureFrame != null || measureIdle != null) return;
    syncFrame = requestAnimationFrame(() => {
      syncFrame = null;
      const rows = dirtyRows;
      dirtyRows = new Set();
      syncMembership(rows ?? undefined);
    });
  };

  const reset = () => {
    activeIds.clear();
    cancelRefresh();
    expandAll();
    for (const element of [...managed]) release(element);
    managed.clear();
    rowElements.clear();
    order = null;
    scheduleRefresh(true);
  };

  const onMotion = (event: Event) => {
    const detail = (event as CustomEvent<PanelGeometryMotionDetail>).detail;
    if (detail.phase === "begin") {
      // A panel gesture freezes virtualization: refresh() writes content-visibility and intrinsic placeholder sizes,
      // which can change thread height on pointer-down.
      cancelRefresh();
      activeIds.set(detail.source, detail.id);
      return;
    }
    if (activeIds.get(detail.source) !== detail.id) return;
    if (detail.phase === "change") return;
    activeIds.delete(detail.source);
    if (!activeIds.size) scheduleRefresh(true);
  };

  // A change inside a block (a streamed word, a formula filling in) leaves a row's blocks as they were, and re-reading
  // them walks every element of the row. One that brings a message's Markdown in or out still counts.
  const withinBlock = (record: MutationRecord) => {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (!target || target.classList.contains("incremark") || !target.closest(".incremark")) return false;
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (node instanceof Element && (node.matches(".chat-markdown") || node.querySelector(".chat-markdown"))) return false;
    }
    return true;
  };
  // A hidden block is not laid out, so nothing measures it: one that changes hidden would keep the height it was hidden
  // at and move the page when shown. It is shown to be measured and observed afresh, so the observer hides it again.
  // One wholly above the viewport changes the height of what is above the reader, and the viewport has no scroll
  // anchoring: the scroll moves with it, so the page does not.
  const remeasure = (blocks: Set<HTMLElement>) => {
    // Every read before any write, then every read after: one by one, each block would lay the answer out again.
    const viewTop = viewport.getBoundingClientRect().top;
    const rects = [...blocks].map((block) => [block, block.getBoundingClientRect()] as const);
    const scrollBefore = viewport.scrollTop;
    const above: Array<[HTMLElement, number]> = [];
    for (const [block, rect] of rects) {
      if (!show(block)) continue;
      if (rect.bottom <= viewTop) above.push([block, rect.height]);
      visibilityObserver.unobserve(block);
      visibilityObserver.observe(block);
    }
    let shift = 0;
    for (const [block, height] of above) shift += block.getBoundingClientRect().height - height;
    // From where the scroll was before any block was shown: one that came back shorter shortened the page, and at its
    // bottom the browser has already clamped the scroll by as much.
    if (Math.abs(shift) > 0.01) {
      const delta = scrollBefore + shift - viewport.scrollTop;
      if (Math.abs(delta) > 0.01) shiftScroll(delta);
    }
    holdRefreshing();
  };
  // A settled answer's fade puts each run of word spans back as the one text node they held: the same text, the same
  // size, so nothing needs re-measuring. Streaming adds spans, which this is not.
  const unwrapsFade = (record: MutationRecord) => record.type === "childList"
    && (record.target as Element).classList?.contains("stream-text")
    && record.removedNodes.length > 0
    && [...record.addedNodes].every((node) => node.nodeType === Node.TEXT_NODE)
    && [...record.removedNodes].every((node) => node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.TEXT_NODE);
  const mutationObserver = new MutationObserver((records) => {
    // A collapse commits a large height change in one go; left to the observers, cached intrinsic sizes stay stale
    // for a frame or more. Only where the observers cannot see it: a shown block's change reaches the size observer,
    // and a toggle the reader makes re-measures through CODE_BLOCK_TOGGLE_EVENT.
    const deliberate = records.some((record) => record.attributeName === "data-folded" && (record.target as HTMLElement).classList.contains("ui-code")
      && record.oldValue !== (record.target as HTMLElement).getAttribute("data-folded")
      && Boolean((record.target as HTMLElement).closest(`[${VISIBILITY_ATTRIBUTE}="hidden"]`)));
    if (deliberate) {
      scheduleRefresh();
      return;
    }
    // An answer's formula queue has drained: what pendingMath kept laid out
    // can be measured and hidden now.
    if (records.some((record) => record.attributeName === "data-settled" && !record.oldValue
      && (record.target as HTMLElement).hasAttribute("data-settled"))) {
      scheduleRefresh(true, false);
    }
    let rows: Set<HTMLElement> | null = new Set();
    let changedHidden: Set<HTMLElement> | null = null;
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const hidden = target?.closest<HTMLElement>(`[${VISIBILITY_ATTRIBUTE}="hidden"]`);
      // The block itself counts: a heading losing the caret's placeholder is a change to its own children.
      if (hidden && managed.has(hidden) && !unwrapsFade(record)) (changedHidden ??= new Set()).add(hidden);
      if (withinBlock(record) || !rows) continue;
      const row = record.target === thread ? null : (record.target as Element).closest?.(ROW_SELECTOR) as HTMLElement | null;
      // Outside any row (a row added or removed): every row syncs. The records after it are still read for changes to
      // hidden blocks.
      if (!row) { rows = null; continue; }
      rows.add(row);
    }
    if (changedHidden && !activeIds.size) remeasure(changedHidden);
    if (rows && !rows.size) return;
    scheduleSync(rows);
  });
  const viewportObserver = new ResizeObserver(() => scheduleRefresh());
  // Backgrounding must not disturb geometry: clearing the intrinsic sizes here would relay out the whole transcript
  // while hidden and move scrollTop. window "blur" is not observed: it fires for devtools and for a second window,
  // where the transcript is still fully visible.
  const onVisibility = () => {
    if (document.visibilityState === "hidden") {
      cancelRefresh();
      // Their end events may never arrive while hidden, and a stuck activeIds entry would gate every future refresh.
      activeIds.clear();
      return;
    }
    scheduleRefresh(true);
  };
  // A scroll can bring hidden blocks into view before the observer, a frame or two behind, shows them. The scroll's
  // own handler runs before that frame is drawn, so it shows whatever hidden block lies in the strip the scroll
  // uncovered: a dozen rect reads in a layout the transcript's own scroll handler brings up to date anyway. Hit
  // testing the strip costs more.
  let order: HTMLElement[] | null = null;
  const ordered = () => {
    if (order) return order;
    order = [];
    for (const child of thread.children) {
      const elements = rowElements.get(child as HTMLElement);
      if (elements) for (const element of elements) if (managed.has(element) && element.getAttribute(VISIBILITY_ATTRIBUTE) !== "collapsed") order.push(element);
    }
    return order;
  };
  let revealedAt = viewport.scrollTop;
  const onScroll = () => {
    const top = viewport.scrollTop;
    const delta = top - revealedAt;
    revealedAt = top;
    if (!delta || !fontsReady || activeIds.size) return;
    if (delta < 0) expandNear();
    const view = viewport.getBoundingClientRect();
    const from = delta > 0 ? Math.max(view.top, view.bottom - delta) : view.top;
    const to = delta > 0 ? view.bottom : Math.min(view.bottom, view.top - delta);
    const list = ordered();
    let low = 0, high = list.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (list[middle]!.getBoundingClientRect().bottom < from) low = middle + 1;
      else high = middle;
    }
    let changed = false;
    for (let index = low; index < list.length; index += 1) {
      const element = list[index]!;
      if (element.getBoundingClientRect().top > to) break;
      changed = show(element) || changed;
    }
    if (changed) holdRefreshing();
  };
  window.addEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
  document.addEventListener("visibilitychange", onVisibility);
  viewport.addEventListener("scroll", onScroll, { passive: true });
  mutationObserver.observe(thread, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["data-settled", "data-folded"],
  });
  viewportObserver.observe(viewport);
  void document.fonts.ready.then(() => {
    fontsReady = true;
    scheduleRefresh(true);
  });

  return {
    reset,
    refreshing: () => refreshing,
    // Transcript tail-follow must distinguish real content growth from the
    // temporary height changes caused by a panel reflow.
    moving: () => activeIds.size > 0,
    refreshNow: () => {
      cancelRefresh();
      refreshExpands = true;
      refresh();
    },
    destroy: () => {
      expandAll();
      window.removeEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
      viewport.removeEventListener("scroll", onScroll);
      mutationObserver.disconnect();
      viewportObserver.disconnect();
      visibilityObserver.disconnect();
      farObserver.disconnect();
      sizeObserver.disconnect();
      cancelRefresh();
        for (const element of managed) clear(element);
      managed.clear();
    },
  };
}
