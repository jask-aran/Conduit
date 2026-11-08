import { createSignal, onCleanup, type Accessor } from "solid-js";

/**
 * createFolds: a strip that gives way by measure, never by a tuned width. It has `steps` folds (the first given up
 * first); while what it holds overflows it takes the next, keeping the width it needed, and gives each back once it is
 * that wide again. over: how much is cut (default: how far it overflows; a header whose parts truncate counts what they
 * cut). content: a change to what it holds measures it again from unfolded (another view's name and modes).
 * Use: `<header ref={folds.ref}>`; folds.count() is how many are taken.
 */
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
    const sizes = new ResizeObserver(() => fit());
    sizes.observe(element);
    let content: MutationObserver | undefined;
    if (options.content) {
      content = new MutationObserver(() => fit(true));
      content.observe(element, { childList: true, subtree: true, characterData: true });
    }
    queueMicrotask(() => fit(true));
    onCleanup(() => { sizes.disconnect(); content?.disconnect(); });
  };
  return { ref, count };
}
