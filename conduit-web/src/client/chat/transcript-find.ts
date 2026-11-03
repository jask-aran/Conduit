import { batch, createSignal, onCleanup } from "solid-js";

/*
 * Find in chat (docs/plans/keyboard-model.md, gap 6): the pane's own find, in place of the browser's.
 *
 * What it searches is the thread's text as drawn. The transcript's virtualization is content-visibility, not
 * unmounting (transcript-visibility.ts): a block far from the screen is skipped by layout and paint, or taken out of
 * layout, but its text nodes stay in the DOM, so every loaded message is searchable and a hit is exactly what gets
 * highlighted -- the message data would count Markdown's syntax and miss what a renderer adds. Earlier messages not
 * yet loaded, and a closed trace's steps (not rendered until opened), are not searched.
 *
 * Matches are painted with the CSS Custom Highlight API (no DOM is touched; ::highlight rules in styles/find.css),
 * one registry entry for every pane's matches so two panes can each have a find open.
 */

/** A row of the thread (TranscriptRow): what a match belongs to, and what is scrolled to while its text is hidden. */
const ROW = '[data-slot="message-scroller-item"]';
/* Not text the reader reads: controls and their labels, times, icons, KaTeX's MathML twin, a skeleton. Rejected as
   elements, so the walk never enters them. */
const SKIP = "button, time, svg, script, style, textarea, input, .katex-mathml, .markdown-skeleton, .ui-message-foot";
const MAX_MATCHES = 2000;

export type FindMatch = { range: Range; row: HTMLElement };

/** Every match of `query` (case-insensitive) in the thread's rows, in reading order. A match never spans two rows. */
export function findMatches(thread: HTMLElement, query: string): FindMatch[] {
  const needle = query.toLowerCase();
  if (!needle) return [];
  const matches: FindMatch[] = [];
  for (const row of thread.querySelectorAll<HTMLElement>(`:scope > ${ROW}`)) {
    const nodes: Text[] = [], starts: number[] = [];
    let text = "";
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => node.nodeType === Node.TEXT_NODE ? NodeFilter.FILTER_ACCEPT
        : (node as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP,
    });
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const value = (node as Text).data;
      if (!value) continue;
      nodes.push(node as Text);
      starts.push(text.length);
      text += value;
    }
    if (!nodes.length) continue;
    const haystack = text.toLowerCase();
    // toLowerCase keeps lengths for everything but a few letters (İ); offsets that drift would point past a node.
    if (haystack.length !== text.length) continue;
    // The node holding offset `at`, by binary search over the nodes' starts.
    const nodeAt = (at: number, end: boolean) => {
      let low = 0, high = nodes.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (starts[middle]! < at || (!end && starts[middle] === at)) low = middle; else high = middle - 1;
      }
      return low;
    };
    for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + needle.length)) {
      const first = nodeAt(at, false), last = nodeAt(at + needle.length, true);
      const range = document.createRange();
      range.setStart(nodes[first]!, at - starts[first]!);
      range.setEnd(nodes[last]!, at + needle.length - starts[last]!);
      matches.push({ range, row });
      if (matches.length >= MAX_MATCHES) return matches;
    }
  }
  return matches;
}

/* The highlight registry is the document's, so the panes share two entries: every match, and each pane's current. */
const ALL = "conduit-find", CURRENT = "conduit-find-current";
const painted = new Map<symbol, { all: Range[]; current: Range | null }>();
const highlights = () => typeof CSS !== "undefined" && "highlights" in CSS && typeof Highlight !== "undefined";
function repaint() {
  if (!highlights()) return;
  const all: Range[] = [], current: Range[] = [];
  for (const entry of painted.values()) { all.push(...entry.all); if (entry.current) current.push(entry.current); }
  if (all.length) CSS.highlights.set(ALL, new Highlight(...all)); else CSS.highlights.delete(ALL);
  if (current.length) CSS.highlights.set(CURRENT, new Highlight(...current)); else CSS.highlights.delete(CURRENT);
}

/* Which transcript a viewport belongs to, so the app's Find command opens the find of the pane with the keyboard. */
const finders = new WeakMap<HTMLElement, () => void>();
/** Opens the find bar of the transcript whose viewport this is; false when it has none. */
export function openTranscriptFind(viewport: HTMLElement | null | undefined) {
  const open = viewport ? finders.get(viewport) : undefined;
  open?.();
  return Boolean(open);
}
export const hasTranscriptFind = (viewport: HTMLElement | null | undefined) => Boolean(viewport && finders.has(viewport));

/**
 * One transcript's find: the bar's state (open, query, the count), moving between matches, and the highlights.
 * reveal: brings a match on screen as the reader's own scroll (the transcript owns its scrolling and the tail).
 */
export function createTranscriptFind(options: { viewport: () => HTMLElement; thread: () => HTMLElement; reveal: (match: FindMatch) => void }) {
  const owner = Symbol("find");
  const [open, setOpen] = createSignal(false);
  const [query, setQueryValue] = createSignal("");
  const [total, setTotal] = createSignal(0);
  const [index, setIndex] = createSignal(-1);
  let matches: FindMatch[] = [];
  // Where focus was when the bar opened, given back when it closes.
  let returnFocus: HTMLElement | null = null;
  let input: HTMLInputElement | undefined;
  let searchTimer: number | null = null;
  let observer: MutationObserver | null = null;

  const paint = () => {
    const current = matches[index()]?.range ?? null;
    if (matches.length) painted.set(owner, { all: matches.map((match) => match.range), current }); else painted.delete(owner);
    repaint();
  };
  // The first match from the top of what is on screen down, so a search starts where the reader is.
  const nearest = () => {
    const top = options.viewport().getBoundingClientRect().top;
    const below = matches.findIndex((match) => match.row.getBoundingClientRect().bottom > top);
    return below < 0 ? matches.length - 1 : below;
  };
  const go = (next: number, reveal = true) => {
    setIndex(next);
    paint();
    if (reveal && matches[next]) options.reveal(matches[next]!);
  };
  /** Searches again. keep: the thread changed under an open find (a stream, a trace opening): stay at the same place. */
  const search = (keep = false) => {
    if (searchTimer != null) { clearTimeout(searchTimer); searchTimer = null; }
    const previous = matches[index()];
    matches = findMatches(options.thread(), query());
    setTotal(matches.length);
    if (!matches.length) return go(-1, false);
    if (!keep || !previous) return go(nearest());
    // The same row's first match at or after the old one's start, else where the old index falls.
    const same = matches.findIndex((match) => match.row === previous.row && match.range.compareBoundaryPoints(Range.START_TO_START, previous.range) >= 0);
    go(same >= 0 ? same : Math.min(index(), matches.length - 1), false);
  };
  let pendingKeep = false;
  const searchSoon = (keep: boolean, ms: number) => {
    if (searchTimer != null) clearTimeout(searchTimer);
    pendingKeep = keep;
    searchTimer = window.setTimeout(() => search(keep), ms);
  };
  // A search still waiting runs now; true when it was a new query's, which has already gone to its first match.
  const flush = () => {
    if (searchTimer == null) return false;
    search(pendingKeep);
    return !pendingKeep;
  };
  const watch = () => {
    if (observer) return;
    observer = new MutationObserver(() => { if (query()) searchSoon(true, 300); });
    observer.observe(options.thread(), { subtree: true, childList: true, characterData: true });
  };
  const unwatch = () => { observer?.disconnect(); observer = null; };

  const controller = {
    open,
    query,
    /** "3 of 12", or nothing to say before a query. */
    count: () => !query() ? undefined : total() ? `${index() + 1} of ${total()}` : "No results",
    setInput: (element: HTMLInputElement) => { input = element; },
    /** Opens the bar, or takes the caret back to it, its query selected to type over. */
    show() {
      const active = document.activeElement;
      if (!open()) {
        returnFocus = active instanceof HTMLElement && active !== document.body ? active : null;
        setOpen(true);
        watch();
        if (query()) search();
      }
      requestAnimationFrame(() => { input?.focus({ preventScroll: true }); input?.select(); });
    },
    setQuery(value: string) {
      setQueryValue(value);
      // Each keystroke would walk the thread: wait for a pause, short enough to read as live.
      if (!value) { searchSoon(false, 0); return; }
      searchSoon(false, 120);
    },
    next: () => { if (!flush() && matches.length) go((index() + 1) % matches.length); },
    previous: () => { if (!flush() && matches.length) go((index() - 1 + matches.length) % matches.length); },
    /** The Escape ladder: a query clears first, then the bar closes and focus goes back where it was. */
    escape() {
      if (query()) { controller.setQuery(""); return; }
      controller.close();
    },
    close() {
      if (searchTimer != null) { clearTimeout(searchTimer); searchTimer = null; }
      unwatch();
      matches = [];
      batch(() => { setOpen(false); setTotal(0); setIndex(-1); });
      paint();
      const back = returnFocus?.isConnected ? returnFocus : null;
      returnFocus = null;
      (back ?? options.viewport()).focus({ preventScroll: true });
    },
    /** Registers this find as the viewport's, for the app's Find command. */
    register(viewport: HTMLElement) {
      finders.set(viewport, controller.show);
      onCleanup(() => {
        finders.delete(viewport);
        unwatch();
        if (searchTimer != null) clearTimeout(searchTimer);
        painted.delete(owner);
        repaint();
      });
    },
  };
  return controller;
}
