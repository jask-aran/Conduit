import { createEffect, createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { ChevronDownIcon, SquareIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import { type Motion, motionOf, sinceOf } from "./shared";

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
  const measure = () => { if (folded()) setFits(text.scrollHeight - text.clientHeight <= 1); };
  onMount(() => {
    if (!props.fold) return;
    let width = text.clientWidth;
    const resized = new ResizeObserver(() => {
      if (text.clientWidth === width) return;
      width = text.clientWidth;
      setFits(false);
      requestAnimationFrame(measure);
    });
    resized.observe(text);
    onCleanup(() => resized.disconnect());
    measure();
  });
  // A new fold: fold again, then measure once that has drawn.
  createEffect(() => { if (props.fold && !props.open) { setFits(false); requestAnimationFrame(measure); } });
  return <div class="ui-frost ui-bubble" data-editing={props.editing ? "true" : undefined}>
    <div ref={text} class="ui-bubble-text" data-folded={folded() ? "" : undefined} style={props.fold ? { "--bubble-fold": props.fold } : undefined}>{props.children}</div>
    <Show when={foldable()}><button type="button" class="ui-bubble-more" aria-expanded={Boolean(props.open)} onClick={(event) => props.onToggle?.(event)}>{props.open ? "Show less" : "Show more"}</button></Show>
  </div>;
}

/*
 * Transcript (DESIGN Transcript): what is read, at the transcript's scale. A Turn is its trace header, the
 * answer and the answer's foot; the user's Message is a Bubble and its foot. Shapes only: the orb, the
 * markdown and every action are the caller's.
 */
/** The answer: Markdown with no bubble, the Body role, one gap between blocks. html for rendered Markdown. */
export const Answer = (props: { html?: string; children?: JSX.Element }) =>
  <Show when={props.html !== undefined} fallback={<div class="ui-answer">{props.children}</div>}><div class="ui-answer" innerHTML={props.html} /></Show>;
/** Anything that folds: a header, one turning chevron, a body. Shape only: the caller opens it (and animates it). */
export function Disclosure(props: { header: JSX.Element; open?: boolean; onToggle?: () => void; disabled?: boolean; children?: JSX.Element }) {
  return <div class="ui-disclosure" data-open={props.open ? "true" : "false"}>
    <button type="button" class="ui-disclosure-header" aria-expanded={Boolean(props.open)} disabled={props.disabled} onClick={() => props.onToggle?.()}>{props.header}<ChevronDownIcon class="ui-disclosure-chevron" /></button>
    <div class="ui-disclosure-body" aria-hidden={!props.open}>{props.children}</div>
  </div>;
}
/** A message's action row: its time first, muted and tabular, then its actions (icon-xs ghost buttons). status: how
 *  the answer ended when it did not finish (Interrupted, Stopping…), after the time. */
export const MessageFoot = (props: { time?: string; dateTime?: string; title?: string; status?: string; end?: boolean; motion?: Motion; children?: JSX.Element }) =>
  <div class="ui-message-foot" data-end={props.end ? "" : undefined} {...motionOf(props.motion)}><Show when={props.time}><time dateTime={props.dateTime} title={props.title}>{props.time}</time></Show><Show when={props.status}><b class="ui-message-status">{props.status}</b></Show>{props.children}</div>;
/** In an answer's place, one stopped before writing any: the stop mark, Interrupted, and when. */
export const StopLine = (props: { detail: string }) =>
  <div class="ui-stop-line" role="status"><SquareIcon aria-hidden="true" /><b>Interrupted</b>{`\u00a0· ${props.detail}`}</div>;
/** A turn: the trace header, the answer and its foot, one gap apart. */
export const Turn = (props: { children: JSX.Element }) => <article class="ui-turn">{props.children}</article>;
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
/** The reading column: the composer's width, its gutter, one gap between messages. */
export const Transcript = (props: { children: JSX.Element; class?: string }) => <div class={cn("ui-transcript", props.class)}>{props.children}</div>;

/** What is read: the transcript's scale and type for whatever it holds (a turn, a trace, a sample). */
export const Read = (props: { class?: string; children: JSX.Element }) => <div class={cn("ui-read", props.class)}>{props.children}</div>;
