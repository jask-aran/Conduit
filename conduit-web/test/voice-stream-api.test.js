import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { createDictationStream, createDeepgramAdapter, createHttpAdapter, createTranscribeCppStreamAdapter, splitSilence } from "../src/server/dictation-stream.js";
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
        && published.filter((file) => file.endsWith(".json")).length >= expectedPairs) return files;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return fs.readdir(root);
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

async function startDictationBridge({ upstreamPort, recordingStore = null, resolveDelayMs = 0, pins = null, observeVoiceActivity = null, beginVoiceActivity = null, runtimeConfig = null, limits = {} }) {
  const wss = new WebSocketServer({ noServer: true });
  let resolveCount = 0;
  const observe = typeof observeVoiceActivity === "function"
    ? observeVoiceActivity
    : async (pcm) => {
      const sampleCount = Math.floor(pcm.length / 2);
      return {
        type: "silero_vad_observation",
        available: true,
        status: "observed",
        policy: { sampleRate: 16_000, frameSamples: 512, preRollMs: 0, hangoverMs: 0, trailingPaddingMs: 0 },
        regions: [{
          startSample: 0,
          endSample: sampleCount,
          submittedStartSample: 0,
          submittedEndSample: sampleCount,
          speechStartSample: 0,
          speechEndSample: sampleCount,
        }],
        frames: [],
        summary: { regionCount: 1, speechFrameCount: 1, maxProbability: 1, meanProbability: 1 },
      };
    };
  const stream = createDictationStream({
    wss,
    voiceRuntime: {
      pin: () => { if (pins) pins.count += 1; },
      unpin: () => { if (pins) pins.count = Math.max(0, pins.count - 1); },
      observeVoiceActivity: observe,
      beginVoiceActivity: typeof beginVoiceActivity === "function" ? beginVoiceActivity : undefined,
      resolve: async () => {
        resolveCount += 1;
        if (resolveDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, resolveDelayMs));
        return runtimeConfig || {
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
    limits,
  });
  const bridge = createServer();
  bridge.on("upgrade", (request, socket, head) => stream.handleUpgrade(request, socket, head));
  bridge.listen(0, "127.0.0.1");
  await listen(bridge);
  return { bridge, origin: `ws://127.0.0.1:${bridge.address().port}`, resolveCount: () => resolveCount };
}

async function startProgressiveBridge({ transcribe, regionsAtFinish, limits = {}, resolveDelayMs = 0 }) {
  const wss = new WebSocketServer({ noServer: true });
  let sampleCount = 0;
  let firstRegionCommitted = false;
  const voiceRuntime = {
    pin() {},
    unpin() {},
    beginVoiceActivity() {
      return {
        push(pcm) {
          sampleCount += Math.floor(pcm.length / 2);
          if (!firstRegionCommitted && sampleCount >= 1_024) {
            firstRegionCommitted = true;
            return Promise.resolve([{
              regionIndex: 0,
              submittedStartSample: 0,
              submittedEndSample: 1_024,
              startSample: 0,
              endSample: 1_024,
              closureReason: "silence",
            }]);
          }
          return Promise.resolve([]);
        },
        finish() {
          return Promise.resolve({
            type: "silero_vad_observation",
            available: true,
            status: "observed",
            policy: { sampleRate: 16_000, frameSamples: 512, preRollMs: 0, hangoverMs: 0, trailingPaddingMs: 0 },
            regions: regionsAtFinish(sampleCount),
            frames: [],
            summary: { regionCount: 2, speechFrameCount: 2, maxProbability: 1, meanProbability: 1 },
          });
        },
        cancel() {},
      };
    },
    resolve: async () => {
      if (resolveDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, resolveDelayMs));
      return {
        mode: "local",
        inferenceMode: "batch",
        adapter: "managed_transformers_v1",
        provider: "local",
        model: "test-progressive-model",
        precision: "q8",
        backend: "test",
        transcribe,
      };
    },
  };
  const stream = createDictationStream({ wss, voiceRuntime, limits });
  const bridge = createServer();
  bridge.on("upgrade", (request, socket, head) => stream.handleUpgrade(request, socket, head));
  bridge.listen(0, "127.0.0.1");
  await listen(bridge);
  return { bridge, origin: `ws://127.0.0.1:${bridge.address().port}` };
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

test("Unified English batch adapter transcribes the complete PCM once and does not use progressive fallback", async () => {
  const upstream = await startUpstream([]);
  const calls = [];
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    runtimeConfig: {
      mode: "local",
      inferenceMode: "batch",
      adapter: "transcribe_cpp_batch_v1",
      provider: "local",
      model: "parakeet-unified-en-0.6b-q8",
      precision: "q8",
      backend: "transcribe_cpp",
      computeBackend: "cpu",
      capabilities: { language: "en", inferenceMode: "batch", partials: false, externalVad: false, precision: "q8", memory: { modelBytes: 731357568 } },
      native: { package: "transcribe-cpp", version: "0.1.3", headerHash: "86b16dd97ad1cb58" },
      transcribe: async (pcm, options) => { calls.push({ pcm: Buffer.from(pcm), options }); return "complete unified batch"; },
    },
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    await next((event) => event.type === "runtime_ready");
    client.send(Buffer.alloc(2_048, 1), { binary: true });
    client.send(Buffer.alloc(2_048, 2), { binary: true });
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 4_096 }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "complete unified batch");
    assert.equal(completed.adapter, "transcribe_cpp_batch_v1");
    assert.equal(completed.backend, "transcribe_cpp");
    assert.equal(completed.computeBackend, "cpu");
    assert.equal(completed.progressiveBatch, false);
    assert.equal(completed.capabilities.externalVad, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pcm.length, 4_096);
    assert.match(calls[0].options.operationId, /^[0-9a-f-]+:batch:1$/);
    assert.match(calls[0].options.sessionId, /^[0-9a-f-]+$/);
    assert.equal(calls[0].options.signal instanceof AbortSignal, true);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("Unified English stream adapter coalesces PCM, exposes revisions, and stays open across silence", async () => {
  const upstream = await startUpstream([]);
  const feedSizes = [];
  let snapshot = { full: "", committed: "", tentative: "" };
  let revision = 0;
  const nativeStream = {
    get text() { return snapshot; },
    async feed(pcm) {
      feedSizes.push(pcm.length);
      revision += 1;
      if (revision === 1) snapshot = { full: "First", committed: "First", tentative: "" };
      else if (revision === 2) snapshot = { full: "First phrase", committed: "First", tentative: " phrase" };
      else snapshot = { full: "First phrase follows", committed: "First phrase follows", tentative: "" };
      return { resultChanged: true, revision, audioCommittedMs: revision * 160, bufferedMs: 0 };
    },
    async finalize() {
      snapshot = { full: "First phrase follows", committed: "First phrase follows", tentative: "" };
      revision += 1;
      return { resultChanged: true, isFinal: true, revision, audioCommittedMs: 480, bufferedMs: 0 };
    },
    reset() {},
  };
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    resolveDelayMs: 25,
    runtimeConfig: {
      mode: "local",
      inferenceMode: "streaming",
      adapter: "transcribe_cpp_stream_v1",
      provider: "local",
      model: "parakeet-unified-en-0.6b-q8",
      precision: "q8",
      backend: "transcribe_cpp",
      computeBackend: "cpu",
      modelId: "parakeet-unified-en-0.6b",
      artifactId: "parakeet-unified-en-0.6b-q8-gguf",
      runtimeId: "transcribe-cpp",
      backendPathId: "parakeet-unified-en-0.6b-q8-gguf.transcribe-cpp",
      resolvedProfileId: "parakeet-unified-en-0.6b-q8-gguf.live",
      execution: "live",
      segmentation: "none",
      requestedComputeBackend: "auto",
      actualComputeBackend: "cpu",
      loadedRuntimeVersion: "0.1.3",
      capabilities: {
        language: "en",
        inferenceMode: "streaming",
        partials: true,
        externalVad: false,
        precision: "q8",
        memory: { modelBytes: 731357568 },
        streaming: { family: "parakeet_buffered", leftMs: 5_600, chunkMs: 160, rightMs: 320, latencyMs: 480, commitPolicy: "stable_prefix", stablePrefixAgreementN: 3 },
      },
      streaming: { family: "parakeet_buffered", leftMs: 5_600, chunkMs: 160, rightMs: 320, latencyMs: 480, commitPolicy: "stable_prefix", stablePrefixAgreementN: 3 },
      native: { package: "transcribe-cpp", version: "0.1.3", headerHash: "86b16dd97ad1cb58" },
      stream: async (options) => {
        assert.deepEqual(options, {
          family: { kind: "parakeet_buffered", leftMs: 5_600, chunkMs: 160, rightMs: 320 },
          commitPolicy: "stable_prefix",
          stablePrefixAgreementN: 3,
        });
        return nativeStream;
      },
    },
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    for (let index = 0; index < 24; index += 1) client.send(Buffer.alloc(640, index === 0 ? 1 : 0), { binary: true });
    const runtimeReady = await next((event) => event.type === "runtime_ready");
    assert.equal(runtimeReady.adapter, "transcribe_cpp_stream_v1");
    assert.equal(runtimeReady.inferenceMode, "streaming");
    const first = await next((event) => event.type === "partial");
    assert.equal(first.text, "First");
    assert.equal(first.stableText, "First");
    assert.equal(first.tentativeText, "");
    const second = await next((event) => event.type === "partial");
    assert.equal(second.text, "First phrase");
    assert.equal(second.stableText, "First");
    assert.equal(second.tentativeText, "phrase");
    const third = await next((event) => event.type === "partial");
    assert.equal(third.text, "First phrase follows");
    assert.equal(third.stableText, "First phrase follows");
    assert.equal(third.tentativeText, "");
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 15_360 }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "First phrase follows");
    assert.equal(completed.adapter, "transcribe_cpp_stream_v1");
    assert.equal(completed.inferenceMode, "streaming");
    assert.equal(completed.modelId, "parakeet-unified-en-0.6b");
    assert.equal(completed.artifactId, "parakeet-unified-en-0.6b-q8-gguf");
    assert.equal(completed.runtimeId, "transcribe-cpp");
    assert.equal(completed.backendPathId, "parakeet-unified-en-0.6b-q8-gguf.transcribe-cpp");
    assert.equal(completed.resolvedProfileId, "parakeet-unified-en-0.6b-q8-gguf.live");
    assert.equal(completed.execution, "live");
    assert.equal(completed.segmentation, "none");
    assert.equal(completed.requestedComputeBackend, "auto");
    assert.equal(completed.actualComputeBackend, "cpu");
    assert.equal(completed.loadedRuntimeVersion, "0.1.3");
    assert.equal(completed.progressiveBatch, false);
    assert.equal(completed.capabilities.partials, true);
    assert.equal(completed.diagnostics.server.inference.streaming.feedCount, 3);
    assert.equal(completed.diagnostics.server.inference.streaming.profile.latencyMs, 480);
    assert.equal(completed.diagnostics.server.inference.streaming.profile.feedQuantumMs, 160);
    assert.equal(completed.diagnostics.server.inference.streaming.acceptedThroughSample, 7_680);
    assert.equal(completed.diagnostics.server.inference.streaming.submittedThroughSample, 7_680);
    assert.equal(completed.diagnostics.server.inference.streaming.committedThroughSample, 7_680);
    assert.equal(completed.diagnostics.server.inference.streaming.processedThroughSample, null);
    assert.equal(completed.diagnostics.server.inference.streaming.serverQueuedAudioMs, 0);
    assert.equal(completed.diagnostics.server.inference.streaming.totalInferenceLagMs, 0);
    assert.deepEqual(feedSizes, [2_560, 2_560, 2_560]);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("transcribe.cpp feed worker does not make write await native inference and flushes its tail", async () => {
  const feedSizes = [];
  let feedStarted = false;
  let inFlight = 0;
  let maximumInFlight = 0;
  const nativeStream = {
    get text() { return { full: "", committed: "", tentative: "" }; },
    async feed(pcm) {
      feedStarted = true;
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      feedSizes.push(pcm.length);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      return { resultChanged: false, revision: feedSizes.length, audioCommittedMs: 0, bufferedMs: 0 };
    },
    async finalize() { return { resultChanged: false, isFinal: true, revision: feedSizes.length, audioCommittedMs: 0, bufferedMs: 0 }; },
    reset() {},
  };
  const events = [];
  const adapter = createTranscribeCppStreamAdapter(
    (event) => events.push(event),
    {},
    async () => nativeStream,
    null,
    { family: "parakeet_buffered", chunkMs: 160 },
  );
  await adapter.opened;
  for (let index = 0; index < 16; index += 1) adapter.write(Buffer.alloc(640, index));
  assert.equal(feedStarted, false);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(feedStarted, true);
  await adapter.stop();
  assert.deepEqual(feedSizes, [2_560, 2_560]);
  assert.equal(maximumInFlight, 1);
  assert.equal(events.at(-1).type, "adapter_closed");
});

test("transcribe.cpp Stop drains a queued backlog in native quanta", async () => {
  const feedSizes = [];
  let releaseFirstFeed;
  const firstFeed = new Promise((resolve) => { releaseFirstFeed = resolve; });
  const nativeStream = {
    get text() { return { full: "", committed: "", tentative: "" }; },
    async feed(pcm) {
      feedSizes.push(pcm.length);
      if (feedSizes.length === 1) await firstFeed;
      return { resultChanged: false, revision: feedSizes.length, audioCommittedMs: 0, bufferedMs: 0 };
    },
    async finalize() { return { resultChanged: false, isFinal: true, revision: feedSizes.length, audioCommittedMs: 0, bufferedMs: 0 }; },
    reset() {},
  };
  const adapter = createTranscribeCppStreamAdapter(
    () => {},
    {},
    async () => nativeStream,
    null,
    { family: "parakeet_buffered", chunkMs: 160 },
  );
  await adapter.opened;
  for (let index = 0; index < 32; index += 1) adapter.write(Buffer.alloc(640, index));
  const stopped = adapter.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(feedSizes, [2_560]);
  releaseFirstFeed();
  await stopped;
  assert.deepEqual(feedSizes, [2_560, 2_560, 2_560, 2_560]);
});

test("OpenAI live StreamPort feeds session PCM and finalizes like Unified English", async () => {
  const appended = [];
  const upstream = await startUpstream([]);
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    runtimeConfig: {
      mode: "remote",
      inferenceMode: "streaming",
      adapter: "openai_realtime_stream_v1",
      provider: "openai",
      model: "gpt-live-transcribe",
      backend: "openai_realtime",
      capabilities: { language: "en", inferenceMode: "streaming", partials: true },
      stream: async () => ({
        onDelta(handler) { this.delta = handler; },
        onCompleted(handler) { this.completed = handler; },
        async append(pcm) {
          appended.push(pcm.length);
          if (appended.length === 1) this.delta?.("Live");
        },
        async commit() {
          this.completed?.("Live phrase");
          return "Live phrase";
        },
        close() {},
      }),
    },
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    client.send(Buffer.alloc(640, 1), { binary: true });
    const runtimeReady = await next((event) => event.type === "runtime_ready");
    assert.equal(runtimeReady.adapter, "openai_realtime_stream_v1");
    assert.equal(runtimeReady.inferenceMode, "streaming");
    const partial = await next((event) => event.type === "partial");
    assert.equal(partial.tentativeText, "Live");
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 640 }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "Live phrase");
    assert.equal(completed.adapter, "openai_realtime_stream_v1");
    assert.deepEqual(appended, [960]);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("Unified English stream startup failure falls back before consuming session PCM", async () => {
  const upstream = await startUpstream([]);
  let streamAttempts = 0;
  let progressiveStarts = 0;
  let progressivePcmBytes = 0;
  const transcribed = [];
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    beginVoiceActivity: () => {
      progressiveStarts += 1;
      return {
        push(pcm) {
          progressivePcmBytes += pcm.length;
          return Promise.resolve([]);
        },
        finish() {
          return Promise.resolve({
            type: "silero_vad_observation",
            available: true,
            status: "observed",
            regions: [{ regionIndex: 0, startSample: 0, endSample: progressivePcmBytes / 2, submittedStartSample: 0, submittedEndSample: progressivePcmBytes / 2 }],
            frames: [],
            summary: { regionCount: 1, speechFrameCount: 1, maxProbability: 1, meanProbability: 1 },
          });
        },
        cancel() {},
      };
    },
    runtimeConfig: {
      mode: "local",
      inferenceMode: "streaming",
      adapter: "transcribe_cpp_stream_v1",
      provider: "local",
      model: "parakeet-unified-en-0.6b-q8",
      precision: "q8",
      backend: "transcribe_cpp",
      computeBackend: "cpu",
      capabilities: { language: "en", inferenceMode: "streaming", partials: true, externalVad: false, precision: "q8", streaming: { family: "parakeet_buffered", leftMs: 5_600, chunkMs: 160, rightMs: 320, latencyMs: 480 } },
      streaming: { family: "parakeet_buffered", leftMs: 5_600, chunkMs: 160, rightMs: 320, latencyMs: 480 },
      stream: async () => {
        streamAttempts += 1;
        throw Object.assign(new Error("stream unavailable"), { code: "test_stream_unavailable" });
      },
      transcribe: async (pcm) => {
        transcribed.push(pcm);
        return "batch fallback";
      },
    },
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    const runtimeReady = await next((event) => event.type === "runtime_ready");
    assert.equal(runtimeReady.adapter, "transcribe_cpp_batch_fallback_v1");
    assert.equal(runtimeReady.progressiveBatch, true);
    client.send(Buffer.alloc(4_096, 3), { binary: true });
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 4_096 }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "batch fallback");
    assert.equal(completed.progressiveBatch, true);
    assert.deepEqual(completed.streamFallback, { from: "transcribe_cpp_stream_v1", reason: "test_stream_unavailable" });
    assert.equal(streamAttempts, 1);
    assert.equal(progressiveStarts, 1);
    assert.equal(progressivePcmBytes, 4_096);
    assert.equal(transcribed.length, 1);
    assert.equal(transcribed[0].length, 4_096);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("Unified English live queue overflow falls back from sample zero without a second native path", async () => {
  const upstream = await startUpstream([]);
  const transcribed = [];
  let feedStarted = 0;
  let resetCount = 0;
  let finalizeCount = 0;
  const nativeStream = {
    get text() { return { full: "", committed: "", tentative: "" }; },
    async feed() {
      feedStarted += 1;
      await new Promise((resolve) => setTimeout(resolve, 250));
      return { resultChanged: false, revision: feedStarted, audioCommittedMs: 0, bufferedMs: 0 };
    },
    async finalize() {
      finalizeCount += 1;
      return { resultChanged: false, isFinal: true, revision: feedStarted, audioCommittedMs: 0, bufferedMs: 0 };
    },
    reset() { resetCount += 1; },
  };
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    limits: { liveQueueLimitMs: 300 },
    runtimeConfig: {
      mode: "local",
      inferenceMode: "streaming",
      adapter: "transcribe_cpp_stream_v1",
      provider: "local",
      model: "parakeet-unified-en-0.6b-q8",
      precision: "q8",
      backend: "transcribe_cpp",
      computeBackend: "cpu",
      capabilities: { language: "en", inferenceMode: "streaming", partials: true, externalVad: false, precision: "q8", streaming: { family: "parakeet_buffered", chunkMs: 160, latencyMs: 480 } },
      streaming: { family: "parakeet_buffered", chunkMs: 160, latencyMs: 480 },
      stream: async () => nativeStream,
      transcribe: async (pcm) => {
        transcribed.push(Buffer.from(pcm));
        return "batch after overflow";
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
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (let index = 8; index < 24; index += 1) client.send(Buffer.alloc(640, index + 1), { binary: true });
    const fallback = await next((event) => event.type === "stream_fallback", 5_000);
    assert.equal(fallback.reason, "live_queue_overflow");
    assert.equal(fallback.replay, "from_zero");
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 15_360 }));
    const completed = await next((event) => event.type === "completed", 5_000);
    assert.equal(completed.text, "batch after overflow");
    assert.equal(completed.adapter, "transcribe_cpp_batch_fallback_v1");
    assert.deepEqual(completed.streamFallback, {
      from: "transcribe_cpp_stream_v1",
      reason: "live_queue_overflow",
      replay: "from_zero",
      replaySample: 0,
    });
    assert.equal(completed.audioBytes, 15_360);
    assert.equal(transcribed.length, 1);
    assert.equal(transcribed[0].length, 15_360);
    assert.equal(completed.diagnostics.server.inference.streaming.overflow.code, "live_queue_overflow");
    assert.ok(feedStarted >= 1);
    assert.ok(resetCount >= 1);
    assert.equal(finalizeCount, 0);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 300));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("progressive local batch publishes an ordered segment before Stop and appends the tail once", async () => {
  const { bridge, origin } = await startProgressiveBridge({
    transcribe: async (pcm) => pcm[0] === 1 ? "first phrase" : "second phrase",
    regionsAtFinish: (sampleCount) => [
      { regionIndex: 0, submittedStartSample: 0, submittedEndSample: 1_024 },
      { regionIndex: 1, submittedStartSample: 1_024, submittedEndSample: sampleCount },
    ],
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    await next((event) => event.type === "runtime_ready");
    client.send(Buffer.alloc(2_048, 1), { binary: true });
    const first = await next((event) => event.type === "final", 5_000);
    assert.equal(first.text, "first phrase");
    assert.deepEqual(first.segment, { sequence: 0, startSample: 0, endSample: 1_024 });
    client.send(Buffer.alloc(2_048, 2), { binary: true });
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 4_096 }));
    const completed = await next((event) => event.type === "completed", 5_000);
    assert.equal(completed.text, "first phrase second phrase");
    assert.equal(completed.diagnostics.server.inference.progressiveBatch.committedSegments, 2);
    assert.equal(completed.diagnostics.server.inference.progressiveBatch.failedSequences.length, 0);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
  }
});

test("progressive local batch keeps PCM sent during model startup", async () => {
  const { bridge, origin } = await startProgressiveBridge({
    resolveDelayMs: 75,
    transcribe: async (pcm) => pcm[0] === 1 ? "cold first phrase" : "second phrase",
    regionsAtFinish: (sampleCount) => [
      { regionIndex: 0, submittedStartSample: 0, submittedEndSample: 1_024 },
      { regionIndex: 1, submittedStartSample: 1_024, submittedEndSample: sampleCount },
    ],
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    client.send(Buffer.alloc(2_048, 1), { binary: true });
    const first = await next((event) => event.type === "final", 5_000);
    assert.equal(first.text, "cold first phrase");
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 2_048 }));
    const completed = await next((event) => event.type === "completed", 5_000);
    assert.equal(completed.text, "cold first phrase");
    assert.equal(completed.audioBytes, 2_048);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
  }
});

test("progressive batch retains successful segments when a later range fails", async () => {
  const { bridge, origin } = await startProgressiveBridge({
    transcribe: async (pcm) => {
      if (pcm[0] === 2) throw Object.assign(new Error("second range failed"), { code: "test_range_failed" });
      return "first phrase";
    },
    regionsAtFinish: (sampleCount) => [
      { regionIndex: 0, submittedStartSample: 0, submittedEndSample: 1_024 },
      { regionIndex: 1, submittedStartSample: 1_024, submittedEndSample: sampleCount },
    ],
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    await next((event) => event.type === "runtime_ready");
    client.send(Buffer.alloc(2_048, 1), { binary: true });
    await next((event) => event.type === "final", 5_000);
    client.send(Buffer.alloc(2_048, 2), { binary: true });
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 4_096 }));
    const failure = await next((event) => event.type === "segment_error", 5_000);
    assert.equal(failure.sequence, 1);
    const completed = await next((event) => event.type === "completed", 5_000);
    assert.equal(completed.text, "first phrase");
    assert.deepEqual(completed.diagnostics.server.inference.progressiveBatch.failedSequences, [1]);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
  }
});

test("slow archive settlement does not delay completed transcript delivery", async () => {
  const upstream = await startUpstream([
    { event: "transcript.text.done", data: { type: "transcript.text.done", text: "archive is asynchronous" } },
  ]);
  let archiveFinished = false;
  const recordingStore = {
    async save(options) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      archiveFinished = true;
      return { id: "slow-archive", ...options };
    },
    async updateMetadata() {},
  };
  const { bridge, origin } = await startDictationBridge({ upstreamPort: upstream.address().port, recordingStore });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    client.send(Buffer.alloc(32_000, 7), { binary: true });
    const startedAt = Date.now();
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 32_000 }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "archive is asynchronous");
    assert.ok(Date.now() - startedAt < 150);
    assert.equal(archiveFinished, false);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(archiveFinished, true);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("dictation surfaces resolve failures after early ready and archives received PCM", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-stream-failure-"));
  const recordingsRoot = path.join(root, "recordings");
  const recordingStore = new VoiceRecordingStore({ root: recordingsRoot });
  const wss = new WebSocketServer({ noServer: true });
  const stream = createDictationStream({
    wss,
    recordingStore,
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
    await new Promise((resolve) => setTimeout(resolve, 25));
    const files = await waitForRecordings(recordingsRoot);
    assert.equal(files.filter((file) => file.endsWith(".wav")).length, 1);
    assert.equal(files.filter((file) => file.endsWith(".json")).length, 1);
    const metadataFile = files.find((file) => file.endsWith(".json"));
    const metadata = JSON.parse(await fs.readFile(path.join(recordingsRoot, metadataFile), "utf8"));
    assert.equal(metadata.transcriptionStatus, "failed");
    assert.equal(metadata.transcriptionError, "Install the model first");
    assert.equal(metadata.serverAudioBytes, 320);
    assert.equal((await fs.stat(path.join(recordingsRoot, metadata.audioFile))).size, 44 + 320);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
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
      model: "whisper-tiny-en-q8",
      endpoint: `http://127.0.0.1:${upstream.address().port}/v1/audio/transcriptions`,
      headers: {},
      allowPrivate: true,
      modelId: "whisper-tiny-en",
      artifactId: "whisper-tiny-en-q8",
      runtimeId: "transformers-js",
      backendPathId: "whisper-tiny-en-q8.transformers-js",
      resolvedProfileId: "whisper-tiny-en-q8.eager",
      execution: "eager",
      segmentation: "silero",
      requestedComputeBackend: "wasm-cpu",
      actualComputeBackend: "wasm-cpu",
      loadedRuntimeVersion: "transformers.js-3.8.1",
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
    const metadata = JSON.parse(await fs.readFile(path.join(recordingsRoot, metadataFile), "utf8"));
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
    assert.equal(metadata.modelId, "whisper-tiny-en");
    assert.equal(metadata.artifactId, "whisper-tiny-en-q8");
    assert.equal(metadata.runtimeId, "transformers-js");
    assert.equal(metadata.backendPathId, "whisper-tiny-en-q8.transformers-js");
    assert.equal(metadata.resolvedProfileId, "whisper-tiny-en-q8.eager");
    assert.equal(metadata.execution, "eager");
    assert.equal(metadata.segmentation, "silero");
    assert.equal(metadata.requestedComputeBackend, "wasm-cpu");
    assert.equal(metadata.actualComputeBackend, "wasm-cpu");
    assert.equal(metadata.loadedRuntimeVersion, "transformers.js-3.8.1");
    assert.equal(metadata.diagnostics.client.capture.requestedConstraints.audio.deviceId.exact, "[redacted]");
    assert.equal(metadata.diagnostics.client.capture.effectiveTrackSettings.deviceId, "[redacted]");
    assert.equal(metadata.diagnostics.client.capture.effectiveTrackSettings.groupId, "[redacted]");
    assert.equal(metadata.diagnostics.client.capture.profile, "raw");
    assert.equal(metadata.diagnostics.client.capture.resampler.method, "windowed-sinc-fir");
    assert.equal(metadata.diagnostics.client.capture.postProcessing.bands, null);
    assert.equal(typeof metadata.diagnostics.server.durations.archiveMs, "number");
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

test("dictation stores server PCM when transcription returns no text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-stream-empty-"));
  const recordingsRoot = path.join(root, "recordings");
  const upstream = await startUpstream([]);
  const recordingStore = new VoiceRecordingStore({ root: recordingsRoot });
  const { bridge, origin } = await startDictationBridge({ upstreamPort: upstream.address().port, recordingStore });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    client.send(Buffer.alloc(32_000, 11), { binary: true });
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 32_000 }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "");
    assert.equal(completed.audioBytes, 32_000);
    const files = await waitForRecordings(recordingsRoot);
    assert.equal(files.filter((file) => file.endsWith(".wav")).length, 1);
    assert.equal(files.filter((file) => file.endsWith(".json")).length, 1);
    const metadataFile = files.find((file) => file.endsWith(".json"));
    const metadata = JSON.parse(await fs.readFile(path.join(recordingsRoot, metadataFile), "utf8"));
    assert.equal(metadata.transcript, "");
    assert.equal(metadata.transcriptStatus, "empty");
    assert.equal(metadata.transcriptObserved, false);
    assert.equal((await fs.stat(path.join(recordingsRoot, metadata.audioFile))).size, 44 + 32_000);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("authoritative Silero keeps silence-only PCM out of ASR", async () => {
  let upstreamRequests = 0;
  const upstream = createServer((request, response) => {
    upstreamRequests += 1;
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end();
    });
  });
  upstream.listen(0, "127.0.0.1");
  await listen(upstream);
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    observeVoiceActivity: async (pcm) => ({
      type: "silero_vad_observation",
      available: true,
      status: "observed",
      sampleCount: pcm.length / 2,
      regions: [],
      frames: [],
      summary: { regionCount: 0, speechFrameCount: 0, maxProbability: 0.01, meanProbability: 0.001 },
    }),
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    client.send(Buffer.alloc(32_000), { binary: true });
    client.send(JSON.stringify({ type: "stop", audioBytesSent: 32_000 }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "");
    assert.equal(completed.speech.detector, "silero_vad");
    assert.equal(completed.speech.detected, false);
    assert.equal(completed.diagnostics.server.inference.segmentCount, 0);
    assert.equal(upstreamRequests, 0);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

function pcmWith(parts) {
  return Buffer.concat(parts.map(({ samples, level }) => {
    const buffer = Buffer.alloc(samples * 2);
    for (let index = 0; index < samples; index += 1) buffer.writeInt16LE(Math.round(level * 32767), index * 2);
    return buffer;
  }));
}

test("authoritative Silero observation submits its padded ranges", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-vad-shadow-"));
  const recordingsRoot = path.join(root, "recordings");
  const observation = {
    type: "silero_vad_observation",
    available: true,
    status: "observed",
    model: { name: "silero_vad.onnx", revision: "test", sha256: "a".repeat(64), license: "MIT" },
    deployment: { executionProvider: "cpu", unprivileged: true },
    policy: { sampleRate: 16_000, frameSamples: 512, threshold: 0.5, preRollMs: 240, hangoverMs: 320, trailingPaddingMs: 240 },
    sampleCount: 72_000,
    frameCount: 141,
    frames: [],
    regions: [
      { startSample: 0, endSample: 19_840, speechStartSample: 3_840, speechEndSample: 16_000 },
      { startSample: 52_160, endSample: 72_000, speechStartSample: 56_000, speechEndSample: 68_160 },
    ],
    summary: { regionCount: 2, speechFrameCount: 50, maxProbability: 0.99, meanProbability: 0.32 },
  };
  const audio = pcmWith([
    { samples: 16_000, level: 0.1 },
    { samples: 40_000, level: 0 },
    { samples: 16_000, level: 0.1 },
  ]);
  let upstreamRequests = 0;
  const upstream = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      upstreamRequests += 1;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(`event: transcript.text.done\ndata: ${JSON.stringify({ type: "transcript.text.done", text: "before after" })}\n\n`);
    });
  });
  upstream.listen(0, "127.0.0.1");
  await listen(upstream);
  const recordingStore = new VoiceRecordingStore({ root: recordingsRoot });
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    recordingStore,
    observeVoiceActivity: async (pcm) => {
      assert.equal(pcm.length, audio.length);
      return observation;
    },
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    for (let offset = 0; offset < audio.length; offset += 5_120) client.send(audio.subarray(offset, offset + 5_120), { binary: true });
    client.send(JSON.stringify({ type: "stop", audioBytesSent: audio.length }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "before after");
    assert.equal(upstreamRequests, 1);
    assert.deepEqual(completed.diagnostics.server.inference.boundaries, [
      { index: 0, startSample: 0, endSample: 19_840, startMs: 0, endMs: 1_240, durationMs: 1_240, vadRegionIndices: [0] },
      { index: 1, startSample: 52_160, endSample: 72_000, startMs: 3_260, endMs: 4_500, durationMs: 1_240, vadRegionIndices: [1] },
    ]);
    assert.deepEqual(completed.diagnostics.server.inference.sileroObservation.regions, observation.regions);
    const files = await waitForRecordings(recordingsRoot);
    const metadataFile = files.find((file) => file.endsWith(".json"));
    const metadata = JSON.parse(await fs.readFile(path.join(recordingsRoot, metadataFile), "utf8"));
    assert.deepEqual(metadata.diagnostics.server.inference.sileroObservation.regions, observation.regions);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("authoritative Silero submits a valid speech range shorter than 500 ms", async () => {
  const bodies = [];
  const upstream = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      bodies.push(Buffer.concat(chunks));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end("event: transcript.text.done\ndata: {\"type\":\"transcript.text.done\",\"text\":\"short word\"}\n\n");
    });
  });
  upstream.listen(0, "127.0.0.1");
  await listen(upstream);
  const audio = pcmWith([{ samples: 8_000, level: 0 }, { samples: 8_000, level: 0.1 }]);
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    observeVoiceActivity: async () => ({
      type: "silero_vad_observation",
      available: true,
      status: "observed",
      regions: [{
        submittedStartSample: 15_000,
        submittedEndSample: 16_200,
        speechStartSample: 15_200,
        speechEndSample: 16_000,
      }],
      frames: [],
      summary: { regionCount: 1, speechFrameCount: 2, maxProbability: 0.99, meanProbability: 0.8 },
    }),
  });
  const client = new WebSocket(`${origin}/dictation`);
  const next = messageQueue(client);
  try {
    await new Promise((resolve, reject) => { client.once("open", resolve); client.once("error", reject); });
    await next((event) => event.type === "ready");
    for (let offset = 0; offset < audio.length; offset += 5_120) client.send(audio.subarray(offset, offset + 5_120), { binary: true });
    client.send(JSON.stringify({ type: "stop", audioBytesSent: audio.length }));
    const completed = await next((event) => event.type === "completed");
    assert.equal(completed.text, "short word");
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].readUInt32LE(bodies[0].indexOf("RIFF") + 40), 2_000);
    assert.equal(completed.diagnostics.server.inference.boundaries[0].durationMs, 63);
  } finally {
    client.terminate();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await new Promise((resolve) => bridge.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  }
});

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

test("HTTP adapters upload one WAV at Stop", async () => {
  const requestBodies = [];
  const upstream = createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requestBodies.push(Buffer.concat(chunks));
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: transcript.text.delta\ndata: ${JSON.stringify({ type: "transcript.text.delta", delta: "before the pause." })}\n\n`);
      response.write(`event: transcript.text.done\ndata: ${JSON.stringify({ type: "transcript.text.done", text: "before the pause. after the pause." })}\n\n`);
      response.end();
    });
  });
  upstream.listen(0, "127.0.0.1");
  await listen(upstream);
  const events = [];
  const adapter = createHttpAdapter(
    { endpoint: `http://127.0.0.1:${upstream.address().port}/v1/audio/transcriptions`, provider: "openai", headers: {} },
    (event) => events.push(event),
    { maxAudioBytes: 1_000_000, maxEventBytes: 64 * 1024 },
    fetch,
  );
  try {
    adapter.write(pcmWith([{ samples: 16_000, level: 0.1 }, { samples: 40_000, level: 0 }, { samples: 16_000, level: 0.1 }]));
    await adapter.stop();
    assert.equal(requestBodies.length, 1);
    const wavSize = requestBodies[0].readUInt32LE(requestBodies[0].indexOf("RIFF") + 40);
    assert.equal(wavSize, 72_000 * 2);
    assert.deepEqual(events.filter((event) => event.type === "partial").map((event) => event.text), [
      "before the pause.",
    ]);
    assert.deepEqual(events.filter((event) => event.type === "final").map((event) => event.text), [
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
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(`event: transcript.text.done\ndata: ${JSON.stringify({ type: "transcript.text.done", text: "first sentence. second sentence." })}\n\n`);
      response.end();
    });
  });
  upstream.listen(0, "127.0.0.1");
  await listen(upstream);
  const { bridge, origin } = await startDictationBridge({
    upstreamPort: upstream.address().port,
    observeVoiceActivity: async () => ({
      type: "silero_vad_observation",
      available: true,
      status: "observed",
      regions: [
        { submittedStartSample: 0, submittedEndSample: 16_000, speechStartSample: 0, speechEndSample: 16_000 },
        { submittedStartSample: 56_000, submittedEndSample: 72_000, speechStartSample: 56_000, speechEndSample: 72_000 },
      ],
      frames: [],
      summary: { regionCount: 2, speechFrameCount: 2, maxProbability: 1, meanProbability: 1 },
    }),
  });
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
        assert.equal(requestCount.value, 1);
        break;
      }
      finals.push(event.text);
    }
    assert.deepEqual(finals, ["first sentence. second sentence."]);
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
  assert.equal(requests, 1);
  assert.deepEqual(events.filter((event) => event.type === "final").map((event) => event.text), [
    "repeat me",
  ]);
  assert.equal(events.find((event) => event.type === "adapter_closed").text, "repeat me");
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
  assert.deepEqual(bodies, [144_000]);
  assert.deepEqual(events.filter((event) => event.type === "final").map((event) => event.text), ["first utterance"]);
});
