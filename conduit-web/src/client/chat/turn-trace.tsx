import { createEffect, createMemo, createSignal, Index, lazy, onCleanup, Show, Suspense } from "solid-js";
import { BrainIcon, TriangleAlertIcon } from "lucide-solid";
import type { Message, ToolItem, ToolKind } from "../api/contracts";
import type { TraceSegment, TurnTraceData } from "../turn-rows";
import { ToolCard } from "./tool-card";
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

function TraceSegmentRow(props: {
  onRendered?: () => void;
  segment: () => TraceSegment;
  sessionId: string | null;
  renderer?: MarkdownRendererId;
  pacing?: IncremarkPacingMode;
  profileLabel?: string;
  toolOpen?: (id: string) => boolean;
  onToolOpenChange?: (id: string, open: boolean) => void;
  settled?: boolean;
}) {
  const tool = () => {
    const segment = props.segment();
    return segment.kind === "tool" ? segment.tool : null;
  };
  const error = () => {
    const segment = props.segment();
    return segment.kind === "error" ? segment.message : null;
  };
  const text = () => {
    const segment = props.segment();
    return segment.kind === "thinking" || segment.kind === "narration" ? segment.text : "";
  };
  const live = () => {
    const segment = props.segment();
    return segment.kind === "thinking" || segment.kind === "narration" ? Boolean(segment.live) : false;
  };
  // Text the model was cut off mid-way through and is not being given back to
  // it. Struck through where it sits rather than collapsed: it is already
  // behind the trace rollup, and folding it away a second time would just lose
  // work the reader watched happen.
  const discarded = () => {
    const segment = props.segment();
    return (segment.kind === "thinking" || segment.kind === "narration") && segment.discarded === true;
  };
  return <Show when={tool()} fallback={
    <Show when={error()} fallback={
      <div class="turn-trace-text" data-kind={props.segment().kind} data-discarded={discarded() ? "true" : undefined}
        title={discarded() ? "Interrupted — the agent has no record of this" : undefined}>
        {/* The loss is this step's, so it says so here rather than on the turn. */}
        <Show when={discarded()}><span class="turn-trace-not-kept">Not kept</span></Show>
        <Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={live()} renderer={props.renderer} pacing={props.pacing} onRendered={props.onRendered}>{text()}</ChatMarkdown></Suspense>
      </div>
    }>
      {(message) => <TraceError message={message()} profileLabel={props.profileLabel} />}
    </Show>
  }>
    {(item) => <ToolCard tool={item()} settled={props.settled} sessionId={props.sessionId} initialOpen={props.toolOpen?.(item().toolCallId)} onOpenChange={(open) => props.onToolOpenChange?.(item().toolCallId, open)} />}
  </Show>;
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
function workOf(tools: ToolItem[]): string {
  const counts = new Map<ToolKind, number>();
  for (const tool of tools) counts.set(tool.kind || "other", (counts.get(tool.kind || "other") || 0) + 1);
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
function statusOf(trace: TurnTraceData, writing: boolean): string {
  if (!trace.active) return ({ interrupted: "Interrupted", failed: "Failed" } as Record<string, string>)[trace.status] || "Done";
  const running = trace.segments.flatMap((segment) => segment.kind === "tool" && !segment.tool.done ? [segment.tool] : []);
  if (running.length > 1) return `Running ${running.length} tools`;
  const tool = running[0];
  if (!tool) return writing ? "Writing" : "Thinking";
  const kind = tool.kind || "other";
  return kind === "other" ? `Using ${tool.name || "a tool"}` : KIND_VERBS[kind];
}

/* A tool's line: what it acted on, a search's in quotes, a long path from its
   end, since the file is the part worth reading. */
function toolLine(tool: ToolItem): string {
  const subject = tool.subject || "";
  if (tool.kind === "search") return `\u201c${subject}\u201d`;
  return subject.length > 80 && (tool.kind === "read" || tool.kind === "edit") ? `\u2026${subject.slice(-79)}` : subject;
}

/* The second line is the latest step: live, whichever came last of the
   thinking and a tool that says what it acted on; settled, the last thinking,
   which is what the turn concluded. Discarded text is that one step's loss, not
   the turn's, so it is passed over. */
type Detail = { text: string; markdown: boolean };
function previewOf(trace: TurnTraceData, writing: boolean): { status: string; work: string; detail: Detail | null } {
  let detail: Detail | null = null;
  const tools: ToolItem[] = [];
  for (const segment of trace.segments) {
    if (segment.kind === "tool") {
      tools.push(segment.tool);
      if (trace.active && segment.tool.subject) detail = { text: toolLine(segment.tool), markdown: false };
    } else if (segment.kind === "error") detail = { text: segment.message.errorMessage || "The model request failed.", markdown: false };
    else if (segment.discarded) continue;
    else if (segment.text.trim()) detail = { text: summaryOf(segment.text), markdown: true };
  }
  return { status: statusOf(trace, writing), work: workOf(tools), detail };
}

/* `01s` to `59s`, then `1m 02s` -- one format, live and settled. */
function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const pad = (value: number) => String(value).padStart(2, "0");
  return seconds < 60 ? `${pad(seconds)}s` : `${Math.floor(seconds / 60)}m ${pad(seconds % 60)}s`;
}

/* A live turn counts up from its prompt each second; a settled one is the time
   from its prompt to its last reply. Nothing when either end is unknown. */
function turnTime(trace: () => TurnTraceData) {
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
  return <Disclosure class="turn-trace" data-active={props.trace.active ? "true" : "false"} headerClass="turn-trace-header" bodyClass="turn-trace-body"
    initialOpen={props.initialOpen} onOpenChange={props.onOpenChange}
    header={<>
      <BrainIcon />
      <div class="turn-trace-preview">
        {/* Two lines: what it is doing, and its latest step. The first is
            fixed slots, so the ticking time never re-renders the rest; the
            second is held open while the turn runs, so the first step to
            arrive moves nothing below. */}
        <div class="turn-trace-line">
          <span class="turn-trace-status" data-status={props.trace.status}>{preview().status}</span>
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
      // Steps there when the trace opens unfold with it; one that arrives while
      // it is open fades in with a short rise, and moves nothing above it.
      const opened = props.trace.segments.length;
      return <Index each={props.trace.segments}>{(segment, index) =>
        <div class="turn-trace-step" data-arriving={index >= opened || undefined}>
          <TraceSegmentRow segment={segment} settled={!props.trace.active} sessionId={props.sessionId} renderer={props.renderer} pacing={props.pacing} profileLabel={props.profileLabel} toolOpen={props.toolOpen} onToolOpenChange={props.onToolOpenChange} onRendered={props.onRendered} />
        </div>
      }</Index>;
    }} />;
}
