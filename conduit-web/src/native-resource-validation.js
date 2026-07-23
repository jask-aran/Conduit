import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

function resourceRoots(cwd) {
  const roots = [path.join(cwd, ".pi")];
  let current = path.resolve(cwd);
  while (true) {
    const agentsSkills = path.join(current, ".agents", "skills");
    if (agentsSkills !== path.join(os.homedir(), ".agents", "skills")) roots.push(agentsSkills);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return roots;
}

export async function validateNativeProjectResources(cwd, {
  fileSystem = fs,
  maxEntries = DEFAULT_MAX_ENTRIES,
  maxBytes = DEFAULT_MAX_BYTES,
} = {}) {
  const roots = resourceRoots(cwd);
  let entryCount = 0;
  let totalBytes = 0;

  const statEntry = async (target) => {
    let stat;
    try {
      stat = await fileSystem.lstat(target);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw Object.assign(new Error("Symlinked project resources cannot be trusted through Conduit"), {
        code: "native_resource_symlink",
        path: target,
      });
    }
    return stat;
  };

  // A .agents/skills lstat alone would follow a symlinked .agents ancestor.
  for (const root of roots.filter((item) => item.endsWith(`${path.sep}.agents${path.sep}skills`))) {
    const agentsRoot = path.dirname(root);
    const agentsStat = await statEntry(agentsRoot);
    if (agentsStat?.isDirectory()) await statEntry(root);
  }

  const visit = async (target) => {
    const stat = await statEntry(target);
    if (!stat) return;
    if (entryCount >= maxEntries) {
      throw Object.assign(new Error("Too many project resources to preflight safely"), {
        code: "native_resource_limit",
      });
    }
    entryCount += 1;
    if (stat.isFile()) {
      totalBytes += stat.size;
      if (totalBytes > maxBytes) {
        throw Object.assign(new Error("Project resources are too large to preflight safely"), {
          code: "native_resource_limit",
        });
      }
    }
    if (!stat.isDirectory()) return;
    const children = await fileSystem.readdir(target, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) await visit(path.join(target, child.name));
  };

  for (const root of roots) await visit(root);
  return { entryCount, totalBytes };
}
