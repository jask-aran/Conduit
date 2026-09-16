import { api } from "../api/client";
import { webSocketUrl } from "../api/transport";
import type { LiveRecord, TranscriptDetail } from "../api/contracts";
import type { RuntimeStore } from "./runtime";

/** What a caller can say about the agent it needs. */
export interface AgentRequest {
  /** Why: the server decides from this whether a process may be started. */
  intent?: string;
  /** Defaults to the open chat and its project. */
  chatId?: string;
  projectId?: string;
  modelOverride?: string;
  thinkingOverride?: string;
  /** A live record somebody else opened, with the history it brings. */
  record?: LiveRecord;
  detail?: TranscriptDetail;
}

/**
 * A chat's connection to its agent: the process, the stream, and the reconnect.
 *
 * This is the whole of the lifecycle and nothing else. It does not hold a
 * transcript, a generation or a draft, and it does not decide what the UI says
 * about any of them -- the server publishes a process as it spawns and again
 * when the harness can answer, and the sidebar and composer read that. It used
 * to live inside the chat store alongside all of those, sharing four mutable
 * tokens with them, and every "why is it still spinning" bug came from that
 * sharing.
 *
 * Every way a chat gets an agent arrives at `ensure`: selecting a chat, sending
 * into one, a reconnect, and a harness thread whose record somebody else
 * opened. Concurrent callers for one chat share a single attempt, so a click
 * and a send that land together cannot race into two processes.
 */
export function createAgentSession(deps: {
  runtime: RuntimeStore;
  /** The chat this session is allowed to act for, and the project that owns it. */
  chatId: () => string | null;
  projectId: () => string;
  /** What to launch with, when the caller does not override it. */
  model: () => string;
  thinkingLevel: () => string;
  /** A live record was adopted: capabilities, usage and identity travel with it. */
  onRecord: (record: LiveRecord, chatId: string) => void;
  /** History that came with an adopted record, for a thread with no Conduit chat. */
  onDetail: (detail: TranscriptDetail, chatId: string) => void;
  /** One frame from the live stream, for the chat it belongs to. */
  onEvent: (data: string, chatId: string) => void;
  /** The chat has no agent: none running, or the one it had is gone. */
  onLost: () => void;
  onError: (error: unknown) => void;
}) {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  let reconnectToken = 0;
  // The launch request in flight, if any. It is abandoned when the session moves
  // on: a cold start holds a connection for as long as the harness takes to come
  // up, and opening several chats in a row left enough of them stranded that the
  // next chat's own requests queued behind chats nobody was looking at any more.
  // Abandoning it does not stop the launch -- the server finishes warming the
  // process and the runtime stream reports it -- it only frees the connection.
  let launchRequest: AbortController | null = null;
  /** The single in-flight attempt to give a chat an agent, shared by every caller. */
  let pending: { chatId: string; attempt: Promise<LiveRecord | null> } | null = null;
  /** Bumped whenever the session is pointed somewhere else; stale work checks it. */
  let epoch = 0;

  const cancelReconnect = () => {
    reconnectToken += 1;
    reconnectAttempts = 0;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

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
    cancelReconnect();
    socket?.close();
    const next = new WebSocket(await webSocketUrl(record.streamUrl || `/v0/live-sessions/${record.id}/stream`));
    socket = next;
    next.onmessage = ({ data }) => {
      if (socket !== next || era !== epoch || deps.chatId() !== chatId) return;
      deps.onEvent(String(data), chatId);
    };
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
    current.addEventListener("open", () => resolve(), { once: true });
    current.addEventListener("error", () => reject(new Error("The live stream failed. Try again.")), { once: true });
    current.addEventListener("close", () => reject(new Error("The live stream closed before it connected.")), { once: true });
  });

  /** The record for a process the runtime stream already knows about. */
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

  /** Ask the server for a process, and take the record it answers with. */
  const launchRecord = (chatId: string, ownerProjectId: string, request: AgentRequest) => {
    launchRequest?.abort();
    const abortable = launchRequest = new AbortController();
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
    });
  };

  const ensure = async (request: AgentRequest = {}): Promise<LiveRecord | null> => {
    const chatId = request.chatId || deps.chatId();
    if (!chatId) throw new Error("Chat is not ready yet");
    const supplied = request.record;
    if (!supplied) {
      if (isOpen() && deps.chatId() === chatId) return pendingRecord;
      if (pending?.chatId === chatId) return pending.attempt;
    }
    const era = epoch;
    const intent = request.intent || "open";
    const current = () => era === epoch && deps.chatId() === chatId;

    const adopt = (record: LiveRecord) => {
      pendingRecord = { ...record, chatId };
      deps.onRecord(pendingRecord, chatId);
    };

    const attempt = (async (): Promise<LiveRecord | null> => {
      try {
        // A record somebody else opened - a harness thread driven from the
        // Computer - brings its own settled history, because there is no
        // Conduit chat holding it.
        if (supplied) {
          if (request.detail) deps.onDetail(request.detail, chatId);
          adopt(supplied);
          await connect({ ...supplied, chatId }, chatId, era);
          return supplied;
        }
        // The runtime stream is the server's process catalogue, so a process it
        // already knows about needs no request at all.
        const resident = residentRecord(chatId);
        if (resident) {
          adopt(resident);
          try {
            await connect(resident, chatId, era);
            await waitForSocket();
            return current() ? resident : null;
          } catch {
            // The stream refused: the view was stale, so ask properly below.
            detach();
          }
        }
        const record = await launchRecord(chatId, request.projectId || deps.projectId(), request);
        if (!current()) return null;
        adopt(record);
        await connect(record, chatId, era);
        await waitForSocket();
        return current() ? record : null;
      } catch (error) {
        // The session moved on and took the request with it; the launch it
        // asked for is still the server's business, not an error to report.
        if ((error as Error | null)?.name === "AbortError") return null;
        if (!current()) return null;
        // Being told there is no process is an answer, not a failure: an "open"
        // may attach to one but never start one, and the chat is simply not
        // live. Returning rather than throwing also settles the reconnect
        // timer, so a process the reaper stopped stays stopped.
        if ((error as { error?: string } | null)?.error === "no_live_process") {
          pendingRecord = null;
          deps.onLost();
          return null;
        }
        throw error;
      }
    })();

    if (!supplied) pending = { chatId, attempt };
    try { return await attempt; }
    finally { if (pending?.attempt === attempt) pending = null; }
  };

  /** For the paths that cannot proceed without one: sending, steering, compacting. */
  const require = async (intent: string) => {
    const record = await ensure({ intent });
    if (!record) throw new Error("Chat switched before the agent was ready");
    return record;
  };

  let pendingRecord: LiveRecord | null = null;

  const isOpen = () => socket?.readyState === WebSocket.OPEN;

  /** Drop the stream without giving up on the process behind it. */
  const detach = () => {
    cancelReconnect();
    socket?.close();
    socket = null;
    pendingRecord = null;
    deps.onLost();
  };

  const send = (command: UnknownCommand) => {
    if (!isOpen()) throw new Error("Not connected to the live session");
    socket!.send(JSON.stringify(command));
  };

  /** Send if the stream is up, otherwise get an agent first. */
  const sendWhenReady = (command: UnknownCommand, intent = "open") => {
    if (isOpen()) return send(command);
    void require(intent).then(() => send(command)).catch(deps.onError);
  };

  /** Point the session at a different chat: everything in flight is abandoned. */
  const reset = () => {
    epoch += 1;
    cancelReconnect();
    launchRequest?.abort();
    launchRequest = null;
    pending = null;
    pendingRecord = null;
    socket?.close();
    socket = null;
  };

  const resume = () => {
    if (document.visibilityState === "hidden") return;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
    const chatId = deps.chatId();
    if (pendingRecord && chatId && pendingRecord.chatId === chatId) {
      void connect(pendingRecord, chatId, epoch).catch(deps.onError);
    }
  };
  const restore = (event: PageTransitionEvent) => { if (event.persisted) resume(); };
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("pageshow", restore);
  window.addEventListener("online", resume);

  const dispose = () => {
    reset();
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("pageshow", restore);
    window.removeEventListener("online", restore as unknown as EventListener);
  };

  return { ensure, require, send, sendWhenReady, isOpen, detach, reset, dispose, cancelReconnect };
}

type UnknownCommand = Record<string, unknown>;

export type AgentSession = ReturnType<typeof createAgentSession>;
