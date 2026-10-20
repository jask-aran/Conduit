import { For, Show, splitProps, type JSX } from "solid-js";
import { CheckIcon, ChevronRightIcon, ExternalLinkIcon, SearchIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import { Keycap } from "./controls";
import { type Density, type Motion, hovers, motionOf, moveCursor } from "./shared";

/** under: a phone's submenu is open as a panel over it, so it dims and takes no taps. */
/** wide: a readout rather than a list, at a measure of its own (the context breakdown). */
/** A measure (Foundations · Space): a popover's width or height cap. */
export type Measure = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
/**
 * A popover is as wide as its rows and as tall as they are, inside two caps -- a phone's narrower and shorter by
 * default (--menu-width-cap, --menu-height-cap) -- and the room its host leaves it (--menu-room: the adapter gives
 * it Kobalte's, inside the safe area); past that it scrolls. width, height: this popover's own caps, in a measure.
 */
export function Menu(props: JSX.HTMLAttributes<HTMLDivElement> & { density?: Density; motion?: Motion; under?: boolean; wide?: boolean; width?: Measure; height?: Measure }) {
  const [, rest] = splitProps(props, ["class", "density", "motion", "under", "wide", "width", "height", "children", "style"]);
  const caps = () => ({ ...(props.width ? { "--menu-width": `var(--measure-${props.width})` } : {}), ...(props.height ? { "--menu-height": `var(--measure-${props.height})` } : {}), ...(typeof props.style === "object" ? props.style : {}) });
  return <div role="menu" class={cn("ui-frost ui-menu", props.class)} onPointerOver={moveCursor} {...rest} style={caps()} data-wide={props.wide ? "" : undefined} data-density={props.density} data-surface="frost" data-lift="raised" data-under={props.under ? "" : undefined} {...motionOf(props.motion)}>{props.children}</div>;
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
  /** end: a control at the row's end, after its meta (a remove ×); reveal: shown only on the lit or hovered row, never on a phone. */
  end?: JSX.Element; reveal?: boolean;
  /** away: choosing it opens somewhere else (another window or origin): the mark sits where a submenu's chevron does. */
  away?: boolean;
  /** onCursor: the pointer is over the row, for a list that keeps its own cursor (never a touch: see moveCursor). */
  onCursor?: () => void;
  /** onOpens: the chevron is a press of its own (a folder's: open it in place, where the row's press goes in); aria-expanded turns it. */
  onOpens?: () => void; opensLabel?: string;
  /** indent: a child, under the row it belongs to. picked: in an edit, chosen or not -- a check column, and the wash on each chosen. */
  indent?: boolean; picked?: boolean;
}) {
  const [, rest] = splitProps(props, ["icon", "meta", "detail", "keys", "opens", "active", "field", "keysFirst", "checked", "disabled", "destructive", "children", "end", "class", "onOpens", "opensLabel", "indent", "picked", "reveal", "away", "onCursor"]);
  return <div role={props.checked !== undefined ? "menuitemradio" : "menuitem"} class="ui-row" aria-checked={props.checked} data-field={props.field ? "" : undefined}
    data-highlighted={props.active ? "" : undefined} data-checked={props.checked ? "" : undefined} data-disabled={props.disabled ? "" : undefined} data-destructive={props.destructive ? "" : undefined} data-indent={props.indent ? "" : undefined} data-picked={props.picked ? "" : undefined} onPointerMove={props.onCursor ? (event: PointerEvent) => { if (hovers(event)) props.onCursor!(); } : undefined} {...rest}>
    <Show when={props.picked !== undefined}><span class="ui-row-check" aria-hidden="true"><Show when={props.picked}><CheckIcon /></Show></span></Show>
    <Show when={props.keysFirst && props.keys}><Keys keys={props.keys!} first /></Show>
    <Show when={props.icon}><span class="ui-icon">{props.icon}</span></Show><span class="ui-label" data-stacked={props.detail ? "" : undefined}><Show when={props.detail} fallback={props.children}><span>{props.children}</span><small class="ui-detail">{props.detail}</small></Show></span>
    <Show when={props.meta}><small>{props.meta}</small></Show>
    <Show when={!props.keysFirst && props.keys}><Keys keys={props.keys!} /></Show>
    <Show when={props.opens}><Show when={props.onOpens} fallback={<ChevronRightIcon class="ui-chevron" />}>
      <button type="button" class="ui-chevron" tabIndex={-1} aria-label={props.opensLabel} onMouseDown={(event) => event.preventDefault()} onClick={(event) => { event.stopPropagation(); props.onOpens?.(); }}><ChevronRightIcon /></button>
    </Show></Show>
    <Show when={props.away && !props.opens}><ExternalLinkIcon class="ui-chevron" data-away="" aria-hidden="true" /></Show>
    <Show when={props.end}><span class="ui-row-end" data-reveal={props.reveal ? "" : undefined}>{props.end}</span></Show>
  </div>;
}

/** The letters of a label a query matched: the run when it holds the query, else its letters in order; null when it
 *  matched on something unseen (a keyword). */
export function matchedLetters(text: string, query: string): Set<number> | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const lower = text.toLowerCase();
  const at = lower.indexOf(q);
  if (at >= 0) return new Set(Array.from({ length: q.length }, (_, index) => at + index));
  const hits = new Set<number>();
  let from = 0;
  for (const char of q.replace(/\s+/g, "")) {
    const index = lower.indexOf(char, from);
    if (index < 0) return null;
    hits.add(index); from = index + 1;
  }
  return hits;
}

/** Typing lights the match: the matched letters white and heavier, the rest of the label muted. A keyword-only match stays plain. */
export function Match(props: { text: string; query: string }) {
  const hits = () => matchedLetters(props.text, props.query);
  return <Show when={hits()} fallback={props.text}>{(lit) =>
    <span class="ui-match">{[...props.text].map((char, index) => lit().has(index) ? <b>{char}</b> : char)}</span>}</Show>;
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
export const MenuPanel = (props: JSX.HTMLAttributes<HTMLDivElement> & { width?: Measure; height?: Measure }) => <Menu {...props} class="ui-menu-panel" />;
export const MenuNote = (props: { children: JSX.Element; error?: boolean }) => <p class="ui-menu-note" role={props.error ? "alert" : undefined} data-error={props.error ? "" : undefined}>{props.children}</p>;
