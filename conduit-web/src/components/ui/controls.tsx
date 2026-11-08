import { Frost } from "./frost";
import { IconButton } from "./actions";
import * as Icons from "./icons";
import { createEffect, createSignal, createUniqueId, For, Show, splitProps, type JSX } from "solid-js";

import { feel, haptic, type Haptic, type HapticProp } from "./haptics";
import { cn } from "@/lib/utils";
import { callHandler } from "./shared";

/** A key or a chord. onClick: it can be pressed (to record another); onRemove: a × beside it clears it (Settings · Shortcuts). */
export function Keycap(props: { children: JSX.Element; label?: string; class?: string; onClick?: () => void; onRemove?: () => void }) {
  if (!props.onClick && !props.onRemove) return <kbd class={cn("ui-keycap", props.class)}>{props.children}</kbd>;
  return <span class="ui-keycap" data-editable="">
    <button type="button" aria-label={props.label ? `Change ${props.label}` : undefined} onClick={() => props.onClick?.()}>{props.children}</button>
    <Show when={props.onRemove}><button type="button" class="ui-keycap-remove" aria-label={props.label ? `Remove ${props.label}` : "Remove"} onClick={() => props.onRemove?.()}><Icons.Close /></button></Show>
  </span>;
}

/** Progress that is measured: a track and its fill, the slider's. */
export const Progress = (props: { value: number; max: number; label: string }) => <progress class="ui-progress" aria-label={props.label} value={props.value} max={props.max} />;
/* What sits on a surface: the look follows [data-surface] above it (styles/foundations.css). */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
/** outline: the variant as a line in its colour with nothing inside (primary, ghost, destructive; secondary is already a line round a well).
 *  Felt when pressed on a phone by its variant: primary confirm, destructive destructive, the others press;
 *  haptic overrides it (false: none; see haptics.ts). */
const BUTTON_HAPTIC: Record<ButtonVariant, Haptic> = { primary: "confirm", destructive: "destructive", secondary: "press", ghost: "press" };
export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; outline?: boolean; size?: "default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-xs"; haptic?: HapticProp }) {
  const [local, rest] = splitProps(props, ["class", "variant", "outline", "size", "haptic", "onClick"]);
  return <button type="button" data-slot="button" {...rest} class={cn("ui-button", local.class)} data-variant={local.variant ?? "primary"} data-outline={local.outline ? "" : undefined} data-size={local.size ?? "default"}
    onClick={(event) => { feel(local.haptic, BUTTON_HAPTIC[local.variant ?? "primary"]); callHandler(local.onClick, event); }} />;
}


/** On or off, for a setting that is one or the other: an --icon thumb travelling its own width. Felt as select. */
export function Switch(props: { label: string; checked: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; id?: string; haptic?: HapticProp }) {
  return <button id={props.id} type="button" role="switch" class="ui-switch" aria-label={props.label} aria-checked={props.checked}
    disabled={props.disabled} onClick={() => { feel(props.haptic, "select"); props.onChange?.(!props.checked); }}><span aria-hidden="true" /></button>;
}

/** Waiting: a ring turning, the icon's size. */
/** Stop: a small solid square in the text colour, the mark alone (Stop a turn, the composer's primary slot). */
export const StopGlyph = () => <Icons.Stop class="ui-stop-glyph" aria-hidden="true" />;
export const Spinner = (props: { class?: string }) => <span class={cn("ui-spinner", props.class)} aria-hidden="true" />;

/** Multi-line text that grows with its lines: bare, the type's size, no geometry of its own -- what holds it pads it (DesktopComposer, PillField). */
export function TextArea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <textarea rows={1} {...rest} class={cn("ui-textarea", local.class)} />;
}

/** A field's name over its control: Caption type, --card-pair above it. */
/** A form field: its label over its control. plain: the label names a group of controls (a Segmented), so it is no
 *  label element (a press on it would pick the first). inline: the label and its control on one line (a Switch). */
export function Field(props: { label: JSX.Element; plain?: boolean; inline?: boolean; children: JSX.Element }) {
  const inner = () => <><span class="ui-field-label">{props.label}</span>{props.children}</>;
  return props.plain
    ? <div role="group" class="ui-field" data-inline={props.inline ? "" : undefined}>{inner()}</div>
    : <label class="ui-field" data-inline={props.inline ? "" : undefined}>{inner()}</label>;
}

export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <input {...rest} class={cn("ui-input", local.class)} />;
}

/**
 * LeadInput: a field led by its mark, the mark inside the field's start. The kind is where it sits, which sets its
 * size and its voice (each kind's look in its family's stylesheet, under .ui-lead-input[data-lead-input]):
 *
 *   tool      a ToolBar's filter (the Files tree's): a search on the tint
 *   web       a web page's address in its bar: the address in data's voice; lead: a lock when the page is https
 *   browser   the file browser's search in its toolbar: the mark beside a standard field
 *
 * lead: the mark (search when given none).
 */
export type LeadInputKind = "tool" | "web" | "browser";

/** onClear: a × at the field's end while it holds text, the library's icon button; it clears (the caller empties the
 *  value) and keeps the caret in the field. */
export function LeadInput(props: JSX.InputHTMLAttributes<HTMLInputElement> & { kind?: LeadInputKind; lead?: JSX.Element; ref?: (element: HTMLInputElement) => void; onClear?: () => void }) {
  const [local, rest] = splitProps(props, ["kind", "lead", "onClear"]);
  const kind = () => local.kind ?? "tool";
  const field = () => kind() === "web"
    ? <input type="text" spellcheck={false} autocomplete="off" {...rest} />
    : kind() === "browser" ? <Input type="search" {...rest} /> : <input type="search" {...rest} />;
  const clear = (event: MouseEvent) => { event.preventDefault(); local.onClear?.(); (event.currentTarget as HTMLElement).closest(".ui-lead-input")?.querySelector("input")?.focus(); };
  return <label class="ui-lead-input" data-lead-input={kind()} data-clearable={local.onClear ? "" : undefined}>{local.lead ?? <Icons.Search />}{field()}
    <Show when={local.onClear && String(rest.value ?? "")}><IconButton kind="file" class="ui-lead-input-clear" label="Clear" onMouseDown={(event) => event.preventDefault()} onClick={clear}><Icons.Close /></IconButton></Show></label>;
}

/** A select's trigger: a field with a chevron, or bare (its value and a chevron, as in a settings row). A menu's behaviour opens it (Select in components/menus.tsx). */
/** A select's trigger. look: field (the value in a field, or bare: the value quiet), title (the value as a page's title,
 *  what the page is showing, its chevron saying it can be changed), icon (an icon button for a toolbar, the value or
 *  title said on hover and to a screen reader). */
export function SelectTrigger(props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "value"> & { value: string; bare?: boolean; look?: "field" | "title" | "icon"; icon?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["value", "bare", "class", "look", "icon"]);
  return <button type="button" {...rest} class={cn("ui-input", local.class)} data-bare={local.bare && !local.look ? "" : undefined} data-look={local.look}>
    <Show when={local.look === "icon"} fallback={<><span>{local.value}</span><Icons.ChevronDown /></>}>{local.icon}</Show>
  </button>;
}

/** A few choices side by side, one current; choosing one is felt as select. arrows: one Tab stop, the arrows moving the choice (a form's radio group, Settings);
 *  without it what holds the group steers its keys (the sidebar's cursor). */
export function Segmented<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string; icon?: JSX.Element; count?: number; title?: string }>; onChange: (value: T) => void; size?: "sm"; pill?: boolean; icons?: boolean; arrows?: boolean; disabled?: boolean; id?: string; haptic?: HapticProp }) {
  const index = () => Math.max(0, props.options.findIndex((option) => option.value === props.value));
  const move = (event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
    const step = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
    if (!props.arrows || !step || props.disabled) return;
    event.preventDefault();
    props.onChange(props.options[(index() + step + props.options.length) % props.options.length]!.value);
    const group = event.currentTarget;
    queueMicrotask(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return <Frost plain={!props.pill} id={props.id} role="radiogroup" aria-label={props.label} aria-disabled={props.disabled || undefined} class="ui-seg" data-pill={props.pill ? "" : undefined} data-icons={props.icons || props.pill ? "" : undefined} data-size={props.size}
    style={{ "--segments": props.options.length, "--segment": index() }} onKeyDown={move}>
    <span class="ui-seg-thumb" aria-hidden="true" />
    <For each={props.options}>{(option) => <button type="button" role="radio" aria-checked={option.value === props.value} tabIndex={props.arrows && option.value !== props.value ? -1 : undefined} disabled={props.disabled} aria-label={props.icons || props.pill ? option.label : undefined} title={option.title ?? (props.icons || props.pill ? option.label : undefined)}
      onClick={() => { if (option.value === props.value) return; feel(props.haptic, "select"); props.onChange(option.value); }}>{option.icon}{props.icons || props.pill ? null : <span>{option.label}</span>}{option.count !== undefined && <Count value={option.count} />}</button>}</For>
  </Frost>;
}

/** A slider's value as a control that opens its levels (a Slider's onOpen, or a menu's submenu trigger). */
export function SliderValue(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["children"]);
  return <button type="button" {...rest} class="ui-slider-value" data-opens="">{local.children}<Icons.ChevronRight /></button>;
}

/** How full something is, as a ring in the text colour: tone idle (nothing reported), warning and critical colour it. */
export function Gauge(props: { value: number; tone?: "idle" | "normal" | "warning" | "critical" }) {
  return <svg class="ui-gauge" data-tone={props.tone ?? "normal"} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" pathLength="100" /><circle cx="12" cy="12" r="9" pathLength="100" style={{ "stroke-dasharray": `${props.value || 0} 100` }} />
  </svg>;
}

/** A colour standing for a kind of thing (a meter's part): the icon-dot's size; hollow, a ring for what holds nothing. */
/** fill: the whole of its host (a colour choice) rather than a dot beside a label. */
export const Swatch = (props: { colour?: string; hollow?: boolean; fill?: boolean }) => <i class="ui-swatch" data-hollow={props.hollow ? "" : undefined} data-fill={props.fill ? "" : undefined} style={{ background: props.hollow ? undefined : props.colour }} aria-hidden="true" />;

/** A whole as one bar of its parts, each in its colour and grown by its value; mark: a rule where something happens,
 *  named under it -- or, quiet, its rule alone, named by what reads it (a Reading's totals) and its title. */
export function Meter(props: { parts: { value: number; colour: string }[]; mark?: { at: number; label: string; quiet?: boolean } }) {
  return <div class="ui-meter" data-marked={props.mark && !props.mark.quiet ? "" : undefined} title={props.mark?.quiet ? props.mark.label : undefined}>
    <div class="ui-meter-bar" aria-hidden="true"><For each={props.parts}>{(part) => <span style={{ "flex-grow": part.value, background: part.colour }} />}</For></div>
    <Show when={props.mark}>{(mark) => <><i class="ui-meter-mark" style={{ left: `${mark().at}%` }} /><Show when={!mark().quiet}><small class="ui-meter-label" style={{ left: `${mark().at}%` }}>{mark().label}</small></Show></>}</Show>
  </div>;
}

/**
 * A quantity over time (a day's spend): a column per period, grown from the foot by its share of the largest, on the
 * track's ground; a period with nothing is the ground alone. The first and last periods are named under it (`ends`
 * for other words), each column's title is its reading, and `label` says the whole for assistive tech. `current`: the
 * period you are in (today), at full strength; the others rest a step back.
 */
export function Series(props: { label: string; points: { label: string; value: number; title?: string; current?: boolean }[]; ends?: [string, string] }) {
  const max = () => props.points.reduce((most, point) => Math.max(most, point.value), 0);
  return <figure class="ui-series" role="img" aria-label={props.label}>
    <div class="ui-series-bars">
      <For each={props.points}>{(point) => <span title={point.title ?? `${point.label}: ${point.value}`} data-current={point.current ? "" : undefined}
        data-empty={point.value > 0 ? undefined : ""} style={{ "--share": max() > 0 ? point.value / max() : 0 }} />}</For>
    </div>
    <Show when={props.points.length}><figcaption class="ui-series-ends" aria-hidden="true"><span>{props.ends?.[0] ?? props.points[0]!.label}</span><span>{props.ends?.[1] ?? props.points.at(-1)!.label}</span></figcaption></Show>
  </figure>;
}

/**
 * One choice from an ordered list, set by sliding along it. The value follows
 * the thumb and is chosen on release, each stop it passes felt as select; with onOpen the value is a SliderValue
 * that opens the levels, and control puts the caller's own there (a submenu).
 */
export function Slider(props: { label: string; options: { value: string; label: string }[]; value: string; disabled?: boolean; onChange: (value: string) => void; onOpen?: () => void; control?: (shown: () => string) => JSX.Element; haptic?: HapticProp }) {
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
      <Show when={props.control} fallback={<Show when={props.onOpen} fallback={<span class="ui-slider-value">{shown()}</span>}>
        <SliderValue disabled={props.disabled} onClick={() => props.onOpen?.()}>{shown()}</SliderValue>
      </Show>}>{(control) => control()(shown)}</Show>
    </div>
    <input id={id} class="ui-slider-input" type="range" min={0} max={Math.max(0, props.options.length - 1)} step={1} value={preview()} disabled={props.disabled} aria-valuetext={shown()}
      style={{ "--fill": `${props.options.length > 1 ? (preview() / (props.options.length - 1)) * 100 : 0}%` }}
      onInput={(event) => { const next = Number(event.currentTarget.value); if (next !== preview()) feel(props.haptic, "select"); setPreview(next); }} onChange={(event) => commit(Number(event.currentTarget.value))} />
    <div class="ui-slider-ticks" aria-hidden="true"><For each={props.options}>{(_, index) => <i data-reached={index() <= preview() ? "" : undefined} />}</For></div>
  </div>;
}

/**
 * Count: how many, beside what it counts -- after a heading, in a control, at a group's foot: the data face's
 * caption digits, muted. alert: what waits on the person (the warn tone). label: what the number means, when the
 * words around it do not say.
 */
export const Count = (props: { value: number | string; tone?: "alert"; label?: string; class?: string }) =>
  <small class={cn("ui-count", props.class)} data-tone={props.tone} aria-label={props.label}>{props.value}</small>;
