import { Frost } from "./frost";
import * as Icons from "./icons";
import { children, createEffect, createRenderEffect, createSignal, For, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";

import { cn } from "@/lib/utils";
import { ShowMore } from "./controls";
import { Loading } from "./state";
import { type Motion, motionOf, sinceOf } from "./shared";
import { Later } from "./later";
import { Expand } from "./expand";
import { clockTime, fullTime } from "./time";
import { createTailWindow } from "./tail-window";
import { useChatDrawing } from "./chat-drawing";
export { ANSWER_MARKDOWN } from "./shared";

export function Bubble(props: { children: JSX.Element; fold?: number; open?: boolean; onToggle?: (event: MouseEvent) => void; editing?: boolean }) {
  let text!: HTMLDivElement;
  // Folded from the first paint: measuring it unfolded would compare the text with itself and always fit.
  const [fits, setFits] = createSignal(false);
  const foldable = () => Boolean(props.fold) && !fits();
  const folded = () => foldable() && !props.open;
  // Measured against the fold's lines, never by refolding to look: a drag resize flickers the fold.
  const measure = () => {
    const line = Number.parseFloat(getComputedStyle(text).lineHeight);
    if (Number.isFinite(line)) setFits(text.scrollHeight <= (props.fold ?? 0) * line + 1);
    else if (folded()) setFits(text.scrollHeight - text.clientHeight <= 1);
  };
  onMount(() => {
    if (!props.fold) return;
    let width = text.clientWidth;
    const resized = new ResizeObserver(() => {
      if (text.clientWidth === width) return;
      width = text.clientWidth;
      measure();
    });
    resized.observe(text);
    onCleanup(() => resized.disconnect());
    measure();
  });
  createEffect(() => { if (props.fold && !props.open) requestAnimationFrame(measure); });
  return <Frost class="ui-bubble" data-editing={props.editing ? "true" : undefined}>
    <div ref={text} class="ui-bubble-text" data-folded={folded() ? "" : undefined} style={props.fold ? { "--bubble-fold": props.fold } : undefined}>{props.children}</div>
    <Show when={foldable()}><ShowMore open={Boolean(props.open)} onToggle={(event) => props.onToggle?.(event)} /></Show>
  </Frost>;
}

export const Answer = (props: { html?: string; copied?: boolean; children?: JSX.Element }) =>
  <Show when={props.html !== undefined} fallback={<div class="ui-answer" data-copied={props.copied ? "" : undefined}>{props.children}</div>}><div class="ui-answer" data-copied={props.copied ? "" : undefined} innerHTML={props.html} /></Show>;
export function Failure(props: { time?: string; dateTime?: string; facts?: string[]; message: string }) {
  return <div class="ui-failure" role="alert"><div class="ui-failure-head"><Icons.Warning /><b>Request failed</b><Show when={props.time}><time dateTime={props.dateTime}>{props.time}</time></Show></div>
    <Show when={props.facts?.length}><div class="ui-failure-facts"><For each={props.facts}>{(fact) => <span>{fact}</span>}</For></div></Show>
    <pre>{props.message}</pre></div>;
}
export const HarnessPrompt = (props: { onOpen?: () => void; icon?: JSX.Element; unseen?: string; children: JSX.Element }) => <p class="ui-harness-prompt">
  <Show when={props.onOpen} fallback={<>{props.icon ?? <Icons.Notification aria-hidden="true" />}<span>{props.children}</span></>}>
    <button type="button" class="ui-harness-prompt-open" onClick={() => props.onOpen?.()}>{props.icon ?? <Icons.Agent aria-hidden="true" />}<span>{props.children}</span><Icons.ChevronRight aria-hidden="true" /></button>
  </Show>
  <Show when={props.unseen}><span class="ui-harness-prompt-unseen">{props.unseen}</span></Show>
</p>;
export const ConduitAdded = (props: { text: string; before?: boolean }) =>
  <div class="ui-conduit-added" data-before={props.before ? "" : undefined}><span>Conduit added</span><p>{props.text}</p></div>;
function Envelope(props: { direction: "in" | "out"; icon: JSX.Element; from: string; meta?: string; time?: string; dateTime?: string; title?: string;
  onOpen?: () => void; openLabel?: string; fold?: number; noted?: string; appended?: string; shut?: boolean;
  onBack?: () => void; backLabel?: string; children?: JSX.Element }) {
  let text!: HTMLDivElement;
  const [open, setOpen] = createSignal(false);
  const [shown, setShown] = createSignal(!props.shut);
  // Measured again when the text grows (late Markdown) or the column changes width.
  const [fits, setFits] = createSignal(true);
  const folded = () => Boolean(props.fold) && !open();
  const measure = () => { if (folded()) setFits(text.scrollHeight - text.clientHeight <= 1); };
  // A shut envelope's text is in the document only once opened (Expand).
  const watch = (element: HTMLDivElement) => {
    text = element;
    if (!props.fold) return;
    onMount(() => {
      const resized = new ResizeObserver(measure);
      resized.observe(element);
      if (element.firstElementChild) resized.observe(element.firstElementChild);
      onCleanup(() => resized.disconnect());
    });
  };
  const who = () => <>{props.icon}<b>{props.from}</b><Show when={props.meta}><span class="ui-envelope-meta ui-truncate">{props.meta}</span></Show></>;
  return <section class="ui-envelope ui-disclosure" data-direction={props.direction} data-open={shown() ? "true" : "false"}>
    <header class="ui-envelope-head">
      <Show when={props.shut} fallback={who()}>
        <button type="button" class="ui-envelope-toggle" aria-expanded={shown()} onClick={() => setShown(!shown())}>{who()}<Icons.ChevronDown class="ui-disclosure-chevron ui-fold-chevron ui-size-icon-sm" data-turn="half" /></button>
      </Show>
      <Show when={props.onBack}><button type="button" class="ui-envelope-open ui-envelope-back" onClick={() => props.onBack?.()}>{props.backLabel ?? "Back"}<Icons.ArrowUp aria-hidden="true" /></button></Show>
      <Show when={props.time}><time class="ui-envelope-time" dateTime={props.dateTime} title={props.title}>{props.time}</time></Show>
      <Show when={props.onOpen}><button type="button" class="ui-envelope-open" onClick={() => props.onOpen?.()}>{props.openLabel ?? "Open"}<Icons.ChevronRight aria-hidden="true" /></button></Show>
    </header>
    <Expand open={shown()} class="ui-disclosure-body"><div class="ui-envelope-rule">
      <Show when={props.noted}><ConduitAdded before text={props.noted!} /></Show>
      <div ref={watch} class="ui-envelope-text" data-folded={folded() ? "" : undefined} data-fits={fits() ? "" : undefined} style={props.fold ? { "--envelope-fold": props.fold } : undefined}>{props.children}</div>
      <Show when={props.fold && !fits()}><ShowMore open={open()} more="Show all" onToggle={() => setOpen(!open())} /></Show>
      <Show when={props.appended}><ConduitAdded text={props.appended!} /></Show>
    </div></Expand>
  </section>;
}
export const Inbound = (props: Omit<Parameters<typeof Envelope>[0], "direction">) => <Envelope direction="in" {...props} />;
export const Outbound = (props: Omit<Parameters<typeof Envelope>[0], "direction" | "appended" | "noted">) => <Envelope direction="out" {...props} />;
export const Changes = (props: { added: number; removed: number; title?: string; label?: string; onOpen?: () => void }) =>
  <button type="button" class="ui-changes" data-wash title={props.title} aria-label={props.label} onClick={() => props.onOpen?.()}><span data-change="added">+{props.added}</span><span data-change="removed">−{props.removed}</span></button>;
/** Given opens, the body is drawn on first open and kept, so a long trail costs nothing until read; without, the
 *  children are drawn to learn whether there is anything to open. */
/* Lets find reach what a closed fold has not drawn: `text` is what opening would draw, `open` opens it. */
const foldFinds = new WeakMap<Element, { text: () => string; open: () => void }>();
export const foldFindOf = (element: Element) => foldFinds.get(element);
export const registerFoldFind = (element: Element, text: () => string, open: () => void) => { foldFinds.set(element, { text, open }); };
export function foldBody(props: { opens?: boolean; open?: boolean; children?: JSX.Element }) {
  const [seen, setSeen] = createSignal(Boolean(props.open));
  createRenderEffect(() => { if (props.open) setSeen(true); });
  const body = children(() => props.opens === undefined || seen() ? props.children : undefined);
  return { body, opens: () => props.opens ?? body.toArray().length > 0 };
}
export const MessageFoot = (props: { at?: string | null; time?: string; dateTime?: string; title?: string; status?: string; notified?: string; end?: boolean; eager?: boolean; motion?: Motion; children?: JSX.Element }) => {
  const time = () => props.time ?? clockTime(props.at);
  return <div class="ui-message-foot" data-end={props.end ? "" : undefined} {...motionOf(props.motion)}><Show when={props.notified}><span class="ui-message-bell"><Icons.Notification aria-hidden="true" />{props.notified}</span></Show><Show when={time()}><time dateTime={props.dateTime ?? props.at ?? undefined} title={props.title ?? (props.at ? fullTime(props.at) : undefined)}>{time()}</time></Show><Show when={props.status}><b class="ui-message-status">{props.status}</b></Show><Later now={props.eager}>{props.children}</Later></div>;
};
export const StopLine = (props: { detail: string }) =>
  <div class="ui-stop-line" role="status"><Icons.Stop aria-hidden="true" /><b>Interrupted</b>{`\u00a0· ${props.detail}`}</div>;
export const Welcome = (props: { title: string }) => <div class="ui-welcome"><h1>{props.title}</h1></div>;

export const Turn = (props: { orb?: JSX.Element; bubble?: boolean; children: JSX.Element }) =>
  <article class="ui-turn" data-bubble={props.bubble ? "" : undefined}><Show when={props.orb}><span class="ui-turn-orb" aria-hidden="true">{props.orb}</span></Show>{props.children}</article>;
export const Message = (props: { at?: string | null; eager?: boolean; time?: string; dateTime?: string; title?: string; status?: string; actions?: JSX.Element; before?: JSX.Element; under?: JSX.Element; fold?: number; open?: boolean; onToggle?: (event: MouseEvent) => void; editing?: boolean; motion?: Motion; since?: number; children?: JSX.Element }) =>
  <article class="ui-message" {...motionOf(props.motion)} style={sinceOf(props.since)}>
    {props.before}
    <Show when={props.children}><Bubble fold={props.fold} open={props.open} onToggle={props.onToggle} editing={props.editing}>{props.children}</Bubble></Show>
    {props.under}
    <MessageFoot at={props.at} eager={props.eager} time={props.time} dateTime={props.dateTime} title={props.title} status={props.status} end>{props.actions}</MessageFoot>
  </article>;
export function Transcript(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return <div {...rest} class={cn("ui-transcript", local.class)}>{local.children}</div>;
}
export function TranscriptList<T>(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "ref"> & {
  each: readonly T[]; of: unknown; estimate?: (item: T, width: number) => number; whole?: () => boolean; holdsFoot?: boolean;
  before?: JSX.Element; after?: JSX.Element; ref?: (element: HTMLDivElement) => void;
  children: (item: T, index: () => number) => JSX.Element;
}) {
  const [local, rest] = splitProps(props, ["each", "of", "estimate", "whole", "holdsFoot", "before", "after", "ref", "children"]);
  let list: HTMLDivElement | undefined;
  const viewport = () => list?.closest<HTMLElement>(".ui-chat-viewport") ?? list?.parentElement ?? undefined;
  // A scroller's offset is whole pixels, so rows of fractional height going in above put the view a pixel off at each
  // step; a sliver of top padding keeps the foot on a whole pixel. Set as the tail's older rows go in, before it holds
  // the foot, and as anything else changes the list's size.
  let sliver = 0;
  const settle = () => {
    const host = viewport();
    if (!list || !host) return;
    const foot = list.getBoundingClientRect().bottom - host.getBoundingClientRect().top + host.scrollTop - sliver;
    const next = Math.round((Math.ceil(foot - 0.01) - foot) * 100) / 100;
    if (Math.abs(next - sliver) < 0.01) return;
    sliver = next;
    list.style.paddingTop = sliver ? `${sliver}px` : "";
  };
  onMount(() => {
    const sizes = new ResizeObserver(settle);
    if (list) sizes.observe(list);
    onCleanup(() => sizes.disconnect());
  });
  const tail = createTailWindow({ settle,
    items: () => local.each, key: () => local.of, whole: () => local.whole?.() ?? false,
    room: () => viewport()?.clientHeight ?? 0,
    estimate: local.estimate && ((item: T) => local.estimate!(item, list?.clientWidth || viewport()?.clientWidth || 0)),
    fills: () => { const host = viewport(); return Boolean(list && host && list.offsetHeight >= host.clientHeight); },
    scroller: () => local.holdsFoot === false ? undefined : viewport(),
  });
  useChatDrawing(tail.drawn);
  return <div {...rest} ref={(element) => { list = element; local.ref?.(element); }} class={cn("ui-transcript", rest.class)} data-drawn={tail.drawn() ? "" : undefined}>
    {local.before}
    <For each={tail.shown()}>{(item, index) => local.children(item, () => index() + tail.offset())}</For>
    {local.after}
  </div>;
}
export const LoadingEarlier = () => <Loading kind="earlier" label="Loading earlier messages" />;
export type TranscriptFlow = "work" | "attached" | "step" | "answer" | "exchange" | "turn";
export function TranscriptRow(props: JSX.HTMLAttributes<HTMLDivElement> & { flow?: TranscriptFlow }) {
  const [local, rest] = splitProps(props, ["flow", "children"]);
  return <div {...rest} class="ui-transcript-row" data-flow={local.flow}>{local.children}</div>;
}

export const Read = (props: { class?: string; children: JSX.Element }) => <div class={cn("ui-read", props.class)}>{props.children}</div>;
