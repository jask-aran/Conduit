import { createSignal } from "solid-js";
import { api } from "../api/client";
import { webSocketUrl } from "../api/transport";
import type { LiveRecord, TranscriptDetail } from "../api/contracts";
import type { RuntimeStore } from "./runtime";
import { createLatest } from "./latest";
import { frameIntervalMs } from "../frame-interval";
import { clientId } from "../agent-ui";
import { liveCommandIs, type LIVE_COMMANDS } from "../../live-session-api.js";
import { onPathChange } from "../platform/servers";


export const RESUME_RECONNECT_AFTER_MS = 5_000;
export interface AgentRequest {
  /** The server decides from this whether a process may be started. */
  intent?: string;
  chatId?: string;
  projectId?: string;
  modelOverride?: string;
  thinkingOverride?: string;
  record?: LiveRecord;
  detail?: TranscriptDetail;
}

/**
 * A chat's connection to its agent: the process, the stream, and the reconnect. It holds no transcript, generation
 * or draft. Concurrent `ensure` callers for one chat share a single attempt, so a click and a send that land
 * together cannot race into two processes.
 */
export function createAgentSession(deps: {
  runtime: RuntimeStore;
  chatId: () => string | null;
  projectId: () => string;
  model: () => string;
  thinkingLevel: () => string;
  onRecord: (record: LiveRecord, chatId: string) => void;
  onDetail: (detail: TranscriptDetail, chatId: string) => void;
  onEvent: (data: string, chatId: string) => void;
  onLost: () => void;
  onAbsent: (chatId: string) => void;
  onError: (error: unknown) => void;
}) {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let reconnectToken = 0;
  // Abandoned when the session moves on: a cold start holds a connection while the harness comes up, and stranded
  // ones queue the next chat's requests. Aborting only frees the connection; the server still finishes the launch.
  let launchRequest: AbortController | null = null;
  const launchToken = createLatest();
  /** Set when the launch request goes out and cleared when it answers; the server's record takes over after. */
  const [launching, setLaunching] = createSignal<string | null>(null);
  let pending: { chatId: string; attempt: Promise<LiveRecord | null> } | null = null;
  /** Bumped whenever the session is pointed somewhere else; stale work checks it. */
  let epoch = 0;
  const connectToken = createLatest();

  const cancelReconnect = () => {
    reconnectToken += 1;
    reconnectAttempts = 0;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  // Only the route changed, so the reconnect rebuilds the socket on the new one; the backoff resets because this
  // is a deliberate move, not a failure.
  onPathChange(() => {
    const current = socket;
    if (!current) return;
    reconnectAttempts = 0;
    current.close();
  });

  const scheduleReconnect = (chatId: string, era: number) => {
    if (reconnectTimer || era !== epoch || deps.chatId() !== chatId) return;
    const token = reconnectToken;
    const delay = Math.min(250 * 2 ** Math.min(reconnectAttempts, 5), 8_000);
    reconnectAttempts += 1;
    reconnectTimer = setTimeout(async () => {
      reconnectTimer = null;
      if (token !== reconnectToken || era !== epoch || deps.chatId() !== chatId) return;
      try {
        await ensure({ chatId, intent: "open" });
        reconnectAttempts = 0;
      } catch {
        if (token === reconnectToken) scheduleReconnect(chatId, era);
      }
    }, delay);
  };

  const connect = async (record: LiveRecord, chatId: string, era: number) => {
    if (era !== epoch || deps.chatId() !== chatId) return;
    const token = connectToken.next();
    cancelReconnect();
    let url: string;
    try { url = await webSocketUrl(record.streamUrl || `/v0/live-sessions/${record.id}/stream`); }
    catch (error) {
      if (era !== epoch || deps.chatId() !== chatId || !token()) return;
      throw error;
    }
    if (era !== epoch || deps.chatId() !== chatId || !token()) return;
    const previous = socket;
    const next = new WebSocket(url);
    socket = next;
    previous?.close();
    next.onmessage = ({ data }) => {
      if (socket !== next || era !== epoch || deps.chatId() !== chatId) return;
      deps.onEvent(String(data), chatId);
    };
    // Optional: the server keeps its own default until told, and clamps what it is told.
    next.addEventListener("open", () => {
      if (socket !== next) return;
      void frameIntervalMs().then((ms) => {
        if (socket !== next || next.readyState !== WebSocket.OPEN) return;
        try { next.send(JSON.stringify({ type: "frame_interval", ms })); } catch { /* paced by the default */ }
      });
    });
    next.addEventListener("close", () => {
      if (socket !== next) return;
      socket = null;
      scheduleReconnect(chatId, era);
    });
  };

  const waitForSocket = () => new Promise<void>((resolve, reject) => {
    const current = socket;
    if (!current) return reject(new Error("Could not connect to the agent"));
    if (current.readyState === WebSocket.OPEN) return resolve();
    if (current.readyState === WebSocket.CLOSING || current.readyState === WebSocket.CLOSED) {
      return reject(new Error("The live stream closed before it connected."));
    }
    const failed = (message: string) => {
      // A replaced socket must not make its waiter detach the new stream.
      if (socket && socket !== current) void waitForSocket().then(resolve, reject);
      else reject(new Error(message));
    };
    current.addEventListener("open", () => resolve(), { once: true });
    current.addEventListener("error", () => failed("The live stream failed. Try again."), { once: true });
    current.addEventListener("close", () => failed("The live stream closed before it connected."), { once: true });
  });

  const residentRecord = (chatId: string): LiveRecord | null => {
    const resident = deps.runtime.getProcess(chatId);
    if (!resident?.id || resident.status === "stopped" || resident.status === "none") return null;
    return {
      id: resident.id,
      chatId,
      streamUrl: `/v0/live-sessions/${resident.id}/stream`,
      runtime: resident.runtime,
      capabilities: resident.capabilities,
      contextUsage: resident.contextUsage,
      sessionStats: resident.sessionStats,
      cacheStats: resident.cacheStats,
    };
  };

  const launchRecord = (chatId: string, ownerProjectId: string, request: AgentRequest) => {
    launchRequest?.abort();
    const abortable = launchRequest = new AbortController();
    const token = launchToken.next();
    setLaunching(chatId);
    return api<LiveRecord>("/v0/live-sessions", {
      method: "POST",
      signal: abortable.signal,
      body: JSON.stringify({
        chatId,
        projectId: ownerProjectId,
        model: request.modelOverride ?? deps.model(),
        thinkingLevel: request.thinkingOverride ?? deps.thinkingLevel(),
        intent: request.intent || "open",
      }),
    }).finally(() => { if (token()) setLaunching(null); });
  };

  const ensure = async (request: AgentRequest = {}): Promise<LiveRecord | null> => {
    const chatId = request.chatId || deps.chatId();
    if (!chatId) throw new Error("Chat is not ready yet");
    const supplied = request.record;
    if (!supplied) {
      if (isOpen() && deps.chatId() === chatId) return pendingRecord;
      // A record handed over -- a driven thread -- has no chat to launch, so a
      // prompt sent while its stream is still opening waits for that stream.
      if (socket?.readyState === WebSocket.CONNECTING && pendingRecord && deps.chatId() === chatId) {
        await waitForSocket();
        return pendingRecord;
      }
      if (pending?.chatId === chatId) return pending.attempt;
    }
    const era = epoch;
    const current = () => era === epoch && deps.chatId() === chatId;

    const adopt = (record: LiveRecord) => {
      pendingRecord = { ...record, chatId };
      deps.onRecord(pendingRecord, chatId);
    };

    const attempt = (async (): Promise<LiveRecord | null> => {
      try {
        if (supplied) {
          if (request.detail) deps.onDetail(request.detail, chatId);
          adopt(supplied);
          await connect({ ...supplied, chatId }, chatId, era);
          return current() ? supplied : null;
        }
        const resident = residentRecord(chatId);
        if (resident) {
          adopt(resident);
          try {
            await connect(resident, chatId, era);
            if (!current()) return null;
            await waitForSocket();
            return current() ? resident : null;
          } catch {
            if (!current()) return null;
            // The stream refused: the view was stale, so ask properly below.
            detach();
          }
        }
        const record = await launchRecord(chatId, request.projectId || deps.projectId(), request);
        if (!current()) return null;
        adopt(record);
        await connect(record, chatId, era);
        if (!current()) return null;
        await waitForSocket();
        return current() ? record : null;
      } catch (error) {
        if ((error as Error | null)?.name === "AbortError") return null;
        if (!current()) return null;
        // An "open" may attach but never start a process. Returning rather than throwing settles the reconnect
        // timer, so a process the reaper stopped stays stopped.
        if ((error as { error?: string } | null)?.error === "no_live_process") {
          pendingRecord = null;
          deps.onLost();
          deps.onAbsent(chatId);
          return null;
        }
        throw error;
      }
    })();

    if (!supplied) pending = { chatId, attempt };
    try { return await attempt; }
    finally { if (pending?.attempt === attempt) pending = null; }
  };

  const require = async (intent: string) => {
    const record = await ensure({ intent });
    if (!record) throw new Error("Chat switched before the agent was ready");
    return record;
  };

  let pendingRecord: LiveRecord | null = null;

  const isOpen = () => socket?.readyState === WebSocket.OPEN;

  const detach = () => {
    connectToken.drop();
    cancelReconnect();
    socket?.close();
    socket = null;
    pendingRecord = null;
    deps.onLost();
  };

  const send = (command: LiveCommand) => {
    if (!isOpen()) throw new Error("Not connected to the live session");
    // The sending client is where the agent shows things.
    const origin = liveCommandIs(command.type, "origin") ? clientId() : "";
    socket!.send(JSON.stringify(origin ? { ...command, client: origin } : command));
  };

  const sendWhenReady = (command: LiveCommand, intent = "open") => {
    if (isOpen()) return send(command);
    void require(intent).then(() => send(command)).catch(deps.onError);
  };

  const reset = () => {
    epoch += 1;
    connectToken.drop();
    cancelReconnect();
    launchRequest?.abort();
    launchRequest = null;
    launchToken.drop();
    setLaunching(null);
    pending = null;
    pendingRecord = null;
    socket?.close();
    socket = null;
  };

  // A socket the OS cut in the background still says OPEN until TCP gives up minutes later, so after real time
  // away it is replaced rather than trusted.
  let hiddenAt = 0;
  const resume = (force = false) => {
    if (document.visibilityState === "hidden") { hiddenAt ||= Date.now(); return; }
    const away = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    const live = socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);
    if (live && !force && away < RESUME_RECONNECT_AFTER_MS) return;
    const chatId = deps.chatId();
    if (pendingRecord && chatId && pendingRecord.chatId === chatId) {
      reconnectAttempts = 0;
      const era = epoch;
      void connect(pendingRecord, chatId, era).catch((error) => {
        if (era !== epoch || deps.chatId() !== chatId) return;
        // The connect cancelled any reconnect; closing the untrusted socket (or asking for one) restarts the backoff.
        if (socket) socket.close();
        else scheduleReconnect(chatId, era);
        deps.onError(error);
      });
    }
  };
  const onVisibility = () => resume();
  const restore = (event: PageTransitionEvent) => { if (event.persisted) resume(true); };
  // The network came back: whatever the socket says, it predates that.
  const online = () => resume(true);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", restore);
  window.addEventListener("online", online);

  const dispose = () => {
    reset();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", restore);
    window.removeEventListener("online", online);
  };

  return { ensure, require, send, sendWhenReady, isOpen, launching, detach, reset, dispose, cancelReconnect };
}

type LiveCommand = { type: keyof typeof LIVE_COMMANDS } & Record<string, unknown>;

