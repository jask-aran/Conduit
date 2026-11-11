import { installedClientKind } from "./installed-client";

/** What voice dictation uses of its WebSocket, so Hex on this computer can stand in for the hub. */
export type DictationSocket = Pick<WebSocket, "readyState" | "bufferedAmount" | "binaryType" | "send" | "close" | "onmessage" | "onerror" | "onclose">;

interface HexStream { id: number; ownerToken: string; model: string; partials: boolean }
interface HexEvent { type: string; segment?: number; stable?: string; tentative?: string; text?: string; code?: string; message?: string }

const REFUSALS: Record<string, string> = {
  "stream-busy": "Hex is busy with another live stream.",
  "model-not-loaded": "Hex has no speech model loaded.",
  "lease-expired": "Hex stopped listening: no audio reached it for 10 seconds.",
  "model-changed": "Hex's model changed during the dictation.",
};

/** Whether a Hex with live streams is running on this computer. Only the desktop shell can ask. */
export async function hexAvailable(): Promise<boolean> {
  if (installedClientKind !== "desktop") return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<boolean>("hex_available");
  } catch {
    // A shell built before the command existed.
    return false;
  }
}

export interface HexStatus { state: "absent" | "stopped" | "idle" | "ready"; version: string | null }

/** The Hex on this computer, for Settings. Null where there can be none: a browser tab or the Android app. */
export async function hexStatus(): Promise<HexStatus | null> {
  if (installedClientKind !== "desktop") return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<HexStatus>("hex_status");
  } catch {
    // A shell built before the command existed.
    return { state: await hexAvailable() ? "ready" : "absent", version: null };
  }
}

function base64(bytes: Uint8Array) {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(text);
}

/** Opens a live stream on Hex and speaks the hub's dictation frames over it: partial text is Hex's own. */
export async function openHexDictation(): Promise<DictationSocket> {
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  const onEvent = new Channel<HexEvent>();
  const segments: string[] = [];
  let pending: Uint8Array[] = [];
  let pendingBytes = 0;
  let audioBytes = 0;
  let posting: Promise<void> | null = null;
  let over = false;
  let finishing = false;
  let listener: DictationSocket["onmessage"] = null;
  const tell = (message: Record<string, unknown>) => listener?.call(socket as WebSocket, { data: JSON.stringify(message) } as MessageEvent);
  const text = (open = "") => [...segments, open].filter(Boolean).join(" ");
  const cancel = () => void invoke("hex_stream_cancel", { id: stream.id, ownerToken: stream.ownerToken }).catch(() => {});
  const fail = (reason: unknown) => {
    if (over) return;
    over = true;
    const code = reason instanceof Error ? reason.message : String(reason || "");
    tell({ type: "error", message: REFUSALS[code] || code || "Hex stopped the dictation." });
    cancel();
  };
  // One request at a time keeps the audio in order; what arrives meanwhile goes in the next one.
  const post = (): Promise<void> => posting ||= (async () => {
    while (pending.length && !over) {
      const bytes = new Uint8Array(pendingBytes);
      let offset = 0;
      for (const chunk of pending) { bytes.set(chunk, offset); offset += chunk.length; }
      pending = [];
      pendingBytes = 0;
      await invoke("hex_stream_audio", { id: stream.id, ownerToken: stream.ownerToken, audio: base64(bytes) });
    }
  })().catch(fail).finally(() => { posting = null; });
  const finish = async () => {
    finishing = true;
    tell({ type: "finalizing", timeoutMs: 130_000 });
    try {
      await post();
      const result = await invoke<{ text?: string }>("hex_stream_finish", { id: stream.id, ownerToken: stream.ownerToken });
      if (over) return;
      over = true;
      const final = String(result.text || "").trim();
      tell({ type: "final", text: final });
      tell({
        type: "completed", text: final, final: true, finalWithinDeadline: true, reason: "stopped", audioBytes, audioDurationMs: Math.round(audioBytes / 32),
        adapter: "hex_stream_local", provider: "hex", model: stream.model, inferenceMode: "streaming", backend: "hex",
      });
    } catch (error) { fail(error); }
  };
  const socket: DictationSocket = {
    readyState: WebSocket.OPEN,
    get bufferedAmount() { return pendingBytes; },
    binaryType: "arraybuffer",
    get onmessage() { return listener; },
    // The stream is already open, so the first listener is told at once, as a WebSocket's would be on "open".
    set onmessage(next) {
      const first = !listener;
      listener = next;
      if (first && next && !over) tell({ type: "ready" });
    },
    onerror: null,
    onclose: null,
    send(data) {
      if (over) return;
      if (typeof data === "string") {
        if (JSON.parse(data).type === "stop") void finish();
        return;
      }
      // Copied now: the caller hands its buffer back to the audio worklet.
      const chunk = new Uint8Array(data as ArrayBuffer).slice();
      pending.push(chunk);
      pendingBytes += chunk.length;
      audioBytes += chunk.length;
      void post();
    },
    close() {
      (socket as { readyState: number }).readyState = WebSocket.CLOSED;
      if (over) return;
      over = true;
      cancel();
    },
  };
  onEvent.onmessage = (event) => {
    if (over) return;
    if (event.type === "partial") tell({ type: "partial", text: text(`${event.stable || ""}${event.tentative || ""}`.trim()) });
    else if (event.type === "segment") {
      segments[event.segment ?? segments.length] = String(event.text || "").trim();
      tell({ type: "partial", text: text() });
    } else if (event.type === "error") fail(event.code || event.message);
    // Once stopping, the stream closes by itself and may say so before the finish call answers.
    else if ((event.type === "cancelled" || event.type === "closed") && !finishing) fail("");
  };
  const stream = await invoke<HexStream>("hex_stream_open", { onEvent });
  return socket;
}
