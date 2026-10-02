// Installs a thin release's dependencies from its lockfile, for this machine
// only. Run by install.sh with the Node Conduit will run on:
//
//   node release-deps.mjs <conduit-web dir>
//
// 1. The lock is pruned: packages built for another OS or CPU go, and so does
//    the Claude Code binary the Agent SDK would bring (Conduit drives the
//    user's own `claude`).
// 2. `npm ci --omit=dev --omit=optional --ignore-scripts`. Optional packages
//    are left to step 3 because Pi's own npm-shrinkwrap makes npm fetch every
//    platform's esbuild otherwise (~100 MB); scripts are off because the one
//    native build, node-pty, ships prebuilt in the release.
// 3. The optional packages that fit this machine are fetched from the lock's
//    URLs, checked against its integrity hashes, and unpacked in place.
// 4. node-pty's prebuilt binary is put where node-pty looks for it.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const web = path.resolve(process.argv[2] || ".");
const lockFile = path.join(web, "package-lock.json");
const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
const fits = (list, value) => !Array.isArray(list) || list.includes(value) || list.some((item) => item.startsWith("!") && item.slice(1) !== value);

const gone = new Set();
for (const [key, entry] of Object.entries(lock.packages)) {
  if (!key) continue;
  const foreign = entry.optional && (!fits(entry.os, process.platform) || !fits(entry.cpu, process.arch));
  if (foreign || /node_modules\/@anthropic-ai\/claude-agent-sdk-/.test(key)) {
    delete lock.packages[key];
    gone.add(key.replace(/^.*node_modules\//, ""));
  }
}
for (const entry of Object.values(lock.packages)) for (const name of gone) delete entry.optionalDependencies?.[name];
fs.writeFileSync(lockFile, `${JSON.stringify(lock, null, 2)}\n`);

const cli = path.join(path.dirname(fs.realpathSync(process.execPath)), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
const [npm, prefix] = fs.existsSync(cli) ? [process.execPath, [cli]] : ["npm", []];
execFileSync(npm, [...prefix, "ci", "--omit=dev", "--omit=optional", "--ignore-scripts", "--prefer-offline", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: web, stdio: ["ignore", "ignore", "inherit"] });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conduit-deps-"));
try {
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (!key || !entry.optional || entry.dev || entry.devOptional || !entry.resolved) continue;
    const at = path.join(web, key);
    if (fs.existsSync(path.join(at, "package.json"))) continue;
    const response = await fetch(entry.resolved);
    if (!response.ok) throw new Error(`${entry.resolved}: ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer());
    const [algorithm, expected] = String(entry.integrity).split("-");
    if (crypto.createHash(algorithm).update(body).digest("base64") !== expected) throw new Error(`Integrity check failed for ${key}`);
    const archive = path.join(tmp, "package.tgz");
    fs.writeFileSync(archive, body);
    fs.mkdirSync(at, { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", at, "--strip-components=1"]);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

const prebuilt = path.join(web, "..", "prebuilt", "node-pty");
if (fs.existsSync(prebuilt)) fs.cpSync(prebuilt, path.join(web, "node_modules", "node-pty"), { recursive: true });
