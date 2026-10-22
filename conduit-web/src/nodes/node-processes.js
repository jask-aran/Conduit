import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import os from "node:os";
import nodePty from "node-pty";

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
 */
export class NodeProcesses {
  constructor({ shellEnv = process.env } = {}) {
    this.shellEnv = shellEnv;
    this.processes = new Map();
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
    if (pty) {
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
    record.timer = setTimeout(() => this.processes.delete(record.id), KEEP_EXITED_MS);
    record.timer.unref?.();
  }

  /** Follow a process from byte `from`: what the buffer still has is replayed, then live output. */
  attach(id, from, listener) {
    const record = this.processes.get(id);
    if (!record) throw new Error("No such process on this device");
    const skipped = Math.max(0, record.start - from);
    for (const chunk of record.chunks) {
      const until = chunk.offset + chunk.bytes.length;
      if (until <= from) continue;
      const bytes = chunk.offset < from ? chunk.bytes.subarray(from - chunk.offset) : chunk.bytes;
      listener({ kind: "data", stream: chunk.stream, offset: Math.max(chunk.offset, from), bytes });
    }
    if (record.exit) listener({ kind: "exit", ...record.exit, end: record.end });
    else record.listeners.add(listener);
    return { ...this.view(record), skipped, detach: () => record.listeners.delete(listener) };
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

  stopAll() { for (const record of this.processes.values()) this.kill(record.id); }
}

/** The device user's own shell, as a terminal would open it. */
function defaultShell() {
  if (process.platform === "win32") return [process.env.COMSPEC || "powershell.exe"];
  return [process.env.SHELL || os.userInfo().shell || "/bin/sh", "-l"];
}
