import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PreferencesStore } from "../src/preferences-store.js";

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
    meteorField: false,
    transcriptWidth: "wide",
    transcriptWideBlocks: "wider",
    codeBlockCollapse: "all",
    codeBlockCollapseLines: 25,
    codeBlockWidth: "wide",
    panelMotion: "reflow",
    userMessageCollapse: "25",
    chatSort: "created",
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
  assert.equal(restored.get().transcriptWidth, "wide");
  assert.equal(restored.get().transcriptWideBlocks, "wider");
  assert.equal(restored.get().codeBlockCollapse, "all");
  assert.equal(restored.get().codeBlockCollapseLines, 25);
  assert.equal(restored.get().codeBlockWidth, "wide");
  assert.equal(restored.get().panelMotion, "reflow");
  assert.equal(restored.get().userMessageCollapse, "25");
  assert.equal(restored.get().chatSort, "created");
  assert.deepEqual(restored.get().voicePreferences, { shortcut: "Ctrl+Shift+D", activation: "toggle", autoSend: true, captureProfile: "processed" });
  await fs.rm(root, { recursive: true, force: true });
});
