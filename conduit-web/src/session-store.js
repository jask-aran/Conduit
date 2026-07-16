import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";

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
        firstMessage = textContent(entry.message.content).trim();
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
      const session = await parseSession(path.join(project.sessionsDir, entry.name), project);
      if (path.resolve(session.cwd) === path.resolve(project.path)) sessions.push(session);
    } catch {}
  }
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function discoverSessions(projects) {
  return (await Promise.all(projects.map(discoverProjectSessions))).flat()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  return entries.flatMap((entry, index) => {
    if (entry.type !== "message" || !entry.message?.role) return [];
    const role = entry.message.role;
    if (!["user", "assistant", "toolResult"].includes(role)) return [];
    return [{
      id: entry.id || `entry_${index}`,
      role,
      content: textContent(entry.message.content),
      blocks: Array.isArray(entry.message.content) ? entry.message.content : [],
      usage: entry.message.usage || null,
      timestamp: entry.timestamp || null,
    }];
  });
}

export function pageSessionEntries(entries, { before, turnLimit = 10, characterLimit = 50_000 } = {}) {
  const requestedEnd = Number.parseInt(before, 10);
  const end = Number.isInteger(requestedEnd) ? Math.max(0, Math.min(requestedEnd, entries.length)) : entries.length;
  const starts = [];
  for (let index = 0; index < end; index += 1) {
    if (entries[index].type === "message" && entries[index].message?.role === "user") starts.push(index);
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
