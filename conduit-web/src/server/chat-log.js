/**
 * A chat's event log: the server numbers every transcript statement in one per-chat sequence. A restart is a new
 * log id, so a client holding an old number takes a snapshot instead of a replay.
 */
import crypto from "node:crypto";
import { applyTranscriptOps } from "../transcript-fold.js";

const STATED_LIMIT = 200;
const sameText = (left, right) => String(left ?? "").replace(/\s+/g, " ").trim() === String(right ?? "").replace(/\s+/g, " ").trim();

/**
 * Paint (`assistant_content`, `tool_activity`) is not numbered: it may be merged or dropped under backpressure, so
 * numbering it would make each coalesced frame look like a hole in the order.
 */
const LOGGED_EVENT_TYPES = new Set([
  // `history_truncated` is not here: a cut is `message.drop` alone, or it would be replayed twice.
  "transcript_op",
  "transcript_sync",
  "session_checkpoint",
  "status",
  "error",
]);

/**
 * `running` is left out because `started` already said a turn began; a status with no phase reports what the
 * session is busy with rather than a transition.
 */
export const LOGGED_STATUS_PHASES = new Set(["started", "stopping", "stopped", "settled"]);

export const isLoggedEvent = (event) => Boolean(event?.type)
  && LOGGED_EVENT_TYPES.has(event.type)
  && (event.type !== "status" || LOGGED_STATUS_PHASES.has(event.phase))
  // Conduit refusing a command is not a fact about the turn; numbering it would replay it as a failed turn.
  && (event.type !== "error" || (event.scope || "runtime") === "runtime");

export class ChatLog {
  constructor({ limit = 400 } = {}) {
    this.id = crypto.randomUUID();
    this.seq = 0;
    this.entries = [];
    this.limit = limit;
    // Null means the end of whatever the client holds.
    this.tail = null;
    this.placed = new Set();
    // Folded exactly as the browser folds it, so a settled turn can be checked against the record.
    this.stated = { messages: [], tools: [] };
    this.followers = new Set();
  }

  follow(follow) {
    this.followers.add(follow);
    return () => this.followers.delete(follow);
  }

  state() {
    return { id: this.id, seq: this.seq };
  }

  /** The `turn.settle` a harness owed when a turn ended without stating its outcome. */
  owedSettle(event) {
    if (event?.type !== "status" || !["settled", "stopped"].includes(event.phase)) return null;
    const prompt = this.stated.messages.findLast((message) => message.role === "user");
    if (!prompt?.id || prompt.outcome) return null;
    console.error(`transcript contract: the turn after prompt ${prompt.id} ended without stating how; stating it for the harness`);
    return { type: "transcript_op", op: "turn.settle", promptId: prompt.id,
      outcome: event.phase === "stopped" ? "interrupted" : "complete",
      ...(event.generationId ? { generationId: event.generationId } : {}) };
  }

  /** A message's position is decided here, not at the call site: only the log knows the transcript's last word. */
  stamp(event) {
    const positioned = this.position(event);
    return this.record(positioned);
  }

  position(event) {
    if (event?.type === "transcript_op") {
      if (event.op === "message.open") {
        // Adding notes to an existing prompt must not move the tail used to place the next row.
        if (event.message?.notes !== undefined && this.stated.messages.some((message) => message.id === event.message.id)) return event;
        const placed = event.after === undefined ? { ...event, after: this.tail } : event;
        if (placed.message?.id) {
          this.tail = placed.message.id;
          this.placed.add(placed.message.id);
        }
        return placed;
      }
      // A cut that keeps its message ends there, which lets a regenerated prompt keep its row; any other cut leaves
      // the end unknown.
      if (event.op === "message.drop") this.tail = event.keep ? event.messageId || null : null;
      return event;
    }
    // Only a whole-transcript sync says where it ends. A window (an interrupt publishes one ending at the cut-off
    // turn) may only move the tail onto a message never placed, or the next answer lands above its prompt.
    if (event?.type === "transcript_sync" && event.messages?.length) {
      const last = event.messages.at(-1)?.id;
      if (last && (event.replace || !this.placed.has(last))) this.tail = last;
      for (const message of event.messages) if (message?.id) this.placed.add(message.id);
    }
    return event;
  }

  record(event) {
    if (event?.type === "transcript_op") this.stated = applyTranscriptOps(this.stated, [event]);
    else if (event?.type === "transcript_sync" && event.replace) {
      this.stated = { messages: [...(event.messages || [])], tools: [...(event.tools || [])] };
    }
    if (this.stated.messages.length > STATED_LIMIT) this.stated.messages = this.stated.messages.slice(-STATED_LIMIT);
    this.seq += 1;
    const stamped = { ...event, log: { id: this.id, seq: this.seq } };
    this.entries.push(stamped);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    for (const follow of this.followers) {
      try { follow(stamped); } catch (error) { console.error("A chat log reader failed", error); }
    }
    return stamped;
  }

  /**
   * Only an answer's text is corrected. A message stated and not recorded, or recorded and never stated, is reported
   * and left alone: placing or removing a row on a guess turns a repair into a bug, and a reload shows the record.
   */
  reconcile(messages = []) {
    const stated = new Map(this.stated.messages.map((message) => [message.id, message]));
    const ops = [];
    const differences = [];
    for (const message of messages) {
      if (!message?.id) continue;
      const said = stated.get(message.id);
      if (!said) differences.push({ id: message.id, kind: "unstated" });
      else if (said.role !== message.role) differences.push({ id: message.id, kind: "role" });
      else if (message.role === "assistant" && !sameText(said.content, message.content)) {
        differences.push({ id: message.id, kind: "text" });
        ops.push({ type: "transcript_op", op: "message.close", messageId: message.id, stopReason: said.stopReason || null,
          interim: said.interim === true, ...(said.discarded ? { discarded: true } : {}),
          content: String(message.content ?? ""), blocks: said.blocks || [] });
      }
    }
    return { ops, differences };
  }

  /** Null means the client needs a snapshot; an empty array means it is current and must not reload. */
  since(logId, seq) {
    if (logId !== this.id || !Number.isInteger(seq) || seq < 0 || seq > this.seq) return null;
    if (seq === this.seq) return [];
    const oldest = this.entries[0]?.log?.seq;
    if (oldest == null || seq < oldest - 1) return null;
    return this.entries.filter((entry) => entry.log.seq > seq);
  }
}

/** Kept per chat, not per process: a restarted or replaced process goes on numbering where the last one stopped. */
export class ChatLogs {
  constructor({ timings = null } = {}) {
    this.logs = new Map();
    this.timings = timings;
    this.tap = null;
  }

  get(chatId) {
    if (!chatId) return null;
    const existing = this.logs.get(chatId);
    if (existing) return existing;
    const log = new ChatLog();
    log.follow((event) => this.tap?.(chatId, event));
    this.logs.set(chatId, log);
    return log;
  }

  /** A read must not make a log, or every opened chat would keep one for the life of the process. */
  peek(chatId) { return (chatId && this.logs.get(chatId)) || null; }

  forget(chatId) { this.logs.delete(chatId); }
}
