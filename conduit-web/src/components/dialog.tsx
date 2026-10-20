import * as KDialog from "@kobalte/core/dialog";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import { createEffect, Show, type ComponentProps, type JSX } from "solid-js";
import { createFullscreenPortalMount } from "./portal";
import { Card } from "./ui/card";
import { Overlay, Scrim } from "./ui/overlay";

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
  const change = (open: boolean) => { if (open || !props.busy) props.onOpenChange(open); };
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
      <K.Content as={Scrim} dialog placement="center" data-state={props.open ? "open" : "closed"}
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
 *  Pinned near the top so filtering shrinks it from the bottom (placement="center" for one that does not filter). */
export function OverlayDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  placement?: "top" | "center";
  layout?: "stack" | "rail";
  style?: JSX.CSSProperties;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  children: JSX.Element;
}) {
  const mount = createFullscreenPortalMount();
  return <KDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
    <KDialog.Portal mount={mount()}>
      <KDialog.Content as={Scrim} dialog placement={props.placement ?? "top"} aria-label={props.label} data-state={props.open ? "open" : "closed"}
        onOpenAutoFocus={props.onOpenAutoFocus} onCloseAutoFocus={props.onCloseAutoFocus} onEscapeKeyDown={props.onEscapeKeyDown}
        onPointerDown={(event: PointerEvent) => { if (event.target === event.currentTarget) props.onOpenChange(false); }}>
        <Overlay embedded label={props.label} layout={props.layout} style={props.style} motion={props.open ? "entering" : "leaving"}>{props.children}</Overlay>
      </KDialog.Content>
    </KDialog.Portal>
  </KDialog.Root>;
}
