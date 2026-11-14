import { createSignal } from "solid-js";
import { api } from "../api/client";
import type { Message } from "../api/contracts";
import type { MarkupHandoff } from "../../chat-backend-contract.js";

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

/** A comment the hub handed a chat (`MarkupHandoff`), with the words the transcript draws for it. */
export type HandedComment = MarkupHandoff & { words: string };
const unescaped = (text: string) => text.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
/** The comments a user message hands its chat, as the person sees them in it; empty for any other message. */
export function markupHandoffs(message: Pick<Message, "content" | "markup">): HandedComment[] {
  return (message.markup ?? written(message.content || "")).map((one) => ({ ...one, words: one.words ?? (one.said === "reopened" ? `Reopened comment ${one.n}` : "") }));
}
/** Hand-offs stored before the hub sent them as `markup` are read back from the text it wrote then; a new one always has its `markup`. */
function written(text: string): MarkupHandoff[] {
  // Only the hub's own hand-off is drawn as a comment: its tags, then its one sentence to the agent. Any other message that starts with the tag is shown whole, so nothing under it is hidden from the person.
  if (!/^(?:<conduit_markup [^>]*>\n(?:<quote>[\s\S]*?<\/quote>\n)?(?:<words>[\s\S]*?<\/words>\n)?<\/conduit_markup>\n)+(?:The person |On the (?:paper|site) )[^\n]*$/.test(text)) return [];
  return [...text.matchAll(/<conduit_markup ([^>]*)>\n(?:<quote>([\s\S]*?)<\/quote>\n)?(?:<words>([\s\S]*?)<\/words>\n)?<\/conduit_markup>/g)].map(([, fields = "", quote, words]) => {
    const field = Object.fromEntries([...fields.matchAll(/(\w+)="([^"]*)"/g)].map(([, key = "", value = ""]) => [key, unescaped(value)]));
    return { artifact: field.artifact ?? "", kind: field.kind === "site" ? "site" : "paper", name: field.name ?? "", item: field.item ?? "", n: field.n ? Number(field.n) : undefined, block: field.block,
      said: field.said === "reply" || field.said === "reopened" ? field.said : undefined, quote: quote === undefined ? undefined : unescaped(quote), words: words === undefined ? undefined : unescaped(words) };
  });
}
/** Opens the artifact a hand-off is about, at its block (main.tsx's `conduit:open-artifact`). */
export const showHandoff = (handoff: MarkupHandoff) => window.dispatchEvent(new CustomEvent("conduit:open-artifact", { detail: { id: handoff.artifact, block: handoff.block } }));
