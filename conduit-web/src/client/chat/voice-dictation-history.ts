import { api } from "../api/client";

/** One finished dictation as the hub lists it: its text, what transcribed it, and the sign-in it came from. */
export interface DictationRecord {
  id: string; at: string; text: string; service: "hex" | "hub" | "cloud"; model: string; seconds: number;
  client: { id: string; kind: "browser" | "native" | "script"; userAgent: string | null } | null; here: boolean;
}

export const dictationHistory = async () => (await api<{ entries: DictationRecord[] }>("/v0/voice/history")).entries;
export const clearDictationHistory = () => api("/v0/voice/history", { method: "DELETE" });

// The adapter names what transcribed it: Hex here, Hex on the hub (the hub reports its saved cloud provider even then), or a cloud provider.
export function recordDictation(done: { text: string; adapter: string | null; model: string | null; captureDurationMs: number }) {
  if (!done.text.trim()) return;
  const service = done.adapter === "hex_stream_local" ? "hex" : done.adapter?.startsWith("hex_") ? "hub" : "cloud";
  // Unreachable hub: the dictation still landed in the composer, and only its line in History is lost.
  void api("/v0/voice/history", { method: "POST", body: JSON.stringify({ text: done.text, service, model: done.model || "", seconds: done.captureDurationMs / 1000 }) }).catch(() => {});
}
