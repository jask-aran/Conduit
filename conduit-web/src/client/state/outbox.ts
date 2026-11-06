import { activeOrigin } from "../platform/servers";

/**
 * A message the person sent while the hub could not be reached, kept on this device until it can.
 *
 * It is shown in the transcript as theirs, marked Waiting to send, and goes out in order once the chat's live session
 * is up again, under the id it was given here. Nothing on the server ignores a repeated message id (a prompt sent
 * twice is two turns), so an entry leaves the outbox before it is handed to the socket and is never sent again: at most
 * once, not at least once.
 */
export interface OutboxEntry {
  messageId: string;
  /** How it was sent: a prompt to an idle agent, or a follow-up to one that was working. Sent as whichever the agent
   *  then needs. */
  kind: "prompt" | "follow_up";
  /** What goes to the agent (review comments projected in). */
  message: string;
  timestamp: string;
}

/* Keyed by server as well as chat, as drafts are: an installed client holds several servers under one origin. */
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

/** This chat's unsent messages, oldest first. */
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

/** Take one entry out (to send it, or because it was cancelled). Null when it is no longer there: already taken. */
export function takeFromOutbox(chatId: string, messageId: string): OutboxEntry | null {
  const entries = outboxOf(chatId);
  const entry = entries.find((held) => held.messageId === messageId) ?? null;
  if (entry) write(chatId, entries.filter((held) => held !== entry));
  return entry;
}

/** Put back an entry that never left (the socket refused it before sending anything), at the front, where it was. */
export function returnToOutbox(chatId: string, entry: OutboxEntry) {
  write(chatId, [entry, ...outboxOf(chatId).filter((held) => held.messageId !== entry.messageId)]);
}

/* Which chats are open in some pane: their waiting messages are that chat's to send (over its stream), so the app's
   background sending for chats nobody has open leaves them alone. */
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

/** The chats of the active server with messages waiting. */
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
