import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless");
const { SerializeAddon } = require("@xterm/addon-serialize");

export const PTY_STATE_SCROLLBACK_ROWS = 1000;

function boundedDimension(value, fallback) {
  const next = Math.trunc(Number(value));
  return Number.isInteger(next) && next >= 1 && next <= 500 ? next : fallback;
}

export class TerminalState {
  constructor({ cols = 80, rows = 24, scrollback = PTY_STATE_SCROLLBACK_ROWS } = {}) {
    this.scrollback = Math.max(0, Math.min(10_000, Math.trunc(Number(scrollback)) || PTY_STATE_SCROLLBACK_ROWS));
    this.terminal = new Terminal({
      cols: boundedDimension(cols, 80),
      rows: boundedDimension(rows, 24),
      scrollback: this.scrollback,
      // SerializeAddon currently reads proposed buffer APIs even though the
      // serialized VT stream itself remains renderer-neutral.
      allowProposedApi: true,
    });
    this.serializer = new SerializeAddon();
    this.terminal.loadAddon(this.serializer);
    this.queue = Promise.resolve();
    this.disposed = false;
  }

  enqueue(work) {
    if (this.disposed) return Promise.reject(new Error("Terminal state is disposed"));
    const next = this.queue.then(() => {
      if (this.disposed) throw new Error("Terminal state is disposed");
      return work();
    });
    this.queue = next.then(() => {}, () => {});
    return next;
  }

  write(value) {
    const data = String(value ?? "");
    if (!data) return this.queue;
    return this.enqueue(() => new Promise((resolve, reject) => {
      try { this.terminal.write(data, resolve); }
      catch (error) { reject(error); }
    }));
  }

  resize(cols, rows) {
    const width = boundedDimension(cols, this.terminal.cols);
    const height = boundedDimension(rows, this.terminal.rows);
    return this.enqueue(() => {
      if (width !== this.terminal.cols || height !== this.terminal.rows) this.terminal.resize(width, height);
    });
  }

  snapshot() {
    // Snapshot is itself queued. Output arriving after this call is chained after
    // the serialization cut and can therefore be delivered as a live delta.
    return this.enqueue(() => ({
      cols: this.terminal.cols,
      rows: this.terminal.rows,
      data: this.serializer.serialize({ scrollback: this.scrollback }),
    }));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.serializer.dispose();
    this.terminal.dispose();
  }
}
