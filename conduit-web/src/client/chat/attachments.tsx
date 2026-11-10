import { Icons } from "@/components/ui";
import { Attachment, AttachmentTile, Attachments } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/controls";
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

// The file viewer's icons: its icon theme lives in the workspace's lazy chunk, fetched on the first file shown.
const WorkspaceFileIcon = lazy(() => import("@/components/ui/file-marks").then((module) => ({ default: module.FileTypeIcon })));
export const FileMark = (props: { name: string }) => <Suspense fallback={<Icons.File />}><WorkspaceFileIcon name={props.name} /></Suspense>;

/** Attachments already sent, under their prompt in the transcript: a tray of tiles, a press on one showing them all
 *  larger and uncropped, with what each is. */
export function AttachmentCards(props: {
  items: Array<SentAttachment | UploadAttachment>;
  chatId?: string | null;
  label: string;
}) {
  const [open, setOpen] = createSignal(false);
  const isImage = (item: SentAttachment | UploadAttachment) => Boolean(item.type?.startsWith("image/"));
  const sourceOf = (item: SentAttachment | UploadAttachment) => (item as UploadAttachment).objectUrl || (isImage(item) && props.chatId ? attachmentUrl(props.chatId, item.id, "?preview=1") : null);
  const total = () => props.items.reduce((sum, item) => sum + (item.size || 0), 0);
  return <Show when={props.items.length}>
    <Attachments form="tray" label={props.label}>
      <For each={props.items}>{(item) => {
        const source = sourceOf(item);
        return <AttachmentTile name={item.name} icon={<FileMark name={item.name} />} image={source ? <AttachmentImage src={source} /> : undefined} onOpen={() => setOpen(true)} />;
      }}</For>
    </Attachments>
    <Show when={open()}>
      <Dialog open={open()} onOpenChange={setOpen} size="wide" title={props.items.length === 1 ? "1 attachment" : `${props.items.length} attachments`} description={sizeLabel(total())}
        actions={<Button size="sm" onClick={() => setOpen(false)}>Done</Button>}>
        <Attachments>
          <For each={props.items}>{(item) => {
            const source = sourceOf(item);
            return <Attachment name={item.name} detail={[sizeLabel(item.size), item.type].filter(Boolean).join(" · ")} icon={<FileMark name={item.name} />} image={source ? <AttachmentImage src={source} /> : undefined} />;
          }}</For>
        </Attachments>
      </Dialog>
    </Show>
  </Show>;
}
