import * as Icons from "./icons";
import { Show, type JSX } from "solid-js";
import { Button, Spinner } from "./controls";
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

/** A chat's background agents on its composer: their AgentRows, each on one line (AgentRow line). No title: each row
 *  carries its agent's mark. A long list scrolls in place of growing over the transcript. */
export function AgentRider(props: { motion?: Motion; children: JSX.Element }) {
  return <Rider class="ui-agent-rider" label="Background agents" motion={props.motion}>
    <AgentRows label="Background agents">{props.children}</AgentRows>
  </Rider>;
}
