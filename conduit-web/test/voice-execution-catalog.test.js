import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  VOICE_EXECUTION_CATALOG,
  LOCAL_VOICE_MODELS,
  artifactForProfile,
  migrateLocalSelection,
  profileSelection,
  resolveVoiceExecutionProfile,
  validateVoiceExecutionCatalog,
} from "../src/server/voice-execution-catalog.js";
import { DEFAULT_LOCAL_VOICE_MODEL, VoiceSettingsStore } from "../src/voice-settings.js";

const copy = () => structuredClone(VOICE_EXECUTION_CATALOG);

test("WP8 catalogue resolves every legacy local model to one profile", () => {
  const catalog = VOICE_EXECUTION_CATALOG;
  for (const items of [catalog.models, catalog.artifacts, catalog.runtimes, catalog.backendPaths, catalog.profiles, catalog.migrations, LOCAL_VOICE_MODELS]) {
    assert.ok(items.length > 0);
  }
  assert.equal(validateVoiceExecutionCatalog(catalog), catalog);
  for (const model of catalog.models) {
    assert.ok(model.artifactIds.length > 0, model.id);
    assert.deepEqual(new Set(model.artifactIds), new Set(catalog.artifacts
      .filter((artifact) => artifact.modelId === model.id).map((artifact) => artifact.id)));
    assert.equal(new Set(model.artifactIds).size, model.artifactIds.length);
  }
  for (const profile of catalog.profiles) {
    assert.equal(resolveVoiceExecutionProfile(profileSelection(profile)).id, profile.id);
  }
  assert.equal(resolveVoiceExecutionProfile({ profileId: catalog.defaultProfileId }).id, catalog.defaultProfileId);
  assert.equal(catalog.defaultProfileId, migrateLocalSelection("moonshine-streaming-tiny-q8").profileId);
  assert.equal(resolveVoiceExecutionProfile({ profileId: catalog.defaultProfileId }).execution, "live");
  assert.equal(new Set(catalog.migrations.map((entry) => entry.legacyLocalModelId)).size, catalog.migrations.length);
  assert.deepEqual(new Set(catalog.migrations.map((entry) => entry.legacyLocalModelId)), new Set(LOCAL_VOICE_MODELS.map((model) => model.id)));
  for (const legacy of LOCAL_VOICE_MODELS) {
    const migration = migrateLocalSelection(legacy.id);
    const profile = resolveVoiceExecutionProfile(migration.selection);
    assert.equal(profile.id, migration.profileId);
    assert.equal(artifactForProfile(profile).legacyModelId, legacy.id);
  }
  for (const migration of catalog.migrations) {
    assert.deepEqual(migration.selection, profileSelection(resolveVoiceExecutionProfile({ profileId: migration.profileId })));
  }
  const migration = migrateLocalSelection("moonshine-streaming-tiny-q8");
  assert.deepEqual(migration.selection, {
    modelId: "moonshine-streaming-tiny",
    artifactId: "moonshine-streaming-tiny-q8-gguf",
    runtimeId: "transcribe-cpp",
    execution: "live",
    segmentation: "none",
  });
  const profile = resolveVoiceExecutionProfile(migration.selection);
  assert.equal(profile.id, migration.profileId);
  assert.equal(artifactForProfile(profile).legacyModelId, "moonshine-streaming-tiny-q8");
});

test("WP9 catalogue advertises stable sample-addressed output and checkpoint fallback", () => {
  const live = VOICE_EXECUTION_CATALOG.profiles.find((profile) => profile.execution === "live");
  assert.equal(live.output.stableSegments, true);
  assert.equal(live.output.sampleTimestamps, true);
  assert.deepEqual(live.fallback.allowed, "after_stable_checkpoint");
  assert.deepEqual(live.fallback.replay, "from_committed_sample");
});
test("WP8 catalogue validation rejects each structural contract violation", () => {
  const cases = [
    ["voice_catalog_duplicate_id", (catalog) => { catalog.profiles[1].id = catalog.profiles[0].id; }],
    ["voice_catalog_missing_reference", (catalog) => { catalog.profiles[0].artifactId = "missing-artifact"; }],
    ["voice_catalog_model_artifact_mismatch", (catalog) => { catalog.models.push({ id: "other-model" }); catalog.profiles[0].modelId = "other-model"; }],
    ["voice_catalog_artifact_runtime_mismatch", (catalog) => { catalog.runtimes.push({ id: "other-runtime" }); catalog.backendPaths[0].runtimeId = "other-runtime"; }],
    ["voice_catalog_fallback_cycle", (catalog) => {
      catalog.profiles[0].fallback = { profileId: catalog.profiles[1].id, allowed: "before_output", replay: "from_zero" };
      catalog.profiles[1].fallback = { profileId: catalog.profiles[0].id, allowed: "before_output", replay: "from_zero" };
    }],
    ["voice_catalog_batch_port_required", (catalog) => { catalog.backendPaths[0].ports.batch = false; }],
    ["voice_catalog_stream_port_required", (catalog) => {
      const pathId = catalog.profiles.find((profile) => profile.execution === "live").backendPathId;
      catalog.backendPaths.find((backendPath) => backendPath.id === pathId).ports.stream = false;
    }],
    ["voice_catalog_eager_segmentation_required", (catalog) => { catalog.profiles[0].execution = "eager"; catalog.profiles[0].segmentation = "none"; }],
    ["voice_catalog_segmentation_forbidden", (catalog) => { catalog.profiles.find((profile) => profile.execution === "stop").segmentation = "heuristic"; }],
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
      localModelId: "moonshine-streaming-tiny-q8",
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
      modelId: "moonshine-streaming-tiny",
      artifactId: "moonshine-streaming-tiny-q8-gguf",
      runtimeId: "transcribe-cpp",
      execution: "live",
      segmentation: "none",
    });
    assert.equal(saved.auth.secret, "kept-secret");
    const view = await store.update({ mode: "local", localSelection: saved.localSelection });
    assert.equal(view.voiceConfigVersion, 2);
    assert.equal(view.resolvedProfileId, saved.resolvedProfileId);
    assert.equal(JSON.stringify(view).includes("kept-secret"), false);
    for (const mode of ["remote", "local", "off"]) {
      for (const localFields of [
        { localModelId: "whisper-tiny-en-q8", resolvedProfileId: "whisper-tiny-en-q8.eager" },
        { voiceConfigVersion: 2, localModelId: "parakeet-unified-en-0.6b-q8", localSelectionOrigin: "explicit",
          localSelection: { modelId: "parakeet-unified-en-0.6b", artifactId: "parakeet-unified-en-0.6b-q8-gguf", runtimeId: "transcribe-cpp", execution: "live", segmentation: "none" } },
      ]) {
        const previous = { mode, provider: "custom", auth: { type: "bearer", secret: "kept-secret" }, ...localFields };
        await fs.writeFile(filePath, JSON.stringify(previous));
        await store.initialize();
        const migrated = JSON.parse(await fs.readFile(filePath, "utf8"));
        assert.equal(migrated.mode, mode);
        assert.equal(migrated.provider, previous.provider);
        assert.deepEqual(migrated.auth, previous.auth);
        assert.equal(migrated.localModelId, DEFAULT_LOCAL_VOICE_MODEL);
        assert.equal(migrated.resolvedProfileId, VOICE_EXECUTION_CATALOG.defaultProfileId);
        assert.equal((await store.effective()).mode, mode);
      }
    }
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
