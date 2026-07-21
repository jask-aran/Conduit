import { lazy, Suspense, useEffect, useState } from "react";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { getToolRenderer, registerTimelineItemRenderer, setDefaultToolRenderer } from "./tool-registry.js";
import { prettyPrintValue, summarizeTool } from "./tool-summary.js";

// Same lazy convention as chat-thread.jsx's ChatMarkdown: the JSON
// pretty-printer pulls in the shared shiki-highlight.js singleton, so it
// only loads once a section is actually expanded.
const ToolJsonBlock = lazy(() => import("./tool-json-block.jsx"));

function ExpandableSection({ label, value, tone }) {
  const [open, setOpen] = useState(false);
  if (value == null || value === "") return null;
  const isJson = typeof value !== "string";
  const pretty = prettyPrintValue(value);
  return <Collapsible open={open} onOpenChange={setOpen} className="tool-card-section">
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="sm" className="w-full justify-start gap-1.5 text-xs text-muted-foreground">
        {open ? <ChevronUpIcon data-icon="inline-start" className="size-3.5" /> : <ChevronDownIcon data-icon="inline-start" className="size-3.5" />}
        {label}
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div className={cn("tool-card-value", tone === "destructive" && "rounded-md border border-destructive/50 bg-destructive/10 p-2")}>
        {isJson
          ? <Suspense fallback={<pre className="overflow-x-auto whitespace-pre-wrap break-words p-2 text-xs">{pretty}</pre>}>
              <ToolJsonBlock code={pretty} />
            </Suspense>
          : <pre className="overflow-x-auto whitespace-pre-wrap break-words p-2 text-xs">{pretty}</pre>}
      </div>
    </CollapsibleContent>
  </Collapsible>;
}

/**
 * Generic tool-call card v2 — the fallback renderer for any tool name with
 * no bespoke card registered in tool-registry.js. Header shows a one-line
 * smart summary (`name(args…)`) plus live status (pending→running→done/
 * error); args and result are separately collapsed sections, pretty
 * printed as JSON via a lazy Shiki highlighter when they aren't plain text.
 */
export function ToolCard({ tool, sessionId }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState(tool.result);
  const [loading, setLoading] = useState(false);

  // Deferred result fetch, preserved verbatim from the v1 card: large
  // results are omitted from the initial session payload and lazy-fetched
  // from GET /v0/sessions/:id/tools/:toolId on first expand.
  useEffect(() => {
    if (tool.result != null) setResult(tool.result);
  }, [tool.result]);
  useEffect(() => {
    if (!open || !tool.resultDeferred || result != null || loading || !sessionId) return;
    setLoading(true);
    fetch(`/v0/sessions/${encodeURIComponent(sessionId)}/tools/${encodeURIComponent(tool.id)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load tool output")))
      .then((payload) => setResult(payload.result || ""))
      .catch(() => setResult("Could not load tool output"))
      .finally(() => setLoading(false));
  }, [loading, open, result, sessionId, tool.id, tool.resultDeferred]);

  const status = tool.error ? "Error" : tool.cancelled ? "Cancelled" : tool.done ? "Complete" : "Running";
  const summary = summarizeTool(tool);
  const resultValue = loading ? null : (result != null ? result : tool.partialResult);

  return <Collapsible open={open} onOpenChange={setOpen} className="tool-card">
    <CollapsibleTrigger asChild>
      <Button
        variant="outline"
        className="w-full justify-start gap-2"
        data-state={tool.error ? "error" : tool.done ? "done" : "running"}
      >
        {tool.error ? <XIcon data-icon="inline-start" className="size-3.5 text-destructive" />
          : tool.done ? <CheckIcon data-icon="inline-start" className="size-3.5" />
          : <Spinner data-icon="inline-start" className="size-3.5" />}
        <span className="truncate font-mono text-sm">{summary}</span>
        <span className={cn("ml-auto text-xs", tool.error ? "text-destructive" : "text-muted-foreground")}>{status}</span>
        {open ? <ChevronUpIcon data-icon="inline-end" /> : <ChevronDownIcon data-icon="inline-end" />}
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent className="tool-card-body space-y-1 pt-1">
      <ExpandableSection label="Arguments" value={tool.args} />
      <ExpandableSection
        label={loading ? "Result (loading…)" : "Result"}
        value={resultValue}
        tone={tool.error ? "destructive" : undefined}
      />
    </CollapsibleContent>
  </Collapsible>;
}

function ToolTimelineItem({ item, sessionId }) {
  const Renderer = getToolRenderer(item.value.name);
  return <Renderer tool={item.value} sessionId={sessionId} />;
}

// Registered at module load (static import from chat-thread.jsx), matching
// the plain-objects-populated-at-load convention in tool-registry.js.
setDefaultToolRenderer(ToolCard);
registerTimelineItemRenderer("tool", ToolTimelineItem);
