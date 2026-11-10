import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import express from "express";
import { VOICE_EXECUTION_CATALOG } from "../src/server/voice-execution-catalog.js";
import { registerVoiceRoutes } from "../src/server/routes/voice.js";
import { registerAgentRoutes } from "../src/server/routes/agent.js";
import { startConduitHarness } from "./helpers/conduit-harness.js";

function wav(samples = 16_000, level = 4000) {
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF"); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24); bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let at = 44; at < bytes.length; at += 2) bytes.writeInt16LE(level, at);
  return bytes;
}

async function transcriptionFixture(t, resolve = async () => ({ transcribe: async () => "Hello hub" })) {
  const app = express();
  const delivered = [];
  const messages = [];
  let leases = 0;
  const voiceRuntime = { resolve, acquireLease: () => { leases++; return () => { leases--; }; } };
  const agent = { enabled: () => true, active: () => true,
    home: async () => ({ conversationId: 1, chat: { id: "home" } }),
    runtime: { messageLog: { messages, append: (message) => { messages.push(message); return message; } } },
    chatHost: { say: async (...args) => { delivered.push(args); } } };
  registerVoiceRoutes(app, { voiceRuntime });
  registerAgentRoutes(app, { voiceRuntime, agent });
  app.use((error, _request, response, _next) => response.status(error.status || 500).json({ error: error.type || error.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { delivered, messages, leases: () => leases,
    post: (route, body = wav(), headers = {}) => fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: "POST", headers: { "Content-Type": "audio/wav", ...headers }, body,
    }) };
}

test("voice transcribe enforces WAV format, duration, upload size and silence errors", async (t) => {
  const server = await transcriptionFixture(t);
  for (const [body, headers] of [[wav(), { "Content-Type": "audio/mpeg" }], [Buffer.from("bad WAV"), {}],
    [(() => { const audio = wav(); audio.writeUInt32LE(44_100, 24); return audio; })(), {}]]) {
    const response = await server.post("/v0/voice/transcribe", body, headers);
    assert.equal(response.status, 415);
    assert.equal((await response.json()).error, "invalid_audio");
  }
  const silent = await server.post("/v0/voice/transcribe", wav(16_000, 0));
  assert.equal(silent.status, 422);
  assert.equal((await silent.json()).error, "nothing_heard");
  const long = await server.post("/v0/voice/transcribe", wav(16_000 * 300 + 1));
  assert.equal(long.status, 413);
  assert.equal((await long.json()).error, "audio_too_long");
  assert.equal((await server.post("/v0/voice/transcribe", Buffer.alloc(10 * 1024 * 1024 + 1))).status, 413);
});

test("voice-message keeps delivery and deduplication while sharing transcription admission", async (t) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const server = await transcriptionFixture(t, async () => ({ transcribe: async () => { calls++; await pending; return "Hello hub"; } }));
  const headers = { "X-Conduit-Voice-Id": "12345678-1234-4123-8123-123456789012" };
  const first = server.post("/v0/agent/voice-message", wav(), headers);
  const second = server.post("/v0/voice/transcribe");
  // A provider callback proves both requests reached the shared admission path.
  while (calls < 2) await new Promise((resolve) => setImmediate(resolve));
  const busy = await server.post("/v0/voice/transcribe");
  assert.equal(busy.status, 429);
  assert.equal((await busy.json()).error, "voice_busy");
  const duplicate = server.post("/v0/agent/voice-message", wav(), headers);
  release();
  for (const response of await Promise.all([first, second, duplicate])) {
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { text: "Hello hub" });
  }
  assert.equal(calls, 2);
  assert.deepEqual(server.delivered, [["home", "Hello hub"]]);
  assert.equal(server.messages[0].via, "voice");
  assert.equal(server.messages[0].id, `in:voice:${headers["X-Conduit-Voice-Id"]}`);
  assert.equal((await server.post("/v0/agent/voice-message", wav(), headers)).status, 200);
  assert.equal(calls, 2);
  assert.equal(server.leases(), 0);
});

test("voice settings API stores endpoint authentication without returning the secret", async () => {
  const server = await startConduitHarness();
  try {
    const initial = await (await server.request("/v0/voice/settings")).json();
    assert.equal(initial.mode, "off");
    assert.equal(initial.local.catalogue.profiles.length, VOICE_EXECUTION_CATALOG.profiles.length);
    assert.equal(initial.local.models.every((model) => !model.installed), true);
    assert.deepEqual(initial.providers.slice(0, 3).map((provider) => provider.id), ["openai", "deepgram", "groq"]);

    const response = await server.request("/v0/voice/settings", {
      method: "PUT",
      body: JSON.stringify({
        mode: "remote",
        provider: "custom",
        adapter: "openai_audio_sse_v1",
        endpoint: "https://speech.example.com/v1/audio/transcriptions",
        auth: { type: "bearer", secret: "voice-test-secret" },
      }),
    });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.auth.configured, true);
    assert.equal(JSON.stringify(saved).includes("voice-test-secret"), false);

    const filePath = path.join(server.root, "voice.json");
    const stored = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(stored.auth.secret, "voice-test-secret");
    assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);

    const removed = await (await server.request("/v0/voice/credential", { method: "DELETE" })).json();
    assert.equal(removed.removed, true);
    assert.equal(removed.settings.auth.configured, false);
  } finally { await server.stop(); }
});
