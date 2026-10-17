import {
  PANEL_GEOMETRY_MOTION_EVENT,
  type PanelGeometryMotionDetail,
  type PanelGeometryMotionSource,
} from "../panel-motion";

const VISIBILITY_ATTRIBUTE = "data-transcript-visibility";
const INTRINSIC_SIZE_PROPERTY = "contain-intrinsic-block-size";
const INTRINSIC_INLINE_SIZE_PROPERTY = "contain-intrinsic-inline-size";
const OVERSCAN_PX = 120;

// A placeholder (contain-intrinsic-size) is the size of the content box: the browser adds the padding and borders
// to it. Sizes read from a rect are border boxes, so both come off; a placeholder that kept the padding was that much
// too tall, and the page moved by it when the block was shown. A block's insets do not change as it resizes, and
// reading them is a getComputedStyle per block: at settlement every block of a long answer is observed at once, and
// those reads were a third of that frame.
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

// An observer's entry has the content box itself.
function blockSize(entry: ResizeObserverEntry) {
  const content = entry.contentBoxSize?.[0]?.blockSize;
  return content ?? intrinsicBlockSize(entry.target as HTMLElement, entry.target.getBoundingClientRect().height);
}

function inlineSize(entry: ResizeObserverEntry) {
  const content = entry.contentBoxSize?.[0]?.inlineSize;
  return content ?? intrinsicInlineSize(entry.target as HTMLElement, entry.target.getBoundingClientRect().width);
}

const ROW_SELECTOR = '[data-slot="message-scroller-item"]';

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
  /** Moves the scroll by this much as the transcript's own scroll: the viewport has no scroll anchoring. */
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
  // Only a shown element is size-observed: a hidden one's size is contained, so it cannot change, and every
  // observation costs the browser a check each frame -- a long answer's hundreds of blocks, every frame it grew.
  // Observed again as it is shown, its first notification is its size then.
  const show = (element: HTMLElement) => {
    const state = element.getAttribute(VISIBILITY_ATTRIBUTE);
    // A collapsed block comes back only with its whole run (expandAbove).
    if (state == null || state === "collapsed") return false;
    element.removeAttribute(VISIBILITY_ATTRIBUTE);
    if (managed.has(element)) sizeObserver.observe(element);
    return true;
  };
  // A formula still waiting in the render queue is an empty box shorter than
  // the formula. Hidden, it would render unseen and its placeholder would keep
  // the empty box's height: on load the transcript came up 24px short per
  // formula, and every later show or hide moved the text by the difference.
  // It stays laid out until the queue drains; the pass after that hides it.
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
    // Every read before any write: a size written between two reads
    // made the second getComputedStyle recalculate style, once per block --
    // at settlement, once per block of the whole answer.
    const sizes = entries
      .filter((entry) => (entry.target as HTMLElement).getAttribute(VISIBILITY_ATTRIBUTE) !== "hidden")
      .map((entry) => [entry.target as HTMLElement, blockSize(entry), inlineSize(entry)] as const);
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

  // The blocks each row hands to the observers, so a streamed frame touches
  // only the row it changed.
  const rowElements = new Map<HTMLElement, HTMLElement[]>();

  // Which of a row's elements are virtualized: every top-level block, a
  // streaming answer's included. Display math once kept its whole message laid
  // out until it settled, over a worry that hiding blocks changed the root's
  // inline size and shifted centred equations; the message column no longer
  // sizes to its content, and keeping every formula written so far laid out
  // and painted is what made a long mathematical answer's frames grow with it.
  const elementsOf = (row: HTMLElement) => {
    const blocks = [...row.querySelectorAll<HTMLElement>(".chat-markdown > .incremark > *")];
    if (!blocks.length) return [row];
    show(row);
    return blocks;
  };

  const release = (element: HTMLElement) => {
    if (element.getAttribute(VISIBILITY_ATTRIBUTE) === "collapsed" && element.parentElement) expandAbove(element.parentElement);
    visibilityObserver.unobserve(element);
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
      visibilityObserver.observe(element);
    }
    if (next.length) rowElements.set(row, next);
    else rowElements.delete(row);
  };

  // A hidden block is still in layout: every frame the browser lays out, pre-paints and checks each one, so a long
  // answer's hundreds of them cost most of a late frame's growth (layout 0.34 to 0.62ms, pre-paint 0.14 to 0.29,
  // the paint phase's bookkeeping 0.12 to 0.43). A run of COLLAPSE_BATCH or more hidden blocks wholly a viewport or
  // more above the reader leaves layout (display: none), its height kept by one box before the first block left
  // (the container's ::before). It is measured, and corrected by what the first block left moved, so nothing moves.
  // The run comes back as hidden blocks -- their placeholders as they were -- once the reader is within half a
  // viewport of it, with the scroll moved by anything that changed while it was out.
  const COLLAPSE_BATCH = 16;
  const collapsedAbove = new Map<HTMLElement, HTMLElement[]>();
  const runIsLeading = (container: HTMLElement, run: HTMLElement[]) => run.every((block, index) => container.children[index] === block);
  const setSpacer = (container: HTMLElement, height: number) => {
    container.style.setProperty("--collapsed-above", `${Math.max(0, height)}px`);
    container.setAttribute("data-collapsed-above", "");
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
      if (managed.has(block)) visibilityObserver.observe(block);
    }
    container.removeAttribute("data-collapsed-above");
    container.style.removeProperty("--collapsed-above");
    if (before == null || !next) return;
    const moved = offset() - before;
    if (Math.abs(moved) > 0.01 && next.getBoundingClientRect().bottom <= viewport.getBoundingClientRect().top) shiftScroll(moved);
  };
  const expandAll = () => { for (const container of [...collapsedAbove.keys()]) expandAbove(container); };
  const collapseAbove = (container: HTMLElement) => {
    const run = collapsedAbove.get(container) ?? [];
    if (!runIsLeading(container, run)) { expandAbove(container); return; }
    const view = viewport.getBoundingClientRect();
    const limit = view.top - view.height;
    let end = run.length;
    while (end < container.children.length) {
      const child = container.children[end] as HTMLElement;
      if (!managed.has(child) || child.getAttribute(VISIBILITY_ATTRIBUTE) !== "hidden" || child.getBoundingClientRect().bottom > limit) break;
      end += 1;
    }
    const next = container.children[end] as HTMLElement | undefined;
    if (end - run.length < COLLAPSE_BATCH || !next) return;
    // Where the first block left sits in its answer, which a scroll the layout clamps does not move. The spacer is set
    // before the run leaves layout, so the answer never lays out shorter.
    const offset = () => next.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const before = offset();
    const marginTop = Number.parseFloat(getComputedStyle(next).marginTop) || 0;
    let height = before - marginTop;
    setSpacer(container, height);
    const added = [...container.children].slice(run.length, end) as HTMLElement[];
    for (const block of added) {
      visibilityObserver.unobserve(block);
      block.setAttribute(VISIBILITY_ATTRIBUTE, "collapsed");
    }
    collapsedAbove.set(container, [...run, ...added]);
    order = null;
    const error = offset() - before;
    if (Math.abs(error) > 0.01) setSpacer(container, height -= error);
  };
  // After the observer hides blocks: the answers whose runs may have grown long enough to collapse.
  const collapseFrom = (hidden: Iterable<HTMLElement>) => {
    const containers = new Set<HTMLElement>();
    for (const element of hidden) {
      const container = element.parentElement;
      if (container?.classList.contains("incremark") && element !== container.lastElementChild) containers.add(container);
    }
    for (const container of containers) collapseAbove(container);
  };
  // Scrolling up: any run the reader is within half a viewport of comes back.
  const expandNear = () => {
    if (!collapsedAbove.size) return;
    const view = viewport.getBoundingClientRect();
    for (const [container, run] of [...collapsedAbove]) {
      const next = container.children[run.length] as HTMLElement | undefined;
      if (!next || next.getBoundingClientRect().top > view.top - view.height / 2) expandAbove(container);
    }
  };

  // Reconcile the managed set with the DOM. This reads no geometry, so it is
  // what streaming pays: new blocks start observed and fully rendered, and the
  // observers take it from there. Given rows, only those are looked at.
  const syncMembership = (rows?: Iterable<HTMLElement>) => {
    if (rows) {
      for (const row of rows) syncRow(row);
    } else {
      const present = new Set(thread.querySelectorAll<HTMLElement>(ROW_SELECTOR));
      for (const row of [...rowElements.keys()]) if (!present.has(row)) syncRow(row);
      for (const row of present) syncRow(row);
    }
    // A run whose answer went, or whose blocks are no longer its answer's first, is let go or comes back.
    for (const [container, run] of [...collapsedAbove]) {
      if (!container.isConnected) collapsedAbove.delete(container);
      else if (!runIsLeading(container, run)) expandAbove(container);
    }
    return managed;
  };

  // Reads every managed rect, then writes every attribute. Interleaving the two
  // would force a layout per block; the transcript is long enough for that to
  // be the difference between a frame and a stall.
  const measurePass = () => {
    expandAll();
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

  // Rows changed since the last sync; null means a change outside any row, so
  // everything is looked at.
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
      // A panel gesture freezes virtualization; it does not reconcile it.
      // refresh() writes content-visibility and intrinsic placeholder sizes,
      // which can change thread height on pointer-down. Keep the current
      // membership and measurements until the single idle pass after motion.
      cancelRefresh();
      activeIds.set(detail.source, detail.id);
      return;
    }
    if (activeIds.get(detail.source) !== detail.id) return;
    if (detail.phase === "change") return;
    activeIds.delete(detail.source);
    if (!activeIds.size) scheduleRefresh(true);
  };

  // A change inside a block -- a streamed word, a formula filling in -- leaves a row's blocks as they were. Each one
  // re-read them, and the selector walked every element of the row to find them: 6,000 word spans late in a long
  // answer, every frame. One that brings a message's Markdown in or out still counts.
  const withinBlock = (record: MutationRecord) => {
    const target = record.target instanceof Element ? record.target : record.target.parentElement;
    if (!target || target.classList.contains("incremark") || !target.closest(".incremark")) return false;
    for (const node of [...record.addedNodes, ...record.removedNodes]) {
      if (node instanceof Element && (node.matches(".chat-markdown") || node.querySelector(".chat-markdown"))) return false;
    }
    return true;
  };
  // A hidden block is not laid out, so nothing measures it: one that changes hidden -- the tail of an answer still
  // streaming while the reader is above it, a formula drawing, a turn's header settling -- kept the height it was hidden at (a line, where
  // the block came to several hundred pixels) and moved the page when it was shown. It is shown to be measured, and
  // observed afresh, so the observer hides it again with its new size if it is still out of view.
  // One wholly above the viewport changes the height of what is above the reader, and the viewport has no scroll
  // anchoring: the scroll moves with it, so the page does not.
  const remeasure = (blocks: Set<HTMLElement>) => {
    // Every read before any write, then every read after: read and shown one by one, each block laid the answer out
    // again -- at settlement, when the fade's word spans leave every hidden block, a layout per block (150ms).
    const viewTop = viewport.getBoundingClientRect().top;
    const rects = [...blocks].map((block) => [block, block.getBoundingClientRect()] as const);
    const above: Array<[HTMLElement, number]> = [];
    for (const [block, rect] of rects) {
      if (!show(block)) continue;
      if (rect.bottom <= viewTop) above.push([block, rect.height]);
      visibilityObserver.unobserve(block);
      visibilityObserver.observe(block);
    }
    let shift = 0;
    for (const [block, height] of above) shift += block.getBoundingClientRect().height - height;
    if (Math.abs(shift) > 0.01) shiftScroll(shift);
    holdRefreshing();
  };
  const mutationObserver = new MutationObserver((records) => {
    // A collapse commits a large height change in one go. Leaving it to the
    // observers left every cached intrinsic size stale for a frame or more,
    // which showed as empty placeholders where the text should be.
    // Only where the observers cannot see it: a shown block's change reaches
    // the size observer, and a toggle the reader makes re-measures through
    // CODE_BLOCK_TOGGLE_EVENT. Rewrites to the same value, and a user
    // message's first fold verdict as history loads, ran this full pass
    // repeatedly through a scroll up (docs/design/performance-pass.md, 10).
    const deliberate = records.some((record) => record.attributeName === "data-collapsed"
      && record.oldValue !== (record.target as HTMLElement).getAttribute("data-collapsed")
      && Boolean((record.target as HTMLElement).closest(`[${VISIBILITY_ATTRIBUTE}="hidden"]`)));
    if (deliberate) {
      scheduleRefresh();
      return;
    }
    // An answer's formula queue has drained: what pendingMath kept laid out
    // can be measured and hidden now.
    if (records.some((record) => record.attributeName === "data-settled" && !record.oldValue
      && (record.target as HTMLElement).hasAttribute("data-settled"))) {
      scheduleRefresh(true);
    }
    let rows: Set<HTMLElement> | null = new Set();
    let changedHidden: Set<HTMLElement> | null = null;
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      const hidden = target?.closest<HTMLElement>(`[${VISIBILITY_ATTRIBUTE}="hidden"]`);
      if (hidden && hidden !== target && managed.has(hidden)) (changedHidden ??= new Set()).add(hidden);
      if (withinBlock(record)) continue;
      const row = record.target === thread ? null : (record.target as Element).closest?.(ROW_SELECTOR) as HTMLElement | null;
      if (!row) { rows = null; break; }
      rows.add(row);
    }
    if (changedHidden && !activeIds.size) remeasure(changedHidden);
    if (rows && !rows.size) return;
    scheduleSync(rows);
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
        // Abandon in-flight panel motions: their end events may never arrive
      // while hidden, and a stuck activeIds entry would gate every future
      // refresh. Dropping the tracking costs nothing -- the geometry stays.
      activeIds.clear();
        return;
    }
    scheduleRefresh(true);
  };
  // After a scroll, repair any intersection the observer missed (upward
  // scrolls were seen to leave a block hidden in view) by observing every
  // managed block afresh: an observer reports each new target's current state,
  // computed in the frame's own intersection step. This was a measurePass --
  // every block's rect read, repeated each frame a block was revealed -- which
  // on a long transcript put 20-odd frames over budget in one scroll
  // (docs/design/performance-pass.md, 10).
  const reobserve = () => {
    repairTimer = null;
    if (!fontsReady || activeIds.size) return;
    for (const element of managed) {
      if (element.getAttribute(VISIBILITY_ATTRIBUTE) === "collapsed") continue;
      visibilityObserver.unobserve(element);
      visibilityObserver.observe(element);
    }
  };
  // A scroll the reader made is repaired as it ends. The tail follow's are not, one by one: it sets the scroll every
  // frame an answer grows, each set ends a scroll, and every block of the transcript was observed afresh each frame --
  // a long answer's intersections all recomputed, every frame. Those are repaired once they stop.
  let repairTimer: number | null = null;
  let readerScrolled = false;
  const onReaderInput = () => { readerScrolled = true; };
  const onScrollEnd = () => {
    if (repairTimer != null) clearTimeout(repairTimer);
    repairTimer = null;
    if (readerScrolled) {
      readerScrolled = false;
      reobserve();
      return;
    }
    repairTimer = window.setTimeout(reobserve, 200);
  };
  const READER_INPUT = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
  // A scroll could bring hidden blocks into view before the observer, a frame or two behind, showed them -- a wheel's
  // notch, a jump, the glide to the latest message: a frame with a hole in the page. The scroll's own handler runs
  // before that frame is drawn, so it shows whatever hidden block lies in the strip the scroll uncovered (the whole
  // viewport after a jump). The managed elements in document order are searched for the strip's first, then walked
  // to its end: a dozen rect reads in a layout the transcript's own scroll handler brings up to date anyway. (Hit
  // testing the strip instead cost 0.8ms a frame on a long answer, every frame the tail follow scrolled.)
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
  viewport.addEventListener("scrollend", onScrollEnd);
  viewport.addEventListener("scroll", onScroll, { passive: true });
  for (const type of READER_INPUT) window.addEventListener(type, onReaderInput, { capture: true, passive: true });
  mutationObserver.observe(thread, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeOldValue: true,
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
    // Transcript tail-follow must distinguish real content growth from the
    // temporary height changes caused by a panel reflow.
    moving: () => activeIds.size > 0,
    /** Re-measure now, discarding anything already queued. */
    refreshNow: () => {
      cancelRefresh();
      refresh();
    },
    destroy: () => {
      expandAll();
      window.removeEventListener(PANEL_GEOMETRY_MOTION_EVENT, onMotion);
      document.removeEventListener("visibilitychange", onVisibility);
      viewport.removeEventListener("scrollend", onScrollEnd);
      viewport.removeEventListener("scroll", onScroll);
      for (const type of READER_INPUT) window.removeEventListener(type, onReaderInput, { capture: true });
      if (repairTimer != null) clearTimeout(repairTimer);
      mutationObserver.disconnect();
      viewportObserver.disconnect();
      visibilityObserver.disconnect();
      sizeObserver.disconnect();
      cancelRefresh();
        for (const element of managed) clear(element);
      managed.clear();
    },
  };
}
