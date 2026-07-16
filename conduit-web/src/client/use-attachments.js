import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const MAX_CONCURRENT_UPLOADS = 3;
const PROGRESS_INTERVAL = 100;

export function useAttachments(chatId, onError) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const queue = useRef([]);
  const active = useRef(0);
  const requests = useRef(new Map());
  const objectUrls = useRef(new Set());

  const update = useCallback((id, patch) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const upload = useCallback((item) => {
    if (!chatId) return;
    active.current += 1;
    update(item.id, { status: "uploading", progress: 0 });
    const request = new XMLHttpRequest();
    requests.current.set(item.id, request);
    request.open("PUT", `/v0/chats/${encodeURIComponent(chatId)}/attachments/${item.id}?name=${encodeURIComponent(item.name)}`);
    request.setRequestHeader("Content-Type", item.file.type || "application/octet-stream");
    let lastProgress = 0;
    let finished = false;
    request.upload.addEventListener("progress", (event) => {
      const now = performance.now();
      if (!event.lengthComputable || (now - lastProgress < PROGRESS_INTERVAL && event.loaded !== event.total)) return;
      lastProgress = now;
      update(item.id, { progress: Math.round((event.loaded / event.total) * 100) });
    });
    const finish = () => {
      if (finished) return;
      finished = true;
      active.current -= 1;
      requests.current.delete(item.id);
      while (active.current < MAX_CONCURRENT_UPLOADS && queue.current.length) upload(queue.current.shift());
    };
    request.addEventListener("load", () => {
      try {
        const body = request.responseText ? JSON.parse(request.responseText) : {};
        if (request.status < 200 || request.status >= 300) throw new Error(body.message || body.error || "Upload failed");
        update(item.id, { ...body, status: "done", progress: 100, announced: false });
      } catch (error) {
        update(item.id, { status: "error", error: error.message });
        onError?.(error.message);
      }
      finish();
    });
    request.addEventListener("error", () => {
      update(item.id, { status: "error", error: "Upload connection failed" });
      onError?.("Upload connection failed");
      finish();
    });
    request.addEventListener("abort", finish);
    request.send(item.file);
  }, [chatId, onError, update]);

  const addFiles = useCallback((files) => {
    const additions = [...files].map((file) => {
      const objectUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
      if (objectUrl) objectUrls.current.add(objectUrl);
      return {
        id: crypto.randomUUID(), name: file.name, size: file.size, type: file.type,
        file, objectUrl, status: "queued", progress: 0, announced: false,
      };
    });
    if (!additions.length) return;
    setItems((current) => [...current, ...additions]);
    setOpen(true);
    queue.current.push(...additions);
    while (active.current < MAX_CONCURRENT_UPLOADS && queue.current.length) upload(queue.current.shift());
  }, [upload]);

  useEffect(() => {
    queue.current = [];
    for (const request of requests.current.values()) request.abort();
    requests.current.clear();
    active.current = 0;
    setItems([]);
    if (!chatId) return undefined;
    let current = true;
    fetch(`/v0/chats/${encodeURIComponent(chatId)}/attachments`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load attachments")))
      .then((payload) => current && setItems(Array.isArray(payload.attachments)
        ? payload.attachments.map((item) => ({ ...item, status: "done", progress: 100 }))
        : []))
      .catch((error) => current && onError?.(error.message));
    return () => { current = false; };
  }, [chatId, onError]);

  useEffect(() => () => {
    for (const request of requests.current.values()) request.abort();
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
  }, []);

  const remove = useCallback(async (item) => {
    try {
      const request = requests.current.get(item.id);
      if (request) request.abort();
      queue.current = queue.current.filter((queued) => queued.id !== item.id);
      if (item.status === "done") {
        const response = await fetch(`/v0/chats/${encodeURIComponent(chatId)}/attachments/${item.id}`, { method: "DELETE" });
        if (!response.ok && response.status !== 404) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.message || body.error || "Could not delete attachment");
        }
      }
      if (item.objectUrl) {
        URL.revokeObjectURL(item.objectUrl);
        objectUrls.current.delete(item.objectUrl);
      }
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    } catch (error) {
      onError?.(error.message);
      throw error;
    }
  }, [chatId, onError]);

  const pendingIds = useMemo(() => items
    .filter((item) => item.status === "done" && !item.announced)
    .map((item) => item.id), [items]);

  const markAnnounced = useCallback((ids) => {
    const sent = new Set(ids);
    setItems((current) => current.map((item) => sent.has(item.id) ? { ...item, announced: true } : item));
  }, []);

  return {
    items, open, setOpen, inputRef, addFiles, remove, pendingIds, markAnnounced,
    openPicker: () => inputRef.current?.click(),
  };
}
