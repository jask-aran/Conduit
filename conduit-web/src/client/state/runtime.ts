import { createSignal, onCleanup, onMount } from "solid-js";
import { desktopShell, installedClientKind, isInstalledClient } from "../platform/installed-client.ts";
import type { RuntimeProcess } from "../api/contracts";
import { onPathChange } from "../platform/servers";
import { eventSourceUrl } from "../api/transport";
import { authorizedFetch } from "../api/native-auth-client";
import { browserRegistrationId, finishPwaRestart, preparePwaRestart } from "../pwa-update";
import { api, replayHeldWrites } from "../api/client";
import { RESUME_RECONNECT_AFTER_MS } from "./agent-session";
import { buildLabel, clientBuild } from "../platform/build-info";
import type { RUNTIME_EVENTS } from "../../runtime-stream-api.js";

/** Applies to the stream's headers, not its frames. */
const STREAM_ANSWER_TIMEOUT_MS = 10_000;
const [connectionId, setConnectionId] = createSignal("");
export { connectionId };

export type DeviceState = { id: string; name: string; device: string | null; online: boolean; lastSeenAt: string | null };
const [deviceStates, setDeviceStates] = createSignal(new Map<string, DeviceState>());
export { deviceStates };
export const awayDevice = (project?: { nodeId?: string | null } | null) => {
  const state = project?.nodeId ? deviceStates().get(project.nodeId) : undefined;
  return state && !state.online ? state : null;
};
export const deviceLabel = (state: DeviceState) => state.device ? `${state.device} · ${state.name}` : state.name;
const takeDevices = (list: unknown) => {
  if (!Array.isArray(list)) return;
  const before = deviceStates();
  const next = new Map((list as DeviceState[]).map((item) => [item.id, item]));
  setDeviceStates(next);
  window.dispatchEvent(new Event("conduit:devices-changed"));
  for (const [id, state] of next) if (state.online && before.get(id)?.online === false) window.dispatchEvent(new CustomEvent("conduit:device-online", { detail: id }));
};

type RuntimeEvent = { type: keyof typeof RUNTIME_EVENTS } & Record<string, unknown>;

export type Connectivity = "connecting" | "online" | "reconnecting" | "offline";

let heardOnce = false;
export function createRuntimeStore() {
  const [processes, setProcesses] = createSignal(new Map<string, RuntimeProcess>());
  const [connectivity, setConnectivity] = createSignal<Connectivity>("connecting");
  const stale = () => connectivity() === "reconnecting" || connectivity() === "offline";
  let source: { close: () => void } | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | undefined;
  let lastFrameAt = 0;
  let attempts = 0;
  let restartPrepared = false;
  // The server pings every 15s. A stream that dies without an error (sleep, mobile background, an idle proxy) goes
  // silent instead, so silence is the signal and `onerror` only the fast path.
  const SILENCE_MS = 45_000;
  // Over HTTP/1.1 a browser holds six connections to a server, so one tab (whichever holds the lock) streams and
  // relays each frame to the others.
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

  // The server waits for a browser to install the new build (or for its limit) before restarting; an installed
  // client carries its build in the shell and is never waited on.
  const prepare = (attempt: unknown, target: unknown) => {
    if (isInstalledClient()) return;
    preparePwaRestart(typeof attempt === "string" ? attempt : "", typeof target === "string" ? target : "",
      (ready) => api("/v0/runtime/restart/ready", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ready) }).then(() => {}));
  };

  const locate = (connection: string) => {
    if (!leading || !desktopShell) return;
    void desktopShell.companion.status().then((status) => {
      const nodes = (status.node?.pairings || []).map((pairing) => pairing.nodeId).filter((node): node is string => Boolean(node));
      if (nodes.length) return api(`/v0/runtime/clients/${encodeURIComponent(connection)}/nodes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nodes }) });
    }).catch(() => {});
  };

  const streamUrl = () => {
    const query = new URLSearchParams({ client: installedClientKind || "browser", build: buildLabel(clientBuild) });
    if (!isInstalledClient()) query.set("registration", browserRegistrationId());
    return eventSourceUrl(`/v0/runtime/stream?${query}`);
  };

  const onMessage = (data: string) => {
    lastFrameAt = Date.now();
    if (leading) channel?.postMessage({ type: "frame", data });
    try {
      const event = JSON.parse(data) as RuntimeEvent;
      if (event.type === "ping") {
        if (connectivity() !== "online") { attempts = 0; setConnectivity("online"); replayHeldWrites(); }
      } else if (event.type === "runtime_global_snapshot") {
        // Changes made while away were not heard, so the app reads them again.
        if (heardOnce) window.dispatchEvent(new Event("conduit:runtime-resynced"));
        heardOnce = true;
        replaceAll((event.processes || []) as RuntimeProcess[]);
        takeDevices(event.devices);
        if (event.updates) window.dispatchEvent(new CustomEvent("conduit:updates-offered", { detail: event.updates }));
        if (typeof event.connection === "string") { setConnectionId(event.connection); locate(event.connection); }
        restartPrepared = event.restartPrepared === true;
        if (restartPrepared) prepare(event.restartAttempt, event.restartTarget);
        restartAnnounced = { attempt: event.restartAttempt, target: event.restartTarget };
        attempts = 0;
        if (connectivity() !== "online") replayHeldWrites();
        setConnectivity("online");
      } else if (event.type === "runtime_process" && event.process) {
        upsert(event.process as RuntimeProcess);
      } else if (event.type === "runtime_process_removed") {
        remove(event.id as string | undefined, event.chatId as string | undefined);
      } else if (event.type === "agent_changed") {
        window.dispatchEvent(new Event("conduit:agent-changed"));
      } else if (event.type === "chat_changed" && event.chat) {
        window.dispatchEvent(new CustomEvent("conduit:chat-changed", { detail: event.chat }));
      } else if (event.type === "updates_offered" && event.updates) {
        window.dispatchEvent(new CustomEvent("conduit:updates-offered", { detail: event.updates }));
      } else if (event.type === "devices_changed") {
        takeDevices(event.devices);
      } else if (event.type === "workspace_changed" && Array.isArray(event.projectIds)) {
        window.dispatchEvent(new CustomEvent("conduit:workspace-changed", { detail: event.projectIds }));
      } else if (event.type === "terminal_changed" || event.type === "terminal_removed") {
        window.dispatchEvent(new Event("conduit:ptys-changed"));
      } else if (event.type === "keybindings_changed" && event.overrides && typeof event.overrides === "object") {
        window.dispatchEvent(new CustomEvent("conduit:keybindings-changed", { detail: event.overrides }));
      } else if (event.type === "browser_changed") {
        window.dispatchEvent(new CustomEvent("conduit:browser-changed", { detail: event }));
      } else if (event.type === "ui_command") {
        window.dispatchEvent(new CustomEvent("conduit:ui-command", { detail: event }));
      } else if (event.type === "pwa_restart_prepared") {
        restartPrepared = true;
        prepare(event.attempt, event.target);
        restartAnnounced = { attempt: event.attempt, target: event.target };
      }
    } catch {
      // A malformed global update must not take the app down.
    }
  };
  const lost = () => {
    if (restartPrepared) {
      restartPrepared = false;
      void finishPwaRestart();
    }
  };
  // For a tab arriving after the stream's own snapshot.
  const snapshot = () => JSON.stringify({
    type: "runtime_global_snapshot" satisfies RuntimeEvent["type"],
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
        attempts += 1;
        connect();
      }, 5000);
      (watchdog as unknown as { unref?: () => void }).unref?.();
    }
    setConnectivity(attempts ? "reconnecting" : "connecting");
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
      // A blip is the usual cause, so the first retries come quickly.
      const offline = attempts >= 8;
      channel?.postMessage({ type: "lost", offline });
      setConnectivity(offline ? "offline" : "reconnecting");
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, offline ? 10_000 : Math.min(250 * 2 ** (attempts - 1), 8000));
    };
    if (isInstalledClient()) {
      const controller = new AbortController();
      const next = { close: () => controller.abort() };
      source = next;
      // Without this, a hub that never answers holds "connecting", which reads as reachable, until the watchdog.
      let unanswered = false;
      const answerTimer = setTimeout(() => { unanswered = true; controller.abort(); }, STREAM_ANSWER_TIMEOUT_MS);
      void authorizedFetch(streamUrl(), {
        headers: { accept: "text/event-stream" },
        signal: controller.signal,
      }).then(async (response) => {
        clearTimeout(answerTimer);
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
      }).catch(() => { clearTimeout(answerTimer); if (!controller.signal.aborted || unanswered) onError(next); });
    } else {
      const next = new EventSource(streamUrl());
      source = next;
      next.onmessage = (message) => onMessage(message.data);
      next.onerror = () => onError(next);
    }
  };

  // A stream left on an abandoned route may stop answering silently.
  onPathChange(() => connect());

  // After real time away a stream is likely dead without having said so, so it is replaced rather than trusted.
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
    // For a stop the server accepted: until the stream says so, attaching to the dying process yields no agent.
    forget: (chatId: string) => remove(undefined, chatId),
    retry: connect,
  };
}

export type RuntimeStore = ReturnType<typeof createRuntimeStore>;
