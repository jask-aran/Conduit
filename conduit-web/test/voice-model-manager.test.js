import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LOCAL_VOICE_MODELS, VoiceModelManager } from "../src/server/voice-model-manager.js";
import { TRANSCRIBE_CPP_RUNTIME } from "../src/server/voice-model-manifests.js";
import backend from "../src/server/voice-backends/transcribe-cpp.js";
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
