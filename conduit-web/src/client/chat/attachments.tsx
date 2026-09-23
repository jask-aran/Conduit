import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { isInstalledClient } from "../platform/installed-client.ts";
import { FileIcon, ImageIcon } from "lucide-solid";
import type { Attachment } from "../api/contracts";
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

/** Attachments already sent, under their prompt in the transcript. */
export function AttachmentCards(props: {
  items: Array<Attachment | UploadAttachment>;
  chatId?: string | null;
  label: string;
}) {
  return <Show when={props.items.length}>
    <div class="attachment-tray" data-slot="attachment-group" aria-label={props.label}>
      <For each={props.items}>{(item) => {
        const upload = item as UploadAttachment;
        const image = item.type?.startsWith("image/");
        const source = upload.objectUrl || (image && props.chatId ? attachmentUrl(props.chatId, item.id, "?preview=1") : null);
        return <div data-slot="attachment" data-size="default" class="attachment-card">
          <span data-slot="attachment-media" class="attachment-media"><Show when={source} fallback={image ? <ImageIcon /> : <FileIcon />}>
            <AttachmentImage src={source!} />
          </Show></span>
          <span class="attachment-copy"><strong>{item.name}</strong><small>{sizeLabel(item.size)}</small></span>
        </div>;
      }}</For>
    </div>
  </Show>;
}
