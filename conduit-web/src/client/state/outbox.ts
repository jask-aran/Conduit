import { activeOrigin } from "../platform/servers";

/**
 * The server does not ignore a repeated message id (a prompt sent twice is two turns), so an entry leaves the outbox
 * before it is handed to the socket: at most once, not at least once.
 */
export interface OutboxEntry {
  messageId: string;
  /** Sent as whichever the agent then needs. */
  kind: "prompt" | "follow_up";
  message: string;
  timestamp: string;
}

/* Keyed by server as well as chat: an installed client holds several servers under one origin. */
const PREFIX = "conduit:outbox:";
const keyOf = (chatId: string) => `${PREFIX}${activeOrigin() || ""}:${chatId}`;

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

const validEntry = (value: unknown): value is OutboxEntry => {
  const entry = value as Partial<OutboxEntry> | null;
  return Boolean(entry && typeof entry.messageId === "string" && typeof entry.message === "string"
    && (entry.kind === "prompt" || entry.kind === "follow_up"));
};

export function outboxOf(chatId: string): OutboxEntry[] {
  const store = storage();
  if (!store || !chatId) return [];
  try {
    const held = JSON.parse(store.getItem(keyOf(chatId)) || "[]");
    return Array.isArray(held) ? held.filter(validEntry) : [];
  } catch { return []; }
}

function write(chatId: string, entries: OutboxEntry[]) {
  const store = storage();
  if (!store) return;
  try {
    if (entries.length) store.setItem(keyOf(chatId), JSON.stringify(entries));
    else store.removeItem(keyOf(chatId));
  } catch { /* quota, or a profile that refuses to store anything */ }
}

export function addToOutbox(chatId: string, entry: OutboxEntry) {
  write(chatId, [...outboxOf(chatId).filter((held) => held.messageId !== entry.messageId), entry]);
}

/** Null when it is already taken. */
export function takeFromOutbox(chatId: string, messageId: string): OutboxEntry | null {
  const entries = outboxOf(chatId);
  const entry = entries.find((held) => held.messageId === messageId) ?? null;
  if (entry) write(chatId, entries.filter((held) => held !== entry));
  return entry;
}

/** Only for an entry the socket refused before sending anything. */
export function returnToOutbox(chatId: string, entry: OutboxEntry) {
  write(chatId, [entry, ...outboxOf(chatId).filter((held) => held.messageId !== entry.messageId)]);
}

/* An open chat sends its own waiting messages over its stream, so background sending leaves them alone. */
const openChats = new Map<string, number>();
export function holdOutboxOpen(chatId: string) {
  openChats.set(chatId, (openChats.get(chatId) ?? 0) + 1);
  return () => {
    const count = (openChats.get(chatId) ?? 1) - 1;
    if (count > 0) openChats.set(chatId, count);
    else openChats.delete(chatId);
  };
}
export const outboxIsOpen = (chatId: string) => openChats.has(chatId);

export function outboxChats(): string[] {
  const store = storage();
  if (!store) return [];
  const prefix = `${PREFIX}${activeOrigin() || ""}:`;
  const chats: string[] = [];
  try {
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index);
      if (key?.startsWith(prefix)) chats.push(key.slice(prefix.length));
    }
  } catch { return []; }
  return chats.filter((chatId) => outboxOf(chatId).length);
}
