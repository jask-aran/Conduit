import * as KDialog from "@kobalte/core/dialog";
import { createBack } from "./back";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import { createComputed, createEffect, on, onCleanup, Show, type ComponentProps, type JSX } from "solid-js";
import { duration, reducedMotion } from "./motion";
import { createFullscreenPortalMount } from "./portal";
import { Card } from "./card";
import { haptic, overlayHaptics } from "./haptics";
import { Overlay, Scrim } from "./overlay";

/*
 * A dialog leaves as it was, whatever its caller does. What shuts one usually clears what it showed in the same step
 * (the entry being read set to null), and some callers take the dialog out of the page as they shut it; either way
 * the surface left to play its leave was emptied, or gone. So as a dialog shuts (open goes false, or it is unmounted
 * while open) its scrim is copied whole, before the document is updated, and the copy (inert, no ids, scrolled as it
 * was) plays the leave beside it in the portal's mount, then goes; the real one is out of sight at once. Every Dialog
 * and OverlayDialog does this; leave={false} opts one out (nothing does).
 */
function createLeave(scrim: () => HTMLElement | undefined, open: () => boolean, mount: () => Node | undefined, wanted: () => boolean) {
  const leave = () => {
    const real = scrim();
    if (!real || !wanted() || reducedMotion() || !real.isConnected && !real.childElementCount) return;
    const still = real.cloneNode(true) as HTMLElement;
    still.inert = true;
    still.setAttribute("aria-hidden", "true");
    still.removeAttribute("role");
    still.removeAttribute("id");
    still.dataset.state = "closed";
    still.style.removeProperty("display");
    const from = real.querySelectorAll<HTMLElement>("*"), to = still.querySelectorAll<HTMLElement>("*");
    for (const surface of still.querySelectorAll(":scope > .ui-card, :scope > .ui-overlay")) { surface.removeAttribute("data-entering"); surface.setAttribute("data-leaving", ""); }
    for (const element of to) element.removeAttribute("id");
    (mount() ?? document.body).appendChild(still);
    // A list left scrolled stays where it was.
    from.forEach((element, index) => { if (element.scrollTop && to[index]) to[index]!.scrollTop = element.scrollTop; });
    real.style.display = "none";
    setTimeout(() => still.remove(), duration("--duration-quick", still) + 60);
  };
  // A computation runs before the document is updated: what the dialog shows is still there to copy.
  createComputed(on(open, (now) => { if (now) scrim()?.style.removeProperty("display"); else leave(); }, { defer: true }));
  onCleanup(() => { if (open()) leave(); });
}

/** Kobalte owns modality and focus; Card and Scrim own every part of the surface. */
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
  /** false: no leave of its own (see createLeave). */
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
  // Back shuts it; busy, it takes the step and stays, as Escape does.
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

/** A large overlay (a palette, chat search): Kobalte owns modality and focus; Scrim and Overlay own the surface.
 *  Pinned near the top so filtering shrinks it from the bottom; placement="center" for one that does not filter;
 *  "middle" for one that filters and has a full height (--overlay-height): it sits where that height is centred and
 *  its top edge stays there as it shrinks. */
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
  /** false: no leave of its own (see createLeave). */
  leave?: boolean;
  children: JSX.Element;
}) {
  const mount = createFullscreenPortalMount();
  overlayHaptics(() => props.open);
  let scrim: HTMLElement | undefined;
  createLeave(() => scrim, () => props.open, () => mount(), () => props.leave !== false);
  return <KDialog.Root open={props.open} onOpenChange={(open) => { if (!open) haptic("dismiss"); props.onOpenChange(open); }}>
    <KDialog.Portal mount={mount()}>
      <KDialog.Content as={Scrim} data-piece="OverlayDialog" ref={(element: HTMLElement) => { scrim = element; }} dialog placement={props.placement ?? "top"} aria-label={props.label} data-state={props.open ? "open" : "closed"} style={props.placement === "middle" ? props.style : undefined}
        onOpenAutoFocus={props.onOpenAutoFocus} onCloseAutoFocus={props.onCloseAutoFocus} onEscapeKeyDown={props.onEscapeKeyDown}
        onPointerDown={(event: PointerEvent) => { if (event.target === event.currentTarget) props.onOpenChange(false); }}>
        <Overlay embedded label={props.label} layout={props.layout} style={props.style} motion={props.open ? "entering" : "leaving"}>{props.children}</Overlay>
      </KDialog.Content>
    </KDialog.Portal>
  </KDialog.Root>;
}
