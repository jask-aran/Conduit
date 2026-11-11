import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { readFolderFile, splitFrontMatter, writeFolderFile } from "./routine-files.js";

/*
 * The body is the file's once written: an edit there is what jbot reads next. The front matter follows the entry's
 * record in the agent's document, the source of its status, since a run marks entries handled in the same commit that
 * moves its cursors.
 */
const INBOX_DIR = "inbox";
const FILE = /^\d{4}-\d{2}-\d{2}-i-?\d+-[^/]*\.md$/;

const slug = (text) => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "entry";

/** Named from what never changes on the entry: when it came, its id, its title. */
export const inboxFile = (entry) => `${INBOX_DIR}/${entry.at.slice(0, 10)}-${entry.id}-${slug(entry.title === "Note" ? entry.headline : entry.title)}.md`;

const header = (entry) => Object.fromEntries(Object.entries({
  title: entry.title || "", kind: entry.kind, level: entry.level, at: entry.at, status: entry.status,
  handledAt: entry.handledAt, outcome: entry.outcome, for: entry.for?.length ? entry.for : undefined, headline: entry.headline,
}).filter(([, value]) => value !== undefined && value !== null && value !== ""));
const render = (entry, body) => `---\n${YAML.stringify(header(entry), { lineWidth: 0 })}---\n\n${String(body || "").trim()}\n`;

export async function writeInboxFile(folder, entry, { text } = {}) {
  const relative = inboxFile(entry);
  await fs.mkdir(path.join(folder, INBOX_DIR), { recursive: true });
  const current = await readFolderFile(folder, relative).catch(() => null);
  if (current === null) return writeFolderFile(folder, relative, render(entry, text || entry.body || entry.headline));
  let body;
  try { body = splitFrontMatter(current).body; } catch { body = current; }
  const next = render(entry, body);
  if (next !== current) await writeFolderFile(folder, relative, next);
}

export async function syncInboxFiles(folder, entries, { textOf, lastAnswer } = {}) {
  if (!folder) return;
  const dir = path.join(folder, INBOX_DIR);
  await fs.mkdir(dir, { recursive: true });
  const present = new Set(await fs.readdir(dir));
  const wanted = new Set();
  for (const entry of entries) {
    const name = path.basename(inboxFile(entry));
    wanted.add(name);
    let text = null;
    if (!present.has(name)) {
      text = textOf ? await textOf(entry).catch(() => "") : entry.body || "";
      if (!text && entry.conversationId && lastAnswer) text = await lastAnswer(entry.conversationId).catch(() => null);
    }
    await writeInboxFile(folder, entry, { text });
  }
  for (const name of present) if (FILE.test(name) && !wanted.has(name)) await fs.rm(path.join(dir, name), { force: true });
}

/** The file's body wins: the person may have edited it. */
export async function inboxEntryText(agent, entry) {
  const text = agent.folder ? await readFolderFile(agent.folder, inboxFile(entry)).catch(() => null) : null;
  if (text === null) return agent.entryText ? agent.entryText(entry) : entry.body || "";
  try { return splitFrontMatter(text).body.trim(); } catch { return text.trim(); }
}
