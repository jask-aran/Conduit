import { createEffect, createSignal, on } from "solid-js";
import "./reveal.css";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const GENTLE = "cubic-bezier(.2, .8, .2, 1)";
const QUICK = "cubic-bezier(.4, 0, 1, 1)";

/**
 * A row the reader opens or closes -- a trace, a tool call -- unfolds its body
 * in height rather than appearing in one frame. This is the second exception
 * to "transform and opacity only" in DESIGN.md: pushing what is below is what
 * the reader asked for.
 *
 * `mounted` stays true while the body folds away, so there is something left
 * to fold; the body takes `ref`. Turned around part-way, it goes back from the
 * height it had reached. Reduced motion opens and closes at once.
 */
export function createReveal(open: () => boolean) {
  const [mounted, setMounted] = createSignal(open());
  let body: HTMLElement | undefined;
  let running: Animation | undefined;

  const settle = (node: HTMLElement) => { node.style.overflow = ""; running = undefined; };
  createEffect(on(open, (isOpen) => {
    if (isOpen) setMounted(true);
    // The body is drawn after this effect, so measure once it is there.
    queueMicrotask(() => {
      const node = body;
      if (!node || !node.isConnected || reduced() || typeof node.animate !== "function") {
        if (!isOpen) setMounted(false);
        return;
      }
      const from = running ? node.getBoundingClientRect().height : isOpen ? 0 : node.getBoundingClientRect().height;
      running?.cancel();
      node.style.overflow = "hidden";
      if (isOpen) {
        const to = node.getBoundingClientRect().height;
        const animation = node.animate([
          { height: `${from}px`, opacity: from ? 1 : 0 },
          { opacity: 1, offset: 0.6 },
          { height: `${to}px`, opacity: 1 },
        ], { duration: 200, easing: GENTLE });
        running = animation;
        animation.finished.then(() => settle(node), () => {});
      } else {
        const animation = node.animate([{ height: `${from}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: 200, easing: QUICK, fill: "forwards" });
        running = animation;
        animation.finished.then(() => { settle(node); if (!open()) setMounted(false); }, () => {});
      }
    });
  }, { defer: true }));

  return { mounted, ref: (node: HTMLElement) => { body = node; } };
}
