import { createSignal, For, lazy, Show, Suspense } from "solid-js";
import { BrainIcon, ChevronDownIcon } from "lucide-solid";
import type { TurnTraceData } from "../turn-rows";
import { ToolCard } from "./tool-card";

const ChatMarkdown = lazy(() => import("./markdown").then((module) => ({ default: module.ChatMarkdown })));

/** Header line: anchored on the latest text (thinking or narration) so the
    preview doesn't flicker between tool names, with tool counters beside it —
    calls since that text, plus the turn total when they differ ("3 tool calls
    (5 total)"). Falls back to a neutral label before any text exists. */
function previewOf(trace: TurnTraceData): string {
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
  if (!latestText) return [trace.active ? "Thinking…" : "Thinking process", counters].filter(Boolean).join(" · ");
  const text = latestText.replace(/\s+/g, " ").trim();
  const clipped = text.length > 120 ? `…${text.slice(-120)}` : text;
  return [clipped, counters].filter(Boolean).join(" · ");
}

export function TurnTrace(props: { trace: TurnTraceData; sessionId: string | null }) {
  const [open, setOpen] = createSignal(false);
  return <div class="turn-trace" data-active={props.trace.active ? "true" : "false"}>
    <button type="button" class="turn-trace-header" aria-expanded={open()} onClick={() => setOpen(!open())}>
      <BrainIcon />
      <span class="turn-trace-preview">{previewOf(props.trace)}</span>
      <ChevronDownIcon class="turn-trace-chevron" data-open={open() ? "true" : "false"} />
    </button>
    <Show when={open()}>
      <div class="turn-trace-body">
        <For each={props.trace.segments}>{(segment) => {
          if (segment.kind === "tool") return segment.tool ? <ToolCard tool={segment.tool} sessionId={props.sessionId} /> : null;
          return <div class="turn-trace-text" data-kind={segment.kind}>
            <Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={segment.id === "thinking:live"}>{segment.text}</ChatMarkdown></Suspense>
          </div>;
        }}</For>
      </div>
    </Show>
  </div>;
}
