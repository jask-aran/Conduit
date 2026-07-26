export class PtyOutputBatcher {
  constructor(send, { schedule = setImmediate, cancel = clearImmediate } = {}) {
    this.send = send;
    this.schedule = schedule;
    this.cancel = cancel;
    this.pending = new Map();
    this.scheduled = new Map();
  }

  append(id, bytes) {
    const chunks = this.pending.get(id) || [];
    chunks.push(bytes);
    this.pending.set(id, chunks);
    if (this.scheduled.has(id)) return;
    this.scheduled.set(id, this.schedule(() => this.flush(id)));
  }

  flush(id) {
    if (this.scheduled.has(id)) this.cancel(this.scheduled.get(id));
    this.scheduled.delete(id);
    const chunks = this.pending.get(id);
    this.pending.delete(id);
    if (!chunks?.length) return;
    this.send(id, chunks.length === 1 ? chunks[0] : Buffer.concat(chunks));
  }

  flushAll() {
    for (const id of [...this.pending.keys()]) this.flush(id);
  }
}
