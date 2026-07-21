import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RuntimeSettingsStore } from "../src/runtime-settings.js";

test("RuntimeSettingsStore persists all three normalized policy controls", async (context) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-runtime-settings-"));
  context.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "nested", "runtime.json");

  const writer = new RuntimeSettingsStore(filePath);
  const saved = await writer.save({
    maxLiveProcesses: 17.9,
    maxGeneratingProcesses: 5.8,
    idleProcessTtlMs: 420_999,
    ignoredPolicy: "not persisted",
  });
  assert.deepEqual(saved, {
    maxLiveProcesses: 17,
    maxGeneratingProcesses: 5,
    idleProcessTtlMs: 420_999,
  });

  const reader = new RuntimeSettingsStore(filePath, {
    maxLiveProcesses: 1,
    maxGeneratingProcesses: 1,
    idleProcessTtlMs: 30_000,
  });
  assert.deepEqual(await reader.load(), saved);
  assert.deepEqual(JSON.parse(await fs.readFile(filePath, "utf8")), saved);
});
