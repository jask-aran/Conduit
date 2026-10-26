import crypto from "node:crypto";
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodePty from "node-pty";
import { TMUX_CONFIG } from "../tmux-config.js";

const BUFFER_BYTES = 2 * 1024 * 1024;
const KEEP_EXITED_MS = 10 * 60_000;
const MAX_PROCESSES = 32;

/**
 * Processes this device runs for main: terminals, and later harnesses.
 *
 * A process belongs to the device, not to the socket that asked for it
 * (plan decision 18): when main's connection drops it keeps running, its
 * output is kept in a bounded buffer counted in bytes from its start, and
 * main reattaches from the last byte it had. Output older than the buffer is
 * gone; a reattach from before it says how much was skipped. An exited
 * process is kept a while so its last output and exit can still be read.
 *
 * `pty` gives a pseudo-terminal (node-pty, ConPTY on Windows); without it
 * the process has pipes, stdout and stderr told apart.
 *
 * A terminal shell, where tmux 3.3 or newer is installed (decision 28), is a
 * tmux session on this node's own socket, followed through a tmux client:
 * it outlives this node too, and a node starting again takes up the sessions
 * it finds, their screens repainted from the start. `scope` (the server
 * paired) keeps two servers' shells apart.
 */
export class NodeProcesses {
  constructor({ shellEnv = process.env, scope = "" } = {}) {
    this.shellEnv = shellEnv;
    this.processes = new Map();
    // Told of every exit, so one nothing follows (a terminal no client has open) is still said to main.
    this.onExit = null;
    this.tmux = findTmux(scope);
    if (this.tmux) this.recover();
  }

  spawn({ argv, shell = false, cwd, env = {}, pty = null }) {
    if ([...this.processes.values()].filter((item) => item.exit === null).length >= MAX_PROCESSES) {
      throw new Error(`This device already runs ${MAX_PROCESSES} processes for Conduit`);
    }
    const [command, ...args] = shell ? defaultShell() : argv;
    if (!command) throw new Error("Nothing to run");
    const id = `p_${crypto.randomUUID()}`;
    const record = { id, command, pty: Boolean(pty), cwd, startedAt: Date.now(), chunks: [], start: 0, end: 0,
      exit: null, listeners: new Set(), child: null, timer: null };
    const environment = { ...this.shellEnv, ...env, ...(pty ? { TERM: "xterm-256color" } : {}) };
    if (pty && shell && this.tmux) {
      record.tmux = id;
      execFileSync(this.tmux.file, [...this.tmux.args, "new-session", "-d", "-s", id, "-c", cwd,
        "-x", String(pty.cols || 80), "-y", String(pty.rows || 24), command, ...args], { env: tmuxEnvironment(environment), stdio: "ignore" });
      this.follow(record, pty);
    } else if (pty) {
      const child = nodePty.spawn(command, args, { name: "xterm-256color", cols: pty.cols || 80, rows: pty.rows || 24, cwd, env: environment });
      record.child = child;
      record.pid = child.pid;
      child.onData((text) => this.output(record, "out", Buffer.from(text, "utf8")));
      child.onExit(({ exitCode, signal }) => this.exited(record, exitCode, signal ? String(signal) : null));
    } else {
      const child = spawn(command, args, { cwd, env: environment, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      record.child = child;
      record.pid = child.pid;
      child.stdout.on("data", (chunk) => this.output(record, "out", chunk));
      child.stderr.on("data", (chunk) => this.output(record, "err", chunk));
      child.on("error", (error) => { this.output(record, "err", Buffer.from(`${error.message}\n`)); this.exited(record, 127, null); });
      child.on("close", (code, signal) => this.exited(record, code ?? 1, signal));
    }
    this.processes.set(id, record);
    return this.view(record);
  }

  /** A tmux client on the record's session: its screen is the terminal's output. */
  follow(record, { cols = 80, rows = 24 } = {}) {
    const child = nodePty.spawn(this.tmux.file, [...this.tmux.args, "attach-session", "-t", record.tmux],
      { name: "xterm-256color", cols, rows, cwd: os.homedir(), env: tmuxEnvironment(this.shellEnv) });
    record.child = child;
    record.pid = record.pid ?? child.pid;
    child.onData((text) => this.output(record, "out", Buffer.from(text, "utf8")));
    child.onExit(() => {
      if (record.child !== child || record.exit) return;
      // The client ending is not the shell ending: only a session gone is.
      if (!record.detached && this.hasSession(record.tmux)) {
        setTimeout(() => { if (!record.exit && record.child === child) this.follow(record, { cols: child.cols, rows: child.rows }); }, 500).unref?.();
        return;
      }
      if (!record.detached) this.exited(record, null, null);
    });
  }

  hasSession(name) {
    try { execFileSync(this.tmux.file, [...this.tmux.args, "has-session", "-t", name], { stdio: "ignore" }); return true; } catch { return false; }
  }

  /** The shells a node before this one left in tmux, followed again from their repainted screens. */
  recover() {
    let listed = "";
    try {
      listed = execFileSync(this.tmux.file, [...this.tmux.args, "list-sessions", "-F", "#{session_name}\t#{session_created}\t#{pane_current_path}"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch { return; }
    for (const line of listed.split("\n").filter(Boolean)) {
      const [id, created, cwd] = line.split("\t");
      if (!/^p_[0-9a-f-]+$/.test(id) || this.processes.has(id)) continue;
      const record = { id, command: defaultShell()[0], pty: true, cwd, startedAt: Number(created) * 1000 || Date.now(), chunks: [], start: 0, end: 0,
        exit: null, listeners: new Set(), child: null, timer: null, tmux: id };
      this.processes.set(id, record);
      this.follow(record);
    }
  }

  output(record, stream, bytes) {
    const chunk = { stream, offset: record.end, bytes };
    record.chunks.push(chunk);
    record.end += bytes.length;
    while (record.end - record.start > BUFFER_BYTES && record.chunks.length > 1) {
      const dropped = record.chunks.shift();
      record.start = dropped.offset + dropped.bytes.length;
    }
    for (const listener of record.listeners) listener({ kind: "data", ...chunk });
  }

  exited(record, code, signal) {
    if (record.exit) return;
    record.exit = { code, signal, at: Date.now() };
    for (const listener of record.listeners) listener({ kind: "exit", ...record.exit, end: record.end });
    this.onExit?.(this.view(record));
    record.timer = setTimeout(() => this.processes.delete(record.id), KEEP_EXITED_MS);
    record.timer.unref?.();
  }

  /** Follow a process from byte `from`: what the buffer still has is replayed, then live output. */
  attach(id, from, listener) {
    const record = this.processes.get(id);
    if (!record) throw new Error("No such process on this device");
    // Followed before this node started again (a shell it took up from tmux):
    // the caller's bytes are from the node before, so it starts over from `start`.
    if (from > record.end) return { ...this.view(record), start: record.start, behind: true, skipped: 0, detach: () => {} };
    const skipped = Math.max(0, record.start - from);
    for (const chunk of record.chunks) {
      const until = chunk.offset + chunk.bytes.length;
      if (until <= from) continue;
      const bytes = chunk.offset < from ? chunk.bytes.subarray(from - chunk.offset) : chunk.bytes;
      listener({ kind: "data", stream: chunk.stream, offset: Math.max(chunk.offset, from), bytes });
    }
    if (record.exit) listener({ kind: "exit", ...record.exit, end: record.end });
    else record.listeners.add(listener);
    return { ...this.view(record), start: record.start, skipped, detach: () => record.listeners.delete(listener) };
  }

  write(id, bytes) {
    const record = this.live(id);
    if (record.pty) record.child.write(bytes.toString("utf8"));
    else record.child.stdin.write(bytes);
  }

  closeInput(id) { const record = this.live(id); if (!record.pty) record.child.stdin.end(); }

  resize(id, cols, rows) { const record = this.live(id); if (record.pty) record.child.resize(Math.max(2, cols), Math.max(2, rows)); }

  kill(id, signal = "SIGTERM") {
    const record = this.processes.get(id);
    if (!record || record.exit) return;
    if (record.tmux) {
      execFile(this.tmux.file, [...this.tmux.args, "kill-session", "-t", record.tmux], () => {});
      return;
    }
    if (record.pty && process.platform === "win32") {
      // node-pty's own kill forks a helper to list the console's processes,
      // which dies with "AttachConsole failed" once the shell is going. Ending
      // the shell's tree closes the terminal as \`exit\` would; its kill is
      // only the fallback.
      execFile("taskkill", ["/PID", String(record.pid), "/T", "/F"], { windowsHide: true }, () => {
        setTimeout(() => { if (!record.exit) try { record.child.kill(); } catch {} }, 3000).unref?.();
      });
      return;
    }
    try { record.child.kill(record.pty ? undefined : signal); } catch {}
  }

  live(id) {
    const record = this.processes.get(id);
    if (!record) throw new Error("No such process on this device");
    if (record.exit) throw new Error("That process has exited");
    return record;
  }

  view(record) {
    return { id: record.id, pid: record.pid ?? null, command: record.command, pty: record.pty, cwd: record.cwd,
      startedAt: record.startedAt, end: record.end, exit: record.exit };
  }

  list() { return [...this.processes.values()].map((record) => this.view(record)); }

  get(id) { const record = this.processes.get(id); return record ? this.view(record) : null; }

  /** This node stopping: shells in tmux are let go of, to be taken up by the next; the rest end. */
  stopAll() {
    for (const record of this.processes.values()) {
      if (record.tmux && !record.exit) { record.detached = true; try { record.child?.kill(); } catch {} }
      else this.kill(record.id);
    }
  }
}

const TMUX_MIN = [3, 3];

/** This node's tmux, on a socket of its own per server paired, or null where there is none (Windows, or too old). */
function findTmux(scope) {
  if (process.platform === "win32") return null;
  const file = process.env.CONDUIT_TMUX_PATH || "tmux";
  try {
    const [major, minor] = (execFileSync(file, ["-V"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).match(/(\d+)\.(\d+)/) || []).slice(1).map(Number);
    if (!(major > TMUX_MIN[0] || (major === TMUX_MIN[0] && minor >= TMUX_MIN[1]))) return null;
  } catch { return null; }
  const home = process.env.CONDUIT_NODE_HOME || path.join(os.homedir(), ".conduit-node");
  const tag = crypto.createHash("sha256").update(`${home}\n${scope}`).digest("hex").slice(0, 12);
  const config = path.join(os.tmpdir(), `conduit-node-${tag}.tmux.conf`);
  fs.writeFileSync(config, TMUX_CONFIG, { mode: 0o600 });
  return { file, args: ["-L", `conduit-node-${tag}`, "-f", config] };
}

function tmuxEnvironment(source) {
  const env = { ...source, TERM: "xterm-256color", COLORTERM: "truecolor" };
  delete env.TMUX;
  delete env.TMUX_PANE;
  return env;
}

/** The device user's own shell, as a terminal would open it. */
function defaultShell() {
  if (process.platform === "win32") return [process.env.COMSPEC || "powershell.exe"];
  return [process.env.SHELL || os.userInfo().shell || "/bin/sh", "-l"];
}
