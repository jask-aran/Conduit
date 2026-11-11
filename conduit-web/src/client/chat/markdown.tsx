import { lazy, Suspense } from "solid-js";
// The stylesheets belong to the entry point every path goes through, not to the lazily loaded renderer.
import "katex/dist/katex.min.css";
import "./markdown.css";

export type ChatMarkdownProps = {
  children?: string;
  streaming?: boolean;
  streamVersion?: number;
  inline?: boolean;
  onRendered?: () => void;
  // Only renderers that reveal after the stream ends call it.
  onSettled?: () => void;
};

const IncremarkMarkdown = lazy(() => import("./incremark-markdown").then((module) => ({ default: module.IncremarkMarkdown })));

export function ChatMarkdown(props: ChatMarkdownProps) {
  return <Suspense fallback={<div class="markdown-skeleton" />}>
    <IncremarkMarkdown {...props} />
  </Suspense>;
}
