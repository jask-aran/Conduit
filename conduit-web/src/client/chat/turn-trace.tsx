import { createSignal, Index, lazy, Show, Suspense } from "solid-js";
import { BrainIcon, ChevronDownIcon } from "lucide-solid";
import type { TurnTraceData } from "../turn-rows";
import { ToolCard } from "./tool-card";

const ChatMarkdown = lazy(() => import("./markdown").then((module) => ({ default: module.ChatMarkdown })));

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

export function TurnTrace(props: { trace: TurnTraceData; sessionId: string | null }) {
  const [open, setOpen] = createSignal(false);
  return <div class="turn-trace" data-active={props.trace.active ? "true" : "false"}>
    <button type="button" class="turn-trace-header" aria-expanded={open()} onClick={() => setOpen(!open())}>
      <BrainIcon />
      <div class="turn-trace-preview">
        <Suspense fallback={<span>{previewOf(props.trace).text}</span>}><ChatMarkdown inline>{previewOf(props.trace).text}</ChatMarkdown></Suspense>
        <Show when={previewOf(props.trace).counters}><span class="turn-trace-counter"> · {previewOf(props.trace).counters}</span></Show>
      </div>
      <ChevronDownIcon class="turn-trace-chevron" data-open={open() ? "true" : "false"} />
    </button>
    <Show when={open()}>
      <div class="turn-trace-body">
        <Index each={props.trace.segments}>{(segment) => {
          const tool = () => { const value = segment(); return value.kind === "tool" ? value.tool : null; };
          const text = () => { const value = segment(); return value.kind === "tool" ? "" : value.text; };
          const live = () => { const value = segment(); return value.kind === "thinking" && Boolean(value.live); };
          if (tool()) return <ToolCard tool={tool()!} sessionId={props.sessionId} />;
          return <div class="turn-trace-text" data-kind={segment().kind}>
            <Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={live()}>{text()}</ChatMarkdown></Suspense>
          </div>;
        }}</Index>
      </div>
    </Show>
  </div>;
}
