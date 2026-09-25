import { createMemo, createSignal, Show, type Component } from "solid-js";
import { FilePenLineIcon, FileTextIcon, GlobeIcon, SearchIcon, SquareTerminalIcon, WrenchIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import type { ToolItem, ToolKind } from "../api/contracts";
import { httpUrl } from "../api/transport";
import { authorizedFetch } from "../api/native-auth-client";
import { Disclosure } from "./disclosure";

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
  search: SearchIcon, fetch: GlobeIcon, other: WrenchIcon,
};
export const VERBS: Record<ToolKind, [string, string]> = {
  command: ["Running", "Ran"], read: ["Reading", "Read"], edit: ["Editing", "Edited"],
  search: ["Searching", "Searched"], fetch: ["Fetching", "Fetched"], other: ["Using", "Used"],
};

/* How long a step took: tenths under ten seconds, whole seconds under a
   minute, then minutes and seconds. */
export function stepDuration(from?: string, to?: string): string {
  const ms = from && to ? Date.parse(to) - Date.parse(from) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return "";
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
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
    return loaded() ?? current?.output ?? current?.input ?? {};
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
    const subject = () => summary(current()) || (kind() === "other" ? "" : current().name || "");
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
        <pre>{loading() ? "Loading…" : preview()}</pre>
        <Show when={!loading() && output().length > MAX_PREVIEW}>
          <Button variant="ghost" size="sm" onClick={() => setFull((value) => !value)}>{full() ? "Show preview" : `Show full output · ${output().length - MAX_PREVIEW} hidden characters`}</Button>
        </Show>
      </>} />;
  }}</Show>;
}
