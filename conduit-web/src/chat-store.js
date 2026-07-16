import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseSession } from "./session-store.js";

const CHAT_ID = /^[a-zA-Z0-9_-]{8,128}$/;
const COMPLETED_ATTACHMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}--.+$/i;
const DAY = 24 * 60 * 60 * 1000;

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function fileExists(file) {
  try { return (await fs.stat(file)).isFile(); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export function isChatId(value) {
  return CHAT_ID.test(String(value || ""));
}

export function chatDirectory(project, chatId) {
  if (!project?.path || !isChatId(chatId)) throw new Error("Invalid chat path");
  return path.join(path.resolve(project.path), ".conduit", "chats", chatId);
}

export function chatView(chat) {
  if (!chat) return null;
  const { piSessionId, piSessionFile, ...view } = chat;
  return view;
}

export class ChatStore {
  constructor(file, { now = () => Date.now() } = {}) {
    this.file = path.resolve(file);
    this.now = now;
    this.chats = [];
    this.visibleDrafts = new Set();
    this.writeQueue = Promise.resolve();
  }

  async initialize(projects) {
    const stored = await readJson(this.file, { version: 2, sessions: [] });
    const legacyRegistry = !Array.isArray(stored.chats);
    const rows = Array.isArray(stored.chats) ? stored.chats : Array.isArray(stored.sessions) ? stored.sessions : [];
    const projectById = new Map(projects.map((project) => [project.id, project]));
    const discoveredFiles = new Map();

    for (const project of projects) {
      let entries = [];
      try { entries = await fs.readdir(project.sessionsDir, { withFileTypes: true }); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const file = path.resolve(project.sessionsDir, entry.name);
        discoveredFiles.set(file, [...(discoveredFiles.get(file) || []), project]);
      }
    }

    const reconciled = [];
    const usedIds = new Set();
    for (const item of rows) {
      const project = projectById.get(item.projectId);
      if (!project) continue;
      const id = isChatId(item.id) && !usedIds.has(item.id) ? item.id : crypto.randomUUID();
      let piSessionFile = item.piSessionFile || item.file ? path.resolve(item.piSessionFile || item.file) : null;
      const active = legacyRegistry
        ? item.status === "active" || item.status === "persisted" || Boolean(item.file)
        : item.status === "active";
      if (active && (!piSessionFile || !await fileExists(piSessionFile))) continue;
      if (!active && piSessionFile && !await fileExists(piSessionFile)) piSessionFile = null;
      const createdAt = item.createdAt || new Date(this.now()).toISOString();
      const chat = {
        id,
        projectId: project.id,
        status: active ? "active" : "draft",
        title: String(item.title || "New chat"),
        piSessionId: item.piSessionId || item.nativeId || (active ? item.id : null),
        piSessionFile,
        createdAt,
        updatedAt: item.updatedAt || createdAt,
      };
      await this.ensureDirectories(project, id);
      const hasAttachments = await this.hasAttachments(project, id);
      await this.removePartials(project, id);
      if (chat.status === "draft" && !hasAttachments && this.now() - Date.parse(chat.createdAt) > DAY) {
        if (piSessionFile) {
          discoveredFiles.delete(piSessionFile);
          await fs.rm(piSessionFile, { force: true });
        }
        await fs.rm(chatDirectory(project, id), { recursive: true, force: true });
        continue;
      }
      if (hasAttachments) this.visibleDrafts.add(id);
      if (piSessionFile) discoveredFiles.delete(piSessionFile);
      usedIds.add(id);
      reconciled.push(chat);
    }

    for (const [file, candidates] of discoveredFiles) {
      for (const project of candidates) {
        try {
          const session = await parseSession(file, project);
          if (path.resolve(session.cwd) !== path.resolve(project.path)) continue;
          const id = isChatId(session.id) && !usedIds.has(session.id) ? session.id : crypto.randomUUID();
          const chat = {
            id,
            projectId: project.id,
            status: "active",
            title: session.title,
            piSessionId: session.nativeId || session.id,
            piSessionFile: session.file,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          };
          await this.ensureDirectories(project, id);
          await this.removePartials(project, id);
          usedIds.add(id);
          reconciled.push(chat);
          break;
        } catch {}
      }
    }

    this.chats = reconciled;
    await this.flush();
  }

  async ensureDirectories(project, chatId) {
    const root = chatDirectory(project, chatId);
    await Promise.all([
      fs.mkdir(path.join(root, "attachments"), { recursive: true }),
      fs.mkdir(path.join(root, ".partial"), { recursive: true }),
    ]);
    return root;
  }

  async hasAttachments(project, chatId) {
    try {
      const entries = await fs.readdir(path.join(chatDirectory(project, chatId), "attachments"), { withFileTypes: true });
      return entries.some((entry) => entry.isFile() && COMPLETED_ATTACHMENT.test(entry.name));
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }

  async removePartials(project, chatId) {
    const directory = path.join(chatDirectory(project, chatId), ".partial");
    let entries = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".part"))
      .map((entry) => fs.rm(path.join(directory, entry.name), { force: true })));
  }

  list({ includeHidden = false } = {}) {
    return [...this.chats]
      .filter((chat) => includeHidden || chat.status === "active" || this.visibleDrafts.has(chat.id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  listProject(projectId, options) {
    return this.list(options).filter((chat) => chat.projectId === projectId);
  }

  metadata(id) {
    return this.chats.find((chat) => chat.id === id) || null;
  }

  async find(projects, id) {
    const chat = this.metadata(id);
    if (!chat?.piSessionFile) return null;
    const project = projects.find((item) => item.id === chat.projectId);
    if (!project) return null;
    try { return { ...(await parseSession(chat.piSessionFile, project)), chatId: chat.id }; }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async create(project) {
    const timestamp = new Date(this.now()).toISOString();
    const chat = {
      id: crypto.randomUUID(),
      projectId: project.id,
      status: "draft",
      title: "New chat",
      piSessionId: null,
      piSessionFile: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    await this.ensureDirectories(project, chat.id);
    this.chats.push(chat);
    await this.flush();
    return chat;
  }

  async commitSession(chatId, session) {
    const chat = this.metadata(chatId);
    if (!chat) return null;
    Object.assign(chat, {
      status: "active",
      title: session.title || chat.title,
      piSessionId: session.nativeId || session.id || chat.piSessionId,
      piSessionFile: path.resolve(session.file),
      updatedAt: session.updatedAt || new Date(this.now()).toISOString(),
    });
    await this.flush();
    return chat;
  }

  async syncFile(chatId, file, project, { waitForFileMs = 0 } = {}) {
    const deadline = Date.now() + waitForFileMs;
    let session;
    while (!session) {
      try {
        session = await parseSession(file, project);
      } catch (error) {
        if (error.code !== "ENOENT" || Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (path.resolve(session.cwd) !== path.resolve(project.path)) return null;
    await this.commitSession(chatId, session);
    return session;
  }

  async update(chatId, patch) {
    const chat = this.metadata(chatId);
    if (!chat) return null;
    const allowed = ["projectId", "title", "piSessionId", "piSessionFile", "updatedAt"];
    for (const key of allowed) if (Object.hasOwn(patch, key)) chat[key] = patch[key];
    if (patch.status === "draft" || patch.status === "active") chat.status = patch.status;
    if (chat.piSessionFile) chat.piSessionFile = path.resolve(chat.piSessionFile);
    if (!patch.updatedAt) chat.updatedAt = new Date(this.now()).toISOString();
    await this.flush();
    return chat;
  }

  markAttachments(chatId, hasAttachments) {
    if (hasAttachments) this.visibleDrafts.add(chatId);
    else this.visibleDrafts.delete(chatId);
  }

  async move(chatId, sourceProject, targetProject) {
    const chat = this.metadata(chatId);
    if (!chat) return null;
    const source = chatDirectory(sourceProject, chatId);
    const target = chatDirectory(targetProject, chatId);
    await fs.mkdir(path.dirname(target), { recursive: true });
    try { await fs.rename(source, target); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.ensureDirectories(targetProject, chatId);
    }
    chat.projectId = targetProject.id;
    chat.updatedAt = new Date(this.now()).toISOString();
    await this.flush();
    return chat;
  }

  async remove(chatId, project) {
    const existed = Boolean(this.metadata(chatId));
    this.chats = this.chats.filter((chat) => chat.id !== chatId);
    this.visibleDrafts.delete(chatId);
    if (project && isChatId(chatId)) await fs.rm(chatDirectory(project, chatId), { recursive: true, force: true });
    if (existed) await this.flush();
    return existed;
  }

  async removeEmptyDraft(chatId, project) {
    const chat = this.metadata(chatId);
    if (!chat || chat.status !== "draft" || await this.hasAttachments(project, chatId)) return false;
    if (chat.piSessionFile) await fs.rm(chat.piSessionFile, { force: true });
    await this.remove(chatId, project);
    return true;
  }

  async removeProject(projectId) {
    this.chats = this.chats.filter((chat) => chat.projectId !== projectId);
    for (const id of [...this.visibleDrafts]) if (!this.metadata(id)) this.visibleDrafts.delete(id);
    await this.flush();
  }

  flush() {
    const value = `${JSON.stringify({ version: 2, chats: this.chats }, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await fs.writeFile(temporary, value, "utf8");
      await fs.rename(temporary, this.file);
    });
    return this.writeQueue;
  }
}
