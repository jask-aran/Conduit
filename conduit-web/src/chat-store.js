import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readSessionMetadata, readSessionParentSession, validateSessionFile } from "./session-store.js";
import { ensureChatTree } from "./owned-paths.js";
import { harnessIdForImplementation, piBackendFor, withPiCompatibilityFields } from "./chat-backend.js";
import { conduitPiSessionFile } from "./backend-session.js";

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
  if (!project?.workingRoot || !isChatId(chatId)) throw new Error("Invalid chat path");
  return path.join(path.resolve(project.workingRoot), ".conduit", "chats", chatId);
}

const at = (value) => Date.parse(value || "") || 0;

/** The later of two timestamps; the completion clock only ever moves forward. */
export const laterOf = (left, right) => (at(right) > at(left) ? right : left) || null;

// Unread is a comparison, not a stored flag: has the assistant finished
// something since this chat was last read. Nothing has to transition it, so a
// duplicate, late or missing event cannot leave it wrong.
export const chatIsUnread = (chat) => at(chat?.lastAssistantCompletedAt) > at(chat?.lastReadAt);

export function chatView(chat) {
  if (!chat) return null;
  const { backend, ...view } = chat;
  const { opaqueSession, ...identity } = backend || piBackendFor(chat);
  return {
    ...view,
    unread: chatIsUnread(chat),
    harnessId: harnessIdForImplementation(identity.implementation, identity.installationId),
    backend: identity,
    profileId: identity.profileId,
    profileRevision: identity.profileRevision,
  };
}

function sessionFileFor(item) {
  const file = conduitPiSessionFile(item);
  return file ? path.resolve(file) : null;
}

function modelThinkingLevelsFor(item) {
  if (!item?.modelThinkingLevels || typeof item.modelThinkingLevels !== "object" || Array.isArray(item.modelThinkingLevels)) return {};
  return Object.fromEntries(Object.entries(item.modelThinkingLevels)
    .filter(([spec, level]) => typeof spec === "string" && spec.trim() && typeof level === "string" && level.trim())
    .map(([spec, level]) => [spec.trim(), level.trim()]));
}

function sessionFamilies(files, parents) {
  const links = new Map([...files].map((file) => [file, new Set()]));
  for (const [file, parent] of parents) {
    links.get(file)?.add(parent);
    links.get(parent)?.add(file);
  }
  const families = new Map();
  for (const file of links.keys()) {
    if (families.has(file)) continue;
    const members = [];
    const pending = [file];
    while (pending.length) {
      const current = pending.pop();
      if (families.has(current)) continue;
      families.set(current, null);
      members.push(current);
      pending.push(...(links.get(current) || []));
    }
    const id = members.sort().at(0);
    for (const member of members) families.set(member, id);
  }
  return families;
}

function preferredFamilyChat(rows) {
  return [...rows].sort((left, right) => String(right.updatedAt || right.createdAt || "").localeCompare(String(left.updatedAt || left.createdAt || "")))[0];
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
        ...this.defaultRuntime,
        profileId: templateId || this.defaultRuntime.profileId || null,
        profileVersion: templateVersion || this.defaultRuntime.profileVersion || null,
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
    const rows = (Array.isArray(stored.chats) ? stored.chats : Array.isArray(stored.sessions) ? stored.sessions : [])
      .map(withPiCompatibilityFields);
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
    const parentSessions = new Map();
    for (const [file, candidates] of discoveredFiles) {
      for (const project of candidates) {
        try {
          const parent = await readSessionParentSession(file, project);
          if (parent && discoveredFiles.has(parent)) parentSessions.set(file, parent);
          break;
        } catch {}
      }
    }
    const families = sessionFamilies(discoveredFiles.keys(), parentSessions);
    const familyChats = new Map();
    for (const item of rows) {
      const family = families.get(sessionFileFor(item));
      if (!family) continue;
      familyChats.set(family, [...(familyChats.get(family) || []), item]);
    }
    const familyOwners = new Map([...familyChats].map(([family, members]) => [family, preferredFamilyChat(members).id]));

    const reconciled = [];
    const usedIds = new Set();
    for (const item of rows) {
      const project = projectById.get(item.projectId);
      if (!project) continue;
      const id = isChatId(item.id) && !usedIds.has(item.id) ? item.id : crypto.randomUUID();
      let piSessionFile = sessionFileFor(item);
      const family = families.get(piSessionFile);
      if (family && familyOwners.get(family) !== item.id) {
        continue;
      }
      const active = legacyRegistry
        ? item.status === "active" || item.status === "persisted" || Boolean(item.file)
        : item.status === "active";
      const externalBackend = item.backend && item.backend.protocol !== "pi_rpc";
      if (active && (!piSessionFile || !await fileExists(piSessionFile)) && !externalBackend) continue;
      let sessionMetadata = null;
      if (piSessionFile && await fileExists(piSessionFile)) {
        try { sessionMetadata = await readSessionMetadata(piSessionFile, project); }
        catch { continue; }
      }
      if (!active && piSessionFile && !await fileExists(piSessionFile)) piSessionFile = null;
      const createdAt = item.createdAt || new Date(this.now()).toISOString();
      const chat = {
        id,
        projectId: project.id,
        status: active ? "active" : "draft",
        title: String(item.title ?? "New chat"),
        templateId: typeof item.templateId === "string" && item.templateId.trim() ? item.templateId.trim() : null,
        templateVersion: typeof item.templateVersion === "string" && item.templateVersion.trim()
          ? item.templateVersion.trim()
          : null,
        runtime: externalBackend ? null : this.runtimeFor(item, item.templateId, item.templateVersion),
        backend: externalBackend ? item.backend : {
          ...(item.backend || piBackendFor(item)),
          opaqueSession: piSessionFile,
        },
        modelThinkingLevels: modelThinkingLevelsFor(item),
        createdAt,
        updatedAt: item.updatedAt || createdAt,
        lastUserMessageAt: item.lastUserMessageAt || sessionMetadata?.lastUserMessageAt || null,
        lastAssistantCompletedAt: item.lastAssistantCompletedAt || sessionMetadata?.lastAssistantCompletedAt || null,
        lastMessageAt: item.lastMessageAt || sessionMetadata?.lastMessageAt || null,
        // Rows written before the watermark carried an `unread` flag: a read
        // chat has been read up to its stored completion, an unread one has
        // not. Completions the session file gained while this was down are
        // newer than the watermark either way, so they come back unread.
        lastReadAt: item.lastReadAt
          || (item.unread ? null : item.lastAssistantCompletedAt || null),
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

    const discoveredFamilies = new Map();
    for (const [file, candidates] of discoveredFiles) {
      const family = families.get(file) || file;
      discoveredFamilies.set(family, [...(discoveredFamilies.get(family) || []), { file, candidates }]);
    }
    const parentFiles = new Set(parentSessions.values());
    for (const [family, files] of discoveredFamilies) {
      if (usedIds.has(familyOwners.get(family))) continue;
      files.sort((left, right) => Number(parentFiles.has(left.file)) - Number(parentFiles.has(right.file)) || right.file.localeCompare(left.file));
      let imported = false;
      for (const { file, candidates } of files) {
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
              backend: { ...piBackendFor({ runtime: this.defaultRuntime }), opaqueSession: session.file },
              modelThinkingLevels: {},
              createdAt: session.createdAt,
              updatedAt: session.updatedAt,
              lastUserMessageAt: session.lastUserMessageAt || null,
              lastAssistantCompletedAt: session.lastAssistantCompletedAt || null,
              lastMessageAt: session.lastMessageAt || null,
              lastReadAt: session.lastAssistantCompletedAt || null,
            };
            await this.ensureDirectories(project, id);
            await this.removePartials(project, id);
            usedIds.add(id);
            reconciled.push(chat);
            imported = true;
            break;
          } catch {}
        }
        if (imported) break;
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

  async migrateTemplateIds(normalize) {
    let changed = false;
    for (const chat of this.chats) {
      const templateId = normalize(chat.templateId);
      const profileId = normalize(chat.runtime?.profileId);
      if (templateId && templateId !== chat.templateId) {
        chat.templateId = templateId;
        if (chat.backend?.implementation === "conduit_pi") chat.backend.profileId = templateId;
        changed = true;
      }
      if (chat.runtime?.kind === "conduit_profile" && profileId && profileId !== chat.runtime.profileId) {
        chat.runtime.profileId = profileId;
        changed = true;
      }
    }
    if (changed) await this.flush();
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
    chat.backend = piBackendFor(chat);
    await this.flush();
    return chat;
  }

  async find(projects, id) {
    const chat = this.metadata(id);
    const sessionFile = conduitPiSessionFile(chat);
    if (!sessionFile) return null;
    const project = projects.find((item) => item.id === chat.projectId);
    if (!project) return null;
    try { return { ...(await validateSessionFile(sessionFile, project)), chatId: chat.id }; }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }

  async create(project, { templateId = null, templateVersion = null, runtime = null, backend = null } = {}) {
    const timestamp = new Date(this.now()).toISOString();
    const chat = {
      id: crypto.randomUUID(),
      projectId: project.id,
      status: "draft",
      title: "",
      templateId: typeof templateId === "string" && templateId.trim() ? templateId.trim() : null,
      templateVersion: typeof templateVersion === "string" && templateVersion.trim()
        ? templateVersion.trim()
        : null,
      runtime: backend?.protocol === "pi_rpc" || !backend ? this.runtimeFor({ runtime }, templateId, templateVersion) : null,
      backend,
      modelThinkingLevels: {},
      createdAt: timestamp,
      updatedAt: timestamp,
      lastUserMessageAt: null,
      lastAssistantCompletedAt: null,
      lastMessageAt: null,
      lastReadAt: null,
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
      backend: { ...(chat.backend || piBackendFor(chat)), opaqueSession: path.resolve(session.file) },
      updatedAt: session.updatedAt || new Date(this.now()).toISOString(),
      lastUserMessageAt: laterOf(chat.lastUserMessageAt, session.lastUserMessageAt),
      lastAssistantCompletedAt: laterOf(chat.lastAssistantCompletedAt, session.lastAssistantCompletedAt),
      lastMessageAt: laterOf(chat.lastMessageAt, session.lastMessageAt),
    });
    await this.flush();
    return chat;
  }

  async fallbackTitle(chatId, title) {
    const chat = this.metadata(chatId);
    const name = String(title || "").trim();
    if (!chat || chat.title || !name || name === "New chat") return false;
    chat.title = name;
    await this.flush();
    return true;
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
    const canSelectBackend = chat.status === "draft" && !conduitPiSessionFile(chat) && !chat.lastUserMessageAt;
    const previousCompletedAt = chat.lastAssistantCompletedAt;
    const allowed = [
      "projectId",
      "title",
      "templateId",
      "templateVersion",
      "runtime",
      "backend",
      "modelThinkingLevels",
      "updatedAt",
      "lastUserMessageAt",
      "lastAssistantCompletedAt",
      "lastMessageAt",
      "lastReadAt",
    ];
    for (const key of allowed) if (Object.hasOwn(patch, key)) chat[key] = patch[key];
    // The completion clock is the read watermark's other half, so it never
    // regresses -- a re-read of an older session file must not resurrect or
    // suppress unread.
    if (Object.hasOwn(patch, "lastAssistantCompletedAt")) {
      chat.lastAssistantCompletedAt = laterOf(previousCompletedAt, patch.lastAssistantCompletedAt);
    }
    chat.modelThinkingLevels = modelThinkingLevelsFor(chat);
    if (chat.runtime?.kind === "conduit_profile" && (Object.hasOwn(patch, "templateId") || Object.hasOwn(patch, "templateVersion"))) {
      chat.runtime.profileId = chat.templateId;
      chat.runtime.profileVersion = chat.templateVersion;
    }
    if (chat.runtime) chat.runtime = this.runtimeFor(chat, chat.templateId, chat.templateVersion);
    if (patch.status === "draft" || patch.status === "active") chat.status = patch.status;
    if (canSelectBackend && patch.backend == null
      && ["templateId", "templateVersion", "runtime"].some((key) => Object.hasOwn(patch, key))) {
      chat.backend = piBackendFor(chat);
    }
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
   * Raise the read watermark. `upTo` is a completion timestamp this server
   * issued and a client has rendered, never a browser clock, so skew cannot
   * reach it and a receipt that arrives late, twice or from a second device
   * can only re-assert ground already covered.
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
    const sessionFile = conduitPiSessionFile(chat);
    if (sessionFile) await fs.rm(sessionFile, { force: true });
    await this.remove(chatId, project);
    return true;
  }

  async removeProject(projectId) {
    this.chats = this.chats.filter((chat) => chat.projectId !== projectId);
    for (const id of [...this.visibleDrafts]) if (!this.metadata(id)) this.visibleDrafts.delete(id);
    await this.flush();
  }

  flush() {
    for (const chat of this.chats) {
      if (chat.backend?.protocol !== "pi_rpc") chat.backend ||= piBackendFor(chat);
      else chat.backend = { ...(chat.backend || piBackendFor(chat)), opaqueSession: conduitPiSessionFile(chat) };
    }
    const value = `${JSON.stringify({ version: 5, chats: this.chats }, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.tmp`;
      await fs.writeFile(temporary, value, "utf8");
      await fs.rename(temporary, this.file);
    });
    return this.writeQueue;
  }
}
