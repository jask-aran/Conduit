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

  async capture({ chatId, projectId, projectKind, workingRoot }) {
    const chatKey = keyFor(chatId);
    const previous = this.queues.get(chatKey) || Promise.resolve();
    const task = previous.then(() => this.#capture({ chatId, projectId, projectKind, workingRoot, chatKey }));
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
    return (await this.#checkpoints(chatId)).at(-1) || null;
  }

  async review(chatId, workingRoot, baseline = "chat") {
    const checkpoint = await this.#checkpoint(chatId, workingRoot, baseline);
    if (!checkpoint || path.resolve(workingRoot) !== checkpoint.workingRoot) return null;
    const git = (args, maxBuffer = 2 * 1024 * 1024) => runBoundedGit(checkpoint.workingRoot, args, { maxBuffer });
    const currentPaths = checkpoint.repository
      ? (await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"])).stdout.split("\0").filter(Boolean).map((record) => record.slice(3))
      : await this.#workspacePaths(checkpoint.workingRoot);
    const paths = new Set([...Object.keys(checkpoint.entries), ...currentPaths]);
    if (checkpoint.repository && checkpoint.head) {
      const changed = await git(["diff", checkpoint.head, "--name-only", "-z", "--no-renames", "--no-ext-diff"]);
      for (const relativePath of changed.stdout.split("\0").filter(Boolean)) paths.add(relativePath);
    }
    const files = [];
    for (const relativePath of [...paths].sort()) {
      const comparison = await this.#compare(checkpoint, relativePath, git, baseline === "turn" ? "turn" : "session");
      if (comparison.kind === "text" && comparison.original === comparison.modified) continue;
      if (comparison.kind === "unavailable" && comparison.reason === "unchanged") continue;
      const stat = await fs.stat(path.join(checkpoint.workingRoot, relativePath)).catch(() => null);
      files.push({ path: relativePath, status: comparison.status, available: comparison.kind === "text", changedAt: stat?.mtimeMs || Date.parse(checkpoint.createdAt) });
    }
    files.sort((left, right) => right.changedAt - left.changedAt || left.path.localeCompare(right.path));
    return { id: checkpoint.id, turnId: checkpoint.turnId, createdAt: checkpoint.createdAt, files };
  }

  async compare(chatId, workingRoot, relativePath, checkpointId, baseline = "chat") {
    const checkpoint = checkpointId
      ? (await this.#checkpoints(chatId)).find((item) => item.id === checkpointId)
      : await this.#checkpoint(chatId, workingRoot, baseline);
    if (!checkpoint || path.resolve(workingRoot) !== checkpoint.workingRoot) return null;
    if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\0") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid checkpoint path");
    const git = (args, maxBuffer = 2 * 1024 * 1024) => runBoundedGit(checkpoint.workingRoot, args, { maxBuffer });
    return this.#compare(checkpoint, relativePath, git, baseline === "turn" ? "turn" : "session");
  }

  async #capture({ chatId, projectId, projectKind, workingRoot, chatKey }) {
    const root = path.resolve(workingRoot);
    const git = (args, maxBuffer = 2 * 1024 * 1024) => runBoundedGit(root, args, { maxBuffer });
    const repository = projectKind === "workspace";
    let head = null;
    let paths;
    if (repository) {
      const [{ stdout: topLevel }, { stdout: status }, revision] = await Promise.all([
        git(["rev-parse", "--show-toplevel"]),
        git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]),
        git(["rev-parse", "--verify", "HEAD"]).then(({ stdout }) => stdout.trim(), () => null),
      ]);
      if (path.resolve(topLevel.trim()) !== root) throw new Error("Workspace root is not the Git repository root");
      head = revision;
      paths = status.split("\0").filter(Boolean).map((record) => record.slice(3));
    } else {
      paths = await this.#workspacePaths(root);
    }
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
        entries[relativePath] = { kind: "unavailable", size: stat.size, modifiedAt: stat.mtimeMs };
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
    await this.#write(file, { version: 1, id, chatId, projectId, workingRoot: root, repository, turnId: null, createdAt, head, entries });
    const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    await Promise.all(names.slice(0, -MAX_CHECKPOINTS_PER_CHAT).map((name) => fs.unlink(path.join(directory, name))));
    return { id, file, turnId: null };
  }

  async #compare(checkpoint, relativePath, git, scope = "session") {
    const stored = checkpoint.entries[relativePath];
    if (stored?.kind === "unavailable") {
      const stat = await fs.stat(path.join(checkpoint.workingRoot, relativePath)).catch(() => null);
      if (stat?.isFile() && stat.size === stored.size && stat.mtimeMs === stored.modifiedAt) return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "unchanged", message: "This file did not change from the selected checkpoint." };
      return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "unavailable", message: "The selected checkpoint is unavailable for this file." };
    }
    if (stored?.kind === "unsupported") return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "unsupported", message: "The selected checkpoint is unavailable for this file." };
    let original = Buffer.alloc(0);
    if (stored?.kind === "file") original = Buffer.from(stored.content, "base64");
    else if (!stored && checkpoint.head) {
      try {
        const { stdout: size } = await git(["cat-file", "-s", `${checkpoint.head}:${relativePath}`]);
        if (Number(size) > MAX_FILE_BYTES) return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "size", message: "This file exceeds the 1 MiB checkpoint comparison limit." };
        original = Buffer.from((await git(["cat-file", "blob", `${checkpoint.head}:${relativePath}`], MAX_FILE_BYTES + 1)).stdout);
      } catch { original = Buffer.alloc(0); }
    }
    let modified = Buffer.alloc(0);
    try {
      const target = path.resolve(checkpoint.workingRoot, relativePath);
      if (target !== checkpoint.workingRoot && target.startsWith(`${checkpoint.workingRoot}${path.sep}`)) {
        const stat = await fs.stat(target);
        if (!stat.isFile()) throw Object.assign(new Error(), { code: "unsupported" });
        if (stat.size > MAX_FILE_BYTES) return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "size", message: "This file exceeds the 1 MiB checkpoint comparison limit." };
        modified = await fs.readFile(target);
      }
    } catch (error) {
      if (error.code !== "ENOENT") return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "unsupported", message: "Checkpoint comparison is available for regular files only." };
    }
    if (original.equals(modified)) return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "unchanged", message: "This file did not change from the selected checkpoint." };
    const decode = (value) => new TextDecoder("utf-8", { fatal: true }).decode(value);
    let originalText;
    let modifiedText;
    try { originalText = decode(original); modifiedText = decode(modified); }
    catch { return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "binary", message: "Binary or non-UTF-8 files cannot be shown as a text comparison." }; }
    return { kind: "text", path: relativePath, oldPath: relativePath, scope, status: original.length === 0 ? "A" : modified.length === 0 ? "D" : "M", original: originalText, modified: modifiedText };
  }

  async #checkpoint(chatId, workingRoot, baseline) {
    const root = path.resolve(workingRoot);
    const checkpoints = (await this.#checkpoints(chatId)).filter((checkpoint) => checkpoint.version === 1 && typeof checkpoint.repository === "boolean" && checkpoint.workingRoot === root);
    return (baseline === "turn" ? checkpoints.at(-1) : checkpoints[0]) || null;
  }

  async #checkpoints(chatId) {
    const directory = path.join(this.root, keyFor(chatId));
    const names = await fs.readdir(directory).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    const checkpoints = [];
    for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
      try { checkpoints.push(JSON.parse(await fs.readFile(path.join(directory, name), "utf8"))); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return checkpoints;
  }

  async #workspacePaths(root) {
    const files = [];
    const pending = [""];
    while (pending.length && files.length < 10_000) {
      const relativeDirectory = pending.pop();
      const directory = path.join(root, relativeDirectory);
      const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
      for (const entry of entries) {
        if (!relativeDirectory && (entry.name === ".conduit" || entry.name === ".git")) continue;
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        if (entry.isDirectory()) pending.push(relativePath);
        else if (entry.isFile()) files.push(relativePath);
        if (files.length >= 10_000) break;
      }
    }
    return files;
  }

  async #write(file, value) {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    await fs.rename(temporary, file);
  }
}
