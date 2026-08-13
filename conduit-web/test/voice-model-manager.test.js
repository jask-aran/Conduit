import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LOCAL_VOICE_MODELS, VoiceModelManager } from "../src/server/voice-model-manager.js";
import { getVoiceModelManifest } from "../src/server/voice-model-manifests.js";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

test("managed voice packages use reviewed immutable revisions, sizes, and SHA-256 pins", () => {
  for (const model of LOCAL_VOICE_MODELS) {
    for (const architecture of [{ release: "amd64", runtime: "x64" }, { release: "arm64", runtime: "aarch64" }]) {
      const manifest = getVoiceModelManifest(model, architecture);
      assert.equal(manifest.modelRevision, model.revision);
      assert.ok(manifest.artifacts.length > 0);
      for (const artifact of manifest.artifacts) {
        assert.match(artifact.sha256, /^[a-f0-9]{64}$/);
        assert.ok(Number.isInteger(artifact.size) && artifact.size > 0, `${model.id}/${artifact.name} needs an exact byte size`);
        assert.match(artifact.url, /(?:resolve\/[a-f0-9]{40}|(?:releases\/download|raw)\/v[0-9.]+|raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[a-f0-9]{40}\/)/);
      }
    }
  }
  const parakeet = getVoiceModelManifest(LOCAL_VOICE_MODELS.at(-1), { release: "amd64", runtime: "x64" });
  assert.equal(parakeet.artifacts.find((artifact) => artifact.name === "parakeet-linux-amd64").sha256, "4eaa7123e49756dea7714db20b4ea36aa96f3ba50d7e1ccec7df2ccededcdf9b");
});

test("managed voice model requires license acceptance, verifies artifacts, reports progress, and uninstalls", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-model-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "parakeet-tdt-0.6b-v3-int8";
  const contents = new Map([
    ["https://packages.invalid/parakeet", Buffer.from("fake executable")],
    ["https://packages.invalid/runtime", Buffer.from("fake runtime archive")],
    ["https://packages.invalid/model", Buffer.from("fake checked model weights")],
  ]);
  const artifacts = [
    { name: "parakeet", relative: "bin/parakeet", url: "https://packages.invalid/parakeet" },
    { name: "runtime", relative: "runtime.tgz", url: "https://packages.invalid/runtime" },
    { name: "weights", relative: "models/encoder-model.int8.onnx", url: "https://packages.invalid/model" },
  ].map((artifact) => ({ ...artifact, size: contents.get(artifact.url).length, sha256: sha256(contents.get(artifact.url)) }));
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test-v1", modelRevision: "pinned-revision", extractRuntime: true, artifacts }),
    fetchImpl: async (url) => new Response(contents.get(url)),
    runtimeExtractor: async (_archive, staging) => {
      const directory = path.join(staging, "onnxruntime-linux-x64-1.25.1", "lib");
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, "libonnxruntime.so"), "fake library");
    },
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
  const modelId = "parakeet-tdt-0.6b-v3-int8";
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test-v1", modelRevision: "pinned", artifacts: [{
      name: "weights",
      relative: "models/encoder-model.int8.onnx",
      url: "https://packages.invalid/model",
      sha256: "0".repeat(64),
      size: 10,
    }] }),
    fetchImpl: async () => new Response("unexpected"),
    runtimeExtractor: async () => {},
    downloadRetries: 0,
  });
  try {
    await assert.rejects(manager.startInstall({ modelId, licenseAccepted: true }), { code: "voice_model_checksum" });
    assert.equal((await manager.publicView()).models.find((model) => model.id === modelId).installed, false);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("managed voice model resumes a staged install after the process stops during runtime extraction", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-recover-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "parakeet-tdt-0.6b-v3-int8";
  const binary = Buffer.from("fake parakeet executable");
  const runtime = Buffer.from("fake runtime archive");
  const artifacts = [
    { name: "parakeet", relative: "bin/parakeet", url: "https://packages.invalid/parakeet", size: binary.length, sha256: sha256(binary) },
    { name: "runtime", relative: "runtime.tgz", url: "https://packages.invalid/runtime", size: runtime.length, sha256: sha256(runtime) },
  ];
  let extractionAttempts = 0;
  const createManager = () => new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test", modelRevision: "pinned", extractRuntime: true, artifacts }),
    fetchImpl: async (url) => new Response(url.endsWith("/parakeet") ? binary : runtime),
    runtimeExtractor: async (_archive, staging) => {
      extractionAttempts += 1;
      const directory = path.join(staging, "onnxruntime-linux-x64-1.25.1", "lib");
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, "libonnxruntime.so"), "fake library");
      if (extractionAttempts === 1) throw new Error("simulated process stop");
    },
    downloadRetries: 0,
  });
  const first = createManager();
  try {
    await assert.rejects(first.startInstall({ modelId, licenseAccepted: true }), { message: "simulated process stop" });
    assert.equal((await first.publicView()).models.find((model) => model.id === modelId).state, "error");
    assert.equal((await first.publicView()).models.find((model) => model.id === modelId).staged, true);

    const second = createManager();
    try {
      await second.startInstall({ modelId, licenseAccepted: true });
      const recovered = (await second.publicView()).models.find((model) => model.id === modelId);
      assert.equal(recovered.state, "ready");
      assert.equal(recovered.installed, true);
      assert.equal(recovered.staged, false);
      assert.equal(extractionAttempts, 2);
      assert.equal(await fs.access(path.join(root, modelId, "runtime", "lib", "libonnxruntime.so")).then(() => true), true);
    } finally { await second.stop(); }
  } finally {
    await first.stop();
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("managed Whisper tiers install independently and transcribe through the embedded engine", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-whisper-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "whisper-tiny-en-q8";
  const content = Buffer.from('{"model_type":"whisper"}');
  let loadedPath = "";
  const transcriber = async (audio) => {
    assert.equal(audio instanceof Float32Array, true);
    return { text: "local transcript" };
  };
  transcriber.dispose = async () => {};
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test", modelRevision: "pinned", artifacts: [{
      name: "config.json", relative: "config.json", url: "https://packages.invalid/config", size: content.length,
      sha256: sha256(content), gitBlob: "0".repeat(40),
    }] }),
    fetchImpl: async () => new Response(content),
    transformersLoader: async (modelPath) => { loadedPath = modelPath; return transcriber; },
  });
  try {
    await manager.startInstall({ modelId, licenseAccepted: true });
    assert.equal((await manager.publicView()).models.find((model) => model.id === modelId).installed, true);
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(16_384, 0);
    pcm.writeInt16LE(-16_384, 2);
    assert.equal(await manager.transcribe(modelId, pcm), "local transcript");
    assert.equal(loadedPath, path.join(root, modelId));
    assert.equal((await manager.publicView()).activeModelId, modelId);
  } finally { await manager.stop(); await fs.rm(temporary, { recursive: true, force: true }); }
});

test("concurrent managed Whisper requests share startup and serialize inference", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-whisper-concurrent-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "whisper-tiny-en-q8";
  await fs.mkdir(path.join(root, modelId), { recursive: true });
  await fs.writeFile(path.join(root, modelId, "manifest.json"), JSON.stringify({ modelId }));
  let loads = 0;
  let disposals = 0;
  let activeInferences = 0;
  let maximumInferences = 0;
  const manager = new VoiceModelManager({
    root,
    transformersLoader: async () => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const transcriber = async () => {
        activeInferences += 1;
        maximumInferences = Math.max(maximumInferences, activeInferences);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeInferences -= 1;
        return { text: "shared transcript" };
      };
      transcriber.dispose = async () => { disposals += 1; };
      return transcriber;
    },
  });
  try {
    const runtimes = await Promise.all([manager.ensureRunning(modelId), manager.ensureRunning(modelId)]);
    assert.deepEqual(runtimes, [{ kind: "transcriber" }, { kind: "transcriber" }]);
    assert.equal(loads, 1);
    assert.deepEqual(await Promise.all([manager.transcribe(modelId, Buffer.alloc(4)), manager.transcribe(modelId, Buffer.alloc(4))]), ["shared transcript", "shared transcript"]);
    assert.equal(maximumInferences, 1);
  } finally {
    await manager.stop();
    assert.equal(disposals, 1);
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("install resumes an interrupted download from the partially written file", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-resume-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "parakeet-tdt-0.6b-v3-int8";
  const content = Buffer.from("0123456789abcdef");
  const requests = [];
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test", modelRevision: "pinned", artifacts: [{
      name: "weights", relative: "models/encoder-model.int8.onnx", url: "https://packages.invalid/model",
      size: content.length, sha256: sha256(content),
    }] }),
    fetchImpl: async (url, options = {}) => {
      requests.push(options);
      assert.equal(options.headers.Range, "bytes=8-");
      return new Response(content.subarray(8), { status: 206, headers: { "Content-Range": "bytes 8-15/16" } });
    },
    runtimeExtractor: async () => {},
    downloadRetries: 0,
  });
  try {
    const staging = path.join(root, `.installing-${modelId}`, "models");
    await fs.mkdir(staging, { recursive: true });
    await fs.writeFile(path.join(staging, "encoder-model.int8.onnx.part"), content.subarray(0, 8));
    await manager.startInstall({ modelId, licenseAccepted: true });
    const installed = await fs.readFile(path.join(root, modelId, "models", "encoder-model.int8.onnx"));
    assert.deepEqual(installed, content);
    assert.equal(requests.length, 1);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("install retries transient download failures with backoff before failing", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-retry-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "parakeet-tdt-0.6b-v3-int8";
  const content = Buffer.from("retryable payload");
  let attempts = 0;
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test", modelRevision: "pinned", artifacts: [{
      name: "weights", relative: "models/encoder-model.int8.onnx", url: "https://packages.invalid/model",
      size: content.length, sha256: sha256(content),
    }] }),
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError("fetch failed");
      return new Response(content);
    },
    runtimeExtractor: async () => {},
    downloadRetries: 3,
    downloadRetryBaseMs: 5,
  });
  try {
    await manager.startInstall({ modelId, licenseAccepted: true });
    assert.equal(attempts, 3);
    const installed = await fs.readFile(path.join(root, modelId, "models", "encoder-model.int8.onnx"));
    assert.deepEqual(installed, content);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});

test("install downloads artifacts concurrently up to a bounded limit", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-parallel-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "whisper-tiny-en-q8";
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

test("full-precision Whisper models load with the fp32 precision", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-whisper-fp32-"));
  const root = path.join(temporary, "voice", "models");
  const modelId = "whisper-small-fp32";
  const content = Buffer.from('{"model_type":"whisper"}');
  const loaded = [];
  const transcriber = async () => ({ text: "full precision transcript" });
  transcriber.dispose = async () => {};
  const manager = new VoiceModelManager({
    root,
    manifestResolver: async () => ({ version: "test", modelRevision: "pinned", artifacts: [{
      name: "config.json", relative: "config.json", url: "https://packages.invalid/config", size: content.length,
      sha256: sha256(content), gitBlob: "0".repeat(40),
    }] }),
    fetchImpl: async () => new Response(content),
    transformersLoader: async (modelPath, precision) => { loaded.push({ modelPath, precision }); return transcriber; },
  });
  try {
    await manager.startInstall({ modelId, licenseAccepted: true });
    assert.deepEqual(await manager.ensureRunning(modelId), { kind: "transcriber" });
    assert.deepEqual(loaded, [{ modelPath: path.join(root, modelId), precision: "fp32" }]);
    assert.equal(await manager.transcribe(modelId, Buffer.alloc(4)), "full precision transcript");
  } finally { await manager.stop(); await fs.rm(temporary, { recursive: true, force: true }); }
});

test("CONDUIT_HF_ENDPOINT re-points managed model downloads at a mirror", () => {
  const previous = process.env.CONDUIT_HF_ENDPOINT;
  try {
    process.env.CONDUIT_HF_ENDPOINT = "https://hf-mirror.invalid//";
    for (const model of LOCAL_VOICE_MODELS) {
      const manifest = getVoiceModelManifest(model, { release: "amd64", runtime: "x64" });
      const huggingFaceArtifacts = manifest.artifacts.filter((artifact) => artifact.url.includes("/resolve/"));
      assert.ok(huggingFaceArtifacts.length > 0, `${model.id} should fetch models from a mirror`);
      assert.ok(huggingFaceArtifacts.every((artifact) => artifact.url.startsWith("https://hf-mirror.invalid/")), model.id);
    }
  } finally {
    if (previous === undefined) delete process.env.CONDUIT_HF_ENDPOINT;
    else process.env.CONDUIT_HF_ENDPOINT = previous;
  }
});
