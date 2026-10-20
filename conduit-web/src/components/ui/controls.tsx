import { createEffect, createSignal, createUniqueId, For, Show, splitProps, type JSX } from "solid-js";
import { ChevronDownIcon, ChevronRightIcon, SquareIcon, XIcon } from "lucide-solid";
import { cn } from "@/lib/utils";

/** A key or a chord. onClick: it can be pressed (to record another); onRemove: a × beside it clears it (Settings · Shortcuts). */
export function Keycap(props: { children: JSX.Element; label?: string; class?: string; onClick?: () => void; onRemove?: () => void }) {
  if (!props.onClick && !props.onRemove) return <kbd class={cn("ui-keycap", props.class)}>{props.children}</kbd>;
  return <span class="ui-keycap" data-editable="">
    <button type="button" aria-label={props.label ? `Change ${props.label}` : undefined} onClick={() => props.onClick?.()}>{props.children}</button>
    <Show when={props.onRemove}><button type="button" class="ui-keycap-remove" aria-label={props.label ? `Remove ${props.label}` : "Remove"} onClick={() => props.onRemove?.()}><XIcon /></button></Show>
  </span>;
}

/** Progress that is measured: a track and its fill, the slider's. */
export const Progress = (props: { value: number; max: number; label: string }) => <progress class="ui-progress" aria-label={props.label} value={props.value} max={props.max} />;
/* What sits on a surface: the look follows [data-surface] above it (styles/foundations.css). */

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
/** outline: the variant as a line in its colour with nothing inside (primary, ghost, destructive; secondary is already a line round a well). */
export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; outline?: boolean; size?: "default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-xs" }) {
  const [local, rest] = splitProps(props, ["class", "variant", "outline", "size"]);
  return <button type="button" data-slot="button" {...rest} class={cn("ui-button", local.class)} data-variant={local.variant ?? "primary"} data-outline={local.outline ? "" : undefined} data-size={local.size ?? "default"} />;
}

/** On or off, for a setting that is one or the other: an --icon thumb travelling its own width. */
export function Switch(props: { label: string; checked: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; id?: string }) {
  return <button id={props.id} type="button" role="switch" class="ui-switch" aria-label={props.label} aria-checked={props.checked}
    disabled={props.disabled} onClick={() => props.onChange?.(!props.checked)}><span aria-hidden="true" /></button>;
}

/** Waiting: a ring turning, the icon's size. */
/** Stop: a small solid square in the text colour, the mark alone (Stop a turn, the composer's primary slot). */
export const StopGlyph = () => <SquareIcon class="ui-stop-glyph" aria-hidden="true" />;
export const Spinner = (props: { class?: string }) => <span class={cn("ui-spinner", props.class)} aria-hidden="true" />;

/** Multi-line text that grows with its lines: bare, the type's size, no geometry of its own -- what holds it pads it (DesktopComposer, PillField). */
export function TextArea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <textarea rows={1} {...rest} class={cn("ui-textarea", local.class)} />;
}

/** A field's name over its control: Caption type, --card-pair above it. */
export function Field(props: { label: JSX.Element; children: JSX.Element }) {
  return <label class="ui-field"><span class="ui-field-label">{props.label}</span>{props.children}</label>;
}

export function Input(props: JSX.InputHTMLAttributes<HTMLInputElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <input {...rest} class={cn("ui-input", local.class)} />;
}

/** A select's trigger: a field with a chevron, or bare (its value and a chevron, as in a settings row). A menu's behaviour opens it (Select in components/menus.tsx). */
export function SelectTrigger(props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "value"> & { value: string; bare?: boolean }) {
  const [local, rest] = splitProps(props, ["value", "bare", "class"]);
  return <button type="button" {...rest} class={cn("ui-input", local.class)} data-bare={local.bare ? "" : undefined}><span>{local.value}</span><ChevronDownIcon /></button>;
}

/** A few choices side by side, one current. arrows: one Tab stop, the arrows moving the choice (a form's radio group, Settings);
 *  without it what holds the group steers its keys (the sidebar's cursor). */
export function Segmented<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string; icon?: JSX.Element; count?: number; title?: string }>; onChange: (value: T) => void; size?: "sm"; pill?: boolean; icons?: boolean; arrows?: boolean; disabled?: boolean; id?: string }) {
  const index = () => Math.max(0, props.options.findIndex((option) => option.value === props.value));
  const move = (event: KeyboardEvent & { currentTarget: HTMLDivElement }) => {
    const step = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0;
    if (!props.arrows || !step || props.disabled) return;
    event.preventDefault();
    props.onChange(props.options[(index() + step + props.options.length) % props.options.length]!.value);
    const group = event.currentTarget;
    queueMicrotask(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };
  return <div id={props.id} role="radiogroup" aria-label={props.label} aria-disabled={props.disabled || undefined} class={props.pill ? "ui-seg ui-frost" : "ui-seg"} data-pill={props.pill ? "" : undefined} data-icons={props.icons || props.pill ? "" : undefined} data-size={props.size}
    style={{ "--segments": props.options.length, "--segment": index() }} onKeyDown={move}>
    <span class="ui-seg-thumb" aria-hidden="true" />
    <For each={props.options}>{(option) => <button type="button" role="radio" aria-checked={option.value === props.value} tabIndex={props.arrows && option.value !== props.value ? -1 : undefined} disabled={props.disabled} aria-label={props.icons || props.pill ? option.label : undefined} title={option.title ?? (props.icons || props.pill ? option.label : undefined)}
      onClick={() => option.value !== props.value && props.onChange(option.value)}>{option.icon}{props.icons || props.pill ? null : <span>{option.label}</span>}{option.count !== undefined && <small>{option.count}</small>}</button>}</For>
  </div>;
}

/** A slider's value as a control that opens its levels (a Slider's onOpen, or a menu's submenu trigger). */
export function SliderValue(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["children"]);
  return <button type="button" {...rest} class="ui-slider-value" data-opens="">{local.children}<ChevronRightIcon /></button>;
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

/** A whole as one bar of its parts, each in its colour and grown by its value; mark: a rule where something happens, named under it. */
export function Meter(props: { parts: { value: number; colour: string }[]; mark?: { at: number; label: string } }) {
  return <div class="ui-meter" data-marked={props.mark ? "" : undefined}>
    <div class="ui-meter-bar" aria-hidden="true"><For each={props.parts}>{(part) => <span style={{ "flex-grow": part.value, background: part.colour }} />}</For></div>
    <Show when={props.mark}>{(mark) => <><i class="ui-meter-mark" style={{ left: `${mark().at}%` }} /><small class="ui-meter-label" style={{ left: `${mark().at}%` }}>{mark().label}</small></>}</Show>
  </div>;
}

/**
 * One choice from an ordered list, set by sliding along it. The value follows
 * the thumb and is chosen on release; with onOpen the value is a SliderValue
 * that opens the levels, and control puts the caller's own there (a submenu).
 */
export function Slider(props: { label: string; options: { value: string; label: string }[]; value: string; disabled?: boolean; onChange: (value: string) => void; onOpen?: () => void; control?: (shown: () => string) => JSX.Element }) {
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
      onInput={(event) => setPreview(Number(event.currentTarget.value))} onChange={(event) => commit(Number(event.currentTarget.value))} />
    <div class="ui-slider-ticks" aria-hidden="true"><For each={props.options}>{(_, index) => <i data-reached={index() <= preview() ? "" : undefined} />}</For></div>
  </div>;
}
