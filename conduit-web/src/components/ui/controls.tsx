import { createEffect, createSignal, createUniqueId, For, Show, splitProps, type JSX } from "solid-js";
import { ChevronDownIcon, ChevronRightIcon, XIcon } from "lucide-solid";
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
export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; outline?: boolean; size?: "default" | "sm" | "icon" | "icon-sm" | "icon-xs" }) {
  const [local, rest] = splitProps(props, ["class", "variant", "outline", "size"]);
  return <button type="button" data-slot="button" {...rest} class={cn("ui-button", local.class)} data-variant={local.variant ?? "primary"} data-outline={local.outline ? "" : undefined} data-size={local.size ?? "default"} />;
}

/** Multi-line text that grows with its lines: bare, the type's size, no geometry of its own -- what holds it pads it (DesktopComposer, PillField). */
export function TextArea(props: { placeholder?: string; value?: string; onInput?: (value: string) => void; class?: string }) {
  return <textarea class={cn("ui-textarea", props.class)} rows={1} placeholder={props.placeholder} value={props.value ?? ""} onInput={(event) => props.onInput?.(event.currentTarget.value)} />;
}

/** A field's name over its control: Caption type, --card-pair above it. */
export function Field(props: { label: string; children: JSX.Element }) {
  return <label class="ui-field"><span class="ui-field-label">{props.label}</span>{props.children}</label>;
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
