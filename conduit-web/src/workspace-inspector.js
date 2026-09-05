import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const MAX_PREVIEW_BYTES = 1024 * 1024;
export const GIT_COMMAND_TIMEOUT_MS = 10_000;
export const MAX_CONCURRENT_GIT_PROCESSES = 4;
const MAX_DIRECTORY_ENTRIES = 500;
const INSPECTION_CACHE_MS = 2_000;
const WORKSPACE_WATCH_IDLE_MS = 3_000;
const MAX_CHANGED_WORKSPACE_PATHS = 1_000;
const gitSlots = { active: 0, waiters: [] };
const inspections = new Map();
const workspaceWatches = new Map();

function inspectorError(code, message) {
  return Object.assign(new Error(message), { code });
}

function fileRevision(content) {
  return createHash("sha256").update(content).digest("hex");
}

function abortError() {
  return inspectorError("workspace_inspection_aborted", "Workspace inspection was cancelled");
}

function isAbort(error) {
  return error?.code === "workspace_inspection_aborted";
}

function acquireGitSlot(signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (gitSlots.active < MAX_CONCURRENT_GIT_PROCESSES) {
    gitSlots.active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve: () => { signal?.removeEventListener("abort", abort); resolve(); } };
    const abort = () => {
      const index = gitSlots.waiters.indexOf(waiter);
      if (index >= 0) gitSlots.waiters.splice(index, 1);
      reject(abortError());
    };
    signal?.addEventListener("abort", abort, { once: true });
    gitSlots.waiters.push(waiter);
  });
}

function releaseGitSlot() {
  const waiter = gitSlots.waiters.shift();
  if (waiter) {
    waiter.resolve();
    return;
  }
  gitSlots.active -= 1;
}

function terminateProcess(child) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, "SIGTERM"); }
    catch { child.kill("SIGTERM"); }
    setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL"); }
      catch {}
    }, 500).unref();
    return;
  }
  child.kill("SIGTERM");
}

/** Run one Git command with a process cap, hard deadline, bounded output, and cancellation. */
export async function runBoundedGit(root, args, { signal, maxBuffer = 64 * 1024, timeoutMs = GIT_COMMAND_TIMEOUT_MS, onSpawn } = {}) {
  await acquireGitSlot(signal);
  try {
    if (signal?.aborted) throw abortError();
    return await new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        cwd: root,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
      onSpawn?.(child);
      let stdout = "";
      let stderr = "";
      let terminalError = null;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (error) reject(error);
        else resolve(value);
      };
      const fail = (error) => {
        if (terminalError) return;
        terminalError = error;
        terminateProcess(child);
      };
      const append = (current, chunk) => {
        const next = current + chunk.toString("utf8");
        if (Buffer.byteLength(next) > maxBuffer) {
          fail(inspectorError("workspace_git_output_limit", "Git inspection exceeded its output limit"));
          return current;
        }
        return next;
      };
      const onAbort = () => fail(abortError());
      const timer = setTimeout(() => fail(inspectorError("workspace_git_timeout", "Git inspection timed out")), timeoutMs);
      child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
      child.on("error", (error) => finish(terminalError || error));
      child.on("exit", () => {
        // A terminated command's stdio can remain open briefly (or be held by a
        // descendant). Its output is intentionally discarded, so do not hold a
        // global inspection slot waiting for `close` after cancellation.
        if (terminalError) finish(terminalError);
      });
      child.on("close", (code) => {
        if (terminalError) return finish(terminalError);
        if (code !== 0) {
          const error = inspectorError("workspace_git_failed", stderr.trim() || `Git exited with status ${code}`);
          error.stdout = stdout;
          error.stderr = stderr;
          return finish(error);
        }
        finish(null, { stdout, stderr });
      });
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  } finally {
    releaseGitSlot();
  }
}

function safeSegments(relativePath = "") {
  const value = String(relativePath).replaceAll("\\", "/");
  if (!value) return [];
  const segments = value.split("/");
  if (path.posix.isAbsolute(value) || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw inspectorError("invalid_workspace_path", "The requested path is invalid");
  }
  if (segments[0] === ".conduit") throw inspectorError("hidden_workspace_path", "Conduit internals are not available");
  return segments;
}

export async function resolveInspectorPath(root, relativePath = "", { kind = null } = {}) {
  const rootPath = await fs.realpath(path.resolve(root));
  const segments = safeSegments(relativePath);
  let current = rootPath;
  for (const segment of segments) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current).catch((error) => {
      if (error.code === "ENOENT") throw inspectorError("path_not_found", "The requested path does not exist");
      throw error;
    });
    if (stat.isSymbolicLink()) throw inspectorError("workspace_path_symlink", "Symlinked paths are not available");
  }
  const stat = await fs.stat(current);
  if (kind === "directory" && !stat.isDirectory()) throw inspectorError("path_not_directory", "The requested path is not a directory");
  if (kind === "file" && !stat.isFile()) throw inspectorError("path_not_file", "The requested path is not a file");
  return { path: current, stat, relativePath: segments.join("/") };
}

export async function listWorkspaceDirectory(root, relativePath = "", { after = null } = {}) {
  let cursorKey = null;
  if (after != null) {
    try {
      cursorKey = JSON.parse(after);
      if (!Array.isArray(cursorKey) || cursorKey.length !== 2 || !["directory", "file", "other"].includes(cursorKey[0]) || typeof cursorKey[1] !== "string") throw new Error();
    } catch { throw inspectorError("invalid_workspace_path", "Invalid directory cursor"); }
  }
  const resolved = await resolveInspectorPath(root, relativePath, { kind: "directory" });
  const directory = await fs.opendir(resolved.path);
  const accepted = [];
  let scanned = 0;
  for await (const entry of directory) {
    if (++scanned > 50_000) return { entries: [], total: null, truncated: false, cursor: null, oversize: true };
    if (entry.name === ".conduit" || entry.isSymbolicLink()) continue;
    accepted.push({ name: entry.name, type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other" });
  }
  const compare = (left, right) => {
    const ranks = { directory: 0, file: 1, other: 2 };
    return ranks[left.type] - ranks[right.type] || left.name.localeCompare(right.name) || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  };
  accepted.sort(compare);
  const remaining = cursorKey ? accepted.filter((entry) => compare(entry, { type: cursorKey[0], name: cursorKey[1] }) > 0) : accepted;
  const entries = remaining.slice(0, MAX_DIRECTORY_ENTRIES).map((entry) => ({ ...entry,
    path: resolved.relativePath ? `${resolved.relativePath}/${entry.name}` : entry.name,
  }));
  const truncated = remaining.length > entries.length;
  const last = entries.at(-1);
  return { entries, total: accepted.length, truncated, cursor: truncated ? JSON.stringify([last.type, last.name]) : null, oversize: false };
}

function ignoredWorkspaceWatchPath(relativePath) {
  return !relativePath || relativePath.split("/").some((segment) => segment === ".conduit" || segment.startsWith(".conduit-tmp-"));
}

function noteWorkspaceChange(record, relativePath = null) {
  if (relativePath && ignoredWorkspaceWatchPath(relativePath)) return;
  record.version += 1;
  if (record.changedPaths === null || !relativePath) {
    if (!relativePath) {
      record.changedPaths = null;
      record.fullRefresh = true;
    }
    return;
  }
  record.changedPaths.add(relativePath);
  if (record.changedPaths.size > MAX_CHANGED_WORKSPACE_PATHS) record.changedPaths = null;
}

function closeWorkspaceWatch(record) {
  clearTimeout(record.closeTimer);
  record.closeTimer = null;
  record.watcher?.close();
  record.watcher = null;
  workspaceWatches.delete(record.root);
}

function scheduleWorkspaceWatchClose(record) {
  if (record.references || record.closeTimer) return;
  record.closeTimer = setTimeout(() => {
    if (!record.references) closeWorkspaceWatch(record);
  }, WORKSPACE_WATCH_IDLE_MS);
  record.closeTimer.unref();
}

function startWorkspaceWatch(record) {
  if (record.watcher || record.fallback) return;
  try {
    record.watcher = record.watchImpl(record.root, { recursive: true }, (_event, filename) => {
      const relativePath = typeof filename === "string" ? filename.replaceAll("\\", "/") : null;
      noteWorkspaceChange(record, relativePath);
    });
    record.watcher.on("error", () => {
      record.watcher?.close();
      record.watcher = null;
      record.fallback = true;
      noteWorkspaceChange(record);
    });
    record.watcher.unref();
  } catch {
    record.fallback = true;
  }
  noteWorkspaceChange(record);
}

async function scanWorkspacePaths(record, paths) {
  const next = new Map();
  for (const relativePath of paths) {
    try {
      const resolved = await resolveInspectorPath(record.root, relativePath);
      next.set(resolved.relativePath, `${resolved.stat.mtimeMs}:${resolved.stat.size}:${resolved.stat.isDirectory()}`);
    } catch (error) {
      if (error.code !== "path_not_found") throw error;
      next.set(relativePath, "missing");
    }
  }
  if (record.pathStats) {
    for (const [relativePath, value] of next) {
      if (record.pathStats.get(relativePath) !== value) noteWorkspaceChange(record, relativePath);
    }
  }
  record.pathStats = next;
}

/** Return one shared workspace-change version for the currently visible paths. */
export async function readWorkspaceVersion(root, { paths = [], watchImpl = watch } = {}) {
  const resolved = await resolveInspectorPath(root, "", { kind: "directory" });
  let record = workspaceWatches.get(resolved.path);
  if (!record) {
    record = { root: resolved.path, watchImpl, watcher: null, fallback: false, references: 0, closeTimer: null, version: 0, changedPaths: new Set(), fullRefresh: false, pathStats: null };
    workspaceWatches.set(resolved.path, record);
  }
  record.references += 1;
  clearTimeout(record.closeTimer);
  record.closeTimer = null;
  try {
    startWorkspaceWatch(record);
    if (record.fallback) await scanWorkspacePaths(record, paths);
    const changedPaths = record.fullRefresh || record.changedPaths === null ? null : [...record.changedPaths];
    if (record.fullRefresh) {
      record.fullRefresh = false;
      record.changedPaths = new Set();
    }
    return { version: record.version, changedPaths };
  } finally {
    record.references -= 1;
    scheduleWorkspaceWatchClose(record);
  }
}

export function closeWorkspaceVersionWatch(root) {
  const record = workspaceWatches.get(root);
  if (record) closeWorkspaceWatch(record);
}

export async function readWorkspaceFile(root, relativePath) {
  const resolved = await resolveInspectorPath(root, relativePath, { kind: "file" });
  if (resolved.stat.size > MAX_PREVIEW_BYTES) throw inspectorError("file_too_large", "File is larger than the 1 MiB preview limit");
  const content = await fs.readFile(resolved.path);
  if (content.includes(0)) throw inspectorError("file_not_text", "Binary files cannot be previewed");
  return { path: resolved.relativePath, size: resolved.stat.size, modifiedAt: resolved.stat.mtimeMs, revision: fileRevision(content), content: content.toString("utf8") };
}

export async function writeWorkspaceFile(root, relativePath, content, { expectedRevision = null } = {}) {
  const segments = safeSegments(relativePath);
  if (!segments.length) throw inspectorError("invalid_workspace_path", "The requested path is invalid");
  const name = segments.at(-1);
  const parent = await resolveInspectorPath(root, segments.slice(0, -1).join("/"), { kind: "directory" });
  const target = path.join(parent.path, name);
  let existing = null;
  try {
    existing = await fs.lstat(target);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing?.isSymbolicLink()) throw inspectorError("workspace_path_symlink", "Symlinked paths are not available");
  if (existing && !existing.isFile()) throw inspectorError("path_not_file", "The requested path is not a file");
  if (expectedRevision == null && existing) {
    throw Object.assign(inspectorError("workspace_file_exists", "A file with this name already exists"), { status: 409 });
  }
  if (expectedRevision != null && !existing) {
    throw Object.assign(inspectorError("workspace_file_changed", "The file changed or was removed before it could be saved"), { status: 409 });
  }
  if (existing && expectedRevision !== "*") {
    const current = await fs.readFile(target);
    if (fileRevision(current) !== expectedRevision) {
      throw Object.assign(inspectorError("workspace_file_changed", "The file changed before it could be saved"), { status: 409 });
    }
  }
  await fs.writeFile(target, content, existing ? undefined : { flag: "wx" });
  const written = await fs.stat(target);
  return { path: segments.join("/"), size: content.byteLength, modifiedAt: written.mtimeMs, revision: fileRevision(content) };
}

export async function deleteWorkspaceFile(root, relativePath) {
  const resolved = await resolveInspectorPath(root, relativePath, { kind: "file" });
  await fs.unlink(resolved.path);
  return { path: resolved.relativePath };
}

async function resolveNewWorkspacePath(root, relativePath) {
  const segments = safeSegments(relativePath);
  if (!segments.length) throw inspectorError("invalid_workspace_path", "The requested path is invalid");
  const parent = await resolveInspectorPath(root, segments.slice(0, -1).join("/"), { kind: "directory" });
  const target = path.join(parent.path, segments.at(-1));
  const existing = await fs.lstat(target).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (existing) {
    throw Object.assign(inspectorError("workspace_entry_exists", "A file or folder with this name already exists"), { status: 409 });
  }
  return { path: target, relativePath: segments.join("/") };
}

export async function createWorkspaceDirectory(root, relativePath) {
  const target = await resolveNewWorkspacePath(root, relativePath);
  await fs.mkdir(target.path);
  return { path: target.relativePath };
}

export async function moveWorkspaceEntry(root, relativePath, destinationPath) {
  const source = await resolveInspectorPath(root, relativePath);
  if (!source.relativePath) throw inspectorError("invalid_workspace_path", "The workspace root cannot be moved");
  const destination = await resolveNewWorkspacePath(root, destinationPath);
  if (source.stat.isDirectory() && destination.relativePath.startsWith(`${source.relativePath}/`)) {
    throw inspectorError("invalid_workspace_move", "A folder cannot be moved inside itself");
  }
  await fs.rename(source.path, destination.path);
  return {
    path: source.relativePath,
    destination: destination.relativePath,
    type: source.stat.isDirectory() ? "directory" : source.stat.isFile() ? "file" : "other",
  };
}

export async function deleteWorkspaceDirectory(root, relativePath) {
  const resolved = await resolveInspectorPath(root, relativePath, { kind: "directory" });
  if (!resolved.relativePath) throw inspectorError("invalid_workspace_path", "The workspace root cannot be deleted");
  await fs.rm(resolved.path, { recursive: true });
  return { path: resolved.relativePath };
}

export async function runWorkspaceGitAction(root, { action, relativePath, message }) {
  const resolved = await resolveInspectorPath(root, "", { kind: "directory" });
  await runBoundedGit(resolved.path, ["rev-parse", "--is-inside-work-tree"]);
  const gitPath = () => {
    const value = safeSegments(relativePath).join("/");
    if (!value) throw inspectorError("invalid_workspace_path", "The requested path is invalid");
    return value;
  };
  let args;
  if (action === "stage") args = ["add", "--", gitPath()];
  else if (action === "stage-all") args = ["add", "-A"];
  else if (action === "unstage") args = ["reset", "--", gitPath()];
  else if (action === "unstage-all") args = ["reset"];
  else if (action === "commit") {
    const subject = String(message || "").trim();
    if (!subject || subject.length > 5000 || subject.includes("\0")) throw inspectorError("workspace_git_message_invalid", "Commit message must contain 1 to 5000 characters");
    args = ["commit", "-m", subject];
  } else if (action === "push") args = ["push"];
  else if (action === "fetch") args = ["fetch", "--all"];
  else if (action === "pull") args = ["pull", "--ff-only"];
  else throw inspectorError("workspace_git_action_invalid", "Git action is not supported");
  const result = await runBoundedGit(resolved.path, args, { maxBuffer: 512 * 1024, timeoutMs: ["fetch", "pull", "push"].includes(action) ? 60_000 : GIT_COMMAND_TIMEOUT_MS });
  inspections.delete(resolved.path);
  return { ok: true, output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim() };
}

function parseStatus(output) {
  return output.split("\0").filter(Boolean).map((record) => ({ status: record.slice(0, 2), path: record.slice(3) }));
}

function parseLog(output) {
  return output.split("\n").filter((line) => line.includes("\x1f")).map((line) => {
    const [graph, hash, shortHash, subject, author, authoredAt] = line.split("\x1f");
    return { graph: graph.trimEnd(), hash, shortHash, subject, author, authoredAt };
  });
}

function parseRefs(output) {
  return output.split("\n").filter((line) => line && !line.split("\0", 1)[0].endsWith("/HEAD")).map((line) => {
    const [fullName, name, hash, upstream] = line.split("\0");
    return {
      name,
      hash,
      upstream: upstream || null,
      kind: fullName.startsWith("refs/heads/") ? "local" : fullName.startsWith("refs/remotes/") ? "remote" : "tag",
    };
  });
}

async function inspectOverview(root, { signal, runGit }) {
  try { await runGit(root, ["rev-parse", "--is-inside-work-tree"], { signal }); }
  catch (error) {
    if (isAbort(error)) throw error;
    return { repository: false, files: [], diff: "" };
  }
  const [{ stdout: status }, { stdout: branch }] = await Promise.all([
    runGit(root, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { signal, maxBuffer: 2 * 1024 * 1024 }),
    runGit(root, ["branch", "--show-current"], { signal }),
  ]);
  let upstream = null;
  let ahead = 0;
  let behind = 0;
  try {
    upstream = (await runGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { signal })).stdout.trim() || null;
    if (upstream) {
      const counts = (await runGit(root, ["rev-list", "--left-right", "--count", `HEAD...${upstream}`], { signal })).stdout.trim().split(/\s+/).map(Number);
      [ahead, behind] = counts;
    }
  } catch (error) { if (isAbort(error)) throw error; }
  return {
    repository: true,
    branch: branch.trim() || "detached HEAD",
    upstream,
    ahead,
    behind,
    files: parseStatus(status),
    diff: "",
  };
}

async function inspectHistory(root, { signal, runGit }) {
  const [{ stdout: log }, { stdout: refs }] = await Promise.all([
    runGit(root, ["log", "--all", "--graph", "-30", "--pretty=format:%x1f%H%x1f%h%x1f%s%x1f%an%x1f%aI"], { signal, maxBuffer: 512 * 1024 }),
    runGit(root, ["for-each-ref", "--format=%(refname)%00%(refname:short)%00%(objectname)%00%(upstream:short)", "refs/heads", "refs/remotes", "refs/tags"], { signal, maxBuffer: 512 * 1024 }),
  ]);
  return { commits: parseLog(log), refs: parseRefs(refs) };
}

async function inspectPatch(root, { signal, runGit }) {
  const [{ stdout: unstaged }, { stdout: staged }] = await Promise.all([
    runGit(root, ["diff", "--no-ext-diff", "--no-color"], { signal, maxBuffer: 4 * 1024 * 1024 }),
    runGit(root, ["diff", "--cached", "--no-ext-diff", "--no-color"], { signal, maxBuffer: 4 * 1024 * 1024 }),
  ]);
  return [staged && `# Staged\n${staged}`, unstaged && `# Working tree\n${unstaged}`].filter(Boolean).join("\n");
}

function scheduleEviction(record) {
  if (record.consumers || record.active || record.evictTimer) return;
  record.evictTimer = setTimeout(() => {
    if (record.consumers || record.active || inspections.get(record.root) !== record) return;
    inspections.delete(record.root);
  }, INSPECTION_CACHE_MS);
  record.evictTimer.unref();
}

function track(record, promise, signal) {
  clearTimeout(record.evictTimer);
  record.evictTimer = null;
  record.consumers += 1;
  return new Promise((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      record.consumers -= 1;
      signal?.removeEventListener("abort", abort);
      if (!record.consumers && record.active) record.controller.abort();
      scheduleEviction(record);
    };
    const abort = () => { release(); reject(abortError()); };
    signal?.addEventListener("abort", abort, { once: true });
    promise.then((value) => { release(); resolve(value); }, (error) => { release(); reject(error); });
    if (signal?.aborted) abort();
  });
}

function inspectionFor(root, runGit, { reuse = false } = {}) {
  let record = inspections.get(root);
  if (record && !record.active && !record.consumers && !reuse) {
    clearTimeout(record.evictTimer);
    inspections.delete(root);
    record = null;
  }
  if (record && record.controller.signal.aborted) record = null;
  if (record) return record;
  const controller = new AbortController();
  record = { root, controller, consumers: 0, active: 1, evictTimer: null, overview: null, history: null, patch: null };
  record.overview = inspectOverview(root, { signal: controller.signal, runGit }).finally(() => {
    record.active -= 1;
    scheduleEviction(record);
  });
  inspections.set(root, record);
  return record;
}

export async function readWorkspaceDiff(root, { includePatch = false, includeHistory = true, reuse = false, signal, runGit = runBoundedGit } = {}) {
  const resolved = await resolveInspectorPath(root, "", { kind: "directory" });
  const record = inspectionFor(resolved.path, runGit, { reuse });
  if (includeHistory && !record.history) {
    record.active += 1;
    record.history = record.overview.then((overview) => overview.repository
      ? inspectHistory(resolved.path, { signal: record.controller.signal, runGit })
      : {}).finally(() => {
      record.active -= 1;
      scheduleEviction(record);
    });
  }
  if (includePatch && !record.patch) {
    record.active += 1;
    record.patch = record.overview.then(async (overview) => ({
      ...overview,
      diff: overview.repository ? await inspectPatch(resolved.path, { signal: record.controller.signal, runGit }) : "",
    })).finally(() => {
      record.active -= 1;
      scheduleEviction(record);
    });
  }
  const overview = includePatch ? record.patch : record.overview;
  if (!includeHistory) return track(record, overview, signal);
  return track(record, Promise.all([overview, record.history]).then(([summary, history]) => ({ ...summary, ...history })), signal);
}

export async function readWorkspaceCommit(root, hash, { signal, runGit = runBoundedGit } = {}) {
  if (!/^[0-9a-f]{40}$/i.test(hash)) throw inspectorError("invalid_workspace_commit", "The requested commit is invalid");
  const resolved = await resolveInspectorPath(root, "", { kind: "directory" });
  try {
    const result = await runGit(resolved.path, ["show", "--format=fuller", "--stat", "--patch", "--no-ext-diff", "--no-color", hash], { signal, maxBuffer: 4 * 1024 * 1024 });
    return { hash: hash.toLowerCase(), content: result.stdout };
  } catch (error) {
    if (isAbort(error)) throw error;
    throw inspectorError("workspace_commit_not_found", "The requested commit is not available");
  }
}
