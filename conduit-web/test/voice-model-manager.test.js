import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VoiceModelManager } from "../src/server/voice-model-manager.js";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

test("managed voice model requires license acceptance, verifies artifacts, reports progress, and uninstalls", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-model-"));
  const root = path.join(temporary, "voice", "parakeet");
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
    manifestResolver: async () => ({ version: "test-v1", modelRevision: "pinned-revision", artifacts }),
    fetchImpl: async (url) => new Response(contents.get(url)),
    runtimeExtractor: async (_archive, staging) => {
      const directory = path.join(staging, "onnxruntime-linux-x64-1.25.1", "lib");
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(path.join(directory, "libonnxruntime.so"), "fake library");
    },
  });
  try {
    assert.throws(() => manager.startInstall(), { code: "voice_model_license" });
    const installing = manager.startInstall({ licenseAccepted: true });
    assert.equal((await manager.publicView()).state, "installing");
    await installing;
    const ready = await manager.publicView();
    assert.equal(ready.state, "ready");
    assert.equal(ready.installed, true);
    assert.equal(ready.version, "test-v1");
    const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
    assert.equal(manifest.modelRevision, "pinned-revision");
    assert.equal(manifest.artifacts.every((artifact) => /^[a-f0-9]{64}$/.test(artifact.sha256)), true);
    assert.equal(await manager.uninstall(), true);
    assert.equal((await manager.publicView()).installed, false);
  } finally { await manager.stop(); await fs.rm(temporary, { recursive: true, force: true }); }
});

test("managed voice model rejects a mismatched artifact without activating it", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-model-bad-"));
  const root = path.join(temporary, "voice", "parakeet");
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
  });
  try {
    await assert.rejects(manager.startInstall({ licenseAccepted: true }), { code: "voice_model_checksum" });
    assert.equal((await manager.publicView()).installed, false);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
});
