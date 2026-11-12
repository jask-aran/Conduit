import names from "virtual:ui-pieces";
import { createSignal, Show } from "solid-js";
import { DocumentEditor, type DocumentHost, type DocumentMarks } from "@/components/document";
import { MarkupTool, httpTransport, type MarkupHost, type MarkupMode } from "@/components/markup";
import { Button } from "@/components/ui";
import { toast } from "@/components/ui/notifications";
import { api } from "../api/client";
import { webSocketUrl } from "../api/transport.js";
import { capturePage } from "../feedback/conduit-feedback";

/*
 * /document: the one test document (the hub's server/documents.js holds it), in the document editor with Markup over
 * it. It has no place in the app's navigation until documents live in projects. A comment carries the blocks it is
 * about and how the session it is handed to reads and changes the document; what that session writes shows here as
 * it lands.
 */
const ID = "test";
const client = `document-${Math.random().toString(36).slice(2, 10)}`;
const CHANGE = `\`node scripts/conduit-markup.mjs document read ${ID}\` prints it as it is now, as Markdown with each block under its id; \`document replace\`, \`insert\` and \`delete\` change one block (\`document\` alone says how).`;

export default function DocumentPage(props: { onReady: () => void }) {
  const [mode, setMode] = createSignal<MarkupMode | null>("use");
  let marks: DocumentMarks | undefined;
  const editing: DocumentHost = { socket: async (id) => new WebSocket(await webSocketUrl(`/v0/document/${id}/live`)), author: () => "person" };
  const markup: MarkupHost = {
    names,
    capabilities: { deliveries: ["batched", "live"], tools: ["quote", "highlight", "pen", "shape", "text", "erase", "note"], screenshot: false, thin: false },
    transport: httpTransport(api),
    clientId: () => client,
    client: () => ({ kind: "document" }),
    subject: () => ({ ...marks?.subject(), change: CHANGE }),
    under: (box) => marks?.under(box) ?? null,
    capturePage,
    notify: (outcome, message) => outcome === "sent" ? toast.success(message) : toast.error(message),
  };
  return <>
    <DocumentEditor host={editing} id={ID} name="Test document" onReady={props.onReady} marks={(offered) => { marks = offered; }}
      actions={<Button variant="ghost" size="sm" aria-pressed={mode() !== null} onClick={() => setMode(mode() ? null : "select")}>Mark up</Button>} />
    <Show when={mode()}>{(now) => <MarkupTool host={markup} mode={now()} onMode={setMode} onClose={() => setMode(null)} />}</Show>
  </>;
}
