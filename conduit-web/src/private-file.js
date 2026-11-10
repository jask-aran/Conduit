import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/*
 * How the hub holds what it keeps on disk: every file of its state is the owner's alone (0600), in a data folder that
 * is the owner's alone (0700), and is replaced whole or not at all. Keys, tokens and private halves live in these files
 * (voice.json, the search keys, identity.json, auth.json, push.json, a connector's tokens), and so do chats and drafts,
 * so there is one way to write any of them, and no store sets a mode or names a temporary file itself.
 *
 * A write goes to a new file beside the target (made exclusively, so nothing else's is ever written into), is flushed
 * to disk, then renamed over it: a reader sees the old file or the new one, and a crash leaves one of them.
 */
export async function writePrivateFile(file, content) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.part`);
  let handle;
  try {
    handle = await fs.open(temporary, "wx", 0o600);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temporary, file);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/** A value as a JSON file: indented to be read by a person unless `compact`. */
export async function writePrivateJson(file, value, { compact = false } = {}) {
  await writePrivateFile(file, `${compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`);
}

/**
 * The data folder made the owner's alone, with the files in it that were written before every write was private (a
 * mode given to a write only counts when it makes the file). Once, as the hub starts.
 */
export async function holdPrivately(dataRoot, folders = ["", "pi", "network"]) {
  await fs.mkdir(dataRoot, { recursive: true, mode: 0o700 });
  await fs.chmod(dataRoot, 0o700);
  for (const folder of folders) {
    const directory = path.join(dataRoot, folder);
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.filter((entry) => entry.isFile())
      .map((entry) => fs.chmod(path.join(directory, entry.name), 0o600).catch(() => {})));
  }
}
