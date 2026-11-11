import { createSignal } from "solid-js";

/** What one finished dictation was and what transcribed it. Kept on this device only: Hex's dictations never reach the hub. */
export interface DictationRecord { at: number; text: string; source: "hex" | "hub" | "cloud"; model: string; seconds: number }

const KEY = "conduit:voice-dictation-history";
const KEPT = 20;

function load(): DictationRecord[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") as DictationRecord[]; } catch { return []; }
}

const [history, setHistory] = createSignal(load());
export { history as dictationHistory };

function keep(records: DictationRecord[]) {
  setHistory(records);
  try { localStorage.setItem(KEY, JSON.stringify(records)); } catch { /* Storage is full or blocked: the list lasts until reload. */ }
}

// The adapter names what transcribed it: Hex here, Hex on the hub (the hub reports its saved cloud provider even then), or a cloud provider.
export function recordDictation(done: { text: string; adapter: string | null; model: string | null; captureDurationMs: number }) {
  if (!done.text.trim()) return;
  const source: DictationRecord["source"] = done.adapter === "hex_stream_local" ? "hex" : done.adapter?.startsWith("hex_") ? "hub" : "cloud";
  keep([{ at: Date.now(), text: done.text.trim(), source, model: done.model || "", seconds: Math.round(done.captureDurationMs / 1000) }, ...history()].slice(0, KEPT));
}

export const clearDictationHistory = () => keep([]);
