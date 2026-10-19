import * as KDialog from "@kobalte/core/dialog";
import type { JSX } from "solid-js";

/*
 * Frost: the material of everything that floats (DESIGN.md, Surfaces). What
 * opens on top of the app is built from these and nothing else:
 *
 *   FrostOverlay  a surface that filters or navigates -- palettes, chat
 *                 search, Settings. Pinned near the top by default.
 *   Keycap        a key, in rows and in the foot rail.
 *
 *   Menus, context menus and popovers are the Menu* / ContextMenu* /
 *   Popover* primitives (components/primitives.tsx), which wear frost through
 *   their data-slot; a pick list in a popover is PopoverSearchList.
 *
 * Inside: rows take `frost-row` (the cursor wash on data-highlighted, where
 * you are by weight), the foot `frost-rail`. Dialogs use components/dialog.tsx
 * and the v2 Card. Styles are the frost blocks at the end of styles.css; no surface sets its own blur, fill, stroke, radius, dim or
 * arrival.
 */

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

export const Keycap = (props: { children: JSX.Element; class?: string }) =>
  <kbd class={`keycap${props.class ? ` ${props.class}` : ""}`}>{props.children}</kbd>;
