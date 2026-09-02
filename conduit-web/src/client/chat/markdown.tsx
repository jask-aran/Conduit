import { lazy, Show, Suspense } from "solid-js";
// Both renderers draw into .chat-markdown and both render KaTeX, so the
// stylesheets belong to the dispatcher every path goes through -- not to
// whichever renderer happens to be loaded.
import "katex/dist/katex.min.css";
import "./markdown.css";
import { isIncremarkRenderer, selectedMarkdownRenderer, type MarkdownRendererId } from "./markdown-settings";
import type { IncremarkPacingMode } from "./incremark-pacing";

export { MARKDOWN_RENDERER_STORAGE_KEY, selectedMarkdownRenderer } from "./markdown-settings";
export type { MarkdownRendererId } from "./markdown-settings";

export type ChatMarkdownProps = {
  children?: string;
  streaming?: boolean;
  streamVersion?: number;
  inline?: boolean;
  onRendered?: () => void;
  pacing?: IncremarkPacingMode;
  displayKey?: string;
  renderer?: MarkdownRendererId;
};

const IncremarkMarkdown = lazy(() => import("./incremark-markdown").then((module) => ({ default: module.IncremarkMarkdown })));
const MarkedMarkdown = lazy(() => import("./marked-markdown").then((module) => ({ default: module.MarkedMarkdown })));

/**
 * The one entry point for drawing Markdown, for answers and for the inline
 * previews in a turn trace alike.
 *
 * Every renderer is loaded on demand, so a reader only ever downloads the one
 * they are actually using.
 */
export function ChatMarkdown(props: ChatMarkdownProps) {
  const renderer = () => props.renderer || selectedMarkdownRenderer();
  return <Suspense fallback={<div class="markdown-skeleton" />}>
    <Show when={isIncremarkRenderer(renderer())} fallback={<MarkedMarkdown {...props} />}>
      <IncremarkMarkdown {...props} />
    </Show>
  </Suspense>;
}
