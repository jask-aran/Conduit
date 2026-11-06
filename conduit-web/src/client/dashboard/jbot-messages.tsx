import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Suspense, Switch } from "solid-js";
import { splitQuoted } from "../../email-quote.js";
import { Answer, Button, DashConversation, EmailItem, Icons, Message, MessageFeedback, MessageFoot, ReportCard, RoomRow, Step, Trail, Transcript, TranscriptRow, Turn, type TranscriptFlow } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { api } from "../api/client";
import { setAgentPageLaidOut } from "../state/arrival";
import { ChatMarkdown } from "../chat/lazy-markdown";
import type { MarkdownRendererId } from "../chat/markdown-settings";

/**
 * jbot's messages on its page (docs/plans/persistent-agent.md › Talking to the person): the message log's app room,
 * newest at the foot, held there while you read (DashConversation), over the page's composer. What the person says
 * is a bubble; what jbot says is a bubble too, a hairline one (Turn bubble), times always shown; a report (a message with a title) is a card opening in a reader.
 * Each row is a stop of the page's cursor ([data-dash-row], dashboard/primitives/split-cursor.ts): ↑/↓ between
 * messages, Enter opens a report or a folded room.
 */
export interface LogMessage {
  id: string; at: string; channel: string; room: string; direction: "in" | "out"; sender: "person" | "jbot";
  title?: string; body: string; notify: "none" | "push" | "urgent"; delivery?: { state: string; error?: string };
  pushed?: { to: string[]; missed: string[] };
  native?: { from?: Party | null; to?: Array<Party | string>; date?: string };
}
type Party = { name?: string; address?: string };
/** Where a message was pushed besides the app: the devices it reached, by name. */
const sentTo = (message: LogMessage) => message.notify === "none" ? undefined
  : message.pushed?.to.length ? `Sent to ${message.pushed.to.join(", ")}` : message.pushed ? "No device took the push" : "Sent to your devices";
const partyName = (party?: Party | string | null) => typeof party === "string" ? party : party?.name || party?.address || "";
/** A row of the stream: one message of the app room, or a run of another room's messages, folded (RoomRow). */
type StreamRow = { kind: "message"; message: LogMessage } | { kind: "room"; room: string; channel: string; messages: LogMessage[] };
const CHANNEL = { email: { word: "email", icon: () => <Icons.Mail aria-hidden="true" /> } } as Record<string, { word: string; icon: () => any }>;

// One formatter for every message: toLocaleTimeString builds a new one per call, the most of a long room's first draw.
const TIME = new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
const clock = (at: string) => { const date = new Date(at); return Number.isFinite(date.getTime()) ? TIME.format(date) : ""; };
const firstLine = (text: string) => text.split(/\r?\n/).map((line) => line.replace(/^[#>*\s-]+/, "").trim()).find(Boolean) || "";

/** The stream, over the page's composer (the home thread's own); read again whenever the thread moves (`changed`), and
 *  slowly besides, for what arrives without it (another device's message). */

export function useJbotMessages(changed: () => unknown) {
  const [messages, setMessages] = createSignal<LogMessage[]>([]);
  const refresh = () => api<{ messages: LogMessage[] }>("/v0/agent/messages?limit=100").then((result) => setMessages(result.messages)).catch(() => {});
  // Read and drawable together: the first read, with the renderer's chunk, before the page is shown.
  void Promise.all([refresh(), ChatMarkdown.preload()]).finally(() => setAgentPageLaidOut(true));
  onMount(() => {
    const tick = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15_000);
    onCleanup(() => window.clearInterval(tick));
  });
  createEffect(on(changed, () => void refresh(), { defer: true }));
  return { messages, refresh };
}

export function JbotMessages(props: { messages: LogMessage[]; renderer: MarkdownRendererId; name: string; working?: boolean; /** In a chat's scroller (jbot's room): the transcript alone, no page conversation around it. */ bare?: boolean }) {
  const [reading, setReading] = createSignal<LogMessage | null>(null);
  // The app room's messages each a row; between two of them, each other room's messages one folded row, however the
  // rooms interleave.
  // Each refresh reads new message objects; a row that is unchanged keeps its object, so <For> keeps its element and the
  // keyboard cursor on it (Codex review: a poll replaced every row and stranded focus on a removed one).
  let kept = new Map<string, { sig: string; row: StreamRow }>();
  const rows = createMemo(() => {
    const built = props.messages.reduce<StreamRow[]>((list, message) => {
      if (message.channel === "app") { list.push({ kind: "message", message }); return list; }
      const since = list.findLastIndex((row) => row.kind === "message") + 1;
      const room = list.slice(since).find((row) => row.kind === "room" && row.room === message.room);
      if (room?.kind === "room") room.messages.push(message);
      else list.push({ kind: "room", room: message.room, channel: message.channel, messages: [message] });
      return list;
    }, []);
    const next = new Map<string, { sig: string; row: StreamRow }>();
    const stable = built.map((row) => {
      const key = row.kind === "message" ? `m:${row.message.id}` : `r:${row.room}:${row.messages[0]!.id}`;
      const sig = JSON.stringify(row);
      const before = kept.get(key);
      const chosen = before && before.sig === sig ? before.row : row;
      next.set(key, { sig, row: chosen });
      return chosen;
    });
    kept = next;
    return stable;
  });
  // A room's name: its subject, from whichever of its messages carries one.
  const roomName = (room: string) => props.messages.find((message) => message.room === room && message.title)?.title || room;
  // The person's message starts an exchange; jbot's reply to it is the exchange's; what jbot says next, a step on. A
  // folded room arrived on its own: a step from what is around it.
  const flowAt = (index: number): TranscriptFlow | undefined => {
    if (index <= 0) return undefined;
    const row = rows()[index]!, above = rows()[index - 1]!;
    if (row.kind === "room" || above.kind === "room") return "turn";
    return row.message.direction === "in" ? "turn" : above.message.direction === "in" ? "exchange" : "step";
  };
  const one = (message: LogMessage) => message.direction === "in"
    ? <Message time={clock(message.at)} dateTime={message.at}>{message.body}</Message>
    : <><Turn bubble>{markdown(message.body)}<MessageFoot time={clock(message.at)} dateTime={message.at} status={message.delivery?.state === "failed" ? "Not sent" : undefined}>{feedbackButton(message)}</MessageFoot></Turn>{feedbackField(message)}</>;
  // An email in its room: from and to as its headers say; its own words, what it quotes folded.
  const email = (message: LogMessage) => {
    const { own, quoted } = splitQuoted(message.body);
    const from = message.direction === "out" ? props.name : partyName(message.native?.from) || "Someone";
    const to = (message.native?.to || []).map(partyName).filter(Boolean).join(", ");
    return <EmailItem from={from} to={to || undefined} time={clock(message.at)} dateTime={message.at} quoted={quoted || undefined}>{markdown(own || message.body)}</EmailItem>;
  };
  /*
   * Feedback on what jbot said: the foot's Feedback opens a field under the message; what the person writes goes to the
   * context inbox for Reflection (POST /v0/agent/feedback), never as a turn. One open at a time; sent ones keep a check.
   */
  const [feedbackOn, setFeedbackOn] = createSignal<string | null>(null);
  const [feedbackSent, setFeedbackSent] = createSignal<ReadonlySet<string>>(new Set());
  const sendFeedback = async (message: LogMessage, text: string) => {
    await api("/v0/agent/feedback", { method: "POST", body: JSON.stringify({ messageId: message.id, text }) });
    setFeedbackSent((sent) => new Set([...sent, message.id]));
    setFeedbackOn(null);
  };
  const feedbackButton = (message: LogMessage) => {
    const sent = () => feedbackSent().has(message.id);
    return <Button variant="ghost" size="icon-xs" aria-label={sent() ? "Feedback sent; send more" : "Feedback on this message"} title={sent() ? "Feedback sent" : "Feedback"}
      aria-expanded={feedbackOn() === message.id} onClick={() => setFeedbackOn(feedbackOn() === message.id ? null : message.id)}>
      {sent() ? <Icons.Check /> : <Icons.Feedback />}
    </Button>;
  };
  const feedbackField = (message: LogMessage) => <Show when={feedbackOn() === message.id}>
    <MessageFeedback note="For tonight's reflection" onSend={(text) => sendFeedback(message, text)} onCancel={() => setFeedbackOn(null)} />
  </Show>;
  const markdown = (text: string) => <Answer><Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown renderer={props.renderer} streaming={false}>{text}</ChatMarkdown></Suspense></Answer>;
  const transcript = () => <Show when={props.messages.length || props.working} fallback={<p class="ui-empty" data-empty="dash">Nothing said yet. Say something to {props.name}.</p>}>
        <Transcript data-times="shown">
          <For each={rows()}>{(row, index) => row.kind === "room"
            ? <TranscriptRow flow={flowAt(index())} tabIndex={-1} data-dash-row="">
              <RoomRow icon={(CHANNEL[row.channel]?.icon || (() => <Icons.Chat aria-hidden="true" />))()} channel={CHANNEL[row.channel]?.word || row.channel}
                room={roomName(row.room)} count={row.messages.length} last={firstLine(splitQuoted(row.messages.at(-1)!.body).own || row.messages.at(-1)!.body)} time={clock(row.messages.at(-1)!.at)}>
                <For each={row.messages}>{(message) => row.channel === "email" ? email(message) : one(message)}</For>
              </RoomRow>
            </TranscriptRow>
            : (() => { const message = row.message; return <TranscriptRow flow={flowAt(index())} data-message-id={message.id} tabIndex={-1} data-dash-row="">
              <Switch>
                <Match when={message.direction === "in"}>
                  <Message time={clock(message.at)} dateTime={message.at}>{message.body}</Message>
                </Match>
                <Match when={message.title}>
                  <ReportCard title={message.title!} line={firstLine(message.body)} time={clock(message.at)} notified={message.notify !== "none"} onOpen={() => setReading(message)} />
                </Match>
                <Match when={true}>
                  <Turn bubble>{markdown(message.body)}<MessageFoot time={clock(message.at)} dateTime={message.at} notified={sentTo(message)}>{feedbackButton(message)}</MessageFoot></Turn>{feedbackField(message)}
                </Match>
              </Switch>
            </TranscriptRow>; })()}
          </For>
          {/* While a turn runs: the thread is at work; what it says arrives as messages. */}
          <Show when={props.working}><TranscriptRow flow={props.messages.length ? "exchange" : undefined}><Turn><Trail><Step state="running" verb={`${props.name} is working`} /></Trail></Turn></TranscriptRow></Show>
        </Transcript>
      </Show>;
  return <>
    {props.bare ? transcript() : <DashConversation label={`Messages with ${props.name}`}>{transcript()}</DashConversation>}
    <Dialog open={reading() !== null} onOpenChange={(open) => { if (!open) setReading(null); }} title={reading()?.title || ""} size="large" close="Close">
      <Show when={reading()}>{(message) => markdown(message().body)}</Show>
    </Dialog>
  </>;
}
