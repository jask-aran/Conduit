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
   */
  constructor({ capabilities, backend, extras = () => ({}), onPublish = null }) {
    this.capabilities = capabilities;
    this.backend = backend;
    this.extras = extras;
    this.onPublish = onPublish;
    this.records = new Map();
    this.byChatId = new Map();
  }

  add(record) {
    this.records.set(record.id, record);
    this.byChatId.set(record.chatId, record.id);
    return record;
  }

  get(id) { return this.records.get(id) || null; }
  getByChatId(chatId) { const id = this.byChatId.get(chatId); return id ? this.get(id) : null; }

  remove(id) {
    const record = this.get(id);
    if (!record) return null;
    this.records.delete(id);
    if (this.byChatId.get(record.chatId) === id) this.byChatId.delete(record.chatId);
    return record;
  }

  list() { return [...this.records.values()].map((record) => this.view(record)); }

  view(record) {
    return {
      id: record.id, chatId: record.chatId, status: record.status, activity: record.activity,
      active: record.active, stopping: record.stopping, generation: record.generation,
      model: record.model, capabilities: this.capabilities, backend: this.backend,
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

  publish(record, event) {
    record.events.push(event);
    this.onPublish?.(record, event);
    for (const socket of record.clients) if (socket.readyState === 1) socket.send(JSON.stringify(event));
  }

  // A reconnecting browser replays the whole buffer before it sees live events,
  // so the caller can treat attach as "you are now current".
  attach(id, socket) {
    const record = this.get(id);
    if (!record) return null;
    record.clients.add(socket);
    socket.once("close", () => record.clients.delete(socket));
    for (const event of record.events) if (socket.readyState === 1) socket.send(JSON.stringify(event));
    return this.runtimeState(record);
  }
}
