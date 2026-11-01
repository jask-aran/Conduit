import * as Icons from "./icons";
import { createSignal, Show, type JSX } from "solid-js";
import { Button, Spinner } from "./controls";
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
export function AgentRow(props: { id?: string; title: string; state: AgentState; activity?: string; time?: string; usage?: string; line?: boolean; onOpen?: () => void; onStop?: () => void; motion?: Motion }) {
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
    {/* On one line the stop keeps its room once it has gone, so every row's time stays in one column. */}
    <Show when={props.state === "running" && props.onStop} fallback={props.line && props.onStop ? <span class="ui-agent-stop" aria-hidden="true" /> : undefined}>
      <Button variant="ghost" size="icon-sm" class="ui-agent-stop" aria-label={`Stop ${props.id || props.title}`} title="Stop" onClick={() => props.onStop?.()}><Icons.Stop /></Button>
    </Show>
  </li>;
}

/**
 * Background subagents where they branched off a turn: one quiet line, not live rows -- they belong to no turn once
 * started, so how they are doing rides on the composer's AgentRider, and each answer joins the thread later as a
 * report. ids: one, or several started together ("sa-1, sa-2, sa-3"); title for one; status, how they are doing taken
 * together ("2 of 3 running", "Finished"), so the shut line says it. The line is a disclosure: it
 * drops down what was started (children: an AgentRow line each, which opens that agent's run), Expand under it. Once
 * one has reported, onReport jumps to the report. data-spawn holds the ids, for a report to jump back to.
 */
export function AgentSpawn(props: { ids: string[]; title?: string; status?: string; onReport?: () => void; motion?: Motion; children?: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  return <li class="ui-agent-spawn" data-spawn={props.ids.join(" ")} data-open={open() ? "" : undefined} {...motionOf(props.motion)}>
    <div class="ui-agent-row">
      <button type="button" class="ui-agent-open" disabled={!props.children} aria-expanded={props.children ? open() : undefined}
        aria-label={`Started ${props.ids.join(", ")}${props.title ? `, ${props.title}` : ""}`} onClick={() => setOpen(!open())}>
        <span class="ui-agent-mark"><Icons.Agent /></span>
        <span class="ui-agent-head"><span class="ui-agent-verb">Started</span><code class="ui-agent-id">{props.ids.join(", ")}</code><Show when={props.title}><span class="ui-agent-title">{props.title}</span></Show></span>
        <Show when={props.status}><span class="ui-agent-line ui-agent-status">{props.status}</span></Show>
        <Show when={props.children}><Icons.ChevronDown class="ui-agent-chevron ui-agent-fold" /></Show>
      </button>
      <Show when={props.onReport}><Button variant="ghost" size="sm" class="ui-agent-report" onClick={() => props.onReport?.()}>Report<Icons.ArrowDown /></Button></Show>
    </div>
    <Expand open={open()} class="ui-agent-started"><ul class="ui-agent-rows">{props.children}</ul></Expand>
  </li>;
}

/** A chat's background agents on its composer: their AgentRows, each on one line (AgentRow line). No title: each row
 *  carries its agent's mark. A long list scrolls in place of growing over the transcript. */
export function AgentRider(props: { motion?: Motion; children: JSX.Element }) {
  return <Rider class="ui-agent-rider" label="Background agents" motion={props.motion}>
    <AgentRows label="Background agents">{props.children}</AgentRows>
  </Rider>;
}
