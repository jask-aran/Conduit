import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { ExecutionError, FileError } from "@earendil-works/pi-durable/env";
import { decode, encode } from "./protocol.js";

const call = async (hub, nodeId, method, args, timeoutMs = 15_000) => {
  const context = withAbortSignal(AbortSignal.timeout(timeoutMs), BACKGROUND_CONTEXT);
  const result = decode(await hub.call(nodeId, { target: "proc", method, args: encode(args), cwd: null }, context), { FileError, ExecutionError });
  if (!result.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result.value;
};

/**
 * A process running on a device (node-processes.js), held from main.
 *
 * It is shaped like what node-pty and child processes give, so terminals and
 * harness adapters take it in their place: `onData`, `onExit`, `write`,
 * `resize`, `kill`, and stdout/stderr told apart for a piped process. It
 * counts the bytes it has had, so after a reconnect it asks the device for
 * the rest and nothing is shown twice. Writes while the device is away are
 * dropped -- a terminal's keystrokes are not worth replaying minutes later.
 */
export class RemoteProcess {
  static async spawn(hub, nodeId, spec) {
    const view = await call(hub, nodeId, "spawn", [spec]);
    const process = new RemoteProcess(hub, nodeId, view);
    await process.resume();
    return process;
  }

  /** A process main already started, e.g. a terminal from before a restart. */
  static async reattach(hub, nodeId, procId) {
    const process = new RemoteProcess(hub, nodeId, { id: procId, pid: null });
    await process.resume();
    return process;
  }

  constructor(hub, nodeId, view) {
    this.hub = hub;
    this.nodeId = nodeId;
    this.procId = view.id;
    this.pid = view.pid;
    this.offset = 0;
    this.exitEvent = null;
    this.dataListeners = new Set();
    this.exitListeners = new Set();
    this.early = [];
    hub.follow(this);
  }

  async resume() {
    if (this.exitEvent) return;
    const view = await call(this.hub, this.nodeId, "attach", [this.procId, this.offset]);
    // Output the device no longer had is said, not silently skipped.
    if (view.skipped) this.emitData(`\r\n[${view.skipped} bytes of output were lost while disconnected]\r\n`, "out");
  }

  /** The device could not be followed again: a restarted device has none of its old processes. */
  lost(error) {
    this.deliver({ kind: "exit", code: null, signal: /No such process/.test(error?.message || "") ? "device_process_gone" : "device_unreachable" });
  }

  deliver(message) {
    if (message.kind === "data") {
      const end = message.offset + Buffer.byteLength(message.data, "base64");
      if (end <= this.offset) return;
      let bytes = Buffer.from(message.data, "base64");
      if (message.offset < this.offset) bytes = bytes.subarray(this.offset - message.offset);
      this.offset = end;
      this.emitData(bytes.toString("utf8"), message.stream);
    } else if (message.kind === "exit") {
      if (this.exitEvent) return;
      this.exitEvent = { exitCode: message.code, signal: message.signal };
      for (const listener of this.exitListeners) listener(this.exitEvent);
      this.hub.unfollow(this);
    }
  }

  emitData(text, stream) {
    if (!this.dataListeners.size) return void this.early.push([text, stream]);
    for (const listener of this.dataListeners) listener(text, stream);
  }

  onData(listener) {
    this.dataListeners.add(listener);
    for (const [text, stream] of this.early.splice(0)) listener(text, stream);
    return { dispose: () => this.dataListeners.delete(listener) };
  }

  onExit(listener) {
    this.exitListeners.add(listener);
    if (this.exitEvent) queueMicrotask(() => listener(this.exitEvent));
    return { dispose: () => this.exitListeners.delete(listener) };
  }

  write(data) {
    if (this.exitEvent || !this.hub.live.get(this.nodeId)?.ready) return;
    void call(this.hub, this.nodeId, "write", [this.procId, Buffer.isBuffer(data) ? new Uint8Array(data) : String(data)]).catch(() => {});
  }

  resize(cols, rows) {
    if (this.exitEvent || !this.hub.live.get(this.nodeId)?.ready) return;
    void call(this.hub, this.nodeId, "resize", [this.procId, cols, rows]).catch(() => {});
  }

  kill(signal) { void call(this.hub, this.nodeId, "kill", [this.procId, signal]).catch(() => {}); }

  /** Stop following; the process goes on running on the device. */
  detach() {
    this.hub.unfollow(this);
    void call(this.hub, this.nodeId, "detach", [this.procId]).catch(() => {});
  }
}
