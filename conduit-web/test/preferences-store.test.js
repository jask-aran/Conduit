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
  rendererControlsVisible: null,
  composerSurface: null,
  contextMetrics: null,
  meteorField: null,
  incremarkPacing: null,
  transcriptWidth: null,
  transcriptWideBlocks: null,
  codeBlockCollapse: null,
  codeBlockCollapseLines: null,
  codeBlockWidth: null,
  panelMotion: null,
  userMessageCollapse: null,
  chatSort: null,
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
    rendererControlsVisible: false,
    composerSurface: "static",
    contextMetrics: ["contextTokens", "sessionCost"],
    meteorField: false,
    incremarkPacing: "adaptive",
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
  assert.equal(restored.get().rendererControlsVisible, false);
  assert.equal(restored.get().transcriptWidth, "wide");
  assert.equal(restored.get().transcriptWideBlocks, "wider");
  assert.equal(restored.get().codeBlockCollapse, "all");
  assert.equal(restored.get().codeBlockCollapseLines, 25);
  assert.equal(restored.get().codeBlockWidth, "wide");
  assert.equal(restored.get().panelMotion, "reflow");
  assert.equal(restored.get().userMessageCollapse, "25");
  assert.equal(restored.get().chatSort, "created");
  assert.deepEqual(restored.get().voicePreferences, { shortcut: "Ctrl+Shift+D", activation: "toggle", autoSend: true, captureProfile: "processed" });
  assert.equal(validTerminalShortcuts(restored.get().terminalShortcuts), true);
  assert.equal(validTerminalShortcuts([{ id: "bad", label: "", command: "pwd", target: "current" }]), false);
  assert.equal(validSidebarPins(restored.get().sidebarPins), true);
  assert.equal(validSidebarPins(["chat:one", "chat:one"]), false);
  assert.equal(validSidebarPins(["unknown:one"]), false);
  assert.equal(validUiPreferencePatch({ sidebarChatLimit: 45, rendererControlsVisible: false, chatSort: "latest" }), true);
  assert.equal(validUiPreferencePatch({ chatSort: "created" }), true);
  assert.equal(validUiPreferencePatch({ chatSort: "updated" }), false);
  assert.equal(validUiPreferencePatch({ sidebarChatLimit: 4 }), false);
  assert.equal(validUiPreferencePatch({ voicePreferences: { shortcut: "Ctrl+D" } }), false);
  await fs.rm(root, { recursive: true, force: true });
});

test("reading-surface preferences round-trip and reject values outside their presets", () => {
  assert.equal(validUiPreferencePatch({ transcriptWidth: "wide" }), true);
  assert.equal(validUiPreferencePatch({ transcriptWidth: "widest" }), false);
  assert.equal(validUiPreferencePatch({ transcriptWideBlocks: "off" }), true);
  assert.equal(validUiPreferencePatch({ transcriptWideBlocks: "150%" }), false);
  assert.equal(validUiPreferencePatch({ codeBlockCollapse: "long" }), true);
  assert.equal(validUiPreferencePatch({ codeBlockCollapse: "sometimes" }), false);
  assert.equal(validUiPreferencePatch({ codeBlockCollapseLines: 25 }), true);
  // Free pixel/line values are refused on purpose: the surface is preset-only
  // so it stays correct across densities and window sizes.
  assert.equal(validUiPreferencePatch({ codeBlockCollapseLines: 17 }), false);
  assert.equal(validUiPreferencePatch({ codeBlockCollapseLines: "25" }), false);
  assert.equal(validUiPreferencePatch({ codeBlockWidth: "wide" }), true);
  assert.equal(validUiPreferencePatch({ codeBlockWidth: "full" }), false);
  assert.equal(validUiPreferencePatch({ panelMotion: "reflow" }), true);
  assert.equal(validUiPreferencePatch({ panelMotion: "freeze" }), false);
  assert.equal(validUiPreferencePatch({ userMessageCollapse: "15" }), true);
  assert.equal(validUiPreferencePatch({ userMessageCollapse: 15 }), false);
  assert.equal(validUiPreferencePatch({ userMessageCollapse: "12" }), false);
  assert.equal(validUiPreferencePatch({ transcriptWidth: null }), false);
});

test("normalizePreferences drops reading-surface values it does not recognise", () => {
  const normalized = normalizePreferences({
    transcriptWidth: "wide",
    transcriptWideBlocks: "nonsense",
    codeBlockCollapse: "all",
    codeBlockCollapseLines: 999,
  });
  assert.equal(normalized.transcriptWidth, "wide");
  assert.equal(normalized.transcriptWideBlocks, null);
  assert.equal(normalized.codeBlockCollapse, "all");
  assert.equal(normalized.codeBlockCollapseLines, null);
});
