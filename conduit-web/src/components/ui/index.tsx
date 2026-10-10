import { For, Show, type JSX } from "solid-js";
import { ChevronRightIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import "./library.css";

/*
 * The unified library (library.css). Shapes only: no behaviour, so the same
 * pieces can later sit inside Kobalte menus, popovers and dialogs.
 */

export type Lift = "rest" | "raised";

export function Frost(props: { lift?: Lift; core?: boolean; class?: string; style?: JSX.CSSProperties; children?: JSX.Element }) {
  return <div class={cn("ui-frost", props.class)} data-lift={props.lift ?? "rest"} data-core={props.core ? "" : undefined} style={props.style}>{props.children}</div>;
}

export function Pill(props: { icons: { label: string; icon: JSX.Element }[] }) {
  return <div class="ui-frost ui-pill"><For each={props.icons}>{(item) => <button type="button" aria-label={item.label} title={item.label}>{item.icon}</button>}</For></div>;
}

export function Menu(props: { class?: string; core?: boolean; children: JSX.Element }) {
  return <div role="menu" class={cn("ui-frost ui-menu", props.class)} data-lift="raised" data-core={props.core ? "" : undefined}>{props.children}</div>;
}

export function Title(props: { children: JSX.Element; aside?: JSX.Element }) {
  return <div class="ui-title"><span>{props.children}</span><Show when={props.aside}><small>{props.aside}</small></Show></div>;
}

export const Sep = () => <div role="separator" class="ui-sep" />;

export function Row(props: {
  icon?: JSX.Element; meta?: JSX.Element; keys?: string[]; opens?: boolean;
  checked?: boolean; disabled?: boolean; destructive?: boolean; children: JSX.Element;
}) {
  return <div role={props.checked !== undefined ? "menuitemradio" : "menuitem"} class="ui-row" aria-checked={props.checked}
    data-checked={props.checked ? "" : undefined} data-disabled={props.disabled ? "" : undefined} data-destructive={props.destructive ? "" : undefined}>
    {props.icon}<span class="ui-label">{props.children}</span>
    <Show when={props.meta}><small>{props.meta}</small></Show>
    <Show when={props.keys}><span class="ui-keys"><For each={props.keys}>{(key) => <kbd class="ui-keycap">{key}</kbd>}</For></span></Show>
    <Show when={props.opens}><ChevronRightIcon class="ui-chevron" /></Show>
  </div>;
}

export const Keycap = (props: { children: JSX.Element }) => <kbd class="ui-keycap">{props.children}</kbd>;

export function Card(props: { title: string; detail?: string; class?: string; core?: boolean; actions?: JSX.Element; children?: JSX.Element }) {
  return <div role="dialog" aria-label={props.title} class={cn("ui-frost ui-card", props.class)} data-lift="raised" data-core={props.core ? "" : undefined}>
    <h3>{props.title}</h3><Show when={props.detail}><p>{props.detail}</p></Show>
    {props.children}
    <Show when={props.actions}><div class="ui-card-actions">{props.actions}</div></Show>
  </div>;
}

export const Bubble = (props: { children: JSX.Element }) => <div class="ui-frost ui-bubble">{props.children}</div>;
