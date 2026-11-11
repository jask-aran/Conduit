import { For, Show, type JSX } from "solid-js";
import { cn } from "@/lib/utils";
import { Overlay, OverlayHead, OverlayList } from "./overlay";
import { type Motion, motionOf } from "./shared";

export function Crumbs(props: { label: string; items: { label: string; current?: boolean; disabled?: boolean; onClick?: () => void }[] }) {
  return <nav class="ui-crumbs" aria-label={props.label}><For each={props.items}>{(item, index) => <>
    <Show when={index() > 0}><span class="ui-crumbs-sep" aria-hidden="true">›</span></Show>
    <button type="button" aria-current={item.current ? "true" : undefined} disabled={item.disabled} onClick={() => item.onClick?.()}>{item.label}</button>
  </>}</For></nav>;
}

export function Leader(props: { label?: string; placement?: "foot"; "data-shortcut-leader-palette"?: string; path?: JSX.Element; hints?: JSX.Element; motion?: Motion; children?: JSX.Element }) {
  // It never takes focus: the keys belong to where the leader started, and a click on it (a level, a row) keeps focus
  // there rather than ending the sequence before the click lands.
  return <div class="ui-leader-placement" data-placement={props.placement} data-shortcut-leader-palette={props["data-shortcut-leader-palette"]}
    onMouseDown={(event) => event.preventDefault()}>
    <Overlay label={props.label ?? "Leader"} class="ui-leader" motion={props.motion}><Show when={props.path}><OverlayHead>{props.path}</OverlayHead></Show>
      <Show when={props.children}><OverlayList>{props.children}</OverlayList></Show>{props.hints}</Overlay>
  </div>;
}

export function Spotlight(props: { lit?: { top: string; left: string; width: string; height: string; radius?: string }; fixed?: boolean; tour?: boolean; motion?: Motion; class?: string; children?: JSX.Element }) {
  return <div class={cn("ui-spotlight", props.tour && "ui-tour-spotlight", props.class)} data-fixed={props.fixed ? "" : undefined} {...motionOf(props.motion)} aria-hidden="true">
    <div class="ui-spotlight-lit" data-whole={props.lit ? undefined : ""} style={props.lit ? { top: props.lit.top, left: props.lit.left, width: props.lit.width, height: props.lit.height, "border-radius": props.lit.radius } : {}} />
    {props.children}
  </div>;
}
