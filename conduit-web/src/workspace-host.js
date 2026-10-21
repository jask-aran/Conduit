import fs from "node:fs/promises";
import path from "node:path";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { RemoteExecutionEnv } from "./nodes/remote-env.js";

/**
 * Where a workspace's files and Git live, under the workspace inspector.
 *
 * The inspector's rules -- which paths are safe, revisions, conflict checks,
 * Git parsing, caching -- are one body of code (plan decision 22). What
 * differs is only the host it runs on: this server's own disk, or a device
 * reached through its execution environment. Every path a host takes is
 * workspace-relative with `/` separators ("" is the root), so a device
 * resolves it by its own rules -- a Windows device included.
 *
 * Stats come back in one shape: `size`, `mtimeMs`, `birthtimeMs`, `dev`,
 * `ino`, and `isFile()`, `isDirectory()`, `isSymbolicLink()`.
 */

const missing = (error) => (error?.code === "ENOENT" ? null : Promise.reject(error));

/** This server's own disk. `root` is the workspace's absolute path here. */
export function localHost(root, { runGit }) {
  const expected = path.resolve(root);
  let real = null;
  const at = (relative) => (relative ? path.join(real, ...relative.split("/")) : real);
  const host = {
    local: true,
    key: expected,
    async checkRoot() {
      const stat = await fs.lstat(expected).catch((error) => {
        if (error.code === "ENOENT") throw Object.assign(new Error("The requested path does not exist"), { code: "path_not_found" });
        throw error;
      });
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw Object.assign(new Error("The workspace root must be a real directory"), { code: "unsafe_workspace_root" });
      }
      real = await fs.realpath(expected);
      host.key = real;
    },
    localPath: (relative) => at(relative),
    lstat: (relative) => fs.lstat(at(relative)).catch(missing),
    stat: (relative) => fs.stat(at(relative)),
    async list(relative, { limit }) {
      const entries = [];
      for await (const entry of await fs.opendir(at(relative))) {
        if (entries.length >= limit) return null;
        entries.push({ name: entry.name, type: entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other", symlink: entry.isSymbolicLink() });
      }
      return entries;
    },
    async read(relative, maxBytes = null) {
      if (maxBytes == null) return fs.readFile(at(relative));
      const handle = await fs.open(at(relative), "r");
      try {
        const content = Buffer.alloc(maxBytes);
        const { bytesRead } = await handle.read(content, 0, content.length, 0);
        return content.subarray(0, bytesRead);
      } finally {
        await handle.close();
      }
    },
    async write(relative, content, { exclusive }) {
      await fs.writeFile(at(relative), content, exclusive ? { flag: "wx" } : undefined);
      return fs.stat(at(relative));
    },
    unlink: (relative) => fs.unlink(at(relative)),
    mkdir: (relative) => fs.mkdir(at(relative)),
    rename: (from, to) => fs.rename(at(from), at(to)),
    removeTree: (relative) => fs.rm(at(relative), { recursive: true }),
    git: (args, options) => runGit(real, args, options),
  };
  return host;
}

const KINDS = { file: "file", directory: "directory", symlink: "other" };
const statOf = (info) => ({
  size: info.size, mtimeMs: info.mtimeMs, birthtimeMs: NaN, dev: 0, ino: 0,
  isFile: () => info.kind === "file", isDirectory: () => info.kind === "directory", isSymbolicLink: () => info.kind === "symlink",
});

/**
 * A device's folder, through its execution environment (src/nodes). A device
 * that is offline is said so at once: someone browsing is not a turn that can
 * pause. Git runs as `git` on the device, so it needs the shell grant there.
 */
export function deviceHost({ hub, nodeId, root }) {
  const env = new RemoteExecutionEnv({ hub, nodeId, cwd: root });
  const context = (signal) => {
    if (!hub.live.get(nodeId)?.ready) {
      throw Object.assign(new Error("The device holding this workspace is offline"), { code: "device_offline", status: 503 });
    }
    return withAbortSignal(signal || AbortSignal.timeout(60_000), BACKGROUND_CONTEXT);
  };
  const place = (relative) => relative || ".";
  const value = (result) => {
    if (result.ok) return result.value;
    const code = result.error.code === "not_found" ? "ENOENT" : result.error.code;
    throw Object.assign(new Error(result.error.message), { code,
      status: { permission_denied: 403, not_supported: 501 }[result.error.code] });
  };
  return {
    local: false,
    key: `node:${nodeId}:${root}`,
    async checkRoot() {
      const info = value(await env.fileInfo(".", context()));
      if (info.kind !== "directory") throw Object.assign(new Error("The workspace root must be a real directory"), { code: "unsafe_workspace_root" });
    },
    localPath: () => null,
    async lstat(relative) {
      const result = await env.fileInfo(place(relative), context());
      if (!result.ok && result.error.code === "not_found") return null;
      return statOf(value(result));
    },
    async stat(relative) { return statOf(value(await env.fileInfo(place(relative), context()))); },
    async list(relative, { limit }) {
      const found = value(await env.listDir(place(relative), context()));
      if (found.length > limit) return null;
      return found.map((info) => ({ name: info.name, type: KINDS[info.kind] || "other", symlink: info.kind === "symlink" }));
    },
    async read(relative, maxBytes = null) {
      const ctx = context();
      if (maxBytes == null) return Buffer.from(value(await env.readBinaryFile(relative, ctx)));
      const reader = value(await env.openBinaryReader(relative, {}, ctx));
      try { return Buffer.from(value(await reader.read(0, maxBytes, ctx))); }
      finally { await reader.close(ctx); }
    },
    async write(relative, content, { exclusive }) {
      const ctx = context();
      // The environment has no exclusive create; the inspector has just looked.
      if (exclusive && value(await env.exists(relative, ctx))) throw Object.assign(new Error("exists"), { code: "EEXIST" });
      value(await env.writeFile(relative, content, ctx));
      return statOf(value(await env.fileInfo(relative, ctx)));
    },
    async unlink(relative) { value(await env.remove(relative, { recursive: false }, context())); },
    async mkdir(relative) { value(await env.createDir(relative, { recursive: false }, context())); },
    async rename(from, to) { value(await env.renameFile(from, to, context())); },
    async removeTree(relative) { value(await env.remove(relative, { recursive: true }, context())); },
    async git(args, { signal, maxBuffer = 64 * 1024, timeoutMs = 10_000 } = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      let stdout = "";
      let stderr = "";
      let overflow = false;
      try {
        const result = await env.exec(["git", ...args], {
          onOutput: (text, _context, info) => {
            if (info?.stream === "stderr") stderr += text; else stdout += text;
            if (!overflow && Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBuffer) { overflow = true; controller.abort(); }
          },
        }, context(controller.signal));
        if (overflow) throw Object.assign(new Error("Git inspection exceeded its output limit"), { code: "workspace_git_output_limit" });
        if (signal?.aborted) throw Object.assign(new Error("Workspace inspection was cancelled"), { code: "workspace_inspection_aborted" });
        if (controller.signal.aborted) throw Object.assign(new Error("Git inspection timed out"), { code: "workspace_git_timeout" });
        const { exitCode } = value(result);
        if (exitCode !== 0) {
          throw Object.assign(new Error(stderr.trim() || `Git exited with status ${exitCode}`), { code: "workspace_git_failed", stdout, stderr });
        }
        return { stdout, stderr };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
