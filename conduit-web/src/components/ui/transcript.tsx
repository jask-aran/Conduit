import { Frost } from "./frost";
import * as Icons from "./icons";
import { children, createEffect, createRenderEffect, createSignal, For, onCleanup, onMount, Show, splitProps, type JSX } from "solid-js";

import { cn } from "@/lib/utils";
import { Spinner } from "./controls";
import { type Motion, motionOf, sinceOf } from "./shared";
import { Later } from "./later";
import { clockTime, fullTime } from "./time";
import { createTailWindow } from "./tail-window";
import { useChatDrawing } from "./chat-drawing";
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
/** A prompt the harness sent on its own with nothing more to read (a background task finishing): one muted line, a bell
 *  before it (or its own icon: a heartbeat's quiet line), no bubble and no actions. A message with a body is Inbound.
 *  unseen: a line only Conduit's record has (the agent was never given it), said after it so the thread stays faithful. */
export const HarnessPrompt = (props: { onOpen?: () => void; icon?: JSX.Element; unseen?: string; children: JSX.Element }) => <p class="ui-harness-prompt">
  <Show when={props.onOpen} fallback={<>{props.icon ?? <Icons.Notification aria-hidden="true" />}<span>{props.children}</span></>}>
    <button type="button" class="ui-harness-prompt-open" onClick={() => props.onOpen?.()}>{props.icon ?? <Icons.Agent aria-hidden="true" />}<span>{props.children}</span><Icons.ChevronRight aria-hidden="true" /></button>
  </Show>
  <Show when={props.unseen}><span class="ui-harness-prompt-unseen">{props.unseen}</span></Show>
</p>;
/** Text Conduit put into a prompt it delivered, beside the prompt's own: before it (`before`: the stop, update and time
 *  notes) or after it (the decision a report asks for). Labelled and quieter, in full: shown, never hidden. */
export const ConduitAdded = (props: { text: string; before?: boolean }) =>
  <div class="ui-conduit-added" data-before={props.before ? "" : undefined}><span>Conduit added</span><p>{props.text}</p></div>;
/**
 * A message that crosses the thread's edge, drawn as it crossed (DESIGN Transcript, Messages in and out). Inbound: a
 * prompt the person did not write -- a run reporting back, Conduit saying how an approval went -- exactly as the agent
 * was given it. Outbound: what the agent sent the person outside the thread (a notification). Both at the left: a
 * header of who and when (its mark, its name, what it was in `meta`, the time; Open at the right when it has a
 * transcript), then the text on a hairline rule hung from the mark, folding past `fold` lines. What Conduit added to it
 * for the agent sits apart, labelled, quieter -- shown, never hidden: notes before the text (`noted`), the decision it
 * asks for after it (`appended`).
 */
function Envelope(props: { direction: "in" | "out"; icon: JSX.Element; from: string; meta?: string; time?: string; dateTime?: string; title?: string;
  onOpen?: () => void; openLabel?: string; fold?: number; noted?: string; appended?: string; shut?: boolean;
  /** Back to where it began (a subagent's report: the line that started it), labelled backLabel. */
  onBack?: () => void; backLabel?: string; children?: JSX.Element }) {
  let text!: HTMLDivElement;
  const [open, setOpen] = createSignal(false);
  // shut: starts as its header alone (who, what, when), opening in place to its text -- a run's report, a notification.
  const [shown, setShown] = createSignal(!props.shut);
  // Held to its fold until opened; whether it runs past it is measured against the fold itself, again whenever the
  // text grows (its Markdown arrives after the first paint) or the column changes width.
  const [fits, setFits] = createSignal(true);
  const folded = () => Boolean(props.fold) && !open();
  const measure = () => { if (folded()) setFits(text.scrollHeight - text.clientHeight <= 1); };
  onMount(() => {
    if (!props.fold) return;
    const resized = new ResizeObserver(measure);
    resized.observe(text);
    if (text.firstElementChild) resized.observe(text.firstElementChild);
    onCleanup(() => resized.disconnect());
  });
  const who = () => <>{props.icon}<b>{props.from}</b><Show when={props.meta}><span class="ui-envelope-meta">{props.meta}</span></Show></>;
  return <section class="ui-envelope ui-disclosure" data-direction={props.direction} data-open={shown() ? "true" : "false"}>
    <header class="ui-envelope-head">
      <Show when={props.shut} fallback={who()}>
        <button type="button" class="ui-envelope-toggle" aria-expanded={shown()} onClick={() => setShown(!shown())}>{who()}<Icons.ChevronDown class="ui-disclosure-chevron" /></button>
      </Show>
      <Show when={props.onBack}><button type="button" class="ui-envelope-open ui-envelope-back" onClick={() => props.onBack?.()}>{props.backLabel ?? "Back"}<Icons.ArrowUp aria-hidden="true" /></button></Show>
      <Show when={props.time}><time dateTime={props.dateTime} title={props.title}>{props.time}</time></Show>
      <Show when={props.onOpen}><button type="button" class="ui-envelope-open" onClick={() => props.onOpen?.()}>{props.openLabel ?? "Open"}<Icons.ChevronRight aria-hidden="true" /></button></Show>
    </header>
    <div class="ui-disclosure-body"><div class="ui-envelope-rule">
      <Show when={props.noted}><ConduitAdded before text={props.noted!} /></Show>
      <div ref={text} class="ui-envelope-text" data-folded={folded() ? "" : undefined} data-fits={fits() ? "" : undefined} style={props.fold ? { "--envelope-fold": props.fold } : undefined}>{props.children}</div>
      <Show when={props.fold && !fits()}><button type="button" class="ui-envelope-more" aria-expanded={open()} onClick={() => setOpen(!open())}>{open() ? "Show less" : "Show all"}</button></Show>
      <Show when={props.appended}><ConduitAdded text={props.appended!} /></Show>
    </div></div>
  </section>;
}
/** A prompt the person did not write, as the agent was given it (Envelope): a run's report under its routine's mark and
 *  name, `meta` its id and how it ended; Conduit on an approval. */
export const Inbound = (props: Omit<Parameters<typeof Envelope>[0], "direction">) => <Envelope direction="in" {...props} />;
/** What the agent sent the person outside the thread, as it was sent (Envelope): a notification's title and line. */
export const Outbound = (props: Omit<Parameters<typeof Envelope>[0], "direction" | "appended" | "noted">) => <Envelope direction="out" {...props} />;
/** What a turn changed, as counts in the data's colours (+added, −removed, mono); opens the changes. In a foot. */
export const Changes = (props: { added: number; removed: number; title?: string; label?: string; onOpen?: () => void }) =>
  <button type="button" class="ui-changes" title={props.title} aria-label={props.label} onClick={() => props.onOpen?.()}><span data-change="added">+{props.added}</span><span data-change="removed">−{props.removed}</span></button>;
/**
 * A fold's body (Trace, Step). Given opens -- that it has something to open to, known without drawing it --
 * the body is drawn the first time it opens and kept from then on, so it folds closed with its motion and a long
 * trail costs nothing until it is read. Without, the children are drawn to learn whether there is anything to open.
 */
/*
 * Find reaches what a closed fold has not drawn (client/chat/transcript-find.ts). A fold given `find` (Trace, Step) is
 * marked data-find-fold while closed and registered here: `text` is what opening it would draw, read only when a
 * search runs; `open` opens it, so a match inside can be shown. Matches are counted where the fold is.
 */
const foldFinds = new WeakMap<Element, { text: () => string; open: () => void }>();
export const foldFindOf = (element: Element) => foldFinds.get(element);
export const registerFoldFind = (element: Element, text: () => string, open: () => void) => { foldFinds.set(element, { text, open }); };
export function foldBody(props: { opens?: boolean; open?: boolean; children?: JSX.Element }) {
  const [seen, setSeen] = createSignal(Boolean(props.open));
  createRenderEffect(() => { if (props.open) setSeen(true); });
  const body = children(() => props.opens === undefined || seen() ? props.children : undefined);
  return { body, opens: () => props.opens ?? body.toArray().length > 0 };
}
/** A message's action row: its time first, muted and tabular, then its actions (icon-xs ghost buttons). status: how
 *  the answer ended when it did not finish (Interrupted, Stopping…), after the time. */
/** The message's action row; `notified`: where it was pushed besides ("Sent to Phone"), a bell and those words before
 *  the time, always shown. */
/** at: when it was said (an ISO time): its time, datetime and full title from that, each formatted once (time.ts),
 *  in time/dateTime/title's place. Its actions (children) are built in idle time after the rows are drawn (Later):
 *  unseen until the row is revealed, but the latest exchange's -- eager: drawn with it (that one, shown). */
export const MessageFoot = (props: { at?: string | null; time?: string; dateTime?: string; title?: string; status?: string; notified?: string; end?: boolean; eager?: boolean; motion?: Motion; children?: JSX.Element }) => {
  const time = () => props.time ?? clockTime(props.at);
  return <div class="ui-message-foot" data-end={props.end ? "" : undefined} {...motionOf(props.motion)}><Show when={props.notified}><span class="ui-message-bell"><Icons.Notification aria-hidden="true" />{props.notified}</span></Show><Show when={time()}><time dateTime={props.dateTime ?? props.at ?? undefined} title={props.title ?? (props.at ? fullTime(props.at) : undefined)}>{time()}</time></Show><Show when={props.status}><b class="ui-message-status">{props.status}</b></Show><Later now={props.eager}>{props.children}</Later></div>;
};
/** In an answer's place, one stopped before writing any: the stop mark, Interrupted, and when. */
export const StopLine = (props: { detail: string }) =>
  <div class="ui-stop-line" role="status"><Icons.Stop aria-hidden="true" /><b>Interrupted</b>{`\u00a0· ${props.detail}`}</div>;
/** A turn: the trace header, the answer and its foot, one gap apart. */
/** An empty chat's greeting: centred in what holds it, above the room its host keeps for the composer (--welcome-room). */
export const Welcome = (props: { title: string }) => <div class="ui-welcome"><h1>{props.title}</h1></div>;

/** A turn of the agent's: its trace and answer. bubble: its answer in a hairline bubble, a tail rising from its top-left
 *  corner, as a messaging app draws what the other side said (the agent's page). orb: one hung in the gutter at its left (TurnOrb's place), for a thread
 *  whose turn speaks more than once and keeps its one orb by the row that matters. */
export const Turn = (props: { orb?: JSX.Element; bubble?: boolean; children: JSX.Element }) =>
  <article class="ui-turn" data-bubble={props.bubble ? "" : undefined}><Show when={props.orb}><span class="ui-turn-orb" aria-hidden="true">{props.orb}</span></Show>{props.children}</article>;
/**
 * The user's message: what Conduit put before it (`before`: ConduitAdded), its Bubble (none when it is only
 * attachments), what came with it (`under`: attachments, references), and its foot at the right. fold, open, onToggle and editing are the Bubble's; time, dateTime and
 * title the foot's, and status (Waiting to send: one kept on this device until the hub can take it). since: how far into
 * its entrance it already is (sinceOf).
 */
export const Message = (props: { at?: string | null; eager?: boolean; time?: string; dateTime?: string; title?: string; status?: string; actions?: JSX.Element; before?: JSX.Element; under?: JSX.Element; fold?: number; open?: boolean; onToggle?: (event: MouseEvent) => void; editing?: boolean; motion?: Motion; since?: number; children?: JSX.Element }) =>
  <article class="ui-message" {...motionOf(props.motion)} style={sinceOf(props.since)}>
    {props.before}
    <Show when={props.children}><Bubble fold={props.fold} open={props.open} onToggle={props.onToggle} editing={props.editing}>{props.children}</Bubble></Show>
    {props.under}
    <MessageFoot at={props.at} eager={props.eager} time={props.time} dateTime={props.dateTime} title={props.title} status={props.status} end>{props.actions}</MessageFoot>
  </article>;
/** The reading column: the composer's width (or --transcript-width, when the pane declares one), one gap between
 *  messages. Drawn row by row for a long chat (the caller windows it), each row a TranscriptRow. */
export function Transcript(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ["class", "children"]);
  return <div {...rest} class={cn("ui-transcript", local.class)}>{local.children}</div>;
}
/**
 * A Transcript of a list, drawn the fast way by default (createTailWindow): opening on as many of its newest items as
 * fill the viewport it is in (estimate: a guess at an item's height at a column width; measured once, before the
 * paint), the older ones added above in idle time. `of`: what it is a list of (a new one opens at its tail again);
 * whole: open it whole instead (a place to come back to above its foot). Drawn -- everything on screen is --
 * it says so (data-drawn), and the ChatView it is in shows only then (ChatDrawing). holdsFoot (on): as older items go
 * in above, its scroller keeps its distance from the foot; off for a host that holds its own (a chat's transcript).
 * before/after: rows around the list's (a loading spinner, a working row). children: a row, by its item and index.
 */
export function TranscriptList<T>(props: Omit<JSX.HTMLAttributes<HTMLDivElement>, "children" | "ref"> & {
  each: readonly T[]; of: unknown; estimate?: (item: T, width: number) => number; whole?: () => boolean; holdsFoot?: boolean;
  before?: JSX.Element; after?: JSX.Element; ref?: (element: HTMLDivElement) => void;
  children: (item: T, index: () => number) => JSX.Element;
}) {
  const [local, rest] = splitProps(props, ["each", "of", "estimate", "whole", "holdsFoot", "before", "after", "ref", "children"]);
  let list: HTMLDivElement | undefined;
  const viewport = () => list?.closest<HTMLElement>(".ui-chat-viewport") ?? list?.parentElement ?? undefined;
  const tail = createTailWindow({
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
/** At a Transcript's top while earlier messages load: a spinner, centred. */
export const LoadingEarlier = () => <div class="ui-loading-earlier" role="status" aria-label="Loading earlier messages"><Spinner /></div>;
/** How a row relates to the row above it, which sets the room between them (--flow-*, DESIGN Transcript › Rhythm):
 *  attached (belongs to it), step (the next part of one reply), exchange (the reply to a message), turn (the next
 *  exchange). */
export type TranscriptFlow = "work" | "attached" | "step" | "answer" | "exchange" | "turn";
/** A row of a Transcript drawn row by row: a message, or a turn's trace or answer. flow: how it relates to the row
 *  above (none for the first). */
export function TranscriptRow(props: JSX.HTMLAttributes<HTMLDivElement> & { flow?: TranscriptFlow }) {
  const [local, rest] = splitProps(props, ["flow", "children"]);
  return <div {...rest} class="ui-transcript-row" data-flow={local.flow}>{local.children}</div>;
}

/** What is read: the transcript's scale and type for whatever it holds (a turn, a trace, a sample). */
export const Read = (props: { class?: string; children: JSX.Element }) => <div class={cn("ui-read", props.class)}>{props.children}</div>;
