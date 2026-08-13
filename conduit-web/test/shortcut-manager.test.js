import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMAND_IDS, commandRegistry, getCommandDefinition,
} from "../src/client/commands/command-registry.ts";
import {
  browserShortcutConflicts, conduitShortcutConflicts,
  validateShortcutRegistry,
} from "../src/client/shortcuts/shortcut-conflicts.ts";
import {
  detectShortcutEnvironment, shortcutEnvironmentLabel,
} from "../src/client/shortcuts/shortcut-environment.ts";
import { ShortcutManager } from "../src/client/shortcuts/shortcut-manager.ts";
import {
  bindingIdentity, formatShortcutBinding, normalizeKeyboardEvent, normalizeStoredBinding,
  shortcutBinding, shortcutStroke,
} from "../src/client/shortcuts/shortcut-normalize.ts";
import {
  parseShortcutOverrides, readShortcutOverrides, SHORTCUT_PREFERENCES_STORAGE_KEY,
} from "../src/client/shortcuts/shortcut-preferences.ts";
import { paletteStableCommandIds } from "../src/client/commands/command-registry.ts";

const windowsChrome = { platform: "windows", browser: "chrome", displayMode: "browser-tab" };
const windowsFirefox = { platform: "windows", browser: "firefox", displayMode: "browser-tab" };
const macSafari = { platform: "macos", browser: "safari", displayMode: "browser-tab" };

function keyEvent(key, code, options = {}) {
  let prevented = false;
  let stopped = false;
  return {
    key,
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    isComposing: false,
    defaultPrevented: false,
    target: null,
    composedPath: () => [],
    preventDefault() { prevented = true; this.defaultPrevented = true; },
    stopPropagation() { stopped = true; },
    get prevented() { return prevented; },
    get stopped() { return stopped; },
    ...options,
  };
}

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key) ?? null; },
  };
}

test("normalizes physical keys separately from keyboard-layout display labels", () => {
  const nonUs = normalizeKeyboardEvent({ key: "å", code: "KeyA", ctrlKey: true }, windowsChrome);
  assert.deepEqual(nonUs, { code: "KeyA", key: "Å", modifiers: ["primary"] });
  assert.equal(bindingIdentity(shortcutBinding(nonUs)), "primary:KeyA");
  assert.equal(formatShortcutBinding(shortcutBinding(nonUs), windowsChrome), "Ctrl Å");

  const command = normalizeKeyboardEvent({ key: "k", code: "KeyK", metaKey: true }, macSafari);
  const control = normalizeKeyboardEvent({ key: "k", code: "KeyK", ctrlKey: true }, macSafari);
  assert.deepEqual(command?.modifiers, ["primary"]);
  assert.deepEqual(control?.modifiers, ["control"]);
  assert.equal(formatShortcutBinding(shortcutBinding(command), macSafari), "⌘ K");
});

test("detects browser, platform, and installed-app mode without claiming unsupported precision", () => {
  const chrome = detectShortcutEnvironment({
    platform: "Win32",
    userAgent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
  }, () => ({ matches: false }));
  assert.deepEqual(chrome, windowsChrome);
  assert.equal(shortcutEnvironmentLabel(chrome), "Chrome · Windows · Browser tab");

  const unknown = detectShortcutEnvironment({ platform: "Plan9", userAgent: "CustomShell/1" }, () => ({ matches: true }));
  assert.equal(unknown.browser, "unknown");
  assert.equal(unknown.platform, "unknown");
  assert.equal(unknown.displayMode, "standalone");
});

test("loads valid overrides, ignores invalid entries, and preserves unknown command IDs", () => {
  const knownBinding = shortcutBinding(shortcutStroke("KeyJ", "J", ["primary"]));
  const parsed = parseShortcutOverrides(JSON.stringify({
    version: 1,
    overrides: {
      [COMMAND_IDS.openCommandPalette]: [knownBinding],
      "future.plugin-command": [],
      broken: [{ strokes: [{ code: 42, key: "X", modifiers: [] }] }],
    },
  }));
  assert.equal(bindingIdentity(parsed[COMMAND_IDS.openCommandPalette][0]), "primary:KeyJ");
  assert.deepEqual(parsed["future.plugin-command"], []);
  assert.equal(Object.hasOwn(parsed, "broken"), false);

  const storage = memoryStorage({
    [SHORTCUT_PREFERENCES_STORAGE_KEY]: JSON.stringify({ version: 1, overrides: parsed }),
  });
  const manager = new ShortcutManager({ commands: commandRegistry, environment: windowsChrome, storage });
  manager.setOverride(COMMAND_IDS.toggleSidebar, [shortcutBinding(shortcutStroke("KeyY", "Y", ["primary"]))]);
  assert.equal(manager.formatEffectiveBinding(COMMAND_IDS.toggleSidebar), "Ctrl Y");
  const saved = readShortcutOverrides(storage);
  assert.deepEqual(saved["future.plugin-command"], []);
  assert.equal(bindingIdentity(saved[COMMAND_IDS.toggleSidebar][0]), "primary:KeyY");
});

test("classifies known browser conflicts and exact Conduit context conflicts", () => {
  const print = shortcutBinding(shortcutStroke("KeyP", "P", ["primary"]));
  const bookmarkAll = shortcutBinding(shortcutStroke("KeyD", "D", ["primary", "shift"]));
  assert.equal(browserShortcutConflicts(print, windowsChrome)[0]?.action, "Print");
  const printSequence = shortcutBinding(
    shortcutStroke("KeyP", "P", ["primary"]),
    shortcutStroke("KeyX", "X"),
  );
  assert.equal(browserShortcutConflicts(printSequence, windowsChrome)[0]?.action, "Print");
  assert.equal(browserShortcutConflicts(bookmarkAll, windowsChrome)[0]?.action, "Bookmark all tabs");
  assert.equal(browserShortcutConflicts(bookmarkAll, macSafari).length, 0);
  const spotlight = shortcutBinding(shortcutStroke("Space", "Space", ["primary"]));
  assert.equal(browserShortcutConflicts(spotlight, macSafari)[0]?.action, "Open Spotlight");
  assert.equal(browserShortcutConflicts(spotlight, windowsChrome).length, 0);
  const searchChats = getCommandDefinition(COMMAND_IDS.searchChats).defaultBindings[0];
  assert.equal(formatShortcutBinding(searchChats, windowsChrome), "Ctrl Shift K");
  assert.equal(browserShortcutConflicts(searchChats, windowsChrome).length, 0);
  assert.equal(browserShortcutConflicts(searchChats, windowsFirefox)[0]?.action, "Open Web Console");

  const candidate = shortcutBinding(shortcutStroke("KeyX", "X", ["primary"]));
  const commands = [{
    id: "one",
    label: "One",
    description: "",
    group: "commands",
    keywords: [],
    icon: "x",
    contexts: ["application"],
    defaultBindings: [candidate],
    configurable: true,
  }, {
    id: "two",
    label: "Two",
    description: "",
    group: "commands",
    keywords: [],
    icon: "x",
    contexts: ["application"],
    defaultBindings: [candidate],
    configurable: true,
  }, {
    id: "three",
    label: "Three",
    description: "",
    group: "commands",
    keywords: [],
    icon: "x",
    contexts: ["palette.root"],
    defaultBindings: [candidate],
    configurable: true,
  }];
  const conflicts = conduitShortcutConflicts({
    binding: candidate,
    commandId: "one",
    context: "application",
    commands,
  });
  assert.ok(conflicts.some((conflict) => conflict.kind === "conduit" && conflict.commandId === "two"));
  assert.ok(conflicts.some((conflict) => conflict.kind === "context-reuse" && conflict.commandId === "three"));
});

test("dispatches the highest active context and completes two-stroke sequences", () => {
  const manager = new ShortcutManager({
    commands: commandRegistry,
    environment: windowsChrome,
    storage: null,
    sequenceTimeoutMs: 60_000,
  });
  const ran = [];
  const releaseApplication = manager.activateContext("application");
  const releaseChat = manager.activateContext("chat-search.browse");
  manager.registerHandler(COMMAND_IDS.openCommandPalette, "application", () => ran.push("palette"));
  manager.registerHandler(COMMAND_IDS.renameHighlightedChat, "chat-search.browse", () => ran.push("rename"));

  const prefix = keyEvent("k", "KeyK", { ctrlKey: true });
  assert.equal(manager.handleKeydown(prefix), true);
  assert.equal(prefix.prevented, true);
  assert.deepEqual(manager.pendingSequence()?.commandIds, [
    COMMAND_IDS.renameHighlightedChat,
  ]);

  const completion = keyEvent("r", "KeyR");
  assert.equal(manager.handleKeydown(completion), true);
  assert.deepEqual(ran, ["rename"]);
  assert.equal(manager.pendingSequence(), null);

  releaseChat();
  const root = keyEvent("k", "KeyK", { ctrlKey: true });
  assert.equal(manager.handleKeydown(root), true);
  assert.deepEqual(ran, ["rename", "palette"]);
  releaseApplication();
});

test("clears an expired or unmatched sequence without consuming the second stroke", () => {
  let now = 10;
  const manager = new ShortcutManager({
    commands: commandRegistry,
    environment: windowsChrome,
    storage: null,
    sequenceTimeoutMs: 100,
    now: () => now,
  });
  const release = manager.activateContext("chat-search.browse");
  manager.registerHandler(COMMAND_IDS.renameHighlightedChat, "chat-search.browse", () => assert.fail("expired sequence ran"));

  assert.equal(manager.handleKeydown(keyEvent("k", "KeyK", { ctrlKey: true })), true);
  now = 111;
  const expired = keyEvent("r", "KeyR");
  assert.equal(manager.handleKeydown(expired), false);
  assert.equal(expired.prevented, false);

  now = 200;
  assert.equal(manager.handleKeydown(keyEvent("k", "KeyK", { ctrlKey: true })), true);
  const unmatched = keyEvent("x", "KeyX");
  assert.equal(manager.handleKeydown(unmatched), false);
  assert.equal(unmatched.prevented, false);
  manager.clearPendingSequence();
  release();
});

test("an exclusive recorder context blocks lower commands without consuming the recorder key", () => {
  const manager = new ShortcutManager({
    commands: commandRegistry,
    environment: windowsChrome,
    storage: null,
  });
  const ran = [];
  const releaseApplication = manager.activateContext("application");
  const releaseRecorder = manager.activateContext("shortcut-recorder", { exclusive: true });
  manager.registerHandler(COMMAND_IDS.openCommandPalette, "application", () => ran.push("palette"));

  const event = keyEvent("k", "KeyK", { ctrlKey: true });
  assert.equal(manager.isContextActive("shortcut-recorder"), true);
  assert.equal(manager.handleKeydown(event), false);
  assert.deepEqual(ran, []);
  assert.equal(event.prevented, false);

  releaseRecorder();
  assert.equal(manager.handleKeydown(keyEvent("k", "KeyK", { ctrlKey: true })), true);
  assert.deepEqual(ran, ["palette"]);
  releaseApplication();
});

test("registry IDs, palette projections, defaults, and contexts stay valid", () => {
  const ids = commandRegistry.map((command) => command.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(getCommandDefinition(COMMAND_IDS.searchChats).label, "Search chats…");
  assert.deepEqual(validateShortcutRegistry(commandRegistry), []);
  assert.ok(paletteStableCommandIds.length > 0);
  for (const commandId of paletteStableCommandIds) {
    assert.equal(getCommandDefinition(commandId).id, commandId);
  }
  for (const command of commandRegistry) {
    assert.ok(command.contexts.length > 0, command.id);
    for (const binding of command.defaultBindings) {
      assert.ok(binding.strokes.length === 1 || binding.strokes.length === 2, command.id);
      for (const strokeValue of binding.strokes) assert.ok(strokeValue.code, command.id);
      assert.deepEqual(normalizeStoredBinding(binding), binding, command.id);
      assert.ok(formatShortcutBinding(binding, windowsChrome), command.id);
    }
  }
});

test("preference parsing fails open for malformed or future documents", () => {
  assert.deepEqual(parseShortcutOverrides("{"), {});
  assert.deepEqual(parseShortcutOverrides(JSON.stringify({ version: 2, overrides: {
    "future.plugin-command": [],
  } })), {});
  assert.deepEqual(parseShortcutOverrides(JSON.stringify({ version: 1, overrides: [] })), {});
});
