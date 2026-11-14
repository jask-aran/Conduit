import { isLoggedEvent, LOGGED_STATUS_PHASES } from "../server/chat-log.js";
import { SessionScope } from "../server/session-scope.js";
import { isLiveEvent } from "../live-session-api.js";
import { SocketDelivery, deliveryKey, isPaint, mergeDelivery } from "./socket-delivery.js";
import { activityOf, turnInFlight } from "./turn.js";

// This deliberately owns no process lifecycle: each adapter owns its runtime.
export class SessionRecords {
  constructor({ capabilities, backend, extras = () => ({}), onPublish = null, logs = null, delivery = null, replayLimit = 500 }) {
    this.logs = logs;
    this.replayLimit = replayLimit;
    this.delivery = delivery || new SocketDelivery();
    this.capabilities = capabilities;
    this.backend = backend;
    this.extras = extras;
    this.onPublish = onPublish;
    // A page that did not send the turn learns the chat is working, and joins its stream, from this alone.
    this.onTurn = null;
    this.records = new Map();
    this.byChatId = new Map();
  }

  /**
   * Paint is merged here by the same key the wire merges on, so a block holds one entry: structure is never pushed out
   * by volume, and the replay is the whole answer rather than its tail.
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
   * A dropped delta costs a repaint; a dropped `message.open` costs the row the repaint would go in. So paint goes
   * first, all of it, not only what merges (`deliveryKey`). A hole left past that is not silent: every event carries
   * its number in the chat's log, so a client sees the gap and asks to be caught up.
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
    // The merge keys point at objects in the events array, which an adapter may seed before handing the record over,
    // so they start empty rather than at whatever a reused record was holding.
    record.paint = new Map();
    record.createdAt ||= new Date().toISOString();
    record.updatedAt ||= record.createdAt;
    // What the session holds is handed to its scope by the adapter as it is
    // taken; removing the record ends it, however the session ended.
    record.scope = new SessionScope();
    // Derived, never written.
    Object.defineProperty(record, "activity", { get() { return activityOf(this); }, enumerable: true, configurable: true });
    record.scope.defer(() => { record.status = "stopped"; record.active = false; });
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
    record.scope?.close();
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
      // Alive but unable to answer is starting, whoever is running it, so every backend tells this the same way.
      activity: ready ? activityOf(record) : "starting",
      active: record.active, stopping: record.stopping, generation: record.generation,
      // What a restart waits out. The flags above are not the whole of it: a turn sent to Codex and not yet begun, a
      // compaction outside a turn.
      turnInFlight: turnInFlight(record),
      model: record.model, capabilities: this.capabilities, backend: this.backend,
      createdAt: record.createdAt || null, updatedAt: record.updatedAt || record.createdAt || null,
      ...this.extras(record),
    };
  }

  runtimeState(record) {
    return {
      type: "runtime_state", generationId: record?.generation?.id || null,
      status: record?.stopping ? "stopping" : record?.failed ? "failed"
        : record?.active || record?.turnStarting ? "working" : "idle",
      activity: activityOf(record), capabilities: this.capabilities,
    };
  }

  /** The chat's order, not the process's, so a restarted daemon goes on numbering where the last one stopped. */
  logFor(record) {
    return record?.chatId && !record.ephemeral ? this.logs?.get(record.chatId) || null : null;
  }

  /** @param {{ type: keyof typeof import("../live-session-api.js").LIVE_EVENTS }} event */
  publish(record, event) {
    if (!isLiveEvent(event?.type)) throw new TypeError(`Live event ${event?.type} is not declared (live-session-api.js)`);
    record.updatedAt = new Date().toISOString();
    // A tool starting or ending says when, once, here -- every fold of it,
    // the server's and each browser's, then agrees on how long it took.
    if (event?.type === "tool_activity" && (event.phase === "start" || event.phase === "end") && !event.at) {
      event = { ...event, at: record.updatedAt };
    }
    // A turn that ran no tools changed nothing in its workspace.
    if ((event?.type === "transcript_op" && event.op === "tool.open") || (event?.type === "tool_activity" && event.phase === "start")) record.ranTools = true;
    // A notice's hand-offs are the hub's, not the harness's: laid on its prompt here, where every harness states it.
    const marked = event?.type === "transcript_op" && event.op === "message.open" && record.marked?.get(event.message?.id);
    if (marked) event = { ...event, message: { ...event.message, markup: marked } };
    // Numbered before it is buffered or sent, so the replay a reconnecting
    // browser reads carries the same sequence the live stream did.
    const log = this.logFor(record);
    const owed = log?.owedSettle(event);
    if (owed) this.publish(record, owed);
    const stamped = log && isLoggedEvent(event) ? log.stamp(event) : event;
    this.remember(record, stamped);
    this.onPublish?.(record, stamped);
    for (const socket of record.clients) this.delivery.send(socket, stamped);
    if (event?.type === "status" && LOGGED_STATUS_PHASES.has(event.phase)) this.onTurn?.(record, stamped);
    // Timed here, where every harness's events pass; a turn that has just ended is stated after its ending.
    const timed = this.logs?.timings?.observe(record, stamped);
    if (timed) this.publish(record, timed);
    return stamped;
  }

  setFrameInterval(socket, ms) { return this.delivery.setFrameInterval(socket, ms); }

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
    // Nothing: the stream sends the full catch-up frame immediately after this returns.
    return null;
  }
}
