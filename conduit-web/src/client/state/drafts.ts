import { createSignal } from "solid-js";
import { api, apiWhenServed, asList } from "../api/client";
import { activeOrigin } from "../platform/servers";

export interface DraftEntry { text: string; attachmentIds: string[]; savedAt: string }
/**
 * A local copy, and whether the server has it yet.
 *
 * `unflushed` is the whole of the merge rule, and it is deliberately not a
 * timestamp. The local `savedAt` comes from this device's clock and the server
 * replaces it with its own on every save, so comparing them compares two
 * machines: a client running five minutes slow loses text it just typed, and
 * one running five minutes fast overwrites a newer draft from another device
 * with a stale one. What actually matters is not which is later but whether
 * this copy is a save that never completed -- which is the only reason the
 * local copy exists.
 */
interface LocalDraft extends DraftEntry { unflushed: boolean }
export interface StashEntry extends DraftEntry { id: string; chatId: string }

const SAVE_DEBOUNCE_MS = 400;
/**
 * How long an unsent draft is kept locally before it is treated as litter.
 *
 * Nothing removes the local copy of a chat that was deleted from another
 * client, so without a bound these accumulate for the life of the browser
 * profile. A month is long past the point where a draft is still the thing
 * somebody meant to send.
 */
const LOCAL_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/*
 * The local half of a draft.
 *
 * The server copy is the durable one, but it is written behind a debounce and
 * over a network, and neither of those survives the document being replaced --
 * which a service worker update, a crash or a closed tab all do. So every
 * keystroke is also written here, synchronously, where a reload cannot take
 * it. It is a safety net under the server copy rather than a second authority:
 * on load the newer of the two wins, and if that is the local one the server
 * is told.
 *
 * Keyed by server as well as chat. An installed client holds one origin and
 * several servers, so an unscoped key would show one server's draft in another
 * server's chat if the two ever agreed on a chat id.
 */
const LOCAL_PREFIX = "conduit:draft:";
const localKey = (chatId: string) => `${LOCAL_PREFIX}${activeOrigin() || ""}:${chatId}`;

/**
 * Absent while rendering off a browser, and it throws rather than returning
 * null when site data is blocked -- both are the same answer here, which is
 * that the net is not there and the server copy is on its own.
 */
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
  } catch { /* quota, or a profile that refuses to store anything */ }
}

/**
 * Mark a local copy as one the server now has.
 *
 * Only if it is still the same copy: a keystroke between the PUT leaving and
 * its answer arriving has already written a newer one, and calling that
 * flushed would lose exactly the text this is here to protect.
 */
function markFlushed(chatId: string, entry: DraftEntry) {
  const store = storage();
  if (!store) return;
  try {
    const held = validEntry(JSON.parse(store.getItem(localKey(chatId)) || "null"));
    if (!held || held.savedAt !== entry.savedAt) return;
    store.setItem(localKey(chatId), JSON.stringify({ ...held, unflushed: false }));
  } catch { /* the copy is gone, or unreadable; nothing to mark */ }
}

function validEntry(value: unknown): DraftEntry | null {
  const entry = value as Partial<DraftEntry> | null;
  if (!entry || typeof entry.text !== "string" || typeof entry.savedAt !== "string") return null;
  if (!Number.isFinite(Date.parse(entry.savedAt))) return null;
  const attachmentIds = Array.isArray(entry.attachmentIds) ? entry.attachmentIds.filter((id) => typeof id === "string") : [];
  return { text: entry.text, attachmentIds, savedAt: entry.savedAt };
}

/** Every local draft for the server being talked to, the stale ones dropped. */
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
      // Absent on a copy written before this flag existed. Treated as flushed,
      // which is the safe reading: it defers to the server rather than
      // overwriting it from a device that may have been off for a while.
      unflushed = (raw as { unflushed?: unknown } | null)?.unflushed === true;
    } catch { entry = null; }
    if (!entry || Date.parse(entry.savedAt) < cutoff) {
      try { store.removeItem(key); } catch { /* nothing to do about it */ }
      continue;
    }
    found.set(chatId, { ...entry, unflushed });
  }
  return found;
}


/**
 * Composer drafts, kept per chat on the server so leaving a chat no longer
 * discards what was typed, plus the parked prompts the stash shortcut manages.
 *
 * The local map is written before the debounce fires: a chat switch happens
 * well inside 400ms, and restoring has to see the text that was just typed.
 */
export function createDrafts(onError: (error: unknown) => void) {
  const [stash, setStash] = createSignal<StashEntry[]>([]);
  const drafts = new Map<string, DraftEntry>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const entryFor = (text: string, attachmentIds: string[]): DraftEntry | null =>
    text.trim() || attachmentIds.length ? { text, attachmentIds, savedAt: new Date().toISOString() } : null;

  /*
   * Writes that have left but not landed.
   *
   * Something replacing the page has to be able to ask whether a draft is
   * still in flight, or it will reload between a send and its clear and bring
   * the sent text back on the next load.
   */
  const [inFlight, setInFlight] = createSignal(0);

  const flush = async (chatId: string, entry: DraftEntry | null) => {
    setInFlight((value) => value + 1);
    try {
      await api(`/v0/chats/${encodeURIComponent(chatId)}/draft`, {
        method: "PUT",
        body: JSON.stringify({ text: entry?.text ?? "", attachmentIds: entry?.attachmentIds ?? [] }),
      });
      if (entry) markFlushed(chatId, entry);
    } catch (error) { onError(error); }
    finally { setInFlight((value) => Math.max(0, value - 1)); }
  };

  /** Whether anything is unsaved: a debounce still counting, or a PUT in the air. */
  const settled = () => timers.size === 0 && inFlight() === 0;

  /*
   * Reconcile the two copies, per chat.
   *
   * The local copy wins only when it is a save that never completed, which is
   * the one case it exists for. A local copy the server acknowledged is not
   * evidence of anything -- the server has it, and may have had something
   * newer from another device since -- so it defers.
   *
   * A chat with a timer pending is skipped outright: something has been typed
   * in this session and is already on its way, and neither stored copy knows
   * about it.
   */
  const load = async () => {
    const local = readLocal();
    for (const [chatId, entry] of local) {
      if (!timers.has(chatId)) drafts.set(chatId, entry);
    }
    // Shown from the local copy first, then reconciled below: a draft the
    // person can see while the request is in the air beats a correct one they
    // cannot.
    try {
      const payload = await apiWhenServed<{ drafts?: Record<string, DraftEntry>; stash?: StashEntry[] }>("/v0/drafts");
      for (const [chatId, raw] of Object.entries(payload.drafts || {})) {
        if (timers.has(chatId)) continue;
        const saved = validEntry(raw);
        if (!saved) continue;
        const mine = local.get(chatId);
        const recovered = mine?.unflushed ? mine : null;
        drafts.set(chatId, recovered ?? saved);
        // Written back rather than left local: the server copy is the one
        // every other client reads, and a recovered draft that only exists
        // here would be lost again by the next device to save over it.
        if (recovered) void flush(chatId, recovered);
        else writeLocal(chatId, saved, false);
      }
      // A local draft the server has never heard of is a save that never
      // completed. It is already in the map above; this is what makes it
      // durable.
      for (const [chatId, entry] of local) {
        if (timers.has(chatId) || chatId in (payload.drafts || {})) continue;
        if (entry.unflushed) void flush(chatId, entry);
        // Acknowledged once and now absent from the server means it was
        // cleared or its chat was deleted elsewhere. Sending it back would
        // undo that.
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
    // Before the debounce, not after it: this write is the one that has to
    // survive the page being replaced mid-sentence.
    writeLocal(chatId, entry);
    const pending = timers.get(chatId);
    if (pending) clearTimeout(pending);
    timers.set(chatId, setTimeout(() => {
      timers.delete(chatId);
      void flush(chatId, entry);
    }, SAVE_DEBOUNCE_MS));
  };

  /** Sending or discarding must not wait out the debounce. */
  const clear = (chatId: string) => {
    if (!chatId) return;
    const pending = timers.get(chatId);
    if (pending) { clearTimeout(pending); timers.delete(chatId); }
    // Cleared even when the map has nothing, because the local copy can
    // outlive this session's map -- a draft restored from storage and then
    // sent would otherwise come back on the next load.
    writeLocal(chatId, null);
    if (!drafts.has(chatId)) return;
    drafts.delete(chatId);
    void flush(chatId, null);
  };

  /**
   * The chat is gone, so both copies go with it -- without a PUT, which would
   * write a draft for a chat that no longer exists.
   */
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
