import { createMemo, createSignal, Show } from "solid-js";
import { CheckIcon, MinusIcon, XIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import type { ToolItem } from "../api/contracts";
import { httpUrl } from "../api/transport";
import { authorizedFetch } from "../api/native-auth-client";
import { Disclosure } from "./disclosure";

const MAX_PREVIEW = 8_000;
const commandTools = new Set(["bash", "shell", "exec", "terminal", "run_command"]);

const scalar = (value: unknown): string | null => typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : null;

function summary(tool: ToolItem) {
  // What the adapter says it acted on, where it says; the guess below is for a
  // tool it does not name.
  if (tool.subject) return tool.subject.length > 90 ? `…${tool.subject.slice(-89)}` : tool.subject;
  const args = tool.input && typeof tool.input === "object" ? tool.input as Record<string, unknown> : {};
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

export function ToolCard(props: { tool?: ToolItem; sessionId?: string | null; initialOpen?: boolean; onOpenChange?: (open: boolean) => void; settled?: boolean }) {
  const [loaded, setLoaded] = createSignal<unknown>(undefined);
  const [loading, setLoading] = createSignal(false);
  const [full, setFull] = createSignal(false);
  const tool = createMemo(() => props.tool);
  const status = createMemo(() => {
    const current = tool();
    // A tool a stop cut off says so (`cancelled`); one its turn ended without
    // answering is not still running either. Both went with the turn.
    if (current?.isError) return "Error";
    if (current?.cancelled) return "Interrupted";
    if (current?.done) return "Complete";
    return props.settled ? "Interrupted" : "Running";
  });
  const source = createMemo(() => {
    const current = tool();
    return loaded() ?? current?.output ?? current?.input ?? {};
  });
  const output = createMemo(() => stringify(source()));
  const preview = createMemo(() => {
    const text = output();
    if (full() || text.length <= MAX_PREVIEW) return text;
    return commandTools.has(String(tool()?.name || "").toLowerCase()) ? text.slice(-MAX_PREVIEW) : text.slice(0, MAX_PREVIEW);
  });

  // Output a reload left on the server is fetched the first time it is opened.
  const load = async () => {
    const current = tool();
    if (!current?.outputDeferred || loaded() !== undefined || loading() || !props.sessionId) return;
    setLoading(true);
    try {
      const response = await authorizedFetch(httpUrl(`/v0/sessions/${encodeURIComponent(props.sessionId)}/tools/${encodeURIComponent(current.toolCallId)}`));
      if (!response.ok) throw new Error("Could not load tool output");
      const payload = await response.json() as { output?: unknown };
      setLoaded(payload.output ?? "");
    } catch (error) { setLoaded((error as Error).message); }
    finally { setLoading(false); }
  };

  return <Show when={tool()}>{(current) => <Disclosure class="tool-card" data-status={status().toLowerCase()}
    trigger={Button} triggerProps={{ variant: "outline" }} headerClass="w-full justify-start" bodyClass="tool-card-content"
    label={`${current().name || "Tool"} ${status()}`}
    initialOpen={props.initialOpen} onOpenChange={(next) => { props.onOpenChange?.(next); if (next) void load(); }}
    header={<>
      {status() === "Running" ? <Spinner data-icon="inline-start" /> : status() === "Complete" ? <CheckIcon /> : status() === "Error" ? <XIcon /> : <MinusIcon />}
      <span class="truncate">{current().name || "Tool"}<Show when={summary(current())}> · {summary(current())}</Show></span>
      <span class="ml-auto text-xs text-muted-foreground">{status()}</span>
    </>}
    body={() => <>
      <pre>{loading() ? "Loading…" : preview()}</pre>
      <Show when={!loading() && output().length > MAX_PREVIEW}>
        <Button variant="ghost" size="sm" onClick={() => setFull((value) => !value)}>{full() ? "Show preview" : `Show full output · ${output().length - MAX_PREVIEW} hidden characters`}</Button>
      </Show>
    </>} />}</Show>;
}
