import names from "virtual:ui-pieces";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { FeedbackTool, httpTransport, type FeedbackHost, type FeedbackMode } from "@/components/feedback";
import { Button } from "@/components/ui";
import { toast } from "@/components/ui/notifications";
import { TextEditor } from "@/components/ui/text-editor";
import { api } from "../api/client";
import { capturePage } from "../feedback/conduit-feedback";

/*
 * /document: a scratchpad to try the markup tool against a document instead of the interface. It is temporary and has
 * no place in the app's navigation: one page of Markdown, a file on the hub (server/document-scratch.js), with the tool
 * over it offering Send now. A comment carries the text as it then was and the file's path, so the session it is handed
 * to can write in the file; what is written there shows here.
 */
type Kept = { file: string; text: string | null; version: number | null };
const PATH = "/v0/document/scratch";
const START = "# Scratchpad\n\nWrite here, then mark it up: drag across text with Select text, press Done, and the listening session is handed the comment with this text.\n";
const SAVE_AFTER_MS = 400;
const LOOK_EVERY_MS = 2000;
const client = `document-${Math.random().toString(36).slice(2, 10)}`;

export default function DocumentScratch(props: { onReady: () => void }) {
  const [text, setText] = createSignal("");
  const [file, setFile] = createSignal("");
  let version: number | null = null, saving: ReturnType<typeof setTimeout> | undefined, unsaved = false;
  const took = (kept: Kept) => { version = kept.version; setFile(kept.file); return kept; };
  const save = async () => { unsaved = false; took(await api<Kept>(PATH, { method: "PUT", body: JSON.stringify({ text: text() }) })); };
  const write = (value: string) => { setText(value); unsaved = true; clearTimeout(saving); saving = setTimeout(() => void save().catch(() => { unsaved = true; }), SAVE_AFTER_MS); };
  // What a session wrote in the file shows here, unless this page has words not yet saved.
  const look = async () => { const kept = await api<Kept>(PATH); if (unsaved || kept.version === version) return; took(kept); if (kept.text === null) { setText(START); await save(); } else setText(kept.text); };
  onMount(() => { void look().catch(() => {}); const looking = setInterval(() => void look().catch(() => {}), LOOK_EVERY_MS); onCleanup(() => { clearInterval(looking); clearTimeout(saving); }); });
  const [mode, setMode] = createSignal<FeedbackMode | null>("use");
  const host: FeedbackHost = {
    names,
    capabilities: { deliveries: ["batched", "live"], tools: ["quote", "highlight", "pen", "shape", "text", "erase", "note"], screenshot: false, thin: false },
    transport: httpTransport(api),
    clientId: () => client,
    client: () => ({ kind: "document" }),
    subject: () => ({ kind: "document", name: "Scratchpad", format: "markdown", file: file(), text: text() }),
    // The lines a mark lies over, as the editor has them drawn (it draws only those near the window, which is where a mark is made).
    under: (box) => {
      const lines = [...document.querySelectorAll<HTMLElement>(".ui-text-editor .cm-line")], numbers = [...document.querySelectorAll<HTMLElement>(".ui-text-editor .cm-lineNumbers .cm-gutterElement")];
      const over = (element: HTMLElement) => { const at = element.getBoundingClientRect(); return at.height > 0 && at.bottom > box.top && at.top < box.top + box.height; };
      const covered = lines.filter(over), counted = numbers.filter(over).map((element) => Number(element.textContent)).filter(Boolean);
      return covered.length ? { ...(counted.length ? { from: Math.min(...counted), to: Math.max(...counted) } : {}), text: covered.map((line) => line.textContent ?? "").join("\n") } : null;
    },
    capturePage,
    notify: (outcome, message) => outcome === "sent" ? toast.success(message) : toast.error(message),
  };
  onMount(props.onReady);
  return <>
    <TextEditor fill label="Scratchpad" value={text()} onChange={write} head={<Button variant="ghost" size="sm" aria-pressed={mode() !== null} onClick={() => setMode(mode() ? null : "select")}>Mark up</Button>} />
    <Show when={mode()}>{(now) => <FeedbackTool host={host} mode={now()} onMode={setMode} onClose={() => setMode(null)} />}</Show>
  </>;
}
