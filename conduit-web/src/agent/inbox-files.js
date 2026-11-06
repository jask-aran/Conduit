import fs from "node:fs/promises";
import path from "node:path";
import { readFolderFile, splitFrontMatter, writeFolderFile } from "./routine-files.js";

/*
 * The context inbox as files: each entry's text is `inbox/<date>-<id>-<title>.md` in jbot's folder, so the person sees
 * it in jbot's files and opens it in the file viewer like any other. The entry itself (status, level, who it is for)
 * stays in the agent's document; its text is the file's once written, so an edit there is what jbot reads next. A file
 * is written once, when the entry is first seen without one, and removed when the entry goes (deleted, or pruned a
 * week after it was handled).
 */
export const INBOX_DIR = "inbox";
const FILE = /^\d{4}-\d{2}-\d{2}-i-?\d+-[^/]*\.md$/;

const slug = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "entry";

/** The entry's file, relative to jbot's folder: from what never changes on it (when it came, its id, its title). */
export const inboxFile = (entry) => `${INBOX_DIR}/${entry.at.slice(0, 10)}-${entry.id}-${slug(entry.title === "Note" ? entry.headline : entry.title)}.md`;

const render = (entry, text) => [
  "---",
  `title: ${JSON.stringify(entry.title || "")}`,
  `kind: ${entry.kind}`,
  `level: ${entry.level}`,
  `at: ${entry.at}`,
  "---",
  "",
  String(text || entry.headline || "").trim(),
  "",
].join("\n");

/**
 * Write the files entries lack and remove those whose entry is gone. `lastAnswer(conversationId)` gives a run's report,
 * for entries that point at their run instead of carrying text.
 */
export async function syncInboxFiles(folder, entries, { lastAnswer } = {}) {
  if (!folder) return;
  const dir = path.join(folder, INBOX_DIR);
  await fs.mkdir(dir, { recursive: true });
  const present = new Set(await fs.readdir(dir));
  const wanted = new Set();
  for (const entry of entries) {
    const relative = inboxFile(entry);
    const name = path.basename(relative);
    wanted.add(name);
    if (present.has(name)) continue;
    const answer = !entry.body && entry.conversationId && lastAnswer ? await lastAnswer(entry.conversationId).catch(() => null) : null;
    await writeFolderFile(folder, relative, render(entry, entry.body || answer));
  }
  for (const name of present) if (FILE.test(name) && !wanted.has(name)) await fs.rm(path.join(dir, name), { force: true });
}

/** The entry's text: its file's body when there is one (the person may have edited it), else what the entry carries. */
export async function inboxEntryText(folder, entry) {
  const text = folder ? await readFolderFile(folder, inboxFile(entry)).catch(() => null) : null;
  if (text === null) return entry.body || "";
  try { return splitFrontMatter(text).body.trim(); } catch { return text.trim(); }
}
