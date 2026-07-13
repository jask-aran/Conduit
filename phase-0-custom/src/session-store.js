import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function sessionIdFor(filePath) {
  return crypto.createHash("sha256").update(path.resolve(filePath)).digest("hex").slice(0, 24);
}

async function walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  }));
  return nested.flat();
}

export async function discoverSessions(sessionsDir) {
  const files = (await walk(sessionsDir)).filter((file) => file.endsWith(".jsonl"));
  const sessions = await Promise.all(files.map(async (file) => {
    const stat = await fs.stat(file);
    return {
      id: sessionIdFor(file),
      runtime: "pi-rpc",
      status: "persisted",
      updatedAt: stat.mtime.toISOString(),
      ref: path.relative(sessionsDir, file),
      file,
    };
  }));
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function findSession(sessionsDir, id) {
  if (!/^[a-f0-9]{24}$/.test(id)) return null;
  return (await discoverSessions(sessionsDir)).find((session) => session.id === id) || null;
}

