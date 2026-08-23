import { createRenderEffect, createSignal, lazy, onCleanup, Show, Suspense } from "solid-js";
import type { ChatMarkdownProps } from "./markdown";
import type { MarkdownRendererId } from "./markdown-settings";
import type { TranscriptRendererMode } from "./transcript-renderer";

const ChatMarkdown = lazy(() => import("./markdown").then((module) => ({ default: module.ChatMarkdown })));
const IncremarkAdvancedMarkdown = lazy(() => import("./incremark-advanced").then((module) => ({ default: module.IncremarkAdvancedMarkdown })));

const usesTypewriter = (renderer: TranscriptRendererMode) =>
  renderer === "incremark-typewriter"
  || renderer === "incremark-synthetic"
  || renderer === "incremark-advanced";

export type TranscriptMarkdownProps = Omit<ChatMarkdownProps, "renderer" | "streaming"> & {
  renderer: TranscriptRendererMode;
  streaming?: boolean;
};

/**
 * A renderer can mount while a Generation is already in flight: renderer A/B
 * switching, tab restoration, reconnect, or session reattachment all do this.
 * The accumulated source is state, not new output, so seed it as the initial
 * non-streaming baseline for one frame and animate only deltas received after
 * attachment. Typewriter, Synthetic and Advanced therefore share identical
 * catch-up semantics instead of replaying an existing answer from character 0.
 */
export function TranscriptMarkdown(props: TranscriptMarkdownProps) {
  const [attached, setAttached] = createSignal(false);
  let attachFrame: number | null = null;
  let previousRenderer: TranscriptRendererMode | null = null;
  let previousStreaming: boolean | null = null;

  const cancelAttachFrame = () => {
    if (attachFrame == null) return;
    cancelAnimationFrame(attachFrame);
    attachFrame = null;
  };

  createRenderEffect(() => {
    const renderer = props.renderer;
    const streaming = Boolean(props.streaming);
    if (renderer === previousRenderer && streaming === previousStreaming) return;
    previousRenderer = renderer;
    previousStreaming = streaming;
    cancelAttachFrame();
    if (!streaming || !usesTypewriter(renderer)) {
      setAttached(true);
      return;
    }
    setAttached(false);
    attachFrame = requestAnimationFrame(() => {
      attachFrame = null;
      setAttached(true);
    });
  });

  onCleanup(cancelAttachFrame);

  const effectiveStreaming = () => Boolean(props.streaming)
    && (!usesTypewriter(props.renderer) || attached());
  const advanced = () => props.renderer === "incremark-advanced";
  const baseRenderer = (): MarkdownRendererId => advanced()
    ? "incremark-synthetic"
    : props.renderer as MarkdownRendererId;

  return <Suspense fallback={<div class="markdown-skeleton" />}>
    <Show when={advanced()} fallback={
      <ChatMarkdown
        {...props}
        renderer={baseRenderer()}
        streaming={effectiveStreaming()}
        typewriter={baseRenderer() === "incremark-typewriter" || baseRenderer() === "incremark-synthetic"}
        syntheticMath={baseRenderer() === "incremark-synthetic"}
      />
    }>
      <IncremarkAdvancedMarkdown
        {...props}
        streaming={effectiveStreaming()}
      />
    </Show>
  </Suspense>;
}
