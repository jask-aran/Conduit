import { createMemo, createSignal, Show } from "solid-js";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import type { ToolItem } from "../api/contracts";

const MAX_PREVIEW = 8_000;
const commandTools = new Set(["bash", "shell", "exec", "terminal", "run_command"]);

const scalar = (value: unknown): string | null => typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : null;

function summary(tool: ToolItem) {
  const args = tool.args && typeof tool.args === "object" ? tool.args as Record<string, unknown> : {};
  for (const key of ["path", "file", "command", "url", "query", "pattern", "name"]) {
    const value = scalar(args[key]);
    if (value) return value.length > 90 ? `…${value.slice(-89)}` : value;
  }
  for (const [key, value] of Object.entries(args)) {
    const text = scalar(value);
    if (text && !["content", "body", "text", "data"].includes(key)) return text.slice(0, 90);
  }
  return "";
}

function stringify(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2);
}

export function ToolCard(props: { tool: ToolItem; sessionId?: string | null }) {
  // Store-proxy churn during timeline reconciliation can briefly hand us an
  // undefined tool; render nothing rather than crash the boundary.
  if (!props.tool) return null;
  const [open, setOpen] = createSignal(false);
  const [loaded, setLoaded] = createSignal<unknown>(undefined);
  const [loading, setLoading] = createSignal(false);
  const [full, setFull] = createSignal(false);
  const status = createMemo(() => props.tool.error ? "Error" : props.tool.cancelled ? "Cancelled" : props.tool.done ? "Complete" : "Running");
  const source = createMemo(() => loaded() ?? props.tool.result ?? props.tool.partialResult ?? props.tool.args ?? {});
  const output = createMemo(() => stringify(source()));
  const preview = createMemo(() => {
    const text = output();
    if (full() || text.length <= MAX_PREVIEW) return text;
    return commandTools.has(String(props.tool.name || "").toLowerCase()) ? text.slice(-MAX_PREVIEW) : text.slice(0, MAX_PREVIEW);
  });

  const toggle = async () => {
    const next = !open();
    setOpen(next);
    if (!next || !props.tool.resultDeferred || loaded() !== undefined || loading() || !props.sessionId) return;
    setLoading(true);
    try {
      const response = await fetch(`/v0/sessions/${encodeURIComponent(props.sessionId)}/tools/${encodeURIComponent(props.tool.id)}`);
      if (!response.ok) throw new Error("Could not load tool output");
      const payload = await response.json() as { result?: unknown };
      setLoaded(payload.result ?? "");
    } catch (error) { setLoaded((error as Error).message); }
    finally { setLoading(false); }
  };

  return <div class="tool-card" data-status={status().toLowerCase()}>
    <Button variant="outline" class="w-full justify-start" aria-label={`${props.tool.name || "Tool"} ${status()}`} aria-expanded={open()} onClick={toggle}>
      <Show when={props.tool.done && !props.tool.error} fallback={<Spinner data-icon="inline-start" />}><CheckIcon /></Show>
      <span class="truncate">{props.tool.name || "Tool"}<Show when={summary(props.tool)}> · {summary(props.tool)}</Show></span>
      <span class="ml-auto text-xs text-muted-foreground">{status()}</span>
      <Show when={open()} fallback={<ChevronDownIcon />}><ChevronUpIcon /></Show>
    </Button>
    <Show when={open()}>
      <div class="tool-card-content">
        <pre>{loading() ? "Loading…" : preview()}</pre>
        <Show when={!loading() && output().length > MAX_PREVIEW}>
          <Button variant="ghost" size="sm" onClick={() => setFull((value) => !value)}>{full() ? "Show preview" : `Show full output · ${output().length - MAX_PREVIEW} hidden characters`}</Button>
        </Show>
      </div>
    </Show>
  </div>;
}
