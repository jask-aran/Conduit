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

test("migrates scoped keys into one state object and removes unknown scopes", () => {
  const storage = memoryStorage({
    "conduit:workspace-panel:project:chat-old:tab": "diff",
    "conduit:workspace-panel:project:chat-old:width": "400",
    "conduit:workspace-panel:project:chat-old:files:detail-height": "200",
    "conduit:workspace-panel:unknown:tab": "files",
    "conduit:workspace:wrap-lines": "true",
  });
  const panel = createWorkspacePanelStorage(storage);

  panel.migrateWorkspacePanelStorage(["project:chat-old"]);

  assert.equal(panel.readSetting("project:chat-old", "tab"), "diff");
  assert.equal(panel.readSetting("project:chat-old", "width"), "320");
  assert.equal(panel.readSetting("project:chat-old", "files:detail-height"), "160");
  assert.equal(panel.readSetting(WORKSPACE_PANEL_GLOBAL_SCOPE, "wrap-lines"), "true");
  assert.equal(storage.getItem("conduit:workspace-panel:project:chat-old:tab"), null);
  assert.equal(storage.getItem("conduit:workspace-panel:unknown:state"), null);
  assert.equal(storage.getItem("conduit:workspace:wrap-lines"), null);
  assert.deepEqual(Object.keys(storage.snapshot()).filter((key) => key.startsWith("conduit:workspace-panel:project:chat-old:")), [
    "conduit:workspace-panel:project:chat-old:state",
  ]);
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
  panel.migrateWorkspacePanelStorage(scopes);

  assert.equal(panel.readSetting(scopes[0], "tab"), null);
  assert.equal(panel.readSetting(scopes[1], "tab"), "files");
  assert.equal(panel.readSetting(scopes.at(-1), "tab"), "files");
});
