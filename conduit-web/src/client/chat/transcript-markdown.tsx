import { lazy, Show, Suspense } from "solid-js";
import type { ChatMarkdownProps } from "./markdown";
import type { MarkdownRendererId } from "./markdown-settings";
import type { TranscriptRendererMode } from "./transcript-renderer";

const ChatMarkdown = lazy(() => import("./markdown").then((module) => ({ default: module.ChatMarkdown })));
const IncremarkAdvancedMarkdown = lazy(() => import("./incremark-advanced").then((module) => ({ default: module.IncremarkAdvancedMarkdown })));

export type TranscriptMarkdownProps = Omit<ChatMarkdownProps, "renderer"> & {
  renderer: TranscriptRendererMode;
};

/**
 * Renderer selection is deliberately stateless with respect to a Generation.
 * A newly mounted renderer always receives the complete latest source plus the
 * current streaming flag. Marked/Immediate render that state immediately;
 * Typewriter/Synthetic/Advanced use the shared adaptive Incremark backlog path
 * to catch up, then continue from the same live source without special replay
 * or seed semantics. This is the same contract used after tab/session attach.
 */
export function TranscriptMarkdown(props: TranscriptMarkdownProps) {
  const advanced = () => props.renderer === "incremark-advanced";
  const baseRenderer = (): MarkdownRendererId => advanced()
    ? "incremark-synthetic"
    : props.renderer as MarkdownRendererId;

  const common = () => ({
    displayKey: props.displayKey,
    streamVersion: props.streamVersion,
    inline: props.inline,
    onRendered: props.onRendered,
    streaming: props.streaming,
  });

  return <Suspense fallback={<div class="markdown-skeleton" />}>
    <Show when={advanced()} fallback={
      <ChatMarkdown
        {...common()}
        renderer={baseRenderer()}
        typewriter={baseRenderer() === "incremark-typewriter" || baseRenderer() === "incremark-synthetic"}
        syntheticMath={baseRenderer() === "incremark-synthetic"}
      >{props.children || ""}</ChatMarkdown>
    }>
      <IncremarkAdvancedMarkdown
        {...common()}
        renderer="incremark-synthetic"
      >{props.children || ""}</IncremarkAdvancedMarkdown>
    </Show>
  </Suspense>;
}
