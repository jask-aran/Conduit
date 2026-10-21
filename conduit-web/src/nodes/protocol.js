import path from "node:path";

/**
 * The Conduit node protocol (plan decision 17), shared by both ends.
 *
 * A node dials the main server and stays connected; main calls into the
 * node's execution environment over that one socket. The vocabulary is
 * Conduit's own and versioned, so an installed node survives changes to
 * pi-durable's environment API: main adapts it, the wire does not move.
 *
 * node -> main   { type: "hello", version, nodeId, name, roots: [{ path, read, write, shell }] }
 * main -> node   { type: "call", id, target: "env" | <handle id>, method, args, cwd }
 *                { type: "abort", id }
 * node -> main   { type: "result", id, value }       a Result, encoded
 *                { type: "failure", id, message }    the call itself could not run
 *                { type: "event", id, kind, ... }    exec output, watch changes
 *
 * Values are JSON. Bytes travel as `{ $bytes: base64 }`, the environment's two
 * error classes as `{ $error: "file" | "exec", code, message, path?, spillPath? }`,
 * and an object with methods of its own (a line reader, a directory reader)
 * as `{ $handle: id }`, which main turns back into an object whose methods
 * are calls on that handle.
 */
export const NODE_PROTOCOL_VERSION = 1;

export function encode(value) {
  if (value instanceof Uint8Array) return { $bytes: Buffer.from(value).toString("base64") };
  if (value instanceof Error && value.constructor?.name === "FileError") return { $error: "file", code: value.code, message: value.message, ...(value.path ? { path: value.path } : {}) };
  if (value instanceof Error && value.constructor?.name === "ExecutionError") return { $error: "exec", code: value.code, message: value.message, ...(value.spillPath ? { spillPath: value.spillPath } : {}) };
  if (value instanceof Error) return { $error: "file", code: "unknown", message: value.message };
  if (Array.isArray(value)) return value.map(encode);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)]));
  return value;
}

/** Decode, building errors with the classes the caller's environment module exports. */
export function decode(value, { FileError, ExecutionError, handle = null } = {}) {
  if (Array.isArray(value)) return value.map((item) => decode(item, { FileError, ExecutionError, handle }));
  if (!value || typeof value !== "object") return value;
  if (typeof value.$bytes === "string") return new Uint8Array(Buffer.from(value.$bytes, "base64"));
  if (value.$error === "file") return new FileError(value.code, value.message, value.path);
  if (value.$error === "exec") return Object.assign(new ExecutionError(value.code, value.message), value.spillPath ? { spillPath: value.spillPath } : {});
  if (typeof value.$handle === "string" && handle) return handle(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item, { FileError, ExecutionError, handle })]));
}

/**
 * Which grant a method needs, and which of its arguments are paths.
 *
 * Checked on the node, against the roots its owner shared: main asks, the
 * device decides. A method that is not listed is not served.
 */
export const METHOD_GRANTS = Object.freeze({
  absolutePath: { grant: "read", paths: [] },
  joinPath: { grant: "read", paths: [] },
  canonicalPath: { grant: "read", paths: [0] },
  readTextFile: { grant: "read", paths: [0] },
  openTextLineReader: { grant: "read", paths: [0] },
  readTextLines: { grant: "read", paths: [0] },
  readBinaryFile: { grant: "read", paths: [0] },
  openBinaryReader: { grant: "read", paths: [0] },
  fileInfo: { grant: "read", paths: [0] },
  listDir: { grant: "read", paths: [0] },
  listFiles: { grant: "read", paths: [0] },
  openDirReader: { grant: "read", paths: [0] },
  exists: { grant: "read", paths: [0] },
  watch: { grant: "read", paths: [] },
  writeFile: { grant: "write", paths: [0] },
  appendFile: { grant: "write", paths: [0] },
  truncateFile: { grant: "write", paths: [0] },
  flushFile: { grant: "write", paths: [0] },
  renameFile: { grant: "write", paths: [0, 1] },
  createDir: { grant: "write", paths: [0] },
  remove: { grant: "write", paths: [0] },
  createTempDir: { grant: "write", paths: [] },
  createTempFile: { grant: "write", paths: [] },
  exec: { grant: "shell", paths: [] },
});

/** Methods of the handles a call can return, by the method that made them. */
export const HANDLE_METHODS = Object.freeze(["readLine", "read", "scanLines", "info", "next", "close"]);

const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/** The shared root a path falls in, if it is shared with this grant. */
export function rootFor(roots, absolute, grant) {
  return roots.find((root) => root[grant] && inside(path.resolve(root.path), absolute)) || null;
}
