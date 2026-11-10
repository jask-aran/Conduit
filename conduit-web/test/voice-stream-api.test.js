import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { createDictationStream, createHttpAdapter } from "../src/server/dictation-stream.js";
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

async function waitForRecordings(root, expectedPairs = 1) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const files = await fs.readdir(root);
      const published = files.filter((file) => !file.startsWith(".pending-"));
      if (published.filter((file) => file.endsWith(".wav")).length >= expectedPairs
        && published.filter((file) => file.endsWith(".json")).length >= expectedPairs) return published;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return fs.readdir(root).then((files) => files.filter((file) => !file.startsWith(".pending-")));
}

async function waitForSidecar(root, predicate) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      const metadataFile = (await fs.readdir(root)).find((file) => file.endsWith(".json") && !file.startsWith(".pending-"));
      if (metadataFile) {
        const metadata = JSON.parse(await fs.readFile(path.join(root, metadataFile), "utf8"));
        if (predicate(metadata)) return metadata;
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for voice recording sidecar");
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

async function startDictationBridge({ upstreamPort, recordingStore = null, resolveDelayMs = 0, pins = null, runtimeConfig = null, segmentation = "none", limits = {} }) {
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
        return runtimeConfig || {
          mode: "remote",
          segmentation,
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
    limits,
  });
  const bridge = createServer();
  bridge.on("upgrade", (request, socket, head) => stream.handleUpgrade(request, socket, head));
  bridge.listen(0, "127.0.0.1");
  await listen(bridge);
  return { bridge, origin: `ws://127.0.0.1:${bridge.address().port}`, resolveCount: () => resolveCount, stream };
}

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
    const waiting = await next((event) => event.type === "waiting_for_transcription");
    assert.equal(waiting.type, "waiting_for_transcription");
    const runtimeReady = await next((event) => event.type === "runtime_ready");
    assert.equal(runtimeReady.inferenceMode, "batch");
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

test("Moonshine Streaming Tiny live failure after tentative output discards revisions and replays from zero", async () => {
  const upstream = await startUpstream([]);
  const transcribed = [];
  let feedCount = 0;
  let resetCount = 0;
  const nativeStream = {
    get text() {
      return feedCount ? { full: "draft words", committed: "", tentative: "draft words" } : { full: "", committed: "", tentative: "" };
    },
    async feed() {
      feedCount += 1;
      if (feedCount === 1) return { resultChanged: true, revision: 1, audioCommittedMs: 0, bufferedMs: 0 };
      throw Object.assign(new Error("native stream failed after tentative output"), { code: "native_stream_failed" });
    },
    async finalize() { return { resultChanged: false, isFinal: true, revision: feedCount, audioCommittedMs: 0, bufferedMs: 0 }; },
    reset() { resetCount += 1; },
  };
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    runtimeConfig: {
      mode: "local",
      inferenceMode: "streaming",
      execution: "live",
      segmentation: "none",
      adapter: "transcribe_cpp_stream_v1",
      provider: "local",
      model: "moonshine-streaming-tiny-q8",
      precision: "q8",
      backend: "transcribe_cpp",
      computeBackend: "cpu",
      capabilities: { language: "en", inferenceMode: "streaming", partials: true, externalVad: false, precision: "q8", streaming: { family: "moonshine" } },
      streaming: { family: "moonshine" },
      stream: async () => nativeStream,
      transcribe: async (pcm) => {
        transcribed.push(Buffer.from(pcm));
        return "fallback from tentative";
      },
    },
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    await next((event) => event.type === "runtime_ready");
    for (let index = 0; index < 8; index += 1) client.send(Buffer.alloc(640, index + 1), { binary: true });
    const partial = await next((event) => event.type === "partial" && event.tentativeText === "draft words");
    assert.equal(partial.stableText, "");
    for (let index = 8; index < 16; index += 1) client.send(Buffer.alloc(640, index + 1), { binary: true });
    const fallback = await next((event) => event.type === "stream_fallback", 5_000);
    assert.equal(fallback.replay, "from_zero");
    assert.deepEqual(fallback.discardedTentativeRevisions, [1]);
    assert.equal(fallback.stableCheckpoint, 0);
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 10_240 }));
    const completed = await next((event) => event.type === "completed", 5_000);
    assert.equal(completed.text, "fallback from tentative");
    assert.equal(completed.streamFallback.replay, "from_zero");
    assert.equal(completed.streamFallback.stableCheckpoint, 0);
    assert.equal(transcribed.length, 1);
    assert.equal(transcribed[0].length, 10_240);
    assert.equal(resetCount, 1);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("dictation shutdown closes sessions before draining accepted archives", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-stream-shutdown-"));
  const recordingsRoot = path.join(root, "recordings");
  const upstream = await startUpstream([]);
  const recordingStore = new VoiceRecordingStore({ root: recordingsRoot });
  const { bridge, origin, stream } = await startDictationBridge({ upstreamPort: upstream.address().port, recordingStore });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    client.send(Buffer.alloc(32_000, 6), { binary: true });
    const shutdown = await stream.shutdown({ timeoutMs: 500 });
    assert.equal(shutdown.closed, true);
    const archive = await recordingStore.drain({ timeoutMs: 1_000 });
    assert.equal(archive.drained, true);
    const files = await waitForRecordings(recordingsRoot);
    assert.equal(files.filter((file) => file.endsWith(".wav")).length, 1);
    assert.equal(files.filter((file) => file.endsWith(".json")).length, 1);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
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
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    recordingStore,
    runtimeConfig: {
      mode: "remote",
      provider: "custom",
      adapter: "openai_audio_sse_v1",
      model: "moonshine-streaming-tiny-q8",
      endpoint: `http://127.0.0.1:${upstream.address().port}/v1/audio/transcriptions`,
      headers: {},
      allowPrivate: true,
      modelId: "moonshine-streaming-tiny",
      artifactId: "moonshine-streaming-tiny-q8",
      resolvedProfileId: "moonshine-streaming-tiny-q8.live",
      execution: "live",
      segmentation: "none",
      requestedComputeBackend: "cpu",
      actualComputeBackend: "cpu",
      loadedRuntimeVersion: "0.1.3",
    },
  });
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
    client.send(JSON.stringify({
      type: "stop",
      audioBytesSent: 32_000,
      clientDiagnostics: {
        schemaVersion: 5,
        events: { firstWorkletPcmMs: 12, firstWebSocketSendMs: 14, stopRequestedMs: 30 },
        durations: { captureStartupMs: 12, stopToFinalMs: 8 },
        transport: { packetCount: 2, pcmBytes: 32_000, maxWebSocketBufferedBytes: 128 },
        capture: {
          profile: "raw",
          sourceSampleRate: 48_000,
          processingSampleRate: 16_000,
          requestedConstraints: { audio: { deviceId: { exact: "mic-secret" } } },
          effectiveTrackSettings: { deviceId: "mic-secret", groupId: "group-secret", sampleRate: 48_000 },
          resampler: { method: "windowed-sinc-fir", inputSampleRate: 48_000, outputSampleRate: 16_000 },
          preProcessing: { rms: 0.2, peak: 0.4, clipping: false, clippedSamples: 0, bands: { low: 0.1, mid: 0.05, high: 0.01 } },
          postProcessing: { rms: 0.2, peak: 0.4, clipping: false, clippedSamples: 0, bands: { low: 0.08, mid: 0.04, high: 0.01 } },
          workletGain: { current: 1, minimum: 1, maximum: 1 },
        },
      },
    }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "long pause test");
    assert.equal(completed.audioBytes, 32_000);
    assert.equal(completed.audioDurationMs, 1_000);
    assert.equal(completed.inferenceMode, "batch");
    assert.equal(completed.backend, "unreported");
    assert.equal(completed.diagnostics.server.schemaVersion, 5);
    assert.equal(completed.diagnostics.server.transport.packetCount, 2);
    assert.equal(completed.diagnostics.server.inference.segmentCount, 1);
    const finalClientDiagnostics = JSON.parse(JSON.stringify(completed.diagnostics.client));
    finalClientDiagnostics.events.finalEventMs = 123;
    finalClientDiagnostics.durations.stopToFinalMs = 8;
    client.send(JSON.stringify({ type: "client_diagnostics", clientDiagnostics: finalClientDiagnostics }));
    assert.equal((await next((event) => event.type === "client_diagnostics_ack")).accepted, true);

    const files = await waitForRecordings(recordingsRoot);
    assert.equal(files.filter((file) => file.endsWith(".wav")).length, 1);
    assert.equal(files.filter((file) => file.endsWith(".json")).length, 1);
    const metadataFile = files.find((file) => file.endsWith(".json"));
    const metadata = await waitForSidecar(recordingsRoot, (sidecar) => sidecar.diagnostics?.client?.events?.finalEventMs === 123);
    assert.equal(metadata.schemaVersion, 2);
    assert.equal(metadata.transcript, "long pause test");
    assert.equal(metadata.transcriptStatus, "non_empty");
    assert.equal(metadata.transcriptObserved, true);
    assert.equal(metadata.completionReason, "stopped");
    assert.equal(metadata.clientAudioBytes, 32_000);
    assert.equal(metadata.serverAudioBytes, 32_000);
    assert.equal(metadata.serverAudioDurationMs, 1_000);
    assert.equal(metadata.diagnostics.client.events.finalEventMs, 123);
    assert.equal(metadata.diagnostics.client.durations.stopToFinalMs, 8);
    assert.equal(metadata.provider, "custom");
    assert.equal(metadata.adapter, "openai_audio_sse_v1");
    assert.equal(metadata.modelId, "moonshine-streaming-tiny");
    assert.equal(metadata.artifactId, "moonshine-streaming-tiny-q8");
    assert.equal(metadata.resolvedProfileId, "moonshine-streaming-tiny-q8.live");
    assert.equal(metadata.execution, "live");
    assert.equal(metadata.segmentation, "none");
    assert.equal(metadata.requestedComputeBackend, "cpu");
    assert.equal(metadata.actualComputeBackend, "cpu");
    assert.equal(metadata.loadedRuntimeVersion, "0.1.3");
    assert.equal(metadata.diagnostics.client.capture.requestedConstraints.audio.deviceId.exact, "[redacted]");
    assert.equal(metadata.diagnostics.client.capture.effectiveTrackSettings.deviceId, "[redacted]");
    assert.equal(metadata.diagnostics.client.capture.effectiveTrackSettings.groupId, "[redacted]");
    assert.equal(metadata.diagnostics.client.capture.profile, "raw");
    assert.equal(metadata.diagnostics.client.capture.resampler.method, "windowed-sinc-fir");
    assert.equal(metadata.diagnostics.client.capture.postProcessing.bands, null);
    assert.equal(typeof metadata.diagnostics.server.durations.archiveMs, "number");
    assert.equal(metadata.diagnostics.server.archive.status, "completed");
    assert.equal(typeof metadata.diagnostics.server.archive.queueDelayMs, "number");
    assert.equal(typeof metadata.diagnostics.server.archive.writeDurationMs, "number");
    assert.equal(metadata.diagnostics.server.archive.path.audioFile, metadata.audioFile);
    assert.equal(metadata.diagnostics.server.archive.path.metadataFile, metadataFile);
    assert.equal(metadata.diagnostics.server.archive.failure, null);
    assert.equal(metadata.diagnostics.server.inference.watermarks.archiveOwnedThroughSample, 16_000);
    assert.equal(JSON.stringify(metadata).includes("mic-secret"), false);
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
  assert.equal(requests, 1);
  assert.deepEqual(events.filter((event) => event.type === "final").map((event) => event.text), [
    "repeat me",
  ]);
  assert.equal(events.find((event) => event.type === "adapter_closed").text, "repeat me");
});
