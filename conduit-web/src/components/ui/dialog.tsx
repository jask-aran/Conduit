import * as KDialog from "@kobalte/core/dialog";
import { createBack } from "./back";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import { createComputed, createEffect, on, Show, type ComponentProps, type JSX } from "solid-js";
import { createFullscreenPortalMount } from "./portal";
import { Card } from "./card";
import { haptic, overlayHaptics } from "./haptics";
import { Overlay, Scrim } from "./overlay";

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
  /*
   * It leaves as it was. What shuts a dialog usually clears what it showed in the same step (the entry being read set
   * to null, a form reset), so the card left to play its leave was emptied first and collapsed on its way out. A
   * computation runs before the document is updated: the card is copied whole then (inert, no ids), and the copy
   * plays the leave while the real one, already changing, is out of sight.
   */
  let scrim: HTMLElement | undefined;
  let still: HTMLElement | undefined;
  createComputed(on(() => props.open, (open) => {
    still?.remove(); still = undefined;
    if (scrim) delete scrim.dataset.still;
    const card = open ? null : scrim?.querySelector<HTMLElement>(":scope > .ui-card");
    if (!card || !scrim) return;
    still = card.cloneNode(true) as HTMLElement;
    still.inert = true;
    still.setAttribute("aria-hidden", "true");
    still.removeAttribute("data-entering");
    still.setAttribute("data-leaving", "");
    still.removeAttribute("id");
    still.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
    card.after(still);
    scrim.dataset.still = "";
  }, { defer: true }));
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
        onPointerDown={(event: PointerEvent) => { if (!props.alert && event.target === event.currentTarget) change(false); }}>
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
  children: JSX.Element;
}) {
  const mount = createFullscreenPortalMount();
  overlayHaptics(() => props.open);
  return <KDialog.Root open={props.open} onOpenChange={(open) => { if (!open) haptic("dismiss"); props.onOpenChange(open); }}>
    <KDialog.Portal mount={mount()}>
      <KDialog.Content as={Scrim} dialog placement={props.placement ?? "top"} aria-label={props.label} data-state={props.open ? "open" : "closed"} style={props.placement === "middle" ? props.style : undefined}
        onOpenAutoFocus={props.onOpenAutoFocus} onCloseAutoFocus={props.onCloseAutoFocus} onEscapeKeyDown={props.onEscapeKeyDown}
        onPointerDown={(event: PointerEvent) => { if (event.target === event.currentTarget) props.onOpenChange(false); }}>
        <Overlay embedded label={props.label} layout={props.layout} style={props.style} motion={props.open ? "entering" : "leaving"}>{props.children}</Overlay>
      </KDialog.Content>
    </KDialog.Portal>
  </KDialog.Root>;
}
