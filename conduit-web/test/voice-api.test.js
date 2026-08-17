import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startConduitHarness } from "./helpers/conduit-harness.js";

test("voice settings API stores endpoint authentication without returning the secret", async () => {
  const server = await startConduitHarness();
  try {
    const initial = await (await server.request("/v0/voice/settings")).json();
    assert.equal(initial.mode, "off");
    assert.equal(initial.voiceConfigVersion, 2);
    assert.equal(initial.localSelectionOrigin, "default");
    assert.equal(initial.local.catalogue.profiles.length, 28);
    assert.equal(initial.local.backendPaths.length, 16);
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

test("voice settings API accepts a valid absent-artifact execution tuple", async () => {
  const server = await startConduitHarness();
  try {
    const initial = await (await server.request("/v0/voice/settings")).json();
    const profile = initial.local.catalogue.profiles.find((candidate) => candidate.execution === "live");
    const response = await server.request("/v0/voice/settings", {
      method: "PUT",
      body: JSON.stringify({
        mode: "local",
        localSelection: {
          modelId: profile.modelId,
          artifactId: profile.artifactId,
          runtimeId: profile.runtimeId,
          execution: profile.execution,
          segmentation: profile.segmentation,
        },
      }),
    });
    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.mode, "local");
    assert.equal(saved.resolvedProfileId, profile.id);
    assert.equal(saved.local.backendPaths.find((path) => path.backendPathId === profile.backendPathId).artifactState, "absent");
  } finally { await server.stop(); }
});
