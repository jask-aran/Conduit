import { createSignal, onCleanup, onMount } from "solid-js";
import { desktopShell, installedClientKind, isInstalledClient } from "../platform/installed-client.ts";
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

/** A paired environment and whether it is there now, as the runtime stream says (the hub's own is never away). */
export type DeviceState = { id: string; name: string; device: string | null; online: boolean; lastSeenAt: string | null };
const [deviceStates, setDeviceStates] = createSignal(new Map<string, DeviceState>());
export { deviceStates };
/**
 * The device a project's work runs on, when it is away: its files, terminals and the tools of its chats wait for it.
 * Null on the hub, or while it is there.
 */
export const awayDevice = (project?: { nodeId?: string | null } | null) => {
  const state = project?.nodeId ? deviceStates().get(project.nodeId) : undefined;
  return state && !state.online ? state : null;
};
/** "Jask · Windows": a device's environment as people know it. */
export const deviceLabel = (state: DeviceState) => state.device ? `${state.device} · ${state.name}` : state.name;
const takeDevices = (list: unknown) => {
  if (!Array.isArray(list)) return;
  const before = deviceStates();
  const next = new Map((list as DeviceState[]).map((item) => [item.id, item]));
  setDeviceStates(next);
  window.dispatchEvent(new Event("conduit:devices-changed"));
  // Back: what waited on it (a file tree, a diff) reads again.
  for (const [id, state] of next) if (state.online && before.get(id)?.online === false) window.dispatchEvent(new CustomEvent("conduit:device-online", { detail: id }));
};

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
  /*
   * Every browser tab streamed for itself, and over HTTP/1.1 a browser holds six connections to a server: with six
   * tabs open, every request in every tab waited for one to close. One tab -- whichever holds the lock -- streams
   * and relays each frame to the others; when it closes, the next one takes the lock and the stream.
   */
  const channel = !isInstalledClient() && typeof BroadcastChannel !== "undefined" && navigator.locks
    ? new BroadcastChannel("conduit:runtime-stream") : null;
  let leading = !channel;
  let releaseLead: (() => void) | undefined;
  let restartAnnounced = { attempt: undefined as unknown, target: undefined as unknown };

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

  /** The app's own environment, for the devices' map: the node ids its companion is paired as. */
  const locate = (connection: string) => {
    if (!leading || !desktopShell) return;
    void desktopShell.companion.status().then((status) => {
      const nodes = (status.node?.pairings || []).map((pairing) => pairing.nodeId).filter((node): node is string => Boolean(node));
      if (nodes.length) return api(`/v0/runtime/clients/${encodeURIComponent(connection)}/nodes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nodes }) });
    }).catch(() => {});
  };

  /** Who this stream is, for the server's list of connected clients. */
  const streamUrl = () => {
    const query = new URLSearchParams({ client: installedClientKind || "browser", build: buildLabel(clientBuild) });
    if (!isInstalledClient()) query.set("registration", browserRegistrationId());
    return eventSourceUrl(`/v0/runtime/stream?${query}`);
  };

  const onMessage = (data: string) => {
    lastFrameAt = Date.now();
    if (leading) channel?.postMessage({ type: "frame", data });
    try {
      const event = JSON.parse(data) as Record<string, unknown>;
      if (event.type === "ping") {
        if (connectivity() !== "online") { attempts = 0; setConnectivity("online"); }
        setStale(false);
      } else if (event.type === "runtime_global_snapshot") {
        replaceAll((event.processes || []) as RuntimeProcess[]);
        takeDevices(event.devices);
        if (typeof event.connection === "string") { setConnectionId(event.connection); locate(event.connection); }
        restartPrepared = event.restartPrepared === true;
        if (restartPrepared) prepare(event.restartAttempt, event.restartTarget);
        restartAnnounced = { attempt: event.restartAttempt, target: event.restartTarget };
        attempts = 0;
        setConnectivity("online");
        setStale(false);
      } else if (event.type === "runtime_process" && event.process) {
        upsert(event.process as RuntimeProcess);
      } else if (event.type === "runtime_process_removed") {
        remove(event.id as string | undefined, event.chatId as string | undefined);
      } else if (event.type === "chat_changed" && event.chat) {
        window.dispatchEvent(new CustomEvent("conduit:chat-changed", { detail: event.chat }));
      } else if (event.type === "devices_changed") {
        takeDevices(event.devices);
      } else if (event.type === "workspace_changed" && Array.isArray(event.projectIds)) {
        window.dispatchEvent(new CustomEvent("conduit:workspace-changed", { detail: event.projectIds }));
      } else if (event.type === "terminal_changed" || event.type === "terminal_removed") {
        window.dispatchEvent(new Event("conduit:ptys-changed"));
      } else if (event.type === "pwa_restart_prepared") {
        restartPrepared = true;
        prepare(event.attempt, event.target);
        restartAnnounced = { attempt: event.attempt, target: event.target };
      }
    } catch {
      // A malformed global update must not take the app down.
    }
  };
  // The stream has gone (the server restarting, or a blip): said by the tab holding it to every other.
  const lost = () => {
    setStale(true);
    if (restartPrepared) {
      restartPrepared = false;
      void finishPwaRestart();
    }
  };
  // What a tab arriving after the stream's own snapshot needs: the state as the leader holds it now.
  const snapshot = () => JSON.stringify({
    type: "runtime_global_snapshot",
    processes: [...processes().values()],
    devices: [...deviceStates().values()],
    connection: connectionId(),
    restartPrepared,
    restartAttempt: restartAnnounced.attempt,
    restartTarget: restartAnnounced.target,
  });

  const connect = () => {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    source?.close();
    source = undefined;
    lastFrameAt = Date.now();
    if (!watchdog) {
      watchdog = setInterval(() => {
        if ((leading && !source) || Date.now() - lastFrameAt < SILENCE_MS) return;
        setStale(true);
        attempts += 1;
        connect();
      }, 5000);
      (watchdog as unknown as { unref?: () => void }).unref?.();
    }
    setConnectivity(attempts ? "reconnecting" : "connecting");
    setStale(attempts > 0);
    // Another tab streams: ask it for where things stand rather than opening a stream of our own.
    if (!leading) {
      channel!.postMessage({ type: "hello" });
      return;
    }
    const onError = (next: { close: () => void }) => {
      if (source !== next) return;
      next.close();
      source = undefined;
      lost();
      attempts += 1;
      // A blip is the usual cause, so the first retries come quickly:
      // 250ms, doubling to 8s, and offline after about fifteen seconds.
      const offline = attempts >= 8;
      channel?.postMessage({ type: "lost", offline });
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
    if (!leading) {
      channel!.postMessage({ type: "resume", force, away });
      return;
    }
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

  if (channel) {
    channel.onmessage = ({ data: message }: MessageEvent<{ type: string; data?: string; force?: boolean; away?: number; offline?: boolean }>) => {
      if (message.type === "frame" && !leading && message.data) onMessage(message.data);
      else if (message.type === "lost" && !leading) { setConnectivity(message.offline ? "offline" : "reconnecting"); lost(); }
      else if (message.type === "hello" && leading && connectivity() === "online") channel.postMessage({ type: "frame", data: snapshot() });
      else if (message.type === "resume" && leading && (message.force || (message.away ?? 0) >= RESUME_RECONNECT_AFTER_MS || !source
        || Date.now() - lastFrameAt >= SILENCE_MS)) { attempts = 0; connect(); }
    };
  }

  onMount(() => {
    // Held until this tab goes: the browser hands the lock to a waiting tab when it does.
    if (channel) void navigator.locks.request("conduit:runtime-stream", () => new Promise<void>((release) => {
      releaseLead = release;
      leading = true;
      attempts = 0;
      connect();
    }));
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
    releaseLead?.();
    channel?.close();
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
