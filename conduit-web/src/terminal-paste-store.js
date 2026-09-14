import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

/**
 * A terminal cannot render an image, so a pasted one is spooled to a file and
 * only its path is typed into the PTY. That is exactly what a native terminal
 * does when a file is dragged onto it, so the TUI reading the prompt sees an
 * ordinary bracketed paste of a path and needs no knowledge of Conduit.
 *
 * The spool is deliberately not chat attachment storage: nothing here belongs
 * to a chat, nothing is announced to a harness, and entries are disposable.
 */
export const DEFAULT_MAX_PASTE_BYTES = 25 * 1024 * 1024;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;

const SIGNATURES = [
  { type: "image/png", extension: ".png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { type: "image/jpeg", extension: ".jpg", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/gif", extension: ".gif", test: (b) => ["GIF87a", "GIF89a"].includes(b.subarray(0, 6).toString("ascii")) },
  { type: "image/webp", extension: ".webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

/** The bytes decide the type. A pasted blob carries no name worth trusting. */
export function sniffImage(head) {
  return SIGNATURES.find((signature) => signature.test(head)) || null;
}

function pasteLimitError(maxBytes) {
  return Object.assign(new Error(`Pasted image exceeds the ${maxBytes} byte limit`), {
    code: "paste_too_large",
    status: 413,
    maxBytes,
  });
}

/**
 * The head is held back until it is long enough to identify, so a file is only
 * ever created once the bytes are known to be an image Conduit can name.
 */
function limitedStream(maxBytes, onHead) {
  let received = 0;
  let head = Buffer.alloc(0);
  let identified = false;
  return new Transform({
    transform(chunk, encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding);
      received += bytes.length;
      if (received > maxBytes) return callback(pasteLimitError(maxBytes));
      if (identified) return callback(null, bytes);
      head = Buffer.concat([head, bytes]);
      if (head.length < 12) return callback();
      identified = true;
      const error = onHead(head);
      callback(error || null, error ? undefined : head);
    },
    flush(callback) {
      if (identified) return callback();
      if (!head.length) return callback(Object.assign(new Error("Pasted data was empty"), { code: "paste_empty", status: 400 }));
      callback(onHead(head) || null, head);
    },
  });
}

export class TerminalPasteStore {
  constructor({ root, maxBytes = DEFAULT_MAX_PASTE_BYTES, retentionMs = DEFAULT_RETENTION_MS } = {}) {
    this.root = root;
    this.maxBytes = Number.isSafeInteger(maxBytes) && maxBytes >= 1 ? maxBytes : DEFAULT_MAX_PASTE_BYTES;
    this.retentionMs = retentionMs;
  }

  /**
   * A pasted path is typed into a shell, so the filename must never need
   * quoting: only a timestamp, a random suffix and a known extension.
   */
  filename(extension, at = new Date()) {
    const stamp = at.toISOString().replace(/[:.]/g, "-").slice(0, 19);
    return `paste-${stamp}-${crypto.randomBytes(3).toString("hex")}${extension}`;
  }

  async write(readable, { now = new Date() } = {}) {
    await fsp.mkdir(this.root, { recursive: true });
    let sniffed = null;
    const body = limitedStream(this.maxBytes, (head) => {
      sniffed = sniffImage(head);
      if (sniffed) return null;
      return Object.assign(new Error("Pasted data was not a PNG, JPEG, GIF or WebP image"), {
        code: "paste_unsupported_type",
        status: 415,
      });
    });

    // The name cannot be chosen before the type is known, so the bytes land in
    // a scratch file and are renamed once the signature has been read.
    const scratch = path.join(this.root, `.partial-${crypto.randomUUID()}`);
    try {
      await pipeline(readable, body, (await fsp.open(scratch, "wx")).createWriteStream());
    } catch (error) {
      await fsp.rm(scratch, { force: true });
      throw error;
    }
    const name = this.filename(sniffed.extension, now);
    const file = path.join(this.root, name);
    await fsp.rename(scratch, file);
    const { size } = await fsp.stat(file);
    void this.prune(now).catch(() => {});
    return { name, path: file, size, type: sniffed.type };
  }

  /** Spooled pastes are disposable; age them out so the directory stays bounded. */
  async prune(now = new Date()) {
    const entries = await fsp.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const cutoff = now.getTime() - this.retentionMs;
    await Promise.all(entries.filter((entry) => entry.isFile()).map(async (entry) => {
      const file = path.join(this.root, entry.name);
      const stat = await fsp.stat(file).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fsp.rm(file, { force: true });
    }));
  }
}
