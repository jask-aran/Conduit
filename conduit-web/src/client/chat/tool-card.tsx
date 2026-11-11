import { Icons } from "@/components/ui";
import { createMemo, createSignal, Index, Show, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";

import type { ToolCallStep, ToolItem, ToolKind } from "../api/contracts";
import { Step, StepDiff, StepOutput, Trail } from "@/components/ui";

const MAX_PREVIEW = 8_000;
const commandTools = new Set(["bash", "shell", "exec", "terminal", "run_command"]);

/* A long subject is kept from its end, where the file or the last word is. The browser does not guess one from a
   tool's input: every harness spells its inputs its own way. */
export const toolName = (name?: string) => name?.replace(/mcp__([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)__([\w.-]+)/g, (_, service: string, tool: string) => `${service[0]!.toUpperCase()}${service.slice(1)} ${tool}`);
function summary(tool: ToolItem) {
  const subject = toolName(tool.subject) || "";
  return subject.length > 90 ? `…${subject.slice(-89)}` : subject;
}

function stringify(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
}

export const KIND_ICONS: Record<ToolKind, Component<{ class?: string }>> = {
  command: Icons.Shell, read: Icons.FileText, edit: Icons.WriteFile,
  search: Icons.Search, fetch: Icons.Fetch, script: Icons.Code, agent: Icons.Agent, message: Icons.Notification, other: Icons.Tool,
};
export const VERBS: Record<ToolKind, [string, string]> = {
  command: ["Running", "Ran"], read: ["Reading", "Read"], edit: ["Editing", "Edited"],
  search: ["Searching", "Searched"], fetch: ["Fetching", "Fetched"], script: ["Scripting tools", "Scripted tools"], agent: ["Delegating", "Delegated"], message: ["Notifying", "Notified"], other: ["Using", "Used"],
};

export function elapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.floor(ms))}ms`;
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
  return `${Math.floor(tenths / 600)}m ${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}s`;
}

/* Under a second is every file read and edit, and a column of `2ms`, `8ms` beside them says nothing. */
const STEP_TIME_MS = 1000;
function stepTime(from?: string, to?: string): string {
  const ms = from && to ? Date.parse(to) - Date.parse(from) : NaN;
  return Number.isFinite(ms) && ms >= STEP_TIME_MS ? elapsed(ms) : "";
}
export function stepParts(tool: Pick<ToolItem, "kind" | "subject" | "facts">): { subject: string; face: "code" | "text"; aside?: string } {
  const prose = tool.kind === "search" || tool.kind === "fetch" || tool.kind === "agent" || tool.kind === "message" || Boolean(tool.facts?.verb);
  const subject = tool.facts?.subject ?? summary(tool as ToolItem);
  return { subject: tool.kind === "search" && subject ? `\u201c${subject}\u201d` : subject, face: prose ? "text" : "code", ...(tool.facts?.aside ? { aside: tool.facts.aside } : {}) };
}
type Said = Pick<ToolItem, "subject" | "facts"> & { kind?: ToolKind; name?: string };
export function stepVerb(item: Said, running: boolean): string {
  if (item.facts?.verb) return item.facts.verb[running ? 0 : 1];
  const kind = item.kind || "other";
  return `${VERBS[kind][running ? 0 : 1]}${kind === "other" ? ` ${toolName(item.name) || "a tool"}` : ""}`;
}
export const stepKind = (item: Said): ToolKind => item.facts?.kind || item.kind || "other";
export const scriptCalls = (tool: ToolItem): ToolCallStep[] => (tool.calls || []).filter((call) => !call.planned && !call.earlier);
export function scriptSaid(tool: ToolItem, running: boolean): { call: ToolCallStep; more: number } | null {
  const calls = scriptCalls(tool);
  if (!calls.length) return null;
  const call = running ? calls.find((item) => item.done === false) || calls.at(-1)! : calls[0]!;
  const lines = new Set(calls.map((item) => `${stepVerb(item, false)} ${stepText(item)}`));
  return { call, more: running ? 0 : lines.size - 1 };
}

export function stepText(tool: Pick<ToolItem, "kind" | "subject" | "facts">): string {
  const parts = stepParts(tool);
  return [parts.subject, parts.aside].filter(Boolean).join(" ");
}

export function stepDuration(from?: string, to?: string): string {
  const ms = from && to ? Date.parse(to) - Date.parse(from) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return "";
  return elapsed(ms);
}

/* For find in chat: a step's text from the data, so a closed step's text is found without drawing it. */
export function toolStepLine(tool: ToolItem): string {
  const said = tool.kind === "script" ? scriptSaid(tool, false) : null;
  const item: Said = said?.call ?? tool;
  const kind = stepKind(item), parts = stepParts(item);
  const subject = parts.subject || (kind === "other" || kind === "script" ? "" : tool.name || "");
  return [stepVerb(item, false), subject, parts.aside, said?.more ? `and ${said.more} more` : ""].filter(Boolean).join(" ");
}
export function toolStepBody(tool: ToolItem): string {
  const output = stringify(tool.output ?? (tool.kind === "script" ? "" : tool.input ?? {}));
  const preview = output.length <= MAX_PREVIEW ? output : commandTools.has(String(tool.name || "").toLowerCase()) ? output.slice(-MAX_PREVIEW) : output.slice(0, MAX_PREVIEW);
  const diff = tool.facts?.diff?.length ? tool.facts.diff.map((line) => line.text).join("\n") : "";
  const calls = (tool.calls || []).filter((call) => !call.earlier).map((call) => [stepVerb(call, false), toolName(stepParts(call).subject), stepParts(call).aside].filter(Boolean).join(" ")).join("\n");
  return [diff, calls, !diff || tool.isError ? preview : ""].filter(Boolean).join("\n");
}

export function ToolStep(props: { tool: ToolItem; settled?: boolean; open: boolean; onToggle: () => void; motion?: "entering" }) {
  const [full, setFull] = createSignal(false);
  const status = createMemo(() => props.tool.isError ? "failed" : props.tool.cancelled ? "stopped" : props.tool.done ? "done" : props.settled ? "stopped" : "running");
  const output = createMemo(() => stringify(props.tool.output ?? (props.tool.kind === "script" ? "" : props.tool.input ?? {})));
  const preview = createMemo(() => {
    const text = output();
    if (full() || text.length <= MAX_PREVIEW) return text;
    return commandTools.has(String(props.tool.name || "").toLowerCase()) ? text.slice(-MAX_PREVIEW) : text.slice(0, MAX_PREVIEW);
  });
  const said = createMemo(() => props.tool.kind === "script" ? scriptSaid(props.tool, status() === "running") : null);
  const item = (): Said => said()?.call ?? props.tool;
  const kind = () => stepKind(item());
  const verb = () => stepVerb(item(), status() === "running" && (!said() || said()!.call.done === false));
  const parts = createMemo(() => stepParts(item()));
  const aside = () => [parts().aside, said()?.more ? `and ${said()!.more} more` : ""].filter(Boolean).join(" \u00b7 ") || undefined;
  const subject = () => parts().subject || (kind() === "other" || kind() === "script" ? "" : props.tool.name || "");
  const facts = () => props.tool.facts;
  const changes = () => status() !== "running" && !props.tool.isError && (facts()?.added || facts()?.removed) ? { added: facts()!.added || 0, removed: facts()!.removed || 0 } : undefined;
  return <Step label={`${props.tool.name || "Tool"} ${status()}`} icon={<Dynamic component={KIND_ICONS[kind()]} />} verb={verb()} subject={subject() || undefined} face={parts().face} aside={aside()}
    changes={changes()} time={stepTime(props.tool.timestamp, props.tool.completedAt) || undefined}
    state={status() === "done" ? undefined : status() as "running" | "failed" | "stopped"} opens open={props.open} motion={props.motion}
    onToggle={props.onToggle} find={() => toolStepBody(props.tool)}>
    <>
      <Show when={facts()?.diff?.length}><StepDiff lines={facts()!.diff!} hidden={(facts()!.added || 0) + (facts()!.removed || 0) > facts()!.diff!.filter((line) => line.sign !== "\u2026").length ? (facts()!.added || 0) + (facts()!.removed || 0) - facts()!.diff!.filter((line) => line.sign !== "\u2026").length : undefined} /></Show>
      {/* A script that made one call is said as that call already: its list would say it again. */}
      <Show when={props.tool.calls?.length && !(said() && props.tool.calls!.filter((call) => !call.earlier).length <= 1)}><Trail nested="calls"><Index each={props.tool.calls!}>{(call) => {
        const callKind = () => stepKind(call()) in KIND_ICONS ? stepKind(call()) : "other";
        const running = () => call().done === false;
        const callParts = () => stepParts(call());
        return <Step icon={<Dynamic component={KIND_ICONS[callKind()]} />} verb={call().earlier ? `${call().earlier} earlier ${call().earlier === 1 ? "call" : "calls"}` : stepVerb(call(), running() || Boolean(call().planned))}
          subject={call().earlier ? undefined : toolName(callParts().subject) || undefined} face={callParts().face} aside={call().earlier ? undefined : callParts().aside} state={call().earlier ? "earlier" : call().planned ? "planned" : running() ? "running" : call().isError ? "failed" : undefined}
          flags={call().repeats ? ["repeats"] : undefined} time={call().durationMs != null ? stepTime("1970-01-01T00:00:00.000Z", new Date(call().durationMs!).toISOString()) || undefined : undefined} />;
      }}</Index></Trail></Show>
      <Show when={preview() && (!facts()?.diff?.length || props.tool.isError)}><StepOutput text={preview()} hidden={output().length > MAX_PREVIEW ? output().length - MAX_PREVIEW : undefined} full={full()} onToggleFull={() => setFull(!full())} /></Show>
    </>
  </Step>;
}
