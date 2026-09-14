import fs from "node:fs/promises";
import path from "node:path";

/**
 * Composer drafts and parked prompts. Drafts are written constantly and evict
 * by age; stash entries are deliberate, so the cap refuses rather than evicting
 * something the user chose to keep.
 *
 * Attachments are referenced by id, never copied. The rows belong to their
 * origin chat; `retainedAttachmentIds` is what stops the client's attachment
 * cleanup from deleting bytes a stash entry still points at.
 */
const MAX_DRAFT_BYTES = 128 * 1024;
const MAX_DRAFTS = 200;
const MAX_ATTACHMENTS = 8;
const STASH_ID = /^st_[a-z0-9]{10,32}$/;

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

function normalizeAttachmentIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item) => typeof item === "string" && item.length > 0 && item.length <= 200))]
    .slice(0, MAX_ATTACHMENTS);
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return Buffer.byteLength(value, "utf8") > MAX_DRAFT_BYTES
    ? Buffer.from(value, "utf8").subarray(0, MAX_DRAFT_BYTES).toString("utf8").replace(/�$/, "")
    : value;
}

function normalizeEntry(value) {
  if (!isRecord(value)) return null;
  const text = normalizeText(value.text);
  const attachmentIds = normalizeAttachmentIds(value.attachmentIds);
  if (!text.trim() && !attachmentIds.length) return null;
  const savedAt = typeof value.savedAt === "string" ? value.savedAt : new Date().toISOString();
  return { text, attachmentIds, savedAt };
}

export function normalizeDraftDocument(raw) {
  const document = { version: 1, drafts: {}, stash: [] };
  if (!isRecord(raw)) return document;
  if (isRecord(raw.drafts)) {
    const entries = Object.entries(raw.drafts)
      .flatMap(([chatId, value]) => {
        const entry = typeof chatId === "string" && chatId.length <= 200 ? normalizeEntry(value) : null;
        return entry ? [[chatId, entry]] : [];
      })
      .sort((left, right) => right[1].savedAt.localeCompare(left[1].savedAt))
      .slice(0, MAX_DRAFTS);
    document.drafts = Object.fromEntries(entries);
  }
  if (Array.isArray(raw.stash)) {
    document.stash = raw.stash.flatMap((value) => {
      if (!isRecord(value) || typeof value.id !== "string" || !STASH_ID.test(value.id)) return [];
      const entry = normalizeEntry(value);
      if (!entry) return [];
      return [{
        id: value.id,
        chatId: typeof value.chatId === "string" ? value.chatId.slice(0, 200) : "",
        ...entry,
      }];
    }).slice(0, 1);
  }
  return document;
}

export class DraftStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.document = { version: 1, drafts: {}, stash: [] };
    this.writing = Promise.resolve();
  }

  async load() {
    try {
      this.document = normalizeDraftDocument(JSON.parse(await fs.readFile(this.filePath, "utf8")));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return this.snapshot();
  }

  snapshot() {
    return {
      drafts: Object.fromEntries(Object.entries(this.document.drafts).map(([id, entry]) => [id, { ...entry }])),
      stash: this.document.stash.map((entry) => ({ ...entry })),
    };
  }

  /** Every attachment a draft or stash entry still points at. */
  retainedAttachmentIds() {
    const retained = new Set();
    for (const entry of Object.values(this.document.drafts)) for (const id of entry.attachmentIds) retained.add(id);
    for (const entry of this.document.stash) for (const id of entry.attachmentIds) retained.add(id);
    return retained;
  }

  draft(chatId) {
    const entry = this.document.drafts[chatId];
    return entry ? { ...entry } : null;
  }

  stashEntry(id) {
    const entry = this.document.stash.find((candidate) => candidate.id === id);
    return entry ? { ...entry } : null;
  }

  // Writes are serialized so a burst of draft saves cannot interleave two
  // rename() calls onto the same path.
  async #persist() {
    const write = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(this.document, null, 2)}\n`, "utf8");
      await fs.rename(temporary, this.filePath);
    });
    this.writing = write.catch(() => {});
    await write;
  }

  async saveDraft(chatId, input) {
    if (typeof chatId !== "string" || !chatId || chatId.length > 200) {
      throw Object.assign(new Error("Unknown chat"), { code: "unknown_chat", status: 400 });
    }
    const entry = normalizeEntry({ ...input, savedAt: new Date().toISOString() });
    if (!entry) delete this.document.drafts[chatId];
    else {
      this.document.drafts[chatId] = entry;
      const ordered = Object.entries(this.document.drafts)
        .sort((left, right) => right[1].savedAt.localeCompare(left[1].savedAt))
        .slice(0, MAX_DRAFTS);
      this.document.drafts = Object.fromEntries(ordered);
    }
    await this.#persist();
    return this.draft(chatId);
  }

  async dropChat(chatId) {
    if (!Object.hasOwn(this.document.drafts, chatId)) return;
    delete this.document.drafts[chatId];
    await this.#persist();
  }

  async pushStash({ chatId, text, attachmentIds }) {
    const entry = normalizeEntry({ text, attachmentIds });
    if (!entry) {
      throw Object.assign(new Error("Nothing to stash"), { code: "empty_prompt", status: 400 });
    }
    const stashed = { id: `st_${Math.random().toString(36).slice(2, 12)}`, chatId: typeof chatId === "string" ? chatId.slice(0, 200) : "", ...entry };
    this.document.stash = [stashed];
    if (typeof chatId === "string" && chatId) delete this.document.drafts[chatId];
    await this.#persist();
    return { ...stashed };
  }

  async removeStash(id) {
    const entry = this.stashEntry(id);
    if (!entry) throw Object.assign(new Error("Unknown stash entry"), { code: "unknown_stash", status: 404 });
    this.document.stash = this.document.stash.filter((candidate) => candidate.id !== id);
    await this.#persist();
    return entry;
  }
}

export const DRAFT_LIMITS = { MAX_DRAFT_BYTES, MAX_DRAFTS, MAX_STASH: 1, MAX_ATTACHMENTS };
