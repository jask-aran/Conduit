import { children, For, Show, splitProps, type JSX } from "solid-js";
import { ChevronDownIcon } from "lucide-solid";
import { Button, Spinner } from "./controls";
import { type Motion, motionOf, sinceOf } from "./shared";
import { Failure } from "./transcript";

/**
 * A turn's head: the orb, then Status · time · work, and under it the trail's latest line (text, or the app's inline
 * Markdown). opens: a trail to open. live: the latest line's room is held while the turn runs, so the first step to
 * arrive moves nothing below.
 */
export function TraceHeader(props: { orb?: JSX.Element; status: string; time?: string; work?: string; latest?: JSX.Element; live?: boolean; tone?: "failed"; opens?: boolean; open?: boolean; onToggle?: () => void }) {
  return <button type="button" class="ui-trace" data-tone={props.tone} aria-expanded={props.opens ? Boolean(props.open) : undefined} disabled={!props.opens} onClick={() => props.onToggle?.()}>
    <span class="ui-trace-orb">{props.orb}</span>
    <span class="ui-trace-line"><b>{props.status}</b><Show when={props.time}><span class="ui-trace-time">{"\u00a0· "}{props.time}</span></Show><Show when={props.work}><span>{"\u00a0· "}{props.work}</span></Show></span>
    <Show when={props.opens}><ChevronDownIcon class="ui-disclosure-chevron" /></Show>
    <Show when={props.latest || props.live}><span class="ui-trace-latest">{props.latest || "\u00a0"}</span></Show>
  </button>;
}
/**
 * Trace: a turn's work, folded under its head. The head is a TraceHeader (pass its props); the trail (children, a
 * Trail of Steps) unfolds under it as a Disclosure's body does. With no children there is nothing to open. A turn
 * not yet started is a Trace with status "Starting", a connecting Orb and live. motion and since: its entrance
 * (entering fades it in), and how far into it it already is.
 */
export function Trace(props: Omit<Parameters<typeof TraceHeader>[0], "opens"> & { motion?: Motion; since?: number; children?: JSX.Element }) {
  const [head, local] = splitProps(props, ["orb", "status", "time", "work", "latest", "live", "tone", "open", "onToggle"]);
  const body = children(() => local.children);
  const opens = () => body.toArray().length > 0;
  return <div class="ui-disclosure ui-trace-fold" data-open={head.open && opens() ? "true" : "false"} data-live={head.live ? "" : undefined} {...motionOf(local.motion)} style={sinceOf(local.since)}>
    <TraceHeader {...head} opens={opens()} />
    <div class="ui-disclosure-body" aria-hidden={!head.open}>{body()}</div>
  </div>;
}
/** The opened trail: one light line per step. nested: a group's steps on a rail of their own under its icon;
 * calls: a code-mode script's calls, quieter, inside its step. */
export const Trail = (props: { nested?: "group" | "calls"; children: JSX.Element }) => <ol class="ui-trail" data-nested={props.nested}>{props.children}</ol>;
const NOT_KEPT = "Not kept";
export type StepState = "running" | "failed" | "stopped" | "planned" | "earlier";
/**
 * A step: its kind's icon (a spinner while running), a verb, its subject in muted mono, flags, its duration at the
 * end. summary: a line of text instead of verb and subject (thinking, narration). note: not a step, nothing to open
 * (reasoning the provider kept). discarded: text a stop threw away, struck, flagged Not kept. flags: words beside the
 * time (repeats). With children it opens in place to them -- its output, its prose, a group's or a script's steps.
 */
export function Step(props: { label?: string; icon?: JSX.Element; verb?: string; subject?: string; summary?: JSX.Element; time?: string; state?: StepState; flags?: string[]; note?: boolean; discarded?: boolean; open?: boolean; onToggle?: () => void; motion?: Motion; children?: JSX.Element }) {
  const body = children(() => props.children);
  const opens = () => body.toArray().length > 0 && !props.note;
  const flags = () => [...(props.flags ?? []), ...(props.discarded ? [NOT_KEPT] : []), ...(props.state === "failed" ? ["Failed"] : props.state === "stopped" ? ["Stopped"] : [])];
  const row = () => <>
    <span class="ui-step-icon"><Show when={props.state === "running"} fallback={props.icon}><Spinner /></Show></span>
    <Show when={props.summary} fallback={<><Show when={props.verb}><span class="ui-step-verb">{props.verb}</span></Show><Show when={props.subject}><code class="ui-step-subject">{props.subject}</code></Show></>}><span class="ui-step-summary">{props.summary}</span></Show>
    <span class="ui-step-meta"><For each={flags()}>{(flag) => <span class="ui-step-flag" title={flag === NOT_KEPT ? "Interrupted — the agent has no record of this" : undefined}>{flag}</span>}</For><Show when={props.time}><span class="ui-step-time">{props.time}</span></Show></span>
  </>;
  return <li class="ui-disclosure ui-step-item" data-open={props.open && opens() ? "true" : "false"} data-state={props.state} data-note={props.note ? "" : undefined} data-discarded={props.discarded ? "" : undefined} {...motionOf(props.motion)}>
    <Show when={opens()} fallback={<div class="ui-step">{row()}</div>}>
      <button type="button" class="ui-step" aria-label={props.label} aria-expanded={Boolean(props.open)} onClick={() => props.onToggle?.()}>{row()}<ChevronDownIcon class="ui-disclosure-chevron" /></button>
      <div class="ui-disclosure-body ui-step-body" aria-hidden={!props.open}>{body()}</div>
    </Show>
  </li>;
}
/** What a tool step opens to: its output in mono, scrolling; cut to a preview, `hidden` characters behind Show full output. */
export function StepOutput(props: { text: string; hidden?: number; full?: boolean; onToggleFull?: () => void }) {
  return <>
    <pre class="ui-step-output">{props.text}</pre>
    <Show when={props.hidden}><Button variant="ghost" size="sm" class="ui-step-more" onClick={() => props.onToggleFull?.()}>{props.full ? "Show preview" : `Show full output · ${props.hidden} hidden characters`}</Button></Show>
  </>;
}
/** What a thinking or narration step opens to: its whole text, the Answer's prose a step quieter. */
export const StepProse = (props: { children: JSX.Element }) => <div class="ui-step-prose"><div class="ui-answer">{props.children}</div></div>;
/** A failed request in the trail: what failed, when, on what, and the error. */
export const TraceError = (props: { time?: string; facts?: string[]; message: string }) => <li class="ui-trace-error"><Failure {...props} /></li>;
