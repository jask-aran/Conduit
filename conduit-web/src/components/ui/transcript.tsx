import { Show, type JSX } from "solid-js";
import { ChevronDownIcon, SquareIcon } from "lucide-solid";
import { cn } from "@/lib/utils";
import { type Motion, motionOf } from "./shared";

export const Bubble = (props: { children: JSX.Element }) => <div class="ui-frost ui-bubble">{props.children}</div>;

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
export const MessageFoot = (props: { time: string; status?: string; end?: boolean; motion?: Motion; children?: JSX.Element }) =>
  <div class="ui-message-foot" data-end={props.end ? "" : undefined} {...motionOf(props.motion)}><time>{props.time}</time><Show when={props.status}><b class="ui-message-status">{props.status}</b></Show>{props.children}</div>;
/** In an answer's place, one stopped before writing any: the stop mark, Interrupted, and when. */
export const StopLine = (props: { detail: string }) =>
  <div class="ui-stop-line" role="status"><SquareIcon aria-hidden="true" /><b>Interrupted</b>{`\u00a0· ${props.detail}`}</div>;
/** A turn: the trace header, the answer and its foot, one gap apart. */
export const Turn = (props: { children: JSX.Element }) => <article class="ui-turn">{props.children}</article>;
/** The user's message: its Bubble and, under it at the right, its foot. */
export const Message = (props: { time: string; actions?: JSX.Element; motion?: Motion; children: JSX.Element }) =>
  <article class="ui-message" {...motionOf(props.motion)}><Bubble>{props.children}</Bubble><MessageFoot time={props.time} end>{props.actions}</MessageFoot></article>;
/** The reading column: the composer's width, its gutter, one gap between messages. */
export const Transcript = (props: { children: JSX.Element; class?: string }) => <div class={cn("ui-transcript", props.class)}>{props.children}</div>;

/** What is read: the transcript's scale and type for whatever it holds (a turn, a trace, a sample). */
export const Read = (props: { class?: string; children: JSX.Element }) => <div class={cn("ui-read", props.class)}>{props.children}</div>;
