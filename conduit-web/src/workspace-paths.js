import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function expandHome(value, home = os.homedir()) {
  if (!value) return value;
  if (value === "~") return home;
  if (value.startsWith("~/")) return path.join(home, value.slice(2));
  return value;
}

export function parseAllowlist(raw, { home = os.homedir(), fallback = [] } = {}) {
  const source = raw == null || raw === ""
    ? fallback
    : String(raw).split(/[,:\n]/).map((item) => item.trim()).filter(Boolean);
  const roots = [];
  for (const entry of source) {
    const resolved = path.resolve(expandHome(entry, home));
    if (!roots.includes(resolved)) roots.push(resolved);
  }
  return roots;
}

export function isPathInside(candidate, root) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(root);
  if (resolvedCandidate === resolvedRoot) return true;
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function formatWorkspacePath(candidate, home = os.homedir()) {
  const resolved = path.resolve(candidate);
  const resolvedHome = path.resolve(home);
  if (resolved === resolvedHome) return "~";
  if (isPathInside(resolved, resolvedHome)) {
    return `~/${path.relative(resolvedHome, resolved).split(path.sep).join("/")}`;
  }
  return resolved;
}

export function assertAllowedPath(candidate, allowlist, label = "path") {
  const expanded = expandHome(String(candidate || ""));
  if (!path.isAbsolute(expanded)) {
    const error = new Error(`${label} must be absolute`);
    error.code = "path_not_absolute";
    throw error;
  }
  const resolved = path.resolve(expanded);
  if (!allowlist.some((root) => isPathInside(resolved, root))) {
    const allowedRoots = allowlist.length ? ` Use a path under ${allowlist.join(", ")}.` : " No workspace locations are configured.";
    const error = new Error(`${label} is outside the workspace allowlist.${allowedRoots}`);
    error.code = "path_not_allowed";
    error.path = resolved;
    error.allowlist = [...allowlist];
    throw error;
  }
  return resolved;
}

const DANGEROUS_UNIX_ROOTS = new Set([
  "/", "/bin", "/boot", "/dev", "/etc", "/proc", "/run", "/sbin", "/sys", "/usr", "/var",
]);

export function assertSafeWorkspaceRoot(candidate, { home = os.homedir(), dataRoot = null } = {}) {
  const resolved = path.resolve(candidate);
  let reason = null;
  if (DANGEROUS_UNIX_ROOTS.has(resolved)) reason = "system_root";
  else if (resolved === path.parse(resolved).root) reason = "filesystem_root";
  else if (resolved === path.resolve(home)) reason = "home_root";
  else if (dataRoot && isPathInside(resolved, path.resolve(dataRoot))) reason = "conduit_data";
  if (reason) {
    const error = new Error("That directory is too broad or owned by Conduit application data");
    error.code = "dangerous_workspace_root";
    error.reason = reason;
    error.path = resolved;
    throw error;
  }
  return resolved;
}

/**
 * Resolve a user-supplied directory for linking. Always realpath the candidate so
 * intermediate symlink ancestors cannot textually sit inside the allowlist while
 * resolving outside it at the OS level.
 */
export async function resolveExistingDirectory(candidate, allowlist, policy = {}) {
  const textual = assertAllowedPath(candidate, allowlist, "workspace path");
  let real;
  try {
    real = await fs.realpath(textual);
  } catch (error) {
    if (error.code === "ENOENT") {
      const missing = new Error("workspace path does not exist");
      missing.code = "path_not_found";
      missing.path = textual;
      throw missing;
    }
    throw error;
  }
  const resolved = assertAllowedPath(real, allowlist, "workspace path");
  assertSafeWorkspaceRoot(resolved, policy);
  const stats = await fs.stat(resolved);
  if (!stats.isDirectory()) {
    const error = new Error("workspace path must be a directory");
    error.code = "path_not_directory";
    throw error;
  }
  return resolved;
}

export async function resolveNewWorkspaceDirectory(parentCandidate, directoryName, allowlist, policy = {}) {
  const name = String(directoryName || "").trim();
  if (!name || name === "." || name === ".." || name === ".conduit" || /[\\/]/.test(name)) {
    const error = new Error("Folder name must be a single directory name");
    error.code = "workspace_directory_invalid";
    throw error;
  }
  const textualParent = assertAllowedPath(parentCandidate, allowlist, "workspace parent directory");
  let realParent;
  try {
    realParent = await fs.realpath(textualParent);
  } catch (error) {
    if (error.code === "ENOENT") {
      const missing = new Error("workspace parent directory does not exist");
      missing.code = "path_not_found";
      missing.path = textualParent;
      throw missing;
    }
    throw error;
  }
  const parent = assertAllowedPath(realParent, allowlist, "workspace parent directory");
  if (policy.dataRoot && isPathInside(parent, path.resolve(policy.dataRoot))) {
    const error = new Error("That directory is too broad or owned by Conduit application data");
    error.code = "dangerous_workspace_root";
    error.reason = "conduit_data";
    error.path = parent;
    throw error;
  }
  const parentStat = await fs.stat(parent);
  if (!parentStat.isDirectory()) {
    const error = new Error("workspace parent directory must be a directory");
    error.code = "path_not_directory";
    throw error;
  }
  const target = path.join(parent, name);
  assertSafeWorkspaceRoot(target, policy);
  try {
    const stat = await fs.lstat(target);
    const error = new Error(stat.isSymbolicLink() ? "Workspace folder cannot be a symlink" : "Workspace folder already exists");
    error.code = stat.isSymbolicLink() ? "workspace_path_symlink" : "workspace_path_exists";
    error.path = target;
    throw error;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return target;
}

export async function listDirectorySuggestions(root) {
  const resolvedRoot = await fs.realpath(path.resolve(root));
  const entries = await fs.readdir(resolvedRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      name: entry.name,
      path: path.join(resolvedRoot, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
