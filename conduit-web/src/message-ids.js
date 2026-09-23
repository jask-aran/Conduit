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
/** A name Conduit minted, as opposed to one derived from a harness entry. */
const CONDUIT_MESSAGE_ID = /^m_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    // The file is append-only, so a claim is still in it after it has been
    // bound or released. What is still waiting is read at the end, from what
    // the later rows did not settle -- not from the claim rows alone, which on
    // a reload would put every id ever claimed back in the queue.
    const claims = [];
    const released = new Set();
    for (const line of raw.split("\n").filter(Boolean)) {
      let row;
      try { row = JSON.parse(line); } catch { continue; }
      if (typeof row?.messageId !== "string") continue;
      if (typeof row.entryId === "string") {
        state.byEntry.set(row.entryId, row.messageId);
        state.byMessage.set(row.messageId, row.entryId);
        continue;
      }
      // A fork abandoned the entry this name was bound to. The name is free
      // again, and the row that follows in the file claims it back.
      if (row.unbound) {
        const bound = state.byMessage.get(row.messageId);
        if (bound !== undefined) { state.byEntry.delete(bound); state.byMessage.delete(row.messageId); }
        continue;
      }
      if (row.released) { released.add(row.messageId); continue; }
      if (state.unbound[row.role || "user"]) {
        claims.push({ messageId: row.messageId, role: row.role || "user", after: row.after || null });
      }
    }
    for (const claim of claims) {
      if (state.byMessage.has(claim.messageId) || released.has(claim.messageId)) continue;
      state.unbound[claim.role].push({ messageId: claim.messageId, after: claim.after });
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

  /** Queue the claim before its row so a binding cannot pass an id still in flight. */
  #recordClaim(state, messageId, role, after) {
    state.unbound[role].push({ messageId, after });
    return this.append(state, { messageId, role, ...(after ? { after } : {}) });
  }

  /** Claim an id for a message about to exist, before any entry does. */
  async mint(project, chat, role = "user", after = null) {
    return this.claim(project, chat, role, null, after);
  }

  /**
   * Record a claim, using the name the sender chose when it offered one.
   *
   * A client that names its own message is telling the truth about a message
   * only it has; the id is still recorded here, bound here, and translated
   * here, so nothing downstream can tell the difference.
   */
  async claim(project, chat, role = "user", offered = null, after = null) {
    if (!this.owns(chat)) return null;
    const state = await this.load(project, chat.id);
    const messageId = offered && !state.byMessage.has(offered) ? offered : `m_${crypto.randomUUID()}`;
    await this.#recordClaim(state, messageId, role, after);
    return messageId;
  }

  /**
   * Free a name whose entry has been abandoned, so the same name can be claimed
   * for the entry that replaces it.
   *
   * Regenerate asks the same prompt again. The harness abandons the entry and
   * writes a new one, but nothing about the message the reader is looking at has
   * changed -- same words, same place -- so it keeps its name and the row on
   * screen is never taken away and put back. Only a name Conduit minted can be
   * reused: a prompt adopted from history is called `pi:<entryId>` after the
   * entry itself, and that entry is exactly what the fork is abandoning.
   */
  async reclaim(project, chat, messageId) {
    if (!this.owns(chat) || !CONDUIT_MESSAGE_ID.test(String(messageId || ""))) return null;
    const state = await this.load(project, chat.id);
    const entryId = state.byMessage.get(messageId);
    if (entryId === undefined) return state.unbound.user.some((item) => item.messageId === messageId) ? null : messageId;
    state.byMessage.delete(messageId);
    state.byEntry.delete(entryId);
    await this.append(state, { messageId, unbound: true });
    return messageId;
  }

  /**
   * Claim an id for an answer a turn is writing right now.
   *
   * A turn writes as many messages as it likes -- a tool call and the answer
   * after it are two, and a long turn is several -- and each one is named as
   * the harness starts it, mid-stream. That is inside the event loop, where
   * there is nothing to await, so this records the claim in memory at once and
   * lets the file catch up: a binding that ran before the write landed would
   * hand the entry to the next claim in the queue. The chat must already be
   * loaded, which it is, because the prompt that started this turn claimed
   * through it.
   */
  claimNow(chat, role, after = null) {
    if (!this.owns(chat)) return null;
    const state = this.chats.get(chat.id);
    if (!state) return null;
    const messageId = `m_${crypto.randomUUID()}`;
    void this.#recordClaim(state, messageId, role, after);
    return messageId;
  }

  /**
   * Pair the entries a turn wrote with the prompts that produced them.
   *
   * `rows` is `{ id, role }` per written message, oldest first -- either from
   * session entries (`entryMessageRows`) or from a projection, whose messages
   * already carry the entry id as their own.
   *
   * Prompts go first and in order: they are the only thing a turn boundary can
   * be read from, and the client named them, so they are the fixed points.
   * An answer is then placed after the prompt it was claimed for, never before
   * it and never past the next one. A turn that writes more than one entry --
   * an interrupted tool call leaves both the call and an "aborted" message --
   * has one claim and one answer, and the leftovers derive `pi:<entryId>`
   * instead of consuming the next turn's name, which is what made every answer
   * after an interrupt appear twice under two ids.
   *
   * Nothing here decides a claim has expired, so a cancelled turn whose answer
   * Pi writes seconds later, after the turn has checkpointed, still gets it. A
   * prompt that genuinely never lands releases its own claims.
   */
  async bind(project, chat, rows) {
    if (!this.owns(chat)) return null;
    const state = await this.load(project, chat.id);
    const list = (rows || []).filter((row) => row && typeof row.id === "string" && state.unbound[row.role]);
    const freeAfter = (role, from) => list.findIndex((row, index) =>
      index > from && row.role === role && !state.byEntry.has(row.id));
    const take = async (messageId, role, index) => {
      const { id } = list[index];
      state.byEntry.set(id, messageId);
      state.byMessage.set(messageId, id);
      await this.append(state, { messageId, entryId: id, role });
    };

    let cursor = -1;
    const waiting = [];
    for (const claim of state.unbound.user) {
      const index = waiting.length ? -1 : freeAfter("user", cursor);
      if (index < 0) { waiting.push(claim); continue; }
      cursor = index;
      await take(claim.messageId, "user", index);
    }
    state.unbound.user = waiting;

    const pending = [];
    for (const claim of state.unbound.assistant) {
      // An older claim that has not found its entry holds the queue: letting a
      // newer one past would name two answers in the wrong order.
      if (pending.length) { pending.push(claim); continue; }
      // A claim from before answers were anchored to prompts, or one whose
      // prompt this window does not reach back to.
      const promptEntry = claim.after ? state.byMessage.get(claim.after) : null;
      const from = claim.after ? list.findIndex((row) => row.id === promptEntry) : -1;
      if (claim.after && from < 0) { pending.push(claim); continue; }
      const index = freeAfter("assistant", from);
      if (index < 0) { pending.push(claim); continue; }
      await take(claim.messageId, "assistant", index);
    }
    state.unbound.assistant = pending;
    return state;
  }

  /**
   * Give back claims for a message that will never exist.
   *
   * A prompt rejected by the harness has already taken its ids out of the
   * queue, and leaving them there would hand them to the next turn and shift
   * every binding after it by one.
   */
  async release(project, chat, claimed) {
    if (!this.owns(chat) || !claimed) return;
    const state = await this.load(project, chat.id);
    for (const role of ["user", "assistant"]) {
      const messageId = claimed[role];
      if (!messageId || state.byMessage.has(messageId)) continue;
      state.unbound[role] = state.unbound[role].filter((item) => item.messageId !== messageId);
      await this.append(state, { messageId, role, released: true });
    }
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

/** The user and assistant messages a run of session entries wrote, in order. */
export function entryMessageRows(entries) {
  return (entries || [])
    .filter((entry) => entry?.type === "message" && typeof entry.id === "string"
      && ["user", "assistant"].includes(entry.message?.role))
    .map((entry) => ({ id: entry.id, role: entry.message.role }));
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
