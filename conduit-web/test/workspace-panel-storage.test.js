import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspacePanelStorage,
  WORKSPACE_PANEL_GLOBAL_SCOPE,
} from "../src/client/workspace/workspace-panel-storage.ts";

function memoryStorage(initial = {}, { failWrites = () => false } = {}) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (failWrites(key, value)) throw new Error("quota exceeded");
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
    key(index) { return [...values.keys()][index] ?? null; },
    snapshot() { return Object.fromEntries(values); },
  };
}

test("pruning removes scopes that are no longer valid", () => {
  const storage = memoryStorage();
  const panel = createWorkspacePanelStorage(storage);
  panel.writeSetting("project:chat", "tab", "diff");
  panel.writeSetting("unknown", "tab", "files");

  panel.pruneWorkspacePanelStorage(["project:chat"]);

  assert.equal(panel.readSetting("project:chat", "tab"), "diff");
  assert.equal(storage.getItem("conduit:workspace-panel:unknown:state"), null);
});

test("dropping a chat scope removes every persisted panel setting", () => {
  const storage = memoryStorage();
  const panel = createWorkspacePanelStorage(storage);

  panel.writeSetting("chat-deleted", "tab", "files");
  panel.writeSetting("chat-deleted", "file", "src/app.ts");
  panel.dropScope("chat-deleted");

  assert.equal(panel.readSetting("chat-deleted", "tab"), null);
  assert.equal(Object.keys(storage.snapshot()).some((key) => key.includes("chat-deleted")), false);
});

test("quota failures fall back to memory and warn once without breaking writes", () => {
  let fail = false;
  const storage = memoryStorage({}, { failWrites: () => fail });
  const panel = createWorkspacePanelStorage(storage);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    panel.writeSetting("project", "tab", "files");
    fail = true;
    assert.doesNotThrow(() => panel.writeSetting("project", "tab", "diff"));
    assert.doesNotThrow(() => panel.writeSetting("project", "open", "true"));
    assert.equal(panel.readSetting("project", "tab"), "diff");
    assert.equal(panel.readSetting("project", "open"), "true");
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
});

test("keeps the 100 most recently written scopes", () => {
  const storage = memoryStorage();
  const panel = createWorkspacePanelStorage(storage);
  const scopes = Array.from({ length: 101 }, (_, index) => `project-${index}`);

  for (const scope of scopes) panel.writeSetting(scope, "tab", "files");
  panel.pruneWorkspacePanelStorage(scopes);

  assert.equal(panel.readSetting(scopes[0], "tab"), null);
  assert.equal(panel.readSetting(scopes[1], "tab"), "files");
  assert.equal(panel.readSetting(scopes.at(-1), "tab"), "files");
});
