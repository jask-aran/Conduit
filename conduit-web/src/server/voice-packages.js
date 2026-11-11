import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Releases install the optional transcribe-cpp binding on the first model
// download. Checkouts use the pinned package in node_modules.
const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MODULES = path.join(WEB_ROOT, "node_modules");
const LINKED = ["transcribe-cpp"];

function wanted() {
  // devDependencies: a production `npm ci --omit=dev` leaves them out.
  const { dependencies = {}, devDependencies = {} } = JSON.parse(readFileSync(path.join(WEB_ROOT, "package.json"), "utf8"));
  Object.assign(dependencies, devDependencies);
  return Object.fromEntries(["transcribe-cpp"].filter((name) => dependencies[name]).map((name) => [name, dependencies[name]]));
}

function runtimeDir() {
  const dataRoot = process.env.CONDUIT_DATA_ROOT || path.join(os.homedir(), ".conduit", "data");
  const tag = Object.entries(wanted()).map(([name, version]) => `${name.replace(/[@/]/g, "")}-${version}`).join("_");
  return path.join(dataRoot, "runtime", `voice-${process.platform}-${process.arch}-${tag}`);
}

const present = () => LINKED.every((name) => existsSync(path.join(MODULES, name, "package.json")));

async function link(dir) {
  for (const name of LINKED) {
    const target = path.join(dir, "node_modules", name);
    const at = path.join(MODULES, name);
    if (!existsSync(target) || existsSync(path.join(at, "package.json"))) continue;
    await fs.mkdir(path.dirname(at), { recursive: true });
    await fs.rm(at, { recursive: true, force: true });
    await fs.symlink(target, at, "dir");
  }
}

function npmCommand() {
  // The npm beside the Node running Conduit, so it builds for that Node.
  const cli = path.join(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  return existsSync(cli) ? [process.execPath, [cli]] : [process.platform === "win32" ? "npm.cmd" : "npm", []];
}

let installing = null;

export async function ensureVoicePackages({ onPhase } = {}) {
  if (present()) return;
  const dir = runtimeDir();
  if (!existsSync(path.join(dir, "node_modules", "transcribe-cpp"))) {
    installing ||= (async () => {
      onPhase?.("runtime");
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "package.json"), `${JSON.stringify({ private: true, dependencies: wanted() }, null, 2)}\n`);
      const [command, prefix] = npmCommand();
      await new Promise((resolve, reject) => {
        const child = spawn(command, [...prefix, "install", "--omit=dev", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: dir, stdio: ["ignore", "ignore", "pipe"] });
        let stderr = "";
        child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4000); });
        child.on("error", reject);
        child.on("close", (code) => code === 0 ? resolve() : reject(Object.assign(new Error(`Could not install the voice runtime: ${stderr.trim() || `npm exited ${code}`}`), { code: "voice_runtime_install", status: 502 })));
      });
    })().finally(() => { installing = null; });
    await installing;
  }
  await link(dir);
}

export async function importVoicePackage(name) {
  if (!present()) {
    const dir = runtimeDir();
    if (!existsSync(path.join(dir, "node_modules"))) {
      throw Object.assign(new Error("The local voice runtime is not installed. Install a voice model to download it."), { code: "voice_runtime_missing", status: 409 });
    }
    await link(dir);
  }
  return import(name);
}
