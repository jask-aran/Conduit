import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { createHttpAdapter } from "../src/server/dictation-stream.js";
import { startConduitHarness } from "./helpers/conduit-harness.js";

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
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

test("HTTP snapshot adapters retain pause-separated final transcript segments", async () => {
  const events = [];
  const adapter = createHttpAdapter(
    { endpoint: "https://speech.example/v1/audio/transcriptions", provider: "local", headers: {} },
    (event) => events.push(event),
    { maxAudioBytes: 1_000_000, maxEventBytes: 64 * 1024 },
    async () => new Response([
      "event: transcript.text.done",
      'data: {"type":"transcript.text.done","text":"This is before the pause."}',
      "",
      "event: transcript.text.done",
      'data: {"type":"transcript.text.done","text":"This is after the pause."}',
      "",
    ].join("\n"), { headers: { "content-type": "text/event-stream" } }),
  );
  adapter.write(Buffer.alloc(640));
  await adapter.stop();
  assert.deepEqual(events.filter((event) => event.type === "final").map((event) => event.text), [
    "This is before the pause.",
    "This is before the pause. This is after the pause.",
  ]);
  assert.equal(events.find((event) => event.type === "adapter_closed").text, "This is before the pause. This is after the pause.");
});

test("HTTP snapshot adapters do not duplicate a whitespace-normalized final over delta accumulation", async () => {
  const events = [];
  const adapter = createHttpAdapter(
    { endpoint: "https://speech.example/v1/audio/transcriptions", provider: "local", headers: {} },
    (event) => events.push(event),
    { maxAudioBytes: 1_000_000, maxEventBytes: 64 * 1024 },
    async () => new Response([
      "event: transcript.text.delta",
      'data: {"type":"transcript.text.delta","delta":" This"}',
      "",
      "event: transcript.text.delta",
      'data: {"type":"transcript.text.delta","delta":" is"}',
      "",
      "event: transcript.text.delta",
      'data: {"type":"transcript.text.delta","delta":" a long pause test"}',
      "",
      "event: transcript.text.done",
      'data: {"type":"transcript.text.done","text":"This is a long pause test"}',
      "",
    ].join("\n"), { headers: { "content-type": "text/event-stream" } }),
  );
  adapter.write(Buffer.alloc(640));
  await adapter.stop();
  const finals = events.filter((event) => event.type === "final").map((event) => event.text);
  assert.deepEqual(finals, ["This is a long pause test"]);
  assert.equal(events.find((event) => event.type === "adapter_closed").text, "This is a long pause test");
});

test("authenticated Conduit dictation bridge keeps PCM flowing across a speech-end pause", async () => {
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await listen(upstream);
  const port = upstream.address().port;
  let authorization = null;
  let binaryBytes = 0;
  let binaryFrames = 0;
  let stopCommand = null;
  upstream.on("connection", (socket, request) => {
    authorization = request.headers.authorization;
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        binaryBytes += data.length;
        binaryFrames += 1;
        socket.send(JSON.stringify({ type: "partial", text: binaryFrames === 1 ? "hello wor" : "hello world" }));
        if (binaryFrames === 1) socket.send(JSON.stringify({ type: "end_of_speech" }));
        return;
      }
      stopCommand = JSON.parse(String(data));
      socket.send(JSON.stringify({ type: "final", text: "hello world" }));
    });
  });
  const server = await startConduitHarness({ env: {
    CONDUIT_PARAKEET_STREAM_URL: `ws://127.0.0.1:${port}/ws`,
    CONDUIT_PARAKEET_API_KEY: "bridge-secret",
  } });
  const client = new WebSocket(`${server.origin.replace("http", "ws")}/v0/dictation/stream`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    assert.equal((await next((event) => event.type === "ready")).sampleRate, 16_000);
    client.send(Buffer.alloc(640), { binary: true });
    assert.equal((await next((event) => event.type === "partial")).text, "hello wor");
    assert.equal((await next((event) => event.type === "end_of_speech")).type, "end_of_speech");
    client.send(Buffer.alloc(640), { binary: true });
    assert.equal((await next((event) => event.type === "partial")).text, "hello world");
    assert.equal(binaryBytes, 1_280);
    client.send(JSON.stringify({ type: "stop" }));
    assert.equal((await next((event) => event.type === "final")).text, "hello world");
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "hello world");
    assert.equal(completed.final, true);
    assert.equal(completed.finalWithinDeadline, true);
    assert.ok(completed.settlementMs >= 0 && completed.settlementMs <= 1_000);
    assert.equal(completed.reason, "stopped");
    assert.equal(completed.audioBytes, 1_280);
    assert.equal(completed.audioDurationMs, 40);
    assert.equal(completed.adapter, "parakeet_pcm_ws_v1");
    assert.equal(completed.provider, "custom");
    assert.equal(completed.model, null);
    assert.equal(authorization, "Bearer bridge-secret");
    assert.equal(binaryBytes, 1_280);
    assert.deepEqual(stopCommand, { type: "stop" });
  } catch (error) {
    console.error(error);
    throw error;
  } finally {
    for (const socket of upstream.clients) socket.terminate();
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await server.stop();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("successful dictation stores the server PCM with transcript diagnostics", async () => {
  const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await listen(upstream);
  const port = upstream.address().port;
  let stopCommand = null;
  upstream.on("connection", (socket) => {
    let frameCount = 0;
    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        frameCount += 1;
        socket.send(JSON.stringify({ type: "partial", text: frameCount === 1 ? "long pause" : "long pause test" }));
        if (frameCount === 1) socket.send(JSON.stringify({ type: "end_of_speech" }));
        return;
      }
      stopCommand = JSON.parse(String(data));
      socket.send(JSON.stringify({ type: "final", text: "long pause test" }));
    });
  });
  const server = await startConduitHarness({ env: {
    CONDUIT_PARAKEET_STREAM_URL: `ws://127.0.0.1:${port}/ws`,
    CONDUIT_PARAKEET_API_KEY: "bridge-secret",
  } });
  const client = new WebSocket(`${server.origin.replace("http", "ws")}/v0/dictation/stream`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    client.send(Buffer.alloc(16_000, 1), { binary: true });
    await next((event) => event.type === "partial");
    await next((event) => event.type === "end_of_speech");
    client.send(Buffer.alloc(16_000, 2), { binary: true });
    await next((event) => event.type === "partial");
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 32_000 }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "long pause test");
    assert.equal(completed.audioBytes, 32_000);
    assert.equal(completed.audioDurationMs, 1_000);
    assert.deepEqual(stopCommand, { type: "stop" });

    const recordingsRoot = path.join(server.root, "voice-recordings");
    const files = await fs.readdir(recordingsRoot);
    assert.equal(files.filter((file) => file.endsWith(".wav")).length, 1);
    assert.equal(files.filter((file) => file.endsWith(".json")).length, 1);
    const metadataFile = files.find((file) => file.endsWith(".json"));
    const metadata = JSON.parse(await fs.readFile(path.join(recordingsRoot, metadataFile), "utf8"));
    assert.equal(metadata.transcript, "long pause test");
    assert.equal(metadata.completionReason, "stopped");
    assert.equal(metadata.clientAudioBytes, 32_000);
    assert.equal(metadata.serverAudioBytes, 32_000);
    assert.equal(metadata.serverAudioDurationMs, 1_000);
    assert.equal(metadata.provider, "custom");
    assert.equal(metadata.adapter, "parakeet_pcm_ws_v1");
    assert.equal(metadata.audioFile, metadataFile.replace(/\.json$/, ".wav"));
    const wav = await fs.readFile(path.join(recordingsRoot, metadata.audioFile));
    assert.equal(wav.length, 44 + 32_000);
    assert.equal(wav.subarray(44, 44 + 16_000).every((value) => value === 1), true);
    assert.equal(wav.subarray(44 + 16_000).every((value) => value === 2), true);
  } finally {
    for (const socket of upstream.clients) socket.terminate();
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await server.stop();
    await new Promise((resolve) => upstream.close(resolve));
  }
});
