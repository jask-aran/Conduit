import { createSignal, onCleanup, onMount } from "solid-js";
import { Capacitor } from "@capacitor/core";
import type { RuntimeProcess } from "../api/contracts";
import { eventSourceUrl } from "../api/transport";
import { authorizedFetch } from "../api/native-auth-client";

export type Connectivity = "connecting" | "online" | "reconnecting" | "offline";

export function createRuntimeStore() {
  const [processes, setProcesses] = createSignal(new Map<string, RuntimeProcess>());
  const [connectivity, setConnectivity] = createSignal<Connectivity>("connecting");
  const [stale, setStale] = createSignal(false);
  let source: { close: () => void } | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;

  const replaceAll = (items: RuntimeProcess[]) => {
    const next = new Map<string, RuntimeProcess>();
    for (const item of items || []) if (item?.chatId) next.set(item.chatId, item);
    setProcesses(next);
  };

  const upsert = (item: RuntimeProcess) => {
    if (!item?.chatId) return;
    setProcesses((current) => new Map(current).set(item.chatId, item));
  };

  const remove = (id?: string, chatId?: string) => {
    setProcesses((current) => {
      const next = new Map(current);
      for (const [key, value] of next) {
        if (key === id || key === chatId || value.chatId === chatId) next.delete(key);
      }
      return next;
    });
  };

  const connect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    source?.close();
    source = undefined;
    setConnectivity(attempts ? "reconnecting" : "connecting");
    setStale(attempts > 0);
    const onMessage = (data: string) => {
      try {
        const event = JSON.parse(data) as Record<string, unknown>;
        if (event.type === "runtime_global_snapshot") {
          replaceAll((event.processes || []) as RuntimeProcess[]);
          attempts = 0;
          setConnectivity("online");
          setStale(false);
        } else if (event.type === "runtime_process" && event.process) {
          upsert(event.process as RuntimeProcess);
        } else if (event.type === "runtime_process_removed") {
          remove(event.id as string | undefined, event.chatId as string | undefined);
        }
      } catch {
        // A malformed global update must not take the app down.
      }
    };
    const onError = (next: { close: () => void }) => {
      if (source !== next) return;
      next.close();
      source = undefined;
      attempts += 1;
      const offline = attempts >= 5;
      setConnectivity(offline ? "offline" : "reconnecting");
      setStale(true);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, offline ? 10_000 : Math.min(1000 * 2 ** Math.min(attempts, 4), 8000));
    };
    if (Capacitor.isNativePlatform()) {
      const controller = new AbortController();
      const next = { close: () => controller.abort() };
      source = next;
      void authorizedFetch(eventSourceUrl("/v0/runtime/stream"), {
        headers: { accept: "text/event-stream" },
        signal: controller.signal,
      }).then(async (response) => {
        if (!response.ok || !response.body) throw new Error("Runtime stream unavailable");
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let pending = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) throw new Error("Runtime stream closed");
          pending += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
          let boundary;
          while ((boundary = pending.indexOf("\n\n")) >= 0) {
            const frame = pending.slice(0, boundary);
            pending = pending.slice(boundary + 2);
            const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
            if (data) onMessage(data);
          }
        }
      }).catch(() => { if (!controller.signal.aborted) onError(next); });
    } else {
      const next = new EventSource(eventSourceUrl("/v0/runtime/stream"));
      source = next;
      next.onmessage = (message) => onMessage(message.data);
      next.onerror = () => onError(next);
    }
  };

  const resume = () => {
    if (document.visibilityState !== "hidden" && !source) connect();
  };
  const restore = (event: PageTransitionEvent) => {
    if (event.persisted) resume();
  };

  onMount(() => {
    connect();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("pageshow", restore);
    window.addEventListener("online", resume);
  });
  onCleanup(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    source?.close();
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("pageshow", restore);
    window.removeEventListener("online", resume);
  });

  return {
    processes,
    connectivity,
    stale,
    getProcess: (chatId?: string | null) => chatId ? processes().get(chatId) || null : null,
    retry: connect,
  };
}

export type RuntimeStore = ReturnType<typeof createRuntimeStore>;
