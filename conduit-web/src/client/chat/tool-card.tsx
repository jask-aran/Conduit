import { Icons } from "@/components/ui";
import { createMemo, createSignal, Index, Show, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";

import type { ToolItem, ToolKind } from "../api/contracts";
import { Step, StepDiff, StepOutput, Trail } from "@/components/ui";

const MAX_PREVIEW = 8_000;
const commandTools = new Set(["bash", "shell", "exec", "terminal", "run_command"]);

/* What the adapter says a tool acted on, a long one kept from its end, where
   the file or the last word is. The browser does not guess one from a tool's
   input: every harness spells its inputs its own way. */
/** A connector's tool by its service: `mcp__executor__call` reads "Executor call", in a name or anywhere in a subject. */
export const toolName = (name?: string) => name?.replace(/mcp__([A-Za-z0-9]+(?:_[A-Za-z0-9]+)*)__([\w.-]+)/g, (_, service: string, tool: string) => `${service[0]!.toUpperCase()}${service.slice(1)} ${tool}`);
function summary(tool: ToolItem) {
  const subject = toolName(tool.subject) || "";
  return subject.length > 90 ? `…${subject.slice(-89)}` : subject;
}

function stringify(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
}

/* A step of the trail names its kind with an icon and a verb -- present while
   it runs, past once it has -- and what it acted on in mono beside it. */
export const KIND_ICONS: Record<ToolKind, Component<{ class?: string }>> = {
  command: Icons.Shell, read: Icons.FileText, edit: Icons.WriteFile,
  search: Icons.Search, fetch: Icons.Fetch, script: Icons.Code, agent: Icons.Agent, message: Icons.Notification, other: Icons.Tool,
};
export const VERBS: Record<ToolKind, [string, string]> = {
  command: ["Running", "Ran"], read: ["Reading", "Read"], edit: ["Editing", "Edited"],
  search: ["Searching", "Searched"], fetch: ["Fetching", "Fetched"], script: ["Scripting tools", "Scripted tools"], agent: ["Delegating", "Delegated"], message: ["Notifying", "Notified"], other: ["Using", "Used"],
};

/* How long a step took: milliseconds under a second, tenths under ten
   seconds, whole seconds under a minute, then minutes and seconds. */
/** A measured time, one format everywhere it is shown: `352ms`, `5.3s`, `1m 02.4s`. */
export function elapsed(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.floor(ms))}ms`;
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
  return `${Math.floor(tenths / 600)}m ${((tenths % 600) / 10).toFixed(1).padStart(4, "0")}s`;
}

/* A step's own time is worth saying once it is a second or more: under that it is every file read and edit, and the
   column of `2ms`, `8ms` beside them said nothing. */
const STEP_TIME_MS = 1000;
function stepTime(from?: string, to?: string): string {
  const ms = from && to ? Date.parse(to) - Date.parse(from) : NaN;
  return Number.isFinite(ms) && ms >= STEP_TIME_MS ? elapsed(ms) : "";
}
/** A step's line, as its adapter said it best (ToolFacts) or else from its subject: what it acted on, its face (a
 *  query or a page is prose, in quotes for a query; a command or a file is code), and what qualifies it. */
export function stepParts(tool: Pick<ToolItem, "kind" | "subject" | "facts">): { subject: string; face: "code" | "text"; aside?: string } {
  const prose = tool.kind === "search" || tool.kind === "fetch" || tool.kind === "agent" || tool.kind === "message";
  const subject = tool.facts?.subject ?? summary(tool as ToolItem);
  return { subject: tool.kind === "search" && subject ? `\u201c${subject}\u201d` : subject, face: prose ? "text" : "code", ...(tool.facts?.aside ? { aside: tool.facts.aside } : {}) };
}
/** The same, as one plain line after a verb ("Searched “gassho stays” on shirakawa-go.gr.jp"): a trace's latest line. */
export function stepText(tool: Pick<ToolItem, "kind" | "subject" | "facts">): string {
  const parts = stepParts(tool);
  return [parts.subject, parts.aside].filter(Boolean).join(" ");
}

export function stepDuration(from?: string, to?: string): string {
  const ms = from && to ? Date.parse(to) - Date.parse(from) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return "";
  return elapsed(ms);
}

/* A tool step: the library's Step, StepOutput, a code-mode script's calls as a Trail of quiet Steps. `open`,
   `onToggle` are the trail's; its body is drawn the first time it opens (the Step's opens). Output a reload
   left on the server is fetched the first time it is opened. */
export function ToolStep(props: { tool: ToolItem; settled?: boolean; open: boolean; onToggle: () => void; motion?: "entering" }) {
  const [full, setFull] = createSignal(false);
  const status = createMemo(() => props.tool.isError ? "failed" : props.tool.cancelled ? "stopped" : props.tool.done ? "done" : props.settled ? "stopped" : "running");
  const output = createMemo(() => stringify(props.tool.output ?? (props.tool.kind === "script" ? "" : props.tool.input ?? {})));
  const preview = createMemo(() => {
    const text = output();
    if (full() || text.length <= MAX_PREVIEW) return text;
    return commandTools.has(String(props.tool.name || "").toLowerCase()) ? text.slice(-MAX_PREVIEW) : text.slice(0, MAX_PREVIEW);
  });
  const kind = () => props.tool.kind || "other";
  const verb = () => `${VERBS[kind()][status() === "running" ? 0 : 1]}${kind() === "other" ? ` ${toolName(props.tool.name) || "a tool"}` : ""}`;
  const parts = createMemo(() => stepParts(props.tool));
  const subject = () => parts().subject || (kind() === "other" || kind() === "script" ? "" : props.tool.name || "");
  const facts = () => props.tool.facts;
  const changes = () => status() !== "running" && !props.tool.isError && (facts()?.added || facts()?.removed) ? { added: facts()!.added || 0, removed: facts()!.removed || 0 } : undefined;
  return <Step label={`${props.tool.name || "Tool"} ${status()}`} icon={<Dynamic component={KIND_ICONS[kind()]} />} verb={verb()} subject={subject() || undefined} face={parts().face} aside={parts().aside}
    changes={changes()} time={stepTime(props.tool.timestamp, props.tool.completedAt) || undefined}
    state={status() === "done" ? undefined : status() as "running" | "failed" | "stopped"} opens open={props.open} motion={props.motion}
    onToggle={props.onToggle}>
    <>
      <Show when={facts()?.diff?.length}><StepDiff lines={facts()!.diff!} hidden={(facts()!.added || 0) + (facts()!.removed || 0) > facts()!.diff!.filter((line) => line.sign !== "\u2026").length ? (facts()!.added || 0) + (facts()!.removed || 0) - facts()!.diff!.filter((line) => line.sign !== "\u2026").length : undefined} /></Show>
      <Show when={props.tool.calls?.length}><Trail nested="calls"><Index each={props.tool.calls!}>{(call) => {
        const callKind = () => call().kind in KIND_ICONS ? call().kind : "other";
        const running = () => call().done === false;
        return <Step icon={<Dynamic component={KIND_ICONS[callKind()]} />} verb={call().earlier ? `${call().earlier} earlier ${call().earlier === 1 ? "call" : "calls"}` : `${VERBS[callKind()][running() || call().planned ? 0 : 1]}${callKind() === "other" ? ` ${toolName(call().name)}` : ""}`}
          subject={call().earlier ? undefined : toolName(call().subject)} state={call().earlier ? "earlier" : call().planned ? "planned" : running() ? "running" : call().isError ? "failed" : undefined}
          flags={call().repeats ? ["repeats"] : undefined} time={call().durationMs != null ? stepTime("1970-01-01T00:00:00.000Z", new Date(call().durationMs!).toISOString()) || undefined : undefined} />;
      }}</Index></Trail></Show>
      <Show when={preview() && (!facts()?.diff?.length || props.tool.isError)}><StepOutput text={preview()} hidden={output().length > MAX_PREVIEW ? output().length - MAX_PREVIEW : undefined} full={full()} onToggleFull={() => setFull(!full())} /></Show>
    </>
  </Step>;
}
