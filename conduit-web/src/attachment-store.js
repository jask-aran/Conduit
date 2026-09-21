import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { chatDirectory } from "./chat-store.js";
import { ensureChatTree } from "./owned-paths.js";

const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORED_FILE = /^([0-9a-f-]{36})--(.+)$/i;
const MAX_NAME_BYTES = 180;
export const DEFAULT_MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export function isAttachmentId(value) {
  return ATTACHMENT_ID.test(String(value || ""));
}

function truncateUtf8(value, bytes) {
  const characters = Array.from(String(value || ""));
  while (Buffer.byteLength(characters.join(""), "utf8") > bytes) characters.pop();
  return characters.join("");
}

export function safeAttachmentName(value) {
  const basename = path.basename(String(value || "").replaceAll("\\", "/"))
    .replace(/\p{Cc}/gu, "")
    .replaceAll("/", "")
    .replaceAll("\\", "")
    .trim()
    .replace(/^\.+$/, "");
  return truncateUtf8(basename || "attachment", MAX_NAME_BYTES) || "attachment";
}

function mimeFor(name) {
  const extension = path.extname(name).toLowerCase();
  return ({
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".svg": "image/svg+xml", ".pdf": "application/pdf", ".json": "application/json",
    ".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv",
  })[extension] || "application/octet-stream";
}

function attachmentLimitError(maxBytes) {
  return Object.assign(new Error(`Attachment exceeds the ${maxBytes} byte limit`), {
    code: "attachment_too_large",
    status: 413,
    maxBytes,
  });
}

function limitedReadable(maxBytes) {
  let received = 0;
  return new Transform({
    transform(chunk, encoding, callback) {
      received += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk), encoding);
      if (received > maxBytes) return callback(attachmentLimitError(maxBytes));
      callback(null, chunk);
    },
  });
}

async function excludeConduitFromGit(projectPath) {
  const excludeFile = await new Promise((resolve, reject) => {
    const child = spawn("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: projectPath,
      stdio: ["ignore", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(output.trim()) : resolve(null));
  });
  if (!excludeFile) return null;
  const resolved = path.isAbsolute(excludeFile) ? excludeFile : path.resolve(projectPath, excludeFile);
  try {
    const stat = await fsp.lstat(resolved);
    if (!stat.isFile() || stat.isSymbolicLink()) return "Could not update Git's local exclude file safely";
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fsp.mkdir(path.dirname(resolved), { recursive: true });
  }
  const existing = await fsp.readFile(resolved, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error));
  if (!existing.split("\n").includes(".conduit/")) {
    const separator = existing && !existing.endsWith("\n") ? "\n" : "";
    await fsp.appendFile(resolved, `${separator}# Conduit chat attachments\n.conduit/\n`, "utf8");
  }
  return null;
}

async function mimeForFile(file, name) {
  const expected = mimeFor(name);
  if (!expected.startsWith("image/") || expected === "image/svg+xml") return expected;
  const handle = await fsp.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const buffer = Buffer.alloc(12);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (expected === "image/png" && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return expected;
    if (expected === "image/jpeg" && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return expected;
    if (expected === "image/gif" && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) return expected;
    if (expected === "image/webp" && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") return expected;
    return "application/octet-stream";
  } finally {
    await handle.close();
  }
}

export class AttachmentStore {
  constructor(chatStore, { maxBytes = DEFAULT_MAX_ATTACHMENT_BYTES } = {}) {
    this.chatStore = chatStore;
    this.maxBytes = Number.isSafeInteger(maxBytes) && maxBytes >= 1 ? maxBytes : DEFAULT_MAX_ATTACHMENT_BYTES;
  }

  directories(project, chatId) {
    const root = chatDirectory(project, chatId);
    return { root, attachments: path.join(root, "attachments"), partial: path.join(root, ".partial"), messages: path.join(root, "attachment-messages.jsonl") };
  }

  async recordMessage(project, chatId, identity, items) {
    if (!items?.length) return;
    const { root, messages } = this.directories(project, chatId);
    await fsp.mkdir(root, { recursive: true });
    const attachments = items.map(({ id, name, size, type }) => ({ id, name, size, type }));
    await fsp.appendFile(messages, `${JSON.stringify({ identity, attachments, createdAt: new Date().toISOString() })}\n`, "utf8");
  }

  async discardMessages(project, chatId, identities) {
    if (!identities?.length) return;
    const { root, messages } = this.directories(project, chatId);
    await fsp.mkdir(root, { recursive: true });
    await fsp.appendFile(messages, identities.map((identity) => JSON.stringify({ discardedIdentity: identity })).join("\n") + "\n", "utf8");
  }

  async messageRows(project, chatId) {
    const { messages } = this.directories(project, chatId);
    return (await fsp.readFile(messages, "utf8").catch((error) => error.code === "ENOENT" ? "" : Promise.reject(error)))
      .split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
  }

  /**
   * The attachments this chat has already sent with a message.
   *
   * Stored files outlive the message they were sent with, so "everything in
   * the directory" is not what the composer should be holding -- without this
   * the composer of a chat reopened anywhere else fills up with the images of
   * every message already in it. The send ledger answers for every harness,
   * which the Pi session file cannot: it is the only record another backend
   * writes at all.
   *
   * A discarded turn counts too. Its files are no longer decorating anything,
   * but they were deliberately sent once, and returning them to the composer
   * of whoever opens the chat next is a stranger outcome than leaving them.
   */
  async announcedIds(project, chatId) {
    const rows = await this.messageRows(project, chatId);
    return new Set(rows.flatMap((row) => (row.attachments || []).map((item) => String(item.id || "").toLowerCase())).filter(Boolean));
  }

  /**
   * Attach stored files to the user messages that own them.
   *
   * `fromStart` says whether `transcript` begins at the chat's first message.
   * Only an id can find a message inside a window; the anchor/ordinal and
   * content fallbacks below count from the beginning of what they are given,
   * so against a one-turn sync or a later page they resolve "the first user
   * message of the chat" to whatever happens to lead the window -- which is
   * how a regenerated turn came back wearing the opening message's image.
   */
  async decorateMessages(project, chatId, transcript, { fromStart = true } = {}) {
    const rows = await this.messageRows(project, chatId);
    const identityKey = (identity) => identity ? JSON.stringify(identity) : "";
    const discarded = new Set(rows.flatMap((row) => row.discardedIdentity ? [identityKey(row.discardedIdentity)] : []));
    const activeRows = rows.filter((row) => !row.identity || !discarded.has(identityKey(row.identity)));
    const used = new Set();
    const byId = new Map(activeRows.flatMap((row) => row.identity?.messageId ? [[row.identity.messageId, row]] : []));
    // Rows written before Conduit owned Pi's message ids anchor on raw session
    // entry ids, so a derived `pi:<entryId>` message answers to both.
    const positions = new Map();
    (transcript || []).forEach((item, index) => {
      if (!item?.id) return;
      positions.set(item.id, index);
      if (typeof item.id === "string" && item.id.startsWith("pi:")) positions.set(item.id.slice(3), index);
    });
    for (const row of fromStart ? activeRows : []) {
      const anchor = row.identity?.afterMessageId;
      if (!row.identity || !("afterMessageId" in row.identity)) continue;
      if (anchor && !positions.has(anchor)) continue;
      const ordinal = Number.isSafeInteger(row.identity.ordinal) ? row.identity.ordinal : 0;
      const start = anchor && positions.has(anchor) ? positions.get(anchor) + 1 : 0;
      const candidate = (transcript || []).slice(start).filter((item) => item.role === "user")[ordinal];
      if (candidate?.id) byId.set(candidate.id, row);
    }
    return (transcript || []).map((item) => {
      if (item.role !== "user" || item.attachments?.length) return item;
      const native = byId.get(item.id);
      if (native) return { ...item, attachments: native.attachments || [] };
      if (!fromStart) return item;
      // Read compatibility for attachment records written before harness IDs
      // became authoritative. New records never store message text.
      const index = activeRows.findIndex((row, candidate) => !used.has(candidate) && row.message === item.content);
      if (index < 0) return item;
      used.add(index);
      return { ...item, attachments: activeRows[index].attachments || [] };
    });
  }

  /** Absolute path of a stored attachment, for adapters that take files natively. */
  pathFor(project, chatId, item) {
    return path.join(this.directories(project, chatId).attachments, item.storedName);
  }

  async list(project, chatId) {
    const { attachments } = await ensureChatTree(project, chatId);
    let entries = [];
    try { entries = await fsp.readdir(attachments, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return []; throw error; }
    const items = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      const match = entry.name.match(STORED_FILE);
      if (!match || !isAttachmentId(match[1])) continue;
      const file = path.join(attachments, entry.name);
      const stat = await fsp.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      items.push({
        id: match[1].toLowerCase(),
        name: match[2],
        storedName: entry.name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        type: await mimeForFile(file, match[2]),
      });
    }
    return items.sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt));
  }

  async resolve(project, chatId, attachmentId) {
    if (!isAttachmentId(attachmentId)) return null;
    return (await this.list(project, chatId)).find((item) => item.id === attachmentId.toLowerCase()) || null;
  }

  async resolveMany(project, chatId, ids) {
    const requested = [...new Set((ids || []).map((id) => String(id).toLowerCase()))];
    if (requested.some((id) => !isAttachmentId(id))) throw Object.assign(new Error("Invalid attachment ID"), { code: "attachment_not_found" });
    const byId = new Map((await this.list(project, chatId)).map((item) => [item.id, item]));
    const found = requested.map((id) => byId.get(id));
    if (found.some((item) => !item)) throw Object.assign(new Error("Attachment does not belong to this chat"), { code: "attachment_not_found" });
    return found;
  }

  async write(project, chatId, attachmentId, suppliedName, readable) {
    if (!isAttachmentId(attachmentId)) throw Object.assign(new Error("Invalid attachment ID"), { code: "invalid_attachment_id" });
    const existingAttachments = await this.list(project, chatId);
    if (existingAttachments.some((item) => item.id === attachmentId.toLowerCase())) {
      throw Object.assign(new Error("That attachment ID already exists"), { code: "EEXIST" });
    }
    const { attachments, partial } = await ensureChatTree(project, chatId);
    const name = safeAttachmentName(suppliedName);
    const storedName = `${attachmentId.toLowerCase()}--${name}`;
    const partPath = path.join(partial, `${attachmentId.toLowerCase()}.part`);
    const finalPath = path.join(attachments, storedName);
    const stream = fs.createWriteStream(partPath, { flags: "wx" });
    try {
      await pipeline(readable, limitedReadable(this.maxBytes), stream);
      await fsp.rename(partPath, finalPath);
      const workspaceWarning = existingAttachments.length === 0
        ? await excludeConduitFromGit(project.workingRoot).catch(() => "Could not add .conduit/ to Git's local exclude file")
        : null;
      this.chatStore.markAttachments(chatId, true);
      const stat = await fsp.stat(finalPath);
      return {
        id: attachmentId.toLowerCase(),
        name,
        storedName,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        type: await mimeForFile(finalPath, name),
        workspaceWarning,
      };
    } catch (error) {
      stream.destroy();
      await fsp.rm(partPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async delete(project, chatId, attachmentId) {
    const item = await this.resolve(project, chatId, attachmentId);
    if (!item) return false;
    const file = path.join(this.directories(project, chatId).attachments, item.storedName);
    const stat = await fsp.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    await fsp.unlink(file);
    this.chatStore.markAttachments(chatId, (await this.list(project, chatId)).length > 0);
    return true;
  }

  async open(project, chatId, attachmentId) {
    const item = await this.resolve(project, chatId, attachmentId);
    if (!item) return null;
    const file = path.join(this.directories(project, chatId).attachments, item.storedName);
    const stat = await fsp.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return {
      ...item,
      chatId,
      file,
      stream: () => fs.createReadStream(file, { flags: constants.O_RDONLY | (constants.O_NOFOLLOW || 0) }),
    };
  }
}
