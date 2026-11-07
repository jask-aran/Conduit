import { createEffect, onCleanup, onMount, Show, type JSX } from "solid-js";
import * as Icons from "./icons";
import { IconButton } from "./actions";
import { overlayHaptics } from "./haptics";

/*
 * A panel over what it belongs to, in two pieces with one inside: Tray (a phone's, risen from the foot) and Ledge (a
 * pointer's, faded in just above the composer). Both are a PanelHead over a PanelBody: one height whatever they hold,
 * the body scrolling under the head edge to edge with its gutter kept (switching what it shows never moves it), the head
 * never wrapping (a title or a lead, its actions, its close). --panel-inset is the surface's padding, for what reaches
 * its edges (a full-width hairline).
 */

/** A panel's head: its title (or a lead: tabs, a switch) by its actions and close; the lead gives way, never the close. */
export function PanelHead(props: { title?: JSX.Element; lead?: JSX.Element; actions?: JSX.Element; onClose?: () => void; grip?: boolean }) {
  return <div class="ui-panel-head">
    <Show when={props.grip}><span class="ui-panel-grip" aria-hidden="true" /></Show>
    <Show when={props.lead} fallback={<strong>{props.title}</strong>}><span class="ui-panel-lead">{props.lead}</span></Show>
    <span class="ui-panel-actions">{props.actions}<Show when={props.onClose}><IconButton kind="pane" close label="Close" onClick={() => props.onClose?.()}><Icons.Close /></IconButton></Show></span>
  </div>;
}
/** What a panel holds, scrolling under its head edge to edge, its gutter kept. */
export const PanelBody = (props: { children: JSX.Element }) => <div class="ui-panel-body">{props.children}</div>;

/**
 * Tray: a phone's panel risen from the foot over what it belongs to, the rest dimmed by a scrim. It rides inside its
 * container (absolute), so what holds it (the pane's header, its pill) stays live. One height (min(85%,
 * --measure-2xl)); put away by its close, a tap on the scrim, Esc, or a swipe down anywhere on it (its body once
 * scrolled to its top), past a quarter of it or flicked; raised frost, the safe area kept under it; felt opening and
 * shutting. Shut, it stays laid out off the foot and inert, so it rises at once.
 */
export function Tray(props: {
  open: boolean;
  onClose: () => void;
  label: string;
  title?: JSX.Element;
  lead?: JSX.Element;
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  let panel!: HTMLElement;
  overlayHaptics(() => props.open);
  createEffect(() => {
    if (!props.open) return;
    const away = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); props.onClose(); } };
    window.addEventListener("keydown", away, true);
    onCleanup(() => window.removeEventListener("keydown", away, true));
  });
  // A swipe down anywhere on it carries it with the finger -- from its head, or from what it holds once that is scrolled
  // to its top (a scroll up, or sideways, stays a scroll); let go past a quarter of it (or flicked), it goes. Touch
  // events, not pointer ones: the move must be able to stop the scroll it would otherwise start.
  const scrollerOf = (target: Element) => {
    for (let node: Element | null = target; node && node !== panel; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /auto|scroll/.test(getComputedStyle(node).overflowY)) return node;
    }
    return null;
  };
  let drag: { y: number; x: number; at: number; dy: number; atTop: boolean; carrying: boolean } | null = null;
  const start = (event: TouchEvent) => {
    const target = event.target as Element;
    if (event.touches.length !== 1 || target.closest("input, textarea, [role=slider], [contenteditable]")) { drag = null; return; }
    const touch = event.touches[0]!;
    drag = { y: touch.clientY, x: touch.clientX, at: performance.now(), dy: 0, atTop: (scrollerOf(target)?.scrollTop ?? 0) <= 0, carrying: false };
  };
  const move = (event: TouchEvent) => {
    if (!drag) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dy = touch.clientY - drag.y, dx = touch.clientX - drag.x;
    if (!drag.carrying) {
      if (Math.abs(dx) > 8 || dy < -8 || (dy > 8 && !drag.atTop)) { drag = null; return; }
      if (dy <= 8 || Math.abs(dy) <= Math.abs(dx)) return;
      drag.carrying = true;
    }
    event.preventDefault();
    drag.dy = Math.max(0, dy);
    panel.style.transition = "none";
    panel.style.transform = `translateY(${drag.dy}px)`;
  };
  const end = () => {
    if (!drag) return;
    const { dy, at, carrying } = drag;
    drag = null;
    if (!carrying) return;
    panel.style.transition = "";
    panel.style.transform = "";
    if (dy > panel.offsetHeight / 4 || dy / Math.max(1, performance.now() - at) > 0.6) props.onClose();
  };
  onMount(() => {
    panel.addEventListener("touchstart", start, { passive: true });
    panel.addEventListener("touchmove", move, { passive: false });
    panel.addEventListener("touchend", end);
    panel.addEventListener("touchcancel", end);
    onCleanup(() => { panel.removeEventListener("touchstart", start); panel.removeEventListener("touchmove", move); panel.removeEventListener("touchend", end); panel.removeEventListener("touchcancel", end); });
  });
  return <div class="ui-tray" data-open={props.open ? "" : undefined}>
    <div class="ui-tray-scrim" aria-hidden="true" onClick={() => props.onClose()} />
    <section ref={panel} class="ui-tray-panel ui-frost" data-surface="frost" data-lift="raised" role="dialog" aria-label={props.label} inert={!props.open ? true : undefined}>
      <PanelHead grip title={props.title} lead={props.lead} actions={props.actions} onClose={() => props.onClose()} />
      <PanelBody>{props.children}</PanelBody>
    </section>
  </div>;
}

/**
 * Ledge: a pointer's panel, faded in over what it belongs to just above its composer (`above`: px over its
 * container's foot), at the composer's width; nothing dimmed, nothing moved. One height (never most of the pane); put
 * away by its close, Esc or a press outside it (but in `keep`: the composer, which holds its control and stays usable
 * under it), as a menu's is. Shut and settled it is skipped from layout and paint, kept on its own layer so fading in
 * composites what is already drawn.
 */
export function Ledge(props: {
  open: boolean;
  onClose: () => void;
  label: string;
  above: number;
  keep?: () => Element | null | undefined;
  title?: JSX.Element;
  lead?: JSX.Element;
  actions?: JSX.Element;
  children: JSX.Element;
}) {
  let panel!: HTMLElement;
  createEffect(() => {
    if (!props.open) return;
    const away = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); props.onClose(); } };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || panel.contains(target) || props.keep?.()?.contains(target)) return;
      props.onClose();
    };
    window.addEventListener("keydown", away, true);
    window.addEventListener("pointerdown", outside, true);
    onCleanup(() => { window.removeEventListener("keydown", away, true); window.removeEventListener("pointerdown", outside, true); });
  });
  return <section ref={panel} class="ui-ledge ui-frost" data-surface="frost" data-lift="raised" data-open={props.open ? "" : undefined} aria-label={props.label}
    inert={!props.open ? true : undefined} style={{ "--ledge-above": `${props.above}px` }}>
    <PanelHead title={props.title} lead={props.lead} actions={props.actions} onClose={() => props.onClose()} />
    <PanelBody>{props.children}</PanelBody>
  </section>;
}
