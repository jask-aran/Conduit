import { createComputed, createEffect, on, type JSX } from "solid-js";
import { duration, easing, reducedMotion } from "./motion";

/**
 * Room for one thing at a time, in something whose own size should follow it (a form, a centred card): when the step
 * changes, the room eases from the height it had to the height it needs and what is new fades in, so what holds it
 * grows and shrinks rather than jumping. step: which is shown, "" for none. size: anything else its height depends
 * on (rows arriving, an error), which moves the room without the fade.
 *
 * Its height is laid out per frame, so it is for small things (a sign-in form, a card's QR). What opens in a long
 * list or a scroller is an Expand, which lays the page out once.
 */
export function Steps(props: { step: string; size?: string | number; class?: string; children: JSX.Element }) {
  let box: HTMLDivElement | undefined;
  let from = 0;
  let was = props.step;
  let running: Animation | undefined;
  const key = () => `${props.step}\0${props.size ?? ""}`;
  // A computation runs before the document is updated: the height is still the old one (or where a move had reached).
  createComputed(on(key, () => { from = box?.getBoundingClientRect().height ?? 0; }, { defer: true }));
  createEffect(on(key, () => {
    const element = box;
    const stepped = was !== props.step;
    was = props.step;
    if (!element || reducedMotion()) return;
    running?.cancel();
    const to = element.getBoundingClientRect().height;
    if (Math.abs(from - to) > 0.5) {
      element.dataset.moving = "";
      const move = running = element.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: duration("--duration-fold", element), easing: easing("--ease-settle", element) });
      move.onfinish = move.oncancel = () => { if (running !== move) return; running = undefined; delete element.dataset.moving; };
    }
    if (stepped) for (const child of element.children) child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: duration("--duration-gentle", element), easing: easing("--ease-arrive", element) });
  }, { defer: true }));
  return <div ref={box} class={props.class ? `ui-steps ${props.class}` : "ui-steps"} data-step={props.step}>{props.children}</div>;
}

