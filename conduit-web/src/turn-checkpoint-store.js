import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runBoundedGit } from "./workspace-inspector.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const MAX_CHECKPOINTS_PER_CHAT = 50;

const keyFor = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);

export class TurnCheckpointStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.queues = new Map();
  }

  async capture({ chatId, projectId, workingRoot }) {
    const chatKey = keyFor(chatId);
    const previous = this.queues.get(chatKey) || Promise.resolve();
    const task = previous.then(() => this.#capture({ chatId, projectId, workingRoot, chatKey }));
    const queued = task.catch(() => {});
    this.queues.set(chatKey, queued);
    try { return await task; }
    finally { if (this.queues.get(chatKey) === queued) this.queues.delete(chatKey); }
  }

  async assignTurn(checkpoint, turnId) {
    if (!checkpoint || typeof turnId !== "string" || !turnId) return checkpoint;
    const content = JSON.parse(await fs.readFile(checkpoint.file, "utf8"));
    content.turnId = turnId;
    await this.#write(checkpoint.file, content);
    return { ...checkpoint, turnId };
  }

  async latest(chatId) {
    const directory = path.join(this.root, keyFor(chatId));
    const names = await fs.readdir(directory).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    const name = names.filter((item) => item.endsWith(".json")).sort().at(-1);
    return name ? JSON.parse(await fs.readFile(path.join(directory, name), "utf8")) : null;
  }

  async #capture({ chatId, projectId, workingRoot, chatKey }) {
    const root = path.resolve(workingRoot);
    const git = (args, maxBuffer = 2 * 1024 * 1024) => runBoundedGit(root, args, { maxBuffer });
    const [{ stdout: status }, head] = await Promise.all([
      git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]),
      git(["rev-parse", "--verify", "HEAD"]).then(({ stdout }) => stdout.trim(), () => null),
    ]);
    const paths = status.split("\0").filter(Boolean).map((record) => record.slice(3));
    const entries = {};
    let byteLength = 0;
    for (const relativePath of paths) {
      const target = path.resolve(root, relativePath);
      if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
      let stat;
      try { stat = await fs.lstat(target); }
      catch (error) {
        if (error.code === "ENOENT") { entries[relativePath] = { kind: "missing" }; continue; }
        throw error;
      }
      if (!stat.isFile()) { entries[relativePath] = { kind: "unsupported" }; continue; }
      if (stat.size > MAX_FILE_BYTES || byteLength + stat.size > MAX_CHECKPOINT_BYTES) {
        entries[relativePath] = { kind: "unavailable", size: stat.size };
        continue;
      }
      const content = await fs.readFile(target);
      byteLength += content.byteLength;
      entries[relativePath] = { kind: "file", mode: stat.mode & 0o777, content: content.toString("base64") };
    }
    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const directory = path.join(this.root, chatKey);
    const file = path.join(directory, `${createdAt.replaceAll(":", "-")}-${id}.json`);
    await fs.mkdir(directory, { recursive: true });
    await this.#write(file, { version: 1, id, chatId, projectId, workingRoot: root, turnId: null, createdAt, head, entries });
    const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    await Promise.all(names.slice(0, -MAX_CHECKPOINTS_PER_CHAT).map((name) => fs.unlink(path.join(directory, name))));
    return { id, file, turnId: null };
  }

  async #write(file, value) {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    await fs.rename(temporary, file);
  }
}
