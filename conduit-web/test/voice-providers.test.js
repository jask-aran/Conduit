import assert from "node:assert/strict";
import test from "node:test";
import { createDeepgramAdapter, createHttpAdapter, openOpenaiRealtimeStream } from "../src/server/dictation-stream.js";

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
