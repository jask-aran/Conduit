import { createSignal, onCleanup, type Accessor } from "solid-js";

/*
 * Fold, don't squeeze (DESIGN.md, Interaction): a row's controls keep their size, and what does not fit folds, by
 * measure, never at a tuned width. Every row that folds measures through these.
 */

/** What changes a row's fit: its size, and with parts each child's (re-observed as they come and go); content: what it
 *  holds changing (attributes: those attributes too), measured with `content`, else `fit`. Measured where the observer
 *  delivers, after layout, where its reads are free: deferred to the next frame they come after that frame's writes (a
 *  dock easing open sets every pane's width) and lay the page out once per row per frame. */
export function watchFit(row: HTMLElement, fit: () => void, options: { parts?: boolean; content?: () => void; attributes?: string[] } = {}) {
  const sizes = new ResizeObserver(() => fit());
  const observe = () => { sizes.disconnect(); sizes.observe(row); if (options.parts) for (const part of row.children) sizes.observe(part); };
  observe();
  const content = options.content ?? (options.parts ? observe : undefined);
  const changes = content && new MutationObserver(() => { if (options.parts) observe(); if (options.content) options.content(); });
  changes?.observe(row, options.content
    ? { childList: true, subtree: true, characterData: true, ...(options.attributes ? { attributes: true, attributeFilter: options.attributes } : {}) }
    : { childList: true });
  onCleanup(() => { sizes.disconnect(); changes?.disconnect(); });
}

/** How many parts stay, of `widths` (each with its gap, in the order they stay) in `room`; `more`: the room of the ⋯
 *  holding the rest, taken once any goes. The first part that does not fit takes every one after it. */
export function keptParts(room: number, widths: readonly number[], more = 0) {
  if (widths.reduce((sum, width) => sum + width, 0) <= room) return widths.length;
  let left = room - more;
  let count = 0;
  while (count < widths.length && widths[count]! <= left) left -= widths[count++]!;
  return count;
}

/** A row of parts that fold, last first, into a ⋯ (`more`): its parts are [data-fold], the ⋯ [data-fold-more] (taking
 *  its room only once something folds, or always with data-fold-keep), the rest stay. A folded part stays laid out,
 *  hidden, so its width is known when room comes back. setKept: how many still show; phone: none fold. Call from onMount. */
export function foldRow(more: HTMLElement, setKept: (count: number) => void, phone?: () => boolean) {
  const row = more.parentElement;
  if (!row) return;
  watchFit(row, () => {
    if (phone?.()) return setKept(Infinity);
    const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
    const parts = [...row.children] as HTMLElement[];
    const keep = more.hasAttribute("data-fold-keep");
    const fixed = parts.filter((part) => !part.matches("[data-fold], [data-fold-more]")).reduce((sum, part) => sum + part.offsetWidth + gap, 0) + (keep ? more.offsetWidth + gap : 0);
    setKept(keptParts(row.clientWidth + gap + .5 - fixed, parts.filter((part) => part.hasAttribute("data-fold")).map((part) => part.offsetWidth + gap), keep ? 0 : more.offsetWidth + gap));
  }, { parts: true });
}

/** A strip that gives way by measure, never a tuned width: while it overflows (or `over` says how much is cut) it takes
 *  its next of `steps` folds, keeping the width it needed, and gives each back once that wide again; content: a change
 *  to what it holds measures it again unfolded. `ref` it; count() is how many are taken. */
export function createFolds(steps: number, options: { over?: (element: HTMLElement) => number; content?: boolean } = {}): {
  ref: (element: HTMLElement) => void;
  count: Accessor<number>;
} {
  const [count, setCount] = createSignal(0);
  const ref = (element: HTMLElement) => {
    const needs: number[] = [];
    const over = () => options.over?.(element) ?? element.scrollWidth - element.clientWidth;
    const fit = (fresh = false) => {
      if (!element.clientWidth) return;
      if (fresh) setCount(0);
      while (count() && element.clientWidth >= needs[count() - 1]!) setCount(count() - 1);
      for (let cut = over(); cut > 0.5 && count() < steps; cut = over()) {
        needs[count()] = element.clientWidth + cut;
        setCount(count() + 1);
      }
    };
    watchFit(element, fit, { content: options.content ? () => fit(true) : undefined });
    queueMicrotask(() => fit(true));
  };
  return { ref, count };
}
