import { createEffect, createSignal, createUniqueId, For, Show, splitProps, type JSX } from "solid-js";
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, SearchIcon, XIcon } from "lucide-solid";
export { ChevronDownIcon };
import { cn } from "@/lib/utils";

/*
 * Components v2 (conduit-components-v2): the unified library (library.css).
 * UI that is "components v2" is built from these pieces and their tokens alone,
 * so a change to a base token reaches every use. Shapes only: no behaviour, so the same
 * pieces can later sit inside Kobalte menus, popovers and dialogs.
 */

export type Lift = "rest" | "raised";

export function Frost(props: { lift?: Lift; core?: boolean; class?: string; style?: JSX.CSSProperties; children?: JSX.Element }) {
  return <div class={cn("ui-frost", props.class)} data-surface="frost" data-lift={props.lift ?? "rest"} data-core={props.core ? "" : undefined} style={props.style}>{props.children}</div>;
}

/*
 * Pill: the phone's floating frost controls, one family on shared tokens
 * (--pill-*). The kind decides the shape, never a prop:
 *   PillButton  one action: a circle (stretch: across its row, as the mic)
 *   PillGroup   several actions in one capsule, a pill-shaped target each
 *   PillSwitch  a group where one slot is chosen, under a sliding thumb
 *   PillField   a capsule holding text (the phone composer's field)
 */
type PillAction = { label: string; icon: JSX.Element };
const pillSlot = (item: PillAction, onPick?: (label: string) => void) => <button type="button" aria-label={item.label} title={item.label}
  onClick={(event) => { if (onPick) { event.stopPropagation(); onPick(item.label); } }}>{item.icon}</button>;

export function PillButton(props: PillAction & { stretch?: boolean; onPick?: (label: string) => void }) {
  return <div class="ui-frost ui-pill" data-solo="" data-stretch={props.stretch ? "" : undefined}>{pillSlot(props, props.onPick)}</div>;
}
export function PillGroup(props: { actions: PillAction[]; onPick?: (label: string) => void }) {
  return <div class="ui-frost ui-pill"><For each={props.actions}>{(item) => pillSlot(item, props.onPick)}</For></div>;
}
export function PillSwitch<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string; icon: JSX.Element }>; onChange: (value: T) => void }) {
  return <Segmented pill icons label={props.label} value={props.value} options={props.options} onChange={props.onChange} />;
}
/** Its own textarea, or the caller's field as children (the composer's, with its behaviour). */
export function PillField(props: { placeholder?: string; value?: string; onInput?: (value: string) => void; class?: string; children?: JSX.Element }) {
  return <div class={cn("ui-frost ui-pill ui-pill-field", props.class)}><Show when={props.children} fallback={<TextArea placeholder={props.placeholder} value={props.value} onInput={props.onInput} />}>{props.children}</Show></div>;
}

/**
 * desktop or phone: the rules a shell's sections and items are built at. The
 * layout sets it once (the phone layout's media rule in library.css, or
 * data-density on an ancestor); a shell inherits it and its sections follow.
 * The prop is an override, for drawing one layout inside another.
 */
export type Density = "desktop" | "phone";

/**
 * The one cursor (DESIGN Interaction): the pointer moves it, as the keyboard
 * does, so only one row of a list is ever washed. A list's container passes
 * this to onPointerOver; a row is a ui-row (data-highlighted) or a ui-choice (data-active).
 */
export function moveCursor(event: PointerEvent & { currentTarget: Element }) {
  const row = (event.target as Element).closest(".ui-row, .ui-choice");
  if (!row || !event.currentTarget.contains(row) || row.hasAttribute("data-disabled")) return;
  const attr = row.classList.contains("ui-choice") ? "data-active" : "data-highlighted";
  if (row.getAttribute(attr) === (attr === "data-active" ? "true" : "")) return;
  event.currentTarget.querySelectorAll(`[${attr}]`).forEach((other) => other.removeAttribute(attr));
  row.setAttribute(attr, attr === "data-active" ? "true" : "");
}

export function Menu(props: { class?: string; density?: Density; children: JSX.Element }) {
  return <div role="menu" class={cn("ui-frost ui-menu", props.class)} onPointerOver={moveCursor} data-density={props.density} data-surface="frost" data-lift="raised">{props.children}</div>;
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
  icon?: JSX.Element; meta?: JSX.Element; detail?: JSX.Element; keys?: string[]; opens?: boolean; active?: boolean;
  /** field: the label is a field name (title type) and meta its value, as in "CONTEXT  Unavailable ›". */
  field?: boolean; onClick?: () => void;
  /** keysFirst: the keycaps lead the row (the leader menu, where the key is what you read first). */
  keysFirst?: boolean;
  checked?: boolean; disabled?: boolean; destructive?: boolean; children: JSX.Element;
}) {
  return <div role={props.checked !== undefined ? "menuitemradio" : "menuitem"} class="ui-row" aria-checked={props.checked} data-field={props.field ? "" : undefined} onClick={props.onClick}
    data-highlighted={props.active ? "" : undefined} data-checked={props.checked ? "" : undefined} data-disabled={props.disabled ? "" : undefined} data-destructive={props.destructive ? "" : undefined}>
    <Show when={props.keysFirst && props.keys}><span class="ui-keys" data-first><For each={props.keys}>{(key) => <kbd class="ui-keycap">{key}</kbd>}</For></span></Show>
    <Show when={props.icon}><span class="ui-icon">{props.icon}</span></Show><span class="ui-label" data-stacked={props.detail ? "" : undefined}><Show when={props.detail} fallback={props.children}><span>{props.children}</span><small class="ui-detail">{props.detail}</small></Show></span>
    <Show when={props.meta}><small>{props.meta}</small></Show>
    <Show when={!props.keysFirst && props.keys}><span class="ui-keys"><For each={props.keys}>{(key) => <kbd class="ui-keycap">{key}</kbd>}</For></span></Show>
    <Show when={props.opens}><ChevronRightIcon class="ui-chevron" /></Show>
  </div>;
}

/** Typing lights the match: the matched letters white and heavier, the rest of the label muted. A keyword-only match stays plain. */
export function Match(props: { text: string; query: string }) {
  const at = () => props.query ? props.text.toLowerCase().indexOf(props.query.toLowerCase()) : -1;
  return <Show when={at() >= 0} fallback={props.text}><span class="ui-match">{props.text.slice(0, at())}<b>{props.text.slice(at(), at() + props.query.length)}</b>{props.text.slice(at() + props.query.length)}</span></Show>;
}

export const Keycap = (props: { children: JSX.Element }) => <kbd class="ui-keycap">{props.children}</kbd>;

export function Card(props: { title: string; detail?: string; class?: string; density?: Density; actions?: JSX.Element; children?: JSX.Element }) {
  return <div role="dialog" aria-label={props.title} class={cn("ui-frost ui-card", props.class)} data-density={props.density} data-surface="frost" data-lift="raised">
    <h3>{props.title}</h3><Show when={props.detail}><p>{props.detail}</p></Show>
    {props.children}
    <Show when={props.actions}><div class="ui-card-actions">{props.actions}</div></Show>
  </div>;
}

/*
 * DesktopComposer: resting frost holding a Field above a Toolbar, desktop only
 * (a phone's composer is Pills). Its field is a TextArea (a control), which it pads. Geometry is
 * tokens (--cmp-*), measured from the app and scaled by density; its width is
 * the pane's to declare (--composer-width).
 */
export function DesktopComposer(props: { riders?: JSX.Element; class?: string; children: JSX.Element }) {
  return <div class="ui-composer-stack ui-composer-width">{props.riders}<div class={cn("ui-frost ui-desktop-composer", props.class)} data-surface="frost" data-lift="rest">{props.children}</div></div>;
}
/** The composer's field slot: where its TextArea (or the app's, with its behaviour) sits, padded by the composer. */
export const ComposerField = (props: { children: JSX.Element }) => <div class="ui-composer-field">{props.children}</div>;
/** A row of controls: start (leading) and end (trailing) groups. */
export function Toolbar(props: { start?: JSX.Element; end?: JSX.Element; class?: string }) {
  return <div class={cn("ui-toolbar", props.class)}><div class="ui-toolbar-start">{props.start}</div><div class="ui-toolbar-end">{props.end}</div></div>;
}

/*
 * Rider: frost on a composer's top edge, either composer's. A row (title,
 * body, actions), a strip (chips, actions) or a card (the question).
 */
export function Rider(props: { label?: string; layout?: "row" | "strip" | "card"; class?: string; children: JSX.Element }) {
  return <div class={cn("ui-frost ui-rider", props.class)} data-surface="frost" data-lift="rest" data-layout={props.layout ?? "row"} role="group" aria-label={props.label}>{props.children}</div>;
}
export const RiderTitle = (props: { children: JSX.Element }) => <span class="ui-title-text">{props.children}</span>;
export const RiderActions = (props: { stack?: boolean; children: JSX.Element }) => <div class="ui-rider-actions" data-stack={props.stack ? "" : undefined}>{props.children}</div>;
/** A line of waiting text, one line until opened. */
export function Line(props: { text: string; clipped?: boolean }) {
  const [open, setOpen] = createSignal(false);
  return <li class="ui-line" data-expanded={open() ? "true" : "false"}><p class="ui-line-body">{props.text}</p>
    <Show when={props.clipped}><button type="button" class="ui-line-more" aria-label={open() ? "Show less" : "Show more"} onClick={() => setOpen(!open())}><ChevronDownIcon /></button></Show></li>;
}
/** An attached thing: an image's thumbnail, or a file's mark, name and size. */
export function Chip(props: { name: string; detail?: string; image?: string; icon?: JSX.Element; status?: "uploading" | "error" | "done"; progress?: number }) {
  const ring = 2 * Math.PI * 9;
  return <div class="ui-chip" data-kind={props.image ? "image" : "file"} data-status={props.status ?? "done"}>
    <button type="button" class="ui-chip-body" aria-label={`Show ${props.name}`}>
      <span class="ui-chip-media"><Show when={props.image} fallback={props.icon}><img src={props.image} alt="" /></Show>
        <Show when={props.status === "uploading"}><svg class="ui-chip-ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="9" stroke-dasharray={`${ring}`} stroke-dashoffset={ring * (1 - (props.progress ?? 40) / 100)} /></svg></Show></span>
      <Show when={!props.image}><span class="ui-chip-copy"><strong>{props.name}</strong><small>{props.detail}</small></span></Show>
    </button>
    <button type="button" class="ui-chip-remove" aria-label={`Remove ${props.name}`}><XIcon /></button>
  </div>;
}
/** A numbered answer: label, description, and a check (a box when several may be chosen). */
/** A list of Choices: one answer, or several (pick any). */
export const Choices = (props: { multi?: boolean; children: JSX.Element }) =>
  <div class="ui-choices" role="listbox" aria-multiselectable={props.multi ? "true" : undefined} onPointerOver={moveCursor}>{props.children}</div>;

export function Choice(props: { n: number; label: string; detail?: string; chosen?: boolean; active?: boolean; multi?: boolean }) {
  return <div role="option" class="ui-choice" aria-selected={props.chosen} data-active={props.active ? "true" : undefined}>
    <span class="ui-choice-key">{props.n}</span><span class="ui-choice-label">{props.label}</span>
    <Show when={props.detail}><span class="ui-choice-detail">{props.detail}</span></Show>
    <span class="ui-choice-check" data-multi={props.multi ? "true" : undefined}><Show when={props.chosen}><CheckIcon /></Show></span>
  </div>;
}

/*
 * Overlay: raised frost over a dimmed page -- the app's large surfaces (the
 * command palette, chat search, settings). Its sections run edge to edge,
 * divided by rules: a Bar (the field), a body -- a List, a List beside an
 * aside (OverlaySplit), or a Rail beside a Page -- and Hints. Its rows are
 * the popover's Items at the overlay's scale; the Rail is the sidebar's
 * NavGroups. Its width is the caller's (--overlay-width).
 */
export function Scrim(props: { placement?: "top" | "center"; class?: string; children: JSX.Element }) {
  return <div class={cn("ui-scrim", props.class)} data-placement={props.placement ?? "top"}>{props.children}</div>;
}

/** core: frost on a solid backing, kept for the phone's full-screen overlays should the page behind them be too busy -- off for now. */
export function Overlay(props: { label: string; layout?: "stack" | "rail"; core?: boolean; density?: Density; class?: string; style?: JSX.CSSProperties; children: JSX.Element }) {
  return <div role="dialog" aria-label={props.label} class={cn("ui-frost ui-overlay", props.class)} style={props.style} data-layout={props.layout ?? "stack"}
    data-surface="frost" data-lift="raised" data-core={props.core ? "" : undefined} data-density={props.density}>{props.children}</div>;
}

/** The field across the top: a lead (a prompt glyph, a search icon, a back button), the input, then end controls and close. */
export function OverlayBar(props: { lead?: JSX.Element; placeholder: string; value?: string; onInput?: (value: string) => void; end?: JSX.Element; onClose?: () => void }) {
  return <div class="ui-overlay-bar">
    <Show when={props.lead}><span class="ui-overlay-lead">{props.lead}</span></Show>
    <input class="ui-overlay-input" placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />
    {props.end}
    <Show when={props.onClose}><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onClose?.()}><XIcon /></Button></Show>
  </div>;
}

/** The scrolling body: Sections of Items, titled as groups. */
export const OverlayList = (props: { children: JSX.Element }) => <div class="ui-overlay-list" role="listbox" onPointerOver={moveCursor}>{props.children}</div>;

/** A list beside an aside (a preview of what the list has selected). */
export const OverlaySplit = (props: { aside: JSX.Element; children: JSX.Element }) =>
  <div class="ui-overlay-split">{props.children}<aside class="ui-overlay-aside">{props.aside}</aside></div>;

/** The keys along the foot: [keys, what they do], at the start and the end. */
export type Hint = [string[], string];
export function OverlayHints(props: { start: Hint[]; end?: Hint[] }) {
  const hint = ([keys, label]: Hint) => <span><For each={keys}>{(key) => <kbd class="ui-keycap">{key}</kbd>}</For>{label}</span>;
  return <div class="ui-overlay-hints" aria-hidden="true"><For each={props.start}>{hint}</For>
    <Show when={props.end}><span class="ui-overlay-hints-end"><For each={props.end}>{hint}</For></span></Show></div>;
}

/** A rail of sections down the side: a title, NavGroups, and a foot. */
export function OverlayRail(props: { title: string; foot?: JSX.Element; children: JSX.Element }) {
  return <nav class="ui-overlay-rail"><h2 class="ui-overlay-title">{props.title}</h2>{props.children}
    <Show when={props.foot}><div class="ui-overlay-rail-foot">{props.foot}</div></Show></nav>;
}

/** The page beside a rail: its title, its save status (Saving, Saved, Not saved: settings save as they change), close, and SettingGroups. */
export function OverlayPage(props: { title: string; status?: string; failed?: boolean; onClose?: () => void; children: JSX.Element }) {
  return <main class="ui-overlay-page">
    <div class="ui-overlay-page-head"><h2 class="ui-overlay-title">{props.title}</h2>
      <Show when={props.status}><span class="ui-overlay-status" data-failed={props.failed ? "" : undefined}>{props.status}</span></Show>
      <Show when={props.onClose}><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={() => props.onClose?.()}><XIcon /></Button></Show></div>
    {props.children}
  </main>;
}

/** A titled group of SettingLines; groups after the first are ruled off. */
export const SettingGroup = (props: { title: string; children: JSX.Element }) =>
  <section class="ui-setting-group" aria-label={props.title}><div class="ui-nav-label">{props.title}</div>{props.children}</section>;

/** A setting: its name (state that matters muted after it), then its control in the one control column. */
export const SettingLine = (props: { label: string; state?: string; children: JSX.Element }) =>
  <label class="ui-setting-line"><span>{props.label}<Show when={props.state}><small>{props.state}</small></Show></span><span class="ui-setting-control">{props.children}</span></label>;

/** An overlay's head without a field: what it is about (the leader's key and path). */
export const OverlayHead = (props: { children: JSX.Element }) => <div class="ui-overlay-bar" data-head>{props.children}</div>;

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
export function Leader(props: { path: JSX.Element; hints: JSX.Element; children: JSX.Element }) {
  return <Overlay label="Leader" class="ui-leader"><OverlayHead>{props.path}</OverlayHead>
    <OverlayList>{props.children}</OverlayList>{props.hints}</Overlay>;
}

/** The dim over the page with one region left lit, cut out with its own corners; no region lights nothing. */
export function Spotlight(props: { lit?: { top: string; left: string; width: string; height: string; radius?: string }; class?: string; children?: JSX.Element }) {
  return <div class={cn("ui-spotlight", props.class)} aria-hidden="true">
    <div class="ui-spotlight-lit" data-whole={props.lit ? undefined : ""} style={props.lit ? { top: props.lit.top, left: props.lit.left, width: props.lit.width, height: props.lit.height, "border-radius": props.lit.radius } : {}} />
    {props.children}
  </div>;
}

export const Bubble = (props: { children: JSX.Element }) => <div class="ui-frost ui-bubble">{props.children}</div>;


/* What sits on a surface: the look follows [data-surface] above it (library.css). */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
/** outline: the variant as a line in its colour with nothing inside (primary, ghost, destructive; secondary is already a line round a well). */
export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; outline?: boolean; size?: "default" | "sm" | "icon" | "icon-sm" | "icon-xs" }) {
  const [local, rest] = splitProps(props, ["class", "variant", "outline", "size"]);
  return <button type="button" data-slot="button" {...rest} class={cn("ui-button", local.class)} data-variant={local.variant ?? "primary"} data-outline={local.outline ? "" : undefined} data-size={local.size ?? "default"} />;
}

/** Multi-line text that grows with its lines: bare, the type's size, no geometry of its own -- what holds it pads it (DesktopComposer, PillField). */
export function TextArea(props: { placeholder?: string; value?: string; onInput?: (value: string) => void; class?: string }) {
  return <textarea class={cn("ui-textarea", props.class)} rows={1} placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />;
}

export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <input {...rest} class={cn("ui-input", local.class)} />;
}

/** A select's trigger: a field with a chevron, or bare (its value and a chevron, as in a settings row). */
export function SelectTrigger(props: { value: string; bare?: boolean; onClick?: () => void }) {
  return <button type="button" class="ui-input" data-bare={props.bare ? "" : undefined} onClick={props.onClick}><span>{props.value}</span><ChevronDownIcon /></button>;
}

export function Segmented<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string; icon?: JSX.Element; count?: number }>; onChange: (value: T) => void; size?: "sm"; pill?: boolean; icons?: boolean }) {
  const index = () => Math.max(0, props.options.findIndex((option) => option.value === props.value));
  return <div role="radiogroup" aria-label={props.label} class={props.pill ? "ui-seg ui-frost" : "ui-seg"} data-pill={props.pill ? "" : undefined} data-icons={props.icons || props.pill ? "" : undefined} data-size={props.size}
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

/** A group of nav rows (the sidebar's), with its label. */
export function NavGroup(props: { label?: string; children: JSX.Element }) {
  return <section class="ui-nav-group"><Show when={props.label}><div class="ui-nav-label">{props.label}</div></Show>{props.children}</section>;
}

/** A nav row: icon, label, an optional toggle at the end; indent under the row it belongs to. */
export function NavRow(props: { icon?: JSX.Element; indent?: boolean; current?: boolean; toggle?: JSX.Element; onClick?: () => void; children: JSX.Element }) {
  return <div role="link" class="ui-nav-row" data-indent={props.indent ? "" : undefined} aria-current={props.current ? "page" : undefined} onClick={props.onClick}>
    <Show when={props.icon}><span class="ui-nav-icon">{props.icon}</span></Show><span>{props.children}</span>
    <Show when={props.toggle}><span class="ui-nav-toggle">{props.toggle}</span></Show>
  </div>;
}
