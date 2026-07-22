import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const MAX_PREVIEW_BYTES = 1024 * 1024;
const MAX_DIRECTORY_ENTRIES = 500;

function inspectorError(code, message) {
  return Object.assign(new Error(message), { code });
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

export async function listWorkspaceDirectory(root, relativePath = "") {
  const resolved = await resolveInspectorPath(root, relativePath, { kind: "directory" });
  const entries = await fs.readdir(resolved.path, { withFileTypes: true });
  return entries.filter((entry) => entry.name !== ".conduit" && !entry.isSymbolicLink()).slice(0, MAX_DIRECTORY_ENTRIES).map((entry) => ({
    name: entry.name,
    path: resolved.relativePath ? `${resolved.relativePath}/${entry.name}` : entry.name,
    type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other",
  })).sort((left, right) => left.type === right.type ? left.name.localeCompare(right.name) : left.type === "directory" ? -1 : 1);
}

export async function readWorkspaceFile(root, relativePath) {
  const resolved = await resolveInspectorPath(root, relativePath, { kind: "file" });
  if (resolved.stat.size > MAX_PREVIEW_BYTES) throw inspectorError("file_too_large", "File is larger than the 1 MiB preview limit");
  const content = await fs.readFile(resolved.path);
  if (content.includes(0)) throw inspectorError("file_not_text", "Binary files cannot be previewed");
  return { path: resolved.relativePath, size: resolved.stat.size, content: content.toString("utf8") };
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

export async function readWorkspaceDiff(root) {
  const resolved = await resolveInspectorPath(root, "", { kind: "directory" });
  try { await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: resolved.path, maxBuffer: 64 * 1024 }); }
  catch { return { repository: false, files: [], diff: "" }; }
  const [{ stdout: status }, { stdout: unstaged }, { stdout: staged }, { stdout: branch }, { stdout: log }] = await Promise.all([
    execFileAsync("git", ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"], { cwd: resolved.path, maxBuffer: 2 * 1024 * 1024 }),
    execFileAsync("git", ["diff", "--no-ext-diff", "--no-color"], { cwd: resolved.path, maxBuffer: 4 * 1024 * 1024 }),
    execFileAsync("git", ["diff", "--cached", "--no-ext-diff", "--no-color"], { cwd: resolved.path, maxBuffer: 4 * 1024 * 1024 }),
    execFileAsync("git", ["branch", "--show-current"], { cwd: resolved.path, maxBuffer: 64 * 1024 }),
    execFileAsync("git", ["log", "--graph", "-12", "--pretty=format:%x1f%H%x1f%h%x1f%s%x1f%an%x1f%aI"], { cwd: resolved.path, maxBuffer: 512 * 1024 }).catch(() => ({ stdout: "" })),
  ]);
  let upstream = null;
  let ahead = 0;
  let behind = 0;
  try {
    upstream = (await execFileAsync("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], { cwd: resolved.path, maxBuffer: 64 * 1024 })).stdout.trim() || null;
    if (upstream) {
      const counts = (await execFileAsync("git", ["rev-list", "--left-right", "--count", `HEAD...${upstream}`], { cwd: resolved.path, maxBuffer: 64 * 1024 })).stdout.trim().split(/\s+/).map(Number);
      [ahead, behind] = counts;
    }
  } catch {}
  return {
    repository: true,
    branch: branch.trim() || "detached HEAD",
    upstream,
    ahead,
    behind,
    commits: parseLog(log),
    files: parseStatus(status),
    diff: [staged && `# Staged\n${staged}`, unstaged && `# Working tree\n${unstaged}`].filter(Boolean).join("\n"),
  };
}
