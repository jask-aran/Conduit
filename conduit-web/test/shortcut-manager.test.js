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
import {
  globalAccelerator, globalShortcuts,
} from "../src/client/shortcuts/global-shortcuts.ts";
import { ShortcutManager } from "../src/client/shortcuts/shortcut-manager.ts";
import {
  bindingIdentity, formatShortcutBinding, normalizeKeyboardEvent, normalizeStoredBinding,
  shortcutBinding, shortcutStroke,
} from "../src/client/shortcuts/shortcut-normalize.ts";
import {
  parseShortcutOverrides, readShortcutOverrides, SHORTCUT_PREFERENCES_STORAGE_KEY,
} from "../src/client/shortcuts/shortcut-preferences.ts";
import { paletteStableCommandIds } from "../src/client/commands/command-registry.ts";
import { SHORTCUT_CONTEXT_PRIORITY, SHORTCUT_REGION_PARENTS } from "../src/client/shortcuts/shortcut-types.ts";

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

function keyEventForStroke(stroke, environment = windowsChrome) {
  const modifiers = new Set(stroke.modifiers);
  return keyEvent(stroke.key, stroke.code, {
    ctrlKey: modifiers.has("control") || (modifiers.has("primary") && environment.platform !== "macos"),
    metaKey: modifiers.has("primary") && environment.platform === "macos",
    altKey: modifiers.has("alt"),
    shiftKey: modifiers.has("shift"),
  });
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
  const modelSelector = getCommandDefinition(COMMAND_IDS.openModelSelector);
  const scopedLeader = getCommandDefinition(COMMAND_IDS.workspaceFiles).defaultBindings[0].strokes[0];
  assert.notEqual(bindingIdentity(modelSelector.defaultBindings[0]), bindingIdentity(shortcutBinding(scopedLeader)));
  assert.deepEqual(modelSelector.contexts, ["application", "model-selector"]);

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

test("every region is ranked before each region it sits inside, so the innermost wins", () => {
  const rank = (context) => SHORTCUT_CONTEXT_PRIORITY.indexOf(context);
  for (const [region, parents] of Object.entries(SHORTCUT_REGION_PARENTS)) {
    assert.ok(rank(region) >= 0, `${region} is ranked`);
    for (const parent of parents) assert.ok(rank(region) < rank(parent), `${region} before ${parent}`);
  }
});

test("focus in the composer resolves through composer, then chat, then application", () => {
  const probe = {
    id: "region-probe", label: "Probe", description: "", group: "commands", keywords: [], icon: "chat",
    contexts: ["application", "chat", "composer"], configurable: true,
    defaultBindings: [shortcutBinding(shortcutStroke("F9", "F9"))],
  };
  const manager = new ShortcutManager({ commands: [probe], environment: windowsChrome, storage: null });
  const ran = [];
  // The chain main.tsx activates for focus in a chat's composer, outermost first.
  const releases = ["application", "chat", "composer"].map((context) => manager.activateContext(context));
  for (const context of ["application", "chat", "composer"]) {
    manager.registerHandler(probe.id, context, () => ran.push(context));
  }
  const run = () => assert.equal(manager.handleKeydown(keyEvent("F9", "F9")), true);
  run();
  releases.pop()();
  run();
  releases.pop()();
  run();
  assert.deepEqual(ran, ["composer", "chat", "application"]);
  releases.pop()();
});

test("dispatches registry commands from their focused scopes", () => {
  const manager = new ShortcutManager({
    commands: commandRegistry,
    environment: windowsChrome,
    storage: null,
  });
  const ran = [];
  const releaseApplication = manager.activateContext("application");
  const scopedContexts = ["application", "chat", "composer", "workspace-panel"];
  const scopedCommands = commandRegistry.filter((command) => command.contexts.some((context) => scopedContexts.includes(context)));
  for (const command of scopedCommands) {
    for (const context of command.contexts.filter((value) => scopedContexts.includes(value))) {
      manager.registerHandler(command.id, context, () => ran.push(`${context}:${command.id}`));
    }
  }
  manager.registerHandler(COMMAND_IDS.openCommandPalette, "application", () => ran.push(`application:${COMMAND_IDS.openCommandPalette}`));
  manager.registerHandler(COMMAND_IDS.maximizeWorkspacePanel, "application", () => ran.push(`application:${COMMAND_IDS.maximizeWorkspacePanel}`));
  const runFromBinding = (commandId) => {
    const binding = getCommandDefinition(commandId).defaultBindings[0];
    for (const stroke of binding.strokes) assert.equal(manager.handleKeydown(keyEventForStroke(stroke)), true);
  };
  // The toggles and the numbered go-to chords reach their surface from
  // inside another region.
  const composerRelease = manager.activateContext("composer");
  runFromBinding(COMMAND_IDS.openCommandPalette);
  runFromBinding(COMMAND_IDS.maximizeWorkspacePanel);
  runFromBinding(COMMAND_IDS.toggleSidebar);
  runFromBinding(COMMAND_IDS.toggleWorkspacePanel);
  runFromBinding(COMMAND_IDS.focusSidebar);
  runFromBinding(COMMAND_IDS.focusMainPane);
  runFromBinding(COMMAND_IDS.focusWorkspacePanel);
  composerRelease();

  // The leader acts within a region: nothing that moves between them has a
  // leader key.
  for (const id of [COMMAND_IDS.focusComposer, COMMAND_IDS.focusSidebar, COMMAND_IDS.focusMainPane, COMMAND_IDS.focusWorkspacePanel, COMMAND_IDS.focusTranscript, COMMAND_IDS.toggleChatWorkspaceFocus]) {
    assert.ok(getCommandDefinition(id).defaultBindings.every((binding) => binding.strokes.length === 1), `${id} has no leader key`);
  }

  const workspaceRelease = manager.activateContext("workspace-panel");
  runFromBinding(COMMAND_IDS.workspaceFiles);
  runFromBinding(COMMAND_IDS.workspaceSourceControl);
  runFromBinding(COMMAND_IDS.workspaceArtifacts);
  runFromBinding(COMMAND_IDS.workspaceTerminal);
  runFromBinding(COMMAND_IDS.openCommandPalette);
  workspaceRelease();
  releaseApplication();

  assert.deepEqual(ran, [
    `application:${COMMAND_IDS.openCommandPalette}`,
    `application:${COMMAND_IDS.maximizeWorkspacePanel}`,
    `application:${COMMAND_IDS.toggleSidebar}`,
    `application:${COMMAND_IDS.toggleWorkspacePanel}`,
    `application:${COMMAND_IDS.focusSidebar}`,
    `application:${COMMAND_IDS.focusMainPane}`,
    `composer:${COMMAND_IDS.focusWorkspacePanel}`,
    `workspace-panel:${COMMAND_IDS.workspaceFiles}`,
    `workspace-panel:${COMMAND_IDS.workspaceSourceControl}`,
    `workspace-panel:${COMMAND_IDS.workspaceArtifacts}`,
    `workspace-panel:${COMMAND_IDS.workspaceTerminal}`,
    `application:${COMMAND_IDS.openCommandPalette}`,
  ]);
});

test("clears an unmatched sequence without consuming the second stroke", () => {
  const manager = new ShortcutManager({
    commands: commandRegistry,
    environment: windowsChrome,
    storage: null,
  });
  const release = manager.activateContext("chat-search.browse");
  manager.registerHandler(COMMAND_IDS.renameHighlightedChat, "chat-search.browse", () => assert.fail("unmatched sequence ran"));

  assert.equal(manager.handleKeydown(keyEvent("k", "KeyK", { ctrlKey: true })), true);
  const unmatched = keyEvent("x", "KeyX");
  assert.equal(manager.handleKeydown(unmatched), false);
  assert.equal(unmatched.prevented, false);
  assert.equal(manager.pendingSequence(), null);
  release();
});

test("keeps a leader sequence pending until a second action or pointer input", () => {
  const manager = new ShortcutManager({
    commands: commandRegistry,
    environment: windowsChrome,
    storage: null,
  });
  const listeners = new Map();
  const target = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  const uninstall = manager.install(target);
  const release = manager.activateContext("workspace-panel");
  manager.registerHandler(COMMAND_IDS.workspaceFiles, "workspace-panel", () => {});
  const leader = getCommandDefinition(COMMAND_IDS.workspaceFiles).defaultBindings[0].strokes[0];

  assert.equal(manager.handleKeydown(keyEventForStroke(leader)), true);
  assert.ok(manager.pendingSequence());
  listeners.get("pointerdown")();
  assert.equal(manager.pendingSequence(), null);

  uninstall();
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

test("the global scope offers the OS only chords it can hold", () => {
  // A bare key would be taken from every application at once, and the OS hands
  // over one chord, so neither is offered.
  assert.equal(globalAccelerator(shortcutBinding(shortcutStroke("KeyC", "C"))), null);
  assert.equal(globalAccelerator(shortcutBinding(
    shortcutStroke("KeyX", "X", ["primary"]), shortcutStroke("KeyC", "C"))), null);
  assert.equal(
    globalAccelerator(shortcutBinding(shortcutStroke("KeyC", "C", ["alt", "shift"]))),
    "Alt+Shift+KeyC");
  assert.equal(
    globalAccelerator(shortcutBinding(shortcutStroke("KeyK", "K", ["primary"]))),
    "CommandOrControl+KeyK");

  const shortcuts = globalShortcuts(commandRegistry, {});
  assert.deepEqual(shortcuts.map((shortcut) => shortcut.commandId).sort(),
    [COMMAND_IDS.newChatGlobally, COMMAND_IDS.revealWindow].sort());
  // An override is what the shell is told to hold; a rebinding the OS cannot
  // express drops out rather than being sent and refused.
  const rebound = globalShortcuts(commandRegistry, {
    [COMMAND_IDS.revealWindow]: [shortcutBinding(shortcutStroke("KeyJ", "J", ["primary", "shift"]))],
    [COMMAND_IDS.newChatGlobally]: [shortcutBinding(shortcutStroke("KeyN", "N"))],
  });
  assert.deepEqual(rebound, [{ accelerator: "CommandOrControl+Shift+KeyJ", commandId: COMMAND_IDS.revealWindow }]);
});
