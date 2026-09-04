import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  stopTerminalSessions,
  terminalCleanupMessage,
  terminalRegistryFile,
  terminalSocketName,
} from "../../scripts/terminal-lifecycle.mjs";

const root = path.resolve(import.meta.dirname, "../..");

test("terminal lifecycle cleanup targets the registry-owned tmux server", async () => {
  const filePath = "/tmp/conduit-terminal-lifecycle/remotes.json";
  const calls = [];
  assert.equal(
    await stopTerminalSessions({
      filePath,
      tmuxPath: "/usr/bin/tmux",
      run: async (...args) => { calls.push(args); },
    }),
    true,
  );
  assert.deepEqual(calls[0][1], ["-L", terminalSocketName(filePath), "kill-server"]);
  assert.equal(terminalSocketName(filePath), terminalSocketName(path.resolve(filePath)));
});

test("terminal lifecycle cleanup tolerates an absent tmux server or executable", async () => {
  for (const error of [
    Object.assign(new Error("spawn tmux ENOENT"), { code: "ENOENT" }),
    Object.assign(new Error("missing socket"), { code: 1, stderr: "error connecting to /tmp/tmux-1000/conduit-test (No such file or directory)" }),
  ]) {
    assert.equal(await stopTerminalSessions({ run: async () => { throw error; } }), false);
  }
});

test("terminal lifecycle output distinguishes managed shutdown from leftover cleanup", () => {
  assert.equal(terminalCleanupMessage(true), "Stopped leftover Conduit terminal sessions.");
  assert.equal(terminalCleanupMessage(false), "Terminal cleanup found no leftover tmux server to stop.");
});

test("managed launchers clean terminal sessions after stopping Conduit", async () => {
  const shell = await fs.readFile(path.join(root, ".devcontainer/start-conduit.sh"), "utf8");
  const powershell = await fs.readFile(path.join(root, ".devcontainer/win-start-conduit.ps1"), "utf8");
  assert.match(shell, /node "\$ROOT\/scripts\/terminal-lifecycle\.mjs"/);
  assert.match(shell, /healthy Conduit server is running.+launcher does not manage it/);
  assert.doesNotMatch(shell, /restart\)\n\s+guard_component_mode\n\s+stop \|\| true/);
  assert.match(powershell, /scripts\\terminal-lifecycle\.mjs/);
  assert.match(powershell, /healthy Conduit server is running.+launcher does not manage it/);
});

test("terminal registry follows the durable data root and explicit override", () => {
  assert.equal(
    terminalRegistryFile({ CONDUIT_DATA_ROOT: "/srv/conduit" }),
    path.resolve("/srv/conduit/remotes.json"),
  );
  assert.equal(
    terminalRegistryFile({ CONDUIT_DATA_ROOT: "/ignored", CONDUIT_REMOTES_FILE: "/custom/remotes.json" }),
    path.resolve("/custom/remotes.json"),
  );
});
