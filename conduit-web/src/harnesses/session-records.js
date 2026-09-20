import { isLoggedEvent } from "../server/chat-log.js";
import { SocketDelivery, deliveryKey, isPaint, mergeDelivery } from "./socket-delivery.js";

// The live-record store every non-Pi adapter needs: the id and chat indexes, the
// attached browser sockets, and the replay buffer. Codex and ChatGPT Web wrote
// this identically; adapters now compose it instead so a new harness inherits
// the socket and replay semantics rather than re-deriving them.
//
// This deliberately owns no process lifecycle. Codex runs a child per record,
// opencode runs one server for every session, and native Pi delegates to
// PiManager - none of which belongs to a record store.
export class SessionRecords {
  /**
   * @param capabilities the adapter's frozen ChatCapabilities
   * @param backend the `{ protocol, implementation, installationId }` stamp for views
   * @param extras per-record view fields this backend adds (title, linkUrl, ...)
   * @param onPublish side effect before broadcast, e.g. the ChatGPT Web journal
   * @param logs the per-chat order, for a backend whose transcript is stated
   */
  constructor({ capabilities, backend, extras = () => ({}), onPublish = null, logs = null, delivery = null, replayLimit = 500 }) {
    this.logs = logs;
    this.replayLimit = replayLimit;
    // Every harness gets the delivery discipline Pi had to itself: a frame's
    // deltas merged into one send, and a socket that has stopped keeping up
    // given paint to drop rather than a longer queue to work through.
    this.delivery = delivery || new SocketDelivery();
    this.capabilities = capabilities;
    this.backend = backend;
    this.extras = extras;
    this.onPublish = onPublish;
    this.records = new Map();
    this.byChatId = new Map();
  }

  /**
   * Keep what a reconnecting browser will need, and only one copy of the paint.
   *
   * The buffer used to take every event, which meant a busy turn filled all 500
   * slots with deltas and evicted the ops that place the rows those deltas are
   * painting into. A browser arriving mid-answer was then sent hundreds of
   * deltas and no structure -- and, because the window is the *last* 500, the
   * text it got started in the middle of the answer.
   *
   * Paint is merged here by the same key the wire merges on, so a block holds
   * one entry carrying everything written into it so far. Structure is never
   * pushed out by volume, the replay is the whole answer rather than its tail,
   * and a turn costs a slot per block instead of one per token.
   */
  remember(record, event) {
    const key = deliveryKey(event);
    if (key) {
      record.paint ||= new Map();
      const held = record.paint.get(key);
      // Merged into a copy of our own: the object handed to the sockets is
      // serialized once and cached against its identity, so it must not change
      // after it has gone out.
      if (held) { Object.assign(held, mergeDelivery(held, event)); return; }
      const copy = { ...event };
      record.paint.set(key, copy);
      record.events.push(copy);
    } else {
      record.events.push(event);
    }
    if (record.events.length <= this.replayLimit) return;
    this.evict(record, record.events.length - this.replayLimit);
  }

  /**
   * Make room, paint first.
   *
   * A dropped delta costs a repaint; a dropped `message.open` costs the row the
   * repaint would go in. Evicting by age alone treated them alike, so a turn
   * with more blocks and tools than the buffer holds pushed its own structure
   * out and left a reconnecting browser painting into nothing.
   *
   * Paint goes in age order until there is room -- all of it, not only the part
   * that merges. Asking `deliveryKey` which entries were paint answered the
   * narrower question "which of these merge", so a tool-heavy turn kept its own
   * starts and ends and evicted the `message.open` they belong under.
   *
   * The record is given up only when a turn has stated more than the buffer can
   * hold at all, and that is not silent: every record event carries its number
   * in the chat's log, so a client replayed a buffer with a hole in it sees the
   * gap, asks to be caught up from the last number it held, and is either sent
   * what it missed or told to take the transcript again.
   */
  evict(record, count) {
    let over = count;
    const kept = [];
    const forget = (event) => {
      const key = deliveryKey(event);
      if (key && record.paint?.get(key) === event) record.paint.delete(key);
    };
    for (const event of record.events) {
      if (over > 0 && isPaint(event)) { over -= 1; forget(event); continue; }
      kept.push(event);
    }
    for (const event of kept.splice(0, over)) forget(event);
    record.events = kept;
  }

  add(record) {
    record.adapterImplementation ||= this.backend.implementation;
    // An adapter may seed the buffer before handing the record over -- ChatGPT
    // Web fills it from its journal. The merge keys point at objects in that
    // array, so they start empty alongside it rather than at whatever a reused
    // record was holding.
    record.paint = new Map();
    // Every harness answers the same two questions about a process: is it
    // alive, and can it answer yet. A record that never sets `ready` is taken
    // at its word as ready; one that sets it false reads as starting until it
    // says otherwise, exactly as a native process does.
    record.createdAt ||= new Date().toISOString();
    record.updatedAt ||= record.createdAt;
    this.records.set(record.id, record);
    this.byChatId.set(record.chatId, record.id);
    return record;
  }

  get(id) { return this.records.get(id) || null; }
  getByChatId(chatId) { const id = this.byChatId.get(chatId); return id ? this.get(id) : null; }

  reassign(id, chatId) {
    const record = this.get(id);
    if (!record) return null;
    if (this.byChatId.get(record.chatId) === id) this.byChatId.delete(record.chatId);
    record.chatId = chatId;
    this.byChatId.set(chatId, id);
    return record;
  }

  remove(id) {
    const record = this.get(id);
    if (!record) return null;
    this.records.delete(id);
    if (this.byChatId.get(record.chatId) === id) this.byChatId.delete(record.chatId);
    return record;
  }

  list() { return [...this.records.values()].map((record) => this.view(record)); }
  rawRecords() { return [...this.records.values()].filter((record) => record.status !== "stopped"); }

  view(record) {
    const ready = record.ready !== false;
    return {
      id: record.id, chatId: record.chatId, status: record.status,
      ready,
      // Somebody is waiting on an answer from it, so it is not free to reclaim.
      waiting: (record.pending?.size || 0) > 0,
      // Alive but unable to answer is starting, whoever is running it. Without
      // this a harness that reports readiness would still show as idle while it
      // came up, and two backends would tell the same story differently.
      activity: ready ? record.activity : "starting",
      active: record.active, stopping: record.stopping, generation: record.generation,
      model: record.model, capabilities: this.capabilities, backend: this.backend,
      createdAt: record.createdAt || null, updatedAt: record.updatedAt || record.createdAt || null,
      ...this.extras(record),
    };
  }

  runtimeState(record) {
    return {
      type: "runtime_state", generationId: record?.generation?.id || null,
      lifecycle: record?.status === "stopped" ? "closed" : record?.status === "starting" ? "creating"
        : record?.active ? "working" : "idle",
      status: record?.stopping ? "stopping" : record?.activity === "failed" ? "failed"
        : record?.active ? "working" : "idle",
      activity: record?.activity || "idle", capabilities: this.capabilities,
    };
  }

  /**
   * The order this record's events belong to.
   *
   * It is the chat's, not the process's, so a restarted daemon goes on
   * numbering where the last one stopped. A record with no chat -- a driven
   * thread, an ephemeral probe -- has no transcript to keep an order for, and a
   * backend that states no transcript was given no log to keep one in.
   */
  logFor(record) {
    return record?.chatId && !record.ephemeral ? this.logs?.get(record.chatId) || null : null;
  }

  publish(record, event) {
    record.updatedAt = new Date().toISOString();
    // Numbered before it is buffered or sent, so the replay a reconnecting
    // browser reads carries the same sequence the live stream did.
    const log = this.logFor(record);
    const stamped = log && isLoggedEvent(event) ? log.stamp(event) : event;
    this.remember(record, stamped);
    this.onPublish?.(record, stamped);
    for (const socket of record.clients) this.delivery.send(socket, stamped);
    return stamped;
  }

  // A reconnecting browser replays the whole buffer before it sees live events,
  // so the caller can treat attach as "you are now current".
  attach(id, socket) {
    const record = this.get(id);
    if (!record) return null;
    record.clients.add(socket);
    socket.once("close", () => { record.clients.delete(socket); this.delivery.detach(socket); });
    // The replay is the catch-up, so it goes out whole and in order rather than
    // through the merge: a browser that has just arrived has nothing to merge
    // into, and the buffer is already bounded.
    for (const event of record.events) if (socket.readyState === 1) socket.send(this.delivery.serialize(event));
    // Nothing: the stream sends the full catch-up frame immediately after this
    // returns, built from the adapter's view. Returning a second, thinner
    // `runtime_state` here meant every attach sent two of them, the first a
    // strict subset of the second -- and that lean form was the only reason
    // the browser had to understand two shapes of this event.
    return null;
  }
}
