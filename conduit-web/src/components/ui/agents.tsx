import * as Icons from "./icons";
import { children, createSignal, Match, Show, Switch, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Row } from "./row";
import { Button, Spinner, StopGlyph } from "./controls";
import { Expand } from "./expand";
import { Group } from "./group";
import { Rider } from "./rider";
import { type Motion, motionOf, moveCursor } from "./shared";

export type AgentState = "running" | "finished" | "failed" | "stopped";
const ENDED: Record<Exclude<AgentState, "running">, string> = { finished: "Finished", failed: "Failed", stopped: "Stopped" };

export const RoutineIcon = (props: { routine?: string }) => <Switch fallback={<Icons.Agent aria-hidden="true" />}>
  <Match when={props.routine === "heartbeat"}><Icons.Heartbeat aria-hidden="true" /></Match>
  <Match when={props.routine === "brief" || props.routine === "morning-brief"}><Icons.Brief aria-hidden="true" /></Match>
  <Match when={props.routine === "feed"}><Icons.Feed aria-hidden="true" /></Match>
</Switch>;

const Mark = (props: { state: AgentState }) =>
  <Show when={props.state === "running"} fallback={props.state === "failed" ? <Icons.Warning /> : <Icons.Agent />}><Spinner /></Show>;

export function FoldLine(props: { item?: boolean; folds?: boolean; class?: string; rowClass?: string; lineClass?: string; attrs?: Record<string, unknown>; lineAttrs?: Record<string, unknown>; lead: JSX.Element; label: JSX.Element; meta?: JSX.Element; after?: JSX.Element; "aria-label"?: string; onOpen?: () => void; bodyClass?: string; body?: (children: JSX.Element) => JSX.Element; children?: JSX.Element }) {
  const [open, setOpen] = createSignal(false);
  // Resolved once, in this owner: read again in the click handler, they would be built outside it (and throw).
  const body = children(() => props.children);
  const folds = () => props.folds || !!body();
  return <Dynamic component={props.item ? "li" : "div"} data-piece="FoldLine" class={props.class} data-open={open() ? "" : undefined} {...props.attrs}>
    <div class={props.lineClass} {...props.lineAttrs}>
      <Row density="trail" element="button" class={props.rowClass} disabled={!folds() && !props.onOpen} aria-expanded={folds() ? open() : undefined}
        aria-label={props["aria-label"]} onClick={() => folds() ? setOpen(!open()) : props.onOpen?.()}
        lead={props.lead} label={props.label} meta={props.meta} fold={folds() ? "half" : undefined} />
      {props.after}
    </div>
    <Expand open={open()} class={props.bodyClass}>{props.body ? props.body(body()) : body()}</Expand>
  </Dynamic>;
}

export const AgentRows = (props: { label?: string; children: JSX.Element }) =>
  <ul class="ui-agent-rows" aria-label={props.label ?? "Subagents"} onPointerOver={moveCursor}>{props.children}</ul>;

/** `icon` stands in for the mark, for what holds steady rather than works (a connection); `stop` names its stop control (unsaid: Stop). */
export function AgentRow(props: { id?: string; title: string; name?: string; state: AgentState; activity?: string; time?: string; usage?: string;
  at?: string; line?: boolean; icon?: JSX.Element; stop?: string; onOpen?: () => void; onStop?: () => void; stopRoom?: boolean; motion?: Motion }) {
  const line = () => props.state === "running" ? props.activity || "Starting" : [ENDED[props.state], props.usage, props.at ? props.time : undefined].filter(Boolean).join(" · ");
  return <li class="ui-agent-row" data-state={props.state} data-line={props.line ? "" : undefined} {...motionOf(props.motion)}>
    <Row density="trail" element="button" class="ui-agent-open" disabled={!props.onOpen} aria-label={`Open ${props.id ? `${props.id}, ` : ""}${props.name ?? props.title}`} onClick={() => props.onOpen?.()}
      lead={props.icon ?? <Mark state={props.state} />} label={<span class="ui-agent-head"><Show when={props.id}><code class="ui-agent-id">{props.id}</code></Show><span class="ui-agent-title">{props.title}</span></span>}
      detail={props.line ? undefined : line()} context={props.line ? line() : undefined} meta={props.at ?? props.time} fold={props.onOpen && !props.at ? "quarter" : undefined} />
    {/* On one line the stop keeps its room once it has gone, so every row's time stays in one column; `stopRoom` keeps
        it on a row that has none (a foreground agent beside background ones). */}
    <Show when={props.state === "running" && props.onStop} fallback={props.line && (props.onStop || props.stopRoom) ? <span class="ui-agent-stop" aria-hidden="true" /> : undefined}>
      <Button variant="ghost" size="icon-sm" class="ui-agent-stop" aria-label={`${props.stop ?? "Stop"} ${props.id || (props.name ?? props.title)}`} title={props.stop ?? "Stop"} onClick={() => props.onStop?.()}><StopGlyph /></Button>
    </Show>
  </li>;
}

function AgentLine(props: { kind: "spawn" | "report" | "delegate" | "run"; verb: string; ids: string[]; keys?: string[]; count?: string; title?: string; where?: string; status?: string; icon?: JSX.Element; failed?: boolean; quiet?: boolean; onOpen?: () => void; jump?: { label: string; up?: boolean; onClick: () => void }; motion?: Motion; children?: JSX.Element }) {
  return <FoldLine item class="ui-agent-spawn" lineClass="ui-agent-row" rowClass="ui-agent-open" bodyClass="ui-agent-started"
    attrs={{ "data-kind": props.kind, "data-spawn": props.kind === "spawn" ? (props.keys || props.ids).join(" ") : undefined, "data-quiet": props.quiet ? "" : undefined, ...motionOf(props.motion) }}
    lineAttrs={{ "data-state": props.failed ? "failed" : undefined }}
    aria-label={`${props.verb} ${props.count || props.ids.join(", ")}${props.title ? `, ${props.title}` : ""}`} onOpen={props.onOpen}
    lead={props.icon || <Icons.Agent />}
    label={<span class="ui-agent-head"><span class="ui-agent-verb">{props.verb}</span><Show when={props.ids.length}><code class="ui-agent-id">{props.ids.join(", ")}</code></Show><Show when={props.count}><span class="ui-agent-title">{props.count}</span></Show><Show when={props.title}><span class="ui-agent-title">{props.title}</span></Show>
      <Show when={props.where}><span class="ui-agent-where">{props.where}</span></Show></span>}
    meta={props.status ? <span class={props.kind === "run" ? "ui-agent-run-status" : "ui-agent-line"}>{props.status}</span> : undefined}
    after={<Show when={props.jump}>{(jump) => <Button variant="ghost" size="sm" class="ui-agent-report" onClick={() => jump().onClick()}>{jump().label}<Show when={jump().up} fallback={<Icons.ArrowDown />}><Icons.ArrowUp /></Show></Button>}</Show>}
    body={(rows) => <ul class="ui-agent-rows">{rows}</ul>}>{props.children}</FoldLine>;
}

export function AgentSpawn(props: { ids: string[]; keys?: string[]; title?: string; status?: string; onReport?: () => void; motion?: Motion; children?: JSX.Element }) {
  return <AgentLine kind="spawn" verb="Started" ids={props.ids} keys={props.keys} title={props.title} where="in the background" status={props.status} motion={props.motion}
    jump={props.onReport ? { label: "Report", onClick: props.onReport } : undefined}>{props.children}</AgentLine>;
}

export function AgentReport(props: { ids: string[]; title?: string; status?: string; onBack?: () => void; motion?: Motion; children?: JSX.Element }) {
  return <AgentLine kind="report" verb="Reported" ids={props.ids} title={props.title} status={props.status} motion={props.motion}
    jump={props.onBack ? { label: "Started", up: true, onClick: props.onBack } : undefined}>{props.children}</AgentLine>;
}

export function AgentDelegate(props: { count: number; status?: string; motion?: Motion; children?: JSX.Element }) {
  return <AgentLine kind="delegate" verb="Delegated" ids={[]} count={`${props.count} ${props.count === 1 ? "agent" : "agents"}`}
    where="in this turn" status={props.status} motion={props.motion}>{props.children}</AgentLine>;
}

export function RunLine(props: { icon: JSX.Element; label: string; number?: number | null; id?: string; trigger?: string; time?: string; woke: boolean; outcome?: string; status?: string; summary?: string; at?: string; onOpen?: () => void; line?: boolean; children?: JSX.Element }) {
  const quiet = () => !props.woke || Boolean(props.line);
  return <AgentLine kind="run" icon={props.icon} verb={props.number ? `${props.label} #${props.number}` : props.label} ids={props.id ? [props.id] : []} where={[props.trigger, props.time].filter(Boolean).join(" · ")}
    title={quiet() ? props.summary : undefined} status={[props.status, props.line ? props.at : props.woke ? props.outcome || "Woke the agent" : "Not woken"].filter(Boolean).join(" · ")}
    failed={props.status?.toLowerCase() === "failed"} quiet={quiet()} onOpen={quiet() ? props.onOpen : undefined}>
    {!quiet() && (props.children || props.onOpen) ? <li class="ui-agent-said ui-agent-run-body">{props.children}
      <Show when={props.onOpen}><Button variant="ghost" size="sm" onClick={() => props.onOpen?.()}>Open run</Button></Show></li> : undefined}
  </AgentLine>;
}

export function AgentReportItem(props: { id: string; title: string; state: AgentState; time?: string; usage?: string; onOpen?: () => void; children: JSX.Element }) {
  return <><AgentRow line id={props.id} title={props.title} state={props.state} time={props.time} usage={props.usage} onOpen={props.onOpen} />
    <li class="ui-agent-said">{props.children}</li></>;
}

export function AgentRider(props: { motion?: Motion; children: JSX.Element }) {
  return <Rider class="ui-agent-rider" label="Agents" motion={props.motion}>
    <div class="ui-agent-groups">{props.children}</div>
  </Rider>;
}

export function AgentRiderGroup(props: { label: string; going?: boolean; children: JSX.Element }) {
  return <Group kind="agent" title={props.label} going={props.going}><AgentRows label={props.label}>{props.children}</AgentRows></Group>;
}
