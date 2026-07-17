import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { activityLabel } from "../../activity.js";

function createProcessMapStore() {
  let processes = new Map();
  let connectivity = "connecting";
  let stale = false;
  // Stable snapshot reference — useSyncExternalStore requires referential
  // equality when nothing changed, or React re-renders without bound.
  let snapshot = { processes, connectivity, stale };
  const listeners = new Set();
  const emit = () => {
    snapshot = { processes, connectivity, stale };
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot() {
      return snapshot;
    },
    setConnectivity(next, nextStale = false) {
      if (connectivity === next && stale === nextStale) return;
      connectivity = next;
      stale = nextStale;
      emit();
    },
    replaceAll(list) {
      const next = new Map();
      for (const item of list || []) {
        if (item?.chatId) next.set(item.chatId, item);
        else if (item?.id) next.set(item.id, item);
      }
      processes = next;
      emit();
    },
    upsert(process) {
      if (!process) return;
      const key = process.chatId || process.id;
      if (!key) return;
      const next = new Map(processes);
      next.set(key, process);
      processes = next;
      emit();
    },
    remove({ id, chatId }) {
      const next = new Map(processes);
      for (const [key, value] of next) {
        if ((id && value.id === id) || (chatId && value.chatId === chatId) || key === id || key === chatId) {
          next.delete(key);
        }
      }
      processes = next;
      emit();
    },
  };
}

const store = createProcessMapStore();

function processByChatId(chatId) {
  if (!chatId) return null;
  const { processes } = store.getSnapshot();
  if (processes.has(chatId)) return processes.get(chatId);
  for (const value of processes.values()) {
    if (value.chatId === chatId) return value;
  }
  return null;
}

export function useGlobalRuntime() {
  const sourceRef = useRef(null);
  const reconnectRef = useRef(null);
  const attemptsRef = useRef(0);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  const connect = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }
    store.setConnectivity(attemptsRef.current > 0 ? "reconnecting" : "connecting", attemptsRef.current > 0);
    const source = new EventSource("/v0/runtime/stream");
    sourceRef.current = source;

    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data);
        if (event.type === "runtime_global_snapshot") {
          store.replaceAll(event.processes || []);
          store.setConnectivity("online", false);
          attemptsRef.current = 0;
          return;
        }
        if (event.type === "runtime_process" && event.process) {
          store.upsert(event.process);
          return;
        }
        if (event.type === "runtime_process_removed") {
          store.remove(event);
        }
      } catch {
        // ignore malformed events
      }
    };

    source.onerror = () => {
      // Avoid reconnect storms when the source is already closed by teardown.
      if (sourceRef.current !== source) return;
      source.close();
      sourceRef.current = null;
      attemptsRef.current += 1;
      const offline = attemptsRef.current >= 5;
      store.setConnectivity(offline ? "offline" : "reconnecting", true);
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const delay = offline ? 10000 : Math.min(1000 * (2 ** Math.min(attemptsRef.current, 4)), 8000);
      reconnectRef.current = setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const source = sourceRef.current;
      sourceRef.current = null;
      source?.close();
    };
  }, [connect]);

  const getProcess = useCallback((chatId) => processByChatId(chatId), [snapshot.processes]);

  return {
    connectivity: snapshot.connectivity,
    stale: snapshot.stale,
    processes: snapshot.processes,
    getProcess,
    processLabel: (chatId) => {
      const process = processByChatId(chatId);
      if (!process) return null;
      return activityLabel(process.activity || "idle", process.activityDetail);
    },
    retry: connect,
  };
}

export function useProcessForChat(chatId) {
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return processByChatId(chatId);
}

export { activityLabel, processByChatId, store as globalRuntimeStore };
