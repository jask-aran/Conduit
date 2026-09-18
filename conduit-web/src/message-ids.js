import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { chatDirectory } from "./chat-store.js";
import { conduitOwnsMessageIds } from "./harnesses/index.js";

/**
 * Conduit's own message identity for harnesses that cannot supply one.
 *
 * Codex hands out item ids and the ChatGPT-web adapter mints into its own
 * journal, so both already give every message a stable id the moment it
 * exists. Pi does not: its ids live on session entries, which are written only
 * after a turn settles, and the events it streams carry none at all -- the
 * `m1`, `m2` in `pi-event-normalizer.js` are invented per stream and die with
 * it. Everything the client had to do to bridge that gap (optimistic id
 * prefixes, content matching, generation tagging) is guesswork this replaces.
 *
 * A prompt Conduit sends mints `m_<uuid>` up front, so the browser is told the
 * real id in the same breath as the message. The entry that turn writes is
 * bound to that mint here. Anything Conduit did not send -- history adopted
 * from a Pi session, a message typed into the CLI of a driven thread -- has an
 * entry but no mint, and derives `pi:<entryId>` instead: still stable, still
 * ours, and legible as not having originated here.
 *
 * Fork keeps entry ids for retained history (verified against Pi's own
 * output), so a binding outlives every fork of the branch it sits on.
 */
export class MessageIds {
  constructor() {
    this.chats = new Map();
    this.writeQueue = Promise.resolve();
  }

  fileFor(project, chatId) {
    return path.join(chatDirectory(project, chatId), "message-ids.jsonl");
  }

  /**
   * The ledger only speaks for harnesses that cannot name their own messages.
   * Asking it about any other chat is answered here rather than guarded at
   * every call site, so a projection can be run through it unconditionally
   * and a harness with its own ids keeps them untouched.
   */
  owns(chat) {
    return conduitOwnsMessageIds(chat);
  }

  async load(project, chatId) {
    const cached = this.chats.get(chatId);
    if (cached) return cached;
    const state = { file: this.fileFor(project, chatId), byEntry: new Map(), byMessage: new Map(),
      unbound: { user: [], assistant: [] } };
    const raw = await fs.readFile(state.file, "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    for (const line of raw.split("\n").filter(Boolean)) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (typeof row?.messageId !== "string") continue;
      if (typeof row.entryId === "string") {
        state.byEntry.set(row.entryId, row.messageId);
        state.byMessage.set(row.messageId, row.entryId);
        continue;
      }
      if (state.unbound[row.role || "user"]) state.unbound[row.role || "user"].push(row.messageId);
    }
    this.chats.set(chatId, state);
    return state;
  }

  append(state, row) {
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(state.file), { recursive: true });
      await fs.appendFile(state.file, `${JSON.stringify(row)}\n`, "utf8");
    }).catch((error) => console.error("Could not record a message id", error));
    return this.writeQueue;
  }

  /** Claim an id for a message about to exist, before any entry does. */
  async mint(project, chat, role = "user") {
    return this.claim(project, chat, role, null);
  }

  /**
   * Record a claim, using the name the sender chose when it offered one.
   *
   * A client that names its own message is telling the truth about a message
   * only it has; the id is still recorded here, bound here, and translated
   * here, so nothing downstream can tell the difference.
   */
  async claim(project, chat, role = "user", offered = null) {
    if (!this.owns(chat)) return null;
    const state = await this.load(project, chat.id);
    const messageId = offered && !state.byMessage.has(offered) ? offered : `m_${crypto.randomUUID()}`;
    state.unbound[role].push(messageId);
    await this.append(state, { messageId, role });
    return messageId;
  }

  /**
   * Pair the user entries a turn wrote with the prompts that produced them.
   *
   * Mints are consumed oldest first, which is the order the prompts were sent
   * and the order Pi writes them. A mint left over never landed -- a prompt
   * that failed before it was written -- and is dropped rather than left to
   * attach itself to some later message it has nothing to do with.
   */
  async bind(project, chat, entries) {
    if (!this.owns(chat)) return null;
    const state = await this.load(project, chat.id);
    for (const role of ["user", "assistant"]) {
      if (!state.unbound[role].length) continue;
      const fresh = (entries || [])
        .filter((entry) => entry?.type === "message" && entry.message?.role === role && typeof entry.id === "string")
        .map((entry) => entry.id)
        .filter((entryId) => !state.byEntry.has(entryId));
      for (const entryId of fresh) {
        const messageId = state.unbound[role].shift();
        if (!messageId) break;
        state.byEntry.set(entryId, messageId);
        state.byMessage.set(messageId, entryId);
        await this.append(state, { messageId, entryId, role });
      }
      state.unbound[role] = [];
    }
    return state;
  }

  /** Entry id -> the id everything above the adapter uses. */
  async resolver(project, chat) {
    if (!this.owns(chat)) return (id) => id;
    const state = await this.load(project, chat.id);
    return (entryId) => (entryId ? state.byEntry.get(entryId) || `pi:${entryId}` : entryId);
  }

  /**
   * Back the other way, for a target the client names: a fork or regenerate
   * point, a turn artifact. An id this does not know passes through unchanged,
   * so a raw entry id -- from Pi's own history tree, or from a client that
   * loaded before any of this existed -- still works.
   */
  async entryIdFor(project, chat, messageId) {
    if (typeof messageId !== "string" || !messageId || !this.owns(chat)) return messageId;
    const state = await this.load(project, chat.id);
    return state.byMessage.get(messageId) || (messageId.startsWith("pi:") ? messageId.slice(3) : messageId);
  }

  forget(chatId) {
    this.chats.delete(chatId);
  }
}

/**
 * Turn artifacts anchor on session entries, which is right -- they describe
 * what the harness wrote. The client matches them to messages by id, so they
 * are restamped on the way out like the messages are.
 */
export function applyArtifactMessageIds(artifacts, idFor) {
  if (!idFor || !Array.isArray(artifacts)) return artifacts;
  return artifacts.map((artifact) => (artifact?.messageId
    ? { ...artifact, messageId: idFor(artifact.messageId) }
    : artifact));
}

/** Restamp a projection on its way out. Messages only; tools keep their own ids. */
export function applyMessageIds(messages, idFor) {
  if (!idFor) return messages || [];
  return (messages || []).map((message) => (message?.id ? { ...message, id: idFor(message.id) } : message));
}
