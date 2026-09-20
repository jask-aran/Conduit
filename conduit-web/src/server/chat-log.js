/**
 * A chat's event log: one order, decided here, counted here.
 *
 * Everything that changes what a transcript says passes through one place and
 * is given the next number in a single per-chat sequence. The browser applies
 * what it is told, in the order it is told, and can say exactly how far it has
 * got. That is the whole point: ordering stops being something two sides
 * negotiate from content, ids and timestamps, and becomes something the server
 * states.
 *
 * The log is in memory and belongs to the live record. A restart, or a process
 * replaced, is a new log with a new id, and a client holding a number from the
 * old one is told to take a snapshot rather than being replayed into a
 * sequence that no longer means the same thing.
 *
 * Deltas are deliberately not in here. They are the volume and none of the
 * structure: the delivery layer is allowed to merge and drop them under
 * backpressure, and what they were building is restated in full when the
 * message they belong to completes. Sequencing them would make every coalesced
 * frame look like a hole.
 */
import crypto from "node:crypto";

/**
 * Events whose loss actually changes what the transcript says, in Conduit's
 * words.
 *
 * This set was written in Pi's -- `assistant_message_started`,
 * `tool_execution_completed`, `generation_settled` -- so the order a chat is
 * kept in depended on which harness was answering it. Codex, ChatGPT Web and
 * the test harness publish the contract's names, which matched five of the
 * fifteen entries, so their turns were numbered for the transcript statements
 * and not for the lifecycle. Pi's events are translated to these names by
 * Pi's own adapter before the question is asked.
 *
 * What is in here is what the browser cannot work out for itself: the server's
 * statements about the transcript, and the transitions a turn makes. Paint is
 * not -- `assistant_content` and `tool_activity` may be merged or dropped
 * under backpressure by design, and a `message.close` restates in full what
 * every delta was building, so numbering them would make each coalesced frame
 * look like a hole in the order.
 */
export const LOGGED_EVENT_TYPES = new Set([
  // What the server has decided about the transcript's shape, said outright.
  "transcript_op",
  "transcript_sync",
  "history_truncated",
  "session_checkpoint",
  // The transitions a turn makes, and the one that ends it badly.
  "status",
  "error",
]);

/**
 * The transitions a client has to be caught up on.
 *
 * `running` is left out because `started` has already said a turn began, and a
 * status with no phase at all reports what the session is busy with -- Codex
 * waiting on an approval -- rather than a transition, which the next statement
 * restates anyway.
 */
export const LOGGED_STATUS_PHASES = new Set(["started", "stopping", "stopped", "settled"]);

export const isLoggedEvent = (event) => Boolean(event?.type)
  && LOGGED_EVENT_TYPES.has(event.type)
  && (event.type !== "status" || LOGGED_STATUS_PHASES.has(event.phase));

export class ChatLog {
  constructor({ limit = 400 } = {}) {
    this.id = crypto.randomUUID();
    this.seq = 0;
    this.entries = [];
    this.limit = limit;
    // The message a new one goes after, as this log last stated it. Null means
    // the end of whatever the client holds, which is also where a log that has
    // not yet seen a transcript has to put things.
    this.tail = null;
    // Every message this log has already placed. A restatement of one of them
    // says nothing new about where the transcript ends.
    this.placed = new Set();
  }

  state() {
    return { id: this.id, seq: this.seq };
  }

  /**
   * Number an event and keep it, so a client that missed it can be caught up.
   *
   * A message being opened is also where its position is decided, and it is
   * decided here rather than at the call site: the caller knows a message is
   * starting, this knows what the transcript's last word was. Everything that
   * moves the end of the transcript keeps that answer current, so the next
   * message is placed against what was actually said, not against what some
   * other part of the server believed at the time.
   */
  stamp(event) {
    const positioned = this.position(event);
    return this.record(positioned);
  }

  position(event) {
    if (event?.type === "transcript_op") {
      if (event.op === "message.open") {
        const placed = event.after === undefined ? { ...event, after: this.tail } : event;
        if (placed.message?.id) {
          this.tail = placed.message.id;
          this.placed.add(placed.message.id);
        }
        return placed;
      }
      // A cut that keeps the message it names ends there, and the next message
      // is placed against it -- which is what lets a regenerated prompt keep
      // the row it already has. Any other cut leaves the log unable to name the
      // end, so the next message goes after whatever the client has. It is told
      // the cut directly either way.
      if (event.op === "message.drop") this.tail = event.keep ? event.messageId || null : null;
      return event;
    }
    // A sync of the whole transcript says where it ends. A window of it does
    // not: the window an interrupt publishes ends at the turn it cut off, and
    // taking that as the end sent the next answer back above the prompt that
    // asked for it. So a window may only teach this log about messages it has
    // never placed -- which is how a log that has just started, and has placed
    // nothing, learns where an existing transcript ends.
    if (event?.type === "transcript_sync" && event.messages?.length) {
      const last = event.messages.at(-1)?.id;
      if (last && (event.replace || !this.placed.has(last))) this.tail = last;
      for (const message of event.messages) if (message?.id) this.placed.add(message.id);
    }
    return event;
  }

  record(event) {
    this.seq += 1;
    const stamped = { ...event, log: { id: this.id, seq: this.seq } };
    this.entries.push(stamped);
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    return stamped;
  }

  /**
   * What a client at `seq` has not seen, or null when the log cannot say.
   *
   * Null means the answer is a snapshot: either the number belongs to another
   * log, or it is older than anything still held. An empty array means the
   * client is already current, which is not the same thing and must not send
   * it back to a full reload.
   */
  since(logId, seq) {
    if (logId !== this.id || !Number.isInteger(seq) || seq < 0 || seq > this.seq) return null;
    if (seq === this.seq) return [];
    const oldest = this.entries[0]?.log?.seq;
    if (oldest == null || seq < oldest - 1) return null;
    return this.entries.filter((entry) => entry.log.seq > seq);
  }
}

/**
 * The logs, one per chat.
 *
 * A chat outlives the process answering it: Pi is restarted, recycled when
 * idle, replaced by a fork. The order the chat's messages were stated in is a
 * fact about the chat, not about the process, so it is kept here and a new
 * process goes on numbering where the last one stopped.
 */
export class ChatLogs {
  constructor() { this.logs = new Map(); }

  /** The chat's log, made on first use. Nothing without a chat has one. */
  get(chatId) {
    if (!chatId) return null;
    const existing = this.logs.get(chatId);
    if (existing) return existing;
    const log = new ChatLog();
    this.logs.set(chatId, log);
    return log;
  }

  forget(chatId) { this.logs.delete(chatId); }
}
