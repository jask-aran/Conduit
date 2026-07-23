import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readSessionMetadata, validateSessionFile } from "./session-store.js";
import { ensureChatTree } from "./owned-paths.js";

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
  constructor(file, { now = () => Date.now(), defaultRuntime = null } = {}) {
    this.file = path.resolve(file);
    this.now = now;
    this.chats = [];
    this.visibleDrafts = new Set();
    this.writeQueue = Promise.resolve();
    this.defaultRuntime = defaultRuntime || {
      kind: "conduit_profile",
      installationId: "conduit-pinned",
      binaryVersion: null,
      profileId: null,
      profileVersion: null,
    };
  }

  runtimeFor(item, templateId = null, templateVersion = null) {
    const stored = item?.runtime;
    if (stored?.kind === "native_pi") {
      return {
        kind: "native_pi",
        installationId: "host-pi",
        binaryVersion: stored.binaryVersion || null,
        profileId: null,
        profileVersion: null,
      };
    }
    return {
      kind: "conduit_profile",
      installationId: stored?.installationId || this.defaultRuntime.installationId,
      binaryVersion: stored?.binaryVersion || this.defaultRuntime.binaryVersion || null,
      profileId: stored?.profileId || templateId || this.defaultRuntime.profileId || null,
      profileVersion: stored?.profileVersion || templateVersion || this.defaultRuntime.profileVersion || null,
    };
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
      const nativeRuntime = item.runtime?.kind === "native_pi";
      const active = legacyRegistry
        ? item.status === "active" || item.status === "persisted" || Boolean(item.file)
        : item.status === "active";
      if (active && (!piSessionFile || !await fileExists(piSessionFile)) && !nativeRuntime) continue;
      if (piSessionFile && await fileExists(piSessionFile)) {
        try { await readSessionMetadata(piSessionFile, project); }
        catch { if (!nativeRuntime) continue; }
      }
      if (!active && piSessionFile && !await fileExists(piSessionFile)) piSessionFile = null;
      const createdAt = item.createdAt || new Date(this.now()).toISOString();
      const chat = {
        id,
        projectId: project.id,
        status: active ? "active" : "draft",
        title: String(item.title || "New chat"),
        templateId: typeof item.templateId === "string" && item.templateId.trim() ? item.templateId.trim() : null,
        templateVersion: typeof item.templateVersion === "string" && item.templateVersion.trim()
          ? item.templateVersion.trim()
          : null,
        runtime: this.runtimeFor(item, item.templateId, item.templateVersion),
        piSessionId: item.piSessionId || item.nativeId || (active ? item.id : null),
        piSessionFile,
        createdAt,
        updatedAt: item.updatedAt || createdAt,
      };
      let hasAttachments = false;
      try {
        await this.ensureDirectories(project, id);
        hasAttachments = await this.hasAttachments(project, id);
        await this.removePartials(project, id);
      } catch (error) {
        if (project.origin !== "linked" || !["ENOENT", "unsafe_conduit_path"].includes(error.code)) throw error;
      }
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
          const session = await readSessionMetadata(file, project);
          const id = isChatId(session.id) && !usedIds.has(session.id) ? session.id : crypto.randomUUID();
          const chat = {
            id,
            projectId: project.id,
            status: "active",
            title: session.title,
            templateId: null,
            templateVersion: null,
            runtime: this.runtimeFor(null),
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
    return (await ensureChatTree(project, chatId)).root;
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
      // Creation order is stable: rename/title edits bump mtime/updatedAt and must not reshuffle the sidebar.
      .sort((a, b) => {
        const byCreated = String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
        return byCreated || String(b.id || "").localeCompare(String(a.id || ""));
      });
  }

  listProject(projectId, options) {
    return this.list(options).filter((chat) => chat.projectId === projectId);
  }

  metadata(id) {
    return this.chats.find((chat) => chat.id === id) || null;
  }

  /** Stamp default profile identity when a chat is missing one. */
  async ensureTemplate(chatId, { templateId, templateVersion } = {}) {
    const chat = this.metadata(chatId);
    if (!chat) return null;
    if (chat.templateId) return chat;
    if (!templateId) return chat;
    chat.templateId = String(templateId).trim();
    chat.templateVersion = templateVersion ? String(templateVersion).trim() : chat.templateVersion;
    if (chat.runtime?.kind === "conduit_profile") {
      chat.runtime.profileId = chat.templateId;
      chat.runtime.profileVersion = chat.templateVersion;
    }
    chat.updatedAt = new Date(this.now()).toISOString();
    await this.flush();
    return chat;
  }

  async find(projects, id) {
    const chat = this.metadata(id);
    if (!chat?.piSessionFile) return null;
    const project = projects.find((item) => item.id === chat.projectId);
    if (!project) return null;
    try { return { ...(await validateSessionFile(chat.piSessionFile, project)), chatId: chat.id }; }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async create(project, { templateId = null, templateVersion = null, runtime = null } = {}) {
    const timestamp = new Date(this.now()).toISOString();
    const chat = {
      id: crypto.randomUUID(),
      projectId: project.id,
      status: "draft",
      title: "New chat",
      templateId: typeof templateId === "string" && templateId.trim() ? templateId.trim() : null,
      templateVersion: typeof templateVersion === "string" && templateVersion.trim()
        ? templateVersion.trim()
        : null,
      runtime: this.runtimeFor({ runtime }, templateId, templateVersion),
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
        session = await validateSessionFile(file, project);
      } catch (error) {
        if (["session_cwd_mismatch", "invalid_session_mapping"].includes(error.code)) return null;
        if (error.code !== "ENOENT" || Date.now() >= deadline) throw error;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    await this.commitSession(chatId, session);
    return session;
  }

  async update(chatId, patch) {
    const chat = this.metadata(chatId);
    if (!chat) return null;
    const allowed = [
      "projectId",
      "title",
      "templateId",
      "templateVersion",
      "runtime",
      "piSessionId",
      "piSessionFile",
      "updatedAt",
    ];
    for (const key of allowed) if (Object.hasOwn(patch, key)) chat[key] = patch[key];
    if (chat.runtime?.kind === "conduit_profile" && (Object.hasOwn(patch, "templateId") || Object.hasOwn(patch, "templateVersion"))) {
      chat.runtime.profileId = chat.templateId;
      chat.runtime.profileVersion = chat.templateVersion;
    }
    if (chat.runtime) chat.runtime = this.runtimeFor(chat, chat.templateId, chat.templateVersion);
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
      if (error.code === "EXDEV") {
        const temporary = `${target}.partial-${crypto.randomUUID()}`;
        await fs.cp(source, temporary, { recursive: true, errorOnExist: true, dereference: false });
        try {
          await fs.rename(temporary, target);
          await fs.rm(source, { recursive: true, force: true });
        } catch (moveError) {
          await fs.rm(temporary, { recursive: true, force: true }).catch(() => {});
          throw moveError;
        }
      } else if (error.code === "ENOENT") await this.ensureDirectories(targetProject, chatId);
      else throw error;
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
    const value = `${JSON.stringify({ version: 3, chats: this.chats }, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await fs.writeFile(temporary, value, "utf8");
      await fs.rename(temporary, this.file);
    });
    return this.writeQueue;
  }
}
