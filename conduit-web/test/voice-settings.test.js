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

test("VoiceSettingsStore persists redacted remote credentials with private file permissions", async () => {
  const fixture = await temporaryStore();
  try {
    await fixture.store.update({
      mode: "remote",
      provider: "custom",
      adapter: "openai_audio_sse_v1",
      endpoint: "https://speech.example.com/v1/audio/transcriptions",
      auth: { type: "header", headerName: "X-Speech-Key", secret: "top-secret" },
    });
    const stored = JSON.parse(await fs.readFile(fixture.filePath, "utf8"));
    assert.equal(stored.auth.secret, "top-secret");
    assert.equal((await fs.stat(fixture.filePath)).mode & 0o777, 0o600);
    const view = await fixture.store.publicView();
    assert.equal(view.auth.configured, true);
    assert.equal(view.auth.source, "stored");
    assert.equal(JSON.stringify(view).includes("top-secret"), false);
    assert.equal(await fixture.store.removeCredential(), true);
    assert.equal((await fixture.store.publicView()).auth.configured, false);
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

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
    await assert.rejects(fixture.store.update({
      mode: "remote", provider: "openai", model: "made-up", auth: { type: "bearer" },
    }), { code: "voice_model_invalid" });
    await assert.rejects(fixture.store.update({
      mode: "remote", provider: "deepgram", model: "nova-3", auth: { type: "bearer" },
    }), { code: "voice_secret_invalid" });
    await fixture.store.selectLocalModel("whisper-base-q8");
    const local = await fixture.store.effective();
    assert.equal(local.mode, "local");
    assert.equal(local.localModelId, "whisper-base-q8");
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test("local and off modes round-trip without deleting the saved cloud provider", async () => {
  const fixture = await temporaryStore();
  try {
    await fixture.store.update({
      mode: "remote", provider: "openai", model: "gpt-transcribe",
      auth: { type: "bearer", headerName: "Authorization", secret: "openai-secret" },
    });
    await fixture.store.update({ mode: "local", localModelId: "whisper-tiny-en-q8" });
    let view = await fixture.store.publicView();
    assert.equal(view.mode, "local");
    assert.equal(view.localModelId, "whisper-tiny-en-q8");
    assert.equal(view.auth.configured, true);
    await fixture.store.update({ mode: "off", localModelId: "whisper-tiny-en-q8" });
    view = await fixture.store.publicView();
    assert.equal(view.mode, "off");
    assert.equal(view.auth.configured, true);
    await fixture.store.update({
      mode: "remote", provider: "openai", model: "gpt-4o-mini-transcribe",
      auth: { type: "bearer", headerName: "Authorization" },
    });
    assert.equal((await fixture.store.effective()).auth.secret, "openai-secret");
  } finally { await fs.rm(fixture.root, { recursive: true, force: true }); }
});

test("none authentication ignores stale Authorization header metadata", async () => {
  const fixture = await temporaryStore();
  try {
    await fs.writeFile(fixture.filePath, JSON.stringify({
      mode: "off", provider: "custom", adapter: "openai_audio_sse_v1", auth: { type: "none", headerName: "Authorization" },
    }));
    const view = await fixture.store.publicView();
    assert.equal(view.auth.type, "none");
    assert.equal(view.auth.headerName, "X-API-Key");
    await fixture.store.update({
      mode: "remote", provider: "custom", adapter: "openai_audio_sse_v1", endpoint: "https://speech.example.com/transcribe",
      auth: { type: "none", headerName: "Authorization" },
    });
    assert.equal((await fixture.store.publicView()).auth.type, "none");
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

test("VoiceRuntime requires provider credential checks to succeed and keeps the managed model identity", async () => {
  const providerRuntime = new VoiceRuntime({
    settings: { effective: async () => ({
      mode: "remote", provider: "openai", adapter: "openai_audio_sse_v1", model: "gpt-transcribe",
      endpoint: "https://api.openai.com/v1/audio/transcriptions", auth: { type: "bearer", secret: "invalid" }, allowPrivate: false,
    }) },
    modelManager: {},
    fetchImpl: async () => new Response("unauthorized", { status: 401 }),
    lookup: async () => [{ address: "203.0.113.10", family: 4 }],
  });
  await assert.rejects(providerRuntime.test(), { code: "voice_credentials_rejected" });

  const customRuntime = new VoiceRuntime({
    settings: { effective: async () => ({
      mode: "remote", provider: "custom", adapter: "openai_audio_sse_v1", model: "",
      endpoint: "https://speech.example.com/transcribe", auth: { type: "bearer", secret: "invalid" }, allowPrivate: false,
    }) },
    modelManager: {},
    fetchImpl: async () => new Response("unauthorized", { status: 401 }),
    lookup: async () => [{ address: "203.0.113.11", family: 4 }],
  });
  await assert.rejects(customRuntime.test(), { code: "voice_endpoint_rejected" });

  let testedModel = "";
  const localRuntime = new VoiceRuntime({
    settings: { effective: async () => ({ mode: "local", localModelId: "parakeet-tdt-0.6b-v3-int8" }) },
    modelManager: {
      ensureRunning: async () => ({ kind: "http", origin: "http://127.0.0.1:9000" }),
      test: async (modelId) => { testedModel = modelId; return { ok: true }; },
    },
  });
  await localRuntime.test();
  assert.equal(testedModel, "parakeet-tdt-0.6b-v3-int8");
});

test("VoiceRuntime exposes the transcribe.cpp batch capability and actual compute backend", async () => {
  const runtime = new VoiceRuntime({
    settings: { effective: async () => ({ mode: "local", localModelId: "parakeet-unified-en-0.6b-q8" }) },
    modelManager: {
      ensureRunning: async () => ({
        kind: "transcriber",
        adapter: "transcribe_cpp_batch_v1",
        backend: "transcribe_cpp",
        computeBackend: "cpu",
        capabilities: { language: "en", inferenceMode: "batch", partials: false, externalVad: false, precision: "q8", memory: { modelBytes: 731357568 } },
        native: { package: "transcribe-cpp", version: "0.1.3", headerHash: "86b16dd97ad1cb58" },
      }),
      transcribe: async () => "unused",
    },
  });
  const resolved = await runtime.resolve();
  assert.equal(resolved.adapter, "transcribe_cpp_batch_v1");
  assert.equal(resolved.backend, "transcribe_cpp");
  assert.equal(resolved.computeBackend, "cpu");
  assert.equal(resolved.capabilities.partials, false);
  assert.equal(resolved.capabilities.externalVad, false);
  assert.equal(resolved.native.headerHash, "86b16dd97ad1cb58");
});
