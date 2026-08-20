import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import nodePty from "node-pty";
import { TerminalState } from "./terminal-state.js";

export const PTY_MAX_SESSIONS = 8;
export const PTY_SCROLLBACK_BYTES = 256 * 1024;
export const PTY_MAX_REPLAY_EVENTS = 4096;

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

class ReplayBuffer {
  constructor(limit) {
    this.limit = limit;
    this.events = [];
    this.length = 0;
    this.complete = true;
  }

  appendData(value) {
    const bytes = Buffer.from(value);
    if (!this.complete) return bytes;
    if (this.length + bytes.length > this.limit || this.events.length >= PTY_MAX_REPLAY_EVENTS) {
      // A tail is not a terminal snapshot. Once any prefix is lost, discard the
      // journal rather than retaining bytes that may begin inside UTF-8/CSI/OSC
      // state or omit an earlier alternate-screen/palette transition.
      this.complete = false;
      this.events = [];
      this.length = 0;
      return bytes;
    }
    this.events.push({ type: "data", bytes });
    this.length += bytes.length;
    return bytes;
  }

  appendResize(cols, rows) {
    if (!this.complete) return;
    const previous = this.events.at(-1);
    if (previous?.type === "resize" && previous.cols === cols && previous.rows === rows) return;
    if (this.events.length >= PTY_MAX_REPLAY_EVENTS) {
      this.complete = false;
      this.events = [];
      this.length = 0;
      return;
    }
    this.events.push({ type: "resize", cols, rows });
  }

  snapshot() {
    if (!this.complete) return Buffer.alloc(0);
    const chunks = this.events.filter((event) => event.type === "data").map((event) => event.bytes);
    return Buffer.concat(chunks, this.length);
  }

  replay() {
    const events = this.complete
      ? this.events.map((event) => event.type === "data" ? { type: "data", bytes: Buffer.from(event.bytes) } : { ...event })
      : [];
    return { complete: this.complete, events };
  }
}

function latestPerProject(items) {
  const latest = new Map();
  for (const item of items) {
    if (!item?.id || !item.projectId || !TEMPLATES[item.templateId]) continue;
    const previous = latest.get(item.projectId);
    const previousAt = String(previous?.updatedAt || previous?.createdAt || "");
    const itemAt = String(item.updatedAt || item.createdAt || "");
    if (!previous || itemAt >= previousAt) latest.set(item.projectId, item);
  }
  return [...latest.values()];
}

function nextTerminalTitle(records, projectId, baseTitle) {
  const used = new Set(records
    .filter((item) => item.projectId === projectId && item.status === "running")
    .map((item) => item.title));
  let title = baseTitle;
  let suffix = 2;
  while (used.has(title)) {
    title = `${baseTitle} ${suffix}`;
    suffix += 1;
  }
  return title;
}

export class PtyManager extends EventEmitter {
  constructor({
    filePath,
    maxSessions = PTY_MAX_SESSIONS,
    scrollbackBytes = PTY_SCROLLBACK_BYTES,
    pty = nodePty,
    stateFactory = (options) => new TerminalState(options),
  }) {
    super();
    this.filePath = filePath;
    this.maxSessions = maxSessions;
    this.scrollbackBytes = scrollbackBytes;
    this.pty = pty;
    this.stateFactory = stateFactory;
    this.records = new Map();
    this.handles = new Map();
    this.states = new Map();
    this.sequences = new Map();
    this.protocolResponders = new Map();
    this.scrollback = new Map();
    this.queue = Promise.resolve();
  }

  async load() {
    let persisted = { version: 1, sessions: [] };
    try { persisted = JSON.parse(await fs.readFile(this.filePath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    for (const item of latestPerProject(Array.isArray(persisted.sessions) ? persisted.sessions : [])) {
      this.records.set(item.id, {
        ...item,
        status: "exited",
        exitCode: null,
        signal: "server_restart",
        updatedAt: new Date().toISOString(),
      });
    }
    await this.persist();
    return this.list();
  }

  list() { return [...this.records.values()].map(view).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id) { const record = this.records.get(id); return record ? view(record) : null; }
  output(id) { return this.scrollback.get(id)?.snapshot() || Buffer.alloc(0); }
  replay(id) {
    const sequence = this.sequences.get(id) || 0;
    const buffer = this.scrollback.get(id);
    if (!buffer) return { complete: false, events: [], sequence };
    return { ...buffer.replay(), sequence };
  }

  async stateReplay(id) {
    const state = this.states.get(id);
    if (!state || state.isValid?.() === false) return this.replay(id);
    // Capture the mutation sequence and enqueue the state cut in one synchronous
    // turn. Later output/resizes get a higher sequence and are delivered as
    // post-snapshot deltas by terminal-stream.
    const sequence = this.sequences.get(id) || 0;
    const snapshot = await state.snapshot();
    const events = [{ type: "resize", cols: snapshot.cols, rows: snapshot.rows }];
    if (snapshot.data) events.push({ type: "data", bytes: Buffer.from(snapshot.data, "utf8") });
    return { complete: true, source: "state", sequence, events };
  }

  async create({ project, cwd, templateId = "shell", cols = 80, rows = 24 }) {
    const template = TEMPLATES[templateId];
    if (!template) throw failure("pty_template_not_allowed", "That terminal template is not available");
    if (!project?.id) throw failure("pty_project_required", "A terminal must belong to a project");
    if (!cwd || !path.isAbsolute(cwd)) throw failure("pty_cwd_required", "Terminal working directory is unavailable");
    let cwdStat;
    try { cwdStat = await fs.stat(cwd); }
    catch (error) {
      if (error.code === "ENOENT") throw failure("pty_cwd_unavailable", "Terminal working directory does not exist on this server");
      throw error;
    }
    if (!cwdStat.isDirectory()) throw failure("pty_cwd_unavailable", "Terminal working directory is not a directory");
    if (this.handles.size >= this.maxSessions) throw failure("pty_capacity_reached", "The terminal session limit has been reached");

    // Exited rows are diagnostic only. Once a new terminal is created in this
    // project, discard old dead rows while leaving every running sibling alive.
    for (const item of [...this.records.values()]) {
      if (item.projectId !== project.id || item.status === "running") continue;
      this.records.delete(item.id);
      this.scrollback.delete(item.id);
      this.states.get(item.id)?.dispose();
      this.states.delete(item.id);
      this.sequences.delete(item.id);
      this.protocolResponders.delete(item.id);
    }

    const width = Math.max(1, Math.min(500, Math.trunc(Number(cols)) || 80));
    const height = Math.max(1, Math.min(500, Math.trunc(Number(rows)) || 24));
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const title = nextTerminalTitle([...this.records.values()], project.id, template.title);
    const record = { id, projectId: project.id, templateId, title, status: "running", createdAt: now, updatedAt: now, exitCode: null, signal: null };
    const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
    delete env.NO_COLOR;
    let handle;
    const state = this.stateFactory({
      cols: width,
      rows: height,
      onData: (data) => {
        if (this.protocolResponders.get(id) === false) return;
        this.handles.get(id)?.write(data);
      },
      onBackpressure: (paused) => {
        const active = this.handles.get(id);
        if (!active) return;
        if (paused) active.pause?.();
        else active.resume?.();
      },
      onInvalid: (error) => this.emit("state_error", { id, error }),
    });
    try {
      handle = this.pty.spawn(template.command, template.args, { name: "xterm-256color", cols: width, rows: height, cwd, env });
    } catch (error) {
      state.dispose();
      throw error;
    }
    const replay = new ReplayBuffer(this.scrollbackBytes);
    replay.appendResize(width, height);
    this.records.set(id, record);
    this.handles.set(id, handle);
    this.states.set(id, state);
    this.sequences.set(id, 0);
    this.protocolResponders.set(id, true);
    this.scrollback.set(id, replay);
    handle.onData((data) => {
      const sequence = (this.sequences.get(id) || 0) + 1;
      this.sequences.set(id, sequence);
      void state.write(data);
      const bytes = this.scrollback.get(id)?.appendData(data);
      if (!bytes) return;
      this.emit("output", { id, bytes, sequence });
    });
    handle.onExit(({ exitCode, signal }) => {
      const current = this.records.get(id);
      if (!current) return;
      this.handles.delete(id);
      this.states.get(id)?.dispose();
      this.states.delete(id);
      this.sequences.delete(id);
      this.protocolResponders.delete(id);
      Object.assign(current, { status: "exited", exitCode: exitCode ?? null, signal: signal ?? null, updatedAt: new Date().toISOString() });
      this.emit("exit", view(current));
      this.scrollback.delete(id);
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

  setProtocolResponder(id, enabled) {
    if (!this.handles.has(id)) return false;
    this.protocolResponders.set(id, enabled === true);
    return true;
  }

  resize(id, cols, rows) {
    const handle = this.handles.get(id);
    const width = Math.trunc(Number(cols));
    const height = Math.trunc(Number(rows));
    if (!handle) throw failure("pty_not_running", "Terminal is not running");
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || width > 500 || height < 1 || height > 500) throw failure("pty_resize_invalid", "Terminal dimensions are out of range");
    const sequence = (this.sequences.get(id) || 0) + 1;
    this.sequences.set(id, sequence);
    void this.states.get(id)?.resize(width, height);
    handle.resize(width, height);
    this.scrollback.get(id)?.appendResize(width, height);
    this.emit("resize", { id, cols: width, rows: height, sequence });
  }

  async remove(id) {
    const record = this.records.get(id);
    if (!record) return false;
    const handle = this.handles.get(id);
    this.records.delete(id);
    this.handles.delete(id);
    this.scrollback.delete(id);
    this.states.get(id)?.dispose();
    this.states.delete(id);
    this.sequences.delete(id);
    this.protocolResponders.delete(id);
    handle?.kill();
    this.emit("removed", { id, projectId: record.projectId });
    await this.persist();
    return true;
  }

  async removeProject(projectId) {
    const matching = [...this.records.values()].filter((item) => item.projectId === projectId);
    if (!matching.length) return 0;
    for (const record of matching) {
      const handle = this.handles.get(record.id);
      this.records.delete(record.id);
      this.handles.delete(record.id);
      this.scrollback.delete(record.id);
      this.states.get(record.id)?.dispose();
      this.states.delete(record.id);
      this.sequences.delete(record.id);
      this.protocolResponders.delete(record.id);
      handle?.kill();
      this.emit("removed", { id: record.id, projectId });
    }
    await this.persist();
    return matching.length;
  }

  async stopAll() {
    for (const state of this.states.values()) state.dispose();
    this.states.clear();
    this.sequences.clear();
    this.protocolResponders.clear();
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
