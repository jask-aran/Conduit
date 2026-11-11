import names from "virtual:ui-pieces";
import { createSignal, onMount, Show } from "solid-js";
import { FeedbackTool, httpTransport, type FeedbackHost, type FeedbackMode } from "@/components/feedback";
import { Button } from "@/components/ui";
import { toast } from "@/components/ui/notifications";
import { TextEditor } from "@/components/ui/text-editor";
import { api } from "../api/client";

/*
 * /document: a scratchpad to try the markup tool's live delivery against a document instead of the interface. It is
 * temporary and has no place in the app's navigation: one page of Markdown kept in this browser, with the tool over it
 * declaring live first. Each comment goes to the listening session as it is Done, carrying the text as it then was.
 */
const KEY = "conduit:document-scratch";
const START = "# Scratchpad\n\nWrite here, then mark it up: drag across text with Select text, press Done, and the listening session is handed the comment with this text.\n";
const client = `document-${Math.random().toString(36).slice(2, 10)}`;

export default function DocumentScratch(props: { onReady: () => void }) {
  const [text, setText] = createSignal((() => { try { return localStorage.getItem(KEY) ?? START; } catch { return START; } })());
  const write = (value: string) => { setText(value); try { localStorage.setItem(KEY, value); } catch { /* this visit only */ } };
  const [mode, setMode] = createSignal<FeedbackMode | null>("use");
  const host: FeedbackHost = {
    names,
    capabilities: { deliveries: ["live", "batched"], tools: ["quote", "highlight", "pen", "shape", "text", "erase", "note"], screenshot: false },
    transport: httpTransport(api),
    clientId: () => client,
    client: () => ({ kind: "document" }),
    subject: () => ({ kind: "document", name: "Scratchpad", format: "markdown", text: text() }),
    notify: (outcome, message) => outcome === "sent" ? toast.success(message) : toast.error(message),
  };
  onMount(props.onReady);
  return <>
    <TextEditor fill label="Scratchpad" value={text()} onChange={write} head={<Button variant="ghost" size="sm" aria-pressed={mode() !== null} onClick={() => setMode(mode() ? null : "select")}>Mark up</Button>} />
    <Show when={mode()}>{(now) => <FeedbackTool host={host} mode={now()} onMode={setMode} onClose={() => setMode(null)} />}</Show>
  </>;
}
