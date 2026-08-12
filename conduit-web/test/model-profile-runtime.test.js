import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadModelProfiles, resolveModelProfile } from "../src/model-profiles.js";
import { ModelProfileRuntime, usesWebSearchOverlay } from "../src/model-profile-runtime.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-model-profile-"));
  const agentDir = path.join(root, "pi");
  const searchConfigFile = path.join(agentDir, "web-search.json");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(path.join(agentDir, "auth.json"), "{}\n", { mode: 0o600 });
  await fs.writeFile(searchConfigFile, JSON.stringify({
    provider: "openai",
    braveApiKey: "BSA-test-key",
    webSearch: { enabled: true },
  }), { mode: 0o600 });
  const profiles = loadModelProfiles(path.join(repositoryRoot, "templates", "model-profiles.json"));
  return { root, agentDir, searchConfigFile, profiles };
}

test("model profile runtime materializes only derived search state and links canonical Pi state", async () => {
  const item = await fixture();
  try {
    const runtime = new ModelProfileRuntime({ agentDir: item.agentDir, searchConfigFile: item.searchConfigFile });
    const template = { runtimeOverlays: ["web-search"] };
    const profile = resolveModelProfile(item.profiles, "openai-codex/gpt-5.6-luna");
    const result = await runtime.materialize({ template, profile });
    assert.equal(result.agentDir, path.join(item.agentDir, "model-profiles", "openai-search"));
    assert.equal(await fs.readlink(path.join(result.agentDir, "auth.json")), "../../auth.json");
    assert.equal(await fs.readlink(path.join(result.agentDir, "models.json")), "../../models.json");
    assert.equal((await fs.stat(result.agentDir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(result.agentDir, "web-search.json"))).mode & 0o777, 0o600);
    const derived = JSON.parse(await fs.readFile(path.join(result.agentDir, "web-search.json"), "utf8"));
    assert.equal("provider" in derived, false);
    assert.equal(derived.braveApiKey, "BSA-test-key");
    assert.deepEqual(derived.searchRouting, {
      providers: ["openai", "brave"],
      fallbackOn: ["transient", "quota", "network"],
    });
    const canonical = JSON.parse(await fs.readFile(item.searchConfigFile, "utf8"));
    assert.equal(canonical.provider, "openai");
  } finally {
    await fs.rm(item.root, { recursive: true, force: true });
  }
});

test("model profile runtime leaves non-opted-in templates on the canonical Pi directory", async () => {
  const item = await fixture();
  try {
    const runtime = new ModelProfileRuntime({ agentDir: item.agentDir, searchConfigFile: item.searchConfigFile });
    assert.equal(usesWebSearchOverlay({ runtimeOverlays: [] }), false);
    const result = await runtime.materialize({ template: { runtimeOverlays: [] }, profile: null });
    assert.equal(result.agentDir, item.agentDir);
    assert.equal(result.overlayDir, null);
    assert.equal(result.modelProfile, null);
  } finally {
    await fs.rm(item.root, { recursive: true, force: true });
  }
});

test("model profile runtime tolerates concurrent materialization", async () => {
  const item = await fixture();
  try {
    const runtime = new ModelProfileRuntime({ agentDir: item.agentDir, searchConfigFile: item.searchConfigFile });
    const template = { runtimeOverlays: ["web-search"] };
    const profile = resolveModelProfile(item.profiles, "anthropic/claude-opus-4-8");
    const results = await Promise.all([
      runtime.materialize({ template, profile }),
      runtime.materialize({ template, profile }),
    ]);
    assert.equal(results[0].overlayDir, results[1].overlayDir);
    assert.equal(await fs.readlink(path.join(results[0].overlayDir, "auth.json")), "../../auth.json");
  } finally {
    await fs.rm(item.root, { recursive: true, force: true });
  }
});

test("model profile runtime rejects unsafe profile paths", async () => {
  const item = await fixture();
  try {
    const runtime = new ModelProfileRuntime({ agentDir: item.agentDir, searchConfigFile: item.searchConfigFile });
    await assert.rejects(
      runtime.materialize({ template: { runtimeOverlays: ["web-search"] }, profile: { id: "../escape", searchRouting: { providers: ["brave"], fallbackOn: ["network"] } } }),
      { code: "model_profile_overlay_invalid" },
    );
  } finally {
    await fs.rm(item.root, { recursive: true, force: true });
  }
});
