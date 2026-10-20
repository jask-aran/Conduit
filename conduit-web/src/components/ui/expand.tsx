import { createComputed, createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js";
import { cssTime } from "./shared";

/**
 * What opens and shuts in place under the row that owns it -- a folder's rows, a group's -- sliding on its
 * measured height over --duration-fold, on --ease-fold. Shut, nothing is in the document; open, the rows are, at
 * their natural height. Shutting, they stay drawn for the slide: Expand keeps its own children until it ends, and
 * when the caller drops its rows at once (a list rebuilt from what is open), the slide runs over a still of them,
 * taken before they went (inert, out of the accessibility tree, without ids). Only this element animates: a grid
 * track resolved per frame for a whole list stuttered on a phone.
 */
export function Expand(props: { open: boolean; class?: string; children: JSX.Element }) {
  const [shown, setShown] = createSignal(props.open);
  let box: HTMLDivElement | undefined;
  let motion: Animation | undefined;
  let still: HTMLElement | undefined;
  let taken: HTMLElement | undefined;
  let takenHeight = 0;
  // One toggle can write the open state more than once (the click, then the preference coming back); acting on
  // each would cancel the slide begun. Only a change from the state the rows are in moves them.
  let was = props.open;
  const settle = () => {
    motion?.cancel(); motion = undefined;
    still?.remove(); still = undefined;
  };
  // A computation runs before the document is updated: the rows are still there to copy.
  createComputed(on(() => props.open, (open) => {
    taken = !open && was && box ? box.cloneNode(true) as HTMLElement : undefined;
    takenHeight = taken ? (still ?? box!).getBoundingClientRect().height : 0;
  }, { defer: true }));
  createEffect(() => {
    const wanted = props.open;
    if (was === wanted) return;
    was = wanted;
    const from = still ?? box;
    // Shutting, the height is the one the rows had before the update that may have taken them.
    const height = !wanted && takenHeight ? takenHeight : from ? from.getBoundingClientRect().height : 0;
    settle();
    if (wanted) setShown(true);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { if (!wanted) setShown(false); return; }
    const slide = (node: HTMLElement, frames: Keyframe[], done: () => void) => {
      motion = node.animate(frames, { duration: cssTime(node, "--duration-fold", 240), easing: getComputedStyle(node).getPropertyValue("--ease-fold") || "ease", fill: "both" });
      // Dropping the fill hands the height back to the rows, so one added while open is not cut to a stale number.
      motion.onfinish = () => { settle(); done(); };
    };
    if (wanted) {
      // Once the rows are in the document at their natural height, and before it is painted: a frame later, they
      // showed whole for a frame before the slide began. Reopened while shutting, it goes on from the height reached.
      queueMicrotask(() => {
        if (!box || props.open !== wanted) return;
        slide(box, [{ height: `${height}px` }, { height: `${box.scrollHeight}px` }], () => {});
      });
      return;
    }
    if (!box) return setShown(false);
    if (box.childElementCount === 0 && taken) {
      still = taken; taken = undefined;
      still.inert = true;
      still.setAttribute("aria-hidden", "true");
      still.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      box.after(still);
    }
    slide(still ?? box, [{ height: `${height}px` }, { height: "0px" }], () => { if (!props.open) setShown(false); });
  });
  onCleanup(settle);
  return <Show when={shown()}><div ref={box} class={props.class ? `ui-expand ${props.class}` : "ui-expand"}>{props.children}</div></Show>;
}
