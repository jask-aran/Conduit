import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { buildPiEnvironment, buildPiResourceArgs } from "../../scripts/pi-runtime.mjs";

export function buildPiArgs({ sessionFile = null, model = "", thinkingLevel = "", models, template }) {
  const args = [
    "--mode", "rpc",
    ...buildPiResourceArgs(models ? { ...template, models } : template),
  ];
  if (sessionFile) args.push("--session", path.resolve(sessionFile));
  if (model.trim()) args.push("--model", model.trim());
  if (thinkingLevel.trim()) args.push("--thinking", thinkingLevel.trim());
  return args;
}

export class PiManager extends EventEmitter {
  constructor({ command = "pi", agentDir, template, spawnImpl = spawn } = {}) {
    super();
    if (!agentDir) throw new Error("PiManager requires an isolated agent directory");
    this.command = command;
    this.spawnImpl = spawnImpl;
    this.agentDir = agentDir;
    this.template = template;
    this.processes = new Map();
    this.bySessionFile = new Map();
  }

  create({ project, sessionFile = null, model = "", thinkingLevel = "", models }) {
    const resolvedFile = sessionFile ? path.resolve(sessionFile) : null;
    if (resolvedFile && this.bySessionFile.has(resolvedFile)) {
      const existingId = this.bySessionFile.get(resolvedFile);
      const existing = this.processes.get(existingId);
      if (existing && ["starting", "running"].includes(existing.status)) return existing;
      this.bySessionFile.delete(resolvedFile);
      this.processes.delete(existingId);
    }
    const id = resolvedFile
      ? crypto.createHash("sha256").update(resolvedFile).digest("hex").slice(0, 24)
      : crypto.randomUUID().replaceAll("-", "").slice(0, 24);

    const args = buildPiArgs({ sessionFile: resolvedFile, model, thinkingLevel, models, template: this.template });
    const child = this.spawnImpl(this.command, args, {
      cwd: project.path,
      stdio: ["pipe", "pipe", "pipe"],
      env: buildPiEnvironment(this.agentDir),
    });
    const record = {
      id,
      projectId: project.id,
      projectSlug: project.slug,
      cwd: project.path,
      sessionDir: project.sessionsDir,
      sessionFile: resolvedFile,
      model: model.trim() || null,
      thinkingLevel: thinkingLevel.trim() || null,
      template: { id: this.template.id, version: this.template.version },
      child,
      status: "starting",
      active: false,
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
        if (event.type === "agent_start") record.active = true;
        if (event.type === "agent_end") record.active = false;
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
    if (typeof value === "object" && value?.type === "prompt") {
      setTimeout(() => {
        if (record.status === "running") this.send(record.id, { type: "get_state" });
      }, 250);
    }
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

  async stopAndWait(id) {
    const record = this.processes.get(id);
    if (!record || !["starting", "running"].includes(record.status)) return false;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => record.child.kill("SIGKILL"), 3000);
      timeout.unref();
      record.child.once("exit", () => {
        clearTimeout(timeout);
        resolve(true);
      });
      record.child.kill("SIGTERM");
    });
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
