import { Frost } from "./frost";
import * as Icons from "./icons";
import { children, createEffect, createRenderEffect, createSignal, For, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";

import { cn } from "@/lib/utils";
import { Spinner } from "./controls";
import { haptic } from "./haptics";
import { type Motion, motionOf, sinceOf } from "./shared";
export { ANSWER_MARKDOWN } from "./shared";

/**
 * The user's words in frost. Given `fold` lines, a message that runs past them folds to them, its last line fading,
 * "Show more" under it; `open` and `onToggle` are the caller's (opening adds height above whatever follows, so the
 * caller holds the reading position). It measures itself, only when folded, and again when its width changes.
 * `editing`: the message being edited, muted.
 */
export function Bubble(props: { children: JSX.Element; fold?: number; open?: boolean; onToggle?: (event: MouseEvent) => void; editing?: boolean }) {
  let text!: HTMLDivElement;
  // Folded from the first paint: measuring it unfolded would compare the text with itself and always fit.
  const [fits, setFits] = createSignal(false);
  const foldable = () => Boolean(props.fold) && !fits();
  const folded = () => foldable() && !props.open;
  // Whether the text fits its fold: its whole height (scrollHeight, folded or not) against the fold's lines. Never by
  // folding it again to look -- a resize does that every frame of a drag, and the fold's line came and went with it.
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
  // A new fold: measure against it once it has drawn.
  createEffect(() => { if (props.fold && !props.open) requestAnimationFrame(measure); });
  return <Frost class="ui-bubble" data-editing={props.editing ? "true" : undefined}>
    <div ref={text} class="ui-bubble-text" data-folded={folded() ? "" : undefined} style={props.fold ? { "--bubble-fold": props.fold } : undefined}>{props.children}</div>
    <Show when={foldable()}><button type="button" class="ui-bubble-more" aria-expanded={Boolean(props.open)} onClick={(event) => props.onToggle?.(event)}>{props.open ? "Show less" : "Show more"}</button></Show>
  </Frost>;
}

/*
 * Transcript (DESIGN Transcript): what is read, at the transcript's scale. A Turn is its trace header, the
 * answer and the answer's foot; the user's Message is a Bubble and its foot. Shapes only: the orb, the
 * markdown and every action are the caller's.
 */
/** The answer: Markdown with no bubble, the Body role, one gap between blocks. html for rendered Markdown. copied: it
 *  was just copied, and takes the copied wash. A Markdown renderer marks what it draws into it with ANSWER_MARKDOWN. */
/** What a turn says: its answer, and under Narrated what it says on the way there, drawn alike (DESIGN.md, Turns). */
export const Answer = (props: { html?: string; copied?: boolean; children?: JSX.Element }) =>
  <Show when={props.html !== undefined} fallback={<div class="ui-answer" data-copied={props.copied ? "" : undefined}>{props.children}</div>}><div class="ui-answer" data-copied={props.copied ? "" : undefined} innerHTML={props.html} /></Show>;
/** A request that failed: Request failed and when, its facts (model, provider, profile), then what the provider
 *  said. In an answer's place, or in a trace's trail (TraceError). */
export function Failure(props: { time?: string; dateTime?: string; facts?: string[]; message: string }) {
  return <div class="ui-failure" role="alert"><div class="ui-failure-head"><Icons.Warning /><b>Request failed</b><Show when={props.time}><time dateTime={props.dateTime}>{props.time}</time></Show></div>
    <Show when={props.facts?.length}><div class="ui-failure-facts"><For each={props.facts}>{(fact) => <span>{fact}</span>}</For></div></Show>
    <pre>{props.message}</pre></div>;
}
/** A prompt the harness sent on its own (a background task finishing): one muted line at the right, a bell before
 *  it (or its own icon: a heartbeat's quiet line), no bubble and no actions. */
export const HarnessPrompt = (props: { onOpen?: () => void; icon?: JSX.Element; children: JSX.Element }) => <p class="ui-harness-prompt">
  <Show when={props.onOpen} fallback={<>{props.icon ?? <Icons.Notification aria-hidden="true" />}<span>{props.children}</span></>}>
    <button type="button" class="ui-harness-prompt-open" onClick={() => props.onOpen?.()}>{props.icon ?? <Icons.Agent aria-hidden="true" />}<span>{props.children}</span><Icons.ChevronRight aria-hidden="true" /></button>
  </Show>
</p>;
/** What a turn changed, as counts in the data's colours (+added, −removed, mono); opens the changes. In a foot. */
export const Changes = (props: { added: number; removed: number; title?: string; label?: string; onOpen?: () => void }) =>
  <button type="button" class="ui-changes" title={props.title} aria-label={props.label} onClick={() => props.onOpen?.()}><span data-change="added">+{props.added}</span><span data-change="removed">−{props.removed}</span></button>;
/** Anything that folds: a header, one turning chevron, a body. Shape only: the caller opens it (and animates it). */
/**
 * A fold's body (Disclosure, Trace, Step). Given opens -- that it has something to open to, known without drawing it --
 * the body is drawn the first time it opens and kept from then on, so it folds closed with its motion and a long
 * trail costs nothing until it is read. Without, the children are drawn to learn whether there is anything to open.
 */
export function foldBody(props: { opens?: boolean; open?: boolean; children?: JSX.Element }) {
  const [seen, setSeen] = createSignal(Boolean(props.open));
  createRenderEffect(() => { if (props.open) setSeen(true); });
  const body = children(() => props.opens === undefined || seen() ? props.children : undefined);
  return { body, opens: () => props.opens ?? body.toArray().length > 0 };
}
/** A header that opens in place to its children. opens: drawn only once opened (foldBody). */
export function Disclosure(props: { header: JSX.Element; open?: boolean; onToggle?: () => void; disabled?: boolean; opens?: boolean; children?: JSX.Element }) {
  const { body } = foldBody(props);
  return <div class="ui-disclosure" data-open={props.open ? "true" : "false"}>
    <button type="button" class="ui-disclosure-header" aria-expanded={Boolean(props.open)} disabled={props.disabled} onClick={() => { haptic("fold"); props.onToggle?.(); }}>{props.header}<Icons.ChevronDown class="ui-disclosure-chevron" /></button>
    <div class="ui-disclosure-body" aria-hidden={!props.open}>{body()}</div>
  </div>;
}
/** A message's action row: its time first, muted and tabular, then its actions (icon-xs ghost buttons). status: how
 *  the answer ended when it did not finish (Interrupted, Stopping…), after the time. */
export const MessageFoot = (props: { time?: string; dateTime?: string; title?: string; status?: string; end?: boolean; motion?: Motion; children?: JSX.Element }) =>
  <div class="ui-message-foot" data-end={props.end ? "" : undefined} {...motionOf(props.motion)}><Show when={props.time}><time dateTime={props.dateTime} title={props.title}>{props.time}</time></Show><Show when={props.status}><b class="ui-message-status">{props.status}</b></Show>{props.children}</div>;
/** In an answer's place, one stopped before writing any: the stop mark, Interrupted, and when. */
export const StopLine = (props: { detail: string }) =>
  <div class="ui-stop-line" role="status"><Icons.Stop aria-hidden="true" /><b>Interrupted</b>{`\u00a0· ${props.detail}`}</div>;
/** A turn: the trace header, the answer and its foot, one gap apart. */
/** An empty chat's greeting: centred in what holds it, above the room its host keeps for the composer (--welcome-room). */
export const Welcome = (props: { title: string }) => <div class="ui-welcome"><h1>{props.title}</h1></div>;

/** A turn of the agent's: its trace and answer. orb: one hung in the gutter at its left (TurnOrb's place), for a thread
 *  whose turn speaks more than once and keeps its one orb by the row that matters. */
export const Turn = (props: { orb?: JSX.Element; children: JSX.Element }) =>
  <article class="ui-turn"><Show when={props.orb}><span class="ui-turn-orb" aria-hidden="true">{props.orb}</span></Show>{props.children}</article>;
/**
 * The user's message: its Bubble (none when it is only attachments), what came with it (`under`: attachments,
 * references), and its foot at the right. fold, open, onToggle and editing are the Bubble's; time, dateTime and
 * title the foot's. since: how far into its entrance it already is (sinceOf).
 */
export const Message = (props: { time?: string; dateTime?: string; title?: string; actions?: JSX.Element; under?: JSX.Element; fold?: number; open?: boolean; onToggle?: (event: MouseEvent) => void; editing?: boolean; motion?: Motion; since?: number; children?: JSX.Element }) =>
  <article class="ui-message" {...motionOf(props.motion)} style={sinceOf(props.since)}>
    <Show when={props.children}><Bubble fold={props.fold} open={props.open} onToggle={props.onToggle} editing={props.editing}>{props.children}</Bubble></Show>
    {props.under}
    <MessageFoot time={props.time} dateTime={props.dateTime} title={props.title} end>{props.actions}</MessageFoot>
  </article>;
/** The reading column: the composer's width (or --transcript-width, when the pane declares one), one gap between
 *  messages. Drawn row by row for a long chat (the caller windows it), each row a TranscriptRow. */
export function Transcript(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return <div {...rest} class={cn("ui-transcript", local.class)}>{local.children}</div>;
}
/** At a Transcript's top while earlier messages load: a spinner, centred. */
export const LoadingEarlier = () => <div class="ui-loading-earlier" role="status" aria-label="Loading earlier messages"><Spinner /></div>;
/** A row of a Transcript drawn row by row: a message, or a turn's head or answer. turn: it goes on with the turn in
 *  the row above (its answer, under its trace), a turn's gap from it rather than a message's. */
export function TranscriptRow(props: JSX.HTMLAttributes<HTMLDivElement> & { turn?: boolean }) {
  const [local, rest] = splitProps(props, ["turn", "children"]);
  return <div {...rest} class="ui-transcript-row" data-turn={local.turn ? "" : undefined}>{local.children}</div>;
}

/** What is read: the transcript's scale and type for whatever it holds (a turn, a trace, a sample). */
export const Read = (props: { class?: string; children: JSX.Element }) => <div class={cn("ui-read", props.class)}>{props.children}</div>;
