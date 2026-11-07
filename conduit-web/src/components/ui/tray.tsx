import { createEffect, onCleanup, onMount, Show, type JSX } from "solid-js";
import * as Icons from "./icons";
import { IconButton } from "./actions";
import { overlayHaptics } from "./haptics";

/**
 * Tray: a phone's surface risen from the foot over what it belongs to (a chat's panel, jbot's), the rest dimmed by a
 * scrim. It rides inside its container (absolute), so what holds it (the pane's header, its pill) stays live.
 *
 * - One height whatever it holds (min(85%, --measure-2xl)): its body scrolls under its head, so switching what it
 *   shows never moves it.
 * - Its head: a title (or a lead: tabs, a switch), its own actions, then its close, never wrapping.
 * - Put away by its close, a tap on the scrim, Esc, or a swipe down anywhere on it (its body once scrolled to its top),
 *   past a quarter of it or flicked.
 * - Raised frost, the safe area kept under it; felt opening and shutting (overlayHaptics).
 * - Shut, it stays laid out off the foot and inert, so it rises at once.
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
      <div class="ui-tray-head">
        <span class="ui-tray-grip" aria-hidden="true" />
        <Show when={props.lead} fallback={<strong>{props.title}</strong>}><span class="ui-tray-lead">{props.lead}</span></Show>
        <span class="ui-tray-actions">{props.actions}<IconButton kind="pane" close label="Close" onClick={() => props.onClose()}><Icons.Close /></IconButton></span>
      </div>
      <div class="ui-tray-body">{props.children}</div>
    </section>
  </div>;
}
