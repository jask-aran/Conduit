import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { chatDirectory } from "./chat-store.js";

const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORED_FILE = /^([0-9a-f-]{36})--(.+)$/i;
const MAX_NAME_BYTES = 180;

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

export class AttachmentStore {
  constructor(chatStore) {
    this.chatStore = chatStore;
  }

  directories(project, chatId) {
    const root = chatDirectory(project, chatId);
    return { root, attachments: path.join(root, "attachments"), partial: path.join(root, ".partial") };
  }

  async list(project, chatId) {
    const { attachments } = this.directories(project, chatId);
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
        type: mimeFor(match[2]),
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
    if (await this.resolve(project, chatId, attachmentId)) {
      throw Object.assign(new Error("That attachment ID already exists"), { code: "EEXIST" });
    }
    const { attachments, partial } = this.directories(project, chatId);
    await Promise.all([fsp.mkdir(attachments, { recursive: true }), fsp.mkdir(partial, { recursive: true })]);
    const name = safeAttachmentName(suppliedName);
    const storedName = `${attachmentId.toLowerCase()}--${name}`;
    const partPath = path.join(partial, `${attachmentId.toLowerCase()}.part`);
    const finalPath = path.join(attachments, storedName);
    const stream = fs.createWriteStream(partPath, { flags: "wx" });
    try {
      await pipeline(readable, stream);
      await fsp.rename(partPath, finalPath);
      this.chatStore.markAttachments(chatId, true);
      const stat = await fsp.stat(finalPath);
      return { id: attachmentId.toLowerCase(), name, storedName, size: stat.size, modifiedAt: stat.mtime.toISOString(), type: mimeFor(name) };
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
    return { ...item, file, stream: () => fs.createReadStream(file) };
  }
}

export function newAttachmentId() {
  return crypto.randomUUID();
}
