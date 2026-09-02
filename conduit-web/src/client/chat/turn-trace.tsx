import { createSignal, Index, lazy, Show, Suspense } from "solid-js";
import { BrainIcon, ChevronDownIcon, TriangleAlertIcon } from "lucide-solid";
import type { Message } from "../api/contracts";
import type { TraceSegment, TurnTraceData } from "../turn-rows";
import { ToolCard } from "./tool-card";
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
  return <Show when={tool()} fallback={
    <Show when={error()} fallback={
      <div class="turn-trace-text" data-kind={props.segment().kind}>
        <Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={live()} renderer={props.renderer} pacing={props.pacing} onRendered={props.onRendered}>{text()}</ChatMarkdown></Suspense>
      </div>
    }>
      {(message) => <TraceError message={message()} profileLabel={props.profileLabel} />}
    </Show>
  }>
    {(item) => <ToolCard tool={item()} sessionId={props.sessionId} />}
  </Show>;
}

/** Header line: anchored on the latest text (thinking or narration) so the
    preview doesn't flicker between tool names, with tool counters beside it —
    calls since that text, plus the turn total when they differ ("3 tool calls
    (5 total)"). Falls back to a neutral label before any text exists. */
function previewOf(trace: TurnTraceData): { text: string; counters: string } {
  let latestText: string | null = null;
  let callsAfterText = 0;
  let totalCalls = 0;
  for (const segment of trace.segments) {
    if (segment.kind === "tool") { totalCalls += 1; callsAfterText += 1; }
    else if (segment.kind === "error") {
      latestText = `Request failed · ${segment.message.errorMessage || "The model request failed."}`;
      callsAfterText = 0;
    }
    else { latestText = segment.text; callsAfterText = 0; }
  }
  const shown = callsAfterText || totalCalls;
  const counters = totalCalls > 0
    ? `${shown} tool call${shown === 1 ? "" : "s"}${totalCalls > shown ? ` (${totalCalls} total)` : ""}`
    : "";
  if (!latestText) return { text: trace.active ? "Thinking…" : "Thinking process", counters };
  const text = latestText.replace(/\s+/g, " ").trim();
  const clipped = text.length > 120 ? `…${text.slice(-120)}` : text;
  return { text: clipped, counters };
}

export function TurnTrace(props: { trace: TurnTraceData; sessionId: string | null; renderer?: MarkdownRendererId; pacing?: IncremarkPacingMode; profileLabel?: string; onRendered?: () => void }) {
  const [open, setOpen] = createSignal(false);
  return <div class="turn-trace" data-active={props.trace.active ? "true" : "false"}>
    <button type="button" class="turn-trace-header" aria-expanded={open()} onClick={() => setOpen(!open())}>
      <BrainIcon />
      <div class="turn-trace-preview">
        <Suspense fallback={<span>{previewOf(props.trace).text}</span>}><ChatMarkdown inline renderer={props.renderer} pacing={props.pacing}>{previewOf(props.trace).text}</ChatMarkdown></Suspense>
        <Show when={previewOf(props.trace).counters}><span class="turn-trace-counter"> · {previewOf(props.trace).counters}</span></Show>
      </div>
      <ChevronDownIcon class="turn-trace-chevron" data-open={open() ? "true" : "false"} />
    </button>
    <Show when={open()}>
      <div class="turn-trace-body">
          <Index each={props.trace.segments}>{(segment) =>
          <TraceSegmentRow segment={segment} sessionId={props.sessionId} renderer={props.renderer} pacing={props.pacing} profileLabel={props.profileLabel} onRendered={props.onRendered} />
        }</Index>
      </div>
    </Show>
  </div>;
}
