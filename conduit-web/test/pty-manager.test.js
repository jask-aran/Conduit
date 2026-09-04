import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cleanEnvironment, PTY_MAX_INPUT_BYTES, PtyManager } from "../src/pty-manager.js";

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
  const windowNames = new Map();
  const calls = [];
  const run = async (command, args) => {
    calls.push({ command, args: [...args] });
    if (args.length === 1 && args[0] === "-V") return { stdout: "tmux 3.3a\n", stderr: "" };
    const commandIndex = args.findIndex((value) => ["new-session", "list-panes", "rename-window", "kill-session", "kill-server"].includes(value));
    const action = args[commandIndex];
    const tail = args.slice(commandIndex + 1);
    if (action === "new-session") {
      const name = tail[tail.indexOf("-s") + 1];
      sessions.add(name);
      windowNames.set(name, tail[tail.indexOf("-n") + 1]);
      return { stdout: "", stderr: "" };
    }
    if (action === "list-panes") {
      if (!sessions.size) throw Object.assign(new Error("no server running"), { code: 1, stderr: "no server running" });
      const format = tail[tail.indexOf("-F") + 1];
      assert.equal(format, "#{session_name}__CONDUIT_FIELD__#{pane_current_command}__CONDUIT_FIELD__#{window_activity}__CONDUIT_FIELD__#{pane_dead}");
      assert.doesNotMatch(format, /[\u0000-\u001f]/, "tmux 3.5 sanitizes control characters in format strings");
      return { stdout: [...sessions].map((name) => `${name}__CONDUIT_FIELD__sh__CONDUIT_FIELD__1770000000__CONDUIT_FIELD__0`).join("\n") + "\n", stderr: "" };
    }
    if (action === "rename-window") {
      const target = tail[tail.indexOf("-t") + 1].replace(/:0$/, "");
      windowNames.set(target, tail.at(-1));
      return { stdout: "", stderr: "" };
    }
    if (action === "kill-session") {
      const name = tail[tail.indexOf("-t") + 1];
      if (!sessions.delete(name)) throw Object.assign(new Error("can't find session"), { code: 1, stderr: "can't find session" });
      windowNames.delete(name);
      return { stdout: "", stderr: "" };
    }
    if (action === "kill-server") {
      if (!sessions.size) throw Object.assign(new Error("no server running"), { code: 1, stderr: "no server running" });
      sessions.clear();
      windowNames.clear();
      return { stdout: "", stderr: "" };
    }
    throw new Error(`Unexpected tmux command: ${args.join(" ")}`);
  };
  return { sessions, windowNames, calls, run };
}

test("PTY environment removes parent terminal-manager context", () => {
  const env = cleanEnvironment({
    PATH: "/usr/bin",
    HERDR_ENV: "1",
    HERDR_PANE: "parent",
    TMUX: "parent",
    TMUX_PANE: "%1",
  });
  assert.deepEqual(env, { PATH: "/usr/bin", TERM: "xterm-256color", COLORTERM: "truecolor" });
});

test("PTY manager uses tmux as session authority with one browser lease per terminal", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-pty-manager-"));
  const workspace = path.join(root, "workspace");
  const filePath = path.join(root, "remotes.json");
  await fs.mkdir(workspace);
  const pty = fakePty();
  const tmux = fakeTmux();
  const manager = new PtyManager({ filePath, pty, run: tmux.run });
  await manager.load();

  await assert.rejects(manager.create({ project: { id: "managed" } }), { code: "pty_cwd_required" });
  await assert.rejects(manager.create({ project: { id: "missing" }, cwd: path.join(root, "missing") }), { code: "pty_cwd_unavailable" });

  const record = await manager.create({ project: { id: "workspace" }, cwd: workspace, cols: 100, rows: 30 });
  const sibling = await manager.create({ project: { id: "workspace" }, cwd: workspace });
  const named = await manager.create({ project: { id: "workspace" }, cwd: workspace, title: "Herdr" });
  assert.notEqual(sibling.id, record.id);
  assert.equal(sibling.title, "Shell 2");
  assert.equal(named.title, "Herdr");
  await assert.rejects(manager.create({ project: { id: "workspace" }, cwd: workspace, title: "" }), { code: "pty_title_invalid" });
  assert.equal(record.currentCommand, path.basename(process.env.SHELL || "/bin/sh"));
  assert.equal(tmux.sessions.size, 3);
  assert.equal(pty.handles.length, 0, "detached tmux sessions must not retain a browser PTY attachment");

  const newSession = tmux.calls.find((call) => call.args.includes("new-session") && call.args.includes("100"));
  assert.ok(newSession);
  assert.ok(newSession.args.includes("-L"));
  assert.ok(newSession.args.includes(manager.tmuxSocketName));
  assert.ok(newSession.args.includes("-f"));
  assert.ok(newSession.args.includes(manager.tmuxConfigPath));
  assert.ok(newSession.args.includes(workspace));
  assert.ok(newSession.args.includes("Shell"));
  assert.match(await fs.readFile(manager.tmuxConfigPath, "utf8"), /allow-passthrough off/);

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

  await assert.rejects(manager.attach(record.id), { code: "pty_in_use" });
  const siblingAttachment = await manager.attach(sibling.id);
  assert.equal(pty.handles.length, 2, "different terminal ids may stream concurrently");
  siblingAttachment.kill();

  let output = "";
  attachment.onData((value) => { output += value; });
  pty.handles[0].emit("advanced-tui-output");
  assert.equal(output, "advanced-tui-output");
  attachment.write(Buffer.from("ls\n"));
  assert.equal(pty.handles[0].input, "ls\n");
  const emoji = Buffer.from("🙂");
  attachment.write(emoji.subarray(0, 2));
  attachment.write(emoji.subarray(2));
  assert.equal(pty.handles[0].input, "ls\n🙂");
  attachment.resize(132, 44);
  assert.deepEqual(pty.handles[0].size, { cols: 132, rows: 44 });
  assert.throws(() => attachment.write(Buffer.alloc(PTY_MAX_INPUT_BYTES + 1)), { code: "pty_input_too_large" });

  attachment.kill();
  assert.equal(manager.get(record.id)?.status, "running", "detaching the browser client must not kill the tmux session");
  const reattached = await manager.attach(record.id);
  reattached.kill();
  assert.equal((await manager.rename(record.id, "Agent shell")).title, "Agent shell");
  assert.equal(tmux.windowNames.get([...tmux.sessions][0]), "Agent shell");
  assert.equal(await manager.remove(sibling.id), true);
  assert.equal(tmux.sessions.size, 2);

  const mode = (await fs.stat(filePath)).mode & 0o777;
  assert.equal(mode, 0o600, "terminal registry must be private to the Conduit OS user");
  assert.equal((await fs.readdir(root)).some((name) => name.startsWith("remotes.json.tmp-")), false);

  tmux.sessions.clear();
  await manager.reconcile();
  assert.equal(manager.get(record.id)?.status, "exited");
  assert.equal(manager.get(record.id)?.signal, "tmux_session_ended");

  const replacement = await manager.create({ project: { id: "workspace" }, cwd: workspace });
  assert.notEqual(replacement.id, record.id);
  assert.equal(manager.get(record.id)?.status, "exited");
  assert.equal(await manager.removeProject("workspace"), 3);
  assert.equal(manager.list().length, 0);
  await fs.rm(root, { recursive: true, force: true });
});

test("PTY manager serializes creation so concurrent requests cannot exceed capacity", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-pty-capacity-"));
  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const tmux = fakeTmux();
  const manager = new PtyManager({ filePath: path.join(root, "remotes.json"), pty: fakePty(), run: tmux.run, maxSessions: 1 });
  await manager.load();
  const results = await Promise.allSettled([
    manager.create({ project: { id: "workspace-a" }, cwd: workspace }),
    manager.create({ project: { id: "workspace-b" }, cwd: workspace }),
  ]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  const rejection = results.find((item) => item.status === "rejected");
  assert.equal(rejection?.reason?.code, "pty_capacity_reached");
  assert.equal(manager.list().filter((item) => item.status === "running").length, 1);
  assert.equal(await manager.stopAll(), 1);
  await fs.rm(root, { recursive: true, force: true });
});

test("PTY manager only tolerates known missing-session tmux failures", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-pty-errors-"));
  const missing = new PtyManager({
    filePath: path.join(root, "missing.json"),
    run: async () => { throw Object.assign(new Error("missing socket"), { code: 1, stderr: "error connecting to /tmp/tmux-1000/conduit-test (No such file or directory)" }); },
  });
  assert.equal(await missing.invokeTmux(["kill-server"], { tolerateMissingServer: true }), null);

  const unavailable = new PtyManager({
    filePath: path.join(root, "unavailable.json"),
    run: async () => { throw Object.assign(new Error("spawn tmux ENOENT"), { code: "ENOENT" }); },
  });
  await assert.rejects(unavailable.ensureTmux(), { code: "pty_tmux_unavailable" });

  const operational = new PtyManager({
    filePath: path.join(root, "operational.json"),
    run: async () => { throw Object.assign(new Error("permission denied"), { code: 1, stderr: "permission denied" }); },
  });
  await assert.rejects(operational.invokeTmux(["list-sessions"], { tolerateMissingServer: true }), /permission denied/);
  await fs.rm(root, { recursive: true, force: true });
});

test("PTY manager retains persisted rows and treats Conduit restart as a terminal-session boundary", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "conduit-pty-load-"));
  const filePath = path.join(root, "remotes.json");
  await fs.writeFile(filePath, JSON.stringify({
    version: 2,
    sessions: [
      { id: "old", projectId: "project-a", templateId: "shell", title: "Old", status: "running", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", tmuxSession: "c_old" },
      { id: "new", projectId: "project-a", templateId: "shell", title: "New", status: "running", createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z", tmuxSession: "c_new" },
      { id: "other", projectId: "project-b", templateId: "shell", title: "Other", status: "running", createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z", tmuxSession: "c_other" },
      { id: "exited", projectId: "project-a", templateId: "shell", title: "Exited", status: "exited", createdAt: "2025-12-31T00:00:00.000Z", updatedAt: "2026-01-01T12:00:00.000Z", exitCode: 7, signal: "tmux_session_ended", tmuxSession: "c_exited" },
    ],
  }));
  const pty = fakePty();
  const tmux = fakeTmux();
  tmux.sessions.add("stale-from-crashed-server");
  const manager = new PtyManager({ filePath, pty, run: tmux.run });
  await manager.load();
  assert.equal(tmux.sessions.size, 0, "load should kill a stale dedicated Conduit tmux server");
  assert.deepEqual(manager.list().map((item) => item.id).sort(), ["exited", "new", "old", "other"]);
  assert.equal(manager.get("exited").exitCode, 7);
  assert.equal(manager.get("exited").signal, "tmux_session_ended");
  assert.equal(manager.get("exited").updatedAt, "2026-01-01T12:00:00.000Z");
  assert.equal(manager.get("old").status, "exited");
  assert.equal(manager.get("old").signal, "server_restart");
  assert.equal(manager.get("new").status, "exited");
  assert.equal(manager.get("new").signal, "server_restart");
  const persisted = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(persisted.version, 2);
  assert.equal(persisted.sessions.length, 4);
  assert.equal((await fs.stat(filePath)).mode & 0o777, 0o600);

  const workspace = path.join(root, "workspace");
  await fs.mkdir(workspace);
  const replacement = await manager.create({ project: { id: "project-a" }, cwd: workspace });
  assert.deepEqual(
    manager.list().filter((item) => item.projectId === "project-a").map((item) => item.id).sort(),
    ["exited", "new", "old", replacement.id].sort(),
  );
  await fs.rm(root, { recursive: true, force: true });
});
