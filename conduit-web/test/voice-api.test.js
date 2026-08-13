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
    assert.equal(initial.local.installed, false);

    const response = await server.request("/v0/voice/settings", {
      method: "PUT",
      body: JSON.stringify({
        mode: "remote",
        adapter: "parakeet_pcm_ws_v1",
        endpoint: "wss://speech.example.com/ws",
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
