import { createSignal, For, Show, splitProps, type JSX } from "solid-js";
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import { Keycap } from "./controls";
import { type Motion, motionOf, moveCursor } from "./shared";

/*
 * Rider: frost on a composer's top edge, either composer's. A row (title,
 * body, actions), a strip (chips, actions) or a card (the question).
 */
export function Rider(props: { label?: string; layout?: "row" | "strip" | "card"; class?: string; motion?: Motion; children: JSX.Element }) {
  return <div class={cn("ui-frost ui-rider", props.class)} data-surface="frost" data-lift="rest" data-layout={props.layout ?? "row"} role="group" aria-label={props.label} {...motionOf(props.motion)}>{props.children}</div>;
}
export const RiderTitle = (props: { children: JSX.Element }) => <span class="ui-title-text">{props.children}</span>;
/** A button riding over the transcript just above the composer: scroll to latest (an icon alone), cancel an edit
 *  (an icon and its words). Resting frost at the surface radius. hidden: kept where it rides but faded out and out of
 *  reach, so it fades back in rather than being drawn again. */
export function RiderButton(props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon: JSX.Element; label: string; show?: "icon" | "label"; motion?: Motion; hidden?: boolean }) {
  const [local, rest] = splitProps(props, ["icon", "label", "show", "class", "motion", "hidden"]);
  return <button type="button" {...rest} {...motionOf(local.motion)} class={cn("ui-frost ui-rider-button", local.class)} data-surface="frost" data-lift="rest" data-labelled={local.show === "label" ? "" : undefined}
    data-hidden={local.hidden ? "" : undefined} aria-hidden={local.hidden ? "true" : undefined} tabIndex={local.hidden ? -1 : undefined}
    aria-label={local.show === "label" ? undefined : local.label} title={local.show === "label" ? undefined : local.label}>{local.icon}<Show when={local.show === "label"}><span>{local.label}</span></Show></button>;
}
export const RiderActions = (props: { stack?: boolean; children: JSX.Element }) => <div class="ui-rider-actions" data-stack={props.stack ? "" : undefined}>{props.children}</div>;
/** A line of waiting text, one line until opened. */
export function Line(props: { text: string; clipped?: boolean }) {
  const [open, setOpen] = createSignal(false);
  return <li class="ui-line" data-expanded={open() ? "true" : "false"}><p class="ui-line-body">{props.text}</p>
    <Show when={props.clipped}><button type="button" class="ui-line-more" aria-label={open() ? "Show less" : "Show more"} onClick={() => setOpen(!open())}><ChevronDownIcon /></button></Show></li>;
}
/** An attached thing: an image's thumbnail, or a file's mark, name and size. */
export function Chip(props: { name: string; detail?: string; image?: string; icon?: JSX.Element; status?: "uploading" | "error" | "done"; progress?: number; motion?: Motion }) {
  const ring = 2 * Math.PI * 9;
  return <div class="ui-chip" data-kind={props.image ? "image" : "file"} data-status={props.status ?? "done"} {...motionOf(props.motion)}>
    <button type="button" class="ui-chip-body" aria-label={`Show ${props.name}`}>
      <span class="ui-chip-media"><Show when={props.image} fallback={props.icon}><img src={props.image} alt="" /></Show>
        <Show when={props.status === "uploading"}><svg class="ui-chip-ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="9" stroke-dasharray={`${ring}`} stroke-dashoffset={ring * (1 - (props.progress ?? 40) / 100)} /></svg></Show></span>
      <Show when={!props.image}><span class="ui-chip-copy"><strong>{props.name}</strong><small>{props.detail}</small></span></Show>
    </button>
    <button type="button" class="ui-chip-remove" aria-label={`Remove ${props.name}`}><XIcon /></button>
  </div>;
}
/** A list of Choices: one answer, or several (pick any). */
export const Choices = (props: { multi?: boolean; children: JSX.Element }) =>
  <div class="ui-choices" role="listbox" aria-multiselectable={props.multi ? "true" : undefined} onPointerOver={moveCursor}>{props.children}</div>;

/** A numbered answer: label, description, and a check (a box when several may be chosen). */
export function Choice(props: { n: number; label: string; detail?: string; chosen?: boolean; active?: boolean; multi?: boolean }) {
  return <div role="option" class="ui-choice" aria-selected={props.chosen} data-active={props.active ? "true" : undefined}>
    <span class="ui-choice-key">{props.n}</span><span class="ui-choice-label">{props.label}</span>
    <Show when={props.detail}><span class="ui-choice-detail">{props.detail}</span></Show>
    <span class="ui-choice-check" data-multi={props.multi ? "true" : undefined}><Show when={props.chosen}><CheckIcon /></Show></span>
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
/** A card rider's pages (one question each, then Submit), as tabs: buttons with role tab. */
export const Tabs = (props: { label?: string; children: JSX.Element }) => <div class="ui-tabs" role="tablist" aria-label={props.label}>{props.children}</div>;
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
