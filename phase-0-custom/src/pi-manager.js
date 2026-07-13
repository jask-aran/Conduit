import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import readline from "node:readline";
import crypto from "node:crypto";

export class PiManager extends EventEmitter {
  constructor({ command = "pi", spawnImpl = spawn } = {}) {
    super();
    this.command = command;
    this.spawnImpl = spawnImpl;
    this.processes = new Map();
  }

  create({ sessionFile } = {}) {
    const id = sessionFile
      ? crypto.createHash("sha256").update(sessionFile).digest("hex").slice(0, 24)
      : crypto.randomUUID().replaceAll("-", "").slice(0, 24);
    if (this.processes.has(id)) return this.processes.get(id);

    const args = ["--mode", "rpc"];
    if (sessionFile) args.push("--session", sessionFile);
    const child = this.spawnImpl(this.command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const record = { id, child, status: "starting", clients: new Set(), createdAt: new Date().toISOString() };
    this.processes.set(id, record);

    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => this.broadcast(record, line));
    child.stderr.on("data", (chunk) => this.broadcast(record, JSON.stringify({ type: "runtime_stderr", message: String(chunk) })));
    child.once("spawn", () => { record.status = "running"; this.emit("status", record); });
    child.once("error", (error) => { record.status = "failed"; this.broadcast(record, JSON.stringify({ type: "runtime_error", message: error.message })); });
    child.once("exit", (code, signal) => {
      record.status = "stopped";
      this.broadcast(record, JSON.stringify({ type: "runtime_exit", code, signal }));
      this.emit("status", record);
    });
    return record;
  }

  send(id, value) {
    const record = this.processes.get(id);
    if (!record || record.status === "stopped") throw new Error("Pi session process is not running");
    const line = typeof value === "string" ? value : JSON.stringify(value);
    record.child.stdin.write(`${line}\n`);
  }

  attach(id, socket) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    record.clients.add(socket);
    socket.once("close", () => record.clients.delete(socket));
  }

  broadcast(record, line) {
    for (const socket of record.clients) {
      if (socket.readyState === socket.OPEN) socket.send(line);
    }
  }

  stop(id) {
    const record = this.processes.get(id);
    if (!record || record.status === "stopped") return false;
    record.child.kill("SIGTERM");
    return true;
  }

  list() {
    return [...this.processes.values()].map(({ child, clients, ...record }) => ({ ...record, clientCount: clients.size }));
  }
}

