import { createComputed, createEffect, createMemo, createSignal, For, Match, on, onCleanup, onMount, Show, Suspense, Switch, untrack } from "solid-js";
import { splitQuoted } from "../../email-quote.js";
import { clockTime, AgentRow, AgentRows, Answer, Button, EmailItem, Empty, Icons, Message, MessageFeedback, MessageFoot, ReportCard, RoomRow, RoutineIcon, RunLine, TranscriptList, TranscriptRow, Turn, type TranscriptFlow } from "@/components/ui";
import { openAgentChat, openRun, span, useNow } from "../chat/agents";
import { motionOf } from "@/components/ui/shared";
import { elapsed } from "../chat/tool-card";
import { createLeavingRows } from "../chat/composer-cards";
import { Dialog } from "@/components/ui/dialog";
import { api } from "../api/client";
import { setAgentPageLaidOut } from "../state/arrival";
import { ChatMarkdown } from "../chat/lazy-markdown";
import { capitalised, TurnTrace, TraceStarting, type ContextText } from "../chat/turn-trace";
import { buildTurnRows, type TurnTraceData } from "../turn-rows";
import { applyTranscriptOps, type TranscriptOp } from "../../transcript-fold.js";
import type { Message as ChatMessage, ToolItem } from "../api/contracts";
import { agentView } from "../state/agent";

const TRACE_HOLD_MS = 4000;
/** How long the live row outlasts its reason, through a blink out of running. */
const LIVE_ROW_LINGER_MS = 400;

export interface LogMessage {
  id: string; at: string; channel: string; room: string; direction: "in" | "out"; sender: "person" | "jbot";
  title?: string; body: string; notify: "none" | "push" | "urgent"; delivery?: { state: string; error?: string };
  pushed?: { to: string[]; missed: string[] };
  /** A reply's entry has the work of the turn it ended; a steering message's has that turn's work up to it. */
  entryId?: number; conversationId?: number | string;
  native?: { from?: Party | null; to?: Array<Party | string>; date?: string };
}
type Party = { name?: string; address?: string };
const sentTo = (message: LogMessage) => message.notify === "none" ? undefined
  : message.pushed?.to.length ? `Sent to ${message.pushed.to.join(", ")}` : message.pushed ? "No device took the push" : "Sent to your devices";
const partyName = (party?: Party | string | null) => typeof party === "string" ? party : party?.name || party?.address || "";
type StreamRow = { kind: "message"; message: LogMessage } | { kind: "work"; message: LogMessage } | { kind: "room"; room: string; channel: string; messages: LogMessage[] }
  | { kind: "run"; run: LogRun };
export interface LogRun { id: string; at: string; title: string; label: string; number: number | null; routine: string | null; trigger: string | null;
  startedAt: string | null; endedAt: string | null; status: string | null; summary: string | null; woke: boolean; conversationId?: number | null;
  did?: string | null;
  agent?: boolean; subagentId?: string | null; live?: boolean }
const runTime = (run: LogRun) => {
  const start = run.startedAt ? Date.parse(run.startedAt) : NaN, end = run.endedAt ? Date.parse(run.endedAt) : NaN;
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? elapsed(end - start) : undefined;
};
const CHANNEL = { email: { word: "email", icon: () => <Icons.Mail aria-hidden="true" /> } } as Record<string, { word: string; icon: () => any }>;

const clock = (at: string) => clockTime(at) ?? "";
const firstLine = (text: string) => text.split(/\r?\n/).map((line) => line.replace(/^[#>*\s-]+/, "").trim()).find(Boolean) || "";

// The last read, kept so the jbot chat opens on what it last showed at once, then reads afresh.
let lastRead: LogMessage[] | null = null;
let reading: Promise<LogMessage[]> | null = null;

// Read with the log, so a message is drawn with its work at once; lean (no tools' input or output) until opened.
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

const [logRuns, setLogRuns] = createSignal<LogRun[]>([]);
const readMessages = () => reading ??= api<{ messages: LogMessage[]; runs?: LogRun[] }>("/v0/agent/messages?limit=100")
  .then(async (result) => { await readWork(result.messages).catch(() => {}); setLogRuns(result.runs ?? []); return (lastRead = result.messages); }).finally(() => { reading = null; });
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

export function JbotMessages(props: { messages: LogMessage[]; name: string; working?: boolean;
  live?: TurnTraceData | null;
  /** What the person just sent in the home thread, drawn at once until the log has it (it reads it a moment later). */
  sent?: { text: string; at: string } | null }) {
  const [reading, setReading] = createSignal<LogMessage | null>(null);
  // Each refresh reads new message objects; a row that is unchanged keeps its object, so <For> keeps its element and the
  // keyboard cursor on it.
  let kept = new Map<string, { sig: string; row: StreamRow }>();
  // The open agent units, as the rows need them: what one is doing changes each second and is read where it is drawn.
  const openAgents = createMemo(() => (agentView()?.attention?.working.runs ?? []).filter((unit) => unit.kind === "agent" && unit.startedAt)
    .map((unit) => ({ id: unit.id, title: unit.title, startedAt: unit.startedAt!, conversationId: unit.conversationId, label: unit.label ?? null })),
    [], { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) });
  const rows = createMemo(() => {
    const reported = new Set(logRuns().map((run) => run.id));
    const working = openAgents().filter((unit) => !reported.has(unit.id))
      .map((unit): LogRun => {
        const reply = props.messages.find((message) => message.direction === "out" && message.channel === "app" && message.at >= unit.startedAt);
        return { id: unit.id, at: reply ? `${reply.at}~` : "\uffff", title: unit.title, label: unit.title, number: null, routine: null, trigger: null,
          startedAt: unit.startedAt, endedAt: null, status: "running", summary: null, woke: false, conversationId: unit.conversationId, agent: true, live: true,
          subagentId: unit.label };
      });
    const runs = [...logRuns(), ...working].sort((a, b) => a.at.localeCompare(b.at));
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
  const roomName = (room: string) => props.messages.find((message) => message.room === room && message.title)?.title || room;
  const flowAt = (index: number): TranscriptFlow | undefined => {
    if (index <= 0) return undefined;
    const row = rows()[index]!, above = rows()[index - 1]!;
    if (row.kind === "room" || above.kind === "room") return "turn";
    if (row.kind === "run" || above.kind === "run") return "step";
    if (row.kind === "message" && row.message.direction === "in") return "turn";
    if (above.kind === "work") return "answer";
    return above.kind === "message" && above.message.direction === "in" ? "exchange" : "step";
  };
  // The last live trace is held until the log has its reply (read in the same pass that draws it, so the two never
  // show together), or a moment after a turn that ended with none, since a reply may not be coming.
  const fresh = () => props.live?.active ? props.live : null;
  const [held, setHeld] = createSignal<{ trace: TurnTraceData; last?: string } | null>(null);
  const [gone, setGone] = createSignal(false);
  let letGo: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(letGo));
  createEffect(() => {
    const trace = fresh();
    clearTimeout(letGo);
    if (trace) { setGone(false); setHeld({ trace, last: untrack(() => props.messages.at(-1)?.id) }); }
    else if (untrack(held)) letGo = setTimeout(() => setGone(true), TRACE_HOLD_MS);
  });
  const live = () => {
    const now = fresh();
    if (now) return now;
    const kept = held();
    return kept && !gone() && props.messages.at(-1)?.id === kept.last ? kept.trace : null;
  };
  // The chat's state can drop out of running for a frame as the hub takes the turn up, so the live row outlasts its
  // reason by a moment, or the log would slide under it.
  const wanted = () => Boolean(live() || props.working || unsent());
  const [lingering, setLingering] = createSignal(false);
  createEffect(on(wanted, (now, before) => {
    if (!before || now) return setLingering(false);
    setLingering(true);
    const timer = setTimeout(() => setLingering(false), LIVE_ROW_LINGER_MS);
    onCleanup(() => clearTimeout(timer));
  }));
  const showLive = () => wanted() || (lingering() && (Boolean(unsent()) || props.messages.at(-1)?.direction === "in"));
  // A turn with no work to show ends with its reply where the live row was, so the row fades out first and the reply
  // waits for it.
  const leaving = createLeavingRows<{ trace: TurnTraceData; reply?: string }>(() => true);
  const leavingTrace = () => leaving.list().at(-1);
  let lastLive: TurnTraceData | null = null;
  createComputed(on(live, (now) => {
    if (now) { lastLive = now; return; }
    if (!lastLive) return;
    const reply = untrack(() => props.messages.at(-1));
    const worked = reply && untrack(() => Boolean(workOf(reply)));
    const ghost = { trace: lastLive, reply: reply?.direction === "out" ? reply.id : undefined };
    lastLive = null;
    if (worked) return;
    leaving.leave(ghost);
  }));
  const unsent = createMemo(() => {
    const sent = props.sent;
    if (!sent?.text.trim()) return null;
    const since = Date.parse(sent.at) - 60_000;
    return props.messages.some((message) => message.direction === "in" && message.body.trim() === sent.text.trim() && Date.parse(message.at) >= since) ? null : sent;
  });
  const loadContext = (entryId: number) => api<ContextText>(`/v0/sessions/${encodeURIComponent(agentView()?.home?.chatId ?? "")}/context/${entryId}`);
  // The trace's data read as a prop, so new data (the whole work, once opened) keeps the trace drawn and open.
  const openHome = () => { const chat = agentView()?.home?.chatId; if (chat) openAgentChat(chat); };
  const trace = (data: () => TurnTraceData, _message?: LogMessage) => <Turn><TurnTrace trace={data()} actor={props.name} loadContext={loadContext} onOpen={openHome} /></Turn>;
  const one = (message: LogMessage) => message.direction === "in"
    ? <Message at={message.at}>{message.body}</Message>
    : <><Turn bubble>{markdown(message.body)}<MessageFoot at={message.at} status={message.delivery?.state === "failed" ? "Not sent" : undefined}>{feedbackButton(message)}</MessageFoot></Turn>{feedbackField(message)}</>;
  const email = (message: LogMessage) => {
    const { own, quoted } = splitQuoted(message.body);
    const from = message.direction === "out" ? props.name : partyName(message.native?.from) || "Someone";
    const to = (message.native?.to || []).map(partyName).filter(Boolean).join(", ");
    return <EmailItem from={from} to={to || undefined} time={clock(message.at)} dateTime={message.at} quoted={quoted || undefined}>{markdown(own || message.body)}</EmailItem>;
  };
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
  const markdown = (text: string) => <Answer><Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={false}>{text}</ChatMarkdown></Suspense></Answer>;
  // What jbot says while the chat is open fades in whole, as it arrives (a thread's answer fades in word by word); what
  // was there when it opened, and the person's own words (already drawn as sent), do not.
  const seen = new Set<string>();
  let primed = false;
  createEffect(on(rows, (list) => { for (const row of list) if (row.kind === "message" || row.kind === "run") seen.add(row.kind === "run" ? row.run.id : row.message.id); if (list.length) primed = true; }));
  const arriving = (id: string) => untrack(() => primed && !seen.has(id));
  // Each row is drawn once in full before it may be skipped off screen (data-drawn), with the height it was drawn at as
  // its stand-in: skipped before the browser has kept a size of its own, it is still its own height.
  let list: HTMLDivElement | undefined;
  createEffect(on(rows, () => requestAnimationFrame(() => {
    const fresh = [...list?.querySelectorAll<HTMLElement>(":scope > .ui-transcript-row:not([data-drawn])") ?? []];
    // Fractions kept: a whole-pixel stand-in would move what is under it by a pixel as it is skipped.
    const heights = fresh.map((row) => row.getBoundingClientRect().height);
    fresh.forEach((row, index) => { if (!heights[index]) return; row.style.containIntrinsicSize = `auto ${heights[index]}px`; row.dataset.drawn = ""; });
  })));
  const now = useNow(() => rows().some((row) => row.kind === "run" && row.run.live));
  const agentRow = (run: LogRun) => {
    // Read where it is drawn, so what it is doing changes in place rather than making a new row.
    const activity = () => run.live ? agentView()?.attention?.working.runs.find((unit) => unit.id === run.id)?.activity ?? undefined : undefined;
    const state = () => run.live ? "running" : run.status === "failed" || run.status === "stopped" ? run.status : "finished";
    return <AgentRow line id={run.subagentId ?? undefined} title={run.title} state={state()} activity={activity()} at={run.live ? undefined : clock(run.at) || undefined}
      time={run.live || run.endedAt ? span(run.startedAt ?? undefined, run.live ? null : run.endedAt, now()) : undefined} onOpen={() => openRun(run.id)} />;
  };
  const transcript = () => <Show when={props.messages.length || props.working} fallback={<Empty kind="dash">Nothing said yet. Say something to {props.name}.</Empty>}>
        <TranscriptList data-times="shown" each={rows()} of="jbot" ref={(element) => { list = element; }}
          after={<>
            <Show when={leavingTrace()}>{(gone) => <TranscriptRow flow="exchange" {...motionOf("removing")}>{trace(() => gone().trace)}</TranscriptRow>}</Show>
            <Show when={unsent()}>{(sent) => <TranscriptRow flow={props.messages.length ? "turn" : undefined}><Message at={sent().at}>{sent().text}</Message></TranscriptRow>}</Show>
            <Show when={showLive()}><TranscriptRow flow={props.messages.length || unsent() ? "exchange" : undefined}>
              <Show when={live()} fallback={<Turn><TraceStarting line thinking label={`${props.name} is thinking`} /></Turn>}>{(data) => trace(data)}</Show>
            </TranscriptRow></Show>
          </>}>
          {(row, index) => row.kind === "run" && row.run.agent
            ? <TranscriptRow flow={flowAt(index())} data-agent=""><Turn><AgentRows>{agentRow(row.run)}</AgentRows></Turn></TranscriptRow>
            : row.kind === "run"
            ? <TranscriptRow flow={flowAt(index())} {...motionOf(arriving(row.run.id) ? "entering" : undefined)}><Turn><AgentRows>
                <RunLine line icon={<RoutineIcon routine={row.run.routine ?? undefined} />} label={row.run.label} number={row.run.number} trigger={row.run.trigger ?? undefined}
                  time={runTime(row.run)} woke={row.run.woke} outcome={`Woke ${props.name}`} status={!row.run.status || row.run.status === "finished" ? undefined : row.run.status[0]!.toUpperCase() + row.run.status.slice(1)}
                  summary={row.run.did ? capitalised(row.run.did) : row.run.summary ?? (row.run.woke ? `Reported to ${props.name}` : undefined)} at={clock(row.run.at)} onOpen={row.run.conversationId != null ? () => openRun(row.run.id) : undefined} />
              </AgentRows></Turn></TranscriptRow>
            : row.kind === "work"
            ? <Show when={workOf(row.message)}>{(data) => <TranscriptRow flow={flowAt(index())}>{trace(data, row.message)}</TranscriptRow>}</Show>
            : row.kind === "room"
            ? <TranscriptRow flow={flowAt(index())} tabIndex={-1}>
              <RoomRow icon={(CHANNEL[row.channel]?.icon || (() => <Icons.Chat aria-hidden="true" />))()} channel={CHANNEL[row.channel]?.word || row.channel}
                room={roomName(row.room)} count={row.messages.length} last={firstLine(splitQuoted(row.messages.at(-1)!.body).own || row.messages.at(-1)!.body)} time={clock(row.messages.at(-1)!.at)}>
                <For each={row.messages}>{(message) => row.channel === "email" ? email(message) : one(message)}</For>
              </RoomRow>
            </TranscriptRow>
            : (() => { const message = row.message; return <TranscriptRow flow={flowAt(index())} data-message-id={message.id} tabIndex={-1}
              data-held={leavingTrace()?.reply === message.id ? "" : undefined}
              {...motionOf(message.direction === "out" && arriving(message.id) ? "entering" : undefined)}>
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
    {transcript()}
    <Dialog open={reading() !== null} onOpenChange={(open) => { if (!open) setReading(null); }} title={reading()?.title || ""} size="large" close="Close">
      <Show when={reading()}>{(message) => markdown(message().body)}</Show>
    </Dialog>
  </>;
}
