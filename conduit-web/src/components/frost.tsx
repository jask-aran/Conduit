import * as KDialog from "@kobalte/core/dialog";
import * as KAlertDialog from "@kobalte/core/alert-dialog";
import { createEffect, Show, type JSX } from "solid-js";
import { XIcon } from "lucide-solid";
import { createFullscreenPortalMount } from "@/components/primitives";

/*
 * Frost: the material of everything that floats (DESIGN.md, Surfaces). What
 * opens on top of the app is built from these and nothing else:
 *
 *   FrostOverlay  a surface that filters or navigates -- palettes, chat
 *                 search, Settings. Pinned near the top by default.
 *   FrostDialog   a confirm, a one-field prompt or a small piece of content --
 *                 a centred card with a title and its choices.
 *   Keycap        a key, in rows and in the foot rail.
 *
 *   Menus, context menus and popovers are the Menu* / ContextMenu* /
 *   Popover* primitives (components/primitives.tsx), which wear frost through
 *   their data-slot; a pick list in a popover is PopoverSearchList.
 *
 * Inside: rows take `frost-row` (the cursor wash on data-highlighted, where
 * you are by weight), the foot `frost-rail`, a dialog's buttons
 * `frost-dialog-actions`. Styles are the frost blocks at the end of
 * styles.css; no surface sets its own blur, fill, stroke, radius, dim or
 * arrival.
 */

/** Where focus was when the overlay opened, given back when it closes. */
function focusReturn(open: () => boolean) {
  let target: HTMLElement | null = null;
  let wasOpen = false;
  createEffect(() => {
    if (open() && !wasOpen) target = document.activeElement as HTMLElement | null;
    wasOpen = open();
  });
  return (event: Event) => {
    event.preventDefault();
    if (target?.isConnected) target.focus();
    target = null;
  };
}

export function FrostOverlay(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "top" (default) for a surface that filters, so it shrinks from the bottom; "center" for one that does not. */
  placement?: "top" | "center";
  /** Extra classes on the dimmed overlay, e.g. a surface's own layout. */
  class?: string;
  cardClass?: string;
  /** Attributes on the card, e.g. a surface's own data- state. */
  cardAttrs?: Record<string, string | undefined>;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  children: JSX.Element;
  /** Beside the card, inside the overlay. */
  aside?: JSX.Element;
}) {
  return <KDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
    <KDialog.Portal>
      <KDialog.Content
        data-state={props.open ? "open" : "closed"}
        data-placement={props.placement || "top"}
        class={`frost-overlay${props.class ? ` ${props.class}` : ""}`}
        onOpenAutoFocus={props.onOpenAutoFocus}
        onCloseAutoFocus={props.onCloseAutoFocus}
        onEscapeKeyDown={props.onEscapeKeyDown}
        onPointerDown={(event) => { if (event.target === event.currentTarget) props.onOpenChange(false); }}
      >
        <div {...props.cardAttrs} class={`frost-card${props.cardClass ? ` ${props.cardClass}` : ""}`}>{props.children}</div>
        {props.aside}
      </KDialog.Content>
    </KDialog.Portal>
  </KDialog.Root>;
}

/*
 * A dialog: the title and the choice, nothing else (DESIGN.md, Dialog). The
 * description is for screen readers only, and a one-field prompt's label is
 * hidden too, since the title names the field. `alert` is for a choice that
 * must be answered (deletes): a press on the dim does not close it. `size`
 * "wide" lets the card's own class set its width, for a dialog that holds
 * content (a list, an editor) rather than a choice. Focus returns to where it
 * was.
 */
export function FrostDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: JSX.Element;
  description?: JSX.Element;
  alert?: boolean;
  size?: "wide";
  /** A quiet × at the corner, with this label (default "Close"). */
  close?: boolean | string;
  /** Classes on the card. */
  class?: string;
  /** Classes on the dimmed overlay. */
  overlayClass?: string;
  /** Buttons at the foot, right-aligned. */
  actions?: JSX.Element;
  /** Keeps it open (e.g. while its action runs). */
  busy?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  children?: JSX.Element;
}) {
  const K = props.alert ? KAlertDialog : KDialog;
  const mount = createFullscreenPortalMount();
  const restore = focusReturn(() => props.open);
  const change = (open: boolean) => { if (open || !props.busy) props.onOpenChange(open); };
  const closeLabel = () => typeof props.close === "string" ? props.close : "Close";
  return <K.Root open={props.open} onOpenChange={change}>
    <K.Portal mount={mount()}>
      <K.Content
        data-state={props.open ? "open" : "closed"}
        data-placement="center"
        class={`frost-overlay${props.overlayClass ? ` ${props.overlayClass}` : ""}`}
        onOpenAutoFocus={props.onOpenAutoFocus}
        onCloseAutoFocus={(event: Event) => { if (props.onCloseAutoFocus) props.onCloseAutoFocus(event); else restore(event); }}
        onEscapeKeyDown={(event: KeyboardEvent) => {
          // Esc closes this and nothing behind it.
          event.stopPropagation();
          props.onEscapeKeyDown?.(event);
          if (props.busy) event.preventDefault();
        }}
        onKeyDown={props.onKeyDown}
        onPointerDown={(event: PointerEvent) => { if (!props.alert && event.target === event.currentTarget) change(false); }}
      >
        <div class={`frost-card frost-dialog${props.class ? ` ${props.class}` : ""}`} data-size={props.size}>
          <K.Title class="frost-dialog-title">{props.title}</K.Title>
          <Show when={props.description}><K.Description class="frost-dialog-description">{props.description}</K.Description></Show>
          <Show when={props.close}><K.CloseButton class="frost-dialog-close" aria-label={closeLabel()}><XIcon /></K.CloseButton></Show>
          {props.children}
          <Show when={props.actions}><div class="frost-dialog-actions">{props.actions}</div></Show>
        </div>
      </K.Content>
    </K.Portal>
  </K.Root>;
}

export const Keycap = (props: { children: JSX.Element; class?: string }) =>
  <kbd class={`keycap${props.class ? ` ${props.class}` : ""}`}>{props.children}</kbd>;
