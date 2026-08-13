import assert from "node:assert/strict";
import test from "node:test";
import { createDeepgramAdapter, createHttpAdapter } from "../src/server/dictation-stream.js";

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
      assert.deepEqual(options.headers, { Authorization: "Bearer server-secret" });
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
  assert.deepEqual(requestOptions.headers, { Authorization: "Token server-secret", "Content-Type": "audio/wav" });
  assert.ok(requestOptions.body instanceof Blob);
  assert.ok(events.some((event) => event.type === "final" && event.text === "deepgram transcript"));
});
