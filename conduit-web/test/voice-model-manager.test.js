import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LOCAL_VOICE_MODELS, VoiceModelManager } from "../src/server/voice-model-manager.js";
import { TRANSCRIBE_CPP_RUNTIME } from "../src/server/voice-model-manifests.js";
import backend, { DEFAULT_TRANSCRIBE_CPP_STREAM } from "../src/server/voice-backends/transcribe-cpp.js";
const getVoiceModelManifest = (model) => backend.manifest(model);

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
test("managed voice packages use reviewed immutable revisions, sizes, and SHA-256 pins", () => {
  for (const model of LOCAL_VOICE_MODELS) {
    {
      const manifest = getVoiceModelManifest(model);
      assert.equal(manifest.modelRevision, model.revision);
      assert.ok(manifest.artifacts.length > 0);
      for (const artifact of manifest.artifacts) {
        assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
        assert.ok(Number.isInteger(artifact.size) && artifact.size > 0, `${model.id}/${artifact.name} needs an exact byte size`);
        assert.match(artifact.url, /(?:resolve\/[a-f0-9]{40}|(?:releases\/download|raw)\/v[0-9.]+|raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\/)/);
      }
    }
  }
  assert.equal(LOCAL_VOICE_MODELS.length, 1);
  const manifest = getVoiceModelManifest(LOCAL_VOICE_MODELS[0]);
  assert.equal(manifest.artifacts[0].name, "moonshine-streaming-tiny-Q8_0.gguf");
  assert.equal(manifest.artifacts[0].size, 50462816);
  assert.equal(manifest.artifacts[0].sha256, "930e4622ad3a24158b91406c30c977fa6a26b34cb32d6ac3e57cfb23383a869e");
  assert.equal(manifest.runtime, TRANSCRIBE_CPP_RUNTIME);
});

test("managed voice model requires license acceptance, verifies artifacts, reports progress, and uninstalls", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-model-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "moonshine-streaming-tiny-q8";
  const content = Buffer.from("fake gguf weights");
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test-v1", modelRevision: "pinned-revision", artifacts: [{
      name: "weights", relative: "model.gguf", url: "https://packages.invalid/model", size: content.length, sha256: sha256(content),
    }] }),
    fetchImpl: async () => new Response(content),
  });
  try {
    assert.throws(() => manager.startInstall({ modelId }), { code: "voice_model_license" });
    const installing = manager.startInstall({ modelId, licenseAccepted: true });
    assert.equal((await manager.publicView()).models.find((model) => model.id === modelId).state, "installing");
    await installing;
    const ready = await manager.publicView();
    assert.equal(ready.models.find((model) => model.id === modelId).state, "ready");
    assert.equal(ready.models.find((model) => model.id === modelId).installed, true);
    const manifest = JSON.parse(await fs.readFile(path.join(root, modelId, "manifest.json"), "utf8"));
    assert.equal(manifest.modelRevision, "pinned-revision");
    assert.equal(manifest.artifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256)), true);
    assert.equal(await manager.uninstall(modelId), true);
    assert.equal((await manager.publicView()).models.find((model) => model.id === modelId).installed, false);
  } finally { await manager.stop(); await fs.rm(temporary, { recursive: true, force: true }); }
});

test("managed voice model rejects a mismatched artifact without activating it", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-model-bad-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "moonshine-streaming-tiny-q8";
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test-v1", modelRevision: "pinned", artifacts: [{
      name: "weights",
      relative: "models/model.gguf",
      url: "https://packages.invalid/model",
      sha256: "0".repeat(64),
      size: 10,
    }] }),
    fetchImpl: async () => new Response("unexpected"),
    downloadRetries: 0,
  });
  try {
    await assert.rejects(manager.startInstall({ modelId, licenseAccepted: true }), { code: "voice_model_checksum" });
    assert.equal((await manager.publicView()).models.find((model) => model.id === modelId).installed, false);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("Moonshine Streaming Tiny Q8 uses one reusable transcribe.cpp session and exposes streaming", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-unified-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "moonshine-streaming-tiny-q8";
  const content = Buffer.from("fake gguf model");
  let loadedPath = "";
  let loadedDefinition = null;
  let activeInferences = 0;
  let maximumInferences = 0;
  let disposals = 0;
  let requestedStreamOptions = null;
  const runtime = {
    backend: "transcribe_cpp",
    computeBackend: "cpu",
    adapter: "transcribe_cpp_stream_v1",
    capabilities: {
      language: "en",
      inferenceMode: "streaming",
      partials: true,
      externalVad: false,
      precision: "q8",
      memory: { modelBytes: 50462816 },
      streaming: { family: "moonshine", commitPolicy: "stable_prefix", stablePrefixAgreementN: 3 },
    },
    native: { package: "transcribe-cpp", version: "0.1.3", headerHash: "86b16dd97ad1cb58" },
    async transcribe(audio) {
      assert.equal(audio instanceof Float32Array, true);
      activeInferences += 1;
      maximumInferences = Math.max(maximumInferences, activeInferences);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeInferences -= 1;
      return { text: "moonshine transcript" };
    },
    async stream(options) {
      requestedStreamOptions = options;
      return { state: "active" };
    },
    dispose() { disposals += 1; },
  };
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "transcribe-cpp-0.1.3", modelRevision: "pinned", sourceRevision: "source-pinned", runtime: TRANSCRIBE_CPP_RUNTIME, artifacts: [{
      name: "moonshine-streaming-tiny-Q8_0.gguf", relative: "moonshine-streaming-tiny-Q8_0.gguf", url: "https://packages.invalid/unified", size: content.length,
      sha256: sha256(content),
    }] }),
    fetchImpl: async () => new Response(content),
    runtimeLoader: async (modelPath, definition) => {
      loadedPath = modelPath;
      loadedDefinition = definition;
      return runtime;
    },
  });
  try {
    await manager.startInstall({ modelId, licenseAccepted: true });
    const [first, second] = await Promise.all([manager.transcribe(modelId, Buffer.alloc(4)), manager.transcribe(modelId, Buffer.alloc(4))]);
    assert.deepEqual([first, second], ["moonshine transcript", "moonshine transcript"]);
    assert.equal(maximumInferences, 1);
    assert.equal(loadedPath, path.join(root, modelId, "moonshine-streaming-tiny-Q8_0.gguf"));
    assert.equal(loadedDefinition.id, modelId);
    assert.deepEqual(await manager.stream(modelId, { family: { kind: "moonshine" } }), { state: "active" });
    assert.deepEqual(requestedStreamOptions, { family: { kind: "moonshine" } });
    assert.deepEqual(await manager.ensureRunning(modelId), {
      kind: "transcriber",
      adapter: "transcribe_cpp_stream_v1",
      backend: "transcribe_cpp",
      computeBackend: "cpu",
      capabilities: runtime.capabilities,
      native: runtime.native,
    });
  } finally {
    await manager.stop();
    assert.equal(disposals, 1);
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("Moonshine Streaming Tiny uses the stream-slot family", () => {
  assert.deepEqual(DEFAULT_TRANSCRIBE_CPP_STREAM, {
    family: "moonshine",
    commitPolicy: "stable_prefix",
    stablePrefixAgreementN: 3,
  });
});

test("install resumes an interrupted download from the partially written file", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-resume-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "moonshine-streaming-tiny-q8";
  const content = Buffer.from("0123456789abcdef");
  const requests = [];
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test", modelRevision: "pinned", artifacts: [{
      name: "weights", relative: "models/model.gguf", url: "https://packages.invalid/model",
      size: content.length, sha256: sha256(content),
    }] }),
    fetchImpl: async (url, options = {}) => {
      requests.push(options);
      assert.equal(options.headers.Range, "bytes=8-");
      return new Response(content.subarray(8), { status: 206, headers: { "Content-Range": "bytes 8-15/16" } });
    },
    downloadRetries: 0,
  });
  try {
    const staging = path.join(root, `.installing-${modelId}`, "models");
    await fs.mkdir(staging, { recursive: true });
    await fs.writeFile(path.join(staging, "model.gguf.part"), content.subarray(0, 8));
    await manager.startInstall({ modelId, licenseAccepted: true });
    const installed = await fs.readFile(path.join(root, modelId, "models", "model.gguf"));
    assert.deepEqual(installed, content);
    assert.equal(requests.length, 1);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("install retries transient download failures with backoff before failing", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-retry-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "moonshine-streaming-tiny-q8";
  const content = Buffer.from("retryable payload");
  let attempts = 0;
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test", modelRevision: "pinned", artifacts: [{
      name: "weights", relative: "models/model.gguf", url: "https://packages.invalid/model",
      size: content.length, sha256: sha256(content),
    }] }),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError("fetch failed");
      return new Response(content);
    },
    downloadRetries: 3,
    downloadRetryBaseMs: 5,
  });
  try {
    await manager.startInstall({ modelId, licenseAccepted: true });
    assert.equal(attempts, 3);
    const installed = await fs.readFile(path.join(root, modelId, "models", "model.gguf"));
    assert.deepEqual(installed, content);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("install downloads artifacts concurrently up to a bounded limit", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-parallel-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "moonshine-streaming-tiny-q8";
  const contents = new Map(["a", "b", "c", "d"].map((name) => [`https://packages.invalid/${name}`, Buffer.from(`payload ${name}`)]));
  let active = 0;
  let maximumActive = 0;
  const fetched = [];
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test", modelRevision: "pinned", artifacts: [...contents.keys()].map((url) => ({
      name: url.slice(-1), relative: `models/${url.slice(-1)}.bin`, url,
      size: contents.get(url).length, sha256: sha256(contents.get(url)),
    })) }),
    fetchImpl: async (url) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 25));
      active -= 1;
      fetched.push(url);
      return new Response(contents.get(url));
    },
    downloadRetries: 0,
  });
  try {
    await manager.startInstall({ modelId, licenseAccepted: true });
    assert.equal(fetched.length, 4);
    assert.ok(maximumActive >= 2, `expected parallel downloads, saw ${maximumActive}`);
    assert.ok(maximumActive <= 3, `expected bounded concurrency, saw ${maximumActive}`);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("managed models stay warm briefly then unload after the idle TTL", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-idle-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "moonshine-streaming-tiny-q8";
  await fs.mkdir(path.join(root, modelId), { recursive: true });
  await fs.writeFile(path.join(root, modelId, "manifest.json"), JSON.stringify({ modelId }));
  let loads = 0;
  let disposals = 0;
  const manager = new VoiceModelManager({
    root,
    idleTtlMs: 40,
    runtimeLoader: async () => {
      loads += 1;
      const transcriber = async () => ({ text: "idle transcript" });
      transcriber.dispose = async () => { disposals += 1; };
      return { transcribe: transcriber, dispose: transcriber.dispose };
    },
  });
  try {
    await manager.ensureRunning(modelId);
    assert.equal(loads, 1);
    await manager.ensureRunning(modelId);
    assert.equal(loads, 1);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(disposals, 1);
    await manager.ensureRunning(modelId);
    assert.equal(loads, 2);
  } finally {
    await manager.stop();
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("pinned managed models do not unload while a dictation session is open", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-pin-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "moonshine-streaming-tiny-q8";
  await fs.mkdir(path.join(root, modelId), { recursive: true });
  await fs.writeFile(path.join(root, modelId, "manifest.json"), JSON.stringify({ modelId }));
  let disposals = 0;
  const manager = new VoiceModelManager({
    root,
    idleTtlMs: 30,
    runtimeLoader: async () => {
      const transcriber = async () => ({ text: "pinned transcript" });
      transcriber.dispose = async () => { disposals += 1; };
      return { transcribe: transcriber, dispose: transcriber.dispose };
    },
  });
  try {
    manager.pin();
    await manager.ensureRunning(modelId);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(disposals, 0);
    assert.equal(manager.activeModelId, modelId);
    manager.unpin();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(disposals, 1);
    assert.equal(manager.activeModelId, null);
  } finally {
    await manager.stop();
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("CONDUIT_HF_ENDPOINT re-points managed model downloads at a mirror", () => {
  const previous = process.env.CONDUIT_HF_ENDPOINT;
  try {
    process.env.CONDUIT_HF_ENDPOINT = "https://hf-mirror.invalid//";
    for (const model of LOCAL_VOICE_MODELS) {
      const manifest = getVoiceModelManifest(model);
      const huggingFaceArtifacts = manifest.artifacts.filter((artifact) => artifact.url.includes("/resolve/"));
      assert.ok(huggingFaceArtifacts.length > 0, `${model.id} should fetch models from a mirror`);
      assert.ok(huggingFaceArtifacts.every((artifact) => artifact.url.startsWith("https://hf-mirror.invalid/")), model.id);
    }
  } finally {
    if (previous === undefined) delete process.env.CONDUIT_HF_ENDPOINT;
    else process.env.CONDUIT_HF_ENDPOINT = previous;
  }
});
