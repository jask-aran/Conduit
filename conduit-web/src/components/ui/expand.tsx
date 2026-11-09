import { duration, easing, reducedMotion } from "./motion";
import { createComputed, createEffect, createSignal, on, onCleanup, Show, type JSX } from "solid-js";
import { haptic } from "./haptics";

/**
 * What opens and shuts in place under the row that owns it (a folder's rows) over --duration-fold, on --ease-fold.
 * Shut, nothing is in the document. The page is laid out once, at the move's start (opening) or end (shutting);
 * between, what follows slides on a transform and the rows are revealed by a clip. Shutting, the rows stay drawn:
 * when the caller drops them at once, the slide runs over a still taken before they went (inert, no ids). A height
 * per frame repainted everything under it (missing a 120 Hz phone's frames); a grid track per frame stuttered.
 * In a scroller as tall as its content (a menu, data-fits), the scroller's height moves with the rows, laid out per
 * frame but only that small box; without it the menu's edge jumped first.
 * Shutting in a scroller near its end, the scroll will come back when the rows go, so everything in it slides down
 * that far with the move and the end looks as the last frame did, rather than the list jumping down.
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
  // One toggle can write the open state twice (the click, then the preference coming back): only a real change moves.
  let was = props.open;
  // While the rows move, their scroller is marked folding (data-folding, a count): a transcript's follow then does not
  // chase the size they change, which would move the view as a second motion beside this one.
  let folding: HTMLElement | undefined;
  const unfold = () => { if (!folding) return; const left = Number(folding.dataset.folding || 1) - 1; if (left > 0) folding.dataset.folding = String(left); else delete folding.dataset.folding; folding = undefined; };
  const settle = () => {
    // A move cut short leaves the rows where it reached, for the next to go on from.
    const progress = motions[0]?.effect?.getComputedTiming().progress;
    if (typeof progress === "number") showing += (target - showing) * progress;
    for (const motion of motions) motion.cancel();
    motions = [];
    still?.remove(); still = undefined;
    unfold();
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
    if (reducedMotion()) { showing = target = wanted ? 1 : 0; if (!wanted) setShown(false); return; }
    const slide = (node: HTMLElement, to: number, done: () => void) => {
      const height = node.getBoundingClientRect().height;
      const timing: KeyframeAnimationOptions = { duration: duration("--duration-fold", node), easing: easing("--ease-fold", node), fill: "both" };
      const clip = (shows: number) => `inset(0 0 ${(1 - shows) * 100}% 0)`;
      const shift = (shows: number) => `translateY(${-(1 - shows) * height}px)`;
      target = to;
      const edge = scrollerOf(node);
      if (edge && !folding) { folding = edge; edge.dataset.folding = String(Number(edge.dataset.folding || 0) + 1); }
      // Shutting: how far the scroll will come back when the rows go, and so how far everything drops on the way there.
      const back = to === 0 && edge && edge.dataset.fits === undefined && showing > 0
        ? Math.max(0, edge.scrollTop - Math.max(0, edge.scrollHeight - height - edge.clientHeight)) : 0;
      const drop = (shows: number) => back * (showing - shows) / showing;
      // The scroller's child holding the rows: it and what is before it drop; what follows beside it, by its own slide.
      let top: HTMLElement = node;
      while (top.parentElement && top.parentElement !== edge) top = top.parentElement;
      const beside = (next: HTMLElement) => back > 0 && next.parentElement === edge;
      motions = [node.animate([{ clipPath: clip(showing) }, { clipPath: clip(to) }], timing),
        ...following(node).map((next) => next.animate(beside(next)
          ? [{ transform: `translateY(${drop(showing) - (1 - showing) * height}px)` }, { transform: `translateY(${drop(to) - (1 - to) * height}px)` }]
          : [{ transform: shift(showing) }, { transform: shift(to) }], timing))];
      if (back > 0 && edge) {
        for (let before: Element | null = top; before; before = before.previousElementSibling) {
          if (before instanceof HTMLElement) motions.push(before.animate([{ transform: "translateY(0px)" }, { transform: `translateY(${back}px)` }], timing));
        }
      }
      if (edge?.dataset.fits !== undefined) {
        // The rows are in, whole: open, it is as tall as it is now; shut, it loses what of them it shows, inside its caps.
        const open = edge.getBoundingClientRect().height;
        const shut = open - (edge.clientHeight - Math.min(edge.scrollHeight - height, edge.clientHeight));
        const at = (shows: number) => `${shut + (open - shut) * shows}px`;
        if (open - shut > 0.5) motions.push(edge.animate([{ height: at(showing) }, { height: at(to) }], timing));
      }
      // Ending, every move is let go in the same task as the rows are dropped, so the page is laid out once, as it ends.
      motions[0]!.onfinish = () => { for (const motion of motions) motion.cancel(); motions = []; showing = to; still?.remove(); still = undefined; done(); requestAnimationFrame(() => { if (!motions.length) unfold(); }); };
    };
    if (wanted) {
      // Once the rows are laid out, before paint: a frame later, they showed whole for a frame first.
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

// What comes after it in its scroller: its next siblings, then each ancestor's. A still beside it is part of it.
function following(node: HTMLElement) {
  const out: HTMLElement[] = [];
  for (let at: HTMLElement | null = node; at && !scrolls(at); at = at.parentElement) {
    for (let next = at.nextElementSibling; next; next = next.nextElementSibling) if (next instanceof HTMLElement && !next.classList.contains("ui-expand")) out.push(next);
  }
  return out;
}
function scrollerOf(node: HTMLElement) {
  for (let at = node.parentElement; at; at = at.parentElement) if (scrolls(at)) return at === document.body ? null : at;
  return null;
}
const scrolls = (element: HTMLElement) => element === document.body || /auto|scroll/.test(getComputedStyle(element).overflowY);
