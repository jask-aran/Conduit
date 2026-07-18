import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PreferencesStore, normalizePreferences } from "../src/preferences-store.js";

test("normalizePreferences falls back when the default template is unknown", () => {
  assert.deepEqual(
    normalizePreferences({ defaultTemplateId: "missing" }, { defaultTemplateId: "chat" }, ["chat", "workspace"]),
    { defaultTemplateId: "chat" },
  );
  assert.deepEqual(
    normalizePreferences({}, { defaultTemplateId: "gone" }, ["workspace"]),
    { defaultTemplateId: "workspace" },
  );
});

test("preferences store persists the default template id", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-prefs-"));
  const file = path.join(root, "preferences.json");
  const store = new PreferencesStore(file, { defaultTemplateId: "chat" }, {
    knownTemplateIds: ["chat", "workspace"],
  });
  await store.load();
  assert.equal(store.get().defaultTemplateId, "chat");
  await store.save({ defaultTemplateId: "workspace" });
  const restored = new PreferencesStore(file, { defaultTemplateId: "chat" }, {
    knownTemplateIds: ["chat", "workspace"],
  });
  await restored.load();
  assert.equal(restored.get().defaultTemplateId, "workspace");
  await fs.rm(root, { recursive: true, force: true });
});
