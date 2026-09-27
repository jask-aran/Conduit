import * as KDialog from "@kobalte/core/dialog";
import type { JSX } from "solid-js";

/*
 * The frost overlay (DESIGN.md, Surfaces): anything that opens on top of the
 * app. The page dims behind it, the card sits pinned near the top in the
 * composer's frost, and on a phone it is a full-screen bubble with a darker
 * core. A press on the dim closes it. Styles are the `frost-*` block at the
 * end of styles.css; rows inside take `frost-row`, keys `keycap`, and the
 * foot `frost-rail`.
 */
export function FrostOverlay(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
