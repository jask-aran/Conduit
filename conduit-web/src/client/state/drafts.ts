import { createSignal } from "solid-js";
import { api, apiWhenServed, asList } from "../api/client";
import { activeOrigin } from "../platform/servers";

export interface DraftEntry { text: string; attachmentIds: string[]; savedAt: string }
/**
 * `unflushed` is the whole of the merge rule, deliberately not a timestamp: the local `savedAt` is this device's clock
 * and the server replaces it with its own, so comparing them would compare two machines' clocks.
 */
interface LocalDraft extends DraftEntry { unflushed: boolean }
export interface StashEntry extends DraftEntry { id: string; chatId: string }

const SAVE_DEBOUNCE_MS = 400;
/** Nothing removes the local copy of a chat deleted from another client, so without a bound these accumulate. */
const LOCAL_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/*
 * The server copy is written behind a debounce and over a network, neither of which survives the document being
 * replaced, so every keystroke is also written here synchronously. Keyed by server as well as chat: an installed
 * client holds one origin and several servers, which could agree on a chat id.
 */
const LOCAL_PREFIX = "conduit:draft:";
const localKey = (chatId: string) => `${LOCAL_PREFIX}${activeOrigin() || ""}:${chatId}`;

/** Absent while rendering off a browser, and it throws rather than returning null when site data is blocked. */
function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

function writeLocal(chatId: string, entry: DraftEntry | null, unflushed = true) {
  const store = storage();
  if (!store) return;
  try {
    if (entry) store.setItem(localKey(chatId), JSON.stringify({ ...entry, unflushed }));
    else store.removeItem(localKey(chatId));
  } catch {}
}

/**
 * Only if it is still the same copy: a keystroke between the PUT leaving and its answer arriving has written a newer
 * one, and calling that flushed would lose it.
 */
function markFlushed(chatId: string, entry: DraftEntry) {
  const store = storage();
  if (!store) return;
  try {
    const held = validEntry(JSON.parse(store.getItem(localKey(chatId)) || "null"));
    if (!held || held.savedAt !== entry.savedAt) return;
    store.setItem(localKey(chatId), JSON.stringify({ ...held, unflushed: false }));
  } catch {}
}

function validEntry(value: unknown): DraftEntry | null {
  const entry = value as Partial<DraftEntry> | null;
  if (!entry || typeof entry.text !== "string" || typeof entry.savedAt !== "string") return null;
  if (!Number.isFinite(Date.parse(entry.savedAt))) return null;
  const attachmentIds = Array.isArray(entry.attachmentIds) ? entry.attachmentIds.filter((id) => typeof id === "string") : [];
  return { text: entry.text, attachmentIds, savedAt: entry.savedAt };
}

function readLocal(): Map<string, LocalDraft> {
  const found = new Map<string, LocalDraft>();
  const store = storage();
  if (!store) return found;
  const prefix = `${LOCAL_PREFIX}${activeOrigin() || ""}:`;
  const cutoff = Date.now() - LOCAL_DRAFT_TTL_MS;
  let keys: string[] = [];
  try { keys = Object.keys(store); } catch { return found; }
  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const chatId = key.slice(prefix.length);
    let entry: DraftEntry | null = null;
    let unflushed = false;
    try {
      const raw = JSON.parse(store.getItem(key) || "null");
      entry = validEntry(raw);
      // Absent reads as flushed: it defers to the server rather than overwriting it from a device that may have been off.
      unflushed = (raw as { unflushed?: unknown } | null)?.unflushed === true;
    } catch { entry = null; }
    if (!entry || Date.parse(entry.savedAt) < cutoff) {
      try { store.removeItem(key); } catch {}
      continue;
    }
    found.set(chatId, { ...entry, unflushed });
  }
  return found;
}


/** The map is written before the debounce fires: a chat switch happens well inside it, and restoring has to see the text just typed. */
export function createDrafts(onError: (error: unknown) => void) {
  const [stash, setStash] = createSignal<StashEntry[]>([]);
  const drafts = new Map<string, DraftEntry>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const entryFor = (text: string, attachmentIds: string[]): DraftEntry | null =>
    text.trim() || attachmentIds.length ? { text, attachmentIds, savedAt: new Date().toISOString() } : null;

  /*
   * Something replacing the page asks whether a draft is in flight, or it reloads between a send and its clear and
   * brings the sent text back on the next load.
   */
  const [inFlight, setInFlight] = createSignal(0);

  const flush = async (chatId: string, entry: DraftEntry | null) => {
    setInFlight((value) => value + 1);
    try {
      // Not replayed: the unflushed local copy is reconciled on load, and a held PUT would keep `settled()` false, and a
      // page replacement waiting, for as long as the hub is away.
      await api(`/v0/chats/${encodeURIComponent(chatId)}/draft`, {
        method: "PUT",
        replay: false,
        body: JSON.stringify({ text: entry?.text ?? "", attachmentIds: entry?.attachmentIds ?? [] }),
      });
      if (entry) markFlushed(chatId, entry);
    } catch (error) { onError(error); }
    finally { setInFlight((value) => Math.max(0, value - 1)); }
  };

  const settled = () => timers.size === 0 && inFlight() === 0;

  /*
   * The local copy wins only when unflushed: an acknowledged one may have been superseded from another device. A chat
   * with a timer pending is skipped: what was typed this session is on its way and neither stored copy has it.
   */
  const load = async () => {
    const local = readLocal();
    for (const [chatId, entry] of local) {
      if (!timers.has(chatId)) drafts.set(chatId, entry);
    }
    try {
      const payload = await apiWhenServed<{ drafts?: Record<string, DraftEntry>; stash?: StashEntry[] }>("/v0/drafts");
      for (const [chatId, raw] of Object.entries(payload.drafts || {})) {
        if (timers.has(chatId)) continue;
        const saved = validEntry(raw);
        if (!saved) continue;
        const mine = local.get(chatId);
        const recovered = mine?.unflushed ? mine : null;
        drafts.set(chatId, recovered ?? saved);
        // Written back: a recovered draft only here would be lost again by the next device to save over it.
        if (recovered) void flush(chatId, recovered);
        else writeLocal(chatId, saved, false);
      }
      for (const [chatId, entry] of local) {
        if (timers.has(chatId) || chatId in (payload.drafts || {})) continue;
        if (entry.unflushed) void flush(chatId, entry);
        // Acknowledged and now absent means cleared or deleted elsewhere; sending it back would undo that.
        else { drafts.delete(chatId); writeLocal(chatId, null); }
      }
      setStash(asList<StashEntry>(payload.stash));
    } catch (error) { onError(error); }
  };

  const draftFor = (chatId: string) => drafts.get(chatId) ?? null;

  const save = (chatId: string, text: string, attachmentIds: string[]) => {
    if (!chatId) return;
    const entry = entryFor(text, attachmentIds);
    if (entry) drafts.set(chatId, entry); else drafts.delete(chatId);
    // Before the debounce: this write has to survive the page being replaced mid-sentence.
    writeLocal(chatId, entry);
    const pending = timers.get(chatId);
    if (pending) clearTimeout(pending);
    timers.set(chatId, setTimeout(() => {
      timers.delete(chatId);
      void flush(chatId, entry);
    }, SAVE_DEBOUNCE_MS));
  };

  const clear = (chatId: string) => {
    if (!chatId) return;
    const pending = timers.get(chatId);
    if (pending) { clearTimeout(pending); timers.delete(chatId); }
    // Cleared even when the map has nothing: the local copy can outlive this session's map.
    writeLocal(chatId, null);
    if (!drafts.has(chatId)) return;
    drafts.delete(chatId);
    void flush(chatId, null);
  };

  /** No PUT: it would write a draft for a chat that no longer exists. */
  const forget = (chatId: string) => {
    if (!chatId) return;
    const pending = timers.get(chatId);
    if (pending) { clearTimeout(pending); timers.delete(chatId); }
    drafts.delete(chatId);
    writeLocal(chatId, null);
  };

  const park = async (chatId: string, text: string, attachmentIds: string[]) => {
    const pending = timers.get(chatId);
    if (pending) { clearTimeout(pending); timers.delete(chatId); }
    try {
      const payload = await api<{ entry: StashEntry }>("/v0/stash", {
        method: "POST",
        body: JSON.stringify({ chatId, text, attachmentIds }),
      });
      drafts.delete(chatId);
      writeLocal(chatId, null);
      setStash((current) => [payload.entry, ...current]);
      return payload.entry;
    } catch (error) { onError(error); return null; }
  };

  const restore = async (id: string) => {
    try {
      const payload = await api<{ entry: StashEntry }>(`/v0/stash/${encodeURIComponent(id)}/restore`, { method: "POST" });
      setStash((current) => current.filter((entry) => entry.id !== id));
      return payload.entry;
    } catch (error) { onError(error); return null; }
  };

  const discard = async (id: string) => {
    try {
      await api(`/v0/stash/${encodeURIComponent(id)}`, { method: "DELETE" });
      setStash((current) => current.filter((entry) => entry.id !== id));
      return true;
    } catch (error) { onError(error); return false; }
  };

  return { load, stash, draftFor, save, clear, forget, settled, park, restore, discard };
}

export type DraftsStore = ReturnType<typeof createDrafts>;
