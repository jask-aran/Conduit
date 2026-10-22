import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { presentableDiff } from "@codemirror/merge";
import { workspaceHost } from "./workspace-inspector.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const MAX_CHECKPOINTS_PER_CHAT = 50;
const ANCHOR_TAIL_BYTES = 64 * 1024;
const MAX_ANCHOR_HOPS = 8;

const keyFor = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);

/**
 * Where a chat's workspace is (decision 24: the head is a device like the
 * others): an absolute path on this server, or a device's folder as a host
 * (workspace-host.js). Every read of the workspace goes through the host, so
 * checkpoints work the same on either; `identity` is what a checkpoint
 * records as its `workingRoot` -- the path here, the place on a device.
 */
async function openWorkspace(workingRoot) {
  const host = workspaceHost(workingRoot);
  const identity = typeof workingRoot === "string" ? path.resolve(workingRoot) : host.key;
  let checked = null;
  const ready = () => (checked ??= host.checkRoot());
  const git = async (args, maxBuffer = 2 * 1024 * 1024) => { await ready(); return host.git(args, { maxBuffer }); };
  return { host, identity, ready, git };
}

// A workspace-relative path the store may read: `/`-separated, no `.`/`..`, never `.conduit` or `.git` at the top.
const safeRelative = (relativePath) => typeof relativePath === "string" && relativePath && !relativePath.includes("\0")
  && relativePath.split("/").every((part) => part && part !== "." && part !== "..");
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
    // A turn's summary between two stored checkpoints never changes, and a checkpoint file only by its own rewrite:
    // a chat's open read every checkpoint (megabytes each) and compared every turn again.
    this.summaries = new Map();
    this.parsed = new Map();
  }

  async capture({ chatId, projectId, projectKind, workingRoot, sessionFile = null, sourceCheckpointId = null }) {
    const chatKey = keyFor(chatId);
    const previous = this.queues.get(chatKey) || Promise.resolve();
    const task = previous.then(() => this.#capture({ chatId, projectId, projectKind, workingRoot, sessionFile, sourceCheckpointId, chatKey }));
    const queued = task.catch(() => {});
    this.queues.set(chatKey, queued);
    try { return await task; }
    finally { if (this.queues.get(chatKey) === queued) this.queues.delete(chatKey); }
  }

  async assignTurn(checkpoint, turnId, messageId = null) {
    if (!checkpoint || typeof turnId !== "string" || !turnId) return checkpoint;
    const content = JSON.parse(await fs.readFile(checkpoint.file, "utf8"));
    content.turnId = turnId;
    if (typeof messageId === "string" && messageId) content.messageId = messageId;
    await this.#write(checkpoint.file, content);
    return { ...checkpoint, turnId, messageId: content.messageId ?? null };
  }

  async checkpointForMessage(chatId, workingRoot, messageId) {
    const root = (await openWorkspace(workingRoot)).identity;
    const stored = (await this.#checkpoints(chatId))
      .filter((checkpoint) => checkpoint.version === 1 && checkpoint.workingRoot === root);
    const { checkpoints, mappings } = await this.#activeCheckpoints(null, stored);
    return checkpoints.find((checkpoint) => mappings.get(checkpoint.id)?.messageId === messageId)?.id ?? null;
  }

  async timeline(chatId, workingRoot, sessionFile = null) {
    const workspace = await openWorkspace(workingRoot);
    const root = workspace.identity;
    const stored = (await this.#checkpoints(chatId))
      .filter((checkpoint) => checkpoint.version === 1 && checkpoint.workingRoot === root);
    const { checkpoints, mappings } = await this.#activeCheckpoints(sessionFile, stored);
    const numbered = checkpoints.map((checkpoint) => ({ checkpoint, sequence: mappings.get(checkpoint.id).sequence }));
    const timeline = [];
    for (const [index, item] of numbered.entries()) {
      const { checkpoint, sequence } = item;
      const target = numbered[index + 1] || null;
      const summary = await this.#closedSummary(workspace, checkpoint, target?.checkpoint || null);
      timeline.push({
        id: checkpoint.id,
        createdAt: checkpoint.createdAt,
        messageId: mappings.get(checkpoint.id).messageId,
        sequence,
        targetSequence: target?.sequence ?? null,
        summary,
      });
    }
    return timeline.toReversed();
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

  async review(chatId, workingRoot, baseline = "chat", checkpointId = null, sessionFile = null) {
    const workspace = await openWorkspace(workingRoot);
    const { checkpoint, targetCheckpoint } = await this.#comparisonRange(chatId, workspace.identity, baseline, checkpointId, sessionFile);
    if (!checkpoint || workspace.identity !== checkpoint.workingRoot) return null;
    const { git } = workspace;
    const targetPaths = targetCheckpoint
      ? Object.keys(targetCheckpoint.entries)
      : checkpoint.repository
        ? (await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"])).stdout.split("\0").filter(Boolean).map((record) => record.slice(3))
        : await this.#workspacePaths(workspace);
    const paths = new Set([...Object.keys(checkpoint.entries), ...targetPaths]);
    if (checkpoint.repository && checkpoint.head && (!targetCheckpoint || targetCheckpoint.head !== checkpoint.head)) {
      const target = targetCheckpoint?.head || undefined;
      const changed = await git(["diff", checkpoint.head, ...(target ? [target] : []), "--name-only", "-z", "--no-renames", "--no-ext-diff"]);
      for (const relativePath of changed.stdout.split("\0").filter(Boolean)) paths.add(relativePath);
    }
    const files = [];
    for (const relativePath of [...paths].sort()) {
      const comparison = await this.#compare(workspace, checkpoint, relativePath, baseline === "turn" ? "turn" : "session", targetCheckpoint);
      if (comparison.kind === "text" && comparison.original === comparison.modified) continue;
      if (comparison.kind === "unavailable" && comparison.reason === "unchanged") continue;
      const stat = safeRelative(relativePath) ? await workspace.host.stat(relativePath).catch(() => null) : null;
      files.push({ path: relativePath, status: comparison.status, available: comparison.kind === "text", changedAt: stat?.mtimeMs || Date.parse(checkpoint.createdAt) });
    }
    files.sort((left, right) => right.changedAt - left.changedAt || left.path.localeCompare(right.path));
    return { id: checkpoint.id, createdAt: checkpoint.createdAt, files };
  }

  async compare(chatId, workingRoot, relativePath, checkpointId, baseline = "chat", sessionFile = null) {
    const workspace = await openWorkspace(workingRoot);
    const { checkpoint, targetCheckpoint } = await this.#comparisonRange(chatId, workspace.identity, baseline, checkpointId, sessionFile);
    if (!checkpoint || workspace.identity !== checkpoint.workingRoot) return null;
    if (!safeRelative(relativePath)) throw new Error("Invalid checkpoint path");
    return this.#compare(workspace, checkpoint, relativePath, baseline === "turn" ? "turn" : "session", targetCheckpoint);
  }

  async #capture({ chatId, projectId, projectKind, workingRoot, sessionFile, sourceCheckpointId, chatKey }) {
    const workspace = await openWorkspace(workingRoot);
    const root = workspace.identity;
    const { git, host } = workspace;
    const source = sourceCheckpointId
      ? (await this.#checkpoints(chatId)).find((checkpoint) => checkpoint.id === sourceCheckpointId && checkpoint.workingRoot === root)
      : null;
    const repository = source ? source.repository : projectKind === "workspace";
    let head = null;
    let paths;
    if (source) {
      head = source.head ?? null;
      paths = [];
    } else if (repository) {
      // The repository's own root, asked as Git's prefix from here: empty at the top, on any device's paths.
      const [{ stdout: prefix }, { stdout: status }, revision] = await Promise.all([
        git(["rev-parse", "--show-prefix"]),
        git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]),
        git(["rev-parse", "--verify", "HEAD"]).then(({ stdout }) => stdout.trim(), () => null),
      ]);
      if (prefix.trim()) throw new Error("Workspace root is not the Git repository root");
      head = revision;
      paths = status.split("\0").filter(Boolean).map((record) => record.slice(3));
    } else {
      paths = await this.#workspacePaths(workspace);
    }
    const entries = source ? structuredClone(source.entries) : {};
    let byteLength = 0;
    if (paths.length) await workspace.ready();
    for (const relativePath of paths) {
      if (!safeRelative(relativePath)) continue;
      const stat = await host.lstat(relativePath);
      if (!stat) { entries[relativePath] = { kind: "missing" }; continue; }
      if (!stat.isFile()) { entries[relativePath] = { kind: "unsupported" }; continue; }
      if (stat.size > MAX_FILE_BYTES || byteLength + stat.size > MAX_CHECKPOINT_BYTES) {
        entries[relativePath] = { kind: "unavailable", size: stat.size, modifiedAt: stat.mtimeMs };
        continue;
      }
      const content = await host.read(relativePath);
      byteLength += content.byteLength;
      // A device's stat carries no mode; the digest then reads it as 0 on both sides.
      entries[relativePath] = { kind: "file", mode: (stat.mode ?? 0) & 0o777, content: content.toString("base64") };
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
    await this.#write(file, { version: 1, id, chatId, projectId, workingRoot: root, repository, turnId: null, createdAt, sequence, anchorEntryId, sessionFile: sessionFile ? path.resolve(sessionFile) : null, sourceCheckpointId: source?.id ?? null, head, digest, entries });
    const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    await Promise.all(names.slice(0, -MAX_CHECKPOINTS_PER_CHAT).map((name) => fs.unlink(path.join(directory, name))));
    return { id, file, turnId: null };
  }

  async #compare(workspace, checkpoint, relativePath, scope = "session", targetCheckpoint = null) {
    const { git, host } = workspace;
    const current = async () => { if (!safeRelative(relativePath)) return null; await workspace.ready(); return host.stat(relativePath).catch(() => null); };
    const stored = checkpoint.entries[relativePath];
    if (stored?.kind === "unavailable") {
      if (targetCheckpoint) {
        const targetStored = targetCheckpoint.entries[relativePath];
        if (targetStored?.kind === "unavailable" && targetStored.size === stored.size && targetStored.modifiedAt === stored.modifiedAt) return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "unchanged", message: "This file did not change from the selected checkpoint." };
        return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "unavailable", message: "The selected checkpoint is unavailable for this file." };
      }
      const stat = await current();
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
        if (safeRelative(relativePath)) {
          await workspace.ready();
          const stat = await host.stat(relativePath);
          if (!stat.isFile()) throw Object.assign(new Error(), { code: "unsupported" });
          if (stat.size > MAX_FILE_BYTES) return { kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason: "size", message: "This file exceeds the 1 MiB checkpoint comparison limit." };
          modified = await host.read(relativePath);
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

  async #closedSummary(workspace, checkpoint, targetCheckpoint) {
    if (!targetCheckpoint) return this.#summary(workspace, checkpoint, null);
    const key = `${checkpoint.id}\u0000${targetCheckpoint.id}`;
    if (this.summaries.has(key)) return this.summaries.get(key);
    const summary = await this.#summary(workspace, checkpoint, targetCheckpoint);
    this.summaries.set(key, summary);
    while (this.summaries.size > 2_000) this.summaries.delete(this.summaries.keys().next().value);
    return summary;
  }

  async #summary(workspace, checkpoint, targetCheckpoint) {
    const { git } = workspace;
    const targetPaths = targetCheckpoint
      ? Object.keys(targetCheckpoint.entries)
      : checkpoint.repository
        ? (await git(["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"])).stdout.split("\0").filter(Boolean).map((record) => record.slice(3))
        : await this.#workspacePaths(workspace);
    const paths = new Set([...Object.keys(checkpoint.entries), ...targetPaths]);
    let added = 0;
    let removed = 0;
    let preferredPath = null;
    for (const relativePath of paths) {
      const comparison = await this.#compare(workspace, checkpoint, relativePath, "turn", targetCheckpoint);
      if (comparison.kind !== "text") {
        if (comparison.reason !== "unchanged") return null;
        continue;
      }
      preferredPath ??= relativePath;
      const lineNumber = (text, offset) => text.slice(0, offset).split("\n").length;
      for (const change of presentableDiff(comparison.original, comparison.modified)) {
        added += change.toB <= change.fromB ? 0 : lineNumber(comparison.modified, change.toB - 1) - lineNumber(comparison.modified, change.fromB) + 1;
        removed += change.toA <= change.fromA ? 0 : lineNumber(comparison.original, change.toA - 1) - lineNumber(comparison.original, change.fromA) + 1;
      }
    }
    return added || removed ? { added, removed, preferredPath } : null;
  }

  async #userMessageIds(sessionFile, checkpoints) {
    const result = new Map();
    if (typeof sessionFile !== "string" || !sessionFile) {
      let sequence = 0;
      for (const checkpoint of checkpoints) {
        sequence += 1;
        result.set(checkpoint.id, {
          messageId: typeof checkpoint.messageId === "string" && checkpoint.messageId ? checkpoint.messageId : null,
          sequence,
        });
      }
      return result;
    }
    const entries = new Map();
    const entryFiles = new Map();
    let currentFile = path.resolve(sessionFile);
    let leafId = null;
    for (let hop = 0; currentFile && hop < MAX_ANCHOR_HOPS; hop += 1) {
      let parentFile = null;
      const lines = await fs.readFile(currentFile, "utf8").then((value) => value.split("\n"), () => []);
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try { entry = JSON.parse(line); } catch { continue; }
        if (entry?.type === "session") {
          parentFile = typeof entry.parentSession === "string" && entry.parentSession ? path.resolve(entry.parentSession) : null;
          continue;
        }
        if (typeof entry?.id === "string" && entry.id) {
          entries.set(entry.id, entry);
          entryFiles.set(entry.id, currentFile);
          if (hop === 0) leafId = entry.id;
        }
      }
      currentFile = parentFile;
    }
    const lineage = [];
    const visited = new Set();
    for (let id = leafId; id && !visited.has(id);) {
      visited.add(id);
      const entry = entries.get(id);
      if (!entry) break;
      lineage.push(entry);
      id = typeof entry.parentId === "string" ? entry.parentId : null;
    }
    lineage.reverse();
    const positions = new Map(lineage.map((entry, index) => [entry.id, index]));
    const userNumbers = new Map(lineage
      .filter((entry) => entry.type === "message" && entry.message?.role === "user")
      .map((entry, index) => [entry.id, index + 1]));
    // A checkpoint is taken just before a prompt goes out, so the turn it
    // describes is the first one that follows it -- and a turn already spoken
    // for belongs to the checkpoint that claimed it, so the walk only ever
    // moves forward. Without that, checkpoints that carry no anchor all reach
    // the same way down the lineage and land on the newest turn together, and
    // every turn but the last loses the changes it made.
    let claimed = 0;
    for (const [index, checkpoint] of checkpoints.entries()) {
      if (typeof checkpoint.messageId === "string" && positions.has(checkpoint.messageId)) {
        result.set(checkpoint.id, { messageId: checkpoint.messageId, sequence: userNumbers.get(checkpoint.messageId) });
        claimed = positions.get(checkpoint.messageId) + 1;
        continue;
      }
      // An anchor the lineage does not contain was recorded on a branch the
      // session has since left: a fork keeps what came before its point and
      // abandons the rest, and a checkpoint captured just after one anchors on
      // the leaf of the branch it forked from. Searching from where the last
      // turn was claimed instead of dropping the checkpoint is what lets a
      // regenerated turn carry its changes; the session-file guard below is
      // what stops a checkpoint from the abandoned branch claiming a turn that
      // is not its.
      const anchored = checkpoint.anchorEntryId == null ? -1 : (positions.get(checkpoint.anchorEntryId) ?? -1);
      const nextAnchor = checkpoints[index + 1]?.anchorEntryId;
      const end = typeof nextAnchor === "string" ? positions.get(nextAnchor) : undefined;
      const candidates = lineage.slice(Math.max(anchored + 1, claimed), end === undefined ? undefined : end + 1);
      const user = candidates.find((entry) => entry.type === "message" && entry.message?.role === "user");
      if (!user) continue;
      if (anchored === -1) {
        const checkpointSession = typeof checkpoint.sessionFile === "string" ? path.resolve(checkpoint.sessionFile) : null;
        const userSession = entryFiles.get(user.id);
        const elapsed = Date.parse(user.timestamp) - Date.parse(checkpoint.createdAt);
        if (checkpointSession ? checkpointSession !== userSession : !Number.isFinite(elapsed) || elapsed < 0 || elapsed > 60_000) continue;
      }
      result.set(checkpoint.id, { messageId: user.id, sequence: userNumbers.get(user.id) });
      claimed = positions.get(user.id) + 1;
    }
    return result;
  }

  async #activeCheckpoints(sessionFile, checkpoints) {
    const branch = [];
    for (const checkpoint of checkpoints) {
      if (typeof checkpoint.sourceCheckpointId === "string") {
        const sourceIndex = branch.findIndex((candidate) => candidate.id === checkpoint.sourceCheckpointId);
        if (sourceIndex >= 0) branch.splice(sourceIndex + 1);
      }
      branch.push(checkpoint);
    }
    const mappings = await this.#userMessageIds(sessionFile, branch);
    const latestByMessage = new Map();
    for (const checkpoint of branch) {
      const mapping = mappings.get(checkpoint.id);
      if (mapping) latestByMessage.set(mapping.messageId || checkpoint.id, checkpoint.id);
    }
    const active = branch.filter((checkpoint) => {
      const mapping = mappings.get(checkpoint.id);
      return mapping && latestByMessage.get(mapping.messageId || checkpoint.id) === checkpoint.id;
    });
    return {
      checkpoints: active.filter((checkpoint, index) => {
        const next = active[index + 1];
        return !next || digestOf(checkpoint) !== digestOf(next);
      }),
      mappings,
    };
  }

  async #comparisonRange(chatId, root, baseline, checkpointId, sessionFile) {
    const stored = (await this.#checkpoints(chatId)).filter((checkpoint) => checkpoint.version === 1 && typeof checkpoint.repository === "boolean" && checkpoint.workingRoot === root);
    const { checkpoints } = await this.#activeCheckpoints(sessionFile, stored);
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
        const stat = await fs.stat(file);
        const stamp = `${stat.size}:${stat.mtimeMs}`;
        let checkpoint = this.parsed.get(file)?.stamp === stamp ? this.parsed.get(file).checkpoint : null;
        if (!checkpoint) {
          checkpoint = JSON.parse(await fs.readFile(file, "utf8"));
          checkpoint[FILE] = file;
          this.parsed.delete(file);
          this.parsed.set(file, { stamp, checkpoint });
          while (this.parsed.size > 32) this.parsed.delete(this.parsed.keys().next().value);
        }
        checkpoints.push(checkpoint);
      }
      catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    return checkpoints;
  }

  async #workspacePaths(workspace) {
    await workspace.ready();
    // Every directory is listed at once, a few at a time, then walked in the order the listings were always read:
    // one listing awaited after another took ~130 ms over the chats' shared folder (700 directories).
    const listings = new Map();
    const listing = (relativeDirectory) => {
      if (!listings.has(relativeDirectory)) listings.set(relativeDirectory, workspace.host.list(relativeDirectory, { limit: 10_000 })
        .catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error)).then((entries) => entries || []));
      return listings.get(relativeDirectory);
    };
    let level = [""];
    let listed = 0;
    while (level.length && listed < 10_000) {
      const next = [];
      for (let index = 0; index < level.length; index += 16) {
        const batch = level.slice(index, index + 16);
        const results = await Promise.all(batch.map(listing));
        for (const [offset, entries] of results.entries()) {
          for (const entry of entries) {
            if (!batch[offset] && (entry.name === ".conduit" || entry.name === ".git")) continue;
            if (entry.symlink) continue;
            if (entry.type === "directory") next.push(batch[offset] ? `${batch[offset]}/${entry.name}` : entry.name);
            else if (entry.type === "file") listed += 1;
          }
        }
      }
      level = next;
    }
    const files = [];
    const pending = [""];
    while (pending.length && files.length < 10_000) {
      const relativeDirectory = pending.pop();
      const entries = await listing(relativeDirectory);
      for (const entry of entries) {
        if (!relativeDirectory && (entry.name === ".conduit" || entry.name === ".git")) continue;
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        if (entry.symlink) continue;
        if (entry.type === "directory") pending.push(relativePath);
        else if (entry.type === "file") files.push(relativePath);
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
