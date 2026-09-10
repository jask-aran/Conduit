import fs from "node:fs/promises";
import path from "node:path";

// Claude Code and Pi both persist history the same way: a directory per working
// directory, holding one JSONL file per session. Codex and opencode answer an
// API instead, so this is shared by exactly the two that need it.
//
// The slug in the directory name is lossy ("-home-jask-Conduit" cannot be
// reversed to a path with confidence), so cwd is always read out of the file's
// own records rather than reconstructed from the name.

const HEAD_BYTES = 64 * 1024;

/** Read and parse the leading JSONL records without loading a large session. */
export async function readHeadRecords(file, maxBytes = HEAD_BYTES) {
  let handle;
  try { handle = await fs.open(file, "r"); } catch { return []; }
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf8");
    // A truncated tail line is expected whenever the file exceeds the window.
    const lines = text.split("\n");
    if (bytesRead === maxBytes) lines.pop();
    const records = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* skip a partial record */ }
    }
    return records;
  } finally { await handle.close(); }
}

/**
 * Walk a session store and describe every session it holds.
 *
 * @param root the store directory (`~/.claude/projects`, `~/.pi/agent/sessions`)
 * @param parse `(records, { file, mtimeMs }) => thread | null`
 * @param cwd when set, keep only threads that ran in this directory
 * @param limit newest-first cap on the returned threads
 */
export async function scanSessionStore({ root, parse, cwd = null, limit = 60 }) {
  let folders;
  try { folders = await fs.readdir(root, { withFileTypes: true }); } catch { return []; }
  const files = [];
  for (const folder of folders) {
    if (!folder.isDirectory()) continue;
    const directory = path.join(root, folder.name);
    let entries;
    try { entries = await fs.readdir(directory); } catch { continue; }
    for (const entry of entries) {
      if (entry.endsWith(".jsonl")) files.push(path.join(directory, entry));
    }
  }
  // Sort by mtime before reading, so a capped scan reads the newest sessions
  // rather than the newest of whatever the directory order happened to yield.
  const stated = [];
  for (const file of files) {
    try { stated.push({ file, mtimeMs: (await fs.stat(file)).mtimeMs }); } catch { /* raced deletion */ }
  }
  stated.sort((left, right) => right.mtimeMs - left.mtimeMs);

  const threads = [];
  for (const entry of stated) {
    if (threads.length >= limit) break;
    const thread = parse(await readHeadRecords(entry.file), entry);
    if (!thread?.id || !thread.cwd) continue;
    if (cwd && thread.cwd !== cwd) continue;
    threads.push({ updatedAt: entry.mtimeMs, path: entry.file, ...thread });
  }
  return threads;
}
