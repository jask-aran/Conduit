import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  TranscribeRsFrameDecoder,
  TranscribeRsWorkerClient,
  encodeTranscribeRsFrame,
} from "../src/server/transcribe-rs-worker.js";

function fakeSpawn(requests) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  const decoder = new TranscribeRsFrameDecoder();
  let rangeTimer = null;
  const respond = (header, result = {}, error = null) => {
    child.stdout.write(encodeTranscribeRsFrame({
      protocol: 1,
      response: true,
      command: header.command,
      requestId: header.requestId,
      sessionId: header.sessionId || null,
      ok: !error,
      ...(error ? { error } : { result }),
    }));
  };
  child.stdin.on("data", (chunk) => {
    for (const frame of decoder.push(chunk)) {
      requests.push(frame);
      const { header } = frame;
      if (header.command === "hello") {
        respond(header, { workerVersion: "0.1.0", crateVersion: "0.3.8", compiledOrtProviders: ["cpu"], ports: { batch: true, stream: false } });
      } else if (header.command === "load") {
        respond(header, { requestedProvider: header.requestedProvider, actualProvider: "cpu", compiledOrtProviders: ["cpu"], ports: { batch: true, stream: false } });
      } else if (header.command === "transcribe_range") {
        rangeTimer = setTimeout(() => respond(header, { text: "range transcript", fromSample: header.fromSample, throughSample: header.throughSample, timestamps: [], authoritative: true }), 10);
      } else if (header.command === "cancel") {
        respond(header, { cancelled: true, targetRequestId: header.targetRequestId, authoritative: false });
        if (rangeTimer) clearTimeout(rangeTimer);
        const range = requests.findLast((request) => request.header.command === "transcribe_range");
        if (range) respond(range.header, {}, { code: "cancelled", message: "late output is not authoritative" });
      } else if (header.command === "health") {
        respond(header, { ready: true, loaded: true });
      } else if (header.command === "unload") {
        respond(header, { unloaded: true });
      } else if (header.command === "shutdown") {
        respond(header, { shuttingDown: true });
        setImmediate(() => child.kill("SIGTERM"));
      }
    }
  });
  child.kill = () => {
    if (child.exitCode != null) return;
    if (rangeTimer) clearTimeout(rangeTimer);
    child.exitCode = 0;
    child.emit("exit", 0, "SIGTERM");
  };
  return child;
}

test("transcribe-rs worker client frames hello, load, range, and provider truth", async () => {
  const requests = [];
  const client = new TranscribeRsWorkerClient({ command: "fake-worker", spawnImpl: () => fakeSpawn(requests) });
  try {
    const hello = await client.hello();
    assert.deepEqual(hello.compiledOrtProviders, ["cpu"]);
    const loaded = await client.load({ modelDir: "/models/parakeet", quantization: "int8", requestedProvider: "cpu", sessionId: "session-1" });
    assert.equal(loaded.actualProvider, "cpu");
    const result = await client.transcribeRange({ pcm16: Buffer.from([0, 0, 1, 0]), fromSample: 100, throughSample: 102, sequence: 3, operationId: "op-3" });
    assert.equal(result.text, "range transcript");
    assert.equal(requests[1].header.command, "load");
    assert.equal(requests[1].header.sessionId, "session-1");
    assert.equal(requests[2].header.fromSample, 100);
    assert.equal(requests[2].header.throughSample, 102);
    assert.deepEqual(requests[2].payload, Buffer.from([0, 0, 1, 0]));
  } finally { await client.close(); }
});

test("transcribe-rs worker cancellation rejects capture work and marks late output non-authoritative", async () => {
  const requests = [];
  const client = new TranscribeRsWorkerClient({ command: "fake-worker", spawnImpl: () => fakeSpawn(requests) });
  try {
    await client.load({ modelDir: "/models/parakeet", sessionId: "session-2" });
    const controller = new AbortController();
    const task = client.transcribeRange({ pcm16: Buffer.alloc(4), fromSample: 0, throughSample: 2, signal: controller.signal });
    controller.abort();
    await assert.rejects(task, { code: "voice_operation_cancelled" });
    assert.equal(requests.some((request) => request.header.command === "cancel"), true);
  } finally { await client.close(); }
});

test("transcribe-rs worker crash rejects the active operation", async () => {
  const requests = [];
  let child = null;
  const client = new TranscribeRsWorkerClient({ command: "fake-worker", spawnImpl: () => {
    child = fakeSpawn(requests);
    return child;
  } });
  try {
    await client.load({ modelDir: "/models/parakeet", sessionId: "session-crash" });
    const task = client.transcribeRange({ pcm16: Buffer.alloc(4), fromSample: 0, throughSample: 2 });
    await new Promise((resolve) => setImmediate(resolve));
    child.kill("SIGKILL");
    await assert.rejects(task, { code: "voice_worker_crashed" });
  } finally { await client.close(); }
});

test("transcribe-rs worker frame decoder rejects oversized declarations before slicing", () => {
  const decoder = new TranscribeRsFrameDecoder({ maxJsonBytes: 4, maxPayloadBytes: 4 });
  const prefix = Buffer.alloc(8);
  prefix.writeUInt32LE(5, 0);
  assert.throws(() => decoder.push(prefix), { code: "voice_worker_frame_oversized" });
});
