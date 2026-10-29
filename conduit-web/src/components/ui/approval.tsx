import { For, Match, Show, Switch } from "solid-js";

import { Button } from "./controls";
import { Frost } from "./frost";
import * as Icons from "./icons";
import { ServiceIcon } from "./service-icons";
import { type Motion, motionOf } from "./shared";

/*
 * An approval: an agent asking to do one thing that leaves its own space (send an email, start a chat, run a command
 * on a device). The same summary is asked two ways -- on the question card that takes the composer's place while a
 * harness waits for it (sync), or as an ApprovalCard in the thread that waits for the person while the agent carries
 * on (async) -- so an approval reads the same wherever it is answered.
 */

/**
 * A detail line: plain text, or an action with what it sends as labelled fields ("To", "Subject"), and a command or
 * script as it will run, in a block of its own.
 */
export type ApprovalLine = string | { text?: string; fields?: { label: string; value: string }[]; code?: string };

/** A line as plain text: for a tooltip or a notification. */
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

/** What is asked: the service's mark (or the shield), a short title, a few detail lines; meta at the right (expiry). */
export function ApprovalSummary(props: { title: string; service?: string | null; lines?: ApprovalLine[]; meta?: string }) {
  return <div class="ui-approval-summary">
    <div class="ui-approval-head">
      <span class="ui-approval-icon"><ServiceIcon service={props.service || ""} fallback={<Icons.Permissions />} /></span>
      <b>{props.title}</b>
      <Show when={props.meta}><span class="ui-approval-meta">{props.meta}</span></Show>
    </div>
    <Show when={props.lines?.length}><ul class="ui-approval-lines"><For each={props.lines}>{(line) => <Line line={line} />}</For></ul></Show>
  </div>;
}

export type ApprovalState = "pending" | "allowed" | "declined" | "expired" | "used";
export type ApprovalChoice = "allow" | "always" | "deny";

/**
 * ApprovalCard: an approval in the thread. Pending, the summary over Allow / Always / Don't (Allow the one action
 * waiting); answered, one quiet line of what became of it. busy: an answer on its way.
 */
export function ApprovalCard(props: { title: string; service?: string | null; lines?: ApprovalLine[]; meta?: string; state: ApprovalState; busy?: boolean; motion?: Motion;
  /** What Always would allow from now on ("Gmail · send, any input"); null: no lasting rule fits, so no Always. */
  always?: string | null; onChoose?: (choice: ApprovalChoice) => void }) {
  return <Switch>
    <Match when={props.state === "pending"}>
      <Frost lift="raised" class="ui-approval" role="group" aria-label={`Approval: ${props.title}`} {...motionOf(props.motion)}>
        <ApprovalSummary title={props.title} service={props.service} lines={props.lines} meta={props.meta} />
        <div class="ui-approval-actions">
          <Button size="sm" disabled={props.busy} onClick={() => props.onChoose?.("allow")}>Allow</Button>
          <Show when={props.always !== null}>
            <Button size="sm" variant="ghost" outline disabled={props.busy} title={props.always ? `Always allow: ${props.always}` : undefined} onClick={() => props.onChoose?.("always")}>Always</Button>
          </Show>
          <Button size="sm" variant="ghost" disabled={props.busy} onClick={() => props.onChoose?.("deny")}>Don't</Button>
        </div>
      </Frost>
    </Match>
    <Match when={props.state !== "pending"}>
      <p class="ui-approval-done" data-state={props.state}>
        <span class="ui-approval-icon"><ServiceIcon service={props.service || ""} fallback={<Icons.Permissions />} /></span>
        <span>{{ allowed: "Allowed", used: "Allowed", declined: "Not allowed", expired: "Expired" }[props.state as Exclude<ApprovalState, "pending">]}</span>
        <span class="ui-approval-done-title">{props.title}</span>
      </p>
    </Match>
  </Switch>;
}
