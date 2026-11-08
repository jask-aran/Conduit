import { Card } from "./card";
import * as Icons from "./icons";
import { Dot } from "./nav";
import { createSignal, For, Show, type JSX } from "solid-js";
import { Expand } from "./expand";
import { Row } from "./row";
import { FoldLine } from "./agents";

/* Assistant: the pieces of an agent that keeps going on its own (docs/plans/persistent-agent.md). Rows are the
 * dashboard's, so they sit in a page's groups and take its cursor; the heartbeat's quiet line in its thread is a
 * HarnessPrompt with Icons.Heartbeat. */

export type ReportLevel = "urgent" | "attention" | "fyi" | "failed" | "none";
const LEVEL_WORD: Record<ReportLevel, string> = { urgent: "Urgent", attention: "Attention", fyi: "FYI", failed: "Failed", none: "Nothing to say" };
export const levelWord = (level: string) => LEVEL_WORD[level as ReportLevel] ?? level;

/** How a report reads at a glance: a dot by level (nothing to say hollow); handled, a quiet check. */
export const LevelMark = (props: { level: string; handled?: boolean }) =>
  <span class="ui-level ui-size-icon-sm" data-level={props.level} data-handled={props.handled ? "" : undefined} role="img" aria-label={props.handled ? "Handled" : levelWord(props.level)}>
    <Show when={props.handled} fallback={<Dot />}><Icons.Check /></Show>
  </span>;


/** A report jbot sent (docs/plans/persistent-agent.md › The message log): one card in its stream opening the whole
 *  report in a reader (onOpen); still one message, so it takes its place as an answer does. */
export function ReportCard(props: { title: string; line?: string; time?: string; notified?: boolean; onOpen: () => void }) {
  return <Card element="button" surface="outline" embedded size="row" class="ui-report-card" onClick={() => props.onOpen()}>
    <Row density="trail" lead={<Icons.FileText aria-hidden="true" />} label={<b class="ui-report-title">{props.title}</b>} detail={props.line}
      meta={<span class="ui-report-end"><Show when={props.notified}><Icons.Notification aria-label="Sent to your phone" /></Show><Show when={props.time}><time>{props.time}</time></Show></span>} fold="quarter" />
  </Card>;
}

/** Messages in another room of jbot's (an email thread), folded into one quiet line in the app's stream, opening in
 *  place to the exchange (children). It never notifies, having reached the person there already. */
export function RoomRow(props: { icon: JSX.Element; channel: string; room: string; count: number; last?: string; time?: string; children?: JSX.Element }) {
  return <FoldLine folds class="ui-room" rowClass="ui-room-row" lead={props.icon}
    label={<span class="ui-room-head"><span class="ui-room-where">Over {props.channel}</span><b class="ui-room-name">{props.room}</b>
      <span class="ui-room-count">{props.count} {props.count === 1 ? "message" : "messages"}</span>
      <Show when={props.last}><span class="ui-room-last">{props.last}</span></Show></span>}
    meta={props.time ? <time>{props.time}</time> : undefined} body={(exchange) => <div class="ui-room-body">{exchange}</div>}>{props.children}</FoldLine>;
}

/** jbot's picture: the Conduit app icon until jbot has a look of its own; sized by its place, like an icon. */
export const AgentAvatar = (props: { class?: string; label?: string }) =>
  <img class={`ui-agent-avatar${props.class ? ` ${props.class}` : ""}`} src="/pwa-192x192.png" alt={props.label || ""} aria-hidden={props.label ? undefined : "true"} draggable={false} />;

/** One email of a room, as a mail client shows it: its quoted thread folded behind "···". */
export function EmailItem(props: { from: string; to?: string; time?: string; dateTime?: string; quoted?: string; children: JSX.Element }) {
  const [shown, setShown] = createSignal(false);
  return <article class="ui-email">
    <header class="ui-email-head"><b class="ui-email-from">{props.from}</b><Show when={props.to}><span class="ui-email-to ui-truncate">to {props.to}</span></Show>
      <Show when={props.time}><time dateTime={props.dateTime}>{props.time}</time></Show></header>
    <div class="ui-email-body">{props.children}</div>
    <Show when={props.quoted}>
      <button type="button" class="ui-email-more" aria-expanded={shown()} aria-label={shown() ? "Hide quoted text" : "Show quoted text"} onClick={() => setShown(!shown())}>···</button>
      <Expand open={shown()}><pre class="ui-email-quoted">{props.quoted}</pre></Expand>
    </Show>
  </article>;
}

export type ClockKind = "heartbeat" | "brief" | "feed" | "checkback" | "schedule";
const CLOCK_ICON: Record<ClockKind, () => JSX.Element> = {
  heartbeat: () => <Icons.Heartbeat />, brief: () => <Icons.Brief />, feed: () => <Icons.Feed />, checkback: () => <Icons.Clock />, schedule: () => <Icons.Runtime />,
};

/** Something that runs on a clock: its kind's icon, name, cadence and last status, then when it runs next.
 *  warn: it failed, the icon a warning. */
export function ClockRow(props: { kind: ClockKind; title: string; cadence: string; status?: string; next?: string; warn?: string; off?: boolean; actions?: JSX.Element }) {
  return <Row density="list" data-clock="" data-off={props.off ? "" : undefined} title={props.warn}
    lead={props.warn ? <Icons.Warning class="ui-clock-warn" /> : CLOCK_ICON[props.kind]()} label={props.title}
    context={<><code>{props.cadence}</code><Show when={props.status}>{` · ${props.status}`}</Show></>}
    meta={props.next || props.actions ? <span class="ui-clock-end"><Show when={props.next}><span>{props.next}</span></Show>{props.actions}</span> : undefined} />;
}

/** A moment on the day, in minutes after midnight (0 to 1440). */
export interface DayMark { at: number; label: string; kind?: ClockKind }
const pct = (minutes: number) => `${(Math.min(1440, Math.max(0, minutes)) / 14.4).toFixed(3)}%`;
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;

/** An agent's day on one line, midnight to midnight: quiet hours a tinted band, the heartbeat's ticks (`ticks`, as its
 *  timing rules place them; else every `pulse` minutes outside quiet hours), labelled marks (a brief), and now. */
export function DayStrip(props: { now: number; quiet?: { start: number; end: number } | null; pulse?: number | null; ticks?: number[]; marks?: DayMark[]; label?: string }) {
  const bands = (): [number, number][] => {
    const quiet = props.quiet;
    if (!quiet || quiet.start === quiet.end) return [];
    return quiet.start < quiet.end ? [[quiet.start, quiet.end]] : [[quiet.start, 1440], [0, quiet.end]];
  };
  const quietAt = (minutes: number) => bands().some(([from, to]) => minutes >= from && minutes < to);
  const ticks = () => {
    if (props.ticks) return props.ticks;
    const every = props.pulse;
    if (!every || every < 5) return [];
    const out: number[] = [];
    for (let at = 0; at < 1440; at += every) if (!quietAt(at)) out.push(at);
    return out;
  };
  const summary = () => [props.label ?? "Today", props.quiet ? `quiet ${hhmm(props.quiet.start)} to ${hhmm(props.quiet.end)}` : null,
    ...(props.marks || []).map((mark) => `${mark.label} ${hhmm(mark.at)}`), `now ${hhmm(props.now)}`].filter(Boolean).join(", ");
  return <div class="ui-day" role="img" aria-label={summary()}>
    <div class="ui-day-marks" aria-hidden="true">
      <For each={props.marks}>{(mark) => <span class="ui-day-label" data-kind={mark.kind} style={{ left: pct(mark.at) }}>{mark.label}</span>}</For>
    </div>
    <div class="ui-day-track" aria-hidden="true">
      <For each={bands()}>{([from, to]) => <span class="ui-day-quiet" style={{ left: pct(from), width: pct(to - from) }} />}</For>
      <For each={ticks()}>{(at) => <span class="ui-day-tick" data-past={at <= props.now ? "" : undefined} style={{ left: pct(at) }} />}</For>
      <For each={props.marks}>{(mark) => <span class="ui-day-mark" data-past={mark.at <= props.now ? "" : undefined} style={{ left: pct(mark.at) }} />}</For>
      <span class="ui-day-now" style={{ left: pct(props.now) }} />
    </div>
    <div class="ui-day-hours" aria-hidden="true">
      <For each={[0, 6, 12, 18, 24]}>{(hour) => <span style={{ left: pct(hour * 60) }}>{String(hour).padStart(2, "0")}</span>}</For>
      <Show when={props.quiet}>{(quiet) => <span class="ui-day-quiet-label" style={{ left: pct(quiet().start < quiet().end ? (quiet().start + quiet().end) / 2 : quiet().end / 2) }}><Icons.Quiet /></span>}</Show>
    </div>
  </div>;
}
