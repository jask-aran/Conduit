import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
