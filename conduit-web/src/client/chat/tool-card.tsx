import { createMemo, createSignal, Index, Show, type Component } from "solid-js";
import { Dynamic } from "solid-js/web";
import { CodeXmlIcon, FilePenLineIcon, FileTextIcon, GlobeIcon, SearchIcon, SquareTerminalIcon, WrenchIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import type { ToolCallStep, ToolItem, ToolKind } from "../api/contracts";
import { httpUrl } from "../api/transport";
import { authorizedFetch } from "../api/native-auth-client";
import { Disclosure } from "./disclosure";
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
  command: SquareTerminalIcon, read: FileTextIcon, edit: FilePenLineIcon,
  search: SearchIcon, fetch: GlobeIcon, script: CodeXmlIcon, other: WrenchIcon,
};
export const VERBS: Record<ToolKind, [string, string]> = {
  command: ["Running", "Ran"], read: ["Reading", "Read"], edit: ["Editing", "Edited"],
  search: ["Searching", "Searched"], fetch: ["Fetching", "Fetched"], script: ["Scripting tools", "Scripted tools"], other: ["Using", "Used"],
};

/* How long a step took: milliseconds under a second, tenths under ten
   seconds, whole seconds under a minute, then minutes and seconds. */
export function stepDuration(from?: string, to?: string): string {
  const ms = from && to ? Date.parse(to) - Date.parse(from) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.floor(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/* The tools a script calls, in order, as the trail's own rows -- each spinning
   until it ends -- one line each and not expandable: the script's output
   below is what they came to. */
function ScriptCalls(props: { calls: ToolCallStep[] }) {
  // Rows are updated in place as calls start and settle, so every part of a
  // row reads its call as it is now.
  return <ol class="tool-step-calls">
    <Index each={props.calls}>{(call) => {
      const kind = () => call().kind in KIND_ICONS ? call().kind : "other";
      const running = () => call().done === false;
      const status = () => call().earlier ? "earlier" : call().planned ? "planned" : running() ? "running" : call().isError ? "failed" : "done";
      return <li data-status={status()}>
        <Show when={!call().earlier} fallback={<span class="trail-verb">{call().earlier} earlier {call().earlier === 1 ? "call" : "calls"}</span>}>
          <Show when={running()} fallback={<Dynamic component={KIND_ICONS[kind()]} class="trail-icon" />}><Spinner class="trail-icon" /></Show>
          <span class="trail-verb">{VERBS[kind()][running() || call().planned ? 0 : 1]}<Show when={kind() === "other"}> {call().name}</Show></span>
          <Show when={call().subject}><span class="trail-subject">{call().subject}</span></Show>
          <span class="trail-meta">
            <Show when={call().repeats}><span>repeats</span></Show>
            <Show when={call().isError}><span class="trail-flag">Failed</span></Show>
            {call().durationMs != null ? stepDuration("1970-01-01T00:00:00.000Z", new Date(call().durationMs!).toISOString()) : ""}
          </span>
        </Show>
      </li>;
    }}</Index>
  </ol>;
}

export function ToolStep(props: { tool?: ToolItem; sessionId?: string | null; initialOpen?: boolean; onOpenChange?: (open: boolean) => void; settled?: boolean }) {
  const [loaded, setLoaded] = createSignal<unknown>(undefined);
  const [loading, setLoading] = createSignal(false);
  const [full, setFull] = createSignal(false);
  const tool = createMemo(() => props.tool);
  const status = createMemo(() => {
    const current = tool();
    // A tool a stop cut off says so (`cancelled`); one its turn ended without
    // answering is not still running either. Both went with the turn.
    if (current?.isError) return "failed";
    if (current?.cancelled) return "stopped";
    if (current?.done) return "done";
    return props.settled ? "stopped" : "running";
  });
  const source = createMemo(() => {
    const current = tool();
    // A script's input is its code; until it answers, its calls say what it does.
    return loaded() ?? current?.output ?? (current?.kind === "script" ? "" : current?.input ?? {});
  });
  const output = createMemo(() => stringify(source()));
  const preview = createMemo(() => {
    const text = output();
    if (full() || text.length <= MAX_PREVIEW) return text;
    return commandTools.has(String(tool()?.name || "").toLowerCase()) ? text.slice(-MAX_PREVIEW) : text.slice(0, MAX_PREVIEW);
  });

  // Output a reload left on the server is fetched the first time it is opened.
  const load = async () => {
    const current = tool();
    if (!current?.outputDeferred || loaded() !== undefined || loading() || !props.sessionId) return;
    setLoading(true);
    try {
      const response = await authorizedFetch(httpUrl(`/v0/sessions/${encodeURIComponent(props.sessionId)}/tools/${encodeURIComponent(current.toolCallId)}`));
      if (!response.ok) throw new Error("Could not load tool output");
      const payload = await response.json() as { output?: unknown };
      setLoaded(payload.output ?? "");
    } catch (error) { setLoaded((error as Error).message); }
    finally { setLoading(false); }
  };

  return <Show when={tool()}>{(current) => {
    const kind = () => current().kind || "other";
    const verb = () => VERBS[kind()][status() === "running" ? 0 : 1];
    // What it acted on, or its own name when the adapter names nothing.
    const subject = () => summary(current()) || (kind() === "other" || kind() === "script" ? "" : current().name || "");
    const Icon = () => { const KindIcon = KIND_ICONS[kind()]; return <KindIcon class="trail-icon" />; };
    return <Disclosure class="trail-row tool-step" data-status={status()}
      headerClass="trail-row-header" bodyClass="tool-step-content"
      label={`${current().name || "Tool"} ${status()}`}
      initialOpen={props.initialOpen} onOpenChange={(next) => { props.onOpenChange?.(next); if (next) void load(); }}
      header={<>
        <Show when={status() === "running"} fallback={<Icon />}><Spinner class="trail-icon" /></Show>
        <span class="trail-verb">{verb()}<Show when={kind() === "other"}> {current().name || "a tool"}</Show></span>
        <Show when={subject()}><span class="trail-subject">{subject()}</span></Show>
        <span class="trail-meta">
          <Show when={status() === "failed"}><span class="trail-flag">Failed</span></Show>
          <Show when={status() === "stopped"}><span class="trail-flag">Stopped</span></Show>
          {stepDuration(current().timestamp, current().completedAt)}
        </span>
      </>}
      body={() => <>
        <Show when={current().calls?.length}><ScriptCalls calls={current().calls!} /></Show>
        <Show when={loading() || preview()}><pre>{loading() ? "Loading…" : preview()}</pre></Show>
        <Show when={!loading() && output().length > MAX_PREVIEW}>
          <Button variant="ghost" size="sm" onClick={() => setFull((value) => !value)}>{full() ? "Show preview" : `Show full output · ${output().length - MAX_PREVIEW} hidden characters`}</Button>
        </Show>
      </>} />;
  }}</Show>;
}

/* The gallery's previews draw a tool step from the library (Step, StepOutput, a code-mode script's calls as a
   Trail of quiet Steps); the logic is ToolStep's. `open`, `onToggle` and `seen` (opened at least once: its body is
   drawn from then on) are the trail's. */
export function LibraryToolStep(props: { tool: ToolItem; sessionId?: string | null; settled?: boolean; open: boolean; seen: boolean; onToggle: () => void; motion?: "entering" }) {
  const [loaded, setLoaded] = createSignal<unknown>(undefined);
  const [loading, setLoading] = createSignal(false);
  const [full, setFull] = createSignal(false);
  const status = createMemo(() => props.tool.isError ? "failed" : props.tool.cancelled ? "stopped" : props.tool.done ? "done" : props.settled ? "stopped" : "running");
  const output = createMemo(() => stringify(loaded() ?? props.tool.output ?? (props.tool.kind === "script" ? "" : props.tool.input ?? {})));
  const preview = createMemo(() => {
    const text = output();
    if (full() || text.length <= MAX_PREVIEW) return text;
    return commandTools.has(String(props.tool.name || "").toLowerCase()) ? text.slice(-MAX_PREVIEW) : text.slice(0, MAX_PREVIEW);
  });
  const load = async () => {
    const current = props.tool;
    if (!current.outputDeferred || loaded() !== undefined || loading() || !props.sessionId) return;
    setLoading(true);
    try {
      const response = await authorizedFetch(httpUrl(`/v0/sessions/${encodeURIComponent(props.sessionId)}/tools/${encodeURIComponent(current.toolCallId)}`));
      if (!response.ok) throw new Error("Could not load tool output");
      setLoaded(((await response.json()) as { output?: unknown }).output ?? "");
    } catch (error) { setLoaded((error as Error).message); }
    finally { setLoading(false); }
  };
  const kind = () => props.tool.kind || "other";
  const verb = () => `${VERBS[kind()][status() === "running" ? 0 : 1]}${kind() === "other" ? ` ${props.tool.name || "a tool"}` : ""}`;
  const subject = () => summary(props.tool) || (kind() === "other" || kind() === "script" ? "" : props.tool.name || "");
  return <Step label={`${props.tool.name || "Tool"} ${status()}`} icon={<Dynamic component={KIND_ICONS[kind()]} />} verb={verb()} subject={subject() || undefined} time={stepDuration(props.tool.timestamp, props.tool.completedAt) || undefined}
    state={status() === "done" ? undefined : status() as "running" | "failed" | "stopped"} open={props.open} motion={props.motion}
    onToggle={() => { if (!props.open) void load(); props.onToggle(); }}>
    <Show when={props.seen} fallback={<span />}>
      <Show when={props.tool.calls?.length}><Trail nested="calls"><Index each={props.tool.calls!}>{(call) => {
        const callKind = () => call().kind in KIND_ICONS ? call().kind : "other";
        const running = () => call().done === false;
        return <Step icon={<Dynamic component={KIND_ICONS[callKind()]} />} verb={call().earlier ? `${call().earlier} earlier ${call().earlier === 1 ? "call" : "calls"}` : `${VERBS[callKind()][running() || call().planned ? 0 : 1]}${callKind() === "other" ? ` ${call().name}` : ""}`}
          subject={call().earlier ? undefined : call().subject} state={call().earlier ? "earlier" : call().planned ? "planned" : running() ? "running" : call().isError ? "failed" : undefined}
          flags={call().repeats ? ["repeats"] : undefined} time={call().durationMs != null ? stepDuration("1970-01-01T00:00:00.000Z", new Date(call().durationMs!).toISOString()) : undefined} />;
      }}</Index></Trail></Show>
      <Show when={loading() || preview()}><StepOutput text={loading() ? "Loading…" : preview()} hidden={!loading() && output().length > MAX_PREVIEW ? output().length - MAX_PREVIEW : undefined} full={full()} onToggleFull={() => setFull(!full())} /></Show>
    </Show>
  </Step>;
}
