import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { workspaceHost } from "./workspace-inspector.js";
import { mapLimit } from "./server/effect-concurrency.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TURNS_PER_CHAT = 50;
// A turn keeps two records: where it started and, once it settles, where it ended.
const MAX_FILES_PER_CHAT = MAX_TURNS_PER_CHAT * 2;
const SNAPSHOT_TIMEOUT_MS = 120_000;
// What one snapshot may add to a store: a folder past these (a home directory, a disk) is not checkpointed, and is not
// asked again for a while (the listing alone can take the whole Git timeout, before a turn starts).
const MAX_PENDING_FILES = 20_000;
const MAX_PENDING_BYTES = 512 * 1024 * 1024;
const REFUSED_FOR_MS = 10 * 60_000;
// A device's shadow store sits inside the repository's own Git directory (only Git workspaces are checkpointed there).
const DEVICE_STORE = ".git/conduit-turns";

const keyFor = (value) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
// A workspace-relative path the store may read: `/`-separated, no `.`/`..`.
const safeRelative = (relativePath) => typeof relativePath === "string" && relativePath && !relativePath.includes("\0")
  && relativePath.split("/").every((part) => part && part !== "." && part !== "..");
const unavailable = (relativePath, scope, reason, message) => ({ kind: "unavailable", path: relativePath, oldPath: relativePath, scope, status: "M", reason, message });

/**
 * A chat's turn checkpoints: what its workspace held as each turn started and as it settled, so a turn's changes are
 * what it left.
 *
 * The files are kept by Git, in a shadow store: a bare repository of Conduit's own per workspace (under the data root;
 * on a device, inside the repository's `.git`), which the workspace's own repository, index and history never see. A
 * snapshot is `git add -A` and `git write-tree` there with the workspace as the work tree: Git re-reads only files
 * whose stat changed, stores each content once, and honours the workspace's `.gitignore`. A checkpoint is a small
 * record (data root, by chat) naming its tree, which a ref (`refs/turns/<id>`) keeps from collection.
 *
 * A record: `{ version: 2, id, chatId, projectId, workingRoot, turnId, messageId, open, createdAt, sequence,
 * sourceCheckpointId, tree }`; a turn's end: `{ version: 2, id, chatId, workingRoot, closes, same, createdAt,
 * sequence, tree }`.
 */
export class TurnCheckpointStore {
  constructor(root) {
    this.root = path.resolve(root);
    this.queues = new Map();
    // Two trees' summary never changes.
    this.summaries = new Map();
    this.ready = new Map();
    this.refused = new Map();
  }

  /**
   * Where a chat's workspace is (decision 24: the hub is a device like the others): an absolute path on this server,
   * or a device's folder as a host (workspace-host.js). `identity` is what a checkpoint records as its `workingRoot`;
   * `git` runs in the shadow store with the workspace as its work tree.
   */
  async #open(workingRoot) {
    const host = workspaceHost(workingRoot);
    const local = typeof workingRoot === "string";
    const identity = local ? path.resolve(workingRoot) : host.key;
    const gitDir = local ? path.join(this.root, "git", keyFor(identity)) : DEVICE_STORE;
    const storeKey = local ? gitDir : `${identity}\u0000${gitDir}`;
    await host.checkRoot();
    const git = (args, options = {}) => host.git(["--git-dir", gitDir, "--work-tree", ".", "-c", "advice.addEmbeddedRepo=false", ...args],
      { maxBuffer: 16 * 1024 * 1024, ...options });
    const workspace = { host, identity, git, gitDir, storeKey, local };
    if (!this.ready.has(storeKey)) {
      const made = git(["rev-parse", "--is-bare-repository"]).catch(() => host.git(["init", "-q", "--bare", gitDir]));
      this.ready.set(storeKey, made);
      made.catch(() => this.ready.delete(storeKey));
    }
    await this.ready.get(storeKey);
    return workspace;
  }

  /** One key's work, one after another: a chat's records, a store's index. */
  async #queued(key, work) {
    const previous = this.queues.get(key) || Promise.resolve();
    const task = previous.then(work);
    const queued = task.catch(() => {});
    this.queues.set(key, queued);
    try { return await task; }
    finally { if (this.queues.get(key) === queued) this.queues.delete(key); }
  }

  /** The workspace as it is now, as a tree in its store. A file Git cannot read is left out, not the snapshot. */
  #snapshot(workspace) {
    return this.#queued(workspace.storeKey, async () => {
      const tooLarge = () => Object.assign(new Error("The workspace is too large to checkpoint"), { code: "checkpoint_too_large" });
      if (this.refused.get(workspace.storeKey) > Date.now()) throw tooLarge();
      // `.conduit` is Conduit's own; a device takes the pathspec through its shell, so only the hub excludes it.
      // Nor is a store ever snapshotted into itself (a workspace that holds the data root).
      const own = workspace.local ? path.relative(workspace.identity, this.root).split(path.sep).join("/") : "";
      const scope = ["--", ".", ...(workspace.local ? [":(exclude).conduit"] : []), ...(own && safeRelative(own) ? [`:(exclude)${own}`] : [])];
      try {
        const pending = (await workspace.git(["ls-files", "-z", "--others", "--modified", "--exclude-standard", ...scope], { maxBuffer: 4 * 1024 * 1024 }))
          .stdout.split("\0").filter(Boolean);
        if (pending.length > MAX_PENDING_FILES) throw tooLarge();
        if (workspace.local) {
          const sizes = await mapLimit(pending, 32, (relativePath) => workspace.host.lstat(relativePath).then((stat) => stat?.size || 0, () => 0));
          if (sizes.reduce((sum, size) => sum + size, 0) > MAX_PENDING_BYTES) throw tooLarge();
        }
        if (pending.length) await this.#add(workspace, scope);
      } catch (error) {
        if (["checkpoint_too_large", "workspace_git_output_limit", "workspace_git_timeout"].includes(error.code)) {
          this.refused.set(workspace.storeKey, Date.now() + REFUSED_FOR_MS);
          throw tooLarge();
        }
        throw error;
      }
      return (await workspace.git(["write-tree"])).stdout.trim();
    });
  }

  async #add(workspace, scope, retry = true) {
    try { await workspace.git(["add", "-A", "--ignore-errors", ...scope], { timeoutMs: SNAPSHOT_TIMEOUT_MS }); }
    catch (error) {
      // A store's index is written by this queue alone, so a lock found there was left by an add that was killed.
      if (retry && workspace.local && /index\.lock/.test(`${error.stderr || ""}${error.message}`)) {
        await fs.rm(path.join(workspace.gitDir, "index.lock"), { force: true });
        return this.#add(workspace, scope, false);
      }
      // Otherwise files it could not read: the rest are in the index.
      if (error.code === "workspace_git_timeout") throw error;
    }
  }

  /** Where a turn starts: the workspace as it is just before the prompt goes out (a regenerate's, where its source did). */
  async capture({ chatId, projectId, workingRoot, sourceCheckpointId = null }) {
    return this.#queued(keyFor(chatId), async () => {
      const workspace = await this.#open(workingRoot);
      const stored = await this.#checkpoints(chatId);
      const source = sourceCheckpointId ? stored.find((checkpoint) => checkpoint.id === sourceCheckpointId && checkpoint.workingRoot === workspace.identity) : null;
      const tree = source ? source.tree : await this.#snapshot(workspace);
      const record = { version: 2, id: crypto.randomUUID(), chatId, projectId, workingRoot: workspace.identity, turnId: null, open: true,
        createdAt: new Date().toISOString(), sequence: (stored.at(-1)?.sequence ?? 0) + 1, sourceCheckpointId: source?.id ?? null, tree };
      const file = await this.#keep(workspace, record);
      // Past the cap the oldest records go, and their refs with them: Git collects what nothing names.
      const old = stored.slice(0, Math.max(0, stored.length + 1 - MAX_FILES_PER_CHAT));
      await Promise.all(old.map(async (checkpoint) => {
        await fs.unlink(this.#file(checkpoint)).catch(() => {});
        await workspace.git(["update-ref", "-d", `refs/turns/${checkpoint.id}`]).catch(() => {});
      }));
      if (old.length) void workspace.git(["gc", "--auto", "--quiet"], { timeoutMs: SNAPSHOT_TIMEOUT_MS }).catch(() => {});
      return { id: record.id, file, turnId: null };
    });
  }

  /**
   * Where a turn ended: the workspace as the turn settles, kept beside its start (`closes` names it), so the turn's
   * changes are what it left and not whatever is written there before the next turn starts. The turn is the start
   * `turnId` was assigned to, else the last one still open. `unchanged` (the turn ran no tools) ends it unread.
   */
  async close({ chatId, workingRoot, turnId = null, unchanged = false }) {
    return this.#queued(keyFor(chatId), async () => {
      const workspace = await this.#open(workingRoot);
      const stored = await this.#checkpoints(chatId);
      const closed = new Set(stored.map((checkpoint) => checkpoint.closes).filter(Boolean));
      const open = stored.filter((checkpoint) => checkpoint.open === true && !closed.has(checkpoint.id) && checkpoint.workingRoot === workspace.identity);
      const start = (turnId && open.find((checkpoint) => checkpoint.turnId === turnId)) || open.at(-1);
      if (!start) return null;
      const tree = unchanged ? start.tree : await this.#snapshot(workspace);
      const record = { version: 2, id: crypto.randomUUID(), chatId, workingRoot: start.workingRoot, closes: start.id, same: tree === start.tree,
        createdAt: new Date().toISOString(), sequence: start.sequence, tree };
      await this.#keep(workspace, record);
      return { id: record.id, closes: start.id, same: record.same };
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
    const { checkpoints, mappings } = this.#activeCheckpoints(await this.#checkpoints(chatId, (await this.#open(workingRoot)).identity));
    return checkpoints.find((checkpoint) => mappings.get(checkpoint.id)?.messageId === messageId)?.id ?? null;
  }

  async timeline(chatId, workingRoot) {
    const workspace = await this.#open(workingRoot);
    const { checkpoints, mappings, endOf } = this.#activeCheckpoints(await this.#checkpoints(chatId, workspace.identity));
    const numbered = checkpoints.map((checkpoint) => ({ checkpoint, sequence: mappings.get(checkpoint.id).sequence }));
    let working = null;
    const timeline = [];
    for (const [index, { checkpoint, sequence }] of numbered.entries()) {
      // A turn that settled is compared with where it ended; one still running, or never closed, with the next
      // turn's start, or the workspace as it is.
      const end = endOf(checkpoint);
      const next = numbered[index + 1] || null;
      // A workspace that cannot be read now (too large) leaves its open turn without a count, not the chat without a timeline.
      const target = end?.tree ?? next?.checkpoint.tree ?? await (working ??= this.#snapshot(workspace).catch(() => checkpoint.tree));
      timeline.push({
        id: checkpoint.id,
        createdAt: checkpoint.createdAt,
        messageId: mappings.get(checkpoint.id).messageId,
        sequence,
        targetSequence: end ? sequence : next?.sequence ?? null,
        summary: await this.#summary(workspace, checkpoint.tree, target),
      });
    }
    return timeline.toReversed();
  }

  async review(chatId, workingRoot, baseline = "chat", checkpointId = null) {
    const workspace = await this.#open(workingRoot);
    const { checkpoint, target } = await this.#comparisonRange(chatId, workspace, baseline, checkpointId);
    if (!checkpoint) return null;
    const changed = await this.#changes(workspace, checkpoint.tree, target);
    const files = await mapLimit(changed, 8, async ({ path: relativePath, status, binary }) => {
      const stat = safeRelative(relativePath) ? await workspace.host.stat(relativePath).catch(() => null) : null;
      return { path: relativePath, status, available: !binary, changedAt: stat?.mtimeMs || Date.parse(checkpoint.createdAt) };
    });
    files.sort((left, right) => right.changedAt - left.changedAt || left.path.localeCompare(right.path));
    return { id: checkpoint.id, createdAt: checkpoint.createdAt, files };
  }

  async compare(chatId, workingRoot, relativePath, checkpointId, baseline = "chat") {
    const workspace = await this.#open(workingRoot);
    const { checkpoint, target } = await this.#comparisonRange(chatId, workspace, baseline, checkpointId);
    if (!checkpoint) return null;
    if (!safeRelative(relativePath)) throw new Error("Invalid checkpoint path");
    const scope = baseline === "turn" ? "turn" : "session";
    // A file a tree does not hold is empty on that side: added, or deleted.
    const blob = async (tree) => {
      const size = await workspace.git(["cat-file", "-s", `${tree}:${relativePath}`]).then(({ stdout }) => Number(stdout), () => null);
      if (size === null) return { text: "", held: false };
      if (size > MAX_FILE_BYTES) return { large: true };
      // Not a file there (a folder, a repository inside this one): nothing to show as text.
      return workspace.git(["cat-file", "blob", `${tree}:${relativePath}`], { maxBuffer: MAX_FILE_BYTES * 4 }).then(({ stdout }) => ({ text: stdout, held: true }), () => ({ other: true }));
    };
    const [original, modified] = await Promise.all([blob(checkpoint.tree), blob(target)]);
    if (original.other || modified.other) return unavailable(relativePath, scope, "unsupported", "Checkpoint comparison is available for regular files only.");
    if (original.large || modified.large) return unavailable(relativePath, scope, "size", "This file exceeds the 1 MiB checkpoint comparison limit.");
    if (original.held === modified.held && original.text === modified.text) return unavailable(relativePath, scope, "unchanged", "This file did not change from the selected checkpoint.");
    // Git's output is read as text: bytes that are not UTF-8 arrive as replacement characters.
    if (/[\0�]/.test(original.text) || /[\0�]/.test(modified.text)) return unavailable(relativePath, scope, "binary", "Binary or non-UTF-8 files cannot be shown as a text comparison.");
    return { kind: "text", path: relativePath, oldPath: relativePath, scope, status: !original.held ? "A" : !modified.held ? "D" : "M", original: original.text, modified: modified.text };
  }

  /** Removes checkpoints from before the shadow store (whole file contents as JSON), which nothing reads. */
  async sweep() {
    for (const name of await fs.readdir(this.root).catch(() => [])) {
      if (name === "git") continue;
      const directory = path.join(this.root, name);
      for (const item of await fs.readdir(directory).catch(() => [])) {
        const file = path.join(directory, item);
        const current = item.endsWith(".json") && (await fs.stat(file)).size < 4096
          && await fs.readFile(file, "utf8").then((text) => JSON.parse(text).version === 2, () => false);
        if (!current) await fs.rm(file, { recursive: true, force: true });
      }
      await fs.rmdir(directory).catch(() => {});
    }
  }

  /** The files that differ between two trees: `{ path, status, binary, added, removed }`. */
  async #changes(workspace, from, to) {
    if (from === to) return [];
    const [counts, names] = await Promise.all(["--numstat", "--name-status"].map((form) =>
      workspace.git(["diff-tree", "-r", "-z", "--no-renames", "--no-ext-diff", form, from, to]).then(({ stdout }) => stdout.split("\0").filter(Boolean))));
    const status = new Map();
    for (let index = 0; index + 1 < names.length; index += 2) status.set(names[index + 1], names[index][0] === "A" ? "A" : names[index][0] === "D" ? "D" : "M");
    return counts.map((line) => {
      const [added, removed, ...rest] = line.split("\t");
      const relativePath = rest.join("\t");
      return { path: relativePath, status: status.get(relativePath) || "M", binary: added === "-", added: Number(added) || 0, removed: Number(removed) || 0 };
    });
  }

  /** A turn's line counts, as Git counts them, and the first text file among them; null when no text changed. */
  async #summary(workspace, from, to) {
    if (from === to) return null;
    const key = `${from}\u0000${to}`;
    if (this.summaries.has(key)) return this.summaries.get(key);
    let added = 0;
    let removed = 0;
    let preferredPath = null;
    for (const change of await this.#changes(workspace, from, to)) {
      if (change.binary) continue;
      preferredPath ??= change.path;
      added += change.added;
      removed += change.removed;
    }
    const summary = added || removed ? { added, removed, preferredPath } : null;
    this.summaries.set(key, summary);
    while (this.summaries.size > 2_000) this.summaries.delete(this.summaries.keys().next().value);
    return summary;
  }

  /**
   * The chat's turns as it stands: each start checkpoint on the branch the chat is on (a regenerate names the one it
   * replaces from), the latest one a message has, numbered in order; `endOf` gives where a settled turn ended.
   */
  #activeCheckpoints(stored) {
    const closers = new Map(stored.filter((checkpoint) => checkpoint.closes).map((checkpoint) => [checkpoint.closes, checkpoint]));
    const endOf = (checkpoint) => closers.get(checkpoint.id) || null;
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
      checkpoints: active.filter((checkpoint, index) => closers.has(checkpoint.id) || !active[index + 1] || checkpoint.tree !== active[index + 1].tree),
      mappings,
      endOf,
    };
  }

  /** The two trees a review compares: `target` is a turn's end, the next turn's start, or the workspace as it is. */
  async #comparisonRange(chatId, workspace, baseline, checkpointId) {
    const { checkpoints, endOf } = this.#activeCheckpoints(await this.#checkpoints(chatId, workspace.identity));
    const index = checkpointId ? checkpoints.findIndex((checkpoint) => checkpoint.id === checkpointId) : baseline === "turn" ? checkpoints.length - 1 : 0;
    if (index < 0) return { checkpoint: null, target: null };
    const end = endOf(checkpoints[index]) || (checkpointId ? checkpoints[index + 1] || null : null);
    // The chat's changes run from its first turn to the workspace as it is, or to the end of the turn asked for.
    const to = baseline === "chat" && !checkpointId ? null : end;
    return { checkpoint: baseline === "chat" ? checkpoints[0] : checkpoints[index], target: to?.tree ?? await this.#snapshot(workspace) };
  }

  #file(record) {
    return path.join(this.root, keyFor(record.chatId), `${record.createdAt.replaceAll(":", "-")}-${record.id}.json`);
  }

  /** Write a record, and name its tree so Git keeps it. */
  async #keep(workspace, record) {
    const file = this.#file(record);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await workspace.git(["update-ref", `refs/turns/${record.id}`, record.tree]);
    await this.#write(file, record);
    return file;
  }

  /** A chat's records, oldest first; `root` keeps one workspace's. */
  async #checkpoints(chatId, root = null) {
    const directory = path.join(this.root, keyFor(chatId));
    const names = await fs.readdir(directory).catch((error) => error.code === "ENOENT" ? [] : Promise.reject(error));
    const read = await mapLimit(names.filter((item) => item.endsWith(".json")).sort(), 16, (name) =>
      fs.readFile(path.join(directory, name), "utf8").then(JSON.parse, () => null));
    return read.filter((checkpoint) => checkpoint?.version === 2 && typeof checkpoint.tree === "string" && (!root || checkpoint.workingRoot === root));
  }

  async #write(file, value) {
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    await fs.rename(temporary, file);
  }
}
