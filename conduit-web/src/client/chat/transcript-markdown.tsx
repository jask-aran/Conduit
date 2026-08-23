import { lazy, Show, Suspense } from "solid-js";
import { ChatMarkdown, type ChatMarkdownProps } from "./markdown";
import type { MarkdownRendererId } from "./markdown-settings";
import type { TranscriptRendererMode } from "./transcript-renderer";

const IncremarkAdvancedMarkdown = lazy(() => import("./incremark-advanced").then((module) => ({ default: module.IncremarkAdvancedMarkdown })));

export type TranscriptMarkdownProps = Omit<ChatMarkdownProps, "renderer"> & {
  renderer: TranscriptRendererMode;
};

/**
 * Preserve the original renderer path for every pre-Advanced option. The
 * selector wrapper adds no alternate parser, typewriter, sizing or lazy-render
 * layer in front of Marked/Immediate/Typewriter/Synthetic. Only Advanced
 * crosses the new component boundary.
 */
export function TranscriptMarkdown(props: TranscriptMarkdownProps) {
  const advanced = () => props.renderer === "incremark-advanced";
  const baseRenderer = (): MarkdownRendererId => advanced()
    ? "incremark-synthetic"
    : props.renderer as MarkdownRendererId;

  return <Show when={advanced()} fallback={
    <ChatMarkdown
      renderer={baseRenderer()}
      typewriter={baseRenderer() === "incremark-typewriter" || baseRenderer() === "incremark-synthetic"}
      syntheticMath={baseRenderer() === "incremark-synthetic"}
      displayKey={props.displayKey}
      streaming={props.streaming}
      streamVersion={props.streamVersion}
      inline={props.inline}
      onRendered={props.onRendered}
    >{props.children || ""}</ChatMarkdown>
  }>
    <Suspense fallback={<div class="markdown-skeleton" />}>
      <IncremarkAdvancedMarkdown
        renderer="incremark-synthetic"
        displayKey={props.displayKey}
        streaming={props.streaming}
        streamVersion={props.streamVersion}
        inline={props.inline}
        onRendered={props.onRendered}
      >{props.children || ""}</IncremarkAdvancedMarkdown>
    </Suspense>
  </Show>;
}
