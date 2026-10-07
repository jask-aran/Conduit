import { createSignal, onCleanup, onMount } from "solid-js";
import { installedClientKind, isInstalledClient } from "../platform/installed-client.ts";
import type { RuntimeProcess } from "../api/contracts";
import { onPathChange } from "../platform/servers";
import { eventSourceUrl } from "../api/transport";
import { authorizedFetch } from "../api/native-auth-client";
import { browserRegistrationId, finishPwaRestart, preparePwaRestart } from "../pwa-update";
import { api } from "../api/client";
import { RESUME_RECONNECT_AFTER_MS } from "./agent-session";
import { buildLabel, clientBuild } from "../platform/build-info";

/** This client's runtime stream, as the server lists it in /v0/runtime/clients. */
const [connectionId, setConnectionId] = createSignal("");
export { connectionId };

export type Connectivity = "connecting" | "online" | "reconnecting" | "offline";

export function createRuntimeStore() {
  const [processes, setProcesses] = createSignal(new Map<string, RuntimeProcess>());
  const [connectivity, setConnectivity] = createSignal<Connectivity>("connecting");
  const [stale, setStale] = createSignal(false);
  let source: { close: () => void } | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let lastFrameAt = 0;
  let attempts = 0;
  let restartPrepared = false;
  // The server pings every 15s. A stream that dies without firing an error --
  // sleep, mobile background, an idle proxy -- goes silent instead, and every
  // pill would sit there frozen and looking authoritative. Silence is the
  // signal; `onerror` is only the fast path.
  const SILENCE_MS = 45_000;

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

  /*
   * A restart is coming. A browser installs the new build and says so; the
   * server waits for that (or for its limit) before restarting. An installed
   * client carries its build in the shell and is never waited on.
   */
  const prepare = (attempt: unknown, target: unknown) => {
    if (isInstalledClient()) return;
    preparePwaRestart(typeof attempt === "string" ? attempt : "", typeof target === "string" ? target : "",
      (ready) => api("/v0/runtime/restart/ready", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ready) }).then(() => {}));
  };

  /** Who this stream is, for the server's list of connected clients. */
  const streamUrl = () => {
    const query = new URLSearchParams({ client: installedClientKind || "browser", build: buildLabel(clientBuild) });
    if (!isInstalledClient()) query.set("registration", browserRegistrationId());
    return eventSourceUrl(`/v0/runtime/stream?${query}`);
  };

  const connect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    source?.close();
    source = undefined;
    lastFrameAt = Date.now();
    if (!watchdog) {
      watchdog = setInterval(() => {
        if (!source || Date.now() - lastFrameAt < SILENCE_MS) return;
        setStale(true);
        attempts += 1;
        connect();
      }, 5000);
      (watchdog as unknown as { unref?: () => void }).unref?.();
    }
    setConnectivity(attempts ? "reconnecting" : "connecting");
    setStale(attempts > 0);
    const onMessage = (data: string) => {
      lastFrameAt = Date.now();
      try {
        const event = JSON.parse(data) as Record<string, unknown>;
        if (event.type === "ping") {
          if (connectivity() !== "online") { attempts = 0; setConnectivity("online"); }
          setStale(false);
        } else if (event.type === "runtime_global_snapshot") {
          replaceAll((event.processes || []) as RuntimeProcess[]);
          if (typeof event.connection === "string") setConnectionId(event.connection);
          restartPrepared = event.restartPrepared === true;
          if (restartPrepared) prepare(event.restartAttempt, event.restartTarget);
          attempts = 0;
          setConnectivity("online");
          setStale(false);
        } else if (event.type === "runtime_process" && event.process) {
          upsert(event.process as RuntimeProcess);
        } else if (event.type === "runtime_process_removed") {
          remove(event.id as string | undefined, event.chatId as string | undefined);
        } else if (event.type === "chat_changed" && event.chat) {
          window.dispatchEvent(new CustomEvent("conduit:chat-changed", { detail: event.chat }));
        } else if (event.type === "terminal_changed" || event.type === "terminal_removed") {
          window.dispatchEvent(new Event("conduit:ptys-changed"));
        } else if (event.type === "pwa_restart_prepared") {
          restartPrepared = true;
          prepare(event.attempt, event.target);
        }
      } catch {
        // A malformed global update must not take the app down.
      }
    };
    const onError = (next: { close: () => void }) => {
      if (source !== next) return;
      next.close();
      source = undefined;
      if (restartPrepared) {
        restartPrepared = false;
        void finishPwaRestart();
      }
      attempts += 1;
      // A blip is the usual cause, so the first retries come quickly:
      // 250ms, doubling to 8s, and offline after about fifteen seconds.
      const offline = attempts >= 8;
      setConnectivity(offline ? "offline" : "reconnecting");
      setStale(true);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, offline ? 10_000 : Math.min(250 * 2 ** (attempts - 1), 8000));
    };
    if (isInstalledClient()) {
      const controller = new AbortController();
      const next = { close: () => controller.abort() };
      source = next;
      void authorizedFetch(streamUrl(), {
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
      const next = new EventSource(streamUrl());
      source = next;
      next.onmessage = (message) => onMessage(message.data);
      next.onerror = () => onError(next);
    }
  };

  /*
   * The route to the server changed. The stream is carrying this server's own
   * events, so it is not wrong -- it is merely arriving by an address nobody
   * is using any more, and a stream left on a path that may be about to stop
   * answering is a client that looks alive and reports nothing. Replaced at
   * once rather than waited out by the watchdog.
   */
  onPathChange(() => connect());

  // Waking up is exactly when a stream is most likely to be dead without
  // having said so: after any real time away it is replaced rather than
  // trusted, which used to take the 45s of silence above to notice.
  let hiddenAt = 0;
  const resume = (force = false) => {
    if (document.visibilityState === "hidden") { hiddenAt ||= Date.now(); return; }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (force || !source || away >= RESUME_RECONNECT_AFTER_MS || Date.now() - lastFrameAt >= SILENCE_MS) {
      attempts = 0;
      connect();
    }
  };
  const onVisibility = () => resume();
  const restore = (event: PageTransitionEvent) => {
    if (event.persisted) resume(true);
  };
  const online = () => resume(true);

  onMount(() => {
    connect();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", restore);
    window.addEventListener("online", online);
  });
  onCleanup(() => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (watchdog) clearInterval(watchdog);
    watchdog = undefined;
    source?.close();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", restore);
    window.removeEventListener("online", online);
  });

  return {
    processes,
    connectivity,
    stale,
    getProcess: (chatId?: string | null) => chatId ? processes().get(chatId) || null : null,
    // A stop the server has already accepted. Waiting for the stream to say so
    // leaves a window where this catalogue still offers a process that is on
    // its way out, and attaching to one of those yields no agent at all.
    forget: (chatId: string) => remove(undefined, chatId),
    retry: connect,
  };
}

export type RuntimeStore = ReturnType<typeof createRuntimeStore>;
