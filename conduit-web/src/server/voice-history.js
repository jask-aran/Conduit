import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const KEPT = 200;
const SERVICES = new Set(["hex", "hub", "cloud"]);

/**
 * The text of each finished dictation and what transcribed it, for Settings › Voice › History. Clients report their
 * own dictations when they finish, so one that Hex transcribed on the person's computer is listed with the hub's:
 * its text comes here, its audio never does.
 */
export class VoiceHistory {
  constructor({ filePath }) {
    this.filePath = filePath;
    this.entries = null;
    this.writing = Promise.resolve();
  }

  async load() {
    if (this.entries) return this.entries;
    try { this.entries = JSON.parse(await fs.readFile(this.filePath, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; this.entries = []; }
    return this.entries;
  }

  // One write at a time: two devices can finish a dictation together.
  save() {
    this.writing = this.writing.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporary = `${this.filePath}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(this.entries), { mode: 0o600 });
      await fs.rename(temporary, this.filePath);
    });
    return this.writing;
  }

  async add({ text, service, model, seconds }, client) {
    const words = String(text || "").trim().slice(0, 20_000);
    if (!words || !SERVICES.has(service)) throw Object.assign(new Error("A dictation needs its text and what transcribed it"), { status: 400, code: "invalid_dictation" });
    const entries = await this.load();
    entries.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), text: words, service, model: String(model || "").slice(0, 120),
      seconds: Math.max(0, Math.round(Number(seconds) || 0)), client });
    entries.length = Math.min(entries.length, KEPT);
    await this.save();
  }

  async clear() {
    this.entries = [];
    await this.save();
  }
}
