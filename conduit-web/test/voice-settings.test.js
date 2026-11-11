import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VoiceRuntime, isPrivateAddress } from "../src/server/voice-runtime.js";
import { VoiceSettingsStore } from "../src/voice-settings.js";

async function temporaryStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-settings-"));
  const filePath = path.join(root, "voice.json");
  const store = new VoiceSettingsStore({ filePath });
  await store.initialize();
  return { root, filePath, store };
}

test("VoiceSettingsStore requires secure secret-free remote URLs", async () => {
  const fixture = await temporaryStore();
  try {
    const base = { mode: "remote", provider: "custom", adapter: "openai_audio_sse_v1", auth: { type: "none" } };
    await assert.rejects(fixture.store.update({ ...base, endpoint: "ws://speech.example.com/v1/audio/transcriptions" }), { code: "voice_endpoint_insecure" });
    await assert.rejects(fixture.store.update({ ...base, endpoint: "https://user:secret@speech.example.com/v1/audio/transcriptions" }), { code: "voice_endpoint_credentials" });
    await assert.rejects(fixture.store.update({ ...base, endpoint: "https://speech.example.com/v1/audio/transcriptions?api_key=secret" }), { code: "voice_endpoint_query" });
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test("first-class cloud providers pin endpoints, models, and credential scope", async () => {
  const fixture = await temporaryStore();
  try {
    await fixture.store.update({
      mode: "remote",
      provider: "openai",
      model: "gpt-transcribe",
      endpoint: "https://attacker.invalid/ignored",
      auth: { type: "none", secret: "openai-secret" },
    });
    const openai = await fixture.store.effective();
    assert.equal(openai.endpoint, "https://api.openai.com/v1/audio/transcriptions");
    assert.equal(openai.adapter, "openai_audio_sse_v1");
    assert.equal(openai.auth.type, "bearer");
    const openaiView = await fixture.store.publicView();
    assert.equal(openaiView.providers.find((provider) => provider.id === "openai").models.find((model) => model.id === "gpt-transcribe").adapter, "openai_audio_sse_v1");
    assert.equal(openaiView.providers.find((provider) => provider.id === "openai").models.find((model) => model.id === "gpt-live-transcribe").adapter, "openai_realtime_stream_v1");
    await fixture.store.update({
      mode: "remote", provider: "openai", model: "made-up", auth: { type: "bearer" },
    });
    assert.equal((await fixture.store.effective()).model, "gpt-transcribe");
    await assert.rejects(fixture.store.update({
      mode: "remote", provider: "deepgram", model: "nova-3", auth: { type: "bearer" },
    }), { code: "voice_secret_invalid" });
    await fixture.store.selectLocalModel("parakeet-tdt-v2-q8");
    const local = await fixture.store.effective();
    assert.equal(local.mode, "local");
    assert.equal(local.localModelId, "parakeet-tdt-v2-q8");
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test("local and off modes round-trip without deleting the saved cloud provider", async () => {
  const fixture = await temporaryStore();
  try {
    await fixture.store.update({
      mode: "remote", provider: "openai", model: "gpt-transcribe",
      auth: { type: "bearer", headerName: "Authorization", secret: "openai-secret" },
    });
    await fixture.store.update({ mode: "local", localModelId: "parakeet-tdt-v2-q8" });
    let view = await fixture.store.publicView();
    assert.equal(view.mode, "local");
    assert.equal(view.localModelId, "parakeet-tdt-v2-q8");
    assert.equal(view.auth.configured, true);
    await fixture.store.update({ mode: "off", localModelId: "parakeet-tdt-v2-q8" });
    view = await fixture.store.publicView();
    assert.equal(view.mode, "off");
    assert.equal(view.auth.configured, true);
    await fixture.store.update({
      mode: "remote", provider: "openai", model: "gpt-live-transcribe",
      auth: { type: "bearer", headerName: "Authorization" },
    });
    const live = await fixture.store.effective();
    assert.equal(live.model, "gpt-live-transcribe");
    assert.equal(live.adapter, "openai_realtime_stream_v1");
    assert.equal(live.auth.secret, "openai-secret");
    await fixture.store.update({
      mode: "remote", provider: "openai", model: "gpt-4o-transcribe",
      auth: { type: "bearer" },
    });
    const migrated = await fixture.store.effective();
    assert.equal(migrated.model, "gpt-transcribe");
    assert.equal(migrated.adapter, "openai_audio_sse_v1");
    await fixture.store.update({
      mode: "remote", provider: "groq", model: "whisper-large-v3-turbo",
      auth: { type: "bearer", secret: "groq-secret" },
    });
    const groq = await fixture.store.effective();
    assert.equal(groq.provider, "groq");
    assert.equal(groq.auth.secret, "groq-secret");
    await fixture.store.update({ mode: "remote", provider: "openai", model: "gpt-transcribe", auth: { type: "bearer" } });
    assert.equal((await fixture.store.effective()).auth.secret, "openai-secret");
    view = await fixture.store.publicView();
    assert.equal(view.providers.find((provider) => provider.id === "openai").configured, true);
    assert.equal(view.providers.find((provider) => provider.id === "groq").configured, true);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test("VoiceRuntime rejects SSRF targets and builds custom authentication only server-side", async () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("169.254.169.254"), true);
  assert.equal(isPrivateAddress("10.20.30.40"), true);
  assert.equal(isPrivateAddress("8.8.8.8"), false);

  const settings = { effective: async () => ({
    mode: "remote",
    provider: "custom",
    adapter: "openai_audio_sse_v1",
    endpoint: "https://speech.example.com/v1/audio/transcriptions",
    auth: { type: "header", headerName: "X-Speech-Key", secret: "server-only" },
    allowPrivate: false,
  }) };
  const blocked = new VoiceRuntime({ settings, modelManager: {}, lookup: async () => [{ address: "127.0.0.1", family: 4 }] });
  await assert.rejects(blocked.resolve(), { code: "voice_endpoint_private" });

  const runtime = new VoiceRuntime({ settings, modelManager: {}, lookup: async () => [{ address: "203.0.113.8", family: 4 }] });
  const resolved = await runtime.resolve();
  assert.deepEqual(resolved.headers, { "X-Speech-Key": "server-only" });
  assert.equal(typeof resolved.lookup, "function");

  const deepgram = new VoiceRuntime({
    settings: { effective: async () => ({ mode: "remote", provider: "deepgram", adapter: "deepgram_audio_v1", model: "nova-3", endpoint: "https://api.deepgram.com/v1/listen", auth: { type: "bearer", secret: "deepgram-secret" }, allowPrivate: false }) },
    modelManager: {},
    lookup: async () => [{ address: "203.0.113.9", family: 4 }],
  });
  assert.deepEqual((await deepgram.resolve()).headers, { Authorization: "Token deepgram-secret" });
});
