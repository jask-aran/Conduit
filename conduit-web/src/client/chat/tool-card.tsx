import { Icons } from "@/components/ui";
import { createMemo, createSignal, Index, Show, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";

import type { ToolItem, ToolKind } from "../api/contracts";
import { Step, StepOutput, Trail } from "@/components/ui";

const MAX_PREVIEW = 8_000;
const commandTools = new Set(["bash", "shell", "exec", "terminal", "run_command"]);

/* What the adapter says a tool acted on, a long one kept from its end, where
   the file or the last word is. The browser does not guess one from a tool's
   input: every harness spells its inputs its own way. */
function summary(tool: ToolItem) {
  const subject = tool.subject || "";
  return subject.length > 90 ? `…${subject.slice(-89)}` : subject;
}

function stringify(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
}

/* A step of the trail names its kind with an icon and a verb -- present while
   it runs, past once it has -- and what it acted on in mono beside it. */
export const KIND_ICONS: Record<ToolKind, Component<{ class?: string }>> = {
  command: Icons.Shell, read: Icons.FileText, edit: Icons.WriteFile,
  search: Icons.Search, fetch: Icons.Fetch, script: Icons.Code, agent: Icons.Agent, other: Icons.Tool,
};
export const VERBS: Record<ToolKind, [string, string]> = {
  command: ["Running", "Ran"], read: ["Reading", "Read"], edit: ["Editing", "Edited"],
  search: ["Searching", "Searched"], fetch: ["Fetching", "Fetched"], script: ["Scripting tools", "Scripted tools"], agent: ["Delegating", "Delegated"], other: ["Using", "Used"],
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
  const verb = () => `${VERBS[kind()][status() === "running" ? 0 : 1]}${kind() === "other" ? ` ${props.tool.name || "a tool"}` : ""}`;
  const subject = () => summary(props.tool) || (kind() === "other" || kind() === "script" ? "" : props.tool.name || "");
  return <Step label={`${props.tool.name || "Tool"} ${status()}`} icon={<Dynamic component={KIND_ICONS[kind()]} />} verb={verb()} subject={subject() || undefined} time={stepDuration(props.tool.timestamp, props.tool.completedAt) || undefined}
    state={status() === "done" ? undefined : status() as "running" | "failed" | "stopped"} opens open={props.open} motion={props.motion}
    onToggle={props.onToggle}>
    <>
      <Show when={props.tool.calls?.length}><Trail nested="calls"><Index each={props.tool.calls!}>{(call) => {
        const callKind = () => call().kind in KIND_ICONS ? call().kind : "other";
        const running = () => call().done === false;
        return <Step icon={<Dynamic component={KIND_ICONS[callKind()]} />} verb={call().earlier ? `${call().earlier} earlier ${call().earlier === 1 ? "call" : "calls"}` : `${VERBS[callKind()][running() || call().planned ? 0 : 1]}${callKind() === "other" ? ` ${call().name}` : ""}`}
          subject={call().earlier ? undefined : call().subject} state={call().earlier ? "earlier" : call().planned ? "planned" : running() ? "running" : call().isError ? "failed" : undefined}
          flags={call().repeats ? ["repeats"] : undefined} time={call().durationMs != null ? stepDuration("1970-01-01T00:00:00.000Z", new Date(call().durationMs!).toISOString()) : undefined} />;
      }}</Index></Trail></Show>
      <Show when={preview()}><StepOutput text={preview()} hidden={output().length > MAX_PREVIEW ? output().length - MAX_PREVIEW : undefined} full={full()} onToggleFull={() => setFull(!full())} /></Show>
    </>
  </Step>;
}
