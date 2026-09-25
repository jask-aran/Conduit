import { createEffect, createMemo, createSignal, Index, lazy, Match, onCleanup, Show, Suspense, Switch } from "solid-js";
import { LightbulbIcon, MessageSquareTextIcon, TriangleAlertIcon } from "lucide-solid";
import { Spinner } from "@/components/primitives";
import type { Message, ToolItem, ToolKind } from "../api/contracts";
import type { TraceSegment, TurnTraceData } from "../turn-rows";
import { KIND_ICONS, stepDuration, ToolStep, VERBS } from "./tool-card";
import "./turn-trail.css";
import { PLAIN_SPHERE } from "./orb-stills";
import { ThinkingOrb, type ModeFrame, type OrbState } from "./thinking-orb";
import { Disclosure } from "./disclosure";
import type { MarkdownRendererId } from "./markdown-settings";
import type { IncremarkPacingMode } from "./incremark-pacing";

const ChatMarkdown = lazy(() => import("./markdown").then((module) => ({ default: module.ChatMarkdown })));
const fullDateTime = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat([], {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(date);
};

function TraceError(props: { message: Message; profileLabel?: string }) {
  const message = () => props.message;
  return <div class="turn-trace-error" data-message-id={message().id}>
    <div class="turn-trace-error-heading">
      <TriangleAlertIcon aria-hidden="true" />
      <strong>Request failed</strong>
      <Show when={message().timestamp}><time dateTime={message().timestamp}>{fullDateTime(message().timestamp)}</time></Show>
    </div>
    <div class="turn-trace-error-meta">
      <Show when={message().model}><span>Model: {message().model}</span></Show>
      <Show when={message().provider}><span>Provider: {message().provider}</span></Show>
      <Show when={props.profileLabel}><span>Profile: {props.profileLabel}</span></Show>
    </div>
    <pre>{message().errorMessage || "The model request failed."}</pre>
  </div>;
}

type RowProps = {
  onRendered?: () => void;
  sessionId: string | null;
  renderer?: MarkdownRendererId;
  pacing?: IncremarkPacingMode;
  profileLabel?: string;
  toolOpen?: (id: string) => boolean;
  onToolOpenChange?: (id: string, open: boolean) => void;
  settled?: boolean;
};

/* Thinking or narration as one line of the trail: its summary, the whole text
   a click below it. */
function TextStep(props: RowProps & { segment: Extract<TraceSegment, { kind: "thinking" | "narration" }> }) {
  const Icon = () => props.segment.kind === "thinking" ? <LightbulbIcon class="trail-icon" /> : <MessageSquareTextIcon class="trail-icon" />;
  return <Disclosure class="trail-row text-step" data-kind={props.segment.kind}
    // Text the model was cut off writing and is not being given back to it:
    // struck where it sits, and it says so -- the loss is this step's.
    data-discarded={props.segment.discarded ? "true" : undefined}
    headerClass="trail-row-header" bodyClass="text-step-content"
    initialOpen={props.toolOpen?.(props.segment.id)} onOpenChange={(open) => props.onToolOpenChange?.(props.segment.id, open)}
    header={<>
      <Icon />
      <span class="trail-summary">
        <Suspense fallback={summaryOf(props.segment.text)}><ChatMarkdown inline renderer={props.renderer} pacing={props.pacing}>{summaryOf(props.segment.text) || "\u2026"}</ChatMarkdown></Suspense>
      </span>
      <Show when={props.segment.discarded}><span class="trail-meta"><span class="trail-flag" title="Interrupted — the agent has no record of this">Not kept</span></span></Show>
    </>}
    body={() => <Suspense fallback={<div class="markdown-skeleton" />}>
      <ChatMarkdown streaming={Boolean(props.segment.live)} renderer={props.renderer} pacing={props.pacing} onRendered={props.onRendered}>{props.segment.text}</ChatMarkdown>
    </Suspense>} />;
}

function ToolRow(props: RowProps & { tool: ToolItem }) {
  return <ToolStep tool={props.tool} settled={props.settled} sessionId={props.sessionId}
    initialOpen={props.toolOpen?.(props.tool.toolCallId)} onOpenChange={(open) => props.onToolOpenChange?.(props.tool.toolCallId, open)} />;
}

/* Two or more steps of one kind in a row are one line that says how many, the
   steps under it a click below, like any other line of the trail. */
const GROUP_WORDS: Record<ToolKind, (count: number) => string> = {
  command: (count) => `Ran ${count} commands`,
  read: (count) => `Read ${count} files`,
  edit: (count) => `Made ${count} edits`,
  search: (count) => `Ran ${count} searches`,
  fetch: (count) => `Ran ${count} fetches`,
  other: (count) => `Used ${count} tools`,
};
function ToolGroup(props: RowProps & { kind: ToolKind; tools: ToolItem[] }) {
  const key = () => `group:${props.tools[0]!.toolCallId}`;
  const running = () => !props.settled && props.tools.some((tool) => !tool.done);
  const KindIcon = () => { const Icon = KIND_ICONS[props.kind]; return <Icon class="trail-icon" />; };
  return <Disclosure class="trail-row tool-group" headerClass="trail-row-header" bodyClass="tool-group-steps"
    initialOpen={props.toolOpen?.(key())} onOpenChange={(open) => props.onToolOpenChange?.(key(), open)}
    header={<>
      <Show when={running()} fallback={<KindIcon />}><Spinner class="trail-icon" /></Show>
      <span class="trail-verb">{GROUP_WORDS[props.kind](props.tools.length)}</span>
      <span class="trail-meta">{stepDuration(props.tools[0]!.timestamp, props.tools.at(-1)!.completedAt)}</span>
    </>}
    body={() => <Index each={props.tools}>{(tool) => <ToolRow {...props} tool={tool()} />}</Index>} />;
}

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
    if (run.length > 1) items.push({ type: "group", kind: run[0]!.kind || "other", tools: run });
    else if (run.length) items.push({ type: "tool", tool: run[0]! });
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

function TrailLine(props: RowProps & { item: TrailItem }) {
  return <Switch>
    <Match when={props.item.type === "text" && props.item}>{(item) => <TextStep {...props} segment={item().segment} />}</Match>
    <Match when={props.item.type === "error" && props.item}>{(item) => <div class="trail-row trail-error"><TraceError message={item().message} profileLabel={props.profileLabel} /></div>}</Match>
    <Match when={props.item.type === "tool" && props.item}>{(item) => <ToolRow {...props} tool={item().tool} />}</Match>
    <Match when={props.item.type === "hidden"}>
      <div class="trail-row trail-note"><div class="trail-row-header"><LightbulbIcon class="trail-icon" /><span class="trail-summary">Reasoning not shared by the provider</span></div></div>
    </Match>
    <Match when={props.item.type === "group" && props.item}>{(item) => <ToolGroup {...props} kind={item().kind} tools={item().tools} />}</Match>
  </Switch>;
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
const HEADING = /^\s*\*\*(.+?)\*\*\s*$/gm;
function summaryOf(text: string): string {
  const headings = [...text.matchAll(HEADING)];
  if (headings.length) return headings.at(-1)![1]!.trim();
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?])\s*(?=[A-Z])/);
  return sentences.map((sentence) => sentence.trim()).filter(Boolean).at(-1) || "";
}

/* What each kind of tool reads as, counted. The adapter says which kind a tool
   is; the browser only counts them. */
const KIND_WORDS: Record<ToolKind, [string, string]> = {
  command: ["command", "commands"],
  read: ["read", "reads"],
  edit: ["edit", "edits"],
  search: ["search", "searches"],
  fetch: ["fetch", "fetches"],
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
  command: "Running", read: "Reading", edit: "Editing", search: "Searching", fetch: "Fetching",
};

/* One verb for what it is doing, or how it ended -- always there, so a clean
   finish says Done rather than being told apart by what it lacks. Live, a
   running tool is its kind's verb, several at once are counted, between tools
   it is thinking, and once the answer streams, writing. What the tool is
   acting on is the line below's, not this one's. */
/* And the orb's motion for each: the globe scan for anything on the web, a
   plait for reading, a morphing outline for editing, and the scramble that
   clicks back for a command or any tool without an animation of its own.
   Thinking is the base state; the answer arriving is the sash. */
const KIND_ORBS: Record<ToolKind, OrbState> = {
  command: "solving", read: "weaving", edit: "shaping", search: "searching", fetch: "searching", other: "solving",
};

function statusOf(trace: TurnTraceData, writing: boolean): { verb: string; orb: OrbState; frame?: ModeFrame } {
  // Settled, the orb is the plain sphere.
  if (!trace.active) {
    const verb = ({ interrupted: "Interrupted", failed: "Failed" } as Record<string, string>)[trace.status] || "Done";
    return { verb, orb: "working", frame: PLAIN_SPHERE };
  }
  const running = trace.segments.flatMap((segment) => segment.kind === "tool" && !segment.tool.done ? [segment.tool] : []);
  if (running.length > 1) return { verb: `Running ${running.length} tools`, orb: "solving" };
  const tool = running[0];
  if (!tool) return writing ? { verb: "Writing", orb: "composing" } : { verb: "Thinking", orb: "working" };
  if (unnamed(tool)) return { verb: "Calling a tool", orb: "solving" };
  const kind = tool.kind || "other";
  return { verb: kind === "other" ? `Using ${tool.name || "a tool"}` : KIND_VERBS[kind], orb: KIND_ORBS[kind] };
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
  for (const segment of trace.segments) {
    if (segment.kind === "tool") {
      tools.push(segment.tool);
      const line = unnamed(segment.tool) ? "" : stepLine(segment.tool, trace.active);
      if (line) latest = { text: line, markdown: false };
    } else if (segment.kind === "error") latest = thought = { text: segment.message.errorMessage || "The model request failed.", markdown: false };
    else if (segment.discarded) continue;
    else if (segment.text.trim()) latest = thought = { text: summaryOf(segment.text), markdown: true };
  }
  return { status: statusOf(trace, writing), work: workOf(tools), detail: trace.active ? latest : thought || latest };
}

/* `01s` to `59s`, then `1m 02s` -- one format, live and settled. */
function duration(ms: number): string {
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
    return Number.isNaN(start) || Number.isNaN(end) ? "" : duration(end - start);
  };
}

export function TurnTrace(props: { trace: TurnTraceData; writing?: boolean; sessionId: string | null; renderer?: MarkdownRendererId; pacing?: IncremarkPacingMode; profileLabel?: string; initialOpen?: boolean; onOpenChange?: (open: boolean) => void; toolOpen?: (id: string) => boolean; onToolOpenChange?: (id: string, open: boolean) => void; onRendered?: () => void }) {
  const preview = createMemo(() => previewOf(props.trace, Boolean(props.writing)));
  const time = turnTime(() => props.trace);
  const unfinished = () => !props.trace.active && (props.trace.status === "failed" || props.trace.status === "interrupted");
  return <Disclosure class="turn-trace" data-active={props.trace.active ? "true" : "false"} headerClass="turn-trace-header" bodyClass="turn-trace-body"
    initialOpen={props.initialOpen} onOpenChange={props.onOpenChange}
    header={<>
      {/* One box, live and settled, so nothing beside it moves when the turn
          ends. A turn that did not finish -- stopped or failed -- tints the
          orb and holds it still; a finished one's sphere turns. */}
      <span class="turn-trace-mark">
        <ThinkingOrb state={preview().status.orb} frame={preview().status.frame} paused={unfinished()} tint={unfinished() ? "var(--destructive)" : undefined} />
      </span>
      <div class="turn-trace-preview">
        {/* Two lines: what it is doing, and its latest step. The first is
            fixed slots, so the ticking time never re-renders the rest; the
            second is held open while the turn runs, so the first step to
            arrive moves nothing below. */}
        <div class="turn-trace-line">
          <span class="turn-trace-status" data-status={props.trace.status}>{preview().status.verb}</span>
          <Show when={time()}>{(text) => <span class="turn-trace-time">{"\u00a0· "}{text()}</span>}</Show>
          <Show when={preview().work}>{(text) => <span class="turn-trace-work">{"\u00a0· "}{text()}</span>}</Show>
        </div>
        <Show when={preview().detail || props.trace.active}>
          <div class="turn-trace-summary">
            {/* A tool's line is plain text -- a path's underscores are not emphasis. */}
            <Show when={preview().detail} fallback={"\u00a0"}>{(detail) =>
              <Show when={detail().markdown} fallback={detail().text}>
                <Suspense fallback={detail().text}><ChatMarkdown inline renderer={props.renderer} pacing={props.pacing}>{detail().text}</ChatMarkdown></Suspense>
              </Show>}</Show>
          </div>
        </Show>
      </div>
    </>}
    body={() => {
      // Lines there when the trace opens unfold with it; one that arrives while
      // it is open fades in with a short rise, and moves nothing above it.
      const trail = createMemo(() => trailOf(props.trace.segments));
      const opened = trail().length;
      return <Index each={trail()}>{(item, index) =>
        <div class="turn-trace-step" data-arriving={index >= opened || undefined}>
          <TrailLine item={item()} settled={!props.trace.active} sessionId={props.sessionId} renderer={props.renderer} pacing={props.pacing} profileLabel={props.profileLabel} toolOpen={props.toolOpen} onToolOpenChange={props.onToolOpenChange} onRendered={props.onRendered} />
        </div>
      }</Index>;
    }} />;
}

/* A turn before anything of it has shown: the header it will become, its orb
   connecting and its time counting, one line of space held under it for the
   step that will fill it. The trace takes its place when its first step
   arrives, in the same spot, at the same height. */
export function TraceStarting(props: { startedAt?: string }) {
  const time = turnTime(() => ({ active: true, startedAt: props.startedAt }));
  return <div class="turn-trace turn-trace-starting" data-active="true" role="status" aria-label="Starting">
    <div class="turn-trace-header">
      <span class="turn-trace-mark"><ThinkingOrb state="connecting" /></span>
      <div class="turn-trace-preview">
        <div class="turn-trace-line">
          <span class="turn-trace-status">Starting</span>
          <Show when={time()}>{(text) => <span class="turn-trace-time">{"\u00a0· "}{text()}</span>}</Show>
        </div>
        <div class="turn-trace-summary">{"\u00a0"}</div>
      </div>
    </div>
  </div>;
}
