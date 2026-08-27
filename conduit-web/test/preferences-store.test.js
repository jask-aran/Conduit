import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PreferencesStore, normalizePreferences, validTerminalShortcuts } from "../src/preferences-store.js";

test("normalizePreferences falls back when the default template is unknown", () => {
  assert.deepEqual(
    normalizePreferences({ defaultTemplateId: "missing" }, { defaultTemplateId: "chat" }, ["chat", "workspace"]),
    { defaultTemplateId: "chat", sessionNameModel: "", sessionNameThinkingLevel: "off", terminalShortcuts: [] },
  );
  assert.deepEqual(
    normalizePreferences({}, { defaultTemplateId: "gone" }, ["workspace"]),
    { defaultTemplateId: "workspace", sessionNameModel: "", sessionNameThinkingLevel: "off", terminalShortcuts: [] },
  );
});

test("preferences store persists general settings", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-prefs-"));
  const file = path.join(root, "preferences.json");
  const store = new PreferencesStore(file, { defaultTemplateId: "chat" }, {
    knownTemplateIds: ["chat", "workspace"],
  });
  await store.load();
  assert.equal(store.get().defaultTemplateId, "chat");
  await store.save({
    defaultTemplateId: "workspace",
    sessionNameModel: "example/cheap",
    sessionNameThinkingLevel: "low",
    terminalShortcuts: [{ id: "herdr", label: "Herdr", command: "herdr", target: "new" }],
  });
  const restored = new PreferencesStore(file, { defaultTemplateId: "chat" }, {
    knownTemplateIds: ["chat", "workspace"],
  });
  await restored.load();
  assert.equal(restored.get().defaultTemplateId, "workspace");
  assert.equal(restored.get().sessionNameModel, "example/cheap");
  assert.equal(restored.get().sessionNameThinkingLevel, "low");
  assert.deepEqual(restored.get().terminalShortcuts, [{ id: "herdr", label: "Herdr", command: "herdr", target: "new" }]);
  assert.equal(validTerminalShortcuts(restored.get().terminalShortcuts), true);
  assert.equal(validTerminalShortcuts([{ id: "bad", label: "", command: "pwd", target: "current" }]), false);
  await fs.rm(root, { recursive: true, force: true });
});
