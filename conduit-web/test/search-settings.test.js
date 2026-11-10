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
    assert.equal((await fixture.store.publicView()).providers.find((provider) => provider.id === "brave").ready, false);
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
