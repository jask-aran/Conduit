import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parseAttachmentEnvelope } from "./attachment-envelope.js";
import { CONTINUE_PROMPT } from "./continuation.js";
import { isPathInside } from "./workspace-paths.js";


export function sessionDirectoryFor(cwd, agentDir) {
  const resolvedCwd = path.resolve(cwd);
  const encodedCwd = `--${resolvedCwd.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return path.join(path.resolve(agentDir), "sessions", encodedCwd);
}

export function sessionIdFor(filePath, nativeId = "") {
  return nativeId || crypto.createHash("sha256").update(path.resolve(filePath)).digest("hex").slice(0, 24);
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block?.type === "text").map((block) => block.text || "").join("\n");
}

const sessionIndexes = new Map();
const sessionIndexRefreshes = new Map();

function consumeIndexedEntry(index, entry) {
  const content = entry.type === "message" ? textContent(entry.message?.content) : "";
  const timestamp = typeof entry.timestamp === "string" ? entry.timestamp : null;
  if (entry.type === "session") index.header = entry;
  if (entry.type === "session_info" && entry.name) index.name = entry.name;
  if (!index.firstMessage && entry.type === "message" && entry.message?.role === "user") {
    const prompt = content.trim();
    if (prompt !== CONTINUE_PROMPT) index.firstMessage = parseAttachmentEnvelope(prompt).message.trim();
  }
  if (entry.type === "message" && entry.message?.role === "user") {
    if (content.trim() !== CONTINUE_PROMPT && timestamp) index.lastUserMessageAt = timestamp;
    for (const attachment of parseAttachmentEnvelope(content).attachments) {
      if (attachment.id) index.announcedAttachmentIds.add(attachment.id);
    }
  }
  if (entry.type === "model_change" && entry.provider && entry.modelId) {
    index.model = `${entry.provider}/${entry.modelId}`;
  }
  if (entry.type === "thinking_level_change") index.thinkingLevel = entry.thinkingLevel || "";
  if (entry.type === "message" && entry.message?.role === "assistant"
    && entry.message.provider && entry.message.model) {
    index.model = `${entry.message.provider}/${entry.message.model}`;
  }
  if (entry.type === "message" && entry.message?.role === "assistant" && timestamp) index.lastAssistantCompletedAt = timestamp;
}

function parseIndexedBuffer(index, buffer, baseOffset) {
  let lineStart = 0;
  for (let cursor = 0; cursor < buffer.length; cursor += 1) {
    if (buffer[cursor] !== 0x0a) continue;
    const line = buffer.subarray(lineStart, cursor);
    if (line.length) {
      try {
        consumeIndexedEntry(index, JSON.parse(line.toString("utf8")));
      } catch {}
    }
    lineStart = cursor + 1;
  }
  const finalLine = buffer.subarray(lineStart);
  if (finalLine.length) {
    try {
      consumeIndexedEntry(index, JSON.parse(finalLine.toString("utf8")));
      lineStart = buffer.length;
    } catch {}
  }
  return baseOffset + lineStart;
}

async function buildSessionIndex(file, stat) {
  const buffer = await fs.readFile(file);
  const index = {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    indexedThrough: 0,
    header: null,
    name: null,
    firstMessage: "",
    model: null,
    thinkingLevel: "",
    lastUserMessageAt: null,
    lastAssistantCompletedAt: null,
    announcedAttachmentIds: new Set(),
    prefixLength: Math.min(buffer.length, 4096),
    prefixHash: crypto.createHash("sha256").update(buffer.subarray(0, 4096)).digest("hex"),
  };
  index.indexedThrough = parseIndexedBuffer(index, buffer, 0);
  sessionIndexes.set(file, index);
  return index;
}

function appendSessionIndex(index, stat) {
  return {
    ...index,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    announcedAttachmentIds: new Set(index.announcedAttachmentIds),
  };
}

async function refreshSessionIndex(resolved) {
  const stat = await fs.stat(resolved);
  const current = sessionIndexes.get(resolved);
  const sameFile = current && current.dev === stat.dev && current.ino === stat.ino;
  if (!sameFile || stat.size < current.size || (stat.size === current.size && stat.mtimeMs !== current.mtimeMs)) {
    return buildSessionIndex(resolved, stat);
  }
  if (stat.size > current.size) {
    const handle = await fs.open(resolved, "r");
    try {
      const prefix = Buffer.alloc(current.prefixLength);
      await handle.read(prefix, 0, prefix.length, 0);
      const prefixHash = crypto.createHash("sha256").update(prefix).digest("hex");
      if (prefixHash !== current.prefixHash) {
        await handle.close();
        return buildSessionIndex(resolved, stat);
      }
      const buffer = Buffer.alloc(stat.size - current.indexedThrough);
      await handle.read(buffer, 0, buffer.length, current.indexedThrough);
      const next = appendSessionIndex(current, stat);
      next.indexedThrough = parseIndexedBuffer(next, buffer, next.indexedThrough);
      sessionIndexes.set(resolved, next);
      return next;
    } finally {
      if (handle.fd >= 0) await handle.close();
    }
  }
  current.size = stat.size;
  current.mtimeMs = stat.mtimeMs;
  return current;
}

async function sessionIndex(file) {
  const resolved = path.resolve(file);
  const active = sessionIndexRefreshes.get(resolved);
  if (active) return active;
  const refresh = refreshSessionIndex(resolved);
  sessionIndexRefreshes.set(resolved, refresh);
  try {
    return await refresh;
  } finally {
    if (sessionIndexRefreshes.get(resolved) === refresh) sessionIndexRefreshes.delete(resolved);
  }
}

function sessionMetadata(file, project, stat, index) {
  const lastMessageAt = [index.lastUserMessageAt, index.lastAssistantCompletedAt].filter(Boolean).sort().at(-1) || null;
  return {
    id: sessionIdFor(file, index.header?.id),
    nativeId: index.header?.id || null,
    projectId: project.id,
    projectSlug: project.slug,
    runtime: "pi-rpc",
    status: "persisted",
    title: index.name || index.firstMessage.slice(0, 72) || "New chat",
    createdAt: index.header?.timestamp || stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    lastUserMessageAt: index.lastUserMessageAt,
    lastAssistantCompletedAt: index.lastAssistantCompletedAt,
    lastMessageAt,
    cwd: index.header?.cwd || project.workingRoot,
    file,
    model: index.model,
    thinkingLevel: index.thinkingLevel,
  };
}

async function assertSessionMapping(file, project, header) {
  if (!header || typeof header.cwd !== "string" || !header.cwd.trim()) {
    const error = new Error("Pi session JSONL has no valid session header");
    error.code = "invalid_session_mapping";
    throw error;
  }
  if (path.resolve(header.cwd) !== path.resolve(project.workingRoot)) {
    const error = new Error("Pi session working directory does not match its Conduit workspace");
    error.code = "session_cwd_mismatch";
    throw error;
  }
}

export async function readSessionMetadata(file, project) {
  const resolved = path.resolve(file);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || path.extname(resolved) !== ".jsonl") {
    const error = new Error("Pi session mapping is not a regular JSONL file");
    error.code = "invalid_session_mapping";
    throw error;
  }
  const index = await sessionIndex(resolved);
  await assertSessionMapping(resolved, project, index.header);
  return sessionMetadata(resolved, project, stat, index);
}

export async function readSessionParentSession(file, project) {
  const metadata = await readSessionMetadata(file, project);
  const parent = (await sessionIndex(metadata.file)).header?.parentSession;
  return typeof parent === "string" && parent.trim() ? path.resolve(parent) : null;
}

export async function readAnnouncedAttachmentIds(file, project) {
  const metadata = await readSessionMetadata(file, project);
  const index = await sessionIndex(metadata.file);
  return new Set(index.announcedAttachmentIds);
}

export async function validateSessionHeader(file, project) {
  const resolved = path.resolve(file);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || path.extname(resolved) !== ".jsonl") {
    const error = new Error("Pi session mapping is not a regular JSONL file");
    error.code = "invalid_session_mapping";
    throw error;
  }
  const handle = await fs.open(resolved, "r");
  try {
    const buffer = Buffer.alloc(Math.min(stat.size, 256 * 1024));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const newline = buffer.subarray(0, bytesRead).indexOf(0x0a);
    const line = buffer.subarray(0, newline >= 0 ? newline : bytesRead);
    let header = null;
    try { header = JSON.parse(line.toString("utf8")); } catch {}
    await assertSessionMapping(resolved, project, header?.type === "session" ? header : null);
    return {
      ...sessionMetadata(resolved, project, stat, {
        header,
        name: null,
        firstMessage: "",
        model: null,
        thinkingLevel: "",
      }),
    };
  } finally {
    await handle.close();
  }
}

export async function parseSession(file, project) {
  const raw = await fs.readFile(file, "utf8");
  const entries = [];
  let header = null;
  let name = null;
  let firstMessage = "";
  let lastUserMessageAt = null;
  let lastAssistantCompletedAt = null;
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      entries.push(entry);
      if (entry.type === "session") header = entry;
      if (entry.type === "session_info" && entry.name) name = entry.name;
      if (!firstMessage && entry.type === "message" && entry.message?.role === "user") {
        const content = textContent(entry.message.content).trim();
        if (content !== CONTINUE_PROMPT) firstMessage = parseAttachmentEnvelope(content).message.trim();
      }
      if (entry.type === "message" && entry.message?.role === "user"
        && textContent(entry.message.content).trim() !== CONTINUE_PROMPT && typeof entry.timestamp === "string") lastUserMessageAt = entry.timestamp;
      if (entry.type === "message" && entry.message?.role === "assistant" && typeof entry.timestamp === "string") lastAssistantCompletedAt = entry.timestamp;
    } catch {}
  }
  const stat = await fs.stat(file);
  const lastMessageAt = [lastUserMessageAt, lastAssistantCompletedAt].filter(Boolean).sort().at(-1) || null;
  return {
    id: sessionIdFor(file, header?.id),
    nativeId: header?.id || null,
    projectId: project.id,
    projectSlug: project.slug,
    runtime: "pi-rpc",
    status: "persisted",
    title: name || firstMessage.slice(0, 72) || "New chat",
    createdAt: header?.timestamp || stat.birthtime.toISOString(),
    updatedAt: stat.mtime.toISOString(),
    lastUserMessageAt,
    lastAssistantCompletedAt,
    lastMessageAt,
    cwd: header?.cwd || project.workingRoot,
    file,
    entries,
  };
}

export async function validateSessionFile(file, project) {
  const resolved = path.resolve(file);
  const stat = await fs.lstat(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || path.extname(resolved) !== ".jsonl") {
    const error = new Error("Pi session mapping is not a regular JSONL file");
    error.code = "invalid_session_mapping";
    throw error;
  }
  const session = await parseSession(resolved, project);
  const header = session.entries.find((entry) => entry.type === "session");
  if (!header || typeof header.cwd !== "string" || !header.cwd.trim()) {
    const error = new Error("Pi session JSONL has no valid session header");
    error.code = "invalid_session_mapping";
    throw error;
  }
  if (path.resolve(header.cwd) !== path.resolve(project.workingRoot)) {
    const error = new Error("Pi session working directory does not match its Conduit workspace");
    error.code = "session_cwd_mismatch";
    throw error;
  }
  return session;
}

export async function discoverProjectSessions(project) {
  let entries;
  try { entries = await fs.readdir(project.sessionsDir, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const sessions = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
    try {
      sessions.push(await validateSessionFile(path.join(project.sessionsDir, entry.name), project));
    } catch {}
  }
  return sessions.sort(compareSessionsByCreatedAt);
}

export async function discoverSessions(projects) {
  return (await Promise.all(projects.map(discoverProjectSessions))).flat()
    .sort(compareSessionsByCreatedAt);
}

/** Newest creation first; rename must not reorder (mtime-backed updatedAt changes on title edit). */
function compareSessionsByCreatedAt(a, b) {
  const byCreated = String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  return byCreated || String(b.id || "").localeCompare(String(a.id || ""));
}

export async function findSession(projects, id) {
  if (String(id).includes(path.sep)) {
    const resolved = path.resolve(id);
    return (await discoverSessions(projects)).find((session) => path.resolve(session.file) === resolved) || null;
  }
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) return null;
  return (await discoverSessions(projects)).find((session) => session.id === id) || null;
}

export async function removeSession(session) {
  sessionIndexes.delete(path.resolve(session.file));
  await fs.rm(session.file, { force: true });
}

/**
 * Returns every regular JSONL in this workspace's on-disk Pi fork family.
 * Parent paths outside the runtime session directory are deliberately not
 * followed: Conduit may only remove transcripts it owns for this project.
 */
export async function sessionFamilyFiles(file, project, { sessionsDir = project.sessionsDir, allowedRoot = null } = {}) {
  const target = path.resolve(file);
  const directory = path.resolve(sessionsDir);
  const expectedDirectoryName = path.basename(path.resolve(project.sessionsDir));
  if (path.basename(directory) !== expectedDirectoryName) {
    const error = new Error("Pi session mapping is outside the workspace session layout");
    error.code = "invalid_session_mapping";
    throw error;
  }
  if (allowedRoot && !isPathInside(directory, allowedRoot)) {
    const error = new Error("Pi session mapping is outside the runtime installation directory");
    error.code = "invalid_session_mapping";
    error.reason = "outside-installation";
    throw error;
  }
  if (path.dirname(target) !== directory) {
    const error = new Error("Pi session mapping is outside the runtime session directory");
    error.code = "invalid_session_mapping";
    throw error;
  }
  await validateSessionHeader(target, project);
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = new Set(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.resolve(directory, entry.name)));
  if (!files.has(target)) return [];

  const links = new Map([...files].map((candidate) => [candidate, new Set()]));
  await Promise.all([...files].map(async (candidate) => {
    try {
      const parent = await readSessionParentSession(candidate, project);
      if (!parent || !files.has(parent)) return;
      links.get(candidate).add(parent);
      links.get(parent).add(candidate);
    } catch {}
  }));

  const family = [];
  const pending = [target];
  const seen = new Set();
  while (pending.length) {
    const candidate = pending.pop();
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    family.push(candidate);
    for (const linked of links.get(candidate) || []) pending.push(linked);
  }
  return family;
}

export async function removeSessionFamily(file, project, options = {}) {
  const files = await sessionFamilyFiles(file, project, options);
  await Promise.all(files.map((familyFile) => removeSession({ file: familyFile })));
  return files;
}

export async function removeProjectSessions(project) {
  const sessions = await discoverProjectSessions(project);
  await Promise.all(sessions.map(removeSession));
  try { await fs.rmdir(project.sessionsDir); }
  catch (error) {
    if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
  }
}

/**
 * A Pi session file's block spelling, in Conduit's.
 *
 * The same translation the live adapter does, on the other way into the same
 * transcript. Reading the file used to hand its blocks to the browser untouched
 * and the rows were written to Pi's spelling to suit them, which is how a
 * harness that stores its transcript differently -- Codex reads its thread back
 * over the wire -- ended up with its thinking traces silently dropped on the
 * floor: nothing was wrong except that two producers of the same field had
 * spelled it differently and only one of them matched the reader.
 */
export function transcriptFromMessages(messages) {
  return messages
    .filter((message) => message.content.trim())
    .map((message) => {
      const role = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "Tool result";
      return `## ${role}\n\n${message.content.trim()}`;
    })
    .join("\n\n");
}
