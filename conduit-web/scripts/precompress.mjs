/**
 * Compress the built client once, beside each file, for the server to send as
 * it is (server.js, the built assets): `.br` and `.gz` next to every text
 * asset of 1 KB or more, kept only where smaller. The server otherwise
 * compressed each file on every request, ~40 ms for the main bundle, and a
 * new build has every client's worker fetch all of them again.
 *
 * Run by the server builds only (start-conduit.sh, package-server.sh): the
 * apps bundle `dist` themselves and have no use for the copies.
 *
 *   node scripts/precompress.mjs [--best]   (--best: brotli 11, for releases)
 */
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/assets");
const quality = process.argv.includes("--best") ? 11 : 9;
const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

const names = (await fs.readdir(dist)).filter((name) => /\.(js|css|svg|json|ttf|wasm)$/.test(name));
const started = performance.now();
let before = 0;
let after = 0;
await Promise.all(names.map(async (name) => {
  const file = path.join(dist, name);
  const data = await fs.readFile(file);
  if (data.length < 1024) return;
  before += data.length;
  const [br, gz] = await Promise.all([
    brotli(data, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length } }),
    gzip(data, { level: 9 }),
  ]);
  if (br.length < data.length) await fs.writeFile(`${file}.br`, br);
  if (gz.length < data.length) await fs.writeFile(`${file}.gz`, gz);
  after += Math.min(br.length, data.length);
}));
console.log(`Precompressed ${names.length} assets: ${before} -> ${after} bytes (brotli ${quality}) in ${Math.round(performance.now() - started)} ms`);
