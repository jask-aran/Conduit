import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SearchSettingsStore } from "../src/search-settings.js";

async function temporaryStore(environment = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-search-settings-"));
  const filePath = path.join(root, "pi", "web-search.json");
  const store = new SearchSettingsStore({ filePath, environment });
  return { root, filePath, store };
}

test("SearchSettingsStore creates safe defaults and never returns credentials", async () => {
  const fixture = await temporaryStore({ BRAVE_API_KEY: "environment-key" });
  try {
    await fixture.store.initialize();
    const config = JSON.parse(await fs.readFile(fixture.filePath, "utf8"));
    assert.equal(config.workflow, "none");
    assert.deepEqual(config.searchRouting.providers, ["openai", "brave", "exa", "parallel", "tavily", "perplexity"]);
    assert.equal((await fs.stat(fixture.filePath)).mode & 0o777, 0o600);

    await fixture.store.setProvider("brave", "BSA-test-key");
    const view = await fixture.store.publicView();
    const brave = view.providers.find((provider) => provider.id === "brave");
    assert.deepEqual({ configured: brave.configured, stored: brave.stored, source: brave.source, removable: brave.removable }, {
      configured: true,
      stored: true,
      source: "environment",
      removable: true,
    });
    assert.equal(JSON.stringify(view).includes("BSA-test-key"), false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
test("SearchSettingsStore removes stored keys while preserving environment fallback", async () => {
  const fixture = await temporaryStore({});
  try {
    await fixture.store.initialize();
    await fixture.store.setProvider("brave", "!literal-key");
    const storedConfig = JSON.parse(await fs.readFile(fixture.filePath, "utf8"));
    assert.equal(storedConfig.braveApiKey, "$!literal-key");
    assert.equal((await fixture.store.publicView()).providers.find((provider) => provider.id === "brave").source, "stored");

    const result = await fixture.store.removeProvider("brave");
    assert.equal(result.removed, true);
    assert.equal((await fixture.store.publicView()).providers.find((provider) => provider.id === "brave").configured, false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test("SearchSettingsStore rejects disabled providers and invalid keys", async () => {
  const fixture = await temporaryStore();
  try {
    await fixture.store.initialize();
    await assert.rejects(fixture.store.setProvider("exa", "key"), { code: "search_provider_locked" });
    await assert.rejects(fixture.store.setProvider("brave", ""), { code: "search_key_invalid" });
    await assert.rejects(fixture.store.setProvider("missing", "key"), { code: "search_provider_unknown" });
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
