import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { createLeaving, fadeOut, type CardExit } from "./composer-cards";
import { isInstalledClient } from "../platform/installed-client.ts";
import { FileIcon, ImageIcon, XIcon } from "lucide-solid";
import { Button, Spinner } from "@/components/primitives";
import type { Attachment } from "../api/contracts";
import type { UploadAttachment } from "../state/attachments";
import { attachmentUrl } from "../api/transport";
import { authorizedFetch } from "../api/native-auth-client";

const sizeLabel = (bytes?: number) => bytes == null ? "" : bytes < 1024 ? `${bytes} B` : bytes < 1_048_576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;

function AttachmentImage(props: { src: string }) {
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

export function AttachmentCards(props: {
  items: Array<Attachment | UploadAttachment>;
  chatId?: string | null;
  label: string;
  removable?: boolean;
  onRemove?: (item: UploadAttachment) => unknown;
}) {
  // Sent, the tray drops into the composer. Removed by hand, a card fades
  // where it is first -- and if it was the last, the tray then simply goes.
  const [exit, setExit] = createSignal<CardExit>("drop");
  createEffect(() => { if (props.items.length > 0) setExit("drop"); });
  const shown = createLeaving(() => props.items, (items) => items.length > 0, exit);
  const remove = async (card: HTMLElement | undefined, item: UploadAttachment) => {
    const faded = await fadeOut(card);
    if (props.items.length === 1) setExit("none");
    // A removal that fails leaves the attachment in place, so it is shown again.
    if (await props.onRemove?.(item) === false) { faded?.cancel(); setExit("drop"); }
  };
  return <Show when={shown.value().length}>
    <div class="attachment-tray" data-slot="attachment-group" data-leaving={shown.leaving() || undefined} aria-label={props.label}>
      <For each={shown.value()}>{(item) => {
        const upload = item as UploadAttachment;
        const image = item.type?.startsWith("image/");
        const source = upload.objectUrl || (image && props.chatId ? attachmentUrl(props.chatId, item.id, "?preview=1") : null);
        let card: HTMLDivElement | undefined;
        return <div ref={card} data-slot="attachment" data-size="default" class={props.removable ? "attachment-card composer-card" : "attachment-card"}>
          <span data-slot="attachment-media" class="attachment-media"><Show when={source} fallback={image ? <ImageIcon /> : <FileIcon />}>
            <AttachmentImage src={source!} />
          </Show></span>
          <span class="attachment-copy"><strong>{item.name}</strong><small>{upload.status === "uploading" ? `${upload.progress}%` : upload.status === "error" ? upload.error : sizeLabel(item.size)}</small></span>
          <Show when={upload.status === "uploading"}><Spinner /></Show>
          <Show when={props.removable}><Button variant="ghost" size="icon-sm" aria-label={`Remove ${item.name}`} onClick={() => void remove(card, upload)}><XIcon /></Button></Show>
        </div>;
      }}</For>
    </div>
  </Show>;
}
