import fs from "node:fs/promises";
const root = new URL("../", import.meta.url);
async function write(path, content) { await fs.writeFile(new URL(path, root), content, "utf8"); }

await write("conduit-web/src/terminal-state.js", `import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Terminal } = require("@xterm/headless");
const { SerializeAddon } = require("@xterm/addon-serialize");

export const PTY_STATE_SCROLLBACK_ROWS = 1000;
export const PTY_STATE_HIGH_WATER_BYTES = 1024 * 1024;
export const PTY_STATE_LOW_WATER_BYTES = 512 * 1024;
export const PTY_STATE_MAX_PENDING_BYTES = 4 * 1024 * 1024;

function boundedDimension(value, fallback) {
  const next = Math.trunc(Number(value));
  return Number.isInteger(next) && next >= 1 && next <= 500 ? next : fallback;
}

function positiveBytes(value, fallback) {
  const next = Math.trunc(Number(value));
  return Number.isInteger(next) && next > 0 ? next : fallback;
}

export class TerminalState {
  constructor({
    cols = 80,
    rows = 24,
    scrollback = PTY_STATE_SCROLLBACK_ROWS,
    highWaterBytes = PTY_STATE_HIGH_WATER_BYTES,
    lowWaterBytes = PTY_STATE_LOW_WATER_BYTES,
    maxPendingBytes = PTY_STATE_MAX_PENDING_BYTES,
    onData,
    onBackpressure,
    onInvalid,
  } = {}) {
    this.scrollback = Math.max(0, Math.min(10_000, Math.trunc(Number(scrollback)) || PTY_STATE_SCROLLBACK_ROWS));
    this.maxPendingBytes = positiveBytes(maxPendingBytes, PTY_STATE_MAX_PENDING_BYTES);
    this.highWaterBytes = Math.min(this.maxPendingBytes, positiveBytes(highWaterBytes, PTY_STATE_HIGH_WATER_BYTES));
    this.lowWaterBytes = Math.min(this.highWaterBytes, Math.max(0, Math.trunc(Number(lowWaterBytes)) || PTY_STATE_LOW_WATER_BYTES));
    this.onBackpressure = typeof onBackpressure === "function" ? onBackpressure : null;
    this.onInvalid = typeof onInvalid === "function" ? onInvalid : null;
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
    this.dataSubscription = typeof onData === "function" ? this.terminal.onData(onData) : null;
    this.queue = Promise.resolve();
    this.pendingBytes = 0;
    this.backpressured = false;
    this.valid = true;
    this.invalidReason = "";
    this.disposed = false;
  }

  isValid() {
    return this.valid && !this.disposed;
  }

  invalidError() {
    return Object.assign(new Error(this.invalidReason || "Canonical terminal state is unavailable"), { code: "pty_state_invalid" });
  }

  setBackpressure(paused) {
    if (this.backpressured === paused) return;
    this.backpressured = paused;
    try { this.onBackpressure?.(paused); } catch {}
  }

  invalidate(cause) {
    if (!this.valid) return;
    const error = cause instanceof Error ? cause : new Error(String(cause || "Canonical terminal state became invalid"));
    this.valid = false;
    this.invalidReason = error.message;
    this.setBackpressure(false);
    try { this.onInvalid?.(error); } catch {}
  }

  enqueue(work, bytes = 0) {
    if (this.disposed) return Promise.reject(new Error("Terminal state is disposed"));
    if (!this.valid) return Promise.resolve(false);
    if (bytes > 0 && this.pendingBytes + bytes > this.maxPendingBytes) {
      this.invalidate(new Error("Canonical terminal state backlog exceeded " + this.maxPendingBytes + " bytes"));
      return Promise.resolve(false);
    }

    this.pendingBytes += bytes;
    if (this.pendingBytes >= this.highWaterBytes) this.setBackpressure(true);
    const next = this.queue.then(async () => {
      if (this.disposed) throw new Error("Terminal state is disposed");
      if (!this.valid) return false;
      await work();
      return true;
    }).catch((error) => {
      if (!this.disposed) this.invalidate(error);
      return false;
    }).finally(() => {
      this.pendingBytes = Math.max(0, this.pendingBytes - bytes);
      if (this.backpressured && this.pendingBytes <= this.lowWaterBytes) this.setBackpressure(false);
    });
    this.queue = next.then(() => {}, () => {});
    return next;
  }

  write(value) {
    const data = String(value ?? "");
    if (!data) return Promise.resolve(this.isValid());
    const bytes = Buffer.byteLength(data, "utf8");
    return this.enqueue(() => new Promise((resolve, reject) => {
      try { this.terminal.write(data, resolve); }
      catch (error) { reject(error); }
    }), bytes);
  }

  resize(cols, rows) {
    const width = boundedDimension(cols, this.terminal.cols);
    const height = boundedDimension(rows, this.terminal.rows);
    return this.enqueue(() => {
      if (width !== this.terminal.cols || height !== this.terminal.rows) this.terminal.resize(width, height);
    });
  }

  snapshot() {
    if (this.disposed) return Promise.reject(new Error("Terminal state is disposed"));
    if (!this.valid) return Promise.reject(this.invalidError());
    // Snapshot is queued synchronously. Output arriving after this call is
    // chained after the serialization cut and delivered as a sequenced delta.
    const next = this.queue.then(() => {
      if (this.disposed) throw new Error("Terminal state is disposed");
      if (!this.valid) throw this.invalidError();
      return {
        cols: this.terminal.cols,
        rows: this.terminal.rows,
        data: this.serializer.serialize({ scrollback: this.scrollback }),
      };
    });
    this.queue = next.then(() => {}, () => {});
    return next.catch((error) => {
      if (!this.disposed) this.invalidate(error);
      throw error;
    });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.valid = false;
    this.dataSubscription?.dispose();
    this.serializer.dispose();
    this.terminal.dispose();
  }
}
`);
