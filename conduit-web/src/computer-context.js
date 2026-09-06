import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Computer contexts are transient inspector/terminal scopes, never chat projects.
export async function computerContext(requested = os.homedir()) {
  if (typeof requested !== "string" || !path.isAbsolute(requested) || requested.includes("\0")) {
    throw Object.assign(new Error("Computer path must be an absolute directory path"), { status: 400, code: "computer_path_invalid" });
  }
  const root = await fs.realpath(requested);
  if (!(await fs.stat(root)).isDirectory()) {
    throw Object.assign(new Error("Computer path is not a directory"), { status: 400, code: "computer_path_invalid" });
  }
  return {
    id: `computer:${Buffer.from(root).toString("base64url")}`,
    slug: "computer", name: path.basename(root) || root, kind: "workspace", origin: "linked",
    workingRoot: root, externalPath: root, sessions: [],
  };
}

export async function resolveComputerContext(id) {
  if (!id.startsWith("computer:")) return null;
  const encoded = id.slice("computer:".length);
  const root = Buffer.from(encoded, "base64url").toString("utf8");
  if (Buffer.from(root).toString("base64url") !== encoded) {
    throw Object.assign(new Error("Computer context is invalid"), { status: 400, code: "computer_context_invalid" });
  }
  const context = await computerContext(root);
  if (context.id !== id) throw Object.assign(new Error("Computer folder identity changed"), { status: 409, code: "computer_context_changed" });
  return context;
}

// Navigation only needs repository discovery, never a status scan. Home is the
// Computer boundary; its dotfiles repository must not capture unrelated folders.
export async function findComputerGitRoot(root) {
  const home = await fs.realpath(os.homedir());
  let directory = root;
  while (directory !== home) {
    const marker = await fs.stat(path.join(directory, ".git")).catch((error) => {
      if (["ENOENT", "ENOTDIR", "EACCES"].includes(error.code)) return null;
      throw error;
    });
    // Worktrees and submodules use a .git file rather than a directory.
    if (marker?.isDirectory() || marker?.isFile()) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return null;
}
