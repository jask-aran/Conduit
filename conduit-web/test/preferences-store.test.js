import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PreferencesStore, normalizePreferences, validSidebarPins, validTerminalShortcuts, validUiPreferencePatch } from "../src/preferences-store.js";

const emptyUiPreferences = {
  sidebarChatLimit: null,
  collapsedProjectIds: null,
  sidebarCollapsed: null,
  markdownRenderer: null,
  transcriptRenderer: null,
  rendererControlsVisible: null,
  composerSurface: null,
  contextMetrics: null,
  meteorField: null,
  incremarkPacing: null,
  shortcutOverrides: null,
  voicePreferences: null,
};

test("normalizePreferences falls back when the default template is unknown", () => {
  assert.deepEqual(
    normalizePreferences({ defaultTemplateId: "missing" }, { defaultTemplateId: "chat" }, ["chat", "workspace"]),
    { defaultTemplateId: "chat", sessionNameModel: "", sessionNameThinkingLevel: "off", terminalShortcuts: [], sidebarPins: [], ...emptyUiPreferences },
  );
  assert.deepEqual(
    normalizePreferences({}, { defaultTemplateId: "gone" }, ["workspace"]),
    { defaultTemplateId: "workspace", sessionNameModel: "", sessionNameThinkingLevel: "off", terminalShortcuts: [], sidebarPins: [], ...emptyUiPreferences },
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
    sidebarPins: ["chat:one", "project:two", "terminal:three"],
    sidebarChatLimit: 45,
    collapsedProjectIds: ["project:one"],
    sidebarCollapsed: true,
    markdownRenderer: "incremark",
    transcriptRenderer: "incremark-advanced",
    rendererControlsVisible: false,
    composerSurface: "static",
    contextMetrics: ["contextTokens", "sessionCost"],
    meteorField: false,
    incremarkPacing: "adaptive",
    shortcutOverrides: {
      "open-command-palette": [{ strokes: [{ code: "KeyK", key: "K", modifiers: ["primary"] }] }],
    },
    voicePreferences: { shortcut: "Ctrl+Shift+D", activation: "toggle", autoSend: true, captureProfile: "processed" },
  });
  const restored = new PreferencesStore(file, { defaultTemplateId: "chat" }, {
    knownTemplateIds: ["chat", "workspace"],
  });
  await restored.load();
  assert.equal(restored.get().defaultTemplateId, "workspace");
  assert.equal(restored.get().sessionNameModel, "example/cheap");
  assert.equal(restored.get().sessionNameThinkingLevel, "low");
  assert.deepEqual(restored.get().terminalShortcuts, [{ id: "herdr", label: "Herdr", command: "herdr", target: "new" }]);
  assert.deepEqual(restored.get().sidebarPins, ["chat:one", "project:two", "terminal:three"]);
  assert.equal(restored.get().sidebarChatLimit, 45);
  assert.deepEqual(restored.get().collapsedProjectIds, ["project:one"]);
  assert.equal(restored.get().rendererControlsVisible, false);
  assert.equal(restored.get().transcriptRenderer, "incremark-advanced");
  assert.deepEqual(restored.get().voicePreferences, { shortcut: "Ctrl+Shift+D", activation: "toggle", autoSend: true, captureProfile: "processed" });
  assert.equal(validTerminalShortcuts(restored.get().terminalShortcuts), true);
  assert.equal(validTerminalShortcuts([{ id: "bad", label: "", command: "pwd", target: "current" }]), false);
  assert.equal(validSidebarPins(restored.get().sidebarPins), true);
  assert.equal(validSidebarPins(["chat:one", "chat:one"]), false);
  assert.equal(validSidebarPins(["unknown:one"]), false);
  assert.equal(validUiPreferencePatch({ sidebarChatLimit: 45, rendererControlsVisible: false }), true);
  assert.equal(validUiPreferencePatch({ sidebarChatLimit: 4 }), false);
  assert.equal(validUiPreferencePatch({ voicePreferences: { shortcut: "Ctrl+D" } }), false);
  await fs.rm(root, { recursive: true, force: true });
});
