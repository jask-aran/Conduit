// Lazy leaf: the tool-card's expanded args/result JSON pretty-printer.
// Reuses the ai-elements CodeBlockContent (and its shared shiki-highlight.js
// singleton) rather than a second highlighter — this module is only ever
// reached via `lazy(() => import(...))` from tool-card.jsx, on expand.
import { CodeBlockContent } from "@/components/ai-elements/code-block";

export default function ToolJsonBlock({ code }) {
  return <CodeBlockContent code={code} language="json" showLineNumbers={false} />;
}
