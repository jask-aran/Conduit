import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PTY_REPLAY_PREFIX, PtyManager } from "../src/pty-manager.js";

function fakePty() {
  const handles = [];
  return {
    handles,
    spawn(command, args, options) {
      let data;
      let exit;
      const handle = {
        command,
        args,
        options,
        onData: (fn) => { data = fn; },
        onExit: (fn) => { exit = fn; },
        kill: () => exit?.({ exitCode: 0, signal: "SIGTERM" }),
        emit: (value) => data?.(value),
        write: (value) => { handle.input = value; },
        resize: (cols, rows) => { handle.size = { cols, rows }; },
      };
      handles.push(handle);
      return handle;
    },
  };
}

function replayView(manager, id) {
  const replay = manager.replay(id);
  return { complete: replay.complete, events: replay.events };
}

test("PTY manager starts a terminal only with a server-resolved absolute working directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-pty-manager-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const pty = fakePty();
  const manager = new PtyManager({ filePath: path.join(root, "remotes.json"), scrollbackBytes: 4, pty });
  await manager.load();
  await assert.rejects(manager.create({ project: { id: "managed" } }), { code: "pty_cwd_required" });
  await assert.rejects(manager.create({ project: { id: "missing" }, cwd: path.join(root, "missing") }), { code: "pty_cwd_unavailable" });
  const record = await manager.create({ project: { id: "workspace" }, cwd: workspace });
  const duplicate = await manager.create({ project: { id: "workspace" }, cwd: workspace });
  assert.equal(duplicate.id, record.id);
  assert.equal(pty.handles.length, 1);
  assert.equal(pty.handles[0].options.env.TERM, "xterm-256color");
  assert.equal(pty.handles[0].options.env.COLORTERM, "truecolor");
  assert.equal(Object.hasOwn(pty.handles[0].options.env, "NO_COLOR"), false);

  pty.handles[0].emit("ab");
  assert.deepEqual(replayView(manager, record.id), {
    complete: true,
    events: [
      { type: "resize", cols: 80, rows: 24 },
      { type: "data", bytes: Buffer.from("ab") },
    ],
  });
  assert.equal(manager.replay(record.id).bytes.toString().startsWith(PTY_REPLAY_PREFIX), true);

  manager.resize(record.id, 120, 40);
  pty.handles[0].emit("cd");
  assert.deepEqual(replayView(manager, record.id), {
    complete: true,
    events: [
      { type: "resize", cols: 80, rows: 24 },
      { type: "data", bytes: Buffer.from("ab") },
      { type: "resize", cols: 120, rows: 40 },
      { type: "data", bytes: Buffer.from("cd") },
    ],
  });
  assert.equal(manager.output(record.id).toString(), "abcd");

  pty.handles[0].emit("e");
  assert.deepEqual(replayView(manager, record.id), { complete: false, events: [] });
  assert.equal(manager.replay(record.id).bytes.length, 0);
  assert.equal(manager.output(record.id).length, 0);
  manager.input(record.id, Buffer.from("ls\n"));
  assert.equal(pty.handles[0].input, "ls\n");
  assert.deepEqual(pty.handles[0].size, { cols: 120, rows: 40 });
  assert.equal((await manager.rename(record.id, "Build shell")).title, "Build shell");
  pty.handles[0].kill();
  assert.equal(manager.get(record.id)?.status, "exited");
  assert.deepEqual(replayView(manager, record.id), { complete: false, events: [] });
  assert.equal(manager.replay(record.id).bytes.length, 0);
  const persisted = JSON.parse(await fs.readFile(path.join(root, "remotes.json"), "utf8"));
  assert.equal(persisted.sessions[0].title, "Build shell");

  const replacement = await manager.create({ project: { id: "workspace" }, cwd: workspace, cols: 132, rows: 44 });
  assert.notEqual(replacement.id, record.id);
  assert.equal(manager.get(record.id), null);
  assert.equal(pty.handles.at(-1).options.cols, 132);
  assert.equal(pty.handles.at(-1).options.rows, 44);
  assert.equal(await manager.removeProject("workspace"), 1);
  assert.equal(manager.get(replacement.id), null);
  assert.equal(manager.list().length, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("PTY manager compacts persisted exited rows to the newest terminal per Project", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-pty-load-"));
  const filePath = path.join(root, "remotes.json");
  await fs.writeFile(filePath, JSON.stringify({
    version: 1,
    sessions: [
      { id: "old", projectId: "project-a", templateId: "shell", title: "Old", status: "running", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "new", projectId: "project-a", templateId: "shell", title: "New", status: "running", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "other", projectId: "project-b", templateId: "shell", title: "Other", status: "running", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z" },
    ],
  }));
  const manager = new PtyManager({ filePath, pty: fakePty() });
  await manager.load();
  assert.deepEqual(manager.list().map((item) => item.id).sort(), ["new", "other"]);
  assert.equal(manager.get("new").status, "exited");
  assert.equal(manager.get("new").signal, "server_restart");
  const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(persisted.sessions.length, 2);
  await fs.rm(root, { recursive: true, force: true });
});

test("PTY replay journal bounds resize history", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-pty-resize-replay-"));
  const pty = fakePty();
  const manager = new PtyManager({ filePath: path.join(root, "remotes.json"), pty });
  await manager.load();
  const record = await manager.create({ project: { id: "resize-project" }, cwd: root });
  for (let index = 0; index < 5000; index += 1) manager.resize(record.id, index % 2 ? 80 : 81, 24);
  assert.deepEqual(manager.replay(record.id), { complete: false, events: [], bytes: Buffer.alloc(0) });
  await fs.rm(root, { recursive: true, force: true });
});
