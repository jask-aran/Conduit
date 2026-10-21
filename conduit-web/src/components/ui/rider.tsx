import * as Icons from "./icons";
import { children, createEffect, createSignal, For, Show, splitProps, type JSX } from "solid-js";
import { RotateCwIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import { Button, Keycap } from "./controls";
import { type Motion, motionOf, moveCursor } from "./shared";

/*
 * Rider: frost on a composer's top edge, either composer's. A row (title,
 * body, actions), a strip (chips, actions) or a card (the question, which takes
 * the keyboard: the app passes its ref, tabIndex and keys).
 */
export function Rider(props: JSX.HTMLAttributes<HTMLDivElement> & { label?: string; layout?: "row" | "strip" | "card" | "wave"; motion?: Motion; children: JSX.Element }) {
  const [local, rest] = splitProps(props, ["label", "layout", "motion", "class", "children"]);
  return <div role="group" {...rest} class={cn("ui-frost ui-rider", local.class)} data-surface="frost" data-lift="rest" data-layout={local.layout ?? "row"} aria-label={local.label} {...motionOf(local.motion)}>{local.children}</div>;
}
/** A rider's title; title: what it means, on hover. */
export const RiderTitle = (props: { title?: string; children: JSX.Element }) => <span class="ui-title-text" title={props.title}>{props.children}</span>;
/** A button riding over the transcript just above the composer: scroll to latest (an icon alone), cancel an edit
 *  (an icon and its words). Resting frost at the surface radius. hidden: kept where it rides but faded out and out of
 *  reach, so it fades back in rather than being drawn again. */
/** ride: where it floats over what it rides (a transcript above its composer) -- centred, or beside a centred one; the host sets how high (--ride-bottom). */
export function RiderButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon: JSX.Element; label: string; show?: "icon" | "label"; motion?: Motion; hidden?: boolean; ride?: "centre" | "beside" }) {
  const [local, rest] = splitProps(props, ["icon", "label", "show", "class", "motion", "hidden", "ride"]);
  return <button type="button" {...rest} {...motionOf(local.motion)} class={cn("ui-frost ui-rider-button", local.class)} data-surface="frost" data-lift="rest" data-labelled={local.show === "label" ? "" : undefined} data-ride={local.ride}
    data-hidden={local.hidden ? "" : undefined} aria-hidden={local.hidden ? "true" : undefined} tabIndex={local.hidden ? -1 : undefined}
    aria-label={local.show === "label" ? undefined : local.label} title={local.show === "label" ? undefined : local.label}>{local.icon}<Show when={local.show === "label"}><span>{local.label}</span></Show></button>;
}
export const RiderActions = (props: { stack?: boolean; children: JSX.Element }) => <div class="ui-rider-actions" data-stack={props.stack ? "" : undefined}>{props.children}</div>;
/** A line of waiting text, one line until opened; it offers to open only when it is really cut short (measured, not
 *  guessed from its length, since that depends on its width). clipped: decided by the caller instead. */
export function Line(props: { text: string; clipped?: boolean }) {
  const [open, setOpen] = createSignal(false);
  const [measured, setMeasured] = createSignal(false);
  let body!: HTMLParagraphElement;
  createEffect(() => { props.text; if (!open()) setMeasured(body.scrollHeight > body.clientHeight + 1); });
  return <li class="ui-line" data-expanded={open() ? "true" : "false"}><p ref={body} class="ui-line-body">{props.text}</p>
    <Show when={props.clipped ?? measured()}><button type="button" class="ui-line-more" aria-label={open() ? "Show less" : "Show more"} aria-expanded={open()} onClick={() => setOpen(!open())}><Icons.ChevronDown /></button></Show></li>;
}
/** An attached thing: an image's thumbnail, or a file's mark, name and size. image: its source, or the app's own image
 *  (one that loads itself); icon: a file's mark. status: queued or uploading rings its progress (0-100); error outlines
 *  it, and retry marks it so a press retries. onOpen: a press; onRemove: its remove button, handed the chip. */
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
      <Show when={!image()}><span class="ui-chip-copy"><strong>{props.name}</strong><small>{props.detail}</small></span></Show>
    </button>
    <button type="button" class="ui-chip-remove" aria-label={`Remove ${props.name}`} onClick={() => props.onRemove?.(chip)}><Icons.Close /></button>
  </div>;
}
/** A reference to lines of a file (a review comment): its mark, the file's name, the lines, the note, each cut short
 *  before the name is. onOpen: a press goes to it; onEdit, onRemove: small actions after it (in a composer's rider). */
export function Reference(props: { icon: JSX.Element; name: string; at?: string; note?: string; title?: string; label?: string; onOpen?: () => void; onEdit?: () => void; onRemove?: () => void }) {
  return <span class="ui-reference" title={props.title}>
    <button type="button" class="ui-reference-body" title={props.label} disabled={!props.onOpen} onClick={() => props.onOpen?.()}>{props.icon}<strong>{props.name}</strong><Show when={props.at}><span>{props.at}</span></Show><Show when={props.note}><span>· {props.note}</span></Show></button>
    <Show when={props.onEdit}><Button variant="ghost" size="icon-sm" aria-label={`Edit comment for ${props.name}`} onClick={() => props.onEdit?.()}><Icons.Edit /></Button></Show>
    <Show when={props.onRemove}><Button variant="ghost" size="icon-sm" aria-label={`Remove reference to ${props.name}`} onClick={() => props.onRemove?.()}><Icons.Close /></Button></Show>
  </span>;
}
/** References to files, wrapping onto as many lines as they need. */
export const References = (props: { label?: string; children: JSX.Element }) => <div class="ui-references" role="group" aria-label={props.label}>{props.children}</div>;
/** A list of Choices: one answer, or several (pick any). */
export const Choices = (props: { multi?: boolean; children: JSX.Element }) =>
  <div class="ui-choices" role="listbox" aria-multiselectable={props.multi ? "true" : undefined} onPointerOver={moveCursor}>{props.children}</div>;

/** A numbered answer: label, description, and a check (a box when several may be chosen). own: the typed answer's
 *  field in place of the label. onPick: chosen by a press; onPoint: the pointer is over it (the cursor moves to it). */
export function Choice(props: { n: number; label?: string; detail?: string; title?: string; chosen?: boolean; active?: boolean; multi?: boolean; own?: JSX.Element; onPick?: () => void; onPoint?: () => void }) {
  return <div role="option" class="ui-choice" aria-selected={props.chosen} data-active={props.active ? "true" : undefined} title={props.title} onClick={() => props.onPick?.()} onPointerMove={() => props.onPoint?.()}>
    <span class="ui-choice-key">{props.n}</span><Show when={props.own} fallback={<span class="ui-choice-label">{props.label}</span>}>{props.own}</Show>
    <Show when={props.detail}><span class="ui-choice-detail">{props.detail}</span></Show>
    <span class="ui-choice-check" data-multi={props.multi ? "true" : undefined}><Show when={props.chosen}><Icons.Check /></Show></span>
  </div>;
}

/** Waiting lines under a rider's title (the steering and queued messages), a Line each. */
export const Lines = (props: { children: JSX.Element }) => <ul class="ui-lines">{props.children}</ul>;
/** A strip of Chips that scrolls sideways; fadeStart, fadeEnd: more lies past that edge. */
export const Chips = (props: { ref?: (element: HTMLDivElement) => void; fadeStart?: boolean; fadeEnd?: boolean; onScroll?: () => void; children: JSX.Element }) =>
  <div ref={props.ref} class="ui-chips" data-fade-start={props.fadeStart || undefined} data-fade-end={props.fadeEnd || undefined} onScroll={() => props.onScroll?.()}>{props.children}</div>;
/** What a choice would send, in mono, scrolling: a link, a file's start, a command. */
export const Preview = (props: { format?: string; children: JSX.Element }) => <pre class="ui-preview" data-format={props.format}>{props.children}</pre>;

/** A card rider's top: its title or Tabs, then its close. */
export const RiderTop = (props: { children: JSX.Element }) => <div class="ui-rider-top">{props.children}</div>;
/** A card rider's foot: its Hints, then its actions. */
export const RiderFoot = (props: { children: JSX.Element }) => <div class="ui-rider-foot">{props.children}</div>;
/** A card rider's pages (one question each, then Submit), as Tabs. */
export const Tabs = (props: { label?: string; children: JSX.Element }) => <div class="ui-tabs" role="tablist" aria-label={props.label}>{props.children}</div>;
/** One page's tab; done: ticked (answered). Out of the Tab order: the card's own keys turn its pages. */
export const Tab = (props: { selected?: boolean; done?: boolean; onClick?: () => void; children: JSX.Element }) =>
  <button type="button" role="tab" tabIndex={-1} aria-selected={Boolean(props.selected)} onClick={() => props.onClick?.()}><Show when={props.done}><Icons.Check aria-label="Answered" /></Show>{props.children}</button>;
/** The keys along a rider's foot: [key, what it does]. */
export const Hints = (props: { hints: [string, string][] }) =>
  <div class="ui-hints" aria-hidden="true"><For each={props.hints}>{([key, label]) => <span><Keycap>{key}</Keycap>{label}</span>}</For></div>;
/** One question's page: its Prompt, its Choices, a Preview of the choice. */
export const ChoicesPage = (props: { children: JSX.Element }) => <div class="ui-choices-page">{props.children}</div>;
/** The question, with "pick any" after it when several may be chosen. */
export const Prompt = (props: { multi?: boolean; children: JSX.Element }) =>
  <p class="ui-prompt">{props.children}<Show when={props.multi}><span> · pick any</span></Show></p>;
/** A Choice's own answer typed on one line (a secret, masked). */
export const ChoiceInput = (props: JSX.InputHTMLAttributes<HTMLInputElement>) => <input {...props} class={cn("ui-choice-input", props.class)} />;
/** Before submitting: each question and its answer, a row each, opening its page; empty: not answered yet. */
export const Summary = (props: { rows: { label: string; value: string; empty?: boolean; onOpen?: () => void }[] }) =>
  <div class="ui-summary"><For each={props.rows}>{(row) => <button type="button" tabIndex={-1} onClick={() => row.onOpen?.()}>
    <span>{row.label}</span><span data-empty={row.empty ? "true" : undefined}>{row.value}</span></button>}</For></div>;
