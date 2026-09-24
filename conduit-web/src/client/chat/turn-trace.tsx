import { createMemo, For, Index, lazy, Show, Suspense } from "solid-js";
import { BrainIcon, TriangleAlertIcon } from "lucide-solid";
import type { Message } from "../api/contracts";
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
 * The header reads status, then tool calls, then a summary -- the summary last,
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

function previewOf(trace: TurnTraceData): { status: string | null; counters: string; summary: string } {
  let summary = "";
  let callsAfterText = 0;
  let totalCalls = 0;
  let latestTool: string | undefined;
  for (const segment of trace.segments) {
    if (segment.kind === "tool") { totalCalls += 1; callsAfterText += 1; latestTool = segment.tool.name; }
    else if (segment.kind === "error") { summary = segment.message.errorMessage || "The model request failed."; callsAfterText = 0; }
    else if (segment.text.trim()) { summary = summaryOf(segment.text); callsAfterText = 0; }
  }
  const shown = callsAfterText || totalCalls;
  const counters = totalCalls > 0
    ? `${shown} tool call${shown === 1 ? "" : "s"}${totalCalls > shown ? ` (${totalCalls} total)` : ""}`
    : "";
  return { status: statusLabel(trace.status, latestTool), counters, summary };
}

/* Only what is not the normal ending gets a word: a finished turn is just its
   summary, so an interrupted or failed one stands out beside it. */
const statusLabel = (status: TurnTraceData["status"], tool?: string) => ({
  thinking: "Thinking",
  executing_tool: tool ? `Running ${tool}` : "Running a tool",
  interrupted: "Interrupted",
  complete: null,
  failed: "Failed",
})[status];

export function TurnTrace(props: { trace: TurnTraceData; sessionId: string | null; renderer?: MarkdownRendererId; pacing?: IncremarkPacingMode; profileLabel?: string; initialOpen?: boolean; onOpenChange?: (open: boolean) => void; toolOpen?: (id: string) => boolean; onToolOpenChange?: (id: string, open: boolean) => void; onRendered?: () => void }) {
  const preview = createMemo(() => previewOf(props.trace));
  const parts = createMemo(() => {
    const { status, counters, summary } = preview();
    const list: { kind: "status" | "counter" | "summary"; text: string }[] = [];
    if (status) list.push({ kind: "status", text: status });
    if (counters) list.push({ kind: "counter", text: counters });
    if (summary) list.push({ kind: "summary", text: summary });
    if (!list.length) list.push({ kind: "summary", text: "Thinking process" });
    return list;
  });
  return <Disclosure class="turn-trace" data-active={props.trace.active ? "true" : "false"} headerClass="turn-trace-header" bodyClass="turn-trace-body"
    initialOpen={props.initialOpen} onOpenChange={props.onOpenChange}
    header={<>
      <BrainIcon />
      <div class="turn-trace-preview">
        <For each={parts()}>{(part, index) => <span class={`turn-trace-${part.kind}`} data-status={part.kind === "status" ? props.trace.status : undefined}>
          {index() ? " · " : ""}
          <Show when={part.kind === "summary"} fallback={part.text}>
            <Suspense fallback={part.text}><ChatMarkdown inline renderer={props.renderer} pacing={props.pacing}>{part.text}</ChatMarkdown></Suspense>
          </Show>
        </span>}</For>
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
