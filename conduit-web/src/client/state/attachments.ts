import { createMemo, createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";
import { api, asList } from "../api/client";
import type { Attachment } from "../api/contracts";
import { attachmentUrl } from "../api/transport";

export interface UploadAttachment extends Attachment {
  file?: File;
  objectUrl?: string | null;
  status: "queued" | "uploading" | "done" | "error";
  progress: number;
  announced?: boolean;
  restored?: boolean;
}

export function filesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return [];
  const extracted: File[] = [];
  const items = dataTransfer.items ? Array.from(dataTransfer.items) : [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    try {
      const file = item.getAsFile();
      if (file) extracted.push(file);
    } catch {}
  }
  return extracted.length ? extracted : Array.from(dataTransfer.files || []);
}

const MAX_CONCURRENT_UPLOADS = 3;
export const DEFAULT_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

function formatAttachmentLimit(bytes: number) {
  const megabytes = bytes / (1024 * 1024);
  return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MiB`;
}

export function createAttachments(
  onError: (error: unknown) => void,
  maxBytes: Accessor<number> = () => DEFAULT_MAX_ATTACHMENT_BYTES,
) {
  const [items, setItems] = createSignal<UploadAttachment[]>([]);
  const [chatId, setChatId] = createSignal("");
  const queue: UploadAttachment[] = [];
  const requests = new Map<string, XMLHttpRequest>();
  const objectUrls = new Set<string>();
  let active = 0;
  let loadSequence = 0;
  let uploadEpoch = 0;

  const update = (id: string, patch: Partial<UploadAttachment>) => setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));

  const drain = () => {
    while (active < MAX_CONCURRENT_UPLOADS && queue.length) {
      const item = queue.shift();
      if (item) upload(item);
    }
  };

  const upload = (item: UploadAttachment) => {
    const owner = chatId();
    if (!owner || !item.file) return;
    const epoch = uploadEpoch;
    active += 1;
    update(item.id, { status: "uploading", progress: 0 });
    const request = new XMLHttpRequest();
    requests.set(item.id, request);
    request.open("PUT", attachmentUrl(owner, item.id, `?name=${encodeURIComponent(item.name)}`));
    request.setRequestHeader("Content-Type", item.file.type || "application/octet-stream");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      requests.delete(item.id);
      if (epoch !== uploadEpoch) return;
      active = Math.max(0, active - 1);
      drain();
    };
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) update(item.id, { progress: Math.round(event.loaded / event.total * 100) });
    });
    request.addEventListener("load", () => {
      try {
        const body = request.responseText ? JSON.parse(request.responseText) as Attachment & { message?: string } : {} as Attachment & { message?: string };
        if (request.status < 200 || request.status >= 300) throw new Error(body.message || "Upload failed");
        update(item.id, { ...body, status: "done", progress: 100, announced: false });
      } catch (error) {
        update(item.id, { status: "error", error: (error as Error).message });
        onError(error);
      }
      finish();
    });
    request.addEventListener("error", () => { update(item.id, { status: "error", error: "Upload connection failed" }); onError("Upload connection failed"); finish(); });
    request.addEventListener("abort", finish);
    request.send(item.file);
  };

  const addFiles = (files: FileList | File[]) => {
    const limit = Math.max(1, Math.trunc(maxBytes() || DEFAULT_MAX_ATTACHMENT_BYTES));
    const additions = [...files].filter((file) => {
      if (file.size <= limit) return true;
      onError(`${file.name || "File"} exceeds the ${formatAttachmentLimit(limit)} attachment limit`);
      return false;
    }).map<UploadAttachment>((file) => {
      const objectUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (objectUrl) objectUrls.add(objectUrl);
      return { id: crypto.randomUUID(), name: file.name || "attachment", size: file.size, type: file.type, file, objectUrl, status: "queued", progress: 0, announced: false };
    });
    if (!additions.length) return;
    setItems((current) => [...current, ...additions]);
    queue.push(...additions);
    drain();
  };

  const clear = () => {
    loadSequence += 1;
    const owner = chatId();
    const abandoned = items();
    uploadEpoch += 1;
    queue.splice(0);
    for (const request of requests.values()) request.abort();
    requests.clear();
    active = 0;
    for (const item of abandoned) {
      if (item.objectUrl) { URL.revokeObjectURL(item.objectUrl); objectUrls.delete(item.objectUrl); }
      if (owner && item.status === "done" && !item.restored) {
        void api(`/v0/chats/${encodeURIComponent(owner)}/attachments/${item.id}`, { method: "DELETE" })
          .catch(() => onError("Could not discard attachment"));
      }
    }
    setItems([]);
  };

  const select = async (nextChatId: string) => {
    clear();
    const sequence = loadSequence;
    setChatId(nextChatId);
    if (!nextChatId) return;
    try {
      const payload = await api<{ attachments?: Attachment[] }>(`/v0/chats/${encodeURIComponent(nextChatId)}/attachments`);
      if (sequence !== loadSequence) return;
      setItems(asList<Attachment>(payload.attachments).filter((item) => !(item as UploadAttachment).announced).map((item) => ({ ...item, status: "done", progress: 100 })));
    } catch (error) { if (sequence === loadSequence) onError(error); }
  };

  const remove = async (item: UploadAttachment) => {
    requests.get(item.id)?.abort();
    const index = queue.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) queue.splice(index, 1);
    try {
      if (item.status === "done" && !item.restored) await api(`/v0/chats/${encodeURIComponent(chatId())}/attachments/${item.id}`, { method: "DELETE" });
    } catch (error) { onError(error); return false; }
    if (item.objectUrl) { URL.revokeObjectURL(item.objectUrl); objectUrls.delete(item.objectUrl); }
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    return true;
  };

  const pendingIds = createMemo(() => items().filter((item) => item.status === "done" && !item.announced).map((item) => item.id));
  const markAnnounced = (ids: string[]) => { const sent = new Set(ids); setItems((current) => current.filter((item) => !sent.has(item.id))); };
  const restore = (restored: Attachment[]) => {
    clear();
    setItems(asList<Attachment>(restored).map((item) => ({ ...item, status: "done", progress: 100, announced: false, restored: true })));
  };
  const restoreDraft = (restored: Attachment[]) => {
    const draftItems = asList<Attachment>(restored).map((item) => ({ ...item, status: "done" as const, progress: 100, announced: false, restored: false }));
    const draftIds = new Set(draftItems.map((item) => item.id));
    setItems((current) => [...draftItems, ...current.filter((item) => !draftIds.has(item.id))]);
  };

  onCleanup(() => {
    for (const request of requests.values()) request.abort();
    for (const url of objectUrls) URL.revokeObjectURL(url);
  });

  return { items, chatId, select, addFiles, remove, pendingIds, markAnnounced, clear, restore, restoreDraft };
}

export type AttachmentsStore = ReturnType<typeof createAttachments>;
