import type { Message, TranscriptDetail } from "../api/contracts";
import { activeOrigin } from "../platform/servers";

/*
 * A copy of recent transcripts for opening a chat while the hub cannot be reached, never an authority. Every failure
 * here is the same answer: there is no copy.
 */
const DB_NAME = "conduit-device";
const STORE = "transcripts";
const KEEP_CHATS = 20;
const KEEP_MESSAGES = 200;
const KEEP_OUTPUT_CHARS = 16_000;

interface Held { key: string; openedAt: number; detail: TranscriptDetail }

let opening: Promise<IDBDatabase | null> | null = null;
function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  opening ||= new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("openedAt", "openedAt");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}

const keyOf = (chatId: string) => `${activeOrigin() || ""}:${chatId}`;

const done = (transaction: IDBTransaction) => new Promise<void>((resolve) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => resolve();
  transaction.onabort = () => resolve();
});

export async function readDeviceTranscript(chatId: string): Promise<TranscriptDetail | null> {
  const db = await database();
  if (!db) return null;
  try {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(keyOf(chatId));
    const held = await new Promise<Held | undefined>((resolve) => {
      request.onsuccess = () => resolve(request.result as Held | undefined);
      request.onerror = () => resolve(undefined);
    });
    return held?.detail ?? null;
  } catch { return null; }
}

function trimmed(detail: TranscriptDetail): TranscriptDetail {
  const messages = detail.messages.filter((message: Message) => !message.local && !message.outbox && !message.streaming && !message.pending);
  const kept = messages.slice(-KEEP_MESSAGES);
  const from = messages.length > kept.length ? kept[0]?.timestamp : undefined;
  const tools = (detail.tools || [])
    .filter((tool) => !from || !tool.timestamp || tool.timestamp >= from)
    .map((tool) => typeof tool.output === "string" && tool.output.length > KEEP_OUTPUT_CHARS ? { ...tool, output: undefined } : tool);
  // No log position (the copy is not a place in the chat's order), no running turn (whatever ran has been heard of by
  // the time it is read), and no page cursor when cut short (it would page from the server's window, not this one).
  const { log: _log, turnOpen: _turnOpen, ...rest } = detail;
  return JSON.parse(JSON.stringify({ ...rest, messages: kept, tools, ...(from ? { page: { before: null } } : {}) })) as TranscriptDetail;
}

/** A copy still waiting to be written for a deleted chat is not written. */
const forgotten = new Set<string>();

export async function forgetDeviceTranscript(chatId: string): Promise<void> {
  forgotten.add(keyOf(chatId));
  const db = await database();
  if (!db) return;
  try {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(keyOf(chatId));
    await done(transaction);
  } catch { /* no copy to drop */ }
}

export async function saveDeviceTranscript(chatId: string, detail: TranscriptDetail): Promise<void> {
  const db = await database();
  if (!db || forgotten.has(keyOf(chatId))) return;
  try {
    const record: Held = { key: keyOf(chatId), openedAt: Date.now(), detail: trimmed(detail) };
    const transaction = db.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    store.put(record);
    const count = store.count();
    count.onsuccess = () => {
      let surplus = count.result - KEEP_CHATS;
      if (surplus <= 0) return;
      const cursor = store.index("openedAt").openCursor();
      cursor.onsuccess = () => {
        const at = cursor.result;
        if (!at || surplus <= 0) return;
        at.delete();
        surplus -= 1;
        at.continue();
      };
    };
    await done(transaction);
  } catch { /* no copy, as if none were kept */ }
}
