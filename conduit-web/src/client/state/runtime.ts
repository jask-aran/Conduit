import { createSignal, onCleanup, onMount } from "solid-js";
import type { RuntimeProcess } from "../api/contracts";

export type Connectivity = "connecting" | "online" | "reconnecting" | "offline";

export function createRuntimeStore() {
  const [processes, setProcesses] = createSignal(new Map<string, RuntimeProcess>());
  const [connectivity, setConnectivity] = createSignal<Connectivity>("connecting");
  const [stale, setStale] = createSignal(false);
  let source: EventSource | undefined;
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
    source?.close();
    source = undefined;
    setConnectivity(attempts ? "reconnecting" : "connecting");
    setStale(attempts > 0);
    const next = new EventSource("/v0/runtime/stream");
    source = next;
    next.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as Record<string, unknown>;
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
    next.onerror = () => {
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
  };

  onMount(connect);
  onCleanup(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    source?.close();
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

