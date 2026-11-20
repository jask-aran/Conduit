import * as KDialog from "@kobalte/core/dialog";
import { createBack } from "./back";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import { createComputed, createEffect, on, onCleanup, Show, type ComponentProps, type JSX } from "solid-js";
import { duration, reducedMotion } from "./motion";
import { createFullscreenPortalMount } from "./portal";
import { Card } from "./card";
import { haptic, overlayHaptics } from "./haptics";
import { Overlay, Scrim } from "./overlay";

/* What shuts a dialog usually clears what it showed in the same step, and some callers unmount it as they shut it, so as one shuts its scrim is copied
 * before the document is updated, and the inert copy plays the leave. A part wholly out of sight (a list's rows past its edge) is an empty box its height. */
function copyInSight(from: Element, into: Element, sight: { top: number; bottom: number; left: number; right: number }, scrolled: [HTMLElement, number][]) {
  for (const node of from.childNodes) {
    if (!(node instanceof HTMLElement)) { into.appendChild(node.cloneNode(true)); continue; }
    const box = node.getBoundingClientRect(), copy = node.cloneNode(false) as HTMLElement;
    into.appendChild(copy);
    if (box.width && (box.bottom <= sight.top || box.top >= sight.bottom || box.right <= sight.left || box.left >= sight.right)) { Object.assign(copy.style, { blockSize: `${box.height}px`, flex: "none" }); continue; }
    if (node.scrollTop) scrolled.push([copy, node.scrollTop]);
    const clips = node.scrollHeight > node.clientHeight && getComputedStyle(node).overflowY !== "visible";
    copyInSight(node, copy, clips ? { top: Math.max(sight.top, box.top), bottom: Math.min(sight.bottom, box.bottom), left: sight.left, right: sight.right } : sight, scrolled);
  }
}
function createLeave(scrim: () => HTMLElement | undefined, open: () => boolean, mount: () => Node | undefined, wanted: () => boolean) {
  const leave = () => {
    const real = scrim();
    if (!real || !wanted() || reducedMotion() || !real.isConnected && !real.childElementCount) return;
    // Where each part stands and is scrolled is read before the copy is put in: read after, it lays the copy out first.
    const still = real.cloneNode(false) as HTMLElement, scrolled: [HTMLElement, number][] = [];
    copyInSight(real, still, { top: 0, bottom: innerHeight, left: 0, right: innerWidth }, scrolled);
    still.inert = true;
    still.setAttribute("aria-hidden", "true");
    still.removeAttribute("role");
    still.removeAttribute("id");
    still.dataset.state = "closed";
    still.style.removeProperty("display");
    for (const surface of still.querySelectorAll(":scope > .ui-card, :scope > .ui-overlay")) { surface.removeAttribute("data-entering"); surface.setAttribute("data-leaving", ""); }
    for (const element of still.querySelectorAll("[id]")) element.removeAttribute("id");
    const wait = duration("--duration-quick", real) + 60;
    (mount() ?? document.body).appendChild(still);
    for (const [element, top] of scrolled) element.scrollTop = top;
    real.style.display = "none";
    setTimeout(() => still.remove(), wait);
  };
  // A computation runs before the document is updated: what the dialog shows is still there to copy.
  createComputed(on(open, (now) => { if (now) scrim()?.style.removeProperty("display"); else leave(); }, { defer: true }));
  onCleanup(() => { if (open()) leave(); });
}

export function Dialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: JSX.Element;
  description?: JSX.Element;
  alert?: boolean;
  size?: ComponentProps<typeof Card>["size"];
  close?: boolean | string;
  actions?: JSX.Element;
  busy?: boolean;
  leave?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onAfterClose?: () => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  children?: JSX.Element;
}) {
  const K = props.alert ? KAlertDialog : KDialog;
  const mount = createFullscreenPortalMount();
  let target: HTMLElement | null = null;
  let wasOpen = false;
  createEffect(() => {
    if (props.open && !wasOpen) target = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    wasOpen = props.open;
  });
  overlayHaptics(() => props.open);
  const change = (open: boolean) => { if (open || !props.busy) { if (!open) haptic("dismiss"); props.onOpenChange(open); } };
  let scrim: HTMLElement | undefined;
  createLeave(() => scrim, () => props.open, () => mount(), () => props.leave !== false);
  createBack(() => props.open, () => change(false));
  const restore = (event: Event) => {
    if (props.onCloseAutoFocus) props.onCloseAutoFocus(event);
    else {
      event.preventDefault();
      if (target?.isConnected) target.focus();
    }
    target = null;
    props.onAfterClose?.();
  };
  return <K.Root open={props.open} onOpenChange={change}>
    <K.Portal mount={mount()}>
      <K.Content as={Scrim} ref={(element: HTMLElement) => { scrim = element; }} dialog placement="center" data-state={props.open ? "open" : "closed"}
        onOpenAutoFocus={props.onOpenAutoFocus} onCloseAutoFocus={restore}
        onEscapeKeyDown={(event: KeyboardEvent) => {
          event.stopPropagation();
          props.onEscapeKeyDown?.(event);
          if (props.busy) event.preventDefault();
        }}
        onKeyDown={props.onKeyDown}
        data-piece="Dialog" onPointerDown={(event: PointerEvent) => { if (!props.alert && event.target === event.currentTarget) change(false); }}>
        <Card embedded size={props.size} title={<K.Title as="span">{props.title}</K.Title>}
          description={<Show when={props.description}><K.Description as="span">{props.description}</K.Description></Show>}
          close={props.close ? () => change(false) : undefined} closeLabel={typeof props.close === "string" ? props.close : "Close"} closeDisabled={props.busy}
          motion={props.open ? "entering" : "leaving"} actions={props.actions}>
          {props.children}
        </Card>
      </K.Content>
    </K.Portal>
  </K.Root>;
}

/** Pinned near the top so filtering shrinks it from the bottom. */
export function OverlayDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  placement?: "top" | "center" | "middle";
  layout?: "rail";
  style?: JSX.CSSProperties;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  leave?: boolean;
  children: JSX.Element;
}) {
  const mount = createFullscreenPortalMount();
  overlayHaptics(() => props.open);
  let scrim: HTMLElement | undefined;
  createLeave(() => scrim, () => props.open, () => mount(), () => props.leave !== false);
  return <KDialog.Root open={props.open} onOpenChange={(open) => { if (!open) haptic("dismiss"); props.onOpenChange(open); }}>
    <KDialog.Portal mount={mount()}>
      <KDialog.Content as={Scrim} data-piece="OverlayDialog" data-overlay-dialog="" ref={(element: HTMLElement) => { scrim = element; }} dialog placement={props.placement ?? "top"} aria-label={props.label} data-state={props.open ? "open" : "closed"} style={props.placement === "middle" ? props.style : undefined}
        onOpenAutoFocus={props.onOpenAutoFocus} onCloseAutoFocus={props.onCloseAutoFocus} onEscapeKeyDown={props.onEscapeKeyDown}
        onPointerDown={(event: PointerEvent) => { if (event.target === event.currentTarget) props.onOpenChange(false); }}>
        <Overlay embedded label={props.label} layout={props.layout} style={props.style} motion={props.open ? "entering" : "leaving"}>{props.children}</Overlay>
      </KDialog.Content>
    </KDialog.Portal>
  </KDialog.Root>;
}
