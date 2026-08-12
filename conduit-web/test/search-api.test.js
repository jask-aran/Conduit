import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { startConduitHarness } from "./helpers/conduit-harness.js";

test("search settings API stores Brave credentials without returning them", async () => {
  const server = await startConduitHarness();
  try {
    const initialResponse = await fetch(`${server.origin}/v0/search/settings`);
    assert.equal(initialResponse.status, 200);
    const initial = await initialResponse.json();
    assert.equal(initial.providers.find((provider) => provider.id === "brave").configured, false);
    assert.equal("configPath" in initial, false);

    const saveResponse = await fetch(`${server.origin}/v0/search/providers/brave`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "BSA-test-secret" }),
    });
    assert.equal(saveResponse.status, 200);
    const saved = await saveResponse.json();
    assert.equal(saved.providers.find((provider) => provider.id === "brave").configured, true);
    assert.equal(JSON.stringify(saved).includes("BSA-test-secret"), false);

    const config = JSON.parse(await fs.readFile(path.join(server.root, "pi", "web-search.json"), "utf8"));
    assert.equal(config.braveApiKey, "BSA-test-secret");
    assert.equal((await fs.stat(path.join(server.root, "pi", "web-search.json"))).mode & 0o777, 0o600);

    const removeResponse = await fetch(`${server.origin}/v0/search/providers/brave`, { method: "DELETE" });
    assert.equal(removeResponse.status, 200);
    assert.equal((await removeResponse.json()).removed, true);
  } finally {
    await server.stop();
  }
});
