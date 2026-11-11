import { createSignal, onCleanup, type Accessor } from "solid-js";

/* A row's controls keep their size, and what does not fit folds, by measure, never at a tuned width. */

/** Measured where the observer delivers, after layout, where its reads are free: deferred to the next frame they come
 *  after that frame's writes and lay the page out once per row per frame. */
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

export function keptParts(room: number, widths: readonly number[], more = 0) {
  if (widths.reduce((sum, width) => sum + width, 0) <= room) return widths.length;
  let left = room - more;
  let count = 0;
  while (count < widths.length && widths[count]! <= left) left -= widths[count++]!;
  return count;
}

/** A folded part stays laid out, hidden, so its width is known when room comes back. */
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
