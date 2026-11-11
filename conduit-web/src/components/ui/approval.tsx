import { For, Match, Show, Switch } from "solid-js";

import { Button } from "./controls";
import { Card } from "./card";
import * as Icons from "./icons";
import { ServiceIcon } from "./service-icons";
import { type Motion } from "./shared";

export type ApprovalLine = string | { text?: string; fields?: { label: string; value: string }[]; code?: string };

export const approvalLineText = (line: ApprovalLine) => typeof line === "string" ? line
  : [line.text, ...(line.fields || []).map((field) => `${field.label}: ${field.value}`), line.code].filter(Boolean).join("\n");

function Line(props: { line: ApprovalLine }) {
  const line = () => typeof props.line === "string" ? { text: props.line } : props.line;
  return <li>
    <Show when={line().text}><span>{line().text}</span></Show>
    <Show when={line().fields?.length}>
      <dl class="ui-approval-fields"><For each={line().fields}>{(field) => <><dt>{field.label}</dt><dd>{field.value}</dd></>}</For></dl>
    </Show>
    <Show when={line().code}><pre class="ui-approval-code">{line().code}</pre></Show>
  </li>;
}

export function ApprovalSummary(props: { title: string; service?: string | null; lines?: ApprovalLine[]; meta?: string }) {
  return <div class="ui-approval-summary">
    <div class="ui-approval-head">
      <span class="ui-approval-icon ui-size-icon"><ServiceIcon service={props.service || ""} fallback={<Icons.Permissions />} /></span>
      <b>{props.title}</b>
      <Show when={props.meta}><span class="ui-approval-meta">{props.meta}</span></Show>
    </div>
    <Show when={props.lines?.length}><ul class="ui-approval-lines"><For each={props.lines}>{(line) => <Line line={line} />}</For></ul></Show>
  </div>;
}

export type ApprovalState = "pending" | "allowed" | "declined" | "expired" | "used";
export type ApprovalChoice = "allow" | "always" | "deny";

export function ApprovalCard(props: { title: string; service?: string | null; lines?: ApprovalLine[]; meta?: string; state: ApprovalState; busy?: boolean; motion?: Motion;
  always?: string | null;
  choices?: readonly ApprovalChoice[];
  bare?: boolean; onChoose?: (choice: ApprovalChoice) => void }) {
  const offers = (choice: ApprovalChoice) => !props.choices || props.choices.includes(choice);
  const actions = () => <div class="ui-approval-actions">
    <Show when={offers("allow")}><Button size="sm" disabled={props.busy} onClick={() => props.onChoose?.("allow")}>Allow</Button></Show>
    <Show when={offers("always") && props.always !== null}>
      <Button size="sm" variant="ghost" outline disabled={props.busy} title={props.always ? `Always allow: ${props.always}` : undefined} onClick={() => props.onChoose?.("always")}>Always</Button>
    </Show>
    <Show when={offers("deny")}><Button size="sm" variant="ghost" disabled={props.busy} onClick={() => props.onChoose?.("deny")}>Don't</Button></Show>
  </div>;
  return <Switch>
    <Match when={props.state === "pending" && props.bare}>
      <div class="ui-approval" data-bare="" role="group" aria-label={`Approval: ${props.title}`}>
        <Show when={props.lines?.length}><ul class="ui-approval-lines"><For each={props.lines}>{(line) => <Line line={line} />}</For></ul></Show>
        {actions()}
      </div>
    </Match>
    <Match when={props.state === "pending"}>
      <Card embedded size="compact" class="ui-approval" role="group" label={`Approval: ${props.title}`} motion={props.motion}>
        <ApprovalSummary title={props.title} service={props.service} lines={props.lines} meta={props.meta} />
        {actions()}
      </Card>
    </Match>
    <Match when={props.state !== "pending"}>
      <p class="ui-approval-done" data-state={props.state}>
        <span class="ui-approval-icon ui-size-icon"><ServiceIcon service={props.service || ""} fallback={<Icons.Permissions />} /></span>
        <span>{{ allowed: "Allowed", used: "Allowed", declined: "Not allowed", expired: "Expired" }[props.state as Exclude<ApprovalState, "pending">]}</span>
        <span class="ui-approval-done-title ui-truncate">{props.title}</span>
      </p>
    </Match>
  </Switch>;
}
