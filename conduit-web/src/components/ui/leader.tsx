import { For, Show, type JSX } from "solid-js";
import { cn } from "@/lib/utils";
import { Overlay, OverlayHead, OverlayList } from "./overlay";
import { type Motion, motionOf } from "./shared";

/**
 * A breadcrumb of places: the one uppercase label (DESIGN Typography). The
 * current place is white with no fill; the cursor washes the others.
 */
export function Crumbs(props: { label: string; items: { label: string; current?: boolean; disabled?: boolean; onClick?: () => void }[] }) {
  return <nav class="ui-crumbs" aria-label={props.label}><For each={props.items}>{(item, index) => <>
    <Show when={index() > 0}><span class="ui-crumbs-sep" aria-hidden="true">›</span></Show>
    <button type="button" aria-current={item.current ? "true" : undefined} disabled={item.disabled} onClick={() => item.onClick?.()}>{item.label}</button>
  </>}</For></nav>;
}

/**
 * The leader menu (Ctrl+G): a small raised frost card that floats without
 * covering the page, above the composer. Its head is the leader's key and the
 * region path; its rows lead with their keys; its rail holds the go-to chords
 * and Esc. The page dims round it all but the current region (Spotlight).
 */
/** foot: fixed above the composer; the wrapper marks shortcut events from inside the card. path, hints and rows
 *  are each optional, so a part can be shown alone in its card. */
export function Leader(props: { label?: string; placement?: "foot"; "data-shortcut-leader-palette"?: string; path?: JSX.Element; hints?: JSX.Element; motion?: Motion; children?: JSX.Element }) {
  return <div class="ui-leader-placement" data-placement={props.placement} data-shortcut-leader-palette={props["data-shortcut-leader-palette"]}>
    <Overlay label={props.label ?? "Leader"} class="ui-leader" motion={props.motion}><Show when={props.path}><OverlayHead>{props.path}</OverlayHead></Show>
      <Show when={props.children}><OverlayList>{props.children}</OverlayList></Show>{props.hints}</Overlay>
  </div>;
}

/** The dim over the page with one region left lit, cut out with its own corners; no region lights nothing. */
export function Spotlight(props: { lit?: { top: string; left: string; width: string; height: string; radius?: string }; fixed?: boolean; motion?: Motion; class?: string; children?: JSX.Element }) {
  return <div class={cn("ui-spotlight", props.class)} data-fixed={props.fixed ? "" : undefined} {...motionOf(props.motion)} aria-hidden="true">
    <div class="ui-spotlight-lit" data-whole={props.lit ? undefined : ""} style={props.lit ? { top: props.lit.top, left: props.lit.left, width: props.lit.width, height: props.lit.height, "border-radius": props.lit.radius } : {}} />
    {props.children}
  </div>;
}
