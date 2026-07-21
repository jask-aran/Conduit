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

function timestampMs(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function reasoningFromEntry(entry) {
  if (!Array.isArray(entry.message?.content)) return null;
  const blocks = entry.message.content.filter((block) => block?.type === "thinking");
  if (!blocks.length) return null;
  const startedAt = timestampMs(entry.message.timestamp);
  const completedAt = timestampMs(entry.timestamp);
  const durationSeconds = startedAt != null && completedAt != null && completedAt >= startedAt
    ? Math.max(0, Math.round((completedAt - startedAt) / 1_000))
    : null;
  return {
    status: "completed",
    content: blocks.map((block) => typeof block.thinking === "string" ? block.thinking : "").join("\n"),
    redacted: blocks.some((block) => block.redacted === true),
    durationSeconds,
    observed: true,
  };
}

function publicBlocks(content) {
  if (!Array.isArray(content)) return [];
  return content.map((block) => {
    if (block?.type !== "thinking") return block;
    const { thinkingSignature, ...safe } = block;
    return safe;
  });
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
  await fs.rm(session.file, { force: true });
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
      blocks: publicBlocks(entry.message.content),
      usage: entry.message.usage || null,
      timestamp: entry.timestamp || null,
      stopReason: entry.message.stopReason || null,
      stopped: entry.message.stopReason === "aborted",
      attachments: envelope?.attachments || [],
    };
    const reasoning = role === "assistant" ? reasoningFromEntry(entry) : null;
    if (reasoning) message.reasoning = reasoning;
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
