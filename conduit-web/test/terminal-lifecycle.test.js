import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  stopTerminalSessions,
  terminalSocketName,
  terminalSocketPath,
} from "../../scripts/terminal-lifecycle.mjs";

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

test("terminal lifecycle cleanup drops the socket of a tmux server that stopped answering", async () => {
  const filePath = "/tmp/conduit-terminal-lifecycle/remotes.json";
  const tmuxTmpdir = await fs.mkdtemp("/tmp/conduit-tmux-");
  const previous = process.env.TMUX_TMPDIR;
  process.env.TMUX_TMPDIR = tmuxTmpdir;
  try {
    const socket = terminalSocketPath(terminalSocketName(filePath));
    await fs.mkdir(path.dirname(socket), { recursive: true });
    await fs.writeFile(socket, "");
    const wedged = Object.assign(new Error("Command failed"), { code: 1, stderr: "server exited unexpectedly\n" });
    assert.equal(await stopTerminalSessions({ filePath, run: async () => { throw wedged; } }), true);
    await assert.rejects(fs.stat(socket), { code: "ENOENT" });
  } finally {
    if (previous === undefined) delete process.env.TMUX_TMPDIR;
    else process.env.TMUX_TMPDIR = previous;
    await fs.rm(tmuxTmpdir, { recursive: true, force: true });
  }
});
