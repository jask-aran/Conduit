import { createMemo, createSignal, onCleanup } from "solid-js";
import { api, asList } from "../api/client";
import type { Attachment } from "../api/contracts";

export interface UploadAttachment extends Attachment {
  file?: File;
  objectUrl?: string | null;
  status: "queued" | "uploading" | "done" | "error";
  progress: number;
  announced?: boolean;
  restored?: boolean;
}

const MAX_CONCURRENT_UPLOADS = 3;

export function createAttachments(onError: (message: string) => void) {
  const [items, setItems] = createSignal<UploadAttachment[]>([]);
  const [chatId, setChatId] = createSignal("");
  const queue: UploadAttachment[] = [];
  const requests = new Map<string, XMLHttpRequest>();
  const objectUrls = new Set<string>();
  let active = 0;
  let loadSequence = 0;

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
    active += 1;
    update(item.id, { status: "uploading", progress: 0 });
    const request = new XMLHttpRequest();
    requests.set(item.id, request);
    request.open("PUT", `/v0/chats/${encodeURIComponent(owner)}/attachments/${item.id}?name=${encodeURIComponent(item.name)}`);
    request.setRequestHeader("Content-Type", item.file.type || "application/octet-stream");
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      active -= 1;
      requests.delete(item.id);
      drain();
    };
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) update(item.id, { progress: Math.round(event.loaded / event.total * 100) });
    });
    request.addEventListener("load", () => {
      try {
        const body = request.responseText ? JSON.parse(request.responseText) as Attachment : {} as Attachment;
        if (request.status < 200 || request.status >= 300) throw new Error("Upload failed");
        update(item.id, { ...body, status: "done", progress: 100, announced: false });
      } catch (error) {
        update(item.id, { status: "error", error: (error as Error).message });
        onError((error as Error).message);
      }
      finish();
    });
    request.addEventListener("error", () => { update(item.id, { status: "error", error: "Upload connection failed" }); onError("Upload connection failed"); finish(); });
    request.addEventListener("abort", finish);
    request.send(item.file);
  };

  const addFiles = (files: FileList | File[]) => {
    const additions = [...files].map<UploadAttachment>((file) => {
      const objectUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (objectUrl) objectUrls.add(objectUrl);
      return { id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type, file, objectUrl, status: "queued", progress: 0, announced: false };
    });
    if (!additions.length) return;
    setItems((current) => [...current, ...additions]);
    queue.push(...additions);
    drain();
  };

  const select = async (nextChatId: string) => {
    loadSequence += 1;
    const sequence = loadSequence;
    for (const request of requests.values()) request.abort();
    requests.clear();
    queue.splice(0);
    active = 0;
    setItems([]);
    setChatId(nextChatId);
    if (!nextChatId) return;
    try {
      const payload = await api<{ attachments?: Attachment[] }>(`/v0/chats/${encodeURIComponent(nextChatId)}/attachments`);
      if (sequence !== loadSequence) return;
      setItems(asList<Attachment>(payload.attachments).filter((item) => !(item as UploadAttachment).announced).map((item) => ({ ...item, status: "done", progress: 100 })));
    } catch (error) { if (sequence === loadSequence) onError((error as Error).message); }
  };

  const remove = async (item: UploadAttachment) => {
    requests.get(item.id)?.abort();
    const index = queue.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) queue.splice(index, 1);
    try {
      if (item.status === "done" && !item.restored) await api(`/v0/chats/${encodeURIComponent(chatId())}/attachments/${item.id}`, { method: "DELETE" });
    } catch (error) { onError((error as Error).message); return false; }
    if (item.objectUrl) { URL.revokeObjectURL(item.objectUrl); objectUrls.delete(item.objectUrl); }
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    return true;
  };

  const pendingIds = createMemo(() => items().filter((item) => item.status === "done" && !item.announced).map((item) => item.id));
  const markAnnounced = (ids: string[]) => { const sent = new Set(ids); setItems((current) => current.filter((item) => !sent.has(item.id))); };
  const restore = (restored: Attachment[]) => setItems(asList<Attachment>(restored).map((item) => ({ ...item, status: "done", progress: 100, announced: false, restored: true })));

  onCleanup(() => {
    for (const request of requests.values()) request.abort();
    for (const url of objectUrls) URL.revokeObjectURL(url);
  });

  return { items, chatId, select, addFiles, remove, pendingIds, markAnnounced, restore };
}

export type AttachmentsStore = ReturnType<typeof createAttachments>;
