import * as Icons from "./icons";
import { For, Show, type JSX } from "solid-js";
import { Button } from "./controls";
import { DashRow } from "./dashboard";
import { Expand } from "./expand";

/*
 * Assistant: the pieces of an agent that keeps going on its own (docs/plans/persistent-agent.md): what its runs
 * reported (InboxRow, under a LevelMark), what runs it on a clock (ClockRow) and its day (DayStrip: quiet hours,
 * the brief, the heartbeat's ticks, now). Rows are the dashboard's, so they sit in a page's groups and take its
 * cursor; the heartbeat's quiet line in its thread is a HarnessPrompt with Icons.Heartbeat.
 */

export type ReportLevel = "urgent" | "attention" | "fyi" | "failed" | "none";
const LEVEL_WORD: Record<ReportLevel, string> = { urgent: "Urgent", attention: "Attention", fyi: "FYI", failed: "Failed", none: "Nothing to say" };
export const levelWord = (level: string) => LEVEL_WORD[level as ReportLevel] ?? level;

/** How a report reads at a glance: a dot by level (urgent and failed in destructive, attention in warn, FYI in the
 *  text's colour, nothing to say hollow); handled, a quiet check. */
export const LevelMark = (props: { level: string; handled?: boolean }) =>
  <span class="ui-level" data-level={props.level} data-handled={props.handled ? "" : undefined} role="img" aria-label={props.handled ? "Handled" : levelWord(props.level)}>
    <Show when={props.handled} fallback={<i />}><Icons.Check /></Show>
  </span>;

/**
 * What a run reported: its mark, its headline, where it came from (the run or the feed) and when, on one line; it
 * opens in place (open, onToggle) to the whole report, what became of it (outcome, or that it waits) and Open run.
 */
export function InboxRow(props: { level: string; headline: string; source: string; time?: string; handled?: boolean; outcome?: string; body?: string; open?: boolean; onToggle?: () => void; onOpenRun?: () => void }) {
  return <div class="ui-inbox-entry" data-open={props.open ? "" : undefined} data-handled={props.handled ? "" : undefined}>
    <DashRow element="button" type="button" aria-expanded={props.open ? "true" : "false"} onClick={() => props.onToggle?.()}
      lead={<LevelMark level={props.level} handled={props.handled} />} primary={props.headline} context={props.source} trailing={props.time} />
    <Expand open={Boolean(props.open)}>
      <div class="ui-inbox-report">
        <Show when={props.body && props.body !== props.headline}><p class="ui-inbox-body">{props.body}</p></Show>
        <div class="ui-inbox-foot">
          <span class="ui-inbox-outcome">{props.handled ? `Handled${props.outcome ? ` · ${props.outcome}` : ""}` : "Waiting for the heartbeat"}</span>
          <Show when={props.onOpenRun}><Button variant="ghost" size="sm" onClick={() => props.onOpenRun?.()}>Open run <Icons.ChevronRight /></Button></Show>
        </div>
      </div>
    </Expand>
  </div>;
}

export type ClockKind = "heartbeat" | "brief" | "feed" | "checkback" | "schedule";
const CLOCK_ICON: Record<ClockKind, () => JSX.Element> = {
  heartbeat: () => <Icons.Heartbeat />, brief: () => <Icons.Brief />, feed: () => <Icons.Feed />, checkback: () => <Icons.Clock />, schedule: () => <Icons.Runtime />,
};

/**
 * Something that runs on a clock: its kind's icon, its name, when it runs (cadence, in the data face) and how it last
 * went (status; warn: it failed, the icon a warning), then when it runs next; actions at the end (remove).
 */
export function ClockRow(props: { kind: ClockKind; title: string; cadence: string; status?: string; next?: string; warn?: string; off?: boolean; actions?: JSX.Element }) {
  return <DashRow data-clock="" data-off={props.off ? "" : undefined} title={props.warn}
    lead={props.warn ? <Icons.Warning class="ui-clock-warn" /> : CLOCK_ICON[props.kind]()} primary={props.title}
    context={<><code>{props.cadence}</code><Show when={props.status}>{` · ${props.status}`}</Show></>}
    trailing={props.next || props.actions ? <span class="ui-clock-end"><Show when={props.next}><span>{props.next}</span></Show>{props.actions}</span> : undefined} />;
}

/** A moment on the day, in minutes after midnight (0 to 1440). */
export interface DayMark { at: number; label: string; kind?: ClockKind }
const pct = (minutes: number) => `${(Math.min(1440, Math.max(0, minutes)) / 14.4).toFixed(3)}%`;
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(Math.round(minutes % 60)).padStart(2, "0")}`;

/**
 * An agent's day on one line, midnight to midnight: quiet hours a tinted band (wrapping midnight as two), its
 * heartbeat's ticks (every `pulse` minutes, none in quiet hours), its marks (a brief, a daily task) as a tick with
 * its label over it, and now as a line in the text's colour. The hours under it.
 */
export function DayStrip(props: { now: number; quiet?: { start: number; end: number } | null; pulse?: number | null; marks?: DayMark[]; label?: string }) {
  const bands = (): [number, number][] => {
    const quiet = props.quiet;
    if (!quiet || quiet.start === quiet.end) return [];
    return quiet.start < quiet.end ? [[quiet.start, quiet.end]] : [[quiet.start, 1440], [0, quiet.end]];
  };
  const quietAt = (minutes: number) => bands().some(([from, to]) => minutes >= from && minutes < to);
  const ticks = () => {
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
