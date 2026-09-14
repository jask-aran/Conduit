import { createSignal } from "solid-js";
import { api, asList } from "../api/client";

export interface DraftEntry { text: string; attachmentIds: string[]; savedAt: string }
export interface StashEntry extends DraftEntry { id: string; chatId: string }

const SAVE_DEBOUNCE_MS = 400;

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

  const flush = async (chatId: string, entry: DraftEntry | null) => {
    try {
      await api(`/v0/chats/${encodeURIComponent(chatId)}/draft`, {
        method: "PUT",
        body: JSON.stringify({ text: entry?.text ?? "", attachmentIds: entry?.attachmentIds ?? [] }),
      });
    } catch (error) { onError(error); }
  };

  const load = async () => {
    try {
      const payload = await api<{ drafts?: Record<string, DraftEntry>; stash?: StashEntry[] }>("/v0/drafts");
      for (const [chatId, entry] of Object.entries(payload.drafts || {})) {
        if (!timers.has(chatId)) drafts.set(chatId, entry);
      }
      setStash(asList<StashEntry>(payload.stash));
    } catch (error) { onError(error); }
  };

  const draftFor = (chatId: string) => drafts.get(chatId) ?? null;

  const save = (chatId: string, text: string, attachmentIds: string[]) => {
    if (!chatId) return;
    const entry = entryFor(text, attachmentIds);
    if (entry) drafts.set(chatId, entry); else drafts.delete(chatId);
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
    if (!drafts.has(chatId)) return;
    drafts.delete(chatId);
    void flush(chatId, null);
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

  return { load, stash, draftFor, save, clear, park, restore, discard };
}

export type DraftsStore = ReturnType<typeof createDrafts>;
