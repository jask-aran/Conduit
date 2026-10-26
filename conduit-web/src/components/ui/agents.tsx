import * as Icons from "./icons";
import { Show, type JSX } from "solid-js";
import { Button, Spinner } from "./controls";
import { Chips, Rider, RiderTitle } from "./rider";
import { type Motion, motionOf, moveCursor } from "./shared";

/*
 * Agents: work an agent handed to another, in Conduit's words for every harness. A subagent's transcript is a chat
 * of its own; these are where it is reached from. AgentRows: a turn's subagents, under its head, where the folded
 * trail does not hide them. AgentStrip: a chat's background agents, riding on its composer while there are any.
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
 * A subagent: its mark, its id when it runs in the background (sa-3), its task, and under that what it is doing
 * now, in mono, or how it ended; its time at the end. The row opens its transcript (onOpen); onStop: stops it while
 * it works, for one the turn does not own (a background agent; a turn's own stops with the turn).
 */
export function AgentRow(props: { id?: string; title: string; state: AgentState; activity?: string; time?: string; usage?: string; onOpen?: () => void; onStop?: () => void; motion?: Motion }) {
  const line = () => props.state === "running" ? props.activity || "Starting" : [ENDED[props.state], props.usage].filter(Boolean).join(" · ");
  return <li class="ui-agent-row" data-state={props.state} {...motionOf(props.motion)}>
    <button type="button" class="ui-agent-open" disabled={!props.onOpen} aria-label={`Open ${props.id ? `${props.id}, ` : ""}${props.title}`} onClick={() => props.onOpen?.()}>
      <Mark state={props.state} />
      <span class="ui-agent-copy">
        <span class="ui-agent-head"><Show when={props.id}><code class="ui-agent-id">{props.id}</code></Show><span class="ui-agent-title">{props.title}</span></span>
        <span class="ui-agent-line">{line()}</span>
      </span>
      <Show when={props.time}><span class="ui-agent-time">{props.time}</span></Show>
      <Show when={props.onOpen}><Icons.ChevronRight class="ui-agent-chevron" /></Show>
    </button>
    <Show when={props.state === "running" && props.onStop}>
      <Button variant="ghost" size="icon-sm" class="ui-agent-stop" aria-label={`Stop ${props.id || props.title}`} title="Stop" onClick={() => props.onStop?.()}><Icons.Stop /></Button>
    </Show>
  </li>;
}

/** A chat's background agents on its composer: a chip each, scrolling sideways when they outgrow it. title: the
 *  rider's own word (Agents), with a count of those still working. */
export function AgentStrip(props: { title?: string; motion?: Motion; children: JSX.Element }) {
  return <Rider layout="strip" class="ui-agent-strip" label="Background agents" motion={props.motion}>
    <RiderTitle>{props.title ?? "Agents"}</RiderTitle>
    <Chips>{props.children}</Chips>
  </Rider>;
}

/** One background agent in an AgentStrip: its mark, id, task and time. A press opens its transcript; onStop: a stop
 *  beside it while it works. */
export function AgentChip(props: { id: string; title: string; state: AgentState; time?: string; onOpen?: () => void; onStop?: () => void; motion?: Motion }) {
  return <div class="ui-agent-chip" data-state={props.state} {...motionOf(props.motion)}>
    <button type="button" class="ui-agent-chip-body" title={`${props.id}: ${props.title}`} aria-label={`Open ${props.id}, ${props.title}`} onClick={() => props.onOpen?.()}>
      <Mark state={props.state} /><code class="ui-agent-id">{props.id}</code><span class="ui-agent-title">{props.title}</span>
      <Show when={props.time}><span class="ui-agent-time">{props.time}</span></Show>
    </button>
    <Show when={props.state === "running" && props.onStop}>
      <button type="button" class="ui-agent-chip-stop" aria-label={`Stop ${props.id}`} title="Stop" onClick={() => props.onStop?.()}><Icons.Stop /></button>
    </Show>
  </div>;
}
