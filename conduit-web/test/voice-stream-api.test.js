import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { createDictationStream } from "../src/server/dictation-stream.js";
import { VoiceRecordingStore } from "../src/server/voice-recording-store.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
    server.listen(0, "127.0.0.1");
  });
}

function messageQueue(socket) {
  const queued = [];
  const waiting = [];
  socket.on("message", (data) => {
    const event = JSON.parse(String(data));
    const match = waiting.findIndex((item) => item.predicate(event));
    if (match >= 0) waiting.splice(match, 1)[0].resolve(event);
    else queued.push(event);
  });
  return (predicate, timeoutMs = 3_000) => {
    const existing = queued.findIndex(predicate);
    if (existing >= 0) return Promise.resolve(queued.splice(existing, 1)[0]);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for dictation event")), timeoutMs);
      waiting.push({ predicate, resolve: (event) => { clearTimeout(timer); resolve(event); } });
    });
  };
}

async function poll(read) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the voice recording");
}

const waitForRecordings = (root) => poll(async () => {
  const published = (await fs.readdir(root)).filter((file) => !file.startsWith(".pending-"));
  return published.some((file) => file.endsWith(".wav")) && published.some((file) => file.endsWith(".json")) && published;
});

const waitForSidecar = (root, predicate) => poll(async () => {
  const metadataFile = (await fs.readdir(root)).find((file) => file.endsWith(".json") && !file.startsWith(".pending-"));
  const metadata = metadataFile && JSON.parse(await fs.readFile(path.join(root, metadataFile), "utf8"));
  return metadata && predicate(metadata) && metadata;
});

async function startUpstream(frames) {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const frame of frames) {
      response.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
    }
    response.end();
  });
  await listen(server);
  return server;
}

const done = (text) => ({ event: "transcript.text.done", data: { type: "transcript.text.done", text } });
const delta = (text) => ({ event: "transcript.text.delta", data: { type: "transcript.text.delta", delta: text } });

async function startDictationBridge({ upstreamPort, recordingStore = null, resolveDelayMs = 0, pins = null, runtimeConfig = null }) {
  const wss = new WebSocketServer({ noServer: true });
  const stream = createDictationStream({
    wss,
    voiceRuntime: {
      pin: () => { if (pins) pins.count += 1; },
      unpin: () => { if (pins) pins.count = Math.max(0, pins.count - 1); },
      resolve: async () => {
        if (resolveDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, resolveDelayMs));
        return runtimeConfig || {
          mode: "remote",
          segmentation: "none",
          provider: "custom",
          adapter: "openai_audio_sse_v1",
          model: "",
          endpoint: `http://127.0.0.1:${upstreamPort}/v1/audio/transcriptions`,
          headers: {},
          allowPrivate: true,
        };
      },
    },
    recordingStore,
    limits: {},
  });
  const bridge = createServer();
  bridge.on("upgrade", (request, socket, head) => stream.handleUpgrade(request, socket, head));
  await listen(bridge);
  const client = new WebSocket(`ws://127.0.0.1:${bridge.address().port}/dictation`);
  const next = messageQueue(client);
  const opened = new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
  return { bridge, client, next, opened, stream };
}

async function closeAll({ client, bridge }, upstream, root) {
  client.terminate();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await new Promise((resolve) => bridge.close(resolve));
  await new Promise((resolve) => upstream.close(resolve));
  if (root) await fs.rm(root, { recursive: true, force: true });
}

test("Conduit dictation bridge keeps PCM flowing and finalizes through the HTTP adapter", async () => {
  const upstream = await startUpstream([delta(" hello"), delta(" world"), done("hello world")]);
  const session = await startDictationBridge({ upstreamPort: upstream.address().port });
  const { client, next } = session;
  try {
    await session.opened;
    assert.equal((await next((event) => event.type === "ready")).sampleRate, 16_000);
    client.send(Buffer.alloc(640), { binary: true });
    client.send(JSON.stringify({ type: "stop" }));
    assert.equal((await next((event) => event.type === "finalizing")).audioDurationMs, 20);
    assert.equal((await next((event) => event.type === "partial")).text, " hello");
    assert.equal((await next((event) => event.type === "final")).text, "hello world");
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "hello world");
    assert.equal(completed.final, true);
    assert.equal(completed.reason, "stopped");
    assert.equal(completed.audioBytes, 640);
  } finally {
    await closeAll(session, upstream);
  }
});

test("dictation accepts PCM during cold resolve and includes it after stop", async () => {
  const upstream = await startUpstream([done("cold start audio")]);
  const pins = { count: 0 };
  const session = await startDictationBridge({ upstreamPort: upstream.address().port, resolveDelayMs: 150, pins });
  const { client, next } = session;
  try {
    await session.opened;
    assert.equal((await next((event) => event.type === "ready")).sampleRate, 16_000);
    assert.equal(pins.count, 1);
    client.send(Buffer.alloc(1_280, 7), { binary: true });
    client.send(Buffer.alloc(640, 8), { binary: true });
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 1_920 }));
    await next((event) => event.type === "waiting_for_transcription");
    assert.equal((await next((event) => event.type === "runtime_ready")).inferenceMode, "batch");
    const completed = await next((event) => event.type === "completed", 5_000);
    assert.equal(completed.text, "cold start audio");
    assert.equal(completed.audioBytes, 1_920);
    client.close();
    await new Promise((resolve) => client.once("close", resolve));
    assert.equal(pins.count, 0);
  } finally {
    await closeAll(session, upstream);
  }
});

test("dictation shutdown closes sessions before draining accepted archives", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-stream-shutdown-"));
  const recordingsRoot = path.join(root, "recordings");
  const upstream = await startUpstream([]);
  const recordingStore = new VoiceRecordingStore({ root: recordingsRoot });
  const session = await startDictationBridge({ upstreamPort: upstream.address().port, recordingStore });
  try {
    await session.opened;
    await session.next((event) => event.type === "ready");
    session.client.send(Buffer.alloc(32_000, 6), { binary: true });
    assert.equal((await session.stream.shutdown({ timeoutMs: 500 })).closed, true);
    assert.equal((await recordingStore.drain({ timeoutMs: 1_000 })).drained, true);
    const files = await waitForRecordings(recordingsRoot);
    assert.equal(files.filter((file) => file.endsWith(".wav")).length, 1);
    assert.equal(files.filter((file) => file.endsWith(".json")).length, 1);
  } finally {
    await closeAll(session, upstream, root);
  }
});

test("successful dictation stores the server PCM with transcript diagnostics", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-stream-"));
  const recordingsRoot = path.join(root, "recordings");
  const upstream = await startUpstream([delta("long pause"), delta(" test"), done("long pause test")]);
  const recordingStore = new VoiceRecordingStore({ root: recordingsRoot });
  const session = await startDictationBridge({ upstreamPort: upstream.address().port, recordingStore });
  const { client, next } = session;
  const audible = (value) => Buffer.from(new Int16Array(8_000).fill(value).buffer);
  try {
    await session.opened;
    await next((event) => event.type === "ready");
    client.send(audible(4_000), { binary: true });
    client.send(audible(8_000), { binary: true });
    client.send(JSON.stringify({
      type: "stop",
      audioBytesSent: 32_000,
      clientDiagnostics: {
        schemaVersion: 5,
        capture: {
          requestedConstraints: { audio: { deviceId: { exact: "mic-secret" } } },
          effectiveTrackSettings: { deviceId: "mic-secret", groupId: "group-secret", sampleRate: 48_000 },
        },
      },
    }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "long pause test");
    assert.equal(completed.audioBytes, 32_000);
    assert.equal(completed.audioDurationMs, 1_000);
    const finalClientDiagnostics = JSON.parse(JSON.stringify(completed.diagnostics.client));
    finalClientDiagnostics.events = { ...finalClientDiagnostics.events, finalEventMs: 123 };
    client.send(JSON.stringify({ type: "client_diagnostics", clientDiagnostics: finalClientDiagnostics }));
    assert.equal((await next((event) => event.type === "client_diagnostics_ack")).accepted, true);

    const metadataFile = (await waitForRecordings(recordingsRoot)).find((file) => file.endsWith(".json"));
    const metadata = await waitForSidecar(recordingsRoot, (sidecar) => sidecar.diagnostics?.client?.events?.finalEventMs === 123);
    assert.equal(metadata.transcript, "long pause test");
    assert.equal(metadata.transcriptStatus, "non_empty");
    assert.equal(metadata.completionReason, "stopped");
    assert.equal(metadata.clientAudioBytes, 32_000);
    assert.equal(metadata.serverAudioBytes, 32_000);
    assert.equal(metadata.diagnostics.client.capture.requestedConstraints.audio.deviceId.exact, "[redacted]");
    assert.equal(metadata.diagnostics.client.capture.effectiveTrackSettings.deviceId, "[redacted]");
    assert.equal(metadata.diagnostics.client.capture.effectiveTrackSettings.groupId, "[redacted]");
    assert.equal(JSON.stringify(metadata).includes("mic-secret"), false);
    assert.equal(metadata.audioFile, metadataFile.replace(/\.json$/, ".wav"));
    const wav = await fs.readFile(path.join(recordingsRoot, metadata.audioFile));
    assert.equal(wav.length, 44 + 32_000);
    assert.equal(wav.readInt16LE(44), 4_000);
    assert.equal(wav.readInt16LE(44 + 16_000), 8_000);
  } finally {
    await closeAll(session, upstream, root);
  }
});
