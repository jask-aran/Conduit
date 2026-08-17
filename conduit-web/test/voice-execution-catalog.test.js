import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  VOICE_EXECUTION_CATALOG,
  artifactForProfile,
  migrateLocalSelection,
  resolveVoiceExecutionProfile,
  validateVoiceExecutionCatalog,
} from "../src/server/voice-execution-catalog.js";
import { VoiceSettingsStore } from "../src/voice-settings.js";

const copy = () => structuredClone(VOICE_EXECUTION_CATALOG);

test("WP8 catalogue resolves every legacy local model to one profile", () => {
  assert.equal(VOICE_EXECUTION_CATALOG.models.length, 7);
  assert.equal(VOICE_EXECUTION_CATALOG.artifacts.length, 12);
  assert.equal(VOICE_EXECUTION_CATALOG.runtimes.length, 3);
  assert.equal(VOICE_EXECUTION_CATALOG.profiles.length, 20);
  const migration = migrateLocalSelection("parakeet-unified-en-0.6b-q8");
  assert.deepEqual(migration.selection, {
    modelId: "parakeet-unified-en-0.6b",
    artifactId: "parakeet-unified-en-0.6b-q8-gguf",
    runtimeId: "transcribe-cpp",
    execution: "live",
    segmentation: "none",
  });
  const profile = resolveVoiceExecutionProfile(migration.selection);
  assert.equal(profile.id, migration.profileId);
  assert.equal(artifactForProfile(profile).legacyModelId, "parakeet-unified-en-0.6b-q8");
});
test("WP8 catalogue validation rejects each structural contract violation", () => {
  const cases = [
    ["voice_catalog_duplicate_id", (catalog) => { catalog.profiles[1].id = catalog.profiles[0].id; }],
    ["voice_catalog_missing_reference", (catalog) => { catalog.profiles[0].artifactId = "missing-artifact"; }],
    ["voice_catalog_model_artifact_mismatch", (catalog) => { catalog.profiles[0].modelId = "parakeet-unified-en-0.6b"; }],
    ["voice_catalog_artifact_runtime_mismatch", (catalog) => { catalog.backendPaths[0].runtimeId = "transcribe-cpp"; }],
    ["voice_catalog_fallback_cycle", (catalog) => {
      catalog.profiles[0].fallback = { profileId: catalog.profiles[1].id, allowed: "before_output", replay: "from_zero" };
      catalog.profiles[1].fallback = { profileId: catalog.profiles[0].id, allowed: "before_output", replay: "from_zero" };
    }],
    ["voice_catalog_batch_port_required", (catalog) => { catalog.backendPaths[0].ports.batch = false; }],
    ["voice_catalog_stream_port_required", (catalog) => {
      const pathId = catalog.profiles.find((profile) => profile.execution === "live").backendPathId;
      catalog.backendPaths.find((backendPath) => backendPath.id === pathId).ports.stream = false;
    }],
    ["voice_catalog_eager_segmentation_required", (catalog) => { catalog.profiles.find((profile) => profile.execution === "eager").segmentation = "none"; }],
    ["voice_catalog_segmentation_forbidden", (catalog) => { catalog.profiles.find((profile) => profile.execution === "stop").segmentation = "silero"; }],
    ["voice_catalog_live_queue_required", (catalog) => { catalog.profiles.find((profile) => profile.execution === "live").resourcePolicy.maximumQueuedAudioMs = 0; }],
  ];
  for (const [code, change] of cases) {
    const catalog = copy();
    change(catalog);
    assert.throws(() => validateVoiceExecutionCatalog(catalog), { code }, code);
  }
});

test("WP8 settings migration writes a v2 tuple atomically and preserves remote credentials", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-catalogue-"));
  const filePath = path.join(root, "voice.json");
  try {
    await fs.writeFile(filePath, JSON.stringify({
      mode: "local",
      localModelId: "parakeet-unified-en-0.6b-q8",
      provider: "openai",
      model: "gpt-transcribe",
      endpoint: "https://api.openai.com/v1/audio/transcriptions",
      auth: { type: "bearer", headerName: "Authorization", secret: "kept-secret" },
    }));
    const store = new VoiceSettingsStore({ filePath });
    await store.initialize();
    const saved = JSON.parse(await fs.readFile(filePath, "utf8"));
    assert.equal(saved.voiceConfigVersion, 2);
    assert.equal(saved.localSelectionOrigin, "migrated_explicit");
    assert.deepEqual(saved.localSelection, {
      modelId: "parakeet-unified-en-0.6b",
      artifactId: "parakeet-unified-en-0.6b-q8-gguf",
      runtimeId: "transcribe-cpp",
      execution: "live",
      segmentation: "none",
    });
    assert.equal(saved.auth.secret, "kept-secret");
    const view = await store.update({ mode: "local", localSelection: saved.localSelection });
    assert.equal(view.voiceConfigVersion, 2);
    assert.equal(view.resolvedProfileId, saved.resolvedProfileId);
    assert.equal(JSON.stringify(view).includes("kept-secret"), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test("WP8 accepts a valid local selection before the artifact is installed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-voice-absent-"));
  try {
    const store = new VoiceSettingsStore({ filePath: path.join(root, "voice.json") });
    await store.initialize();
    const profile = VOICE_EXECUTION_CATALOG.profiles.find((candidate) => candidate.execution === "live");
    const view = await store.update({ mode: "local", localSelection: {
      modelId: profile.modelId,
      artifactId: profile.artifactId,
      runtimeId: profile.runtimeId,
      execution: profile.execution,
      segmentation: profile.segmentation,
    } });
    assert.equal(view.mode, "local");
    assert.equal(view.localSelection.artifactId, profile.artifactId);
    assert.equal(view.localSelectionOrigin, "explicit");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
