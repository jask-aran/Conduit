import * as Icons from "./icons";
import { cn } from "@/lib/utils";
import { createSignal, Match, Show, Switch, type JSX } from "solid-js";
import { Button, Spinner, StopGlyph } from "./controls";
import { Expand } from "./expand";
import { Rider } from "./rider";
import { type Motion, motionOf, moveCursor } from "./shared";

/*
 * Agents: work an agent handed to another, in Conduit's words for every harness. A subagent's transcript is a chat
 * of its own; these are where it is reached from. AgentRows: a list of them, an icon and a status each, no boxes: a
 * turn's under its head, where the folded trail does not hide them, and a chat's background ones in an AgentRider on
 * its composer, one line each.
 */
export type AgentState = "running" | "finished" | "failed" | "stopped";
const ENDED: Record<Exclude<AgentState, "running">, string> = { finished: "Finished", failed: "Failed", stopped: "Stopped" };

/** A routine's mark, or an agent's when the routine has no mark of its own. */
export const RoutineIcon = (props: { routine?: string }) => <Switch fallback={<Icons.Agent aria-hidden="true" />}>
  <Match when={props.routine === "heartbeat"}><Icons.Heartbeat aria-hidden="true" /></Match>
  <Match when={props.routine === "brief" || props.routine === "morning-brief"}><Icons.Brief aria-hidden="true" /></Match>
  <Match when={props.routine === "feed"}><Icons.Feed aria-hidden="true" /></Match>
</Switch>;

/** A state's mark: a spinner while it works, the agent's glyph once it has finished, a warning when it failed. */
const Mark = (props: { state: AgentState }) => <span class="ui-agent-mark">
  <Show when={props.state === "running"} fallback={props.state === "failed" ? <Icons.Warning /> : <Icons.Agent />}><Spinner /></Show>
</span>;

/** A turn's subagents, one AgentRow each. */
export const AgentRows = (props: { label?: string; children: JSX.Element }) =>
  <ul class="ui-agent-rows" aria-label={props.label ?? "Subagents"} onPointerOver={moveCursor}>{props.children}</ul>;

/**
 * A subagent: its mark, its id when it runs in the background (sa-3), its task, and its status: what it is doing
 * now, in mono, or how it ended; its time at the end. Under the task, or beside it on one line (line: the rider's).
 * The row opens its transcript (onOpen); onStop: stops it while it works, for one the turn does not own (a
 * background agent; a turn's own stops with the turn).
 */
export function AgentRow(props: { id?: string; title: string; state: AgentState; activity?: string; time?: string; usage?: string; line?: boolean; onOpen?: () => void; onStop?: () => void; stopRoom?: boolean; motion?: Motion }) {
  const line = () => props.state === "running" ? props.activity || "Starting" : [ENDED[props.state], props.usage].filter(Boolean).join(" · ");
  return <li class="ui-agent-row" data-state={props.state} data-line={props.line ? "" : undefined} {...motionOf(props.motion)}>
    <button type="button" class="ui-agent-open" disabled={!props.onOpen} aria-label={`Open ${props.id ? `${props.id}, ` : ""}${props.title}`} onClick={() => props.onOpen?.()}>
      <Mark state={props.state} />
      <span class="ui-agent-copy">
        <span class="ui-agent-head"><Show when={props.id}><code class="ui-agent-id">{props.id}</code></Show><span class="ui-agent-title">{props.title}</span></span>
        <span class="ui-agent-line">{line()}</span>
      </span>
      <Show when={props.time}><span class="ui-agent-time">{props.time}</span></Show>
      <Show when={props.onOpen}><Icons.ChevronRight class="ui-agent-chevron" /></Show>
    </button>
    {/* On one line the stop keeps its room once it has gone, so every row's time stays in one column; `stopRoom` keeps
        it on a row that has none (a foreground agent beside background ones). */}
    <Show when={props.state === "running" && props.onStop} fallback={props.line && (props.onStop || props.stopRoom) ? <span class="ui-agent-stop" aria-hidden="true" /> : undefined}>
      <Button variant="ghost" size="icon-sm" class="ui-agent-stop" aria-label={`Stop ${props.id || props.title}`} title="Stop" onClick={() => props.onStop?.()}><StopGlyph /></Button>
    </Show>
  </li>;
}

/** One quiet line for agents taken together, a disclosure of what it holds (Expand under it): the verb, the ids, the
 *  task for one, how they did, then a jump (AgentSpawn's Report, AgentReport's Started). */
function AgentLine(props: { kind: "spawn" | "report" | "delegate" | "run"; verb: string; ids: string[]; keys?: string[]; count?: string; title?: string; where?: string; status?: string; icon?: JSX.Element; failed?: boolean; quiet?: boolean; onOpen?: () => void; jump?: { label: string; up?: boolean; onClick: () => void }; motion?: Motion; children?: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  return <li class="ui-agent-spawn" data-kind={props.kind} data-spawn={props.kind === "spawn" ? (props.keys || props.ids).join(" ") : undefined}
    data-open={open() ? "" : undefined} data-quiet={props.quiet ? "" : undefined} {...motionOf(props.motion)}>
    <div class="ui-agent-row" data-state={props.failed ? "failed" : undefined}>
      <button type="button" class="ui-agent-open" disabled={!props.children && !props.onOpen} aria-expanded={props.children ? open() : undefined}
        aria-label={`${props.verb} ${props.count || props.ids.join(", ")}${props.title ? `, ${props.title}` : ""}`} onClick={() => props.children ? setOpen(!open()) : props.onOpen?.()}>
        <span class="ui-agent-mark">{props.icon || <Icons.Agent />}</span>
        <span class="ui-agent-head"><span class="ui-agent-verb">{props.verb}</span><Show when={props.ids.length}><code class="ui-agent-id">{props.ids.join(", ")}</code></Show><Show when={props.count}><span class="ui-agent-title">{props.count}</span></Show><Show when={props.title}><span class="ui-agent-title">{props.title}</span></Show>
          <Show when={props.where}><span class="ui-agent-where">{props.where}</span></Show></span>
        <Show when={props.status}><span class={props.kind === "run" ? "ui-agent-run-status ui-agent-status" : "ui-agent-line ui-agent-status"}>{props.status}</span></Show>
        <Show when={props.children}><Icons.ChevronDown class="ui-agent-chevron ui-agent-fold" /></Show>
      </button>
      <Show when={props.jump}>{(jump) => <Button variant="ghost" size="sm" class="ui-agent-report" onClick={() => jump().onClick()}>{jump().label}<Show when={jump().up} fallback={<Icons.ArrowDown />}><Icons.ArrowUp /></Show></Button>}</Show>
    </div>
    <Expand open={open()} class="ui-agent-started"><ul class="ui-agent-rows">{props.children}</ul></Expand>
  </li>;
}

/**
 * Background subagents where they branched off a turn: one quiet line, not live rows -- they belong to no turn once
 * started, so how they are doing rides on the composer's AgentRider, and each answer joins the thread later as a
 * report. ids: one, or several started together ("sa-1, sa-2, sa-3"); title for one; status, how they are doing taken
 * together ("2 of 3 running", "Finished"), so the shut line says it. The line drops down what was started (children:
 * an AgentRow line each, which opens that agent's run). Once one has reported, onReport jumps to the report.
 * data-spawn holds the agents' keys (`keys`, their conversations; else the ids), for a report to jump back to.
 */
export function AgentSpawn(props: { ids: string[]; keys?: string[]; title?: string; status?: string; onReport?: () => void; motion?: Motion; children?: JSX.Element }) {
  return <AgentLine kind="spawn" verb="Started" ids={props.ids} keys={props.keys} title={props.title} where="in the background" status={props.status} motion={props.motion}
    jump={props.onReport ? { label: "Report", onClick: props.onReport } : undefined}>{props.children}</AgentLine>;
}

/**
 * The join, the other end of AgentSpawn: background agents' answers where they reached the thread, one line for those
 * that landed together ("Reported sa-4, sa-5, sa-6"), the same line as where they started. It drops down each
 * (children: an AgentReportItem each, its line and what it said); onBack jumps to where they started.
 */
export function AgentReport(props: { ids: string[]; title?: string; status?: string; onBack?: () => void; motion?: Motion; children?: JSX.Element }) {
  return <AgentLine kind="report" verb="Reported" ids={props.ids} title={props.title} status={props.status} motion={props.motion}
    jump={props.onBack ? { label: "Started", up: true, onClick: props.onBack } : undefined}>{props.children}</AgentLine>;
}

/** Foreground agents a turn handed work to and waits for, the same line as Started: "Delegated 3 agents in this turn",
 *  how they are doing, dropping down an AgentRow line each (what each was given). The turn's own: no ids, no report. */
export function AgentDelegate(props: { count: number; status?: string; motion?: Motion; children?: JSX.Element }) {
  return <AgentLine kind="delegate" verb="Delegated" ids={[]} count={`${props.count} ${props.count === 1 ? "agent" : "agents"}`}
    where="in this turn" status={props.status} motion={props.motion}>{props.children}</AgentLine>;
}

/** A run enters from outside the thread, with its report or its quiet summary. */
export function RunLine(props: { icon: JSX.Element; label: string; number: number; id?: string; trigger?: string; time?: string; woke: boolean; outcome?: string; status?: string; summary?: string; onOpen?: () => void; children?: JSX.Element }) {
  return <AgentLine kind="run" icon={props.icon} verb={`${props.label} #${props.number}`} ids={props.id ? [props.id] : []} where={[props.trigger, props.time].filter(Boolean).join(" · ")}
    title={!props.woke ? props.summary : undefined} status={[props.status, props.woke ? props.outcome || "Woke the agent" : "Not woken"].filter(Boolean).join(" · ")}
    failed={props.status?.toLowerCase() === "failed"} quiet={!props.woke} onOpen={!props.woke ? props.onOpen : undefined}>
    {props.woke && (props.children || props.onOpen) ? <li class="ui-agent-said ui-agent-run-body">{props.children}
      <Show when={props.onOpen}><Button variant="ghost" size="sm" onClick={() => props.onOpen?.()}>Open run</Button></Show></li> : undefined}
  </AgentLine>;
}

/** One agent's report in an AgentReport: its line (an AgentRow, which opens its run), then what it said under its task. */
export function AgentReportItem(props: { id: string; title: string; state: AgentState; time?: string; usage?: string; onOpen?: () => void; children: JSX.Element }) {
  return <><AgentRow line id={props.id} title={props.title} state={props.state} time={props.time} usage={props.usage} onOpen={props.onOpen} />
    <li class="ui-agent-said">{props.children}</li></>;
}

/** A chat's background agents on its composer: their AgentRows, each on one line (AgentRow line). No title: each row
 *  carries its agent's mark. A long list scrolls in place of growing over the transcript. */
export function AgentRider(props: { motion?: Motion; children: JSX.Element }) {
  return <Rider class="ui-agent-rider" label="Agents" motion={props.motion}>
    <div class="ui-agent-groups">{props.children}</div>
  </Rider>;
}

/** One list in an AgentRider, under its label: Foreground (the agents a turn waits for) or Background. */
export function AgentRiderGroup(props: { label: string; going?: boolean; children: JSX.Element }) {
  return <section class={cn("ui-agent-group", props.going && "ui-agent-group-going")} aria-label={props.label}>
    <h4>{props.label}</h4>
    <AgentRows label={props.label}>{props.children}</AgentRows>
  </section>;
}
