import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const TRANSCRIBE_RS_PROTOCOL_VERSION = 1;
export const TRANSCRIBE_RS_MAX_JSON_BYTES = 64 * 1024;
export const TRANSCRIBE_RS_MAX_PAYLOAD_BYTES = 12 * 1024 * 1024;

function workerError(code, message, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function requestId() {
  return `transcribe-rs-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function encodeTranscribeRsFrame(header, payload = Buffer.alloc(0)) {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const bytes = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || []);
  if (json.length > TRANSCRIBE_RS_MAX_JSON_BYTES) throw workerError("voice_worker_frame_oversized", "Worker JSON header exceeds the protocol limit", 400);
  if (bytes.length > TRANSCRIBE_RS_MAX_PAYLOAD_BYTES) throw workerError("voice_worker_frame_oversized", "Worker binary payload exceeds the protocol limit", 400);
  const frame = Buffer.allocUnsafe(8 + json.length + bytes.length);
  frame.writeUInt32LE(json.length, 0);
  frame.writeUInt32LE(bytes.length, 4);
  json.copy(frame, 8);
  bytes.copy(frame, 8 + json.length);
  return frame;
}

export class TranscribeRsFrameDecoder {
  constructor({ maxJsonBytes = TRANSCRIBE_RS_MAX_JSON_BYTES, maxPayloadBytes = TRANSCRIBE_RS_MAX_PAYLOAD_BYTES } = {}) {
    this.maxJsonBytes = maxJsonBytes;
    this.maxPayloadBytes = maxPayloadBytes;
    this.buffer = Buffer.alloc(0);
  }

  push(chunk) {
    if (!chunk?.length) return [];
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : Buffer.from(chunk);
    const frames = [];
    while (this.buffer.length >= 8) {
      const jsonBytes = this.buffer.readUInt32LE(0);
      const payloadBytes = this.buffer.readUInt32LE(4);
      if (jsonBytes > this.maxJsonBytes || payloadBytes > this.maxPayloadBytes) {
        throw workerError("voice_worker_frame_oversized", `Worker frame declaration exceeds limits: jsonBytes=${jsonBytes}, payloadBytes=${payloadBytes}`, 400);
      }
      const frameBytes = 8 + jsonBytes + payloadBytes;
      if (this.buffer.length < frameBytes) break;
      const json = this.buffer.subarray(8, 8 + jsonBytes).toString("utf8");
      const payload = Buffer.from(this.buffer.subarray(8 + jsonBytes, frameBytes));
      this.buffer = this.buffer.subarray(frameBytes);
      let header;
      try { header = JSON.parse(json); }
      catch (error) { throw workerError("voice_worker_frame_invalid", `Worker returned invalid JSON: ${error.message}`, 502); }
      frames.push({ header, payload });
    }
    return frames;
  }
}

function abortReason(signal) {
  const reason = signal?.reason;
  return typeof reason?.code === "string"
    ? reason
    : workerError("voice_operation_cancelled", "Voice inference was cancelled", 499);
}

export class TranscribeRsWorkerClient {
  constructor({
    command,
    args = [],
    env = process.env,
    spawnImpl = spawn,
    shutdownTimeoutMs = 5_000,
  } = {}) {
    if (!command) throw new Error("TranscribeRsWorkerClient requires a worker command");
    this.command = command;
    this.args = [...args];
    this.env = { ...env };
    this.spawnImpl = spawnImpl;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.child = null;
    this.decoder = new TranscribeRsFrameDecoder();
    this.pending = new Map();
    this.sequence = 0;
    this.sessionId = null;
    this.stderr = "";
    this.exitPromise = null;
    this.startPromise = null;
  }

  get stderrTail() {
    return this.stderr;
  }

  get pid() {
    return this.child?.pid || null;
  }

  get isAlive() {
    return Boolean(this.child && this.child.exitCode == null);
  }

  async start() {
    if (this.child) return this;
    if (this.startPromise) return this.startPromise;
    this.startPromise = Promise.resolve().then(() => {
      this.decoder = new TranscribeRsFrameDecoder();
      const child = this.spawnImpl(this.command, this.args, {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: this.env,
      });
      if (!child?.stdin || !child?.stdout || !child?.stderr) throw workerError("voice_worker_spawn_failed", "The transcribe-rs worker did not expose private pipes");
      this.child = child;
      this.exitPromise = new Promise((resolve) => {
        child.once("exit", (code, signal) => {
          if (this.child === child) this.child = null;
          resolve({ code, signal });
          this.failPending(workerError("voice_worker_crashed", `The transcribe-rs worker exited with ${code ?? signal}`, 502));
        });
      });
      child.once("error", (error) => this.failPending(workerError("voice_worker_crashed", `The transcribe-rs worker failed: ${error.message}`, 502)));
      child.stdout.on("data", (chunk) => {
        try {
          for (const frame of this.decoder.push(chunk)) this.handleFrame(frame);
        } catch (error) {
          this.failPending(error);
          child.kill?.("SIGTERM");
        }
      });
      child.stderr.on("data", (chunk) => {
        this.stderr = `${this.stderr}${Buffer.from(chunk).toString("utf8")}`.slice(-8_192);
      });
      return this;
    }).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  failPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  handleFrame({ header, payload }) {
    if (payload.length) throw workerError("voice_worker_payload_unexpected", "Worker response carried an unexpected binary payload");
    if (header?.protocol !== TRANSCRIBE_RS_PROTOCOL_VERSION) throw workerError("voice_worker_protocol_version", "Worker response used an unsupported protocol version");
    const id = header?.requestId;
    const pending = id ? this.pending.get(id) : null;
    if (!pending) throw workerError("voice_worker_response_unknown", "Worker response did not match a pending request");
    this.pending.delete(id);
    if (header.sessionId !== pending.sessionId) throw workerError("voice_worker_session_mismatch", "Worker response sessionId did not match the request");
    if (header.ok !== true) {
      const error = workerError(header.error?.code || "voice_worker_request_failed", header.error?.message || "The transcribe-rs worker rejected the request");
      pending.reject(error);
      return;
    }
    pending.resolve(header.result || {});
  }

  async request(command, fields = {}, payload = Buffer.alloc(0), { signal, requestId: explicitRequestId } = {}) {
    await this.start();
    if (signal?.aborted) throw abortReason(signal);
    const id = explicitRequestId || `${requestId()}-${++this.sequence}`;
    const sessionId = fields.sessionId ?? null;
    const header = {
      protocol: TRANSCRIBE_RS_PROTOCOL_VERSION,
      command,
      requestId: id,
      ...(sessionId ? { sessionId } : {}),
      ...fields,
    };
    const bytes = encodeTranscribeRsFrame(header, payload);
    const promise = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject, sessionId }));
    try { this.child.stdin.write(bytes); }
    catch (error) {
      this.pending.delete(id);
      throw workerError("voice_worker_pipe_failed", `Could not write to the transcribe-rs worker: ${error.message}`);
    }
    return promise;
  }

  async hello() {
    return this.request("hello");
  }

  async load({ modelDir, quantization = "int8", requestedProvider = "cpu", sessionId = `session-${Date.now()}-${Math.random().toString(16).slice(2)}` } = {}) {
    const result = await this.request("load", { sessionId, modelDir, quantization, requestedProvider });
    this.sessionId = sessionId;
    return result;
  }

  async transcribeRange({ pcm16, fromSample, throughSample, sequence = 0, operationId = null, signal } = {}) {
    if (!this.sessionId) throw workerError("voice_worker_session_missing", "The transcribe-rs worker has no loaded session");
    if (signal?.aborted) throw abortReason(signal);
    const id = `${requestId()}-${++this.sequence}`;
    const fields = {
      sessionId: this.sessionId,
      fromSample,
      throughSample,
      sequence,
      ...(operationId ? { operationId } : {}),
    };
    const task = this.request("transcribe_range", fields, pcm16, { signal, requestId: id });
    if (!signal) return task;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        callback(value);
      };
      const onAbort = () => {
        void this.request("cancel", { sessionId: this.sessionId, targetRequestId: id }).catch(() => {});
        finish(reject, abortReason(signal));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      task.then((value) => finish(resolve, value), (error) => finish(reject, error));
    });
  }

  async cancel(targetRequestId) {
    if (!this.sessionId) return { cancelled: false, reason: "no_session" };
    return this.request("cancel", { sessionId: this.sessionId, targetRequestId });
  }

  async health() {
    return this.request("health", this.sessionId ? { sessionId: this.sessionId } : {});
  }

  async unload() {
    if (!this.sessionId) return { unloaded: false, reason: "no_session" };
    const result = await this.request("unload", { sessionId: this.sessionId });
    this.sessionId = null;
    return result;
  }

  async close() {
    const child = this.child;
    if (!child) return;
    try {
      await this.request("shutdown");
    } catch {}
    if (this.exitPromise) {
      await Promise.race([
        this.exitPromise,
        new Promise((resolve) => setTimeout(resolve, this.shutdownTimeoutMs)),
      ]);
    }
    if (this.child === child && child.exitCode == null) child.kill?.("SIGTERM");
    this.failPending(workerError("voice_worker_closed", "The transcribe-rs worker was closed"));
    this.child = null;
    this.sessionId = null;
  }

  dispose() {
    return this.close();
  }
}

export function defaultTranscribeRsWorkerCommand() {
  return process.env.CONDUIT_TRANSCRIBE_RS_WORKER
    || fileURLToPath(new URL("../../native/transcribe-rs-worker/target/release/conduit-transcribe-rs-worker", import.meta.url));
}
