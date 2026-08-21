import assert from "node:assert/strict";
import test from "node:test";
import { createDeepgramAdapter, createHttpAdapter, createOpenaiRealtimeStreamAdapter, openOpenaiRealtimeStream, upsamplePcm16kTo24k } from "../src/server/dictation-stream.js";
import { VoiceRuntime } from "../src/server/voice-runtime.js";

const limits = { maxAudioBytes: 64 * 1024, maxEventBytes: 64 * 1024 };

test("OpenAI and Groq adapters send provider model fields and supported streaming flags", async () => {
  for (const provider of ["openai", "groq"]) {
    const events = [];
    let form;
    let requests = 0;
    const model = provider === "openai" ? "gpt-transcribe" : "whisper-large-v3-turbo";
    const adapter = createHttpAdapter({
      provider,
      model,
      endpoint: `https://api.${provider}.example/v1/audio/transcriptions`,
      headers: { Authorization: "Bearer server-secret" },
    }, (event) => events.push(event), limits, async (_url, options) => {
      requests += 1;
      form = options.body;
      assert.equal(options.headers.Authorization, "Bearer server-secret");
      return new Response(JSON.stringify({ text: `${provider} transcript` }), { headers: { "Content-Type": "application/json" } });
    });
    adapter.write(Buffer.alloc(3_200));
    adapter.write(Buffer.alloc(3_200));
    await adapter.stop();
    assert.equal(requests, 1);
    assert.equal(form.get("model"), model);
    assert.equal(form.get("response_format"), "json");
    assert.equal(form.get("stream"), provider === "openai" ? "true" : null);
    assert.ok(form.get("file") instanceof Blob);
    assert.ok(events.some((event) => event.type === "final" && event.text === `${provider} transcript`));
  }
});

test("Deepgram adapter sends Token-authenticated WAV with model and formatting options", async () => {
  const events = [];
  let requestUrl;
  let requestOptions;
  let requests = 0;
  const adapter = createDeepgramAdapter({
    provider: "deepgram",
    model: "nova-3",
    endpoint: "https://api.deepgram.com/v1/listen",
    headers: { Authorization: "Token server-secret" },
  }, (event) => events.push(event), limits, async (url, options) => {
    requests += 1;
    requestUrl = new URL(url);
    requestOptions = options;
    return new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: "deepgram transcript" }] }] } }), { headers: { "Content-Type": "application/json" } });
  });
  adapter.write(Buffer.alloc(3_200));
  adapter.write(Buffer.alloc(3_200));
  await adapter.stop();
  assert.equal(requests, 1);
  assert.equal(requestUrl.searchParams.get("model"), "nova-3");
  assert.equal(requestUrl.searchParams.get("smart_format"), "true");
  assert.equal(requestOptions.headers.Authorization, "Token server-secret");
  assert.equal(requestOptions.headers["Content-Type"], "audio/wav");
  assert.ok(requestOptions.body instanceof Blob);
  assert.ok(events.some((event) => event.type === "final" && event.text === "deepgram transcript"));
});

test("16 kHz PCM upsamples to 24 kHz for OpenAI live input", () => {
  const pcm = Buffer.alloc(640);
  pcm.writeInt16LE(1000, 0);
  pcm.writeInt16LE(-1000, 638);
  const upsampled = upsamplePcm16kTo24k(pcm);
  assert.equal(upsampled.length, 960);
});

test("OpenAI live stream adapter feeds PCM packets and publishes partials before Stop", async () => {
  const events = [];
  const appended = [];
  let committed = false;
  const adapter = createOpenaiRealtimeStreamAdapter(events.push.bind(events), limits, async () => ({
    onDelta(handler) { this.delta = handler; },
    onCompleted(handler) { this.completed = handler; },
    async append(pcm) {
      appended.push(pcm.length);
      this.delta?.("Hel");
      this.delta?.("lo");
    },
    async commit() {
      committed = true;
      this.completed?.("Hello");
      return "Hello";
    },
    close() {},
  }));
  await adapter.opened;
  adapter.write(Buffer.alloc(640));
  adapter.write(Buffer.alloc(640));
  await adapter.stop();
  assert.equal(committed, true);
  assert.deepEqual(appended, [960, 960]);
  assert.ok(events.some((event) => event.type === "partial" && event.tentativeText.includes("Hel")));
  const closed = events.find((event) => event.type === "adapter_closed");
  assert.equal(closed.text, "Hello");
  assert.equal(closed.stableText, "Hello");
});

test("VoiceRuntime selects the OpenAI live StreamPort for gpt-live-transcribe", async () => {
  let opened = false;
  const runtime = new VoiceRuntime({
    settings: {
      effective: async () => ({
        mode: "remote",
        provider: "openai",
        adapter: "openai_audio_sse_v1",
        model: "gpt-live-transcribe",
        endpoint: "https://api.openai.com/v1/audio/transcriptions",
        auth: { type: "bearer", secret: "server-only" },
        allowPrivate: false,
      }),
    },
    modelManager: {},
  });
  runtime.openOpenaiLive = async () => {
    opened = true;
    return { append: async () => {}, commit: async () => "", close() {} };
  };
  const resolved = await runtime.resolve();
  assert.equal(resolved.adapter, "openai_realtime_stream_v1");
  assert.equal(resolved.inferenceMode, "streaming");
  assert.equal(resolved.model, "gpt-live-transcribe");
  assert.equal(resolved.endpoint, "wss://api.openai.com/v1/realtime?intent=transcription");
  await resolved.stream();
  assert.equal(opened, true);
});

test("OpenAI live handshake uses the GA Realtime URL and never sends the beta header", async () => {
  const sockets = [];
  class FakeSocket {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.readyState = FakeSocket.CONNECTING;
      this.OPEN = FakeSocket.OPEN;
      this.handlers = {};
      sockets.push(this);
    }
    on(event, handler) { this.handlers[event] = handler; }
    once(event, handler) { this.handlers[event] = handler; }
    send(payload) { this.sent = JSON.parse(payload); }
    close() { this.readyState = FakeSocket.CLOSED; }
  }
  FakeSocket.CONNECTING = 0;
  FakeSocket.OPEN = 1;
  FakeSocket.CLOSED = 3;
  const opened = openOpenaiRealtimeStream({
    url: "wss://api.openai.com/v1/realtime?intent=transcription",
    headers: { Authorization: "Bearer server-only" },
    WebSocketImpl: FakeSocket,
  });
  const socket = sockets[0];
  assert.equal(socket.url, "wss://api.openai.com/v1/realtime?intent=transcription");
  assert.equal(socket.options.headers.Authorization, "Bearer server-only");
  assert.equal(socket.options.headers["OpenAI-Beta"], undefined);
  socket.readyState = FakeSocket.OPEN;
  socket.handlers.open();
  assert.equal(socket.sent.type, "session.update");
  assert.equal(socket.sent.session.type, "transcription");
  socket.handlers.message(JSON.stringify({ type: "session.updated" }));
  const session = await opened;
  session.close();
});
