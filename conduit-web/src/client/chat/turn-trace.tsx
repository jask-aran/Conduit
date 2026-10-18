import { createEffect, createMemo, createSignal, Index, Match, onCleanup, Show, Suspense, Switch } from "solid-js";
import { LightbulbIcon, MessageSquareTextIcon } from "lucide-solid";
import type { Message, ToolItem, ToolKind } from "../api/contracts";
import type { TraceSegment, TurnTraceData } from "../turn-rows";
import { KIND_ICONS, stepDuration, ToolStep, VERBS } from "./tool-card";
import { Orb, Step, StepProse, Trace, TraceError as LibraryTraceError, Trail } from "@/components/ui";
import { Dynamic } from "solid-js/web";
import { ORBITS_TRAILED, PLAIN_SPHERE, SPUTTERING_SPHERE } from "./orb-frames";
import { type ModeFrame, type OrbState, settledOrbRate } from "./thinking-orb";
import { extendsText } from "./streaming-markdown";
import type { MarkdownRendererId } from "./markdown-settings";
import { ChatMarkdown } from "./lazy-markdown";
import { fullDateTime } from "./full-date-time";

type RowProps = {
  onRendered?: () => void;
  sessionId: string | null;
  renderer?: MarkdownRendererId;
  profileLabel?: string;
  toolOpen?: (id: string) => boolean;
  onToolOpenChange?: (id: string, open: boolean) => void;
  settled?: boolean;
};

/* Two or more steps of one kind in a row are one line that says how many, the
   steps under it a click below, like any other line of the trail. */
const GROUP_WORDS: Record<ToolKind, (count: number) => string> = {
  command: (count) => `Ran ${count} commands`,
  read: (count) => `Read ${count} files`,
  edit: (count) => `Made ${count} edits`,
  search: (count) => `Ran ${count} searches`,
  fetch: (count) => `Ran ${count} fetches`,
  script: (count) => `Scripted tools ${count} times`,
  other: (count) => `Used ${count} tools`,
};
type TrailItem =
  | { type: "text"; segment: Extract<TraceSegment, { kind: "thinking" | "narration" }> }
  | { type: "error"; message: Message }
  | { type: "tool"; tool: ToolItem }
  | { type: "group"; kind: ToolKind; tools: ToolItem[] }
  | { type: "hidden" };

/* The segments as the trail's lines: a run of tools of one kind becomes a
   group, anything else its own line. */
function trailOf(segments: TraceSegment[]): TrailItem[] {
  const items: TrailItem[] = [];
  let run: ToolItem[] = [];
  const flush = () => {
    // A script already holds its own list of tools; scripts are never folded
    // into a count of scripts on top of that.
    if (run.length > 1 && run[0]!.kind !== "script") items.push({ type: "group", kind: run[0]!.kind || "other", tools: run });
    else for (const tool of run) items.push({ type: "tool", tool });
    run = [];
  };
  let hiddenSaid = false;
  for (const segment of segments) {
    // Reasoning the provider kept to itself is said once, where it first
    // happened -- not once per step, and not splitting a run of tools.
    if (segment.kind === "thinking" && segment.hidden) {
      if (hiddenSaid) continue;
      hiddenSaid = true;
      flush();
      items.push({ type: "hidden" });
      continue;
    }
    if (segment.kind === "tool") {
      if (run.length && (run[0]!.kind || "other") !== (segment.tool.kind || "other")) flush();
      run.push(segment.tool);
      continue;
    }
    // Text that has not said anything is not a line of the trail, and does
    // not split a run of tools either.
    if (segment.kind !== "error" && !segment.text.trim()) continue;
    flush();
    if (segment.kind === "error") items.push({ type: "error", message: segment.message });
    else items.push({ type: "text", segment });
  }
  flush();
  return items;
}

/*
 * The header reads status, time, work, then the thinking -- the thinking last,
 * because it is the only part that is ever cut short.
 *
 * Models reason in two shapes, whatever the provider: headed summaries (GPT's
 * reasoning summaries, Gemini's thought summaries -- a bold line, perhaps a
 * paragraph under it) and raw prose (Grok, DeepSeek, Muse). One rule each: the
 * last heading if there is one, otherwise the last sentence, from its start.
 * Muse runs its sentences together without a space, so a sentence ends at
 * . ! or ? followed by a space or a capital.
 */
const HEADING_LINE = /^\s*\*\*(.+?)\*\*\s*$/;
const SENTENCE_BREAK = /(?<=[.!?])\s*(?=[A-Z])/;
/*
 * Both read only what a streamed delta added. They were asked of the whole text each delta, every heading matched
 * and every sentence split, for the one shown: a long turn's every update grew with it.
 *
 * A heading is a whole line, so the lines already read are not read again: kept per text it extends, a few texts
 * at a time (a turn's thinking and its answer).
 */
const headingScans: Array<{ text: string; read: number; heading: string | null }> = [];
function lastHeading(text: string): string | null {
  let scan = headingScans.find((entry) => extendsText(text, entry.text));
  if (!scan) {
    scan = { text: "", read: 0, heading: null };
    headingScans.unshift(scan);
    headingScans.length = Math.min(headingScans.length, 4);
  }
  // Complete lines once; the last, still open, every time.
  const complete = text.lastIndexOf("\n") + 1;
  // Only a line with ** in it can be one: from each ** to the next.
  for (let start = scan.read; start < complete;) {
    const star = text.indexOf("**", start);
    if (star < 0 || star >= complete) break;
    const end = text.indexOf("\n", star);
    const match = HEADING_LINE.exec(text.slice(Math.max(start, text.lastIndexOf("\n", star) + 1), end));
    if (match) scan.heading = match[1]!.trim();
    start = end + 1;
  }
  scan.text = text;
  scan.read = Math.max(scan.read, complete);
  const open = HEADING_LINE.exec(text.slice(complete));
  return open ? open[1]!.trim() : scan.heading;
}
/* The last sentence, read from the end: a break inside the window is one in the whole text (its first character has
   no character before it to look behind at, so a sentence must start after it). Longer than the window, the whole. */
const SENTENCE_WINDOW = 4000;
function lastSentence(text: string): string {
  if (text.length > SENTENCE_WINDOW) {
    const pieces = text.slice(-SENTENCE_WINDOW).replace(/\s+/g, " ").split(SENTENCE_BREAK).map((sentence) => sentence.trim());
    for (let index = pieces.length - 1; index >= 1; index -= 1) if (pieces[index]) return pieces[index]!;
  }
  const sentences = text.replace(/\s+/g, " ").trim().split(SENTENCE_BREAK);
  return sentences.map((sentence) => sentence.trim()).filter(Boolean).at(-1) || "";
}
function summaryOf(text: string): string {
  return lastHeading(text) ?? lastSentence(text);
}

/* What each kind of tool reads as, counted. The adapter says which kind a tool
   is; the browser only counts them. */
const KIND_WORDS: Record<ToolKind, [string, string]> = {
  command: ["command", "commands"],
  read: ["read", "reads"],
  edit: ["edit", "edits"],
  search: ["search", "searches"],
  fetch: ["fetch", "fetches"],
  script: ["script", "scripts"],
  other: ["tool", "tools"],
};
const plural = (count: number, [one, many]: [string, string]) => `${count} ${count === 1 ? one : many}`;

/* Totals per kind, most used first -- every kind named, since there are only
   six; a narrow header cuts the smallest. */
/* A call whose name has not arrived yet is not counted: it would read as a
   tool and then turn into a fetch. */
const unnamed = (tool: ToolItem) => !tool.name || tool.name === "tool";

function workOf(tools: ToolItem[]): string {
  const counts = new Map<ToolKind, number>();
  for (const tool of tools) if (!unnamed(tool)) counts.set(tool.kind || "other", (counts.get(tool.kind || "other") || 0) + 1);
  return [...counts].sort((left, right) => right[1] - left[1])
    .map(([kind, count]) => plural(count, KIND_WORDS[kind])).join(", ");
}

/* What a running tool of each kind is doing. */
const KIND_VERBS: Record<Exclude<ToolKind, "other">, string> = {
  command: "Running", read: "Reading", edit: "Editing", search: "Searching", fetch: "Fetching", script: "Scripting tools",
};

/* One verb for what it is doing, or how it ended -- always there, so a clean
   finish says Done rather than being told apart by what it lacks. Live, a
   running tool is its kind's verb, several at once are counted, between tools
   it is thinking, and once the answer streams, writing. What the tool is
   acting on is the line below's, not this one's. */
/* And the orb's motion for each: the globe scan for anything on the web, a
   plait for reading, trailed orbits for editing, and the scramble that
   clicks back for a command or any tool without an animation of its own.
   Thinking is the base state; the answer arriving is the sash. A frame of
   Conduit's own stands in for a library state where one is named. */
type Mark = { orb: OrbState; frame?: ModeFrame };
const KIND_ORBS: Record<ToolKind, Mark> = {
  command: { orb: "solving" }, read: { orb: "weaving" }, edit: { orb: "working", frame: ORBITS_TRAILED },
  search: { orb: "searching" }, fetch: { orb: "searching" }, script: { orb: "solving" }, other: { orb: "solving" },
};

function statusOf(trace: TurnTraceData, writing: boolean): Mark & { verb: string } {
  // Settled, the orb is the sphere: turning for a finish, sputtering for a
  // turn that did not finish.
  if (!trace.active) {
    const verb = ({ interrupted: "Interrupted", failed: "Failed" } as Record<string, string>)[trace.status] || "Done";
    return { verb, orb: "working", frame: verb === "Done" ? PLAIN_SPHERE : SPUTTERING_SPHERE };
  }
  const running = trace.segments.flatMap((segment) => segment.kind === "tool" && !segment.tool.done ? [segment.tool] : []);
  if (running.length > 1) return { verb: `Running ${running.length} tools`, orb: "solving" };
  const tool = running[0];
  if (!tool) return writing ? { verb: "Writing", orb: "composing" } : { verb: "Thinking", orb: "working" };
  if (unnamed(tool)) return { verb: "Calling a tool", orb: "solving" };
  const kind = tool.kind || "other";
  return { verb: kind === "other" ? `Using ${tool.name || "a tool"}` : KIND_VERBS[kind], ...KIND_ORBS[kind] };
}

/* A tool's line: what it acted on, a search's in quotes, a long path from its
   end, since the file is the part worth reading. */
function toolLine(tool: ToolItem): string {
  const subject = tool.subject || "";
  if (tool.kind === "search") return `\u201c${subject}\u201d`;
  return subject.length > 80 && (tool.kind === "read" || tool.kind === "edit") ? `\u2026${subject.slice(-79)}` : subject;
}

/* The second line is the trail's latest line. A tool running is what it is
   acting on (the verb is on the line above); once it has run it is its past
   tense, "Ran pwd && ls -la", until the next step replaces it -- so a turn
   whose reasoning is never shown still says what it has done. Thinking, when
   there is any, replaces it as it arrives. Settled, the last thinking if
   there was any, since that is what the turn concluded; otherwise the last
   step. Discarded text is that one step's loss, not the turn's, so it is
   passed over. */
type Detail = { text: string; markdown: boolean };
function stepLine(tool: ToolItem, live: boolean): string {
  // A running script is the tool it is running now, else the last it ran.
  if (live && !tool.done && tool.kind === "script") {
    const calls = (tool.calls || []).filter((call) => !call.planned && !call.earlier);
    const call = calls.find((item) => item.done === false) || calls.at(-1);
    if (!call) return "";
    const kind = call.kind || "other";
    const verb = VERBS[kind][call.done === false ? 0 : 1];
    const line = toolLine({ toolCallId: "", kind, subject: call.subject });
    return kind === "other" ? [verb, call.name, line].filter(Boolean).join(" ") : `${verb} ${line || call.name}`.trim();
  }
  const subject = toolLine(tool);
  if (live && !tool.done) return subject;
  const kind = tool.kind || "other";
  const verb = VERBS[kind][1];
  if (kind === "other") return [verb, tool.name, subject].filter(Boolean).join(" ");
  return `${verb} ${subject || tool.name || ""}`.trim();
}
function previewOf(trace: TurnTraceData, writing: boolean): { status: ReturnType<typeof statusOf>; work: string; detail: Detail | null } {
  let latest: Detail | null = null;
  let thought: Detail | null = null;
  const tools: ToolItem[] = [];
  for (const segment of trace.segments) if (segment.kind === "tool") tools.push(segment.tool);
  // From the end: the last segment that has a line is the latest, the last thought or error the thought. Only the
  // one shown is summarised; each delta summarised every text of the turn, front to back, to keep the last.
  for (let index = trace.segments.length - 1; index >= 0 && !thought; index -= 1) {
    const segment = trace.segments[index]!;
    let detail: Detail | null = null;
    if (segment.kind === "tool") {
      const line = unnamed(segment.tool) ? "" : stepLine(segment.tool, trace.active);
      if (line) latest ??= { text: line, markdown: false };
      continue;
    }
    if (segment.kind === "error") detail = { text: segment.message.errorMessage || "The model request failed.", markdown: false };
    else if (!segment.discarded && segment.text.trim()) detail = { text: summaryOf(segment.text), markdown: true };
    if (detail) { thought = detail; latest ??= detail; }
  }
  return { status: statusOf(trace, writing), work: workOf(tools), detail: trace.active ? latest : thought || latest };
}

/* `01s` to `59s`, then `1m 02s` -- one format, live and settled, except a
   settled turn that took under a second, which is in milliseconds. */
function duration(ms: number, settled: boolean): string {
  if (settled && ms < 1000) return `${Math.max(0, Math.floor(ms))}ms`;
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return seconds < 60 ? `${pad(seconds)}s` : `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
}

/* A live turn counts up from its prompt each second; a settled one is the time
   from its prompt to its last reply. Nothing when either end is unknown. */
function turnTime(trace: () => Pick<TurnTraceData, "active" | "startedAt" | "endedAt">) {
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!trace().active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });
  return () => {
    const { active, startedAt, endedAt } = trace();
    const start = startedAt ? Date.parse(startedAt) : NaN;
    const end = active ? now() : endedAt ? Date.parse(endedAt) : NaN;
    return Number.isNaN(start) || Number.isNaN(end) ? "" : duration(end - start, !active);
  };
}

/* The trace is the library's (Trace, Trail, Step and its parts); the model -- the trail's lines, the header's status,
   work and latest line, the time -- is this file's. */
function useFold(id: () => string, props: Pick<RowProps, "toolOpen" | "onToolOpenChange">) {
  const initial = Boolean(props.toolOpen?.(id()));
  const [open, setOpen] = createSignal(initial), [seen, setSeen] = createSignal(initial);
  return { open, seen, toggle: () => { const next = !open(); setOpen(next); if (next) setSeen(true); props.onToolOpenChange?.(id(), next); } };
}
const inline = (props: Pick<RowProps, "renderer">, text: string) =>
  <Suspense fallback={text}><ChatMarkdown inline renderer={props.renderer}>{text || "\u2026"}</ChatMarkdown></Suspense>;
function TrailLine(props: RowProps & { item: TrailItem; arriving?: boolean }) {
  const motion = () => props.arriving ? "entering" as const : undefined;
  return <Switch>
    <Match when={props.item.type === "text" && props.item}>{(item) => {
      const segment = () => item().segment, fold = useFold(() => segment().id, props);
      return <Step icon={segment().kind === "thinking" ? <LightbulbIcon /> : <MessageSquareTextIcon />} summary={inline(props, summaryOf(segment().text))} discarded={segment().discarded} motion={motion()} open={fold.open()} onToggle={fold.toggle}>
        <Show when={fold.seen()} fallback={<span />}><StepProse><Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={Boolean(segment().live)} renderer={props.renderer} onRendered={props.onRendered}>{segment().text}</ChatMarkdown></Suspense></StepProse></Show>
      </Step>;
    }}</Match>
    <Match when={props.item.type === "error" && props.item}>{(item) => <LibraryTraceError time={fullDateTime(item().message.timestamp) || undefined}
      facts={[item().message.model && `Model: ${item().message.model}`, item().message.provider && `Provider: ${item().message.provider}`, props.profileLabel && `Profile: ${props.profileLabel}`].filter(Boolean) as string[]}
      message={item().message.errorMessage || "The model request failed."} />}</Match>
    <Match when={props.item.type === "tool" && props.item}>{(item) => { const fold = useFold(() => item().tool.toolCallId, props);
      return <ToolStep tool={item().tool} settled={props.settled} sessionId={props.sessionId} open={fold.open()} seen={fold.seen()} onToggle={fold.toggle} motion={motion()} />; }}</Match>
    <Match when={props.item.type === "hidden"}><Step note icon={<LightbulbIcon />} summary="Reasoning not shared by the provider" motion={motion()} /></Match>
    <Match when={props.item.type === "group" && props.item}>{(item) => {
      const tools = () => (item() as Extract<TrailItem, { type: "group" }>).tools, kind = () => (item() as Extract<TrailItem, { type: "group" }>).kind;
      const fold = useFold(() => `group:${tools()[0]!.toolCallId}`, props);
      return <Step icon={<Dynamic component={KIND_ICONS[kind()]} />} verb={GROUP_WORDS[kind()](tools().length)} state={!props.settled && tools().some((tool) => !tool.done) ? "running" : undefined}
        time={stepDuration(tools()[0]!.timestamp, tools().at(-1)!.completedAt) || undefined} motion={motion()} open={fold.open()} onToggle={fold.toggle}>
        <Show when={fold.seen()} fallback={<span />}><Trail nested="group"><Index each={tools()}>{(tool) => { const inner = useFold(() => tool().toolCallId, props);
          return <ToolStep tool={tool()} settled={props.settled} sessionId={props.sessionId} open={inner.open()} seen={inner.seen()} onToggle={inner.toggle} />; }}</Index></Trail></Show>
      </Step>;
    }}</Match>
  </Switch>;
}
const LATEST_CHARS = 240;
/** since: how far into a sent message's entrance the turn arrives, so it fades in with it. */
export function TurnTrace(props: { trace: TurnTraceData; writing?: boolean; sessionId: string | null; renderer?: MarkdownRendererId; profileLabel?: string; initialOpen?: boolean; onOpenChange?: (open: boolean) => void; toolOpen?: (id: string) => boolean; onToolOpenChange?: (id: string, open: boolean) => void; onRendered?: () => void; since?: number }) {
  const preview = createMemo(() => previewOf(props.trace, Boolean(props.writing)));
  const time = turnTime(() => props.trace);
  const unfinished = () => !props.trace.active && (props.trace.status === "failed" || props.trace.status === "interrupted");
  const [open, setOpen] = createSignal(Boolean(props.initialOpen)), [seen, setSeen] = createSignal(Boolean(props.initialOpen));
  const trail = createMemo(() => trailOf(props.trace.segments));
  let opened = 0;
  // One renderer for the line, its text growing in place: a new one each delta draws a blank frame between them.
  // The line is one line, cut with an ellipsis, so it is given no more than a line's worth: a long sentence's whole
  // text, replaced each delta, was laid out and painted every frame for the few words it shows.
  const text = () => { const full = preview().detail?.text ?? ""; return full.length > LATEST_CHARS ? `${full.slice(0, LATEST_CHARS)}\u2026` : full; };
  const thinking = <Suspense fallback={text()}><ChatMarkdown inline renderer={props.renderer}>{text() || "…"}</ChatMarkdown></Suspense>;
  const latest = () => { const detail = preview().detail; return detail ? detail.markdown ? thinking : detail.text : undefined; };
  return <Trace motion={props.since != null ? "entering" : undefined} since={props.since} orb={<Orb state={preview().status.orb} frame={preview().status.frame} tint={unfinished() ? "var(--destructive)" : undefined} rate={props.trace.active ? undefined : settledOrbRate(unfinished())} />}
      status={preview().status.verb} time={time() || undefined} work={preview().work || undefined} latest={latest()} live={props.trace.active} tone={unfinished() ? "failed" : undefined}
      open={open()} onToggle={() => { const next = !open(); if (next && !seen()) { opened = trail().length; setSeen(true); } setOpen(next); props.onOpenChange?.(next); }}>
      {props.trace.segments.length ? <Show when={seen()} fallback={<span />}>{(() => { opened ||= trail().length; return <Trail><Index each={trail()}>{(item, index) =>
        <TrailLine item={item()} arriving={index >= opened} settled={!props.trace.active} sessionId={props.sessionId} renderer={props.renderer} profileLabel={props.profileLabel} toolOpen={props.toolOpen} onToolOpenChange={props.onToolOpenChange} onRendered={props.onRendered} />}</Index></Trail>; })()}</Show> : undefined}
    </Trace>;
}

/* A turn before anything of it has shown: the header it will become, its orb
   connecting and its time counting, one line of space held under it for the
   step that will fill it. The trace takes its place when its first step
   arrives, in the same spot, at the same height. */
export function TraceStarting(props: { startedAt?: string; label?: string; since?: number }) {
  const time = turnTime(() => ({ active: true, startedAt: props.startedAt }));
  return <Trace motion={props.since != null ? "entering" : undefined} since={props.since} orb={<Orb state="connecting" />} status={props.label || "Starting"} time={time() || undefined} live />;
}
