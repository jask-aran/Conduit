import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import nodePty from "node-pty";
import { resolveExistingDirectory } from "./workspace-paths.js";

export const PTY_MAX_SESSIONS = 8;
export const PTY_SCROLLBACK_BYTES = 256 * 1024;

const TEMPLATES = {
  shell: {
    title: "Shell",
    command: process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "sh",
    args: process.platform === "win32" ? [] : ["-l"],
  },
};

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

function view(record) {
  return {
    id: record.id,
    projectId: record.projectId,
    templateId: record.templateId,
    title: record.title,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    exitCode: record.exitCode ?? null,
    signal: record.signal ?? null,
  };
}

class ScrollbackBuffer {
  constructor(limit) {
    this.limit = limit;
    this.chunks = [];
    this.length = 0;
  }

  append(value) {
    const chunk = Buffer.from(value);
    this.chunks.push(chunk);
    this.length += chunk.length;
    while (this.length > this.limit && this.chunks.length) {
      const first = this.chunks[0];
      const excess = this.length - this.limit;
      if (first.length <= excess) {
        this.chunks.shift();
        this.length -= first.length;
      } else {
        this.chunks[0] = first.subarray(excess);
        this.length -= excess;
      }
    }
    return chunk;
  }

  snapshot() {
    return Buffer.concat(this.chunks, this.length);
  }
}

export class PtyManager extends EventEmitter {
  constructor({ filePath, workspaceAllowlist, maxSessions = PTY_MAX_SESSIONS, scrollbackBytes = PTY_SCROLLBACK_BYTES, pty = nodePty }) {
    super();
    this.filePath = filePath;
    this.workspaceAllowlist = workspaceAllowlist;
    this.maxSessions = maxSessions;
    this.scrollbackBytes = scrollbackBytes;
    this.pty = pty;
    this.records = new Map();
    this.handles = new Map();
    this.scrollback = new Map();
    this.queue = Promise.resolve();
  }

  async load() {
    let persisted = { version: 1, sessions: [] };
    try { persisted = JSON.parse(await fs.readFile(this.filePath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const item of Array.isArray(persisted.sessions) ? persisted.sessions : []) {
      if (!item?.id || !item.projectId || !TEMPLATES[item.templateId]) continue;
      this.records.set(item.id, { ...item, status: "exited", exitCode: null, signal: "server_restart", updatedAt: new Date().toISOString() });
    }
    await this.persist();
    return this.list();
  }

  list() { return [...this.records.values()].map(view).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id) { const record = this.records.get(id); return record ? view(record) : null; }
  output(id) { return this.scrollback.get(id)?.snapshot() || Buffer.alloc(0); }

  async create({ project, templateId = "shell", cols = 80, rows = 24 }) {
    const template = TEMPLATES[templateId];
    if (!template) throw failure("pty_template_not_allowed", "That terminal template is not available");
    if (!project || project.origin !== "linked" || project.kind !== "workspace") throw failure("pty_workspace_required", "Terminals require a linked Workspace");
    if (this.handles.size >= this.maxSessions) throw failure("pty_capacity_reached", "The terminal session limit has been reached");
    const cwd = await resolveExistingDirectory(project.path || project.externalPath, this.workspaceAllowlist);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const record = { id, projectId: project.id, templateId, title: template.title, status: "running", createdAt: now, updatedAt: now, exitCode: null, signal: null };
    const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
    delete env.NO_COLOR;
    const handle = this.pty.spawn(template.command, template.args, { name: "xterm-256color", cols: Math.max(1, Math.trunc(cols)), rows: Math.max(1, Math.trunc(rows)), cwd, env });
    this.records.set(id, record);
    this.handles.set(id, handle);
    this.scrollback.set(id, new ScrollbackBuffer(this.scrollbackBytes));
    handle.onData((data) => {
      const bytes = this.scrollback.get(id)?.append(data);
      if (!bytes) return;
      this.emit("output", { id, bytes });
    });
    handle.onExit(({ exitCode, signal }) => {
      const current = this.records.get(id);
      if (!current) return;
      this.handles.delete(id);
      Object.assign(current, { status: "exited", exitCode: exitCode ?? null, signal: signal ?? null, updatedAt: new Date().toISOString() });
      this.emit("exit", view(current));
      void this.persist();
    });
    await this.persist();
    return view(record);
  }

  async rename(id, title) {
    const record = this.records.get(id);
    const next = String(title || "").trim().slice(0, 100);
    if (!record) return null;
    if (!next) throw failure("pty_title_required", "Terminal title is required");
    record.title = next;
    record.updatedAt = new Date().toISOString();
    await this.persist();
    return view(record);
  }

  input(id, bytes) {
    const handle = this.handles.get(id);
    if (!handle) throw failure("pty_not_running", "Terminal is not running");
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 64 * 1024) throw failure("pty_input_invalid", "Terminal input must be a non-empty binary frame up to 64 KiB");
    handle.write(bytes.toString("utf8"));
  }

  resize(id, cols, rows) {
    const handle = this.handles.get(id);
    const width = Math.trunc(Number(cols));
    const height = Math.trunc(Number(rows));
    if (!handle) throw failure("pty_not_running", "Terminal is not running");
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || width > 500 || height < 1 || height > 500) throw failure("pty_resize_invalid", "Terminal dimensions are out of range");
    handle.resize(width, height);
  }

  async remove(id) {
    const handle = this.handles.get(id);
    if (handle) handle.kill();
    const existed = this.records.delete(id);
    this.handles.delete(id);
    this.scrollback.delete(id);
    if (existed) await this.persist();
    return existed;
  }

  async stopAll() {
    for (const handle of this.handles.values()) handle.kill();
    this.handles.clear();
  }

  async persist() {
    const work = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify({ version: 1, sessions: this.list() }, null, 2)}\n`, "utf8");
      await fs.rename(temp, this.filePath);
    });
    this.queue = work.then(() => {}, () => {});
    return work;
  }
}
