import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

/**
 * The interface this server serves, as one zip an installed client can take
 * for its own (live update). The client keeps launching from the copy on the
 * device -- that is the point of bundling it -- and only swaps to a newer one
 * it has already downloaded whole.
 *
 * A build is named by a hash of its index.html, which names every hashed
 * asset, so two different builds never share a name. The zip is made once per
 * build and kept in memory.
 */
export function createClientBundle(dist) {
  let cached = null;

  const current = async () => {
    const index = await fs.readFile(path.join(dist, "index.html"));
    const build = crypto.createHash("sha256").update(index).digest("hex").slice(0, 16);
    if (cached?.build === build) return cached;
    cached = { build, zip: null };
    return cached;
  };

  const zipFor = async (entry) => {
    entry.zip ??= zipDirectory(dist);
    return entry.zip;
  };

  return {
    async manifest() {
      const { build } = await current();
      return { build };
    },
    async zip(build) {
      const entry = await current();
      if (entry.build !== build) return null;
      return zipFor(entry);
    },
  };
}

async function listFiles(root, directory = root) {
  const files = [];
  for (const item of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, item.name);
    if (item.isDirectory()) files.push(...await listFiles(root, full));
    // Not the copies precompress.mjs made for the server to send: the app inflates its own.
    else if (item.isFile() && !/\.(br|gz)$/.test(item.name)) files.push(full);
  }
  return files;
}

/** A plain zip (deflate, no zip64): the build is a few MB of small files. */
async function zipDirectory(root) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of await listFiles(root)) {
    const name = Buffer.from(path.relative(root, file).split(path.sep).join("/"));
    const data = await fs.readFile(file);
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length / 2, 8);
  end.writeUInt16LE(centrals.length / 2, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
