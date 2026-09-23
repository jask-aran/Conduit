import fs from "node:fs/promises";
import path from "node:path";

async function ensureDirectory(directory) {
  try {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      const error = new Error("Conduit-owned path must be a real directory");
      error.code = "unsafe_conduit_path";
      error.path = directory;
      throw error;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await fs.mkdir(directory);
  }
}

export async function ensureChatTree(project, chatId) {
  const conduitRoot = await ensureConduitRoot(project);
  const chatRoot = path.join(conduitRoot.chats, chatId);
  const components = [
    conduitRoot.conduit,
    conduitRoot.chats,
    chatRoot,
    path.join(chatRoot, "attachments"),
    path.join(chatRoot, ".partial"),
  ];
  for (const component of components) await ensureDirectory(component);
  return {
    root: components[2],
    attachments: components[3],
    partial: components[4],
  };
}

export async function ensureConduitRoot(project) {
  const root = path.resolve(project.workingRoot);
  if (project.externalPath) await ensureDirectory(root);
  else await fs.mkdir(root, { recursive: true });
  await ensureDirectory(root);
  const conduit = path.join(root, ".conduit");
  const chats = path.join(conduit, "chats");
  await ensureDirectory(conduit);
  await ensureDirectory(chats);
  return { root, conduit, chats };
}
