import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/*
 * Keys and tokens live in the hub's state files, so there is one way to write any of them and no store sets a mode or
 * names a temporary file itself. The rename means a reader sees the old file or the new one, and a crash leaves one.
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

export async function writePrivateJson(file, value, { compact = false } = {}) {
  await writePrivateFile(file, `${compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)}\n`);
}

// Files are chmodded too: a mode given to a write only counts when it makes the file.
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
