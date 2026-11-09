import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { workspaceHost } from "./workspace-inspector.js";
import { mapLimit } from "./server/effect-concurrency.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 16 * 1024 * 1024;
const MAX_CHECKPOINTS_PER_CHAT = 50;
// Parsed checkpoints kept between listings, by their files' sizes.
const PARSED_BYTES = 256 * 1024 * 1024;
// A turn keeps two files: where it started and, once it settles, where it ended.
const MAX_FILES_PER_CHAT = MAX_CHECKPOINTS_PER_CHAT * 2;

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


/**
 * Lines added and removed between two texts, as `git diff --numstat` counts them: the shortest edit over lines (Myers),
 * after the lines both share at the start and end. Past MAX_EDIT edits the rest is counted as replaced, a bound on the
 * work for two texts that share little.
 */
const MAX_EDIT = 4000;
function lineChanges(before, after) {
  const a = before.split("\n");
  const b = after.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const n = endA - start;
  const m = endB - start;
  if (!n || !m) return { added: m, removed: n };
  const ids = new Map();
  const id = (line) => { let value = ids.get(line); if (value === undefined) { value = ids.size; ids.set(line, value); } return value; };
  const x = Int32Array.from({ length: n }, (_, index) => id(a[start + index]));
  const y = Int32Array.from({ length: m }, (_, index) => id(b[start + index]));
  const max = Math.min(n + m, MAX_EDIT);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  for (let d = 0; d <= max; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let i = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let j = i - k;
      while (i < n && j < m && x[i] === y[j]) { i += 1; j += 1; }
      v[offset + k] = i;
      if (i >= n && j >= m) return { added: (d + m - n) / 2, removed: (d - m + n) / 2 };
    }
  }
  return { added: m, removed: n };
}

export class TurnCheckpointStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.queues = new Map();
    // A turn's summary between two stored checkpoints never changes, and a checkpoint file only by its own rewrite:
    // a chat's open read every checkpoint (megabytes each) and compared every turn again.
    this.summaries = new Map();
    this.parsed = new Map();
  }

  /** One chat's writes, one after another. */
  async #queued(chatId, work) {
    const chatKey = keyFor(chatId);
    const previous = this.queues.get(chatKey) || Promise.resolve();
    const task = previous.then(() => work(chatKey));
    const queued = task.catch(() => {});
    this.queues.set(chatKey, queued);
    try { return await task; }
    finally { if (this.queues.get(chatKey) === queued) this.queues.delete(chatKey); }
  }

  /** Where a turn starts: the workspace as it is just before the prompt goes out. */
  async capture({ chatId, projectId, projectKind, workingRoot, sourceCheckpointId = null }) {
    return this.#queued(chatId, (chatKey) => this.#capture({ chatId, projectId, projectKind, workingRoot, sourceCheckpointId, chatKey }));
  }

  /**
   * Where a turn ended: the workspace as the turn settles, kept beside its start (`closes` names it), so the turn's
   * changes are what it left and not whatever is written there before the next turn starts. The turn is the start
   * `turnId` was assigned to, else the last one still open. `unchanged` (the turn ran no tools) ends it unread.
   */
  async close({ chatId, workingRoot, turnId = null, unchanged = false }) {
    return this.#queued(chatId, async (chatKey) => {
      const workspace = await openWorkspace(workingRoot);
      const stored = await this.#checkpoints(chatId);
      const closed = new Set(stored.map((checkpoint) => checkpoint.closes).filter(Boolean));
      const open = stored.filter((checkpoint) => checkpoint.open === true && !closed.has(checkpoint.id) && checkpoint.workingRoot === workspace.identity);
      const start = (turnId && open.find((checkpoint) => checkpoint.turnId === turnId)) || open.at(-1);
      if (!start) return null;
      const state = unchanged ? null : await this.#snapshot(workspace, start.repository);
      const digest = state ? digestOf({ repository: start.repository, ...state }) : digestOf(start);
      const same = digest === digestOf(start);
      const createdAt = new Date().toISOString();
      const id = crypto.randomUUID();
      await this.#write(path.join(this.root, chatKey, `${createdAt.replaceAll(":", "-")}-${id}.json`), { version: 1, id, chatId, workingRoot: start.workingRoot,
        repository: start.repository, closes: start.id, same, createdAt, sequence: start.sequence, head: same ? start.head ?? null : state.head, digest, entries: same ? {} : state.entries });
      return { id, closes: start.id, same };
    });
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
    const { checkpoints, mappings } = await this.#activeCheckpoints(stored);
    return checkpoints.find((checkpoint) => mappings.get(checkpoint.id)?.messageId === messageId)?.id ?? null;
  }

  async timeline(chatId, workingRoot) {
    const workspace = await openWorkspace(workingRoot);
    const root = workspace.identity;
    const stored = (await this.#checkpoints(chatId))
      .filter((checkpoint) => checkpoint.version === 1 && checkpoint.workingRoot === root);
    const { checkpoints, mappings, endOf } = await this.#activeCheckpoints(stored);
    const numbered = checkpoints.map((checkpoint) => ({ checkpoint, sequence: mappings.get(checkpoint.id).sequence }));
    const timeline = [];
    for (const [index, item] of numbered.entries()) {
      const { checkpoint, sequence } = item;
      // A turn that settled is compared with where it ended; one from before turns were closed, or still running,
      // with the next turn's start, or the workspace as it is.
      const end = endOf(checkpoint);
      const next = numbered[index + 1] || null;
      const summary = end === checkpoint ? null : await this.#closedSummary(workspace, checkpoint, end || next?.checkpoint || null);
      timeline.push({
        id: checkpoint.id,
        createdAt: checkpoint.createdAt,
        messageId: mappings.get(checkpoint.id).messageId,
        sequence,
        targetSequence: end ? sequence : next?.sequence ?? null,
        summary,
      });
    }
    return timeline.toReversed();
  }

  async review(chatId, workingRoot, baseline = "chat", checkpointId = null) {
    const workspace = await openWorkspace(workingRoot);
    const { checkpoint, targetCheckpoint } = await this.#comparisonRange(chatId, workspace.identity, baseline, checkpointId);
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
    await workspace.ready();
    // Each path's comparison (a Git read or two) and stat are its own: a few at once, kept in the paths' order.
    const compared = await mapLimit([...paths].sort(), 8, async (relativePath) => {
      const comparison = await this.#compare(workspace, checkpoint, relativePath, baseline === "turn" ? "turn" : "session", targetCheckpoint);
      if (comparison.kind === "text" && comparison.original === comparison.modified) return null;
      if (comparison.kind === "unavailable" && comparison.reason === "unchanged") return null;
      const stat = safeRelative(relativePath) ? await workspace.host.stat(relativePath).catch(() => null) : null;
      return { path: relativePath, status: comparison.status, available: comparison.kind === "text", changedAt: stat?.mtimeMs || Date.parse(checkpoint.createdAt) };
    });
    const files = compared.filter(Boolean);
    files.sort((left, right) => right.changedAt - left.changedAt || left.path.localeCompare(right.path));
    return { id: checkpoint.id, createdAt: checkpoint.createdAt, files };
  }

  async compare(chatId, workingRoot, relativePath, checkpointId, baseline = "chat") {
    const workspace = await openWorkspace(workingRoot);
    const { checkpoint, targetCheckpoint } = await this.#comparisonRange(chatId, workspace.identity, baseline, checkpointId);
    if (!checkpoint || workspace.identity !== checkpoint.workingRoot) return null;
    if (!safeRelative(relativePath)) throw new Error("Invalid checkpoint path");
    return this.#compare(workspace, checkpoint, relativePath, baseline === "turn" ? "turn" : "session", targetCheckpoint);
  }

  /** What a workspace holds now: a repository's `HEAD` and the files Git says differ from it, else every file. */
  async #snapshot(workspace, repository) {
    const { git, host } = workspace;
    let head = null;
    let paths;
    if (repository) {
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
    const entries = {};
    let byteLength = 0;
    if (paths.length) await workspace.ready();
    // Awaited before the turn starts, so each file's stat and read are asked at once (a device's are a round trip
    // each), a few at a time; the byte budget is still spent in the paths' order, as one after another spent it.
    const safe = paths.filter((relativePath) => safeRelative(relativePath));
    const stats = await mapLimit(safe, 16, (relativePath) => host.lstat(relativePath));
    const wanted = [];
    safe.forEach((relativePath, index) => {
      const stat = stats[index];
      if (!stat) { entries[relativePath] = { kind: "missing" }; return; }
      if (!stat.isFile()) { entries[relativePath] = { kind: "unsupported" }; return; }
      if (stat.size > MAX_FILE_BYTES || byteLength + stat.size > MAX_CHECKPOINT_BYTES) {
        entries[relativePath] = { kind: "unavailable", size: stat.size, modifiedAt: stat.mtimeMs };
        return;
      }
      byteLength += stat.size;
      wanted.push({ relativePath, stat });
    });
    const contents = await mapLimit(wanted, 8, ({ relativePath }) => host.read(relativePath));
    byteLength = 0;
    wanted.forEach(({ relativePath, stat }, index) => {
      const content = contents[index];
      // A file can grow after lstat; only the bytes read can spend the final budget.
      if (content.byteLength > MAX_FILE_BYTES || byteLength + content.byteLength > MAX_CHECKPOINT_BYTES) {
        entries[relativePath] = { kind: "unavailable", size: content.byteLength, modifiedAt: stat.mtimeMs };
        return;
      }
      byteLength += content.byteLength;
      // A device's stat carries no mode; the digest then reads it as 0 on both sides.
      entries[relativePath] = { kind: "file", mode: (stat.mode ?? 0) & 0o777, content: content.toString("base64") };
    });
    return { head, entries };
  }

  async #capture({ chatId, projectId, projectKind, workingRoot, sourceCheckpointId, chatKey }) {
    const workspace = await openWorkspace(workingRoot);
    const root = workspace.identity;
    const { git, host } = workspace;
    const source = sourceCheckpointId
      ? (await this.#checkpoints(chatId)).find((checkpoint) => checkpoint.id === sourceCheckpointId && checkpoint.workingRoot === root)
      : null;
    const repository = source ? source.repository : projectKind === "workspace";
    const { head, entries } = source
      ? { head: source.head ?? null, entries: structuredClone(source.entries) }
      : await this.#snapshot(workspace, repository);
    const createdAt = new Date().toISOString();
    const id = crypto.randomUUID();
    const directory = path.join(this.root, chatKey);
    const file = path.join(directory, `${createdAt.replaceAll(":", "-")}-${id}.json`);
    await fs.mkdir(directory, { recursive: true });
    const existing = (await fs.readdir(directory).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
    const previousFile = existing.at(-1) ? path.join(directory, existing.at(-1)) : null;
    // Only its sequence is wanted: from the parsed copy when one is held, else the file (every file's content in it).
    const previousSequence = async () => {
      if (!previousFile) return null;
      const held = this.parsed.get(previousFile)?.checkpoint;
      if (held) return held.sequence ?? null;
      return fs.readFile(previousFile, "utf8").then((text) => JSON.parse(text).sequence ?? null, () => null);
    };
    const previous = await previousSequence();
    const digest = digestOf({ repository, head, entries });
    const sequence = (previous ?? existing.length) + 1;
    await this.#write(file, { version: 1, id, chatId, projectId, workingRoot: root, repository, turnId: null, open: true, createdAt, sequence, sourceCheckpointId: source?.id ?? null, head, digest, entries });
    const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    await Promise.all(names.slice(0, -MAX_FILES_PER_CHAT).map((name) => fs.unlink(path.join(directory, name))));
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
      // A turn of an old chat is compared with the workspace as it is now, which can be weeks of other work: every
      // file, so the loop is handed back between them, or the hub serves nothing until it is done (84 s once).
      await new Promise((resolve) => setImmediate(resolve));
      const comparison = await this.#compare(workspace, checkpoint, relativePath, "turn", targetCheckpoint);
      if (comparison.kind !== "text") {
        if (comparison.reason !== "unchanged") return null;
        continue;
      }
      preferredPath ??= relativePath;
      // Counted by lines, as git counts them: the editor's character diff (presentableDiff) took half a minute on a
      // 50 KB file weeks apart, holding the hub the whole time.
      const counted = lineChanges(comparison.original, comparison.modified);
      added += counted.added;
      removed += counted.removed;
    }
    return added || removed ? { added, removed, preferredPath } : null;
  }

  /**
   * The chat's turns as it stands: each start checkpoint on the branch the chat is on (a regenerate names the one it
   * replaces from), the latest one a message has, numbered in order; `endOf` gives where a settled turn ended (the
   * start itself when it changed nothing).
   */
  async #activeCheckpoints(stored) {
    const closers = new Map(stored.filter((checkpoint) => checkpoint.closes).map((checkpoint) => [checkpoint.closes, checkpoint]));
    const endOf = (checkpoint) => { const end = closers.get(checkpoint.id); return end ? (end.same ? checkpoint : end) : null; };
    const branch = [];
    for (const checkpoint of stored) {
      if (checkpoint.closes) continue;
      if (typeof checkpoint.sourceCheckpointId === "string") {
        const sourceIndex = branch.findIndex((candidate) => candidate.id === checkpoint.sourceCheckpointId);
        if (sourceIndex >= 0) branch.splice(sourceIndex + 1);
      }
      branch.push(checkpoint);
    }
    const mappings = new Map(branch.map((checkpoint, index) => [checkpoint.id,
      { messageId: typeof checkpoint.messageId === "string" && checkpoint.messageId ? checkpoint.messageId : null, sequence: index + 1 }]));
    const latestByMessage = new Map();
    for (const checkpoint of branch) latestByMessage.set(mappings.get(checkpoint.id).messageId || checkpoint.id, checkpoint.id);
    const active = branch.filter((checkpoint) => latestByMessage.get(mappings.get(checkpoint.id).messageId || checkpoint.id) === checkpoint.id);
    return {
      // A turn never closed that starts where the next one does changed nothing.
      checkpoints: active.filter((checkpoint, index) => {
        const next = active[index + 1];
        return closers.has(checkpoint.id) || !next || digestOf(checkpoint) !== digestOf(next);
      }),
      mappings,
      endOf,
    };
  }

  async #comparisonRange(chatId, root, baseline, checkpointId) {
    const stored = (await this.#checkpoints(chatId)).filter((checkpoint) => checkpoint.version === 1 && typeof checkpoint.repository === "boolean" && checkpoint.workingRoot === root);
    const { checkpoints, endOf } = await this.#activeCheckpoints(stored);
    const index = checkpointId ? checkpoints.findIndex((checkpoint) => checkpoint.id === checkpointId) : baseline === "turn" ? checkpoints.length - 1 : 0;
    if (index < 0) return { checkpoint: null, targetCheckpoint: null };
    const end = endOf(checkpoints[index]) || (checkpointId ? checkpoints[index + 1] || null : null);
    // The chat's changes run from its first turn to the workspace as it is, or to the end of the turn asked for.
    if (baseline === "chat") return { checkpoint: checkpoints[0], targetCheckpoint: checkpointId ? end : null };
    return { checkpoint: checkpoints[index], targetCheckpoint: end };
  }

  async #checkpoints(chatId) {
    const directory = path.join(this.root, keyFor(chatId));
    const names = await fs.readdir(directory).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    // Bound simultaneous reads and parses without returning to one round trip per file.
    const read = await mapLimit(names.filter((item) => item.endsWith(".json")).sort(), 4, async (name) => {
      try {
        const file = path.join(directory, name);
        const stat = await fs.stat(file);
        const stamp = `${stat.size}:${stat.mtimeMs}`;
        const held = this.parsed.get(file);
        if (held?.stamp === stamp) return { file, held };
        const checkpoint = JSON.parse(await fs.readFile(file, "utf8"));
        return { file, held: { stamp, size: stat.size, checkpoint } };
      }
      catch (error) { if (error.code !== "ENOENT") throw error; return null; }
    });
    const checkpoints = [];
    for (const item of read) {
      if (!item) continue;
      // Kept most recent last: room for two chats' worth by count (a cache smaller than one chat's
      // MAX_CHECKPOINTS_PER_CHAT evicted each file just before it was wanted again, so every listing parsed them all),
      // and at most PARSED_BYTES in all, so a chat of near-limit checkpoints cannot hold gigabytes.
      this.parsed.delete(item.file);
      this.parsed.set(item.file, item.held);
      let bytes = 0;
      for (const held of this.parsed.values()) bytes += held.size || 0;
      while (this.parsed.size > 1 && (this.parsed.size > MAX_FILES_PER_CHAT * 2 || bytes > PARSED_BYTES)) {
        const [oldest, held] = this.parsed.entries().next().value;
        bytes -= held.size || 0;
        this.parsed.delete(oldest);
      }
      checkpoints.push(item.held.checkpoint);
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
