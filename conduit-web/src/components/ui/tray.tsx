import { createContext, createSignal, onCleanup, onMount, Show, useContext, type JSX } from "solid-js";
import { CloseButton } from "./actions";
import { overlayHaptics } from "./haptics";
import { SWIPE } from "./edge-swipe";
import { createDismiss } from "./dismiss";
import { createFolds } from "./fit";
import { Frost } from "./frost";

/* A panel over what it belongs to: Tray (a phone's, risen from the foot) and Ledge (a pointer's, above the composer),
   each a PanelHead over a PanelBody at one height whatever they hold (switching what it shows never moves it), the
   head never wrapping. --panel-inset is the surface's padding, for what reaches its edges (a full-width hairline). */

/** The parts of a panel's head a caller gives: a title, or a lead in its place; foldLead, a lead that folds (its
 *  Segmented to marks) when the head has no room for it, so the actions and the close never overflow. */
export interface PanelHeadParts { title?: JSX.Element; lead?: JSX.Element; foldLead?: (folded: () => boolean) => JSX.Element; actions?: JSX.Element }

/** A panel's head: its title (or a lead: tabs, a switch) by its actions and close; the lead gives way, never the close.
 *  A foldLead folds once the head overflows and unfolds at the width it needed (from its content, never a tuned width). */
export function PanelHead(props: PanelHeadParts & { onClose?: () => void; grip?: boolean }) {
  const folds = createFolds(1);
  const lead = () => props.foldLead?.(() => folds.count() > 0) ?? props.lead;
  return <div ref={(element) => { if (props.foldLead) folds.ref(element); }} class="ui-panel-head">
    <Show when={props.grip}><span class="ui-panel-grip" aria-hidden="true" /></Show>
    <Show when={props.lead || props.foldLead} fallback={<strong>{props.title}</strong>}><span class="ui-panel-lead">{lead()}</span></Show>
    <span class="ui-panel-actions">{props.actions}<Show when={props.onClose}><CloseButton kind="pane" onClick={() => props.onClose?.()} /></Show></span>
  </div>;
}
/** What a panel holds, scrolling under its head edge to edge, its gutter kept. */
export const PanelBody = (props: { children: JSX.Element }) => <div class="ui-panel-body">{props.children}</div>;

/**
 * Tray: a phone's panel risen from the foot over a scrim, inside its container, so what holds it stays live. Put away
 * by its close, the scrim, Esc, or a swipe down past SWIPE.commit (edge-swipe.ts: one feel for every swipe). Shut, it
 * stays laid out off the foot and inert, so it rises at once. fit: as tall as what it holds, up to the one height.
 */
export function Tray(props: PanelHeadParts & { open: boolean; onClose: () => void; label: string; fit?: boolean; children: JSX.Element }) {
  let panel!: HTMLElement;
  overlayHaptics(() => props.open);
  createDismiss({ open: () => props.open, onClose: () => props.onClose() });
  // A swipe down carries it with the finger (from what it holds once scrolled to its top). Touch events, not pointer
  // ones: the move must be able to stop the scroll it would otherwise start.
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
      if (Math.abs(dx) > SWIPE.lockPx || dy < -SWIPE.lockPx || (dy > SWIPE.lockPx && !drag.atTop)) { drag = null; return; }
      if (dy <= SWIPE.lockPx || Math.abs(dy) <= Math.abs(dx) * SWIPE.sidewaysRatio) return;
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
    const flicked = dy >= SWIPE.flickMinPx && dy / Math.max(1, performance.now() - at) > SWIPE.flickPxPerMs;
    if (dy > panel.offsetHeight * SWIPE.commit || flicked) props.onClose();
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
    <Frost as="section" lift="raised" ref={panel} class="ui-tray-panel" data-fit={props.fit ? "" : undefined} role="dialog" aria-label={props.label} inert={!props.open ? true : undefined}>
      <PanelHead grip title={props.title} lead={props.lead} foldLead={props.foldLead} actions={props.actions} onClose={() => props.onClose()} />
      <PanelBody>{props.children}</PanelBody>
    </Frost>
  </div>;
}

/** Ledges stacked over their container just above its composer (`above`: px over its foot): the first given on top, the
 *  last at the foot. Each is a Ledge as ever; a fit one is as tall as what it holds, up to the room the others leave.
 *  A press anywhere in the stack (or in `keep`) is not outside any of them. */
const LedgeStackContext = createContext<{ stack: () => HTMLElement | undefined; keep?: () => Element | null | undefined } | null>(null);
export function LedgeStack(props: { above: number; keep?: () => Element | null | undefined; children: JSX.Element }) {
  const [stack, setStack] = createSignal<HTMLElement>();
  return <LedgeStackContext.Provider value={{ stack, keep: () => props.keep?.() }}>
    <div ref={setStack} class="ui-ledge-stack" style={{ "--ledge-above": `${props.above}px` }}>{props.children}</div>
  </LedgeStackContext.Provider>;
}

/**
 * Ledge: a pointer's panel faded in just above its composer (`above`: px over the foot), at the composer's width,
 * nothing dimmed. Put away by its close, Esc or a press outside it and `keep` (the composer). Shut and settled it is
 * skipped from layout and paint, on its own layer so fading in composites what is drawn. fit: as tall as it holds.
 */
export function Ledge(props: PanelHeadParts & { open: boolean; onClose: () => void; label: string; above?: number; keep?: () => Element | null | undefined; fit?: boolean; children: JSX.Element }) {
  let panel!: HTMLElement;
  const inStack = useContext(LedgeStackContext);
  createDismiss({ open: () => props.open, onClose: () => props.onClose(), inside: () => [inStack?.stack() ?? panel, (props.keep ?? inStack?.keep)?.()] });
  return <Frost as="section" lift="raised" ref={panel} class="ui-ledge" data-open={props.open ? "" : undefined} data-fit={props.fit ? "" : undefined} aria-label={props.label}
    inert={!props.open ? true : undefined} style={inStack ? undefined : { "--ledge-above": `${props.above ?? 0}px` }}>
    <PanelHead title={props.title} lead={props.lead} foldLead={props.foldLead} actions={props.actions} onClose={() => props.onClose()} />
    <PanelBody>{props.children}</PanelBody>
  </Frost>;
}
