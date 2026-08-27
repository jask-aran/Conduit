import assert from "node:assert/strict";
import test from "node:test";
import { normalizeTerminalShortcuts, readLegacyTerminalShortcuts } from "../src/client/remotes/terminal-shortcuts.ts";

test("terminal shortcuts keep only bounded valid commands", () => {
  const shortcuts = normalizeTerminalShortcuts([
    { id: "one", label: " List ", command: " ls -la ", target: "current" },
    { id: "two", label: "Herdr", command: "herdr", target: "new" },
    { id: "bad", label: "", command: "pwd", target: "current" },
    { id: "bad-target", label: "Bad", command: "pwd", target: "other" },
  ]);
  assert.deepEqual(shortcuts, [
    { id: "one", label: "List", command: "ls -la", target: "current" },
    { id: "two", label: "Herdr", command: "herdr", target: "new" },
  ]);
  assert.deepEqual(normalizeTerminalShortcuts({}), []);
  assert.deepEqual(readLegacyTerminalShortcuts({
    getItem: () => JSON.stringify([{ id: "two", label: "Herdr", command: "herdr", target: "new" }]),
  }), [{ id: "two", label: "Herdr", command: "herdr", target: "new" }]);
});
