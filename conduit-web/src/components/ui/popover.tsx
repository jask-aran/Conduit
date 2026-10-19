import { For, Show, splitProps, type JSX } from "solid-js";
import { ChevronRightIcon, SearchIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import { Keycap } from "./controls";
import { type Density, type Motion, motionOf, moveCursor } from "./shared";

/** under: a phone's submenu is open as a panel over it, so it dims and takes no taps. */
/** wide: a readout rather than a list, at a measure of its own (the context breakdown). */
export function Menu(props: JSX.HTMLAttributes<HTMLDivElement> & { density?: Density; motion?: Motion; under?: boolean; wide?: boolean }) {
  const [, rest] = splitProps(props, ["class", "density", "motion", "under", "wide", "children"]);
  return <div role="menu" class={cn("ui-frost ui-menu", props.class)} onPointerOver={moveCursor} {...rest} data-wide={props.wide ? "" : undefined} data-density={props.density} data-surface="frost" data-lift="raised" data-under={props.under ? "" : undefined} {...motionOf(props.motion)}>{props.children}</div>;
}

/** A menu's section: a list of items (the default) or a slider, with an optional title and a note beside it.
 *  scroll: a long list scrolls in its own height (a pick list under its search). */
export function Section(props: JSX.HTMLAttributes<HTMLDivElement> & { note?: JSX.Element; kind?: "list" | "slider"; scroll?: boolean }) {
  const [, rest] = splitProps(props, ["title", "note", "kind", "scroll", "children", "class", "role"]);
  return <div {...rest} role={props.role ?? "group"} aria-label={props.title} class="ui-section" data-kind={props.kind ?? "list"} data-scroll={props.scroll ? "" : undefined}>
    <Show when={props.title}><div class="ui-title"><span>{props.title}</span><Show when={props.note}><small>{props.note}</small></Show></div></Show>
    {props.children}
  </div>;
}

/** A search section: the field alone. It filters the list section after it, or opens a full search; keys shows its shortcut, which a phone variant never shows.
 *  field: what a behaviour adds to the input (combobox state, keys, focus). */
export function SearchSection(props: { placeholder: string; value?: string; keys?: string[]; onInput?: (value: string) => void; field?: JSX.InputHTMLAttributes<HTMLInputElement> }) {
  return <div role="search" class="ui-section ui-search-section" data-kind="search">
    <SearchIcon /><input {...props.field} class="ui-search" placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />
    <Show when={props.keys}><Keys keys={props.keys!} /></Show>
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
export function Item(props: JSX.HTMLAttributes<HTMLDivElement> & {
  icon?: JSX.Element; meta?: JSX.Element; detail?: JSX.Element; keys?: string[]; opens?: boolean; active?: boolean;
  /** field: the label is a field name (title type) and meta its value, as in "CONTEXT  Unavailable ›". */
  field?: boolean;
  /** keysFirst: the keycaps lead the row (the leader menu, where the key is what you read first). */
  keysFirst?: boolean;
  checked?: boolean; disabled?: boolean; destructive?: boolean; children: JSX.Element;
  /** end: a control at the row's end, after its meta (a remove ×). */
  end?: JSX.Element;
}) {
  const [, rest] = splitProps(props, ["icon", "meta", "detail", "keys", "opens", "active", "field", "keysFirst", "checked", "disabled", "destructive", "children", "end", "class"]);
  return <div role={props.checked !== undefined ? "menuitemradio" : "menuitem"} class="ui-row" aria-checked={props.checked} data-field={props.field ? "" : undefined}
    data-highlighted={props.active ? "" : undefined} data-checked={props.checked ? "" : undefined} data-disabled={props.disabled ? "" : undefined} data-destructive={props.destructive ? "" : undefined} {...rest}>
    <Show when={props.keysFirst && props.keys}><Keys keys={props.keys!} first /></Show>
    <Show when={props.icon}><span class="ui-icon">{props.icon}</span></Show><span class="ui-label" data-stacked={props.detail ? "" : undefined}><Show when={props.detail} fallback={props.children}><span>{props.children}</span><small class="ui-detail">{props.detail}</small></Show></span>
    <Show when={props.meta}><small>{props.meta}</small></Show>
    <Show when={!props.keysFirst && props.keys}><Keys keys={props.keys!} /></Show>
    <Show when={props.opens}><ChevronRightIcon class="ui-chevron" /></Show>
    <Show when={props.end}><span class="ui-row-end">{props.end}</span></Show>
  </div>;
}

/** Typing lights the match: the matched letters white and heavier, the rest of the label muted. A keyword-only match stays plain. */
export function Match(props: { text: string; query: string }) {
  const at = () => props.query ? props.text.toLowerCase().indexOf(props.query.toLowerCase()) : -1;
  return <Show when={at() >= 0} fallback={props.text}><span class="ui-match">{props.text.slice(0, at())}<b>{props.text.slice(at(), at() + props.query.length)}</b>{props.text.slice(at() + props.query.length)}</span></Show>;
}

/** A run of keys, a keycap each; first: they lead the row (the leader). */
const Keys = (props: { keys: string[]; first?: boolean }) => <span class="ui-keys" data-first={props.first ? "" : undefined}><For each={props.keys}>{(key) => <Keycap>{key}</Keycap>}</For></span>;

/** A line of a readout: what it is, and its value at the end (a total, a cost, a reset time). */
export const Readout = (props: { label: JSX.Element; value?: JSX.Element }) => <div class="ui-readout"><span>{props.label}</span><Show when={props.value}><span>{props.value}</span></Show></div>;

/** A rule between groups of a menu's rows, where it has no sections. */
export const Rule = () => <hr class="ui-rule" />;
/** A row's meta: muted, after its label (a value, a latency). */
export const Meta = (props: { children: JSX.Element }) => <span class="ui-meta">{props.children}</span>;

/** A behavior engine can supply focus, selection and keyboard attributes. */
export const MenuAction = (props: JSX.HTMLAttributes<HTMLDivElement>) => <div {...props} class="ui-row ui-menu-action" />;

/** Menu panels keep the parent in place; the behavior adapter supplies coordinates. */
export const MenuParent = (props: JSX.HTMLAttributes<HTMLDivElement> & { under: boolean }) => {
  const [local, rest] = splitProps(props, ["under"]);
  return <div {...rest} class="ui-menu-parent" data-under={local.under ? "" : undefined} />;
};
export const MenuPanel = (props: JSX.HTMLAttributes<HTMLDivElement>) => <Menu {...props} class="ui-menu-panel" />;
export const MenuNote = (props: { children: JSX.Element; error?: boolean }) => <p class="ui-menu-note" role={props.error ? "alert" : undefined} data-error={props.error ? "" : undefined}>{props.children}</p>;
