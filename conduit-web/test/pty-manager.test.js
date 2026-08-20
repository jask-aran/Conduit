import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PTY_MAX_INPUT_BYTES, PtyManager } from "../src/pty-manager.js";

function fakePty() {
  const handles = [];
  return {
    handles,
    spawn(command, args, options) {
      let data;
      let exit;
      let exited = false;
      const handle = {
        command,
        args,
        options,
        onData: (fn) => { data = fn; },
        onExit: (fn) => { exit = fn; },
        kill: () => {
          if (exited) return;
          exited = true;
          exit?.({ exitCode: 0, signal: "SIGTERM" });
        },
        emit: (value) => data?.(value),
        write: (value) => { handle.input = (handle.input || "") + value; },
        resize: (cols, rows) => { handle.size = { cols, rows }; },
      };
      handles.push(handle);
      return handle;
    },
  };
}

function fakeTmux() {
  const sessions = new Set();
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args: [...args] });
    if (args.length === 1 && args[0] === "-V") return { stdout: "tmux 3.3a\n", stderr: "" };
    const commandIndex = args.findIndex((value) => ["new-session", "list-sessions", "kill-session", "kill-server"].includes(value));
    const action = args[commandIndex];
    const tail = args.slice(commandIndex + 1);
    if (action === "new-session") {
      sessions.add(tail[tail.indexOf("-s") + 1]);
      return { stdout: "", stderr: "" };
    }
    if (action === "list-sessions") {
      if (!sessions.size) throw Object.assign(new Error("no server running"), { code: 1, stderr: "no server running" });
      return { stdout: [...sessions].join("\n") + "\n", stderr: "" };
    }
    if (action === "kill-session") {
      const name = tail[tail.indexOf("-t") + 1];
      if (!sessions.delete(name)) throw Object.assign(new Error("can't find session"), { code: 1, stderr: "can't find session" });
      return { stdout: "", stderr: "" };
    }
    if (action === "kill-server") {
      if (!sessions.size) throw Object.assign(new Error("no server running"), { code: 1, stderr: "no server running" });
      sessions.clear();
      return { stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected tmux command: ${args.join(" ")}`);
  };
  return { sessions, calls, run };
}

test("PTY manager uses a dedicated tmux server as session authority and disposable node-pty clients", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-pty-manager-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const pty = fakePty();
  const tmux = fakeTmux();
  const manager = new PtyManager({ filePath: path.join(root, "remotes.json"), pty, run: tmux.run });
  await manager.load();

  await assert.rejects(manager.create({ project: { id: "managed" } }), { code: "pty_cwd_required" });
  await assert.rejects(manager.create({ project: { id: "missing" }, cwd: path.join(root, "missing") }), { code: "pty_cwd_unavailable" });

  const record = await manager.create({ project: { id: "workspace" }, cwd: workspace, cols: 100, rows: 30 });
  const sibling = await manager.create({ project: { id: "workspace" }, cwd: workspace });
  assert.notEqual(sibling.id, record.id);
  assert.equal(sibling.title, "Shell 2");
  assert.equal(tmux.sessions.size, 2);
  assert.equal(pty.handles.length, 0, "detached tmux sessions must not retain a browser PTY attachment");

  const newSession = tmux.calls.find((call) => call.args.includes("new-session") && call.args.includes("100"));
  assert.ok(newSession);
  assert.ok(newSession.args.includes("-L"));
  assert.ok(newSession.args.includes(manager.tmuxSocketName));
  assert.ok(newSession.args.includes("-f"));
  assert.ok(newSession.args.includes(manager.tmuxConfigPath));
  assert.ok(newSession.args.includes(workspace));

  const attachment = await manager.attach(record.id, { cols: 120, rows: 40 });
  assert.equal(pty.handles.length, 1);
  assert.equal(pty.handles[0].command, "tmux");
  assert.ok(pty.handles[0].args.includes("attach-session"));
  assert.equal(pty.handles[0].options.cols, 120);
  assert.equal(pty.handles[0].options.rows, 40);
  assert.equal(pty.handles[0].options.env.TERM, "xterm-256color");
  assert.equal(pty.handles[0].options.env.COLORTERM, "truecolor");
  assert.equal(Object.hasOwn(pty.handles[0].options.env, "TMUX"), false);
  assert.equal(Object.hasOwn(pty.handles[0].options.env, "NO_COLOR"), false);

  let output = "";
  attachment.onData((value) => { output += value; });
  pty.handles[0].emit("advanced-tui-output");
  assert.equal(output, "advanced-tui-output");
  attachment.write(Buffer.from("ls\n"));
  assert.equal(pty.handles[0].input, "ls\n");
  attachment.resize(132, 44);
  assert.deepEqual(pty.handles[0].size, { cols: 132, rows: 44 });
  assert.throws(() => attachment.write(Buffer.alloc(PTY_MAX_INPUT_BYTES + 1)), { code: "pty_input_too_large" });

  attachment.kill();
  assert.equal(manager.get(record.id)?.status, "running", "detaching the browser client must not kill the tmux session");
  assert.equal((await manager.rename(record.id, "Agent shell")).title, "Agent shell");
  assert.equal(await manager.remove(sibling.id), true);
  assert.equal(tmux.sessions.size, 1);

  tmux.sessions.clear();
  await manager.reconcile();
  assert.equal(manager.get(record.id)?.status, "exited");
  assert.equal(manager.get(record.id)?.signal, "tmux_session_ended");

  const replacement = await manager.create({ project: { id: "workspace" }, cwd: workspace });
  assert.notEqual(replacement.id, record.id);
  assert.equal(manager.get(record.id), null);
  assert.equal(await manager.removeProject("workspace"), 1);
  assert.equal(manager.list().length, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("PTY manager compacts persisted rows and treats Conduit restart as a terminal-session boundary", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-pty-load-"));
  const filePath = path.join(root, "remotes.json");
  await fs.writeFile(filePath, JSON.stringify({
    version: 2,
    sessions: [
      { id: "old", projectId: "project-a", templateId: "shell", title: "Old", status: "running", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", tmuxSession: "c_old" },
      { id: "new", projectId: "project-a", templateId: "shell", title: "New", status: "running", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", tmuxSession: "c_new" },
      { id: "other", projectId: "project-b", templateId: "shell", title: "Other", status: "running", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", tmuxSession: "c_other" },
    ],
  }));
  const pty = fakePty();
  const tmux = fakeTmux();
  tmux.sessions.add("stale-from-crashed-server");
  const manager = new PtyManager({ filePath, pty, run: tmux.run });
  await manager.load();
  assert.equal(tmux.sessions.size, 0, "load should kill a stale dedicated Conduit tmux server");
  assert.deepEqual(manager.list().map((item) => item.id).sort(), ["new", "other"]);
  assert.equal(manager.get("new").status, "exited");
  assert.equal(manager.get("new").signal, "server_restart");
  const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(persisted.version, 2);
  assert.equal(persisted.sessions.length, 2);
  await fs.rm(root, { recursive: true, force: true });
});
