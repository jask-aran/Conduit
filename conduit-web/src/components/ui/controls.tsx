import { Frost } from "./frost";
import { IconButton } from "./actions";
import * as Icons from "./icons";
import { createEffect, createSignal, createUniqueId, For, Show, splitProps, untrack, type JSX } from "solid-js";

import { feel, type Haptic, type HapticProp } from "./haptics";
import { cn } from "@/lib/utils";
import { callHandler } from "./shared";

export function Keycap(props: { children: JSX.Element; label?: string; class?: string; onClick?: () => void; onRemove?: () => void }) {
  if (!props.onClick && !props.onRemove) return <kbd class={cn("ui-keycap", props.class)}>{props.children}</kbd>;
  return <span class="ui-keycap" data-editable="">
    <button type="button" aria-label={props.label ? `Change ${props.label}` : undefined} onClick={() => props.onClick?.()}>{props.children}</button>
    <Show when={props.onRemove}><button type="button" class="ui-keycap-remove" aria-label={props.label ? `Remove ${props.label}` : "Remove"} onClick={() => props.onRemove?.()}><Icons.Close /></button></Show>
  </span>;
}

export const Progress = (props: { value: number; max: number; label: string }) => <progress class="ui-progress" aria-label={props.label} value={props.value} max={props.max} />;

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive";
const BUTTON_HAPTIC: Record<ButtonVariant, Haptic> = { primary: "confirm", destructive: "destructive", secondary: "press", ghost: "press" };
export function Button(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; outline?: boolean; size?: "default" | "sm" | "lg" | "icon" | "icon-sm" | "icon-xs"; haptic?: HapticProp }) {
  const [local, rest] = splitProps(props, ["class", "variant", "outline", "size", "haptic", "onClick"]);
  return <button type="button" data-slot="button" {...rest} class={cn("ui-button", local.class)} data-variant={local.variant ?? "primary"} data-outline={local.outline ? "" : undefined} data-size={local.size ?? "default"}
    onClick={(event) => { feel(local.haptic, BUTTON_HAPTIC[local.variant ?? "primary"]); callHandler(local.onClick, event); }} />;
}


export function Switch(props: { label: string; checked: boolean; onChange?: (checked: boolean) => void; disabled?: boolean; id?: string; haptic?: HapticProp }) {
  return <button id={props.id} type="button" role="switch" class="ui-switch" aria-label={props.label} aria-checked={props.checked}
    disabled={props.disabled} onClick={() => { feel(props.haptic, "select"); props.onChange?.(!props.checked); }}><span aria-hidden="true" /></button>;
}

export const StopGlyph = () => <Icons.Stop class="ui-stop-glyph" aria-hidden="true" />;
export const Spinner = (props: { class?: string }) => <span class={cn("ui-spinner", props.class)} aria-hidden="true" />;

export function TextArea(props: JSX.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const [local, rest] = splitProps(props, ["class"]);
  return <textarea rows={1} {...rest} class={cn("ui-textarea", local.class)} />;
}

/** plain: the label names a group of controls, so it is no label element (a press on it would pick the first). */
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

export type LeadInputKind = "tool" | "web" | "browser";

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

export function SelectTrigger(props: Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, "value"> & { value: string; bare?: boolean; look?: "field" | "title" | "icon"; icon?: JSX.Element }) {
  const [local, rest] = splitProps(props, ["value", "bare", "class", "look", "icon"]);
  return <button type="button" {...rest} class={cn("ui-input", local.class)} data-bare={local.bare && !local.look ? "" : undefined} data-look={local.look}>
    <Show when={local.look === "icon"} fallback={<><span>{local.value}</span><Icons.ChevronDown /></>}>{local.icon}</Show>
  </button>;
}

export function Segmented<T extends string>(props: { label: string; value: T; options: ReadonlyArray<{ value: T; label: string; icon?: JSX.Element; count?: number; title?: string; disabled?: boolean }>; onChange: (value: T) => void; size?: "sm"; pill?: boolean; icons?: boolean; arrows?: boolean; disabled?: boolean; tabIndex?: number; id?: string; haptic?: HapticProp }) {
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
    <For each={props.options}>{(option) => <button type="button" role="radio" aria-checked={option.value === props.value} tabIndex={props.tabIndex ?? (props.arrows && option.value !== props.value ? -1 : undefined)} disabled={props.disabled || option.disabled} aria-label={props.icons || props.pill ? option.label : undefined} title={option.title ?? (props.icons || props.pill ? option.label : undefined)}
      onClick={() => { if (option.value === props.value) return; feel(props.haptic, "select"); props.onChange(option.value); }}>{option.icon}{props.icons || props.pill ? null : <span>{option.label}</span>}{option.count !== undefined && <Count value={option.count} />}</button>}</For>
  </Frost>;
}

export function SliderValue(props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) {
  const [local, rest] = splitProps(props, ["children"]);
  return <button type="button" {...rest} class="ui-slider-value" data-opens="">{local.children}<Icons.ChevronRight /></button>;
}

export function Gauge(props: { value: number; tone?: "idle" | "normal" | "warning" | "critical" }) {
  return <svg class="ui-gauge ui-size-icon-sm" data-tone={props.tone ?? "normal"} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="9" pathLength="100" /><circle cx="12" cy="12" r="9" pathLength="100" style={{ "stroke-dasharray": `${props.value || 0} 100` }} />
  </svg>;
}

export const Swatch = (props: { colour?: string; hollow?: boolean; fill?: boolean }) => <i class="ui-swatch" data-hollow={props.hollow ? "" : undefined} data-fill={props.fill ? "" : undefined} style={{ background: props.hollow ? undefined : props.colour }} aria-hidden="true" />;

type Hsv = { h: number; s: number; v: number };
const hexOf = ({ h, s, v }: Hsv) => { const part = (n: number) => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))).toString(16).padStart(2, "0"); }; return `#${part(5)}${part(3)}${part(1)}`; };
const hsvOf = (hex: string): Hsv | null => {
  const found = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!found) return null;
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(found[1]!.slice(at, at + 2), 16) / 255) as [number, number, number], v = Math.max(r, g, b), spread = v - Math.min(r, g, b);
  const h = !spread ? 0 : v === r ? ((g - b) / spread + 6) % 6 : v === g ? (b - r) / spread + 2 : (r - g) / spread + 4;
  return { h: h * 60, s: v ? spread / v : 0, v };
};
/** A whole number between `min` and `max`, typed or stepped by one. */
export function Stepper(props: { label: string; value: number; min: number; max: number; unit?: string; onChange: (value: number) => void }) {
  const set = (to: number) => { if (Number.isFinite(to)) props.onChange(Math.max(props.min, Math.min(props.max, Math.round(to)))); };
  return <span class="ui-stepper" role="group" aria-label={props.label}>
    <IconButton label="Less" disabled={props.value <= props.min} onClick={() => set(props.value - 1)}><Icons.Less /></IconButton>
    {/* Its keys are its own: a menu it stands in would read them as a search of its rows. */}
    <Input inputMode="numeric" aria-label={props.label} value={props.value} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => { set(Number(event.currentTarget.value)); event.currentTarget.value = String(props.value); }} />
    <Show when={props.unit}><span class="ui-stepper-unit">{props.unit}</span></Show>
    <IconButton label="More" disabled={props.value >= props.max} onClick={() => set(props.value + 1)}><Icons.Add /></IconButton>
  </span>;
}
/** Any colour: its shade on a field of its hue, the hue on a track, and its hex to read or type. `value` and what `onChange` gives are `#rrggbb`. */
export function ColourPicker(props: { label: string; value: string; onChange: (hex: string) => void }) {
  // Kept as hue, shade and light: a grey's hex has no hue to come back to.
  const [colour, setColour] = createSignal<Hsv>(hsvOf(props.value) ?? { h: 0, s: 1, v: 1 });
  createEffect(() => { const given = hsvOf(props.value); if (given && hexOf(untrack(colour)) !== props.value.toLowerCase()) setColour(given); });
  const hex = () => hexOf(colour());
  const set = (next: Hsv) => { setColour(next); props.onChange(hexOf(next)); };
  const part = (n: number) => Math.max(0, Math.min(1, n));
  const shade = (event: PointerEvent & { currentTarget: HTMLElement }) => { const box = event.currentTarget.getBoundingClientRect(); set({ h: colour().h, s: part((event.clientX - box.left) / box.width), v: 1 - part((event.clientY - box.top) / box.height) }); };
  const fromScreen = () => void new (window as unknown as { EyeDropper: new () => { open(): Promise<{ sRGBHex: string }> } }).EyeDropper().open().then((picked) => { const next = hsvOf(picked.sRGBHex); if (next) set(next); }, () => {});
  return <div class="ui-colour" role="group" aria-label={props.label} style={{ "--colour-hue": colour().h, "--colour": hex() }}>
    <div class="ui-colour-field" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); shade(event); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) shade(event); }}>
      <i class="ui-colour-thumb" style={{ left: `${colour().s * 100}%`, top: `${(1 - colour().v) * 100}%` }} />
    </div>
    <input class="ui-slider-input" data-hue="" type="range" min="0" max="359" aria-label="Hue" value={colour().h} onInput={(event) => set({ ...colour(), h: Number(event.currentTarget.value) })} />
    <div class="ui-colour-row">
      <Swatch colour={hex()} />
      <Input aria-label="Hex colour" value={hex()} maxlength="7" spellcheck={false} onInput={(event) => { const next = hsvOf(event.currentTarget.value); if (next) set(next); }} />
      <Show when={"EyeDropper" in window}><IconButton label="Take a colour from the screen" onClick={fromScreen}><Icons.Pipette /></IconButton></Show>
    </div>
  </div>;
}

export function Meter(props: { parts: { value: number; colour: string }[]; mark?: { at: number; label: string; quiet?: boolean } }) {
  return <div class="ui-meter" data-marked={props.mark && !props.mark.quiet ? "" : undefined} title={props.mark?.quiet ? props.mark.label : undefined}>
    <div class="ui-meter-bar" aria-hidden="true"><For each={props.parts}>{(part) => <span style={{ "flex-grow": part.value, background: part.colour }} />}</For></div>
    <Show when={props.mark}>{(mark) => <><i class="ui-meter-mark" style={{ left: `${mark().at}%` }} /><Show when={!mark().quiet}><small class="ui-meter-label" style={{ left: `${mark().at}%` }}>{mark().label}</small></Show></>}</Show>
  </div>;
}

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

export const ShowMore = (props: { open: boolean; onToggle: (event: MouseEvent) => void; more?: string; less?: string; bar?: boolean }) =>
  <button type="button" class="ui-show-more" data-bar={props.bar ? "" : undefined} aria-expanded={props.open} onClick={(event) => props.onToggle(event)}>
    {props.open ? props.less ?? "Show less" : props.more ?? "Show more"}</button>;
export const Count = (props: { value: number | string; tone?: "alert"; label?: string; class?: string }) =>
  <small class={cn("ui-count", props.class)} data-tone={props.tone} aria-label={props.label}>{props.value}</small>;
