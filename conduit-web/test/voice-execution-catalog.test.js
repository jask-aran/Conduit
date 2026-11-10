import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { VOICE_EXECUTION_CATALOG } from "../src/server/voice-execution-catalog.js";
import { DEFAULT_LOCAL_VOICE_MODEL, VoiceSettingsStore } from "../src/voice-settings.js";

test("WP8 settings normalization writes the local selection and preserves remote credentials", async () => {
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
    assert.deepEqual(saved.localSelection, {
      modelId: "moonshine-streaming-tiny",
      artifactId: "moonshine-streaming-tiny-q8-gguf",
      execution: "live",
      segmentation: "none",
    });
    assert.equal(saved.auth.secret, "kept-secret");
    const view = await store.update({ mode: "local", localSelection: saved.localSelection });
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
