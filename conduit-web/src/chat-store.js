import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureChatTree } from "./owned-paths.js";
import { harnessIdForImplementation, templateBackend } from "./chat-backend.js";
import { placeOf } from "./place.js";
import { writePrivateFile } from "./private-file.js";

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

export function isChatId(value) {
  return CHAT_ID.test(String(value || ""));
}

export function chatDirectory(project, chatId) {
  const root = project?.chatRoot || project?.workingRoot;
  if (!root || !isChatId(chatId)) throw new Error("Invalid chat path");
  return path.join(path.resolve(root), ".conduit", "chats", chatId);
}

const at = (value) => Date.parse(value || "") || 0;

const laterOf = (left, right) => (at(right) > at(left) ? right : left) || null;

// Unread is a comparison, not a stored flag, so a duplicate, late or missing event cannot leave it wrong.
const chatIsUnread = (chat) => chat?.status !== "subagent" && at(chat?.lastAssistantCompletedAt) > at(chat?.lastReadAt);

export function chatView(chat) {
  if (!chat) return null;
  const { backend, ...view } = chat;
  const { opaqueSession, ...identity } = backend;
  return {
    ...view,
    unread: chatIsUnread(chat),
    harnessId: harnessIdForImplementation(identity.implementation, identity.installationId),
    backend: identity,
    profileId: identity.profileId,
    profileRevision: identity.profileRevision,
  };
}

function modelThinkingLevelsFor(item) {
  if (!item?.modelThinkingLevels || typeof item.modelThinkingLevels !== "object" || Array.isArray(item.modelThinkingLevels)) return {};
  return Object.fromEntries(Object.entries(item.modelThinkingLevels)
    .filter(([spec, level]) => typeof spec === "string" && spec.trim() && typeof level === "string" && level.trim())
    .map(([spec, level]) => [spec.trim(), level.trim()]));
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
    const stored = await readJson(this.file, { version: 5, chats: [] });
    const rows = Array.isArray(stored.chats) ? stored.chats : [];
    const projectById = new Map(projects.map((project) => [project.id, project]));

    const reconciled = [];
    const usedIds = new Set();
    for (const item of rows) {
      // An untracked thread's chat lasts as long as the page that opened it.
      if (item.untracked) continue;
      const project = projectById.get(item.projectId);
      if (!project) continue;
      const id = isChatId(item.id) && !usedIds.has(item.id) ? item.id : crypto.randomUUID();
      const active = item.status === "active";
      const createdAt = item.createdAt || new Date(this.now()).toISOString();
      const chat = {
        id,
        projectId: project.id,
        status: item.status === "subagent" ? "subagent" : active ? "active" : "draft",
        title: String(item.title ?? "New chat"),
        templateId: typeof item.templateId === "string" && item.templateId.trim() ? item.templateId.trim() : null,
        templateVersion: typeof item.templateVersion === "string" && item.templateVersion.trim()
          ? item.templateVersion.trim()
          : null,
        backend: item.backend || templateBackend({ id: item.templateId || "assistant", version: item.templateVersion }),
        modelThinkingLevels: modelThinkingLevelsFor(item),
        // A row with no owner, or the old name "head", takes its workspace's.
        owner: typeof item.owner === "string" && item.owner && item.owner !== "head" ? item.owner : placeOf(project).device,
        createdAt,
        updatedAt: item.updatedAt || createdAt,
        lastUserMessageAt: item.lastUserMessageAt || null,
        lastAssistantCompletedAt: item.lastAssistantCompletedAt || null,
        lastMessageAt: item.lastMessageAt || null,
        lastReadAt: item.lastReadAt || null,
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
        await fs.rm(chatDirectory(project, id), { recursive: true, force: true });
        continue;
      }
      if (hasAttachments) this.visibleDrafts.add(id);
      usedIds.add(id);
      reconciled.push(chat);
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

  // `untracked` chats stand behind threads that are not in Conduit.
  list({ includeHidden = false, includeUntracked = includeHidden } = {}) {
    return [...this.chats]
      .filter((chat) => includeUntracked || !chat.untracked)
      .filter((chat) => includeHidden || chat.status === "active" || (chat.status !== "subagent" && this.visibleDrafts.has(chat.id)))
      // Creation order is stable: rename/title edits bump mtime/updatedAt and must not reshuffle the sidebar.
      .sort((a, b) => {
        const byCreated = String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
        return byCreated || String(b.id || "").localeCompare(String(a.id || ""));
      });
  }

  listProject(projectId, options) {
    return this.list(options).filter((chat) => chat.projectId === projectId && chat.status !== "subagent");
  }

  metadata(id) {
    return this.chats.find((chat) => chat.id === id) || null;
  }

  async create(project, { templateId = null, templateVersion = null, backend = null, untracked = false, run = false, subagent = null } = {}) {
    const timestamp = new Date(this.now()).toISOString();
    const selectedBackend = backend || templateBackend({ id: templateId || "assistant", version: templateVersion });
    const chat = {
      id: crypto.randomUUID(),
      projectId: project.id,
      status: subagent ? "subagent" : "draft",
      title: subagent?.title || "",
      templateId: typeof templateId === "string" && templateId.trim() ? templateId.trim() : null,
      templateVersion: typeof templateVersion === "string" && templateVersion.trim()
        ? templateVersion.trim()
        : null,
      backend: selectedBackend,
      modelThinkingLevels: {},
      // It stays when the device is away; a move is what changes it.
      owner: placeOf(project).device,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUserMessageAt: null,
      lastAssistantCompletedAt: null,
      lastMessageAt: null,
      lastReadAt: null,
      ...(untracked ? { untracked: true } : {}),
      ...(run ? { run } : {}),
    };
    await this.ensureDirectories(project, chat.id);
    this.chats.push(chat);
    await this.flush();
    return chat;
  }

  /** Reserve before any await: concurrent roster reads must share one child chat. */
  ensureSubagent(project, parent, { conversationId, id, title }) {
    const key = String(conversationId);
    const existing = this.chats.find((chat) => chat.status === "subagent"
      && chat.backend?.implementation === parent.backend.implementation && String(chat.backend?.opaqueSession) === key);
    if (existing) return Promise.resolve(existing);
    this.subagentChats ||= new Map();
    if (!this.subagentChats.has(key)) {
      const pending = this.create(project, { subagent: { title }, templateId: parent.templateId, backend: {
        ...parent.backend, opaqueSession: key, parentChatId: parent.id, subagentId: id,
      } });
      this.subagentChats.set(key, pending);
      void pending.finally(() => this.subagentChats.delete(key)).catch(() => {});
    }
    return this.subagentChats.get(key);
  }

  async fallbackTitle(chatId, title) {
    const chat = this.metadata(chatId);
    const name = String(title || "").trim();
    if (!chat || chat.title || !name || name === "New chat") return false;
    chat.title = name;
    await this.flush();
    return true;
  }

  async update(chatId, patch) {
    const chat = this.metadata(chatId);
    if (!chat) return null;
    const previousCompletedAt = chat.lastAssistantCompletedAt;
    const allowed = [
      "projectId",
      "title",
      "templateId",
      "templateVersion",
      "backend",
      "modelThinkingLevels",
      "owner",
      "updatedAt",
      "lastUserMessageAt",
      "lastAssistantCompletedAt",
      "lastMessageAt",
      "lastReadAt",
      "untracked",
    ];
    for (const key of allowed) if (Object.hasOwn(patch, key)) chat[key] = patch[key];
    // The read watermark's other half never regresses: a re-read of an older session file must not change unread.
    if (Object.hasOwn(patch, "lastAssistantCompletedAt")) {
      chat.lastAssistantCompletedAt = laterOf(previousCompletedAt, patch.lastAssistantCompletedAt);
    }
    chat.modelThinkingLevels = modelThinkingLevelsFor(chat);
    if (chat.status !== "subagent" && (patch.status === "draft" || patch.status === "active")) chat.status = patch.status;
    if (!patch.updatedAt) chat.updatedAt = new Date(this.now()).toISOString();
    await this.flush();
    return chat;
  }

  async markUserMessage(chatId) {
    const timestamp = new Date(this.now()).toISOString();
    const chat = await this.update(chatId, { lastUserMessageAt: timestamp, lastMessageAt: timestamp });
    // Replying is the strongest read signal there is.
    return chat ? this.markRead(chatId) : chat;
  }

  /**
   * `upTo` is a completion timestamp this server issued, never a browser clock, so a receipt that arrives late, twice
   * or from a second device can only re-assert ground already covered.
   */
  async markRead(chatId, upTo) {
    const chat = this.metadata(chatId);
    if (!chat) return null;
    const watermark = laterOf(chat.lastReadAt, upTo || chat.lastAssistantCompletedAt);
    if (at(watermark) <= at(chat.lastReadAt)) return chat;
    chat.lastReadAt = watermark;
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
    chat.owner = placeOf(targetProject).device;
    chat.updatedAt = new Date(this.now()).toISOString();
    for (const child of this.chats.filter((item) => item.backend?.parentChatId === chatId)) {
      await this.move(child.id, sourceProject, targetProject);
    }
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
    await this.remove(chatId, project);
    return true;
  }

  async removeProject(projectId) {
    this.chats = this.chats.filter((chat) => chat.projectId !== projectId);
    for (const id of [...this.visibleDrafts]) if (!this.metadata(id)) this.visibleDrafts.delete(id);
    await this.flush();
  }

  flush() {
    const value = `${JSON.stringify({ version: 5, chats: this.chats }, null, 2)}\n`;
    const write = () => writePrivateFile(this.file, value);
    // A failed write fails its own flush, not every one after it: the next
    // flush writes the whole registry again, so it repairs what this one lost.
    this.writeQueue = this.writeQueue.then(write, write);
    return this.writeQueue;
  }
}
