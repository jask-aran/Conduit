import { createSignal, onCleanup, type Accessor } from "solid-js";

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
