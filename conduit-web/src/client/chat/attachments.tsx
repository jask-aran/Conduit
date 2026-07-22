import { For, Show } from "solid-js";
import { FileIcon, ImageIcon, XIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import type { Attachment } from "../api/contracts";
import type { UploadAttachment } from "../state/attachments";

const sizeLabel = (bytes?: number) => bytes == null ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1_048_576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;

export function AttachmentCards(props: {
  items: Array<Attachment | UploadAttachment>;
  chatId?: string | null;
  label: string;
  removable?: boolean;
  onRemove?: (item: UploadAttachment) => void;
}) {
  return <Show when={props.items.length}>
    <div class="attachment-tray" data-slot="attachment-group" aria-label={props.label}>
      <For each={props.items}>{(item) => {
        const upload = item as UploadAttachment;
        const image = item.type?.startsWith("image/");
        const source = upload.objectUrl || (image && props.chatId ? `/v0/chats/${encodeURIComponent(props.chatId)}/attachments/${encodeURIComponent(item.id)}?preview=1` : null);
        return <div data-slot="attachment" data-size="default" class="attachment-card">
          <span data-slot="attachment-media" class="attachment-media"><Show when={source} fallback={image ? <ImageIcon /> : <FileIcon />}>
            <img src={source!} alt="" onError={(event) => { event.currentTarget.hidden = true; }} />
          </Show></span>
          <span class="attachment-copy"><strong>{item.name}</strong><small>{upload.status === "uploading" ? `${upload.progress}%` : upload.status === "error" ? upload.error : sizeLabel(item.size)}</small></span>
          <Show when={upload.status === "uploading"}><Spinner /></Show>
          <Show when={props.removable}><Button variant="ghost" size="icon-sm" aria-label={`Remove ${item.name}`} onClick={() => props.onRemove?.(upload)}><XIcon /></Button></Show>
        </div>;
      }}</For>
    </div>
  </Show>;
}
