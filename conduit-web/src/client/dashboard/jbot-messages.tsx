import { createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Suspense, Switch, untrack } from "solid-js";
import { splitQuoted } from "../../email-quote.js";
import { clockTime, AgentRows, Answer, Button, DashConversation, EmailItem, Icons, Message, MessageFeedback, MessageFoot, ReportCard, RoomRow, RoutineIcon, RunLine, TranscriptList, TranscriptRow, Turn, type TranscriptFlow } from "@/components/ui";
import { openAgentChat } from "../chat/agents";
import { elapsed } from "../chat/tool-card";
import { Dialog } from "@/components/ui/dialog";
import { api } from "../api/client";
import { setAgentPageLaidOut } from "../state/arrival";
import { ChatMarkdown } from "../chat/lazy-markdown";
import { TurnTrace, TraceStarting, type ContextText } from "../chat/turn-trace";
import { buildTurnRows, type TurnTraceData } from "../turn-rows";
import { applyTranscriptOps, type TranscriptOp } from "../../transcript-fold.js";
import type { Message as ChatMessage, ToolItem } from "../api/contracts";
import { agentView } from "../state/agent";
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
  /** Its entry in its thread: a reply with one has the work of the turn it ended, the person's message that steered a
   *  running turn has that turn's work up to it (GET /v0/agent/work). */
  entryId?: number; conversationId?: number | string;
  native?: { from?: Party | null; to?: Array<Party | string>; date?: string };
}
type Party = { name?: string; address?: string };
/** Where a message was pushed besides the app: the devices it reached, by name. */
const sentTo = (message: LogMessage) => message.notify === "none" ? undefined
  : message.pushed?.to.length ? `Sent to ${message.pushed.to.join(", ")}` : message.pushed ? "No device took the push" : "Sent to your devices";
const partyName = (party?: Party | string | null) => typeof party === "string" ? party : party?.name || party?.address || "";
/** A row of the stream: one message of the app room, the work a reply of it ended (its turn, Folded's trace), or a run of
 *  another room's messages, folded (RoomRow). */
type StreamRow = { kind: "message"; message: LogMessage } | { kind: "work"; message: LogMessage } | { kind: "room"; room: string; channel: string; messages: LogMessage[] }
  | { kind: "run"; run: LogRun };
/** A run jbot's home thread had (GET /v0/agent/messages `runs`): the log says it happened, as the thread's run line,
 *  and opens its transcript; what it reported is the reply after it. */
export interface LogRun { id: string; at: string; title: string; label: string; number: number | null; routine: string | null; trigger: string | null;
  startedAt: string | null; endedAt: string | null; status: string | null; summary: string | null; woke: boolean; conversationId?: number | null }
const runTime = (run: LogRun) => {
  const start = run.startedAt ? Date.parse(run.startedAt) : NaN, end = run.endedAt ? Date.parse(run.endedAt) : NaN;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? elapsed(end - start) : undefined;
};
/** Open a run's transcript (its chat, made the first time). */
const openRun = (run: LogRun) => void api<{ chatId: string }>(`/v0/agent/runs/${encodeURIComponent(run.id)}/open`, { method: "POST" })
  .then(({ chatId }) => openAgentChat(chatId)).catch(() => {});
const CHANNEL = { email: { word: "email", icon: () => <Icons.Mail aria-hidden="true" /> } } as Record<string, { word: string; icon: () => any }>;

const clock = (at: string) => clockTime(at) ?? "";
const firstLine = (text: string) => text.split(/\r?\n/).map((line) => line.replace(/^[#>*\s-]+/, "").trim()).find(Boolean) || "";

/** The stream, over the page's composer (the home thread's own); read again whenever the thread moves (`changed`), and
 *  slowly besides, for what arrives without it (another device's message). */

// The last read, kept for the next time the jbot chat is drawn: it opens on what it last showed at once (a phone's
// drawer warms it, prefetchJbotMessages), then reads afresh.
let lastRead: LogMessage[] | null = null;
let reading: Promise<LogMessage[]> | null = null;

/*
 * A message's work: the turn a reply ended, or the running turn the person's message steered, up to it. Read as its
 * thread's ops (GET /v0/agent/work) and projected as a thread's transcript projects them (buildTurnRows), Folded: the
 * one trace above the message. Read with the log, so a message is drawn with its work at once; lean (no tools' input
 * or output) until the trace is opened, then whole.
 */
const works = new Map<string, TurnTraceData | null>();
const [worksRead, setWorksRead] = createSignal(0);
function traceOf(ops: TranscriptOp[]): TurnTraceData | null {
  const { messages, tools } = applyTranscriptOps({}, ops) as { messages: ChatMessage[]; tools: ToolItem[] };
  const rows = buildTurnRows(messages, tools, { narration: "fold" });
  const answer = rows.findLastIndex((row) => row.type === "message" && row.value.role === "assistant");
  const trace = rows.slice(0, answer < 0 ? rows.length : answer).findLast((row) => row.type === "trace");
  // A turn whose only work was its context changing did nothing to show here.
  return trace?.type === "trace" && trace.value.segments.some((segment) => segment.kind !== "context") ? trace.value : null;
}
async function readWork(messages: LogMessage[], full = false) {
  const ids = messages.filter((message) => message.entryId != null && (full || !works.has(message.id))).map((message) => message.id);
  if (!ids.length) return;
  const { work } = await api<{ work: Record<string, TranscriptOp[]> }>(`/v0/agent/work?ids=${encodeURIComponent(ids.join(","))}${full ? "&full=1" : ""}`);
  for (const id of ids) works.set(id, work[id] ? traceOf(work[id]!) : null);
  setWorksRead((read) => read + 1);
}
const workOf = (message: LogMessage) => { worksRead(); return works.get(message.id) ?? null; };

// The runs among the messages read, with them.
const [logRuns, setLogRuns] = createSignal<LogRun[]>([]);
const readMessages = () => reading ??= api<{ messages: LogMessage[]; runs?: LogRun[] }>("/v0/agent/messages?limit=100")
  .then(async (result) => { await readWork(result.messages).catch(() => {}); setLogRuns(result.runs ?? []); return (lastRead = result.messages); }).finally(() => { reading = null; });
/** Read jbot's messages ahead (and its renderer), so its chat draws at once when it opens. */
export const prefetchJbotMessages = () => { void readMessages().catch(() => {}); void ChatMarkdown.preload(); };

export function useJbotMessages(changed: () => unknown) {
  const [messages, setMessages] = createSignal<LogMessage[]>(lastRead ?? []);
  const [loaded, setLoaded] = createSignal(lastRead !== null);
  const refresh = () => readMessages().then((read) => { setMessages(read); setLoaded(true); }).catch(() => { setLoaded(true); });
  // Read and drawable together: the first read, with the renderer's chunk, before the page is shown.
  void Promise.all([refresh(), ChatMarkdown.preload()]).finally(() => setAgentPageLaidOut(true));
  onMount(() => {
    const tick = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 15_000);
    onCleanup(() => window.clearInterval(tick));
  });
  createEffect(on(changed, () => void refresh(), { defer: true }));
  return { messages, loaded, refresh };
}

export function JbotMessages(props: { messages: LogMessage[]; renderer: MarkdownRendererId; name: string; working?: boolean;
  /** The home thread's turn while it runs (its Folded trace): what jbot is doing now. */
  live?: TurnTraceData | null;
  /** What the person just sent in the home thread, drawn at once until the log has it (it reads it a moment later). */
  sent?: { text: string; at: string } | null;
  /** In a chat's scroller (jbot's room): the transcript alone, no page conversation around it. */ bare?: boolean }) {
  const [reading, setReading] = createSignal<LogMessage | null>(null);
  // The app room's messages each a row; between two of them, each other room's messages one folded row, however the
  // rooms interleave.
  // Each refresh reads new message objects; a row that is unchanged keeps its object, so <For> keeps its element and the
  // keyboard cursor on it (Codex review: a poll replaced every row and stranded focus on a removed one).
  let kept = new Map<string, { sig: string; row: StreamRow }>();
  const rows = createMemo(() => {
    // Each run a row of its own, where it happened.
    const runs = [...logRuns()].sort((a, b) => a.at.localeCompare(b.at));
    let next = 0;
    const runsBefore = (list: StreamRow[], at: string | null) => {
      while (next < runs.length && (at === null || runs[next]!.at <= at)) list.push({ kind: "run", run: runs[next++]! });
    };
    const built = props.messages.reduce<StreamRow[]>((list, message) => {
      runsBefore(list, message.at);
      if (message.channel === "app") {
        if (workOf(message)) list.push({ kind: "work", message });
        list.push({ kind: "message", message });
        return list;
      }
      const since = list.findLastIndex((row) => row.kind === "message") + 1;
      const room = list.slice(since).find((row) => row.kind === "room" && row.room === message.room);
      if (room?.kind === "room") room.messages.push(message);
      else list.push({ kind: "room", room: message.room, channel: message.channel, messages: [message] });
      return list;
    }, []);
    runsBefore(built, null);
    const nextKept = new Map<string, { sig: string; row: StreamRow }>();
    const stable = built.map((row) => {
      const key = row.kind === "room" ? `r:${row.room}:${row.messages[0]!.id}` : row.kind === "run" ? `u:${row.run.id}` : `${row.kind === "work" ? "w" : "m"}:${row.message.id}`;
      const sig = JSON.stringify(row);
      const before = kept.get(key);
      const chosen = before && before.sig === sig ? before.row : row;
      nextKept.set(key, { sig, row: chosen });
      return chosen;
    });
    kept = nextKept;
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
    if (row.kind === "run" || above.kind === "run") return "step";
    if (row.kind === "message" && row.message.direction === "in") return "turn";
    if (above.kind === "work") return "answer";
    return above.kind === "message" && above.message.direction === "in" ? "exchange" : "step";
  };
  // The turn's trace as it runs, then held until the log's next read has its reply: the reply takes its place, so the
  // trace never goes before what it ended is there.
  // A turn can end with no reply after it (its word sent with the message tool, or nothing to say): the trace then
  // goes a moment after the turn ends, rather than waiting on a reply that is not coming.
  // Only a turn still running is live: the chat's last trace before the new turn has begun (the last turn's, "Done")
  // and the turn once it has ended are not. Its last live trace is held, as it last read, until the reply is in the
  // log -- read in the same pass that draws the reply, so the two never show together -- or a moment after it ended
  // with none.
  const fresh = () => props.live?.active ? props.live : null;
  const [held, setHeld] = createSignal<{ trace: TurnTraceData; last?: string } | null>(null);
  const [gone, setGone] = createSignal(false);
  let letGo: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(letGo));
  createEffect(() => {
    const trace = fresh();
    clearTimeout(letGo);
    if (trace) { setGone(false); setHeld({ trace, last: untrack(() => props.messages.at(-1)?.id) }); }
    else if (untrack(held)) letGo = setTimeout(() => setGone(true), 4000);
  });
  const live = () => {
    const now = fresh();
    if (now) return now;
    const kept = held();
    return kept && !gone() && props.messages.at(-1)?.id === kept.last ? kept.trace : null;
  };
  // The live row through a blink: the chat's state can drop out of running for a frame as the hub takes the turn up,
  // which took the row out and put it back, the log sliding under it. While the person's message is still the last
  // word (no reply yet), it stays a moment longer than its reason does.
  const wanted = () => Boolean(live() || props.working || unsent());
  const [lingering, setLingering] = createSignal(false);
  createEffect(on(wanted, (now, before) => {
    if (!before || now) return setLingering(false);
    setLingering(true);
    const timer = setTimeout(() => setLingering(false), 400);
    onCleanup(() => clearTimeout(timer));
  }));
  const showLive = () => wanted() || (lingering() && (Boolean(unsent()) || props.messages.at(-1)?.direction === "in"));
  // The person's message, until the log has it: the same words, in from them, since a minute before it was sent.
  const unsent = createMemo(() => {
    const sent = props.sent;
    if (!sent?.text.trim()) return null;
    const since = Date.parse(sent.at) - 60_000;
    return props.messages.some((message) => message.direction === "in" && message.body.trim() === sent.text.trim() && Date.parse(message.at) >= since) ? null : sent;
  });
  const loadContext = (entryId: number) => api<ContextText>(`/v0/sessions/${encodeURIComponent(agentView()?.home?.chatId ?? "")}/context/${entryId}`);
  // The trace's data read as a prop, so new data (the whole work, once opened) keeps the trace drawn and open.
  // Every turn header keeps its orb, at rest once settled: the mark of jbot at work, wherever it worked.
  const trace = (data: () => TurnTraceData, message?: LogMessage) => <Turn><TurnTrace trace={data()} actor={props.name} renderer={props.renderer} loadContext={loadContext}
    onOpenChange={(open) => { if (open && message) void readWork([message], true).catch(() => {}); }} /></Turn>;
  const one = (message: LogMessage) => message.direction === "in"
    ? <Message at={message.at}>{message.body}</Message>
    : <><Turn bubble>{markdown(message.body)}<MessageFoot at={message.at} status={message.delivery?.state === "failed" ? "Not sent" : undefined}>{feedbackButton(message)}</MessageFoot></Turn>{feedbackField(message)}</>;
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
  // Each row is drawn once in full before it may be skipped off screen (styles.css, data-drawn), with the height it was
  // drawn at as its stand-in: skipped before the browser has kept a size of its own, it is still its own height.
  let list: HTMLDivElement | undefined;
  createEffect(on(rows, () => requestAnimationFrame(() => {
    const fresh = [...list?.querySelectorAll<HTMLElement>(":scope > .ui-transcript-row:not([data-drawn])") ?? []];
    const heights = fresh.map((row) => row.offsetHeight);
    fresh.forEach((row, index) => { if (!heights[index]) return; row.style.containIntrinsicSize = `auto ${heights[index]}px`; row.dataset.drawn = ""; });
  })));
  const transcript = () => <Show when={props.messages.length || props.working} fallback={<p class="ui-empty" data-empty="dash">Nothing said yet. Say something to {props.name}.</p>}>
        {/* Its newest rows first, the older ones above in idle time as it holds its foot, as a chat's (TranscriptList). */}
        <TranscriptList data-times="shown" each={rows()} of="jbot" ref={(element) => { list = element; }}
          after={<>
            <Show when={unsent()}>{(sent) => <TranscriptRow flow={props.messages.length ? "turn" : undefined}><Message at={sent().at}>{sent().text}</Message></TranscriptRow>}</Show>
            <Show when={showLive()}><TranscriptRow flow={props.messages.length || unsent() ? "exchange" : undefined}>
              <Show when={live()} fallback={<Turn><TraceStarting label={`${props.name} is starting`} /></Turn>}>{(data) => trace(data)}</Show>
            </TranscriptRow></Show>
          </>}>
          {(row, index) => row.kind === "run"
            ? <TranscriptRow flow={flowAt(index())}><Turn><AgentRows>
                <RunLine line icon={<RoutineIcon routine={row.run.routine ?? undefined} />} label={row.run.label} number={row.run.number ?? 0} trigger={row.run.trigger ?? undefined}
                  time={runTime(row.run)} woke={row.run.woke} outcome={`Woke ${props.name}`} status={!row.run.status || row.run.status === "finished" ? undefined : row.run.status[0]!.toUpperCase() + row.run.status.slice(1)}
                  summary={row.run.summary ?? (row.run.woke ? `Reported to ${props.name}` : undefined)} at={clock(row.run.at)} onOpen={row.run.conversationId != null ? () => openRun(row.run) : undefined} />
              </AgentRows></Turn></TranscriptRow>
            : row.kind === "work"
            ? <Show when={workOf(row.message)}>{(data) => <TranscriptRow flow={flowAt(index())}>{trace(data, row.message)}</TranscriptRow>}</Show>
            : row.kind === "room"
            ? <TranscriptRow flow={flowAt(index())} tabIndex={-1} data-dash-row="">
              <RoomRow icon={(CHANNEL[row.channel]?.icon || (() => <Icons.Chat aria-hidden="true" />))()} channel={CHANNEL[row.channel]?.word || row.channel}
                room={roomName(row.room)} count={row.messages.length} last={firstLine(splitQuoted(row.messages.at(-1)!.body).own || row.messages.at(-1)!.body)} time={clock(row.messages.at(-1)!.at)}>
                <For each={row.messages}>{(message) => row.channel === "email" ? email(message) : one(message)}</For>
              </RoomRow>
            </TranscriptRow>
            : (() => { const message = row.message; return <TranscriptRow flow={flowAt(index())} data-message-id={message.id} tabIndex={-1} data-dash-row="">
              <Switch>
                <Match when={message.direction === "in"}>
                  <Message at={message.at}>{message.body}</Message>
                </Match>
                <Match when={message.title}>
                  <ReportCard title={message.title!} line={firstLine(message.body)} time={clock(message.at)} notified={message.notify !== "none"} onOpen={() => setReading(message)} />
                </Match>
                <Match when={true}>
                  <Turn bubble>{markdown(message.body)}<MessageFoot at={message.at} notified={sentTo(message)}>{feedbackButton(message)}</MessageFoot></Turn>{feedbackField(message)}
                </Match>
              </Switch>
            </TranscriptRow>; })()}
        </TranscriptList>
      </Show>;
  return <>
    {props.bare ? transcript() : <DashConversation label={`Messages with ${props.name}`}>{transcript()}</DashConversation>}
    <Dialog open={reading() !== null} onOpenChange={(open) => { if (!open) setReading(null); }} title={reading()?.title || ""} size="large" close="Close">
      <Show when={reading()}>{(message) => markdown(message().body)}</Show>
    </Dialog>
  </>;
}
