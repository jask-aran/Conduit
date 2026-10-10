import { createEffect, createSignal, createUniqueId, For, Show, splitProps, type JSX } from "solid-js";
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import "./library.css";

/*
 * The unified library (library.css). Shapes only: no behaviour, so the same
 * pieces can later sit inside Kobalte menus, popovers and dialogs.
 */

export type Lift = "rest" | "raised";

export function Frost(props: { lift?: Lift; core?: boolean; class?: string; style?: JSX.CSSProperties; children?: JSX.Element }) {
  return <div class={cn("ui-frost", props.class)} data-surface="frost" data-lift={props.lift ?? "rest"} data-core={props.core ? "" : undefined} style={props.style}>{props.children}</div>;
}

/** solo: a lone floating frost button (the composer's +), a circle rather than a capsule. */
export function Pill(props: { icons: { label: string; icon: JSX.Element }[]; solo?: boolean; onPick?: (label: string) => void }) {
  return <div class="ui-frost ui-pill" data-solo={props.icons.length === 1 && props.solo ? "" : undefined}><For each={props.icons}>{(item) => <button type="button" aria-label={item.label} title={item.label}
    onClick={(event) => { if (props.onPick) { event.stopPropagation(); props.onPick(item.label); } }}>{item.icon}</button>}</For></div>;
}

/**
 * desktop or phone: the rules a shell's sections and items are built at. The
 * layout sets it once (the phone layout's media rule in library.css, or
 * data-density on an ancestor); a shell inherits it and its sections follow.
 * The prop is an override, for drawing one layout inside another.
 */
export type Density = "desktop" | "phone";

export function Menu(props: { class?: string; core?: boolean; density?: Density; children: JSX.Element }) {
  return <div role="menu" class={cn("ui-frost ui-menu", props.class)} data-density={props.density} data-surface="frost" data-lift="raised" data-core={props.core ? "" : undefined}>{props.children}</div>;
}

/** A menu's section: a list of items (the default) or a slider, with an optional title and a note beside it. */
export function Section(props: { title?: string; note?: JSX.Element; kind?: "list" | "slider"; children: JSX.Element }) {
  return <div role="group" aria-label={props.title} class="ui-section" data-kind={props.kind ?? "list"}>
    <Show when={props.title}><div class="ui-title"><span>{props.title}</span><Show when={props.note}><small>{props.note}</small></Show></div></Show>
    {props.children}
  </div>;
}

/** A search section: the field alone. It filters the list section after it, or opens a full search; keys shows its shortcut, which a phone variant never shows. */
export function SearchSection(props: { placeholder: string; value?: string; keys?: string[]; onInput?: (value: string) => void }) {
  return <div role="search" class="ui-section ui-search-section" data-kind="search">
    <SearchIcon /><input class="ui-search" placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />
    <Show when={props.keys}><span class="ui-keys"><For each={props.keys}>{(key) => <kbd class="ui-keycap">{key}</kbd>}</For></span></Show>
  </div>;
}

/** A heading section: what the popover is about -- a title and a line under it (the chat menu's top). */
export function HeadingSection(props: { title: string; detail?: JSX.Element; children?: JSX.Element }) {
  return <div class="ui-section ui-heading" data-kind="heading">
    <div class="ui-heading-title">{props.title}</div><Show when={props.detail}><div class="ui-heading-detail">{props.detail}</div></Show>
    {props.children}
  </div>;
}

/** An item in a list section. Icon, meta, keys and opens are its parts; checked, disabled and destructive its states. */
export function Item(props: {
  icon?: JSX.Element; meta?: JSX.Element; keys?: string[]; opens?: boolean; active?: boolean;
  /** field: the label is a field name (title type) and meta its value, as in "CONTEXT  Unavailable ›". */
  field?: boolean; onClick?: () => void;
  checked?: boolean; disabled?: boolean; destructive?: boolean; children: JSX.Element;
}) {
  return <div role={props.checked !== undefined ? "menuitemradio" : "menuitem"} class="ui-row" aria-checked={props.checked} data-field={props.field ? "" : undefined} onClick={props.onClick}
    data-highlighted={props.active ? "" : undefined} data-checked={props.checked ? "" : undefined} data-disabled={props.disabled ? "" : undefined} data-destructive={props.destructive ? "" : undefined}>
    <Show when={props.icon}><span class="ui-icon">{props.icon}</span></Show><span class="ui-label">{props.children}</span>
    <Show when={props.meta}><small>{props.meta}</small></Show>
    <Show when={props.keys}><span class="ui-keys"><For each={props.keys}>{(key) => <kbd class="ui-keycap">{key}</kbd>}</For></span></Show>
    <Show when={props.opens}><ChevronRightIcon class="ui-chevron" /></Show>
  </div>;
}

export const Keycap = (props: { children: JSX.Element }) => <kbd class="ui-keycap">{props.children}</kbd>;

export function Card(props: { title: string; detail?: string; class?: string; core?: boolean; density?: Density; actions?: JSX.Element; children?: JSX.Element }) {
  return <div role="dialog" aria-label={props.title} class={cn("ui-frost ui-card", props.class)} data-density={props.density} data-surface="frost" data-lift="raised" data-core={props.core ? "" : undefined}>
    <h3>{props.title}</h3><Show when={props.detail}><p>{props.detail}</p></Show>
    {props.children}
    <Show when={props.actions}><div class="ui-card-actions">{props.actions}</div></Show>
  </div>;
}

export const Bubble = (props: { children: JSX.Element }) => <div class="ui-frost ui-bubble">{props.children}</div>;


/* What sits on a surface: the look follows [data-surface] above it (library.css). */

export type ButtonVariant = "primary" | "outline" | "ghost" | "destructive";
export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "default" | "sm" | "icon" | "icon-sm" }) {
  const [local, rest] = splitProps(props, ["class", "variant", "size"]);
  return <button type="button" {...rest} class={cn("ui-button", local.class)} data-variant={local.variant ?? "primary"} data-size={local.size ?? "default"} />;
}

export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <input {...rest} class={cn("ui-input", local.class)} />;
}

/** A select's trigger: a field with a chevron, or bare (its value and a chevron, as in a settings row). */
export function SelectTrigger(props: { value: string; bare?: boolean; onClick?: () => void }) {
  return <button type="button" class="ui-input" data-bare={props.bare ? "" : undefined} onClick={props.onClick}><span>{props.value}</span><ChevronDownIcon /></button>;
}

export function Segmented<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string; icon?: JSX.Element; count?: number }>; onChange: (value: T) => void; pill?: boolean; icons?: boolean }) {
  const index = () => Math.max(0, props.options.findIndex((option) => option.value === props.value));
  return <div role="radiogroup" aria-label={props.label} class={props.pill ? "ui-seg ui-frost" : "ui-seg"} data-pill={props.pill ? "" : undefined} data-icons={props.icons || props.pill ? "" : undefined}
    style={{ "--segments": props.options.length, "--segment": index() }}>
    <span class="ui-seg-thumb" aria-hidden="true" />
    <For each={props.options}>{(option) => <button type="button" role="radio" aria-checked={option.value === props.value} aria-label={props.icons || props.pill ? option.label : undefined} title={props.icons || props.pill ? option.label : undefined}
      onClick={() => props.onChange(option.value)}>{option.icon}{props.icons || props.pill ? null : <span>{option.label}</span>}{option.count !== undefined && <small>{option.count}</small>}</button>}</For>
  </div>;
}

/**
 * One choice from an ordered list, set by sliding along it (the app's
 * StepSlider, at the library's density). The value follows the thumb and is
 * chosen on release; with onOpen the value is an item that opens the levels.
 */
export function Slider(props: { label: string; options: { value: string; label: string }[]; value: string; disabled?: boolean; onChange: (value: string) => void; onOpen?: () => void }) {
  const id = createUniqueId();
  const indexOf = (value: string) => Math.max(0, props.options.findIndex((option) => option.value === value));
  const [preview, setPreview] = createSignal(indexOf(props.value));
  createEffect(() => setPreview(indexOf(props.value)));
  const shown = () => props.options[preview()]?.label ?? "";
  const commit = (index: number) => { const option = props.options[index]; if (option && option.value !== props.value) props.onChange(option.value); };
  return <div class="ui-slider" data-disabled={props.disabled ? "" : undefined}
    onKeyDown={(event) => { if (event.target instanceof HTMLInputElement && event.key !== "Escape" && event.key !== "Tab") event.stopPropagation(); }}>
    <div class="ui-slider-head">
      <label for={id} class="ui-title-text">{props.label}</label>
      <Show when={props.onOpen} fallback={<span class="ui-slider-value">{shown()}</span>}>
        <button type="button" class="ui-slider-value" data-opens disabled={props.disabled} onClick={() => props.onOpen?.()}>{shown()}<ChevronRightIcon /></button>
      </Show>
    </div>
    <input id={id} class="ui-slider-input" type="range" min={0} max={Math.max(0, props.options.length - 1)} step={1} value={preview()} disabled={props.disabled} aria-valuetext={shown()}
      style={{ "--fill": `${props.options.length > 1 ? (preview() / (props.options.length - 1)) * 100 : 0}%` }}
      onInput={(event) => setPreview(Number(event.currentTarget.value))} onChange={(event) => commit(Number(event.currentTarget.value))} />
    <div class="ui-slider-ticks" aria-hidden="true"><For each={props.options}>{(_, index) => <i data-reached={index() <= preview() ? "" : undefined} />}</For></div>
  </div>;
}
