import { Frost } from "./frost";
import * as Icons from "./icons";
import { children, createEffect, createSignal, For, Show, splitProps, type JSX } from "solid-js";
import { RotateCwIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import { unitPx } from "./layout";
import { Button, Keycap } from "./controls";
import { CloseButton } from "./actions";
import { Row } from "./row";
import { type Motion, motionOf, moveCursor } from "./shared";

export function Rider(props: JSX.HTMLAttributes<HTMLDivElement> & { label?: string; layout?: "row" | "strip" | "card" | "wave"; motion?: Motion; children: JSX.Element }) {
  const [local, rest] = splitProps(props, ["label", "layout", "motion", "class", "children"]);
  // `ui-rider-going` as it leaves: what holds it (the composer's under row) closes its room by it, a class for :has().
  return <Frost role="group" {...rest} class={cn("ui-rider", (local.motion === "leaving" || local.motion === "removing") && "ui-rider-going", local.class)} data-layout={local.layout ?? "row"} aria-label={local.label} {...motionOf(local.motion)}>{local.children}</Frost>;
}
export const RiderTitle = (props: { title?: string; children: JSX.Element }) => <span class="ui-title-text" title={props.title}>{props.children}</span>;
export const RiderMark = (props: { icon: JSX.Element; label: string; title?: string }) =>
  <span class="ui-rider-mark ui-size-icon" role="img" aria-label={props.label} title={props.title ?? props.label}>{props.icon}</span>;
export const rideBottom = (hostBottom: number, coverTop: number) => Math.max(unitPx(0.5), hostBottom - coverTop + unitPx(0.625));
export function RiderButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon: JSX.Element; label: string; show?: "icon" | "label"; motion?: Motion; hidden?: boolean; ride?: "centre" | "beside" }) {
  const [local, rest] = splitProps(props, ["icon", "label", "show", "class", "motion", "hidden", "ride"]);
  return <Frost as="button" type="button" {...rest} {...motionOf(local.motion)} class={cn("ui-rider-button", local.class)} data-labelled={local.show === "label" ? "" : undefined} data-ride={local.ride}
    data-hidden={local.hidden ? "" : undefined} aria-hidden={local.hidden ? "true" : undefined} tabIndex={local.hidden ? -1 : undefined}
    aria-label={local.show === "label" ? undefined : local.label} title={local.show === "label" ? undefined : local.label}>{local.icon}<Show when={local.show === "label"}><span>{local.label}</span></Show></Frost>;
}
export function Line(props: { text: string; clipped?: boolean }) {
  const [open, setOpen] = createSignal(false);
  const [measured, setMeasured] = createSignal(false);
  let body!: HTMLParagraphElement;
  createEffect(() => { props.text; if (!open()) setMeasured(body.scrollHeight > body.clientHeight + 1); });
  return <li class="ui-line" data-expanded={open() ? "true" : "false"}><p ref={body} class="ui-line-body">{props.text}</p>
    <Show when={props.clipped ?? measured()}><button type="button" class="ui-line-more" aria-label={open() ? "Show less" : "Show more"} aria-expanded={open()} onClick={() => setOpen(!open())}><Icons.ChevronDown class="ui-fold-chevron" data-turn="half" /></button></Show></li>;
}
export function Chip(props: { name: string; detail?: string; image?: string | JSX.Element; icon?: JSX.Element; status?: "queued" | "uploading" | "error" | "done"; progress?: number; retry?: boolean; title?: string; motion?: Motion;
  onOpen?: () => void; onRetry?: () => void; onRemove?: (chip: HTMLElement) => void }) {
  const ring = 2 * Math.PI * 9;
  const image = children(() => props.image);
  let chip!: HTMLDivElement;
  return <div ref={chip} class="ui-chip" data-kind={image() ? "image" : "file"} data-status={props.status ?? "done"} title={props.title} {...motionOf(props.motion)}>
    <button type="button" class="ui-chip-body" aria-label={props.retry ? `Retry ${props.name}` : `Show ${props.name}`} onClick={() => props.retry ? props.onRetry?.() : props.onOpen?.()}>
      <span class="ui-chip-media"><Show when={image()} fallback={props.icon}>{typeof image() === "string" ? <img src={image() as string} alt="" /> : image()}</Show>
        <Show when={props.status === "uploading" || props.status === "queued"}><svg class="ui-chip-ring" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="9" stroke-dasharray={`${ring}`} stroke-dashoffset={ring * (1 - Math.min(100, props.progress ?? 40) / 100)} /></svg></Show>
        <Show when={props.retry}><RotateCwIcon class="ui-chip-retry" /></Show></span>
      <Show when={!image()}><ChipCopy name={props.name} detail={props.detail} /></Show>
    </button>
    <button type="button" class="ui-chip-remove" aria-label={`Remove ${props.name}`} onClick={() => props.onRemove?.(chip)}><Icons.Close /></button>
  </div>;
}
export const ChipCopy = (props: { name: string; detail?: string }) =>
  <span class="ui-chip-copy"><strong>{props.name}</strong><small>{props.detail}</small></span>;
export function Reference(props: { icon: JSX.Element; name: string; at?: string; note?: string; title?: string; label?: string; onOpen?: () => void; onEdit?: () => void; onRemove?: () => void }) {
  return <span class="ui-reference" title={props.title}>
    <button type="button" class="ui-reference-body" title={props.label} disabled={!props.onOpen} onClick={() => props.onOpen?.()}>{props.icon}<strong>{props.name}</strong><Show when={props.at}><span>{props.at}</span></Show><Show when={props.note}><span>· {props.note}</span></Show></button>
    <Show when={props.onEdit}><Button variant="ghost" size="icon-sm" aria-label={`Edit comment for ${props.name}`} onClick={() => props.onEdit?.()}><Icons.Edit /></Button></Show>
    <Show when={props.onRemove}><CloseButton label={`Remove reference to ${props.name}`} onClick={() => props.onRemove?.()} /></Show>
  </span>;
}
export const References = (props: { label?: string; children: JSX.Element }) => <div class="ui-references" role="group" aria-label={props.label}>{props.children}</div>;
export const Choices = (props: { multi?: boolean; children: JSX.Element }) =>
  <div class="ui-choices" role="listbox" aria-multiselectable={props.multi ? "true" : undefined} onPointerOver={moveCursor}>{props.children}</div>;

export function Choice(props: { n: number; label?: string; detail?: string; title?: string; chosen?: boolean; active?: boolean; multi?: boolean; own?: JSX.Element; onPick?: () => void; onPoint?: () => void }) {
  return <Row density="line" role="option" class="ui-choice" aria-selected={props.chosen} data-highlighted={props.active ? "" : undefined} data-own={props.own ? "" : undefined}
    title={props.title} onClick={() => props.onPick?.()} onPointerMove={() => props.onPoint?.()}
    lead={<span class="ui-choice-key">{props.n}</span>} label={props.own ?? props.label} context={props.detail} />;
}

export const Lines = (props: { children: JSX.Element }) => <ul class="ui-lines">{props.children}</ul>;
export const Chips = (props: { ref?: (element: HTMLDivElement) => void; fadeStart?: boolean; fadeEnd?: boolean; onScroll?: () => void; children: JSX.Element }) =>
  <div ref={props.ref} class="ui-chips" data-fade-start={props.fadeStart || undefined} data-fade-end={props.fadeEnd || undefined} onScroll={() => props.onScroll?.()}>{props.children}</div>;
export const Preview = (props: { format?: string; children: JSX.Element }) => <pre class="ui-preview" data-format={props.format}>{props.children}</pre>;

export const RiderTop = (props: { children: JSX.Element }) => <div class="ui-rider-top">{props.children}</div>;
export const RiderFoot = (props: { children: JSX.Element }) => <div class="ui-rider-foot">{props.children}</div>;
export const Hints = (props: { hints: [string, string][] }) =>
  <div class="ui-hints" aria-hidden="true"><For each={props.hints}>{([key, label]) => <span><Keycap>{key}</Keycap>{label}</span>}</For></div>;
export const ChoicesPage = (props: { children: JSX.Element }) => <div class="ui-choices-page">{props.children}</div>;
export const Prompt = (props: { multi?: boolean; children: JSX.Element }) =>
  <p class="ui-prompt">{props.children}<Show when={props.multi}><span> · pick any</span></Show></p>;
export const ChoiceInput = (props: JSX.InputHTMLAttributes<HTMLInputElement>) => <input {...props} class={cn("ui-choice-input", props.class)} />;
export const Summary = (props: { rows: { label: string; value: string; empty?: boolean; onOpen?: () => void }[] }) =>
  <div class="ui-summary"><For each={props.rows}>{(row) => <Row element="button" density="line" tabIndex={-1} onClick={() => row.onOpen?.()}
    data-empty={row.empty ? "" : undefined} label={row.label} context={row.value} />}</For></div>;
