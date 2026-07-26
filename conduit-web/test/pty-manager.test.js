import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PtyManager } from "../src/pty-manager.js";

function fakePty() {
  const handles = [];
  return {
    handles,
    spawn(command, args, options) {
      let data;
      let exit;
      const handle = { command, args, options, onData: (fn) => { data = fn; }, onExit: (fn) => { exit = fn; }, kill: () => exit?.({ exitCode: 0, signal: "SIGTERM" }), emit: (value) => data?.(value), write: (value) => { handle.input = value; }, resize: (cols, rows) => { handle.size = { cols, rows }; } };
      handles.push(handle);
      return handle;
    },
  };
}

test("PTY manager permits only linked Workspaces and persists bounded terminal metadata", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-pty-manager-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const pty = fakePty();
  const manager = new PtyManager({ filePath: path.join(root, "remotes.json"), workspaceAllowlist: [root], scrollbackBytes: 4, pty });
  await manager.load();
  await assert.rejects(manager.create({ project: { id: "managed", origin: "managed", kind: "project", path: workspace } }), { code: "pty_workspace_required" });
  const record = await manager.create({ project: { id: "workspace", origin: "linked", kind: "workspace", path: workspace } });
  assert.equal(pty.handles[0].options.env.TERM, "xterm-256color");
  assert.equal(pty.handles[0].options.env.COLORTERM, "truecolor");
  assert.equal(Object.hasOwn(pty.handles[0].options.env, "NO_COLOR"), false);
  pty.handles[0].emit("ab");
  pty.handles[0].emit("cdef");
  assert.equal(manager.output(record.id).toString(), "cdef");
  manager.input(record.id, Buffer.from("ls\n"));
  manager.resize(record.id, 120, 40);
  assert.equal(pty.handles[0].input, "ls\n");
  assert.deepEqual(pty.handles[0].size, { cols: 120, rows: 40 });
  assert.equal((await manager.rename(record.id, "Build shell")).title, "Build shell");
  pty.handles[0].kill();
  assert.equal(manager.get(record.id)?.status, "exited");
  const persisted = JSON.parse(await fs.readFile(path.join(root, "remotes.json"), "utf8"));
  assert.equal(persisted.sessions[0].title, "Build shell");
  await fs.rm(root, { recursive: true, force: true });
});
