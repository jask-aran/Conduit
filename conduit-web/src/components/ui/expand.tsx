import { createComputed, createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js";
import { haptic } from "./haptics";
import { cssTime } from "./shared";

/**
 * What opens and shuts in place under the row that owns it -- a folder's rows, a group's -- over --duration-fold, on
 * --ease-fold. Shut, nothing is in the document; open, the rows are, at their natural height. The page is laid out
 * once, at the move's start (opening) or its end (shutting); between, nothing is laid out or repainted: what follows
 * it in its scroller slides on a transform, and its rows are revealed by a clip whose edge runs with them. Shutting,
 * the rows stay drawn for the slide: Expand keeps its own children until it ends, and when the caller drops its rows
 * at once (a list rebuilt from what is open), the slide runs over a still of them, taken before they went (inert,
 * out of the accessibility tree, without ids). A height resolved per frame repainted everything under it (it missed
 * a 120 Hz phone's frames), and a grid track per frame for a whole list stuttered.
 */
export function Expand(props: { open: boolean; class?: string; children: JSX.Element }) {
  const [shown, setShown] = createSignal(props.open);
  let box: HTMLDivElement | undefined;
  let motions: Animation[] = [];
  let still: HTMLElement | undefined;
  let taken: HTMLElement | undefined;
  // How much of the rows shows, 0 to 1, and where the move under way is taking it.
  let showing = props.open ? 1 : 0;
  let target = showing;
  // One toggle can write the open state more than once (the click, then the preference coming back); acting on
  // each would cancel the slide begun. Only a change from the state the rows are in moves them.
  let was = props.open;
  const settle = () => {
    // A move cut short leaves the rows where it reached, for the next to go on from.
    const progress = motions[0]?.effect?.getComputedTiming().progress;
    if (typeof progress === "number") showing += (target - showing) * progress;
    for (const motion of motions) motion.cancel();
    motions = [];
    still?.remove(); still = undefined;
  };
  // A computation runs before the document is updated: the rows are still there to copy.
  createComputed(on(() => props.open, (open) => {
    taken = !open && was && box ? box.cloneNode(true) as HTMLElement : undefined;
  }, { defer: true }));
  createEffect(() => {
    const wanted = props.open;
    if (was === wanted) return;
    was = wanted;
    haptic("fold");
    settle();
    if (wanted) setShown(true);
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { showing = target = wanted ? 1 : 0; if (!wanted) setShown(false); return; }
    const slide = (node: HTMLElement, to: number, done: () => void) => {
      const height = node.getBoundingClientRect().height;
      const timing: KeyframeAnimationOptions = { duration: cssTime(node, "--duration-fold", 240), easing: getComputedStyle(node).getPropertyValue("--ease-fold") || "ease", fill: "both" };
      const clip = (shows: number) => `inset(0 0 ${(1 - shows) * 100}% 0)`;
      const shift = (shows: number) => `translateY(${-(1 - shows) * height}px)`;
      target = to;
      motions = [node.animate([{ clipPath: clip(showing) }, { clipPath: clip(to) }], timing),
        ...following(node).map((next) => next.animate([{ transform: shift(showing) }, { transform: shift(to) }], timing))];
      // Ending, every move is let go in the same task as the rows are dropped, so the page is laid out once, as it ends.
      motions[0]!.onfinish = () => { for (const motion of motions) motion.cancel(); motions = []; showing = to; still?.remove(); still = undefined; done(); };
    };
    if (wanted) {
      // Once the rows are in the document, laid out, and before it is painted: a frame later, they showed whole for
      // a frame before the slide began.
      queueMicrotask(() => {
        if (!box || props.open !== wanted) return;
        slide(box, 1, () => {});
      });
      return;
    }
    if (!box) { showing = target = 0; return setShown(false); }
    if (box.childElementCount === 0 && taken) {
      still = taken; taken = undefined;
      still.inert = true;
      still.setAttribute("aria-hidden", "true");
      still.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
      box.after(still);
    }
    slide(still ?? box, 0, () => { if (!props.open) setShown(false); });
  });
  onCleanup(settle);
  return <Show when={shown()}><div ref={box} class={props.class ? `ui-expand ${props.class}` : "ui-expand"}>{props.children}</div></Show>;
}

// What comes after it in its scroller: its next siblings, then each ancestor's, up to the scroller. Those slide; a
// still beside it is part of it.
function following(node: HTMLElement) {
  const out: HTMLElement[] = [];
  for (let at: HTMLElement | null = node; at && !scrolls(at); at = at.parentElement) {
    for (let next = at.nextElementSibling; next; next = next.nextElementSibling) if (next instanceof HTMLElement && !next.classList.contains("ui-expand")) out.push(next);
  }
  return out;
}
const scrolls = (element: HTMLElement) => element === document.body || /auto|scroll/.test(getComputedStyle(element).overflowY);
