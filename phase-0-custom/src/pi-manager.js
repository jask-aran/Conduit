import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";

export class PiManager extends EventEmitter {
  constructor({ command = "pi", spawnImpl = spawn } = {}) {
    super();
    this.command = command;
    this.spawnImpl = spawnImpl;
    this.processes = new Map();
    this.bySessionFile = new Map();
  }

  create({ project, sessionFile = null, model = "" }) {
    const resolvedFile = sessionFile ? path.resolve(sessionFile) : null;
    if (resolvedFile && this.bySessionFile.has(resolvedFile)) {
      return this.processes.get(this.bySessionFile.get(resolvedFile));
    }
    const id = resolvedFile
      ? crypto.createHash("sha256").update(resolvedFile).digest("hex").slice(0, 24)
      : crypto.randomUUID().replaceAll("-", "").slice(0, 24);

    const args = ["--mode", "rpc", "--session-dir", project.sessionsDir];
    if (resolvedFile) args.push("--session", resolvedFile);
    if (model.trim()) args.push("--model", model.trim());
    const child = this.spawnImpl(this.command, args, {
      cwd: project.path,
      stdio: ["pipe", "pipe", "pipe"],
      env: process.env,
    });
    const record = {
      id,
      projectId: project.id,
      projectSlug: project.slug,
      cwd: project.path,
      sessionDir: project.sessionsDir,
      sessionFile: resolvedFile,
      model: model.trim() || null,
      child,
      status: "starting",
      clients: new Set(),
      events: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stdoutBuffer: "",
    };
    this.processes.set(id, record);
    if (resolvedFile) this.bySessionFile.set(resolvedFile, id);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this.handleStdout(record, chunk));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => this.publish(record, { type: "runtime_stderr", message: String(chunk) }));
    child.once("spawn", () => {
      record.status = "running";
      this.publishState(record);
      this.send(record.id, { type: "get_state" });
    });
    child.once("error", (error) => {
      record.status = "failed";
      this.publish(record, { type: "runtime_error", message: error.message });
      this.publishState(record);
    });
    child.once("exit", (code, signal) => {
      record.status = "stopped";
      this.publish(record, { type: "runtime_exit", code, signal });
      this.publishState(record);
    });
    return record;
  }

  handleStdout(record, chunk) {
    record.stdoutBuffer += chunk;
    const lines = record.stdoutBuffer.split("\n");
    record.stdoutBuffer = lines.pop() || "";
    for (const raw of lines) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const sessionFile = event.sessionFile || event.data?.sessionFile || event.result?.sessionFile;
        if (sessionFile && !record.sessionFile) {
          record.sessionFile = path.resolve(sessionFile);
          this.bySessionFile.set(record.sessionFile, record.id);
        }
        this.publish(record, event);
        if (event.type === "agent_end" && record.status === "running") {
          this.send(record.id, { type: "get_state" });
        }
      } catch {
        this.publish(record, { type: "runtime_stdout", message: line });
      }
    }
  }

  send(id, value) {
    const record = this.processes.get(id);
    if (!record || !["starting", "running"].includes(record.status)) throw new Error("Pi session process is not running");
    const line = typeof value === "string" ? value : JSON.stringify(value);
    record.child.stdin.write(`${line}\n`);
  }

  attach(id, socket) {
    const record = this.processes.get(id);
    if (!record) throw new Error("Unknown live session");
    record.clients.add(socket);
    socket.once("close", () => record.clients.delete(socket));
  }

  publish(record, event) {
    record.updatedAt = new Date().toISOString();
    record.events.push(event);
    if (record.events.length > 500) record.events.splice(0, record.events.length - 500);
    const payload = JSON.stringify(event);
    for (const socket of record.clients) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
    this.emit("event", { record, event });
  }

  publishState(record) {
    this.publish(record, { type: "runtime_state", session: this.view(record) });
  }

  stop(id) {
    const record = this.processes.get(id);
    if (!record || record.status === "stopped") return false;
    record.child.kill("SIGTERM");
    return true;
  }

  view(record) {
    const { child, clients, stdoutBuffer, events, ...safe } = record;
    return { ...safe, clientCount: clients.size };
  }

  list() {
    return [...this.processes.values()].map((record) => this.view(record));
  }

  get(id) {
    return this.processes.get(id) || null;
  }
}
