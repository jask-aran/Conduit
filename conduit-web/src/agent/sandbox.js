import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ExecutionError, FileError } from "@earendil-works/pi-durable/env";

const source = fileURLToPath(new URL("./sandbox/landlock.c", import.meta.url));
const managedBin = fileURLToPath(new URL("../../../working-files/.venv/bin", import.meta.url));
const builds = new Map();
// Each environment is made per call: what its commands may read is kept across them, by folder and PATH.
const grantsFor = new Map();
const inside = (base, target) => target === base || target.startsWith(base + path.sep);
const denied = (target) => ({ ok: false, error: new FileError("permission_denied", "Outside your folder: use a device and folder (see `devices`) to work elsewhere", target) });

export function sandboxHelper(dataRoot) {
  if (!builds.has(dataRoot)) builds.set(dataRoot, (async () => {
    try {
      const code = await readFile(source);
      const hash = createHash("sha256").update(code).digest("hex");
      const dir = path.join(dataRoot, "bin");
      const output = path.join(dir, `conduit-landlock-${hash}`);
      await mkdir(dir, { recursive: true });
      try { await chmod(output, 0o700); return output; } catch (error) { if (error.code !== "ENOENT") throw error; }
      const temporary = `${output}-${randomUUID()}`;
      try {
        await promisify(execFile)("cc", ["-O2", "-o", temporary, source]);
        await chmod(temporary, 0o700);
        const { rename } = await import("node:fs/promises");
        await rename(temporary, output);
      } finally {
        const { unlink } = await import("node:fs/promises");
        await unlink(temporary).catch(() => {});
      }
      return output;
    } catch (error) { throw new Error(`The agent's sandbox could not be built: ${error.message}`); }
  })());
  return builds.get(dataRoot);
}

export function sandboxedEnv(env, { folder, dataRoot, helper, shellEnv = {} }) {
  const canonical = async (target) => {
    let current = target;
    const rest = [];
    for (;;) {
      try { return path.join(await realpath(current), ...rest.reverse()); }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        try { if ((await lstat(current)).isSymbolicLink()) throw new Error("Dangling symlink"); }
        catch (statError) { if (statError.code !== "ENOENT") throw statError; }
        const parent = path.dirname(current);
        if (parent === current) throw error;
        rest.push(path.basename(current)); current = parent;
      }
    }
  };
  const check = async (target, context) => {
    try {
      const absolute = await env.absolutePath(target, context);
      if (!absolute.ok) return absolute;
      if (!inside(await canonical(path.resolve(folder)), await canonical(absolute.value))) return denied(target);
      return null;
    } catch { return denied(target); }
  };
  // What a command may read, worked out once per environment: realpath over every PATH entry is slow (WSL's PATH
  // carries dozens of Windows folders on /mnt), and none of it changes between commands.
  const key = `${folder}\0${shellEnv.PATH || ""}`;
  const allowedPaths = async () => {
    const system = ["/usr", "/bin", "/sbin", "/lib", "/lib32", "/lib64", "/etc", "/opt", "/proc", "/sys", "/dev", "/run"];
    const home = await canonical(homedir());
    const dirs = [];
    for (const dir of (shellEnv.PATH || "").split(path.delimiter).filter((item) => path.isAbsolute(item) && !item.startsWith("/mnt/"))) {
      try {
        const resolved = await canonical(dir);
        const managed = path.resolve(dir) === path.resolve(managedBin);
        if ((!inside(home, path.resolve(dir)) && !inside(home, resolved)) || managed) {
          dirs.push(dir);
          // A prefix's bin links into the prefix (Linuxbrew's Cellar, a venv's lib): the prefix reads too, never
          // the root or anything holding the home folder.
          const prefix = path.dirname(path.resolve(dir));
          if (path.basename(path.resolve(dir)) === "bin" && prefix !== path.parse(prefix).root && !inside(prefix, home)) dirs.push(prefix);
        }
      } catch { /* A broken PATH entry cannot provide a tool. */ }
    }
    // Conduit's managed interpreters (its venv's python links into them): toolchains only, never the rest of the data.
    dirs.push(path.join(dataRoot, "toolchains"));
    // What every command reads that a system may keep elsewhere by a link (WSL's resolv.conf is under /mnt/wsl).
    for (const file of ["/etc/resolv.conf", "/etc/hosts", "/etc/localtime", "/etc/ssl/certs/ca-certificates.crt"]) {
      try { const real = await realpath(file); if (!system.some((root) => inside(root, real))) dirs.push(real); } catch { /* not on this system */ }
    }
    return { system, dirs };
  };
  const pathMethods = new Set(["absolutePath", "readTextFile", "readTextLines", "openTextLineReader", "readBinaryFile", "openBinaryReader", "writeFile", "appendFile", "truncateFile", "flushFile", "renameFile", "createDir", "listDir", "listFiles", "openDirReader", "fileInfo", "canonicalPath", "exists", "remove"]);
  return new Proxy(env, { get(target, key) {
    if (key === "exec") return async (command, options, context) => {
      const cwd = options?.cwd || target.cwd;
      const invalid = await check(cwd, context);
      if (invalid) return { ok: false, error: new ExecutionError("spawn_error", invalid.error.message) };
      let binary;
      try { binary = await helper(); } catch (error) { return { ok: false, error: new ExecutionError("spawn_error", error.message) }; }
      const tmp = path.join(folder, ".tmp");
      const invalidTmp = await check(tmp, context);
      if (invalidTmp) return { ok: false, error: new ExecutionError("spawn_error", invalidTmp.error.message) };
      try { await mkdir(tmp, { recursive: true }); } catch (error) { return { ok: false, error: new ExecutionError("spawn_error", error.message) }; }
      if (!grantsFor.has(key)) grantsFor.set(key, allowedPaths());
      const { system, dirs } = await grantsFor.get(key);
      const clean = { PATH: shellEnv.PATH || "/usr/bin:/bin", HOME: folder, TMPDIR: tmp };
      for (const name of ["LANG", "LC_ALL", "TERM"]) if (shellEnv[name]) clean[name] = shellEnv[name];
      const args = [binary, "--rw", folder, "--rw", "/dev/null", "--rw", "/dev/tty", ...[...new Set([...system, ...dirs])].flatMap((dir) => ["--ro", dir]), "--", ...(typeof command === "string" ? ["/bin/bash", "-c", command] : command)];
      return target.exec(args, { ...options, cwd, env: clean, inheritEnv: false }, context);
    };
    if (key === "watch") return async (targets, onChange, context) => {
      for (const item of targets) { const failure = await check(item.path, context); if (failure) return failure; }
      return target.watch(targets, onChange, context);
    };
    if (key === "joinPath") return async (parts, context) => {
      const result = await target.joinPath(parts, context);
      return result.ok ? (await check(result.value, context) || result) : result;
    };
    if (key === "createTempDir" || key === "createTempFile") return async (options, context) => {
      const tmp = path.join(folder, ".tmp");
      const failure = await check(tmp, context); if (failure) return failure;
      try {
        await mkdir(tmp, { recursive: true });
        const dir = await mkdtemp(path.join(tmp, "tmp-"));
        if (key === "createTempDir") return { ok: true, value: dir };
        const file = path.join(dir, `${options?.prefix ?? ""}${randomUUID()}${options?.suffix ?? ""}`);
        const invalid = await check(file, context); if (invalid) return invalid;
        await writeFile(file, ""); return { ok: true, value: file };
      } catch (error) { return { ok: false, error: new FileError("unknown", error.message) }; }
    };
    if (pathMethods.has(key)) return async (...args) => {
      const context = args.at(-1);
      for (const item of key === "renameFile" ? args.slice(0, 2) : args.slice(0, 1)) { const failure = await check(item, context); if (failure) return failure; }
      return target[key](...args);
    };
    const value = Reflect.get(target, key, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
}
