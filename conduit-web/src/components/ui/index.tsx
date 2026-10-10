import { createSignal, For, Show, splitProps, type JSX } from "solid-js";
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

/** A menu's section: a list of items (the default) or a slider, with an optional title and a note beside it. */
export function Section(props: { title?: string; note?: JSX.Element; kind?: "list" | "slider"; children: JSX.Element }) {
  return <div role="group" aria-label={props.title} class="ui-section" data-kind={props.kind ?? "list"}>
    <Show when={props.title}><div class="ui-title"><span>{props.title}</span><Show when={props.note}><small>{props.note}</small></Show></div></Show>
    {props.children}
  </div>;
}

/** A section whose field filters its items. */
export function SearchSection<T>(props: { title?: string; placeholder: string; items: T[]; matches: (item: T, needle: string) => boolean; children: (item: T) => JSX.Element }) {
  const [query, setQuery] = createSignal("");
  const shown = () => { const needle = query().trim().toLowerCase(); return needle ? props.items.filter((item) => props.matches(item, needle)) : props.items; };
  return <Section title={props.title}>
    <input class="ui-search" placeholder={props.placeholder} value={query()} onInput={(event) => setQuery(event.currentTarget.value)} />
    <For each={shown()} fallback={<div class="ui-empty">Nothing matches</div>}>{props.children}</For>
  </Section>;
}

/** An item in a list section. Icon, meta, keys and opens are its parts; checked, disabled and destructive its states. */
export function Item(props: {
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

export type ButtonVariant = "primary" | "frost" | "ghost" | "destructive";
export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "default" | "sm" | "icon" | "icon-sm" }) {
  const [local, rest] = splitProps(props, ["class", "variant", "size"]);
  return <button type="button" {...rest} class={cn("ui-button", local.class)} data-variant={local.variant ?? "primary"} data-size={local.size ?? "default"} />;
}

export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <input {...rest} class={cn("ui-input", local.class)} />;
}
