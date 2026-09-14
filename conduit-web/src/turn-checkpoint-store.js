import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { runBoundedGit } from "./workspace-inspector.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const MAX_CHECKPOINTS_PER_CHAT = 50;
const ANCHOR_TAIL_BYTES = 64 * 1024;
const MAX_ANCHOR_HOPS = 8;

const keyFor = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
const FILE = Symbol("checkpoint file");

/**
 * Identifies the state a checkpoint captured. Two adjacent checkpoints with the
 * same digest mean the turn between them changed nothing, so the earlier one
 * carries no information and can be dropped.
 */
const digestOf = (checkpoint) => {
  if (checkpoint.digest) return checkpoint.digest;
  const hash = crypto.createHash("sha256").update(`${checkpoint.repository}\u0000${checkpoint.head ?? ""}`);
  for (const relativePath of Object.keys(checkpoint.entries).sort()) {
    const entry = checkpoint.entries[relativePath];
    hash.update(`\u0000${relativePath}\u0000${entry.kind}\u0000${entry.mode ?? ""}\u0000${entry.size ?? ""}\u0000${entry.content ?? ""}`);
  }
  return hash.digest("hex");
};

export class TurnCheckpointStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.queues = new Map();
  }

  async capture({ chatId, projectId, projectKind, workingRoot, sessionFile = null }) {
    const chatKey = keyFor(chatId);
    const previous = this.queues.get(chatKey) || Promise.resolve();
    const task = previous.then(() => this.#capture({ chatId, projectId, projectKind, workingRoot, sessionFile, chatKey }));
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

  async timeline(chatId, workingRoot) {
    const root = path.resolve(workingRoot);
    const checkpoints = await this.#prune((await this.#checkpoints(chatId))
      .filter((checkpoint) => checkpoint.version === 1 && checkpoint.workingRoot === root));
    // Checkpoints written before sequences existed fall back to counting.
    let counter = 0;
    return checkpoints
      .map(({ id, turnId, createdAt, sequence, anchorEntryId }) => ({ id, turnId, createdAt, anchorEntryId: anchorEntryId ?? null, sequence: (counter = sequence ?? counter + 1) }))
      .toReversed();
  }

  /**
   * Drops checkpoints that record the same state as the one after them. Their
   * turn changed nothing, so every remaining comparison keeps exactly the
   * content it had; only the empty boundary disappears. Sequence numbers are
   * stored, not positional, so pruning leaves gaps rather than renumbering.
   */
  async #prune(checkpoints) {
    const kept = [];
    const removed = [];
    for (const [index, checkpoint] of checkpoints.entries()) {
      const next = checkpoints[index + 1];
      if (next && digestOf(checkpoint) === digestOf(next)) removed.push(checkpoint);
      else kept.push(checkpoint);
    }
    await Promise.all(removed.map((checkpoint) => checkpoint[FILE]
      ? fs.unlink(checkpoint[FILE]).catch((error) => { if (error.code !== "ENOENT") throw error; })
      : Promise.resolve()));
    return kept;
  }

  async review(chatId, workingRoot, baseline = "chat", checkpointId = null) {
    const { checkpoint, targetCheckpoint } = await this.#comparisonRange(chatId, workingRoot, baseline, checkpointId);
    if (!checkpoint || path.resolve(workingRoot) !== checkpoint.workingRoot) return null;
    const git = (args, maxBuffer = 2 * 1024 * 1024) => runBoundedGit(checkpoint.workingRoot, args, { maxBuffer });
    const targetPaths = targetCheckpoint
      ? Object.keys(targetCheckpoint.entries)
      : checkpoint.repository
        ? (await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"])).stdout.split("\0").filter(Boolean).map((record) => record.slice(3))
        : await this.#workspacePaths(checkpoint.workingRoot);
    const paths = new Set([...Object.keys(checkpoint.entries), ...targetPaths]);
    if (checkpoint.repository && checkpoint.head && (!targetCheckpoint || targetCheckpoint.head !== checkpoint.head)) {
      const target = targetCheckpoint?.head || undefined;
      const changed = await git(["diff", checkpoint.head, ...(target ? [target] : []), "--name-only", "-z", "--no-renames", "--no-ext-diff"]);
      for (const relativePath of changed.stdout.split("\0").filter(Boolean)) paths.add(relativePath);
    }
    const files = [];
    for (const relativePath of [...paths].sort()) {
      const comparison = await this.#compare(checkpoint, relativePath, git, baseline === "turn" ? "turn" : "session", targetCheckpoint);
      if (comparison.kind === "text" && comparison.original === comparison.modified) continue;
      if (comparison.kind === "unavailable" && comparison.reason === "unchanged") continue;
      const stat = await fs.stat(path.join(checkpoint.workingRoot, relativePath)).catch(() => null);
      files.push({ path: relativePath, status: comparison.status, available: comparison.kind === "text", changedAt: stat?.mtimeMs || Date.parse(checkpoint.createdAt) });
    }
    files.sort((left, right) => right.changedAt - left.changedAt || left.path.localeCompare(right.path));
    return { id: checkpoint.id, turnId: checkpoint.turnId, createdAt: checkpoint.createdAt, files };
  }

  async compare(chatId, workingRoot, relativePath, checkpointId, baseline = "chat") {
    const { checkpoint, targetCheckpoint } = await this.#comparisonRange(chatId, workingRoot, baseline, checkpointId);
    if (!checkpoint || path.resolve(workingRoot) !== checkpoint.workingRoot) return null;
    if (typeof relativePath !== "string" || !relativePath || relativePath.includes("\0") || relativePath.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid checkpoint path");
    const git = (args, maxBuffer = 2 * 1024 * 1024) => runBoundedGit(checkpoint.workingRoot, args, { maxBuffer });
    return this.#compare(checkpoint, relativePath, git, baseline === "turn" ? "turn" : "session", targetCheckpoint);
  }

  async #capture({ chatId, projectId, projectKind, workingRoot, sessionFile, chatKey }) {
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
    const existing = (await fs.readdir(directory).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
    const previousFile = existing.at(-1) ? path.join(directory, existing.at(-1)) : null;
    const previous = previousFile
      ? await fs.readFile(previousFile, "utf8").then(JSON.parse, () => null)
      : null;
    const digest = digestOf({ repository, head, entries });
    const sequence = (previous?.sequence ?? existing.length) + 1;
    // The transcript entry this turn will hang under: the user message Pi is
    // about to write becomes its child, which is what ties a checkpoint to the
    // exchange that produced it.
    const anchorEntryId = await this.#anchor(sessionFile);
    await this.#write(file, { version: 1, id, chatId, projectId, workingRoot: root, repository, turnId: null, createdAt, sequence, anchorEntryId, head, digest, entries });
    // The previous checkpoint's turn changed nothing, so it records no information.
    if (previous && previousFile && digestOf(previous) === digest) await fs.unlink(previousFile).catch(() => {});
    const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    await Promise.all(names.slice(0, -MAX_CHECKPOINTS_PER_CHAT).map((name) => fs.unlink(path.join(directory, name))));
    return { id, file, turnId: null };
  }

  async #compare(checkpoint, relativePath, git, scope = "session", targetCheckpoint = null) {
    const stored = checkpoint.entries[relativePath];
    if (stored?.kind === "unavailable") {
      if (targetCheckpoint) {
        const targetStored = targetCheckpoint.entries[relativePath];
        if (targetStored?.kind === "unavailable" && targetStored.size === stored.size && targetStored.modifiedAt === stored.modifiedAt) return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "unchanged", message: "This file did not change from the selected checkpoint." };
        return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "unavailable", message: "The selected checkpoint is unavailable for this file." };
      }
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
    if (targetCheckpoint) {
      const targetStored = targetCheckpoint.entries[relativePath];
      if (targetStored?.kind === "unavailable" || targetStored?.kind === "unsupported") return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: targetStored.kind, message: "The ending checkpoint is unavailable for this file." };
      if (targetStored?.kind === "file") modified = Buffer.from(targetStored.content, "base64");
      else if (!targetStored && targetCheckpoint.head) {
        try {
          const { stdout: size } = await git(["cat-file", "-s", `${targetCheckpoint.head}:${relativePath}`]);
          if (Number(size) > MAX_FILE_BYTES) return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "size", message: "This file exceeds the 1 MiB checkpoint comparison limit." };
          modified = Buffer.from((await git(["cat-file", "blob", `${targetCheckpoint.head}:${relativePath}`], MAX_FILE_BYTES + 1)).stdout);
        } catch { modified = Buffer.alloc(0); }
      }
    } else {
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
    }
    if (original.equals(modified)) return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "unchanged", message: "This file did not change from the selected checkpoint." };
    const decode = (value) => new TextDecoder("utf-8", { fatal: true }).decode(value);
    let originalText;
    let modifiedText;
    try { originalText = decode(original); modifiedText = decode(modified); }
    catch { return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "binary", message: "Binary or non-UTF-8 files cannot be shown as a text comparison." }; }
    return { kind: "text", path: relativePath, oldPath: relativePath, scope, status: original.length === 0 ? "A" : modified.length === 0 ? "D" : "M", original: originalText, modified: modifiedText };
  }

  async #comparisonRange(chatId, workingRoot, baseline, checkpointId) {
    const root = path.resolve(workingRoot);
    const checkpoints = (await this.#checkpoints(chatId)).filter((checkpoint) => checkpoint.version === 1 && typeof checkpoint.repository === "boolean" && checkpoint.workingRoot === root);
    const index = checkpointId ? checkpoints.findIndex((checkpoint) => checkpoint.id === checkpointId) : baseline === "turn" ? checkpoints.length - 1 : 0;
    if (index < 0) return { checkpoint: null, targetCheckpoint: null };
    if (baseline === "chat") return {
      checkpoint: checkpoints[0],
      targetCheckpoint: checkpointId ? checkpoints[index + 1] || null : null,
    };
    return {
      checkpoint: checkpoints[index],
      targetCheckpoint: checkpointId ? checkpoints[index + 1] || null : null,
    };
  }

  /**
   * Reads the last transcript entry from a Pi session file. A freshly forked
   * session holds only its header, so the walk follows `parentSession` until an
   * entry turns up. Only the tail of each file is read: transcripts grow, and
   * the last entry is all this needs.
   */
  async #anchor(sessionFile, hop = 0) {
    if (typeof sessionFile !== "string" || !sessionFile || hop >= MAX_ANCHOR_HOPS) return null;
    let handle;
    try { handle = await fs.open(sessionFile, "r"); }
    catch { return null; }
    let parentSession = null;
    try {
      const { size } = await handle.stat();
      const length = Math.min(size, ANCHOR_TAIL_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      const lines = buffer.toString("utf8").split("\n");
      if (length < size) lines.shift();
      for (const line of lines.reverse()) {
        if (!line.trim()) continue;
        let entry;
        try { entry = JSON.parse(line); }
        catch { continue; }
        if (entry?.type === "session") { parentSession = typeof entry.parentSession === "string" ? entry.parentSession : null; continue; }
        if (typeof entry?.id === "string" && entry.id) return entry.id;
      }
    } catch { return null; }
    finally { await handle.close().catch(() => {}); }
    return parentSession ? this.#anchor(parentSession, hop + 1) : null;
  }

  async #checkpoints(chatId) {
    const directory = path.join(this.root, keyFor(chatId));
    const names = await fs.readdir(directory).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    const checkpoints = [];
    for (const name of names.filter((item) => item.endsWith(".json")).sort()) {
      try {
        const file = path.join(directory, name);
        const checkpoint = JSON.parse(await fs.readFile(file, "utf8"));
        checkpoint[FILE] = file;
        checkpoints.push(checkpoint);
      }
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
