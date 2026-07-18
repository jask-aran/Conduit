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

export function assertAllowedPath(candidate, allowlist, label = "path") {
  const resolved = path.resolve(expandHome(candidate));
  if (!path.isAbsolute(resolved)) {
    const error = new Error(`${label} must be absolute`);
    error.code = "path_not_absolute";
    throw error;
  }
  if (!allowlist.some((root) => isPathInside(resolved, root))) {
    const error = new Error(`${label} is outside the workspace allowlist`);
    error.code = "path_not_allowed";
    error.path = resolved;
    error.allowlist = [...allowlist];
    throw error;
  }
  return resolved;
}

export async function resolveExistingDirectory(candidate, allowlist) {
  const resolved = assertAllowedPath(candidate, allowlist, "workspace path");
  let stats;
  try {
    stats = await fs.lstat(resolved);
  } catch (error) {
    if (error.code === "ENOENT") {
      const missing = new Error("workspace path does not exist");
      missing.code = "path_not_found";
      missing.path = resolved;
      throw missing;
    }
    throw error;
  }
  if (stats.isSymbolicLink()) {
    const real = await fs.realpath(resolved);
    assertAllowedPath(real, allowlist, "workspace path");
    const realStats = await fs.stat(real);
    if (!realStats.isDirectory()) {
      const error = new Error("workspace path must be a directory");
      error.code = "path_not_directory";
      throw error;
    }
    return path.resolve(real);
  }
  if (!stats.isDirectory()) {
    const error = new Error("workspace path must be a directory");
    error.code = "path_not_directory";
    throw error;
  }
  return resolved;
}
