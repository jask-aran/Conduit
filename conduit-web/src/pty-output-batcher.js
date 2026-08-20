export const PTY_OUTPUT_BATCH_BYTES = 128 * 1024;

export class PtyOutputBatcher {
  constructor(send, { schedule = setImmediate, cancel = clearImmediate, maxBatchBytes = PTY_OUTPUT_BATCH_BYTES } = {}) {
    this.send = send;
    this.schedule = schedule;
    this.cancel = cancel;
    this.maxBatchBytes = Math.max(1, Math.trunc(Number(maxBatchBytes)) || PTY_OUTPUT_BATCH_BYTES);
    this.pending = new Map();
    this.pendingBytes = new Map();
    this.scheduled = new Map();
  }

  append(id, value) {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let offset = 0;
    while (offset < bytes.length) {
      const size = this.pendingBytes.get(id) || 0;
      const room = this.maxBatchBytes - size;
      if (room <= 0) {
        this.flush(id);
        continue;
      }
      const length = Math.min(room, bytes.length - offset);
      const chunks = this.pending.get(id) || [];
      chunks.push(bytes.subarray(offset, offset + length));
      this.pending.set(id, chunks);
      this.pendingBytes.set(id, size + length);
      offset += length;
      if (size + length >= this.maxBatchBytes) this.flush(id);
    }
    if (this.pendingBytes.get(id) && !this.scheduled.has(id)) {
      this.scheduled.set(id, this.schedule(() => this.flush(id)));
    }
  }

  flush(id) {
    if (this.scheduled.has(id)) this.cancel(this.scheduled.get(id));
    this.scheduled.delete(id);
    const chunks = this.pending.get(id);
    const length = this.pendingBytes.get(id) || 0;
    this.pending.delete(id);
    this.pendingBytes.delete(id);
    if (!chunks?.length || !length) return;
    this.send(id, chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length));
  }

  flushAll() {
    for (const id of [...this.pending.keys()]) this.flush(id);
  }
}
