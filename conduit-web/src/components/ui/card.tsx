import { Show, type JSX } from "solid-js";
import { XIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import { Button } from "./controls";
import { type Density, type Motion, motionOf } from "./shared";

/** size wide: a card that holds content (a list, an excerpt, an editor). close: a × in its corner, for a card with no Cancel. */
export function Card(props: { title: string; detail?: JSX.Element; class?: string; density?: Density; size?: "wide"; close?: boolean | (() => void); actions?: JSX.Element; motion?: Motion; children?: JSX.Element }) {
  return <div role="dialog" aria-label={props.title} class={cn("ui-frost ui-card", props.class)} data-density={props.density} data-size={props.size} data-close={props.close ? "" : undefined} data-surface="frost" data-lift="raised" {...motionOf(props.motion)}>
    <h3>{props.title}</h3><Show when={props.detail}><p>{props.detail}</p></Show>
    <Show when={props.close}><Button variant="ghost" size="icon-sm" class="ui-card-close" aria-label="Close" onClick={() => typeof props.close === "function" && props.close()}><XIcon /></Button></Show>
    {props.children}
    <Show when={props.actions}><div class="ui-card-actions">{props.actions}</div></Show>
  </div>;
}
