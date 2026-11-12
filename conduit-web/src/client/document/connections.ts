import { createSignal } from "solid-js";
import { api } from "../api/client";

/*
 * Connections between chats and papers (docs/plans/markup-and-conduit-documents.md): each asked of the hub on first
 * use and again whenever it says artifacts changed. Unanswered or failed, a chat has none and a paper no thread.
 */
export interface Connected { id: string; name: string; project: string }
export interface PaperConnections { thread: string | null; connections: { chat: string; title: string }[] }

const at = encodeURIComponent;
function store<T>(path: (id: string) => string, empty: T) {
  const [known, setKnown] = createSignal<Record<string, T>>({});
  const asked = new Set<string>();
  const read = (id: string) => api<T>(path(id)).then((value) => setKnown((current) => ({ ...current, [id]: value })), () => {});
  window.addEventListener("conduit:artifacts-changed", () => { for (const id of asked) void read(id); });
  return (id: string): T => {
    if (!asked.has(id)) { asked.add(id); void read(id); }
    return known()[id] ?? empty;
  };
}
const ofChat = store<{ connections: Connected[] }>((chat) => `/v0/chats/${at(chat)}/connections`, { connections: [] });
/** The papers a chat is connected to (never its own paper, for a mated thread). */
export const connectionsOf = (chat: string) => ofChat(chat).connections;
/** A paper's mated thread (null until it starts) and the chats connected to it. */
export const connectedTo = store<PaperConnections>((paper) => `/v0/document/${at(paper)}/connections`, { thread: null, connections: [] });
const send = (paper: string, chat: string, method: string) => api<Pick<PaperConnections, "connections">>(`/v0/document/${at(paper)}/connections/${at(chat)}`, { method });
export const connect = (paper: string, chat: string) => send(paper, chat, "PUT");
export const disconnect = (paper: string, chat: string) => send(paper, chat, "DELETE");
