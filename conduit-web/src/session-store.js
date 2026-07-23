import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { parseAttachmentEnvelope } from "./attachment-envelope.js";
import { CONTINUE_PROMPT, mergeContinuation } from "./continuation.js";

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

function consumeIndexedEntry(index, entry, offset, end) {
  const content = entry.type === "message" ? textContent(entry.message?.content) : "";
  index.records.push({
    offset,
    end,
    characters: content.length,
    turnStart: entry.type === "message"
      && entry.message?.role === "user"
      && content.trim() !== CONTINUE_PROMPT,
  });
  if (entry.type === "session") index.header = entry;
  if (entry.type === "session_info" && entry.name) index.name = entry.name;
  if (!index.firstMessage && entry.type === "message" && entry.message?.role === "user") {
    const prompt = content.trim();
    if (prompt !== CONTINUE_PROMPT) index.firstMessage = parseAttachmentEnvelope(prompt).message.trim();
  }
  if (entry.type === "message" && entry.message?.role === "user") {
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
}

function parseIndexedBuffer(index, buffer, baseOffset) {
  let lineStart = 0;
  for (let cursor = 0; cursor < buffer.length; cursor += 1) {
    if (buffer[cursor] !== 0x0a) continue;
    const line = buffer.subarray(lineStart, cursor);
    if (line.length) {
      try {
        consumeIndexedEntry(index, JSON.parse(line.toString("utf8")), baseOffset + lineStart, baseOffset + cursor + 1);
      } catch {}
    }
    lineStart = cursor + 1;
  }
  const finalLine = buffer.subarray(lineStart);
  if (finalLine.length) {
    try {
      consumeIndexedEntry(index, JSON.parse(finalLine.toString("utf8")), baseOffset + lineStart, baseOffset + buffer.length);
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
    records: [],
    header: null,
    name: null,
    firstMessage: "",
    model: null,
    thinkingLevel: "",
    announcedAttachmentIds: new Set(),
    prefixLength: Math.min(buffer.length, 4096),
    prefixHash: crypto.createHash("sha256").update(buffer.subarray(0, 4096)).digest("hex"),
  };
  index.indexedThrough = parseIndexedBuffer(index, buffer, 0);
  sessionIndexes.set(file, index);
  return index;
}

async function sessionIndex(file) {
  const resolved = path.resolve(file);
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
      current.indexedThrough = parseIndexedBuffer(current, buffer, current.indexedThrough);
    } finally {
      if (handle.fd >= 0) await handle.close();
    }
  }
  current.size = stat.size;
  current.mtimeMs = stat.mtimeMs;
  return current;
}

function sessionMetadata(file, project, stat, index) {
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
    cwd: index.header?.cwd || project.path,
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
  if (path.resolve(header.cwd) !== path.resolve(project.path)) {
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

export async function readSessionPage(file, project, { before, turnLimit = 10, characterLimit = 50_000 } = {}) {
  const metadata = await readSessionMetadata(file, project);
  const index = await sessionIndex(metadata.file);
  const requestedEnd = Number.parseInt(before, 10);
  const endOffset = Number.isInteger(requestedEnd)
    ? Math.max(0, Math.min(requestedEnd, index.indexedThrough))
    : index.indexedThrough;
  let end = index.records.findIndex((record) => record.offset >= endOffset);
  if (end < 0) end = index.records.length;
  const starts = [];
  for (let recordIndex = 0; recordIndex < end; recordIndex += 1) {
    if (index.records[recordIndex].turnStart) starts.push(recordIndex);
  }
  let start = 0;
  if (starts.length) {
    start = starts.at(-1);
    let characters = 0;
    let turns = 0;
    for (let position = starts.length - 1; position >= 0; position -= 1) {
      const turnStart = starts[position];
      const turnEnd = position + 1 < starts.length ? starts[position + 1] : end;
      const turnCharacters = index.records.slice(turnStart, turnEnd)
        .reduce((total, record) => total + record.characters, 0);
      if (turns > 0 && (turns >= turnLimit || characters + turnCharacters > characterLimit)) break;
      start = turnStart;
      characters += turnCharacters;
      turns += 1;
    }
  }
  const startOffset = index.records[start]?.offset ?? endOffset;
  const length = Math.max(0, endOffset - startOffset);
  const handle = await fs.open(metadata.file, "r");
  let buffer;
  try {
    buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, startOffset);
  } finally {
    await handle.close();
  }
  const entries = [];
  for (const record of index.records.slice(start, end)) {
    const relativeStart = record.offset - startOffset;
    const relativeEnd = Math.min(record.end - startOffset, buffer.length);
    const line = buffer.subarray(relativeStart, relativeEnd).toString("utf8").trim();
    if (!line) continue;
    try {
      const entry = JSON.parse(line);
      if (entry.type === "message" && !entry.id) entry.id = `entry_${record.offset}`;
      entries.push(entry);
    } catch {}
  }
  const hasMore = starts.length > 0 && start > starts[0];
  return {
    ...metadata,
    entries,
    page: { before: hasMore ? String(startOffset) : null },
  };
}

export async function parseSession(file, project) {
  const raw = await fs.readFile(file, "utf8");
  const entries = [];
  let header = null;
  let name = null;
  let firstMessage = "";
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
    } catch {}
  }
  const stat = await fs.stat(file);
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
    cwd: header?.cwd || project.path,
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
  if (path.resolve(header.cwd) !== path.resolve(project.path)) {
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
 * Parent paths outside the workspace session directory are deliberately not
 * followed: Conduit may only remove transcripts it owns for this project.
 */
export async function sessionFamilyFiles(file, project) {
  const target = path.resolve(file);
  let entries;
  try { entries = await fs.readdir(project.sessionsDir, { withFileTypes: true }); }
  catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = new Set(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
    .map((entry) => path.resolve(project.sessionsDir, entry.name)));
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

export async function removeSessionFamily(file, project) {
  const files = await sessionFamilyFiles(file, project);
  await Promise.all(files.map((familyFile) => removeSession({ file: familyFile })));
  return files;
}

export async function renameSession(session, project, name) {
  const manager = SessionManager.open(session.file, project.sessionsDir, project.path);
  manager.appendSessionInfo(name);
  return parseSession(session.file, project);
}

export async function duplicateSession(session, targetProject, name = "") {
  const manager = SessionManager.forkFrom(session.file, targetProject.path, targetProject.sessionsDir);
  if (name.trim()) manager.appendSessionInfo(name);
  return parseSession(manager.getSessionFile(), targetProject);
}

export async function moveSession(session, targetProject) {
  const duplicate = await duplicateSession(session, targetProject);
  try {
    await removeSession(session);
  } catch (error) {
    await removeSession(duplicate);
    throw error;
  }
  return duplicate;
}

export async function moveSessions(sessions, targetProject) {
  const duplicates = [];
  try {
    for (const session of sessions) duplicates.push(await duplicateSession(session, targetProject));
  } catch (error) {
    await Promise.all(duplicates.map(removeSession));
    throw error;
  }
  await Promise.all(sessions.map(removeSession));
  return duplicates;
}

export async function removeProjectSessions(project) {
  const sessions = await discoverProjectSessions(project);
  await Promise.all(sessions.map(removeSession));
  try { await fs.rmdir(project.sessionsDir); }
  catch (error) {
    if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
  }
}

export function projectSessionView(session) {
  const { file, entries, ...safe } = session;
  return safe;
}

export function messagesFromEntries(entries) {
  const messages = [];
  let continuation = false;
  entries.forEach((entry, index) => {
    if (entry.type !== "message" || !entry.message?.role) return [];
    const role = entry.message.role;
    if (!["user", "assistant", "toolResult"].includes(role)) return [];
    const rawContent = textContent(entry.message.content);
    if (role === "user" && rawContent.trim() === CONTINUE_PROMPT) {
      continuation = true;
      return;
    }
    const envelope = role === "user" ? parseAttachmentEnvelope(rawContent) : null;
    const message = {
      id: entry.id || `entry_${index}`,
      role,
      content: envelope?.message ?? rawContent,
      blocks: Array.isArray(entry.message.content) ? entry.message.content : [],
      usage: entry.message.usage || null,
      timestamp: entry.timestamp || null,
      stopReason: entry.message.stopReason || null,
      stopped: entry.message.stopReason === "aborted",
      attachments: envelope?.attachments || [],
    };
    if (role === "assistant" && continuation) {
      if (!message.content) return;
      const previous = messages.findLast((item) => item.role === "assistant");
      if (previous) {
        previous.content = mergeContinuation(previous.content, message.content);
        previous.stopReason = message.stopReason;
        previous.stopped = message.stopped;
        previous.continued = true;
        previous.timestamp = message.timestamp || previous.timestamp;
        continuation = false;
        return;
      }
    }
    if (role !== "toolResult") continuation = false;
    messages.push(message);
  });
  return messages;
}

export function pageSessionEntries(entries, { before, turnLimit = 10, characterLimit = 50_000 } = {}) {
  const requestedEnd = Number.parseInt(before, 10);
  const end = Number.isInteger(requestedEnd) ? Math.max(0, Math.min(requestedEnd, entries.length)) : entries.length;
  const starts = [];
  for (let index = 0; index < end; index += 1) {
    if (entries[index].type === "message"
      && entries[index].message?.role === "user"
      && textContent(entries[index].message.content).trim() !== CONTINUE_PROMPT) starts.push(index);
  }
  if (!starts.length) return { entries: entries.slice(0, end), start: 0, end, hasMore: false };

  let start = starts.at(-1);
  let characters = 0;
  let turns = 0;
  for (let position = starts.length - 1; position >= 0; position -= 1) {
    const turnStart = starts[position];
    const turnEnd = position + 1 < starts.length ? starts[position + 1] : end;
    const turnCharacters = entries.slice(turnStart, turnEnd).reduce((total, entry) =>
      total + (entry.type === "message" ? textContent(entry.message?.content).length : 0), 0);
    if (turns > 0 && (turns >= turnLimit || characters + turnCharacters > characterLimit)) break;
    start = turnStart;
    characters += turnCharacters;
    turns += 1;
  }
  return { entries: entries.slice(start, end), start, end, hasMore: start > starts[0] };
}

export function transcriptFromEntries(entries) {
  return messagesFromEntries(entries)
    .filter((message) => message.content.trim())
    .map((message) => {
      const role = message.role === "user" ? "User" : message.role === "assistant" ? "Assistant" : "Tool result";
      return `## ${role}\n\n${message.content.trim()}`;
    })
    .join("\n\n");
}

export function toolsFromEntries(entries) {
  const tools = new Map();
  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;
    if (message?.role === "assistant" && Array.isArray(message.content)) {
      for (const block of message.content) {
        if (block?.type !== "toolCall" || !block.id) continue;
        tools.set(block.id, {
          id: block.id,
          name: block.name,
          args: block.arguments,
          done: false,
          timestamp: entry.timestamp || null,
        });
      }
    }
    if (message?.role === "toolResult" && message.toolCallId) {
      const current = tools.get(message.toolCallId) || {
        id: message.toolCallId,
        name: message.toolName,
        args: {},
      };
      tools.set(message.toolCallId, {
        ...current,
        name: current.name || message.toolName,
        done: true,
        result: textContent(message.content),
      });
    }
  }
  return [...tools.values()];
}

export function settingsFromEntries(entries) {
  let model = null;
  let thinkingLevel = "";
  for (const entry of entries) {
    if (entry.type === "model_change" && entry.provider && entry.modelId) {
      model = `${entry.provider}/${entry.modelId}`;
    }
    if (entry.type === "thinking_level_change") thinkingLevel = entry.thinkingLevel || "";
    if (entry.type === "message" && entry.message?.role === "assistant" && entry.message.provider && entry.message.model) {
      model = `${entry.message.provider}/${entry.message.model}`;
    }
  }
  return { model, thinkingLevel };
}
