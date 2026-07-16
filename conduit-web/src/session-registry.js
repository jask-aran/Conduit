import fs from "node:fs/promises";
import path from "node:path";
import { parseSession, projectSessionView } from "./session-store.js";

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export class SessionRegistry {
  constructor(file) {
    this.file = path.resolve(file);
    this.sessions = [];
    this.writeQueue = Promise.resolve();
  }

  async initialize(projects) {
    const stored = await readJson(this.file, { version: 1, sessions: [] });
    this.sessions = Array.isArray(stored.sessions) ? stored.sessions : [];
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const files = new Map();

    for (const project of projects) {
      let entries = [];
      try { entries = await fs.readdir(project.sessionsDir, { withFileTypes: true }); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          const file = path.resolve(project.sessionsDir, entry.name);
          files.set(file, [...(files.get(file) || []), project]);
        }
      }
    }

    const reconciled = [];
    for (const item of this.sessions) {
      const file = path.resolve(item.file || "");
      const project = projectById.get(item.projectId);
      if (project && files.has(file)) {
        reconciled.push({ ...item, file });
        files.delete(file);
      }
    }
    for (const [file, candidates] of files) {
      for (const project of candidates) {
        try {
          const session = await parseSession(file, project);
          if (path.resolve(session.cwd) === path.resolve(project.path)) {
            reconciled.push({ ...projectSessionView(session), file: session.file });
            break;
          }
        } catch {}
      }
    }
    this.sessions = reconciled;
    await this.flush();
  }

  list() {
    return [...this.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  listProject(projectId) {
    return this.list().filter((session) => session.projectId === projectId);
  }

  metadata(id) {
    return this.sessions.find((session) => session.id === id) || null;
  }

  async find(projects, id) {
    const metadata = String(id).includes(path.sep)
      ? this.sessions.find((session) => path.resolve(session.file) === path.resolve(id))
      : this.metadata(id);
    if (!metadata) return null;
    const project = projects.find((item) => item.id === metadata.projectId);
    if (!project) return null;
    try { return await parseSession(metadata.file, project); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async upsert(session) {
    const view = { ...projectSessionView(session), file: session.file };
    const index = this.sessions.findIndex((item) => item.id === view.id);
    if (index >= 0) this.sessions[index] = view;
    else this.sessions.push(view);
    await this.flush();
    return view;
  }

  async syncFile(file, project) {
    const session = await parseSession(file, project);
    if (path.resolve(session.cwd) !== path.resolve(project.path)) return null;
    return this.upsert(session);
  }

  async remove(id) {
    this.sessions = this.sessions.filter((session) => session.id !== id);
    await this.flush();
  }

  async removeProject(projectId) {
    this.sessions = this.sessions.filter((session) => session.projectId !== projectId);
    await this.flush();
  }

  flush() {
    const value = `${JSON.stringify({ version: 1, sessions: this.sessions }, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await fs.writeFile(temporary, value, "utf8");
      await fs.rename(temporary, this.file);
    });
    return this.writeQueue;
  }
}
