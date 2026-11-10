import { Icons } from "@/components/ui";
import { AttachmentTile, Attachments, CardStage, CardSteps } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Note } from "@/components/ui/state";
import { createSignal, For, lazy, onCleanup, onMount, Show, Suspense } from "solid-js";
import { isInstalledClient } from "../platform/installed-client.ts";

import type { Attachment as SentAttachment } from "../api/contracts";
import type { UploadAttachment } from "../state/attachments";
import { attachmentUrl } from "../api/transport";
import { authorizedFetch } from "../api/native-auth-client";

export const sizeLabel = (bytes?: number) => bytes == null ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1_048_576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;

export function AttachmentImage(props: { src: string }) {
  const isNative = isInstalledClient();
  const [source, setSource] = createSignal(isNative ? "" : props.src);
  let objectUrl = "";
  onMount(() => {
    if (!isNative) return;
    void authorizedFetch(props.src).then(async (response) => {
      if (!response.ok) throw new Error("Could not load attachment preview");
      objectUrl = URL.createObjectURL(await response.blob());
      setSource(objectUrl);
    }).catch(() => {});
  });
  onCleanup(() => { if (objectUrl) URL.revokeObjectURL(objectUrl); });
  return <Show when={source()}><img src={source()} alt="" onError={(event) => { event.currentTarget.hidden = true; }} /></Show>;
}

const TextEditor = lazy(() => import("@/components/ui/text-editor").then((module) => ({ default: module.TextEditor })));
// The file viewer's icons: its icon theme lives in the workspace's lazy chunk, fetched on the first file shown.
const WorkspaceFileIcon = lazy(() => import("@/components/ui/file-marks").then((module) => ({ default: module.FileTypeIcon })));
export const FileMark = (props: { name: string }) => <Suspense fallback={<Icons.File />}><WorkspaceFileIcon name={props.name} /></Suspense>;

type Sent = SentAttachment | UploadAttachment;
const isImage = (item: Sent) => Boolean(item.type?.startsWith("image/"));
// Read as text: what says it is, and what a name says is (a log, a config), up to a size worth reading in a card.
const isText = (item: Sent) => (item.size ?? 0) <= 262_144 && (/^text\/|json|xml|yaml|javascript|typescript|x-sh/.test(item.type || "")
  || /\.(txt|md|log|csv|tsv|json|ya?ml|toml|ini|conf|xml|html?|css|[cm]?[jt]sx?|py|rb|go|rs|java|kt|c|h|cpp|sh|sql|diff|patch)$/i.test(item.name));

/** A file's text, fetched when it is first shown. */
function AttachmentText(props: { src: string; name: string }) {
  const [text, setText] = createSignal<string | null>(null);
  const [failed, setFailed] = createSignal(false);
  onMount(() => void authorizedFetch(props.src).then(async (response) => {
    if (!response.ok) throw new Error("Could not load the attachment");
    setText(await response.text());
  }).catch(() => setFailed(true)));
  // The library's editor, read only, as Settings shows a prompt's text. It carries CodeMirror, so it is fetched when a
  // file is first shown rather than with the chat.
  return <Show when={text() !== null} fallback={failed() ? "Could not be read" : "Reading…"}>
    <Suspense fallback="Reading…"><TextEditor fill readOnly markdown={/\.(md|markdown)$/i.test(props.name)} label={props.name} value={text()!} /></Suspense>
  </Show>;
}

/** Attachments already sent, under their prompt in the transcript: a tray of tiles. A press on one shows it whole (a
 *  picture uncropped, a file's text), with the message's others under it to step to. */
export function AttachmentCards(props: {
  items: Sent[];
  chatId?: string | null;
  label: string;
}) {
  const [shown, setShown] = createSignal<string | null>(null);
  const sourceOf = (item: Sent) => (item as UploadAttachment).objectUrl || (isImage(item) && props.chatId ? attachmentUrl(props.chatId, item.id, "?preview=1") : null);
  const tiles = (current: string | null) => <Attachments form="tray" label={props.label}>
    <For each={props.items}>{(item) => {
      const source = sourceOf(item);
      return <AttachmentTile name={item.name} icon={<FileMark name={item.name} />} image={source ? <AttachmentImage src={source} /> : undefined} current={item.id === current} onOpen={() => setShown(item.id)} />;
    }}</For>
  </Attachments>;
  const item = () => props.items.find((candidate) => candidate.id === shown());
  return <Show when={props.items.length}>
    {tiles(null)}
    <Show when={item()} keyed>{(current) => {
      const source = sourceOf(current);
      const step = (by: number) => { const at = props.items.findIndex((candidate) => candidate.id === current.id); setShown(props.items[(at + by + props.items.length) % props.items.length]!.id); };
      return <Dialog open onOpenChange={(open) => { if (!open) setShown(null); }} size="wide" close title={current.name}
        onKeyDown={(event) => { if (props.items.length > 1 && (event.key === "ArrowLeft" || event.key === "ArrowRight") && !(event.target as Element).closest(".cm-editor")) { event.preventDefault(); step(event.key === "ArrowLeft" ? -1 : 1); } }}>
        <CardStage>
          <Show when={source} fallback={<Show when={isText(current) && props.chatId} fallback="No preview"><AttachmentText src={attachmentUrl(props.chatId!, current.id)} name={current.name} /></Show>}>
            <AttachmentImage src={source!} />
          </Show>
        </CardStage>
        <Note kind="card">{[sizeLabel(current.size), current.type].filter(Boolean).join(" · ")}</Note>
        <Show when={props.items.length > 1}><CardSteps onPrevious={() => step(-1)} onNext={() => step(1)}>{tiles(current.id)}</CardSteps></Show>
      </Dialog>;
    }}</Show>
  </Show>;
}
