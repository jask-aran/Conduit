import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { createDictationStream, createDeepgramAdapter, createHttpAdapter, splitSilence } from "../src/server/dictation-stream.js";
import { VoiceRecordingStore } from "../src/server/voice-recording-store.js";

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

async function startUpstream(frames) {
  const server = createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const frame of frames) {
      response.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
    }
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await listen(server);
  return server;
}

async function startDictationBridge({ upstreamPort, recordingStore = null, resolveDelayMs = 0, pins = null }) {
  const wss = new WebSocketServer({ noServer: true });
  let resolveCount = 0;
  const stream = createDictationStream({
    wss,
    voiceRuntime: {
      pin: () => { if (pins) pins.count += 1; },
      unpin: () => { if (pins) pins.count = Math.max(0, pins.count - 1); },
      resolve: async () => {
        resolveCount += 1;
        if (resolveDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, resolveDelayMs));
        return {
          mode: "remote",
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
  });
  const bridge = createServer();
  bridge.on("upgrade", (request, socket, head) => stream.handleUpgrade(request, socket, head));
  bridge.listen(0, "127.0.0.1");
  await listen(bridge);
  return { bridge, origin: `ws://127.0.0.1:${bridge.address().port}`, resolveCount: () => resolveCount };
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

test("Conduit dictation bridge keeps PCM flowing and finalizes through the HTTP adapter", async () => {
  const upstream = await startUpstream([
    { event: "transcript.text.delta", data: { type: "transcript.text.delta", delta: " hello" } },
    { event: "transcript.text.delta", data: { type: "transcript.text.delta", delta: " world" } },
    { event: "transcript.text.done", data: { type: "transcript.text.done", text: "hello world" } },
  ]);
  const { bridge, origin } = await startDictationBridge({ upstreamPort: upstream.address().port });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    assert.equal((await next((event) => event.type === "ready")).sampleRate, 16_000);
    client.send(Buffer.alloc(640), { binary: true });
    client.send(JSON.stringify({ type: "stop" }));
    const finalizing = await next((event) => event.type === "finalizing");
    assert.equal(finalizing.timeoutMs, 30_000);
    assert.equal(finalizing.audioDurationMs, 20);
    assert.equal(finalizing.adapter, "openai_audio_sse_v1");
    assert.equal((await next((event) => event.type === "partial")).text, " hello");
    assert.equal((await next((event) => event.type === "final")).text, "hello world");
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "hello world");
    assert.equal(completed.final, true);
    assert.equal(completed.finalWithinDeadline, true);
    assert.ok(completed.settlementMs >= 0 && completed.settlementMs <= 1_000);
    assert.equal(completed.reason, "stopped");
    assert.equal(completed.audioBytes, 640);
    assert.equal(completed.audioDurationMs, 20);
    assert.equal(completed.adapter, "openai_audio_sse_v1");
    assert.equal(completed.provider, "custom");
    assert.equal(completed.model, null);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("dictation accepts PCM during cold resolve and includes it after stop", async () => {
  const upstream = await startUpstream([
    { event: "transcript.text.done", data: { type: "transcript.text.done", text: "cold start audio" } },
  ]);
  const pins = { count: 0 };
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    resolveDelayMs: 150,
    pins,
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    assert.equal((await next((event) => event.type === "ready")).sampleRate, 16_000);
    assert.equal(pins.count, 1);
    client.send(Buffer.alloc(1_280, 7), { binary: true });
    client.send(Buffer.alloc(640, 8), { binary: true });
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 1_920 }));
    const completed = await next((event) => event.type === "completed", 5_000);
    assert.equal(completed.text, "cold start audio");
    assert.equal(completed.audioBytes, 1_920);
    assert.equal(completed.reason, "stopped");
    client.close();
    await new Promise((resolve) => client.once("close", resolve));
    assert.equal(pins.count, 0);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("dictation surfaces resolve failures after early ready", async () => {
  const wss = new WebSocketServer({ noServer: true });
  const stream = createDictationStream({
    wss,
    voiceRuntime: {
      resolve: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        throw Object.assign(new Error("Install the model first"), { code: "voice_model_not_installed" });
      },
    },
  });
  const bridge = createServer();
  bridge.on("upgrade", (request, socket, head) => stream.handleUpgrade(request, socket, head));
  bridge.listen(0, "127.0.0.1");
  await listen(bridge);
  const client = new WebSocket(`ws://127.0.0.1:${bridge.address().port}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    assert.equal((await next((event) => event.type === "ready")).encoding, "pcm_s16le");
    client.send(Buffer.alloc(320), { binary: true });
    const error = await next((event) => event.type === "error");
    assert.equal(error.code, "voice_model_not_installed");
    assert.match(error.message, /Install the model first/);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
  }
});

test("successful dictation stores the server PCM with transcript diagnostics", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-stream-"));
  const recordingsRoot = path.join(root, "recordings");
  const upstream = await startUpstream([
    { event: "transcript.text.delta", data: { type: "transcript.text.delta", delta: "long pause" } },
    { event: "transcript.text.delta", data: { type: "transcript.text.delta", delta: " test" } },
    { event: "transcript.text.done", data: { type: "transcript.text.done", text: "long pause test" } },
  ]);
  const recordingStore = new VoiceRecordingStore({ root: recordingsRoot });
  const { bridge, origin } = await startDictationBridge({ upstreamPort: upstream.address().port, recordingStore });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  const audible = (value) => {
    const buffer = Buffer.alloc(16_000);
    for (let index = 0; index < 8_000; index += 1) buffer.writeInt16LE(value, index * 2);
    return buffer;
  };
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    client.send(audible(4_000), { binary: true });
    client.send(audible(8_000), { binary: true });
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 32_000 }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "long pause test");
    assert.equal(completed.audioBytes, 32_000);
    assert.equal(completed.audioDurationMs, 1_000);

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
    assert.equal(metadata.adapter, "openai_audio_sse_v1");
    assert.equal(metadata.audioFile, metadataFile.replace(/\.json$/, ".wav"));
    const wav = await fs.readFile(path.join(recordingsRoot, metadata.audioFile));
    assert.equal(wav.length, 44 + 32_000);
    assert.equal(wav.readInt16LE(44), 4_000);
    assert.equal(wav.readInt16LE(44 + 16_000), 8_000);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});

function pcmWith(parts) {
  return Buffer.concat(parts.map(({ samples, level }) => {
    const buffer = Buffer.alloc(samples * 2);
    for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(level * 32767), index * 2);
    return buffer;
  }));
}

test("splitSilence keeps recordings without a long pause as one segment", () => {
  const pcm = pcmWith([{ samples: 8_000, level: 0.1 }, { samples: 4_000, level: 0 }]);
  assert.deepEqual(splitSilence(pcm, pcm.length), [[0, 12_000]]);
});

test("splitSilence trims leading and trailing silence and splits long pauses", () => {
  const pcm = pcmWith([
    { samples: 3_000, level: 0 },
    { samples: 16_000, level: 0.1 },
    { samples: 40_000, level: 0 },
    { samples: 8_000, level: 0.1 },
    { samples: 2_000, level: 0 },
  ]);
  // Segment boundaries snap to the 10ms analysis windows: the leading 187.5ms
  // silence stays inside the first segment and the cuts land at the first
  // window that crosses the speech level.
  assert.deepEqual(splitSilence(pcm, pcm.length), [[0, 19_040], [58_880, 69_000]]);
});

test("splitSilence drops tiny speech blips between pauses", () => {
  const pcm = pcmWith([
    { samples: 16_000, level: 0.1 },
    { samples: 40_000, level: 0 },
    { samples: 4_000, level: 0.1 },
    { samples: 40_000, level: 0 },
    { samples: 16_000, level: 0.1 },
  ]);
  assert.deepEqual(splitSilence(pcm, pcm.length), [[0, 16_000], [100_000, 116_000]]);
});

test("splitSilence returns no segments for all-silence input", () => {
  assert.deepEqual(splitSilence(Buffer.alloc(80_000), 80_000), []);
});

test("splitSilence caps the number of segments", () => {
  const parts = [];
  for (let index = 0; index < 8; index += 1) {
    parts.push({ samples: 8_000, level: 0.1 });
    parts.push({ samples: 32_000, level: 0 });
  }
  parts.push({ samples: 8_000, level: 0.1 });
  const pcm = pcmWith(parts);
  const segments = splitSilence(pcm, pcm.length, { maxSegments: 4 });
  assert.equal(segments.length, 4);
});

test("HTTP adapters split long pauses into separate transcription requests", async () => {
  const requestBodies = [];
  const upstream = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requestBodies.push(Buffer.concat(chunks));
      const first = requestBodies.length === 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: transcript.text.delta\ndata: ${JSON.stringify({ type: "transcript.text.delta", delta: first ? "before the pause." : " after" })}\n\n`);
      response.write(`event: transcript.text.done\ndata: ${JSON.stringify({ type: "transcript.text.done", text: first ? "before the pause." : "after the pause." })}\n\n`);
      response.end();
    });
  });
  upstream.listen(0, "127.0.0.1");
  await listen(upstream);
  const events = [];
  const adapter = createHttpAdapter(
    { endpoint: `http://127.0.0.1:${upstream.address().port}/v1/audio/transcriptions`, provider: "local", headers: {} },
    (event) => events.push(event),
    { maxAudioBytes: 1_000_000, maxEventBytes: 64 * 1024 },
    fetch,
  );
  try {
    adapter.write(pcmWith([{ samples: 16_000, level: 0.1 }, { samples: 40_000, level: 0 }, { samples: 16_000, level: 0.1 }]));
    await adapter.stop();
    assert.equal(requestBodies.length, 2);
    const wavSizes = requestBodies.map((body) => body.readUInt32LE(body.indexOf("RIFF") + 40));
    assert.deepEqual(wavSizes, [32_000, 32_000], "each request carries one utterance of PCM");
    assert.ok(requestBodies[0].readInt16LE(requestBodies[0].indexOf("RIFF") + 44) > 3_000, "first request carries the first utterance");
    assert.ok(requestBodies[1].readInt16LE(requestBodies[1].indexOf("RIFF") + 44) > 3_000, "second request carries the second utterance");
    assert.deepEqual(events.filter((event) => event.type === "partial").map((event) => event.text), [
      "before the pause.",
      "before the pause. after",
    ]);
    assert.deepEqual(events.filter((event) => event.type === "final").map((event) => event.text), [
      "before the pause.",
      "before the pause. after the pause.",
    ]);
    assert.equal(events.find((event) => event.type === "adapter_closed").text, "before the pause. after the pause.");
  } finally {
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("dictation bridge joins multi-segment transcripts into one completed text", async () => {
  const requestCount = { value: 0 };
  const upstream = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      requestCount.value += 1;
      const first = requestCount.value === 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: transcript.text.done\ndata: ${JSON.stringify({ type: "transcript.text.done", text: first ? "first sentence." : "second sentence." })}\n\n`);
      response.end();
    });
  });
  upstream.listen(0, "127.0.0.1");
  await listen(upstream);
  const { bridge, origin } = await startDictationBridge({ upstreamPort: upstream.address().port });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    assert.equal((await next((event) => event.type === "ready")).sampleRate, 16_000);
    const audio = pcmWith([{ samples: 16_000, level: 0.1 }, { samples: 40_000, level: 0 }, { samples: 16_000, level: 0.1 }]);
    for (let offset = 0; offset < audio.length; offset += 5_120) client.send(audio.subarray(offset, offset + 5_120), { binary: true });
    client.send(JSON.stringify({ type: "stop" }));
    const finals = [];
    while (true) {
      const event = await next((event) => ["final", "completed"].includes(event.type));
      if (event.type === "completed") {
        assert.equal(event.reason, "stopped");
        assert.equal(event.final, true);
        assert.equal(event.text, "first sentence. second sentence.");
        assert.equal(event.audioBytes, 72_000 * 2);
        break;
      }
      finals.push(event.text);
    }
    assert.deepEqual(finals, ["first sentence.", "first sentence. second sentence."]);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("HTTP adapters keep identical repeated segments instead of deduplicating", async () => {
  const events = [];
  let requests = 0;
  const adapter = createHttpAdapter(
    { endpoint: "https://speech.example/v1/audio/transcriptions", provider: "local", headers: {} },
    (event) => events.push(event),
    { maxAudioBytes: 1_000_000, maxEventBytes: 64 * 1024 },
    async () => {
      requests += 1;
      return new Response([
        "event: transcript.text.done",
        'data: {"type":"transcript.text.done","text":"repeat me"}',
        "",
      ].join("\n"), { headers: { "content-type": "text/event-stream" } });
    },
  );
  adapter.write(pcmWith([{ samples: 16_000, level: 0.1 }, { samples: 40_000, level: 0 }, { samples: 16_000, level: 0.1 }]));
  await adapter.stop();
  assert.equal(requests, 2);
  assert.deepEqual(events.filter((event) => event.type === "final").map((event) => event.text), [
    "repeat me",
    "repeat me repeat me",
  ]);
  assert.equal(events.find((event) => event.type === "adapter_closed").text, "repeat me repeat me");
});

test("snapshot adapters split long pauses and join segment transcripts", async () => {
  const bodies = [];
  const events = [];
  const adapter = createDeepgramAdapter(
    { endpoint: "https://api.deepgram.com/v1/listen", model: "nova-3", headers: {} },
    (event) => events.push(event),
    { maxAudioBytes: 1_000_000, maxEventBytes: 64 * 1024 },
    async (_url, init) => {
      const body = Buffer.from(await init.body.arrayBuffer());
      bodies.push(body.length - 44);
      const first = bodies.length === 1;
      return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: first ? "first utterance" : "second utterance" }] }] } }), { status: 200 });
    },
  );
  adapter.write(pcmWith([{ samples: 16_000, level: 0.1 }, { samples: 40_000, level: 0 }, { samples: 16_000, level: 0.1 }]));
  await adapter.stop();
  assert.deepEqual(bodies, [32_000, 32_000]);
  assert.deepEqual(events.filter((event) => event.type === "final").map((event) => event.text), ["first utterance second utterance"]);
});
