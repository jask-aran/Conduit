import { createEffect, createSignal, on, Show, splitProps, untrack, type JSX, type ValidComponent } from "solid-js";
import { Dynamic } from "solid-js/web";
import { ChevronDownIcon } from "lucide-solid";
import "./disclosure.css";

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
const GENTLE = "cubic-bezier(.2, .8, .2, 1)";
const QUICK = "cubic-bezier(.4, 0, 1, 1)";

/** Keep the body on screen while it folds away, and unfold it in height. */
function createReveal(open: () => boolean) {
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
      // The row's gap above the body goes and comes with it, so nothing is
      // left to snap when the body is taken away or first drawn. `node` has no
      // padding of its own, so its height really reaches zero.
      const parent = node.parentElement;
      const gap = parent ? parseFloat(getComputedStyle(parent).rowGap) || 0 : 0;
      const shut = -gap;
      const from = running ? node.getBoundingClientRect().height : isOpen ? 0 : node.getBoundingClientRect().height;
      const fromMargin = running ? parseFloat(getComputedStyle(node).marginTop) || 0 : isOpen ? shut : 0;
      running?.cancel();
      node.style.overflow = "hidden";
      if (isOpen) {
        const to = node.getBoundingClientRect().height;
        const animation = node.animate([
          { height: `${from}px`, marginTop: `${fromMargin}px`, opacity: from ? 1 : 0 },
          { opacity: 1, offset: 0.6 },
          { height: `${to}px`, marginTop: "0px", opacity: 1 },
        ], { duration: 200, easing: GENTLE });
        running = animation;
        animation.finished.then(() => settle(node), () => {});
      } else {
        const animation = node.animate([{ height: `${from}px`, marginTop: `${fromMargin}px`, opacity: 1 }, { height: "0px", marginTop: `${shut}px`, opacity: 0 }], { duration: 200, easing: QUICK, fill: "forwards" });
        running = animation;
        animation.finished.then(() => { settle(node); if (!open()) setMounted(false); }, () => {});
      }
    });
  }, { defer: true }));

  return { mounted, ref: (node: HTMLElement) => { body = node; } };
}

/** Fired on a disclosure's root, bubbling, just before it opens or closes. */
export const DISCLOSURE_TOGGLE_EVENT = "conduit:disclosure-toggle";

/**
 * A row that opens to show what is under it: a turn's trace, a tool call, an
 * answer a stop discarded. One header button ending in a chevron that turns,
 * and a body that unfolds in height (~200ms, gentle, with a short fade) and
 * folds away quickly -- the second exception to "transform and opacity only"
 * in DESIGN.md, because pushing what is below is what the reader asked for.
 * Turned around part-way, it goes back from the height it had reached.
 * Reduced motion opens and closes at once.
 *
 * The body is drawn each time it opens, once, and folded away after it
 * closes. `trigger` swaps the plain header button for another (the tool
 * card's outline Button); anything else passed lands on the root, and
 * `children` sit after the body.
 */
export function Disclosure(props: {
  class: string;
  headerClass: string;
  bodyClass: string;
  header: JSX.Element;
  body: () => JSX.Element;
  initialOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  trigger?: ValidComponent;
  triggerProps?: Record<string, unknown>;
  title?: string;
  label?: string;
  children?: JSX.Element;
  [data: `data-${string}`]: string | undefined;
}) {
  const [local, root] = splitProps(props, ["class", "headerClass", "bodyClass", "header", "body", "initialOpen", "onOpenChange", "trigger", "triggerProps", "title", "label", "children"]);
  const [open, setOpen] = createSignal(Boolean(local.initialOpen));
  const reveal = createReveal(open);
  let row!: HTMLDivElement;
  const toggle = () => {
    const next = !open();
    // Said before the body moves, so a transcript following its tail lets go
    // first: the row stays under the pointer and opens downward.
    row.dispatchEvent(new CustomEvent(DISCLOSURE_TOGGLE_EVENT, { bubbles: true }));
    setOpen(next);
    local.onOpenChange?.(next);
  };
  return <div ref={row} class={local.class} data-open={open() ? "true" : "false"} {...root}>
    <Dynamic component={local.trigger ?? "button"} type="button" class={local.headerClass} aria-expanded={open()} aria-label={local.label} title={local.title} onClick={toggle} {...local.triggerProps}>
      {local.header}
      <ChevronDownIcon class="disclosure-chevron" data-open={open() ? "true" : "false"} />
    </Dynamic>
    <Show when={reveal.mounted()}>
      <div ref={reveal.ref} class="disclosure-body"><div class={local.bodyClass}>{untrack(local.body)}</div></div>
    </Show>
    {local.children}
  </div>;
}
