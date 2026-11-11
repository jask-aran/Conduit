import * as Icons from "./icons";
import { For, Show, splitProps, type JSX } from "solid-js";

import { Button, Spinner } from "./controls";
import { Expand } from "./expand";
import { type Motion, motionOf, sinceOf } from "./shared";
import { Failure, foldBody, registerFoldFind } from "./transcript";

/** live: the latest line's room is held while the turn runs, so the first step to arrive moves nothing below. */
export function TraceHeader(props: { orb?: JSX.Element; status: string; time?: string; work?: string; latest?: JSX.Element; live?: boolean; tone?: "failed"; quiet?: boolean; opens?: boolean; open?: boolean; goes?: boolean; onToggle?: () => void }) {
  return <button type="button" class="ui-trace" data-tone={props.tone} data-quiet={props.quiet ? "" : undefined} data-orb={props.orb ? "" : undefined} data-held-line={props.orb && props.live && !props.latest ? "" : undefined} aria-expanded={props.opens ? Boolean(props.open) : undefined} disabled={!props.opens && !props.goes} onClick={() => props.onToggle?.()}>
    <span class="ui-trace-orb">{props.orb}</span>
    <span class="ui-trace-line ui-truncate"><b>{props.status}</b><Show when={props.time}><span class="ui-trace-time">{"\u00a0· "}{props.time}</span></Show><Show when={props.work}><span>{"\u00a0· "}{props.work}</span></Show></span>
    <Show when={props.opens}><Icons.ChevronDown class="ui-disclosure-chevron ui-fold-chevron ui-size-icon-sm" data-turn="half" /></Show>
    <Show when={props.goes && !props.opens}><Icons.ChevronRight class="ui-disclosure-chevron ui-size-icon-sm" /></Show>
    <Show when={props.latest || props.live}><span class="ui-trace-latest ui-truncate">{props.latest || "\u00a0"}</span></Show>
  </button>;
}
export function Trace(props: Parameters<typeof TraceHeader>[0] & { motion?: Motion; since?: number; pinned?: JSX.Element; find?: () => string; children?: JSX.Element }) {
  const [head, local] = splitProps(props, ["orb", "status", "time", "work", "latest", "live", "tone", "quiet", "open", "goes", "onToggle"]);
  const { body, opens } = foldBody({ get opens() { return local.opens; }, get open() { return head.open; }, get children() { return local.children; } });
  return <div ref={(element) => { if (local.find) registerFoldFind(element, () => local.find!(), () => { if (!head.open) head.onToggle?.(); }); }}
    class="ui-disclosure ui-trace-fold" data-open={head.open && opens() ? "true" : "false"} data-find-fold={local.find && opens() && !head.open ? "" : undefined} data-live={head.live ? "" : undefined} {...motionOf(local.motion)} style={sinceOf(local.since)}>
    <TraceHeader {...head} opens={opens()} />
    {local.pinned}
    <Expand open={Boolean(head.open && opens())} class="ui-disclosure-body">{body()}</Expand>
  </div>;
}
export const Trail = (props: { nested?: "group" | "calls"; children: JSX.Element }) => <ol class="ui-trail" data-nested={props.nested}>{props.children}</ol>;
const NOT_KEPT = "Not kept";
export type StepState = "running" | "failed" | "stopped" | "planned" | "earlier";
export function Step(props: { label?: string; icon?: JSX.Element; verb?: string; subject?: string; face?: "code" | "text"; aside?: string; changes?: { added: number; removed: number }; summary?: JSX.Element; time?: string; state?: StepState; flags?: string[]; note?: boolean; discarded?: boolean; opens?: boolean; open?: boolean; onToggle?: () => void; motion?: Motion; children?: JSX.Element ; find?: () => string}) {
  const fold = foldBody(props), body = fold.body;
  const opens = () => fold.opens() && !props.note;
  const flags = () => [...(props.flags ?? []), ...(props.discarded ? [NOT_KEPT] : []), ...(props.state === "failed" ? ["Failed"] : props.state === "stopped" ? ["Stopped"] : [])];
  const row = () => <>
    <span class="ui-step-icon ui-size-icon-sm"><Show when={props.state === "running"} fallback={props.icon}><Spinner /></Show></span>
    <Show when={props.summary} fallback={<><Show when={props.verb}><span class="ui-step-verb">{props.verb}</span></Show><Show when={props.subject}><span class="ui-step-subject ui-truncate" data-face={props.face ?? "code"}>{props.subject}</span></Show><Show when={props.aside}><span class="ui-step-aside ui-truncate">{props.aside}</span></Show></>}><span class="ui-step-summary ui-truncate">{props.summary}</span></Show>
    <span class="ui-step-meta"><For each={flags()}>{(flag) => <span class="ui-step-flag" title={flag === NOT_KEPT ? "Interrupted — the agent has no record of this" : undefined}>{flag}</span>}</For>
      <Show when={props.changes}>{(changes) => <span class="ui-step-changes"><Show when={changes().added}><span data-change="added">+{changes().added}</span></Show><Show when={changes().removed}><span data-change="removed">{"\u2212"}{changes().removed}</span></Show></span>}</Show>
      <Show when={props.time}><span class="ui-step-time">{props.time}</span></Show></span>
  </>;
  return <li ref={(element) => { if (props.find) registerFoldFind(element, () => props.find!(), () => { if (!props.open) props.onToggle?.(); }); }}
    data-find-fold={props.find && opens() && !props.open ? "" : undefined} class="ui-disclosure ui-step-item" data-open={props.open && opens() ? "true" : "false"} data-state={props.state} data-note={props.note ? "" : undefined} data-discarded={props.discarded ? "" : undefined} {...motionOf(props.motion)}>
    <Show when={opens()} fallback={<div class="ui-step">{row()}</div>}>
      <button type="button" class="ui-step" aria-label={props.label} aria-expanded={Boolean(props.open)} onClick={() => props.onToggle?.()}>{row()}<Icons.ChevronDown class="ui-disclosure-chevron ui-fold-chevron ui-size-icon-sm" data-turn="half" /></button>
      <Expand open={Boolean(props.open)} class="ui-disclosure-body ui-step-body">{body()}</Expand>
    </Show>
  </li>;
}
export function StepDiff(props: { lines: { sign: "+" | "-" | "\u2026"; text: string }[]; hidden?: number }) {
  return <div class="ui-step-diff" role="group" aria-label="Changes">
    <For each={props.lines}>{(line) => <div class="ui-step-diff-line" data-sign={line.sign === "+" ? "added" : line.sign === "-" ? "removed" : "gap"}><span aria-hidden="true">{line.sign === "-" ? "\u2212" : line.sign}</span><span>{line.text || "\u00a0"}</span></div>}</For>
    <Show when={props.hidden}><div class="ui-step-diff-line" data-sign="gap"><span aria-hidden="true">{"\u2026"}</span><span>{props.hidden} more changed lines</span></div></Show>
  </div>;
}
export function StepOutput(props: { text: string; hidden?: number; full?: boolean; onToggleFull?: () => void }) {
  return <>
    <pre class="ui-step-output">{props.text}</pre>
    <Show when={props.hidden}><Button variant="ghost" size="sm" class="ui-step-more" onClick={() => props.onToggleFull?.()}>{props.full ? "Show preview" : `Show full output · ${props.hidden} hidden characters`}</Button></Show>
  </>;
}
/** The caller opens it once its text is in, never to a note that then grows. */
export function StepSections(props: { sections?: { label: string; text: string }[]; tools?: string; error?: string }) {
  return <div class="ui-step-sections">
    <Show when={!props.error} fallback={<p class="ui-step-sections-note">{props.error}</p>}>
      <For each={props.sections}>{(section) => <section><h4>{section.label}</h4><pre class="ui-step-output">{section.text}</pre></section>}</For>
      <Show when={props.tools}><section><h4>Tools</h4><p class="ui-step-sections-tools">{props.tools}</p></section></Show>
    </Show>
  </div>;
}
export const StepProse = (props: { children: JSX.Element }) => <div class="ui-step-prose"><div class="ui-answer">{props.children}</div></div>;
export const TraceError = (props: { time?: string; facts?: string[]; message: string }) => <li class="ui-trace-error"><Failure {...props} /></li>;
