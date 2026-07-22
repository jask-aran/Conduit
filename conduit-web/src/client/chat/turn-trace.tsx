import { createSignal, For, lazy, Show, Suspense } from "solid-js";
import { BrainIcon, ChevronDownIcon } from "lucide-solid";
import { Spinner } from "@/components/primitives";
import type { TurnTraceData } from "../turn-rows";
import { ToolCard } from "./tool-card";

const ChatMarkdown = lazy(() => import("./markdown").then((module) => ({ default: module.ChatMarkdown })));

/** Header line: while the turn runs, preview the latest trace item verbatim
    (tool name or the tail of the thinking text); settled turns stay neutral. */
function previewOf(trace: TurnTraceData): string {
  if (!trace.active) return "Thinking process";
  const last = trace.segments[trace.segments.length - 1];
  if (!last) return "Thinking…";
  if (last.kind === "tool") return last.tool.done ? (last.tool.name || "tool") : `${last.tool.name || "tool"}…`;
  const text = last.text.replace(/\s+/g, " ").trim();
  return text.length > 120 ? `…${text.slice(-120)}` : text;
}

export function TurnTrace(props: { trace: TurnTraceData; sessionId: string | null }) {
  const [open, setOpen] = createSignal(false);
  return <div class="turn-trace" data-active={props.trace.active ? "true" : "false"}>
    <button type="button" class="turn-trace-header" aria-expanded={open()} onClick={() => setOpen(!open())}>
      {props.trace.active ? <Spinner /> : <BrainIcon />}
      <span class="turn-trace-preview">{previewOf(props.trace)}</span>
      <ChevronDownIcon class="turn-trace-chevron" data-open={open() ? "true" : "false"} />
    </button>
    <Show when={open()}>
      <div class="turn-trace-body">
        <For each={props.trace.segments}>{(segment) => {
          if (segment.kind === "tool") return <ToolCard tool={segment.tool} sessionId={props.sessionId} />;
          return <div class="turn-trace-text" data-kind={segment.kind}>
            <Suspense fallback={<div class="markdown-skeleton" />}><ChatMarkdown streaming={segment.id === "thinking:live"}>{segment.text}</ChatMarkdown></Suspense>
          </div>;
        }}</For>
      </div>
    </Show>
  </div>;
}
